"""
DracoSkill — the in-browser terminal.

Not a raw shell. Each submitted line is parsed with shlex (no shell, so no
pipes, redirects, `;`, `&&`, backticks or $() -- except one `>`/`>>` on echo)
and dispatched to a fixed set of commands. That keeps the attack surface to
the commands listed in `help`; the actual confinement of the processes those
commands start is sandbox.py (per-user uid, no network, rlimits, timeout).

The browser keeps the working directory and sends it with each command; the
server re-validates it against the project's src/ every time.
"""
import os
import shlex

import projects
import runner
import sandbox
from packages import Installer, list_node, list_python
from sandbox import run_process, base_env, language_from_filename
from workspace import Workspace, valid_filename

CMD_TIMEOUT = float(os.environ.get("DRACOSKILL_TERMINAL_TIMEOUT", 30))
MAX_CAT = 100_000

HELP = """DracoSkill terminal  --  a managed shell running on the server, not on your computer.

Packages (installed in the cloud sandbox, never locally)
  pip install <pkg>[==ver] ...     Python packages from PyPI      (pip uninstall, pip list)
  npm install <pkg> ...            Node packages from npm         (npm uninstall, npm list)
  jar add group:artifact:version   Java library from Maven Central   (jar list, jar remove)
  clib add github:owner/repo       Header-only C/C++ library          (clib add <url.h>, clib list)
  libs                             Everything installed, per scope

  Scope: installs go to the open PROJECT by default. Add --account to make a
  library available to ALL your projects.   e.g.  pip install --account requests

Running code
  run [file]                       Run the project (same as the Run button)
  python file.py   node file.js    javac A.java / java A    gcc / g++ file -o out, then ./out
  Installed libraries are on the path automatically.

Files (project files are saved to your account)
  ls  cd  pwd  cat  mkdir  touch  rm [-r]  mv  cp  echo text > file

Other:  sandboxes  whoami  clear  help

Limits: header-only C/C++ libs; jar has no transitive resolution; npm install
scripts are disabled; commands time out after %ds.""" % int(CMD_TIMEOUT)


class Ctx:
    def __init__(self, user, project_id):
        self.user = user
        self.project_id = project_id
        self.ws = Workspace(user["id"], project_id)

    def sync(self):
        if self.project_id is None:
            return None
        res, status = projects.get_project(self.project_id, self.user["id"])
        if status != 200 or not res.get("owner"):
            return "Project not found."
        skipped = self.ws.materialize([(f["filename"], f["content"]) for f in res["files"]])
        return None if not skipped else "Note: skipped files with unsafe names: " + ", ".join(skipped)


def handle(user, project_id, line, cwd):
    """Returns a dict: output, exitCode, cwd, clear."""
    line = (line or "").strip()
    cwd = (cwd or "").strip("/")
    if not line:
        return {"output": "", "exitCode": 0, "cwd": cwd, "clear": False}
    if len(line) > 2000:
        return _res("command too long", 1, cwd)
    try:
        ctx = Ctx(user, project_id)
    except Exception as e:
        return _res(f"Could not open your workspace: {e}", 1, cwd)
    note = ctx.sync()
    if note == "Project not found.":
        return _res(note, 1, cwd)

    # a cwd that no longer exists (e.g. deleted file) falls back to the root
    if not _dir_ok(ctx, cwd):
        cwd = ""

    try:
        argv = shlex.split(line)
    except ValueError as e:
        return _res(f"parse error: {e}", 2, cwd)
    if not argv:
        return _res("", 0, cwd)

    cmd, args = argv[0], argv[1:]
    try:
        if cmd.startswith("./"):
            out, code, new_cwd = c_run_binary(ctx, cmd, args, cwd)
            return {"output": out, "exitCode": code, "cwd": new_cwd, "clear": False}
        fn = COMMANDS.get(cmd)
        if fn is None:
            return _res(f"{cmd}: command not found. Type 'help'. (This is a managed terminal, not a full shell.)", 127, cwd)
        out, code, new_cwd = fn(ctx, args, cwd)
    except Exception as e:  # never leak a traceback with server paths
        return _res(f"{cmd}: internal error ({type(e).__name__})", 1, cwd)
    if note:
        out = note + "\n" + out
    return {"output": out, "exitCode": code, "cwd": new_cwd, "clear": cmd == "clear"}


