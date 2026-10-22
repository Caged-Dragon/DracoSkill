"""
DracoSkill — HTTP entry point.

Routing only. The actual logic lives in db.py, execution.py, auth.py, and
judge.py -- this file just wires HTTP verbs and paths to those functions.

Endpoints added for the sandboxes: GET /sandboxes, POST /projects/{id}/run, POST /terminal.

Run:
    python3 server.py
    # POST http://localhost:8787/execute  {"language": "python", "code": "print(2 + 2)"}
"""
import http.server
import json
import os
import re
import threading
import time
from urllib.parse import urlparse, parse_qs

from db import init_db, get_db, DB_PATH
from execution import run_code, run_project
from sandbox import describe_sandboxes
from workspace import init_data_dir, ensure_traversable, find_world_writable_source
import terminal
from auth import handle_register, handle_login, handle_logout, get_user_from_token
from judge import PROBLEMS, judge_submission, save_submission
from projects import (
    create_project, list_projects, get_project, rename_project, set_visibility,
    delete_project, duplicate_project, create_file, save_file, delete_file, get_file_history,
)
from certificates import get_progress, issue_certificate, get_my_certificate, verify_certificate
import confirmation_page

PROJECT_ID_RE = re.compile(r"^/projects/(\d+)$")
PROJECT_FILES_RE = re.compile(r"^/projects/(\d+)/files$")
PROJECT_HISTORY_RE = re.compile(r"^/projects/(\d+)/history$")
PROJECT_RUN_RE = re.compile(r"^/projects/(\d+)/run$")
MAX_BODY = 2 * 1024 * 1024

# Tiny in-memory rate limiter: protects the execution engine from being hammered.
_hits = {}
_hits_lock = threading.Lock()


def rate_limited(key, limit, window=60):
    now = time.time()
    with _hits_lock:
        recent = [t for t in _hits.get(key, []) if now - t < window]
        if len(recent) >= limit:
            _hits[key] = recent
            return True
        recent.append(now)
        _hits[key] = recent
        if len(_hits) > 5000:
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
                _hits.pop(k, None)
        return False
CERTIFICATE_VERIFY_RE = re.compile(r"^/certificates/([A-Za-z0-9-]+)$")
CONFIRMATION_PAGE_RE = re.compile(r"^/confirmation/([A-Za-z0-9-]+)/?$")


