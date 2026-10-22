"""
DracoSkill — sandbox primitives.

Everything that actually spawns a user-controlled process goes through
run_process() in this file. It layers, in order of availability:

  1. Per-user OS identity   (setpriv --reuid)  -- when the server runs as root
     (the normal case inside the Docker image). Each DracoSkill user gets a
     distinct numeric uid, their workspace is chmod 700 to that uid, and the
     SQLite database is 600 root-only. User code therefore cannot read the
     database or another user's files. This is the main isolation boundary
     for the "process" driver.
  2. Network namespace      (unshare -rn)  -- run steps get NO network. Only
     package installs get network. Auto-probed at startup; if the host blocks
     user namespaces (Docker's default seccomp profile often does), this layer
     is simply off and /sandboxes reports it honestly.
  3. rlimits via /bin/sh ulimit -- CPU time, address space (where the runtime
     tolerates it), file size, open files, process count.
  4. Wall-clock timeout + output cap -- the whole process group is SIGKILLed.

What this is not: a hardened multi-tenant boundary like gVisor/Firecracker.
See README.md "Security model".
"""
import math
import os
import platform
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time

IS_WINDOWS = platform.system() == "Windows"
ANON_UID = 19999
UID_BASE = 20000


# ---------------------------------------------------------------- capability probes

_probe_lock = threading.Lock()
_probe_cache = {}


def can_drop_privileges():
    """True when we are root and setpriv exists, so children can run as another uid."""
    if "drop" not in _probe_cache:
        _probe_cache["drop"] = (
            not IS_WINDOWS
            and os.environ.get("DRACOSKILL_UID_DROP", "1") != "0"
            and hasattr(os, "geteuid")
            and os.geteuid() == 0
            and shutil.which("setpriv") is not None
        )
    return _probe_cache["drop"]


def sandbox_uid(user_id=None):
    if not can_drop_privileges():
        return None
    return ANON_UID if user_id is None else UID_BASE + int(user_id)


def network_isolation_available():
    """Probe once: can an unprivileged child enter a fresh network namespace?"""
    with _probe_lock:
        if "net" not in _probe_cache:
            ok = False
            if not IS_WINDOWS and shutil.which("unshare"):
                cmd = _wrap_identity(["unshare", "-rn", "true"], ANON_UID if can_drop_privileges() else None)
                try:
                    ok = subprocess.run(cmd, capture_output=True, timeout=5).returncode == 0
                except Exception:
                    ok = False
            _probe_cache["net"] = ok
        return _probe_cache["net"]


def _wrap_identity(argv, uid):
    if uid is None or not can_drop_privileges():
        return argv
    return ["setpriv", f"--reuid={uid}", f"--regid={uid}", "--clear-groups", "--no-new-privs"] + argv


# ---------------------------------------------------------------- environment