def _res(out, code, cwd):
    return {"output": out, "exitCode": code, "cwd": cwd, "clear": False}


# ---------------------------------------------------------------- path helpers

def _abs(ctx, cwd, rel):
    p = os.path.normpath(os.path.join(ctx.ws.src, cwd, rel))
    return p


def _within(ctx, path):
    return ctx.ws.contains(path)


def _rel_to_src(ctx, abspath):
    return os.path.relpath(abspath, ctx.ws.src).replace(os.sep, "/")


def _dir_ok(ctx, cwd):
    p = _abs(ctx, cwd, "")
    return _within(ctx, p) and os.path.isdir(p)


def _db_name(ctx, abspath):
    return _rel_to_src(ctx, abspath)


# ---------------------------------------------------------------- file commands

def c_pwd(ctx, args, cwd):
    return "/" + cwd if cwd else "/", 0, cwd


def c_cd(ctx, args, cwd):
    target = args[0] if args else ""
    if target in ("", "~", "/"):
        return "", 0, ""
    # a leading "/" means the project root, not the server's filesystem root
    p = _abs(ctx, "" if target.startswith("/") else cwd, target.lstrip("/"))
    if not _within(ctx, p) or not os.path.isdir(p):
        return f"cd: {target}: no such directory", 1, cwd
    rel = _rel_to_src(ctx, p)
    return "", 0, "" if rel == "." else rel


def c_ls(ctx, args, cwd):
    flags = [a for a in args if a.startswith("-")]
    paths = [a for a in args if not a.startswith("-")] or ["."]
    out = []
    for t in paths:
        p = _abs(ctx, cwd, t)
        if not _within(ctx, p) or not os.path.exists(p):
            return f"ls: {t}: no such file or directory", 1, cwd
        if os.path.isfile(p):
            out.append(t)
            continue
        names = sorted(os.listdir(p))
        if not any("a" in f for f in flags):
            names = [n for n in names if not n.startswith(".")]
        rows = []
        for n in names:
            full = os.path.join(p, n)
            if "l" in "".join(flags):
                size = os.path.getsize(full) if os.path.isfile(full) else 0
                rows.append(f"{'d' if os.path.isdir(full) else '-'} {size:>9}  {n}{'/' if os.path.isdir(full) else ''}")
            else:
                rows.append(n + ("/" if os.path.isdir(full) else ""))
        out.append(("\n" if "l" in "".join(flags) else "  ").join(rows))
    return "\n".join(out), 0, cwd


def c_cat(ctx, args, cwd):
    if not args:
        return "usage: cat <file>", 1, cwd
    outs = []
    for t in args:
        p = _abs(ctx, cwd, t)
        if not _within(ctx, p) or not os.path.isfile(p):
            return f"cat: {t}: no such file", 1, cwd
        with open(p, "rb") as f:
            data = f.read(MAX_CAT + 1)
        if b"\x00" in data[:4096]:
            outs.append(f"cat: {t}: binary file")
            continue
        text = data[:MAX_CAT].decode("utf-8", "replace")
        outs.append(text + ("\n... (truncated)" if len(data) > MAX_CAT else ""))
    return "\n".join(outs), 0, cwd


def _need_project(ctx, cmd):
    if ctx.project_id is None:
        return f"{cmd}: open a project first (this command edits project files).", 1
    return None


def c_mkdir(ctx, args, cwd):
    if not args:
        return "usage: mkdir <dir>", 1, cwd
    for t in args:
        if t.startswith("-"):
            continue
        p = _abs(ctx, cwd, t)
        if not _within(ctx, p) or not valid_filename(_db_name(ctx, p)):
            return f"mkdir: invalid name: {t}", 1, cwd
        os.makedirs(p, exist_ok=True)
        from workspace import chown_tree
        chown_tree(p, ctx.ws.uid)
    return "(empty folders aren't saved until they contain a file)", 0, cwd