class ExecutionHandler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html, status=200):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length > MAX_BODY:
            self._send_json({"error": "Request body too large"}, 413)
            return None
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return None

    def _current_user(self):
        return get_user_from_token(self.headers.get("X-Session-Token", ""))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-Token")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self._send_json({"status": "ok", "service": "dracoskill-execution"})
        elif path == "/sandboxes":
            self._send_json(describe_sandboxes())
        elif path == "/problems":
            listing = [
                {"id": p["id"], "title": p["title"], "difficulty": p["difficulty"],
                 "description": p["description"], "starter": p["starter"]}
                for p in PROBLEMS.values()
            ]
            self._send_json({"problems": listing})
        elif path == "/auth/me":
            user = self._current_user()
            self._send_json({"authenticated": bool(user), "username": user["username"] if user else None})
        elif path == "/submissions":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            conn = get_db()
            rows = conn.execute(
                "SELECT problem_id, language, verdict, submitted_at FROM submissions "
                "WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 20",
                (user["id"],),
            ).fetchall()
            conn.close()
            self._send_json({"submissions": [dict(r) for r in rows]})
        elif path == "/projects":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            result, status = list_projects(user["id"])
            self._send_json(result, status)
        elif path == "/certificates/progress":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            result, status = get_progress(user["id"])
            self._send_json(result, status)
        elif path == "/certificates/mine":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            result, status = get_my_certificate(user["id"], user["username"])
            self._send_json(result, status)
        elif CONFIRMATION_PAGE_RE.match(path):
            code = CONFIRMATION_PAGE_RE.match(path).group(1)
            result, status = verify_certificate(code)  # same lookup as the JSON route -- one source of truth
            self._send_html(confirmation_page.render(result if status == 200 else None), status)
        elif CERTIFICATE_VERIFY_RE.match(path):
            code = CERTIFICATE_VERIFY_RE.match(path).group(1)
            result, status = verify_certificate(code)  # public -- no auth, that's the point of verification
            self._send_json(result, status)
        elif PROJECT_HISTORY_RE.match(path):
            project_id = int(PROJECT_HISTORY_RE.match(path).group(1))
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            filename = parse_qs(parsed.query).get("filename", [""])[0]
            if not filename:
                self._send_json({"error": "filename query parameter is required"}, 400)
                return
            result, status = get_file_history(project_id, user["id"], filename)
            self._send_json(result, status)
        elif PROJECT_ID_RE.match(path):
            project_id = int(PROJECT_ID_RE.match(path).group(1))
            user = self._current_user()
            result, status = get_project(project_id, user["id"] if user else -1)
            self._send_json(result, status)
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/auth/register":
            body = self._read_json_body()
            if body is None:
                return
            result, status = handle_register(body)
            self._send_json(result, status)
            return

        if path == "/auth/login":
            body = self._read_json_body()
            if body is None:
                return
            result, status = handle_login(body)
            self._send_json(result, status)
            return

        if path == "/auth/logout":
            result, status = handle_logout(self.headers.get("X-Session-Token", ""))
            self._send_json(result, status)
            return

        if path == "/certificates/issue":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            result, status = issue_certificate(user["id"], user["username"])
            self._send_json(result, status)
            return

        if path == "/terminal":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Log in to use the terminal"}, 401)
                return
            if rate_limited(("term", user["id"]), 120):
                self._send_json({"error": "Too many commands. Slow down a little."}, 429)
                return
            body = self._read_json_body()
            if body is None:
                return
            pid = body.get("projectId")
            pid = int(pid) if isinstance(pid, (int, str)) and str(pid).isdigit() else None
            if pid is not None:
                _, st = get_project(pid, user["id"])
                if st != 200:
                    self._send_json({"error": "Project not found"}, 404)
                    return
            self._send_json(terminal.handle(user, pid, body.get("command", ""), body.get("cwd", "")))
            return

        run_match = PROJECT_RUN_RE.match(path)
        if run_match:
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            if rate_limited(("run", user["id"]), 60):
                self._send_json({"error": "Too many runs. Slow down a little."}, 429)
                return
            body = self._read_json_body()
            if body is None:
                return
            result, status = run_project(user["id"], int(run_match.group(1)), body.get("entry") or None, body.get("stdin", ""))
            self._send_json(result, status)
            return

        if path == "/projects":
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            body = self._read_json_body()
            if body is None:
                return
            result, status = create_project(user["id"], body.get("name", ""))
            self._send_json(result, status)
            return

        files_match = PROJECT_FILES_RE.match(path)
        if files_match:
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            body = self._read_json_body()
            if body is None:
                return
            project_id = int(files_match.group(1))
            action = body.get("action", "")
            filename = body.get("filename", "")
            if action == "create":
                result, status = create_file(project_id, user["id"], filename, body.get("content", ""))
            elif action == "save":
                result, status = save_file(project_id, user["id"], filename, body.get("content", ""))
            elif action == "delete":
                result, status = delete_file(project_id, user["id"], filename)
            else:
                result, status = {"error": "action must be 'create', 'save', or 'delete'"}, 400
            self._send_json(result, status)
            return

        project_match = PROJECT_ID_RE.match(path)
        if project_match:
            user = self._current_user()
            if not user:
                self._send_json({"error": "Not logged in"}, 401)
                return
            body = self._read_json_body()
            if body is None:
                return
            project_id = int(project_match.group(1))
            action = body.get("action", "")
            if action == "rename":
                result, status = rename_project(project_id, user["id"], body.get("name", ""))
            elif action == "visibility":
                result, status = set_visibility(project_id, user["id"], body.get("visibility", ""))
            elif action == "duplicate":
                result, status = duplicate_project(project_id, user["id"], body.get("name"))
            elif action == "delete":
                result, status = delete_project(project_id, user["id"])
            else:
                result, status = {"error": "action must be 'rename', 'visibility', 'duplicate', or 'delete'"}, 400
            self._send_json(result, status)
            return

        if path not in ("/execute", "/submit"):
            self._send_json({"error": "Not found"}, 404)
            return

        body = self._read_json_body()
        if body is None:
            return
        code = body.get("code", "")
        if not code.strip():
            self._send_json({"error": "No code submitted"}, 400)
            return

        user_for_rl = self._current_user()
        rl_key = ("run", user_for_rl["id"]) if user_for_rl else ("anon", self.client_address[0])
        if rate_limited(rl_key, 60 if user_for_rl else 20):
            self._send_json({"error": "Too many runs. Slow down a little."}, 429)
            return

        if path == "/execute":
            result, status = run_code(body.get("language", ""), code, body.get("stdin", ""))
        else:
            problem_id = body.get("problemId", "")
            language = body.get("language", "")
            result, status = judge_submission(problem_id, language, code)
            if status == 200:
                user = self._current_user()
                if user:
                    save_submission(user["id"], problem_id, language, code, result.get("verdict", ""))
                    result["saved"] = True
                else:
                    result["saved"] = False
        self._send_json(result, status)

    def log_message(self, fmt, *args):
        print(f"[execution-service] {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    os.umask(0o077)  # new files (db, workspaces) are owner-only; sandbox uids can't read them
    init_db()
    init_data_dir()
    blocked = ensure_traversable()
    if blocked:
        print(f"WARNING: sandboxed code runs as an unprivileged uid but '{blocked}' is not world-traversable, "
              f"so every run will fail with 'Permission denied'. Fix: chmod o+x {blocked} "
              f"(or point DRACOSKILL_DATA_DIR somewhere under a traversable path such as /var/data).")
    writable = find_world_writable_source()
    if writable:
        print(f"WARNING: {len(writable)} server file(s)/dir(s) are world-writable (e.g. {writable[0]}). "
              f"Sandboxed code could modify the server. Fix: chmod -R go-w {os.path.dirname(os.path.abspath(__file__))}")
    port = int(os.environ.get("PORT", 8787))
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), ExecutionHandler)
    print(f"DracoSkill execution service listening on :{port}")
    print(f"Data stored in {DB_PATH}")
    server.serve_forever()