def base_env(home, tmp, extra=None):
    """A scrubbed environment. The server's own environment (DB path, base URL,
    anything a deploy platform injects) is deliberately NOT inherited."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": home,
        "TMPDIR": tmp,
        "LANG": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "TERM": "dumb",
    }
    if extra:
        env.update(extra)
    return env


# ---------------------------------------------------------------- process runner

def run_process(argv, cwd, env, stdin_data="", timeout=5.0, mem_mb=None,
                network=False, uid=None, max_chars=20_000):
    """Run argv with limits. Returns a dict: stdout, stderr, exitCode, timeMs,
    timedOut, truncated. Never raises for ordinary failures of the child."""
    started = time.time()
    max_bytes = max_chars * 4

    if IS_WINDOWS:
        cmd = argv  # no ulimit / setpriv / unshare on Windows -- disclosed gap
    else:
        limits = []
        if mem_mb:
            limits.append(f"ulimit -v {int(mem_mb) * 1024}")
        limits += [
            "ulimit -c 0",
            f"ulimit -t {int(math.ceil(timeout)) + 3}",
            "ulimit -f 131072",
            "ulimit -n 512",
            "ulimit -u 1024 2>/dev/null",
        ]
        inner = argv
        if not network and network_isolation_available():
            inner = ["unshare", "-rn", "--"] + argv
        shell = "; ".join(limits) + "; exec " + " ".join(shlex.quote(p) for p in inner)
        cmd = _wrap_identity(["/bin/sh", "-c", shell], uid)

    try:
        proc = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=not IS_WINDOWS,
        )
    except OSError as e:
        return {"stdout": "", "stderr": f"Sandbox could not start the process: {e}", "exitCode": None,
                "timeMs": 0, "timedOut": False, "truncated": False, "failedToStart": True}

    overflow = threading.Event()
    bufs = {"out": bytearray(), "err": bytearray()}

    def pump(stream, key):
        fd = stream.fileno()
        while True:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            if len(bufs[key]) < max_bytes:
                bufs[key].extend(chunk[: max_bytes - len(bufs[key])])
            else:
                overflow.set()

    def feed():
        try:
            if stdin_data:
                proc.stdin.write(stdin_data.encode("utf-8", "replace"))
            proc.stdin.close()
        except (BrokenPipeError, OSError, ValueError):
            pass

    threads = [threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True),
               threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True),
               threading.Thread(target=feed, daemon=True)]
    for t in threads:
        t.start()

    timed_out = False
    deadline = started + timeout
    while proc.poll() is None:
        if overflow.is_set() or time.time() > deadline:
            timed_out = not overflow.is_set()
            _kill_group(proc)
            break
        time.sleep(0.01)
    proc.wait()
    for t in threads[:2]:
        t.join(timeout=2)

    out = bytes(bufs["out"]).decode("utf-8", "replace")
    err = bytes(bufs["err"]).decode("utf-8", "replace")
    truncated = overflow.is_set() or len(out) > max_chars or len(err) > max_chars
    if timed_out:
        err = (err[:max_chars] + "\n" if err else "") + f"Execution timed out after {timeout:g}s"
    return {
        "stdout": out[:max_chars], "stderr": err[:max_chars] if not timed_out else err,
        "exitCode": None if timed_out else proc.returncode,
        "timeMs": round((time.time() - started) * 1000),
        "timedOut": timed_out, "truncated": truncated,
    }


def _kill_group(proc):
    if IS_WINDOWS:
        proc.kill()
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except Exception:
            pass


# ---------------------------------------------------------------- the six sandboxes

SANDBOXES = {
    "python":     {"label": "Python",     "exts": [".py"],                    "tools": lambda: [sys.executable],       "version_cmd": lambda: [sys.executable, "--version"]},
    "javascript": {"label": "JavaScript", "exts": [".js", ".mjs", ".cjs"],    "tools": lambda: ["node"],               "version_cmd": lambda: ["node", "--version"]},
    "java":       {"label": "Java",       "exts": [".java"],                  "tools": lambda: ["javac", "java"],      "version_cmd": lambda: ["javac", "-version"]},
    "c":          {"label": "C",          "exts": [".c"],                     "tools": lambda: ["gcc"],                "version_cmd": lambda: ["gcc", "--version"]},
    "cpp":        {"label": "C++",        "exts": [".cpp", ".cc", ".cxx"],    "tools": lambda: ["g++"],                "version_cmd": lambda: ["g++", "--version"]},
    "terminal":   {"label": "Terminal",   "exts": [],                         "tools": lambda: [sys.executable, "npm"], "version_cmd": lambda: ["npm", "--version"]},
}
RUN_LANGUAGES = ("python", "javascript", "java", "c", "cpp")


def language_from_filename(name):
    low = name.lower()
    for lang in RUN_LANGUAGES:
        if any(low.endswith(e) for e in SANDBOXES[lang]["exts"]):
            return lang
    return None


def tool_available(tool):
    return tool == sys.executable or shutil.which(tool) is not None


def sandbox_available(lang):
    return all(tool_available(t) for t in SANDBOXES[lang]["tools"]())


def _version(lang):
    if "ver_" + lang in _probe_cache:
        return _probe_cache["ver_" + lang]
    v = None
    try:
        r = subprocess.run(SANDBOXES[lang]["version_cmd"](), capture_output=True, text=True, timeout=8)
        v = ((r.stdout or r.stderr).strip().splitlines() or [None])[0]
    except Exception:
        v = None
    _probe_cache["ver_" + lang] = v
    return v


def describe_sandboxes():
    uid_drop = can_drop_privileges()
    net = network_isolation_available()
    out = []
    for key, s in SANDBOXES.items():
        ok = sandbox_available(key)
        out.append({
            "id": key, "label": s["label"], "available": ok,
            "version": _version(key) if ok else None,
            "extensions": s["exts"],
            "network": "installs only" if key == "terminal" else ("blocked" if net else "not blocked on this host"),
        })
    return {
        "sandboxes": out,
        "isolation": {
            "perUserUid": uid_drop,
            "networkNamespace": net,
            "driver": "process",
            "note": "Process-level isolation. Run behind the provided Dockerfile; see README 'Security model'.",
        },
    }