def c_touch(ctx, args, cwd):
    err = _need_project(ctx, "touch")
    if err:
        return err[0], err[1], cwd
    for t in args:
        name = _db_name(ctx, _abs(ctx, cwd, t))
        if not valid_filename(name):
            return f"touch: invalid file name: {t}", 1, cwd
        res, status = projects.create_file(ctx.project_id, ctx.user["id"], name, "")
        if status not in (200, 409):
            return f"touch: {res.get('error')}", 1, cwd
    return "", 0, cwd


def c_rm(ctx, args, cwd):
    err = _need_project(ctx, "rm")
    if err:
        return err[0], err[1], cwd
    recursive = any(a in ("-r", "-rf", "-R", "-fr") for a in args)
    targets = [a for a in args if not a.startswith("-")]
    if not targets:
        return "usage: rm [-r] <file>", 1, cwd
    for t in targets:
        p = _abs(ctx, cwd, t)
        if not _within(ctx, p) or not os.path.exists(p):
            return f"rm: {t}: no such file or directory", 1, cwd
        name = _db_name(ctx, p)
        if os.path.isdir(p):
            if not recursive:
                return f"rm: {t}: is a directory (use -r)", 1, cwd
            res, _ = projects.get_project(ctx.project_id, ctx.user["id"])
            for f in res.get("files", []):
                if f["filename"].startswith(name + "/"):
                    projects.delete_file(ctx.project_id, ctx.user["id"], f["filename"])
            import shutil
            shutil.rmtree(p, ignore_errors=True)
        else:
            res, status = projects.delete_file(ctx.project_id, ctx.user["id"], name)
            if status == 404:  # a generated file that was never in the DB (a.out, out.txt)
                os.unlink(p)
            elif status != 200:
                return f"rm: {res.get('error')}", 1, cwd
            elif os.path.exists(p):
                os.unlink(p)
    return "", 0, cwd


def _copy_move(ctx, args, cwd, move):
    name = "mv" if move else "cp"
    err = _need_project(ctx, name)
    if err:
        return err[0], err[1], cwd
    args = [a for a in args if not a.startswith("-")]
    if len(args) != 2:
        return f"usage: {name} <source> <destination>", 1, cwd
    src, dst = _abs(ctx, cwd, args[0]), _abs(ctx, cwd, args[1])
    if os.path.isdir(dst):
        dst = os.path.join(dst, os.path.basename(src))
    if not _within(ctx, src) or not os.path.isfile(src):
        return f"{name}: {args[0]}: no such file (only files can be copied/moved)", 1, cwd
    if not _within(ctx, dst):
        return f"{name}: invalid destination", 1, cwd
    dname = _db_name(ctx, dst)
    if not valid_filename(dname):
        return f"{name}: invalid destination name", 1, cwd
    content = open(src, encoding="utf-8", errors="replace").read()
    res, status = projects.create_file(ctx.project_id, ctx.user["id"], dname, content)
    if status == 409:
        res, status = projects.save_file(ctx.project_id, ctx.user["id"], dname, content)
    if status != 200:
        return f"{name}: {res.get('error')}", 1, cwd
    if move:
        projects.delete_file(ctx.project_id, ctx.user["id"], _db_name(ctx, src))
        if os.path.exists(src):
            os.unlink(src)
    return "", 0, cwd


def c_cp(ctx, args, cwd):
    return _copy_move(ctx, args, cwd, False)


def c_mv(ctx, args, cwd):
    return _copy_move(ctx, args, cwd, True)


def c_echo(ctx, args, cwd):
    if len(args) >= 2 and args[-2] in (">", ">>"):
        err = _need_project(ctx, "echo")
        if err:
            return err[0], err[1], cwd
        append = args[-2] == ">>"
        text = " ".join(args[:-2]) + "\n"
        p = _abs(ctx, cwd, args[-1])
        name = _db_name(ctx, p)
        if not _within(ctx, p) or not valid_filename(name):
            return f"echo: invalid file name: {args[-1]}", 1, cwd
        existing = open(p, encoding="utf-8", errors="replace").read() if os.path.isfile(p) else None
        content = (existing or "") + text if append else text
        if existing is None:
            res, status = projects.create_file(ctx.project_id, ctx.user["id"], name, content)
        else:
            res, status = projects.save_file(ctx.project_id, ctx.user["id"], name, content)
        return ("" if status == 200 else f"echo: {res.get('error')}"), (0 if status == 200 else 1), cwd
    return " ".join(args), 0, cwd


