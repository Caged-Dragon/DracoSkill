"""
DracoSkill — compile-and-run for all five languages.

execute() takes a Workspace whose src/ already holds the project's files and
runs the whole project: Python/JavaScript run an entry file; Java compiles
every .java file and runs the class that has main(); C and C++ compile every
source file in the project (all .c / .cpp files) into one binary and run it.

Result shape (stable, backwards compatible with the old /execute):
  stdout/stderr/exitCode/timeMs/timedOut  -> the RUN phase
  compile: {stdout, stderr, exitCode, timeMs} or None for interpreted languages
  compileError: True when compilation failed (then stdout/stderr hold the compiler output)
"""
import os
import re
import threading

import sandbox
from sandbox import run_process, base_env, sandbox_available, RUN_LANGUAGES, SANDBOXES

RUN_TIMEOUT = float(os.environ.get("SF_TIMEOUT", 5))
COMPILE_TIMEOUT = float(os.environ.get("SF_COMPILE_TIMEOUT", 25))
MAX_CONCURRENT_RUNS = int(os.environ.get("DRACOSKILL_MAX_RUNS", 4))
_run_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RUNS)

JAVA_HEAP = ["-Xmx256m", "-Xss1m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1",
             "-XX:CompressedClassSpaceSize=64m", "-XX:ReservedCodeCacheSize=48m", "-XX:MaxMetaspaceSize=128m"]

_C_MAIN = re.compile(r"\b(int|void)\s+main\s*\(")
_JAVA_MAIN = re.compile(r"static\s+void\s+main\s*\(")
_DEFAULT_ENTRIES = {
    "python": ["main.py", "app.py", "__main__.py"],
    "javascript": ["index.js", "main.js", "app.js", "server.js"],
}


class RunError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _list_sources(ws, exts):
    out = []
    for root, dirs, files in os.walk(ws.src):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "build", ".libs") and not d.startswith(".")]
        for f in files:
            if any(f.lower().endswith(e) for e in exts):
                full = os.path.join(root, f)
                if os.path.islink(full):
                    continue
                out.append(os.path.relpath(full, ws.src))
    return sorted(out)


