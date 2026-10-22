"""
DracoSkill — package installation inside the sandbox (never on the user's machine).

  pip   -> pip install --target <scope>/.libs/python        (PyPI)
  npm   -> npm install --prefix <scope>                      (npm registry, --ignore-scripts)
  jar   -> downloads a .jar from Maven Central into <scope>/.libs/java
  clib  -> downloads header-only C/C++ libraries into <scope>/.libs/c

Two scopes: 'project' (only that project sees it) and 'account' (every project
the user owns sees it). Installs are the only step that gets network access.

Honest limits, repeated in the terminal's `help`:
  * jar does not resolve transitive dependencies -- add each jar you need.
  * clib is for header-only libraries (nlohmann/json, stb, glm, Eigen, ...).
    Libraries that need to be compiled and linked separately are not supported.
  * npm lifecycle scripts are disabled, so packages that compile native addons
    on install won't build.
  * pip builds source distributions, which runs that package's build code.
    That is inherent to pip; it runs under the user's own sandbox uid.
"""
import io
import json
import os
import re
import shutil
import sys
import tarfile
import threading
import urllib.error
import urllib.request
import zipfile

from sandbox import run_process, base_env
from workspace import chown_tree, USER_QUOTA_MB

INSTALL_TIMEOUT = float(os.environ.get("DRACOSKILL_INSTALL_TIMEOUT", 240))
MAVEN_BASE = os.environ.get("DRACOSKILL_MAVEN_BASE", "https://repo1.maven.org/maven2").rstrip("/")
MAX_DOWNLOAD = 120 * 1024 * 1024
_install_slots = threading.BoundedSemaphore(int(os.environ.get("DRACOSKILL_MAX_INSTALLS", 2)))
_user_locks = {}
_user_locks_guard = threading.Lock()

PIP_SPEC = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._\-]*(\[[A-Za-z0-9,._\-]+\])?"
    r"((==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_\-]+(,(==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_\-]+)*)?$")
NPM_SPEC = re.compile(r"^(@[a-z0-9][a-z0-9\-._~]*/)?[a-z0-9][a-z0-9\-._~]*(@[A-Za-z0-9._\-^~*<>=|]+)?$")
MAVEN_COORD = re.compile(r"^([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-]+)$")
GH_SPEC = re.compile(r"^github:([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+)(?:@([A-Za-z0-9_./\-]+))?$")
URL_HOST_SUFFIXES = ("github.com", "githubusercontent.com", "gitlab.com")

OK, FAIL = 0, 1


def _user_lock(user_id):
    with _user_locks_guard:
        return _user_locks.setdefault(user_id, threading.Lock())