# ---------------------------------------------------------------- packages

def _split_scope(ctx, args):
    scope = "project" if ctx.project_id is not None else "account"
    rest = []
    for a in args:
        if a in ("--account", "-g", "--global"):
            scope = "account"
        elif a == "--project":
            if ctx.project_id is None:
                return None, None, "--project needs an open project."
            scope = "project"
        else:
            rest.append(a)
    return scope, rest, None


def _installer_cmd(tool):
    def fn(ctx, args, cwd):
        scope, rest, err = _split_scope(ctx, args)
        if err:
            return err, 1, cwd
        out, code = Installer(ctx.ws).run(tool, rest, scope)
        header = f"[{scope} scope] "
        return (header + out) if out else header + "done", code, cwd
    return fn


def c_libs(ctx, args, cwd):
    lines = []
    for scope in ctx.ws.all_scopes():
        lines.append(f"== {scope} scope ==")
        py = list_python(ctx.ws.lib_dir(scope, "python"))
        node = list_node(ctx.ws.scope_root(scope))
        jars = sorted(f for f in os.listdir(ctx.ws.lib_dir(scope, "java")) if f.endswith(".jar")) if os.path.isdir(ctx.ws.lib_dir(scope, "java")) else []
        cdir = ctx.ws.lib_dir(scope, "c")
        clibs = sorted(os.listdir(cdir)) if os.path.isdir(cdir) else []
        lines.append("  python: " + (", ".join(py) or "-"))
        lines.append("  node:   " + (", ".join(node.splitlines()) or "-"))
        lines.append("  java:   " + (", ".join(jars) or "-"))
        lines.append("  c/c++:  " + (", ".join(clibs) or "-"))
    lines.append(f"storage used: {ctx.ws.usage_mb():.1f} MB")
    return "\n".join(lines), 0, cwd


# ---------------------------------------------------------------- running code

def _fmt_run(res):
    if "error" in res:
        return res["error"], 1
    parts = []
    comp = res.get("compile")
    if comp and (comp["stderr"] or comp["stdout"]) and not res.get("compileError"):
        parts.append((comp["stderr"] or comp["stdout"]).rstrip())
    if res.get("stdout"):
        parts.append(res["stdout"].rstrip("\n"))
    if res.get("stderr"):
        parts.append(res["stderr"].rstrip("\n"))
    if res.get("truncated"):
        parts.append("(output truncated)")
    code = res.get("exitCode")
    return "\n".join(p for p in parts if p), (code if isinstance(code, int) else 1)


def c_run(ctx, args, cwd):
    if ctx.project_id is None:
        return "run: open a project first.", 1, cwd
    entry = args[0] if args else None
    if entry:
        entry = _db_name(ctx, _abs(ctx, cwd, entry))
        lang = language_from_filename(entry)
    else:
        langs = {language_from_filename(f) for f in _all_files(ctx)} - {None}
        lang = next(iter(langs)) if len(langs) == 1 else None
    if not lang:
        return "run: say which file to run, e.g. 'run main.py' (supported: .py .js .java .c .cpp).", 1, cwd
    res, status = runner.execute(ctx.ws, lang, entry=entry)
    out, code = _fmt_run(res)
    return out, code, cwd


def _all_files(ctx):
    out = []
    for root, dirs, files in os.walk(ctx.ws.src):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "build")]
        out += [os.path.relpath(os.path.join(root, f), ctx.ws.src) for f in files]
    return out


def _check_args(args):
    skip_next = False
    for a in args:
        if skip_next:
            skip_next = False
            continue
        if a in ("-c", "-e", "-p", "-cp", "-classpath", "--class-path", "--eval", "--print"):
            skip_next = True
            continue
        if a.startswith("@"):
            return "response files (@file) aren't allowed"
        if a.startswith("-"):
            val = a[2:] if (len(a) > 2 and a[1] in "IoL") else ""
            if val and (val.startswith("/") or ".." in val.split("/")):
                return f"path not allowed: {val}"
            continue
        if a.startswith("/") or ".." in a.split("/"):
            return f"path not allowed: {a} (stay inside the project)"
    return None