def _read(ws, rel):
    try:
        with open(os.path.join(ws.src, rel), "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _pick_entry(ws, language, entry):
    exts = SANDBOXES[language]["exts"]
    sources = _list_sources(ws, exts)
    if entry:
        if entry not in sources:
            raise RunError(f"Entry file '{entry}' is not a {SANDBOXES[language]['label']} file in this project.")
        return entry, sources
    if not sources:
        raise RunError(f"No {SANDBOXES[language]['label']} files in this project ({', '.join(exts)}).")
    for d in _DEFAULT_ENTRIES.get(language, []):
        if d in sources:
            return d, sources
    if len(sources) == 1:
        return sources[0], sources
    raise RunError("More than one entry candidate: " + ", ".join(sources) + ". Open the file you want to run and press Run.")


def _compile_result(r):
    return {"stdout": r["stdout"], "stderr": r["stderr"], "exitCode": r["exitCode"], "timeMs": r["timeMs"]}


def _fail_compile(r):
    err = r["stderr"] or r["stdout"] or "Compilation failed."
    if r.get("timedOut"):
        err = "Compilation timed out.\n" + err
    return {"stdout": "", "stderr": err, "exitCode": r["exitCode"] if r["exitCode"] is not None else 1,
            "timeMs": r["timeMs"], "timedOut": False, "truncated": r.get("truncated", False),
            "compile": _compile_result(r), "compileError": True}


def _run_phase(ws, argv, env, stdin, mem_mb, timeout):
    return run_process(argv, cwd=ws.src, env=env, stdin_data=stdin, timeout=timeout, mem_mb=mem_mb,
                       network=False, uid=ws.uid)


def _finish(run, compile_r=None):
    run["compile"] = _compile_result(compile_r) if compile_r else None
    run["compileError"] = False
    return run


def _select_native_sources(ws, language, entry):
    exts = SANDBOXES[language]["exts"]
    sources = _list_sources(ws, exts)
    if not sources:
        raise RunError(f"No {SANDBOXES[language]['label']} files in this project ({', '.join(exts)}).")
    with_main = [s for s in sources if _C_MAIN.search(_read(ws, s))]
    if entry and entry in sources:
        # Several programs in one project: build the chosen entry + every file that has no main().
        return [s for s in sources if s == entry or s not in with_main]
    if len(with_main) > 1:
        raise RunError("Several files define main(): " + ", ".join(with_main) + ". Open the one you want to run and press Run.")
    return sources


def _java_main_class(ws, entry, sources):
    candidates = [s for s in sources if _JAVA_MAIN.search(_read(ws, s))]
    if entry and entry in sources:
        chosen = entry
    elif len(candidates) == 1:
        chosen = candidates[0]
    elif "Main.java" in candidates:
        chosen = "Main.java"
    elif not candidates:
        raise RunError("No Java file has 'public static void main(String[] args)'.")
    else:
        raise RunError("Several files define main(): " + ", ".join(candidates) + ". Open the one you want to run and press Run.")
    text = _read(ws, chosen)
    m = re.search(r"^\s*package\s+([\w.]+)\s*;", text, re.M)
    cls = os.path.splitext(os.path.basename(chosen))[0]
    return (m.group(1) + "." + cls) if m else cls


def execute(ws, language, entry=None, stdin="", timeout=None):
    """Returns (result_dict, http_status)."""
    if language not in RUN_LANGUAGES:
        return {"error": f"Unsupported language: {language}. Supported: {', '.join(RUN_LANGUAGES)}."}, 400
    if not sandbox_available(language):
        tools = ", ".join(SANDBOXES[language]["tools"]())
        return {"error": f"{SANDBOXES[language]['label']} execution isn't available on this server "
                         f"(missing: {tools}). Other languages are unaffected."}, 503

    if not _run_slots.acquire(timeout=15):
        return {"error": "The execution service is busy. Try again in a few seconds."}, 429
    try:
        return _execute_locked(ws, language, entry, stdin, timeout or RUN_TIMEOUT)
    except RunError as e:
        return {"error": str(e)}, e.status
    finally:
        _run_slots.release()


def _execute_locked(ws, language, entry, stdin, timeout):
    env = base_env(ws.home, ws.tmp, ws.run_env_extra())

    if language == "python":
        entry, _ = _pick_entry(ws, language, entry)
        return _finish(_run_phase(ws, [sandbox.sys.executable, entry], env, stdin, 2048, timeout)), 200

    if language == "javascript":
        entry, _ = _pick_entry(ws, language, entry)
        return _finish(_run_phase(ws, ["node", entry], env, stdin, 3072, timeout)), 200

    if language == "java":
        sources = _list_sources(ws, [".java"])
        if not sources:
            raise RunError("No Java files in this project (.java).")
        main_cls = _java_main_class(ws, entry, sources)
        _reset_dir(ws, ws.build)
        cp = os.pathsep.join(ws.jars()) or ""
        cmd = ["javac", "-nowarn", "-encoding", "UTF-8", "-J-Xmx256m", "-J-XX:+UseSerialGC", "-d", ws.build]
        if cp:
            cmd += ["-cp", cp]
        cmd += sources
        c = run_process(cmd, ws.src, env, timeout=COMPILE_TIMEOUT, mem_mb=None, network=False, uid=ws.uid, max_chars=20_000)
        if c["exitCode"] != 0:
            return _fail_compile(c), 200
        run_cp = os.pathsep.join([ws.build] + ws.jars())
        r = _run_phase(ws, ["java"] + JAVA_HEAP + ["-cp", run_cp, main_cls], env, stdin, None, timeout)
        return _finish(r, c), 200

    # c / cpp
    sources = _select_native_sources(ws, language, entry)
    _reset_dir(ws, ws.build)
    binary = os.path.join(ws.build, "app")
    includes = ["-I", ws.src]
    for d in ws.c_include_dirs():
        includes += ["-I", d]
    if language == "c":
        cmd = ["gcc", "-std=gnu17", "-O1", "-Wall", "-pipe", "-o", binary] + sources + includes + ["-lm", "-lpthread"]
    else:
        cmd = ["g++", "-std=gnu++17", "-O1", "-Wall", "-pipe", "-o", binary] + sources + includes + ["-lm", "-lpthread"]
    c = run_process(cmd, ws.src, env, timeout=COMPILE_TIMEOUT, mem_mb=2048, network=False, uid=ws.uid)
    if c["exitCode"] != 0:
        return _fail_compile(c), 200
    r = _run_phase(ws, [binary], env, stdin, 1024, timeout)
    return _finish(r, c), 200


def _reset_dir(ws, path):
    import shutil
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path, exist_ok=True)
    from workspace import chown_tree
    chown_tree(path, ws.uid)