class Installer:
    def __init__(self, ws):
        self.ws = ws

    # ---------- dispatch with concurrency + quota guards ----------
    def run(self, tool, args, scope):
        ws = self.ws
        if ws.over_quota():
            return f"Storage quota reached ({ws.usage_mb():.0f} MB). Remove packages (e.g. 'pip uninstall x') first.", FAIL
        lock = _user_lock(ws.user_id)
        if not lock.acquire(timeout=1):
            return "Another install is already running for your account. Wait for it to finish.", FAIL
        try:
            if not _install_slots.acquire(timeout=20):
                return "The package installer is busy. Try again shortly.", FAIL
            try:
                handler = {"pip": self.pip, "npm": self.npm, "jar": self.jar, "clib": self.clib}[tool]
                out, code = handler(args, scope)
            finally:
                _install_slots.release()
        finally:
            lock.release()
        chown_tree(ws.scope_root(scope), ws.uid)
        if ws.usage_mb() > USER_QUOTA_MB:
            out += f"\nWarning: you are over your {USER_QUOTA_MB} MB storage quota. New installs are blocked until you free space."
        return out, code

    def _empty_cfg(self, name):
        """An empty config file we own, so a user-written ~/.npmrc can't redirect the registry."""
        p = os.path.join(self.ws.cache, name)
        if not os.path.exists(p):
            open(p, "w").close()
            if self.ws.uid is not None:
                os.chown(p, 0, 0)  # root-owned and read-only to the sandbox uid
            os.chmod(p, 0o644)
        return p

    def _net_env(self, scope, extra=None):
        ws = self.ws
        env = base_env(ws.home, ws.tmp, {
            "PIP_CACHE_DIR": os.path.join(ws.cache, "pip"),
            "PIP_CONFIG_FILE": "/dev/null",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "PIP_NO_INPUT": "1",
            "npm_config_cache": os.path.join(ws.cache, "npm"),
            "npm_config_userconfig": self._empty_cfg(".npmrc-user"),
            "npm_config_globalconfig": self._empty_cfg(".npmrc-global"),
            "npm_config_update_notifier": "false",
        })
        # CA-bundle *paths* (not secrets) so installs work behind TLS-inspecting proxies.
        # Proxy URLs can embed credentials, so those are opt-in via DRACOSKILL_PASS_ENV.
        passthrough = ["SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"]
        passthrough += [v.strip() for v in os.environ.get("DRACOSKILL_PASS_ENV", "").split(",") if v.strip()]
        for var in passthrough:
            if var in os.environ:
                env[var] = os.environ[var]
        if extra:
            env.update(extra)
        return env

    def _spawn(self, argv, scope, extra_env=None, cwd=None):
        r = run_process(argv, cwd=cwd or self.ws.scope_root(scope), env=self._net_env(scope, extra_env),
                        timeout=INSTALL_TIMEOUT, mem_mb=None, network=True, uid=self.ws.uid, max_chars=60_000)
        text = (r["stdout"] + r["stderr"]).strip()
        if r["timedOut"]:
            return text + f"\nInstall timed out after {INSTALL_TIMEOUT:g}s.", FAIL
        return text, (OK if r["exitCode"] == 0 else FAIL)

    # ---------- pip ----------
    def pip(self, args, scope):
        if not args:
            return "usage: pip install|uninstall|list <packages> [--account]", FAIL
        sub, rest = args[0], args[1:]
        target = self.ws.ensure_lib_dir(scope, "python")
        if sub == "install":
            specs, flags = [], []
            i = 0
            while i < len(rest):
                a = rest[i]
                if a in ("--upgrade", "-U", "--no-deps", "--pre", "--only-binary=:all:", "--prefer-binary"):
                    flags.append(a)
                elif a == "-r" and i + 1 < len(rest):
                    req = os.path.join(self.ws.src, rest[i + 1])
                    if not self.ws.contains(req) or not os.path.isfile(req):
                        return f"requirements file not found in this project: {rest[i + 1]}", FAIL
                    for line in open(req, encoding="utf-8", errors="replace"):
                        line = line.split("#")[0].strip()
                        if line:
                            if not PIP_SPEC.match(line.replace(" ", "")):
                                return f"Unsupported requirement line: {line!r} (plain names/versions only)", FAIL
                            specs.append(line.replace(" ", ""))
                    i += 1
                elif a.startswith("-"):
                    return f"Option {a} isn't allowed here. Supported: --upgrade --no-deps --pre --prefer-binary -r file", FAIL
                elif PIP_SPEC.match(a):
                    specs.append(a)
                else:
                    return f"'{a}' is not a plain PyPI package spec (URLs, paths and VCS installs are disabled).", FAIL
                i += 1
            if not specs:
                return "Name at least one package, e.g. pip install requests numpy", FAIL
            argv = [sys.executable, "-m", "pip", "install", "--target", target, "--no-warn-script-location"] + flags + specs
            return self._spawn(argv, scope)
        if sub == "list":
            argv = [sys.executable, "-m", "pip", "list", "--path", target, "--disable-pip-version-check"]
            return self._spawn(argv, scope)
        if sub in ("uninstall", "remove"):
            names = [a for a in rest if not a.startswith("-")]
            if not names:
                return "usage: pip uninstall <package>", FAIL
            installed = self._pip_installed(target, scope)
            msgs, code = [], OK
            for n in names:
                key = re.sub(r"[-_.]+", "-", n.lower())
                if key not in installed:
                    msgs.append(f"{n}: not installed in {scope} scope")
                    code = FAIL
                    continue
                out, c = self._spawn([sys.executable, "-m", "pip", "uninstall", "-y", "--break-system-packages", n], scope, {"PYTHONPATH": target})
                msgs.append(out)
                code = code or c
            return "\n".join(msgs), code
        return f"pip {sub}: unsupported here. Use install, uninstall or list.", FAIL

    def _pip_installed(self, target, scope):
        out, code = self._spawn([sys.executable, "-m", "pip", "list", "--path", target, "--format=json"], scope)
        try:
            return {re.sub(r"[-_.]+", "-", p["name"].lower()) for p in json.loads(out[out.index("["):])}
        except Exception:
            return set()

    # ---------- npm ----------
    def npm(self, args, scope):
        if not args:
            return "usage: npm install|uninstall|list <packages> [--account]", FAIL
        sub, rest = args[0], args[1:]
        root = self.ws.scope_root(scope)
        if sub in ("install", "i", "add"):
            specs = [a for a in rest if not a.startswith("-")]
            bad = [a for a in rest if a.startswith("-") and a not in ("--save-dev", "-D", "--save-exact", "-E")]
            if bad:
                return f"Option {bad[0]} isn't allowed here.", FAIL
            if not specs:
                return "Name at least one package, e.g. npm install lodash express", FAIL
            for s in specs:
                if not NPM_SPEC.match(s):
                    return f"'{s}' is not a plain npm package spec (URLs, paths and git installs are disabled).", FAIL
            self._ensure_package_json(root)
            argv = ["npm", "install", "--prefix", root, "--no-audit", "--no-fund", "--ignore-scripts",
                    "--loglevel=error", "--no-progress"] + specs
            return self._spawn(argv, scope)
        if sub in ("uninstall", "remove", "rm", "un"):
            specs = [a for a in rest if not a.startswith("-")]
            if not specs or not all(NPM_SPEC.match(s) for s in specs):
                return "usage: npm uninstall <package>", FAIL
            return self._spawn(["npm", "uninstall", "--prefix", root, "--no-audit", "--no-fund",
                                "--ignore-scripts", "--loglevel=error"] + specs, scope)
        if sub in ("list", "ls"):
            return list_node(root) or "(no npm packages in this scope)", OK
        return f"npm {sub}: unsupported here. Use install, uninstall or list.", FAIL

    def _ensure_package_json(self, root):
        p = os.path.join(root, "package.json")
        if not os.path.exists(p):
            with open(p, "w") as f:
                json.dump({"name": "dracoskill-libs", "version": "1.0.0", "private": True}, f)
            if self.ws.uid is not None:
                os.chown(p, self.ws.uid, self.ws.uid)

    # ---------- jar (Maven Central) ----------
    def jar(self, args, scope):
        if not args:
            return "usage: jar add <group:artifact:version> | jar list | jar remove <file.jar>", FAIL
        sub, rest = args[0], args[1:]
        d = self.ws.ensure_lib_dir(scope, "java")
        if sub == "list":
            names = sorted(f for f in os.listdir(d) if f.endswith(".jar"))
            return "\n".join(names) or "(no jars in this scope)", OK
        if sub in ("remove", "rm"):
            if not rest or "/" in rest[0] or not rest[0].endswith(".jar"):
                return "usage: jar remove <file.jar>", FAIL
            p = os.path.join(d, rest[0])
            if not os.path.isfile(p):
                return f"{rest[0]}: not found in {scope} scope", FAIL
            os.unlink(p)
            return f"removed {rest[0]}", OK
        if sub == "add":
            if not rest:
                return "usage: jar add com.google.code.gson:gson:2.11.0", FAIL
            lines, code = [], OK
            for coord in rest:
                m = MAVEN_COORD.match(coord)
                if not m:
                    lines.append(f"{coord}: expected group:artifact:version")
                    code = FAIL
                    continue
                g, a, v = m.groups()
                url = f"{MAVEN_BASE}/{g.replace('.', '/')}/{a}/{v}/{a}-{v}.jar"
                try:
                    data = _download(url, allowed=lambda u: u.startswith(MAVEN_BASE))
                except Exception as e:
                    lines.append(f"{coord}: {e}")
                    code = FAIL
                    continue
                with open(os.path.join(d, f"{a}-{v}.jar"), "wb") as f:
                    f.write(data)
                lines.append(f"added {a}-{v}.jar ({len(data) // 1024} KB). Dependencies are NOT resolved -- add any it needs.")
            return "\n".join(lines), code
        return f"jar {sub}: unsupported. Use add, list or remove.", FAIL

    # ---------- clib (header-only C/C++) ----------
    def clib(self, args, scope):
        if not args:
            return "usage: clib add github:owner/repo[@ref] | clib add <https url to a .h/.hpp> | clib list | clib remove <name>", FAIL
        sub, rest = args[0], args[1:]
        base = self.ws.ensure_lib_dir(scope, "c")
        if sub == "list":
            return "\n".join(sorted(os.listdir(base))) or "(no C/C++ libraries in this scope)", OK
        if sub in ("remove", "rm"):
            if not rest or "/" in rest[0] or rest[0].startswith("."):
                return "usage: clib remove <name>", FAIL
            p = os.path.join(base, rest[0])
            if not os.path.exists(p):
                return f"{rest[0]}: not found in {scope} scope", FAIL
            shutil.rmtree(p) if os.path.isdir(p) else os.unlink(p)
            return f"removed {rest[0]}", OK
        if sub != "add" or not rest:
            return "usage: clib add github:owner/repo[@ref] | clib add <url>", FAIL
        spec = rest[0]
        m = GH_SPEC.match(spec)
        try:
            if m:
                owner, repo, ref = m.groups()
                ref = ref or "HEAD"
                data = _download(f"https://codeload.github.com/{owner}/{repo}/tar.gz/{ref}", allowed=_host_ok)
                dest = os.path.join(base, repo)
                shutil.rmtree(dest, ignore_errors=True)
                n = _extract_tar_strip1(data, dest)
                return (f"added {repo}/ ({n} files). Header-only use: #include the headers directly; "
                        f"include paths are added automatically when you build."), OK
            if spec.startswith("https://"):
                fname = os.path.basename(spec.split("?")[0]) if len(rest) < 2 else rest[1]
                if not re.match(r"^[A-Za-z0-9_][A-Za-z0-9._\-]*\.(h|hpp|hh|hxx|inl)$", fname):
                    return "Single-file URLs must end in .h/.hpp (or pass a filename: clib add <url> name.h).", FAIL
                data = _download(spec, allowed=_host_ok)
                with open(os.path.join(base, fname), "wb") as f:
                    f.write(data)
                return f"added {fname} ({len(data) // 1024} KB).", OK
        except Exception as e:
            return f"clib add failed: {e}", FAIL
        return "Use github:owner/repo[@ref] or an https URL to a header file.", FAIL