def _passthrough(binary, kind):
    def fn(ctx, args, cwd):
        bad = _check_args(args)
        if bad:
            return f"{binary}: {bad}", 1, cwd
        if binary in ("python", "python3") and len(args) >= 2 and args[0] == "-m" and args[1] in ("pip", "ensurepip", "venv"):
            return "Use 'pip install <pkg>' -- it installs into your cloud workspace.", 1, cwd
        tool = sandbox.sys.executable if binary in ("python", "python3") else binary
        if not sandbox.tool_available(tool):
            return f"{binary}: not available on this server.", 127, cwd
        ws = ctx.ws
        workdir = _abs(ctx, cwd, "")
        argv = [tool] + list(args)
        if kind == "native":
            for d in [ws.src] + ws.c_include_dirs():
                argv += ["-I", d]
        if kind == "jvm" and not any(a in ("-cp", "-classpath", "--class-path") for a in args):
            argv = [tool] + (runner.JAVA_HEAP if binary == "java" else []) + ["-cp", os.pathsep.join(["."] + ws.jars())] + list(args)
        elif kind == "jvm" and binary == "java":
            argv = [tool] + runner.JAVA_HEAP + list(args)
        env = base_env(ws.home, ws.tmp, ws.run_env_extra())
        mem = None if kind == "jvm" else 2048
        r = run_process(argv, cwd=workdir, env=env, timeout=CMD_TIMEOUT, mem_mb=mem, network=False, uid=ws.uid)
        out = "\n".join(p.rstrip("\n") for p in (r["stdout"], r["stderr"]) if p)
        code = r["exitCode"] if isinstance(r["exitCode"], int) else 124
        return out, code, cwd
    return fn


def c_run_binary(ctx, path, args, cwd):
    p = _abs(ctx, cwd, path)
    if not _within(ctx, p) or not os.path.isfile(p) or not os.access(p, os.X_OK):
        return f"{path}: no such executable (compile with 'gcc file.c -o out' first)", 127, cwd
    ws = ctx.ws
    r = run_process([p] + list(args), cwd=_abs(ctx, cwd, ""), env=base_env(ws.home, ws.tmp, ws.run_env_extra()),
                    timeout=CMD_TIMEOUT, mem_mb=1024, network=False, uid=ws.uid)
    out = "\n".join(x.rstrip("\n") for x in (r["stdout"], r["stderr"]) if x)
    return out, (r["exitCode"] if isinstance(r["exitCode"], int) else 124), cwd


def c_sandboxes(ctx, args, cwd):
    d = sandbox.describe_sandboxes()
    rows = [f"{s['label']:<11} {'ready' if s['available'] else 'NOT INSTALLED':<14} {s['version'] or ''}" for s in d["sandboxes"]]
    iso = d["isolation"]
    rows.append(f"\nisolation: per-user uid={'yes' if iso['perUserUid'] else 'no'}, network blocked while running={'yes' if iso['networkNamespace'] else 'no'}")
    return "\n".join(rows), 0, cwd


COMMANDS = {
    "help": lambda c, a, w: (HELP, 0, w),
    "clear": lambda c, a, w: ("", 0, w),
    "whoami": lambda c, a, w: (c.user["username"], 0, w),
    "pwd": c_pwd, "cd": c_cd, "ls": c_ls, "cat": c_cat, "mkdir": c_mkdir, "touch": c_touch,
    "rm": c_rm, "cp": c_cp, "mv": c_mv, "echo": c_echo,
    "pip": _installer_cmd("pip"), "pip3": _installer_cmd("pip"),
    "npm": _installer_cmd("npm"), "jar": _installer_cmd("jar"), "clib": _installer_cmd("clib"),
    "libs": c_libs, "run": c_run, "sandboxes": c_sandboxes,
    "python": _passthrough("python", "interp"), "python3": _passthrough("python3", "interp"),
    "node": _passthrough("node", "interp"),
    "javac": _passthrough("javac", "jvm"), "java": _passthrough("java", "jvm"),
    "gcc": _passthrough("gcc", "native"), "g++": _passthrough("g++", "native"),
    "cc": _passthrough("gcc", "native"), "c++": _passthrough("g++", "native"),
}