# ---------------------------------------------------------------- helpers

def _host_ok(url):
    from urllib.parse import urlparse
    h = (urlparse(url).hostname or "").lower()
    return urlparse(url).scheme == "https" and any(h == s or h.endswith("." + s) for s in URL_HOST_SUFFIXES)


def _download(url, allowed):
    """Download with an allowlist re-checked after redirects, plus a size cap."""
    if not allowed(url):
        raise ValueError("that host isn't on the download allowlist")
    req = urllib.request.Request(url, headers={"User-Agent": "DracoSkill-sandbox/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            if not allowed(resp.geturl()):
                raise ValueError("download redirected to a host that isn't on the allowlist")
            buf = io.BytesIO()
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                buf.write(chunk)
                if buf.tell() > MAX_DOWNLOAD:
                    raise ValueError("download exceeds the size limit")
            return buf.getvalue()
    except urllib.error.HTTPError as e:
        raise ValueError(f"HTTP {e.code} (check the name/version)")
    except urllib.error.URLError as e:
        raise ValueError(f"network error: {e.reason}")


def _extract_tar_strip1(data, dest):
    os.makedirs(dest, exist_ok=True)
    count, total = 0, 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
        for m in tf.getmembers():
            parts = m.name.split("/")[1:]
            if not parts or not m.isfile():  # skip dirs, symlinks, hardlinks, devices
                continue
            rel = os.path.normpath("/".join(parts))
            if rel.startswith("..") or os.path.isabs(rel):
                continue
            total += m.size
            if total > 300 * 1024 * 1024:
                raise ValueError("archive is too large when extracted")
            out = os.path.join(dest, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with tf.extractfile(m) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst)
            count += 1
    return count


def list_node(root):
    nm = os.path.join(root, "node_modules")
    if not os.path.isdir(nm):
        return ""
    names = []
    for n in sorted(os.listdir(nm)):
        if n.startswith("."):
            continue
        dirs = [os.path.join(nm, n, s) for s in sorted(os.listdir(os.path.join(nm, n)))] if n.startswith("@") else [os.path.join(nm, n)]
        for d in dirs:
            try:
                v = json.load(open(os.path.join(d, "package.json"))).get("version", "?")
            except Exception:
                v = "?"
            names.append(f"{os.path.relpath(d, nm)}@{v}")
    return "\n".join(names)


def list_python(libdir):
    if not os.path.isdir(libdir):
        return []
    out = []
    for n in sorted(os.listdir(libdir)):
        if n.endswith(".dist-info"):
            out.append(n[:-len(".dist-info")].replace("-", " ", 1).replace(" ", "=="))
    return out
