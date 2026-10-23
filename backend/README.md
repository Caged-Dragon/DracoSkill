> **Location:** this is the OPTIONAL full Python backend. It lives in `backend/python-server/` and is NOT used by the Vercel backend project (see `backend/README.md`). Run it here with `python3 server.py`, or deploy it on Render using `render.yaml` in this folder.

# DracoSkill backend

One module per concern. See the sections below for the sandboxes and the
terminal added in Version 4/5.

```
backend/
├── server.py      # HTTP routing only — entry point, run this one
├── db.py           # SQLite connection + schema
├── auth.py          # password hashing, sessions, register/login/logout
├── execution.py       # the real code-execution engine
├── judge.py             # problem set + judging, imports execution.run_code()
└── projects.py             # multi-file project persistence, imports db.get_db()
```

Dependency direction is one-way: `server.py` imports from all four;
`judge.py` imports from `db` and `execution`; `auth.py` imports from `db`;
`db.py` and `execution.py` import nothing local. No circular imports.

## Run it

```
python3 server.py        # Windows: python server.py, or py server.py
# DracoSkill execution service listening on :8787
# Data stored in .../backend/dracoskill.db
```

The database file is created automatically on first run, in this same
folder, next to `server.py`.

## Environment variables (all optional — every one has a sane local default)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | What port the server listens on. Set automatically by Render — nothing to do there. |
| `DRACOSKILL_DB_PATH` | `<this folder>/dracoskill.db` | Where the SQLite file lives. Point this at a mounted persistent disk in production, or Render's default ephemeral filesystem wipes it on every redeploy. |
| `DRACOSKILL_DATA_DIR` | `<this folder>/workspaces` | Where users' project folders and installed libraries live. Mount a persistent disk here. |
| `DRACOSKILL_USER_QUOTA_MB` | `1024` | Per-user storage cap; installs are refused over it. |
| `DRACOSKILL_MAX_RUNS` / `DRACOSKILL_MAX_INSTALLS` | `4` / `2` | Concurrent runs / installs server-wide. |
| `SF_TIMEOUT` / `SF_COMPILE_TIMEOUT` | `5` / `25` | Seconds allowed for a run / a compile. |
| `DRACOSKILL_UID_DROP` | `1` | Set `0` to disable per-user uids. |
| `DRACOSKILL_BASE_URL` | `http://localhost:8787` | The domain certificate QR codes and confirmation links point to. Set to your real deployed URL once you have one. |

## What's actually implemented

- `POST /execute` — `{language, code, stdin}` for python, javascript, java,
  c, cpp. Runs one snippet in a throwaway workspace. Returns real stdout,
  stderr, exit code, timing, plus `compile` info and `compileError` for the
  compiled languages.
- `GET /sandboxes` — the six sandboxes, whether each toolchain is actually
  installed on this server, its version, and which isolation layers are active.
- `POST /projects/{id}/run` — `{entry, stdin}` (login required, owner only).
  Runs the whole saved project: Java builds every `.java` file, C/C++ build
  every source file into one binary, Python/JS run the entry file with the
  project's and account's installed libraries on the path.
- `POST /terminal` — `{command, cwd, projectId}` (login required). See below.
- `POST /submit` — runs the submission against every test case for the
  named problem via the same `run_code()` execution path, compares real
  output, and returns a genuine verdict (Accepted / Wrong Answer / Runtime
  Error / Time Limit Exceeded), saving it to the submitter's history if
  they're logged in.
- `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` —
  real accounts. Passwords hashed with salted PBKDF2-HMAC-SHA256 (stdlib,
  200,000 iterations), never stored plain. Sessions are random tokens in
  a SQLite table, sent as an `X-Session-Token` header rather than a cookie.
- `GET /submissions` — a logged-in user's real submission history, most
  recent first.
- `GET /projects`, `POST /projects` — list or create the logged-in user's
  projects.
- `GET /projects/{id}` — a project's files. Owners always see it; anyone
  else only if its visibility is `unlisted` or `public` (private projects
  404 for non-owners rather than 403, so existence isn't leaked either).
- `POST /projects/{id}` — `{"action": "rename"|"visibility"|"duplicate"|"delete", ...}`.
  Always checks ownership, regardless of visibility.
- `POST /projects/{id}/files` — `{"action": "create"|"save"|"delete", "filename": ..., "content": ...}`.
  Every `save` appends a row to a version-history table rather than just
  overwriting — a real, if simple, undo log.
- `GET /projects/{id}/history?filename=...` — every saved version of one
  file, newest first.
- `GET /certificates/progress` — the logged-in user's real progress
  toward eligibility (problems solved / total).
- `POST /certificates/issue` — issues a certificate if eligible.
  Idempotent: calling it again for someone who already has one returns
  their existing certificate rather than creating a second.
- `GET /certificates/mine` — the logged-in user's certificate, if issued.
- `GET /certificates/{code}` — **public, no auth**, returns JSON. Used by
  the app's own certificate card.
- `GET /confirmation/{code}` — **public, no auth**, returns a real HTML
  page. This is what the QR code and the certificate's verify link
  actually point to: a self-contained page (the logo is inlined, so it
  renders even if the frontend static server isn't running) that shows
  the same verification, server-rendered, at a clean path with no query
  string. Set the `DRACOSKILL_BASE_URL` environment variable before
  starting the server to point every future certificate at your real
  domain once you deploy — e.g. `DRACOSKILL_BASE_URL=https://your-domain.com
  python3 server.py`. Defaults to `http://localhost:8787`, which is what
  actually resolves right now.

Certificate codes are two hyphenated lowercase hex segments
(`a10bc5e98fe4-fd8cda826c40`) — long enough not to guess, and not
sequential, so one issued certificate's code gives no information about
any other.

Resource limits are set via a `/bin/sh -c "ulimit -v ...; exec ..."`
wrapper on POSIX (not Python's `preexec_fn`, which is unsafe in a
multi-threaded process — see the docstring in `execution.py`), and are
not enforced at all on Windows (timeout and output-size caps still apply
there; see `execution.py` for the disclosed gap).

## The six sandboxes

Python, JavaScript, Java, C, C++ (each compiles/runs code) and Terminal (installs
packages). `sandbox.py` runs every process; `runner.py` knows how to build and run
each language; `workspace.py` owns the per-user folders; `packages.py` installs
libraries; `terminal.py` is the command line.

## The terminal

Not a raw shell. Each line is split with `shlex` and dispatched to a fixed set of
commands (`help` lists them), so there are no pipes, redirects (except `echo x > file`),
`;`, `&&`, `$()` or backticks. Commands: `pip`, `npm`, `jar`, `clib`, `libs`, `run`,
`python`, `node`, `javac`, `java`, `gcc`, `g++`, `./binary`, `ls cd pwd cat mkdir touch
rm mv cp echo`, `sandboxes`, `whoami`, `clear`.

| Install | Source | Notes |
|---|---|---|
| `pip install x` | PyPI | plain names/versions only; no URLs, VCS, custom indexes |
| `npm install x` | npm registry | install scripts disabled (`--ignore-scripts`) |
| `jar add group:artifact:version` | Maven Central | **no transitive dependencies** — add each jar |
| `clib add github:owner/repo[@ref]` or `clib add <https url to .h>` | GitHub / GitLab only | **header-only** libraries only |

Scope: the open project by default, or `--account` for every project the user owns.
Python is installed with `pip --target`, npm with `--prefix`, so scopes never mix.

## Security model — read before exposing this to the internet

What the code does, and what it does not.

Layers (all auto-detected; `GET /sandboxes` reports which are active):

1. **Per-user OS uid** — when the server runs as root (as in the Dockerfile), every
   process starts via `setpriv` as uid `20000 + user_id`. Workspaces are `chmod 700`
   to that uid; the SQLite file is `600` root-only. User code cannot read the database
   or another user's files. *Tested.*
2. **No network while running** — `unshare -rn`. Only package installs get network.
   Docker's default seccomp profile often blocks `unshare`; the probe then turns this
   layer off and `/sandboxes` says "not blocked on this host". *Tested where it works.*
3. **Scrubbed environment** — the server's env vars are not inherited by user code.
4. **rlimits** (CPU, memory where the runtime tolerates it, file size, open files,
   processes), a wall-clock timeout that kills the whole process group, a 20,000-char
   output cap, a global concurrency cap, per-user rate limits and a per-user storage quota.

What it is **not**: gVisor/Firecracker-grade isolation. All users share one kernel and one
machine. A kernel exploit, or a host without layers 1–2, is a real risk. Specific gaps:

- Running locally as a non-root user disables layer 1 (user code then runs as you).
- Memory limits are not applied to Java (the JVM needs huge address space; it uses `-Xmx256m`).
- `pip` builds source distributions, which executes that package's build code (with
  network) inside the user's own sandbox uid. Inherent to pip.
- **Server files must not be world-writable.** Zips made on Windows often extract as
  666/777. The server prints a warning at startup if it finds this; the Dockerfile
  fixes it with `chmod -R go-w`.
- Every ancestor of `DRACOSKILL_DATA_DIR` must be world-traversable (`o+x`), or every run
  fails with "Permission denied". The server also warns about this at startup.
- Windows: no uid/ulimit/network isolation at all (timeout and output cap only).

The production upgrade path remains per-run containers or microVMs
(`../docs/architecture-blueprint.md`, section 5). This code is a solid step toward it, not a replacement for it.

## Testing

```
python3 selftest.py            # boots the real server on a throwaway DB; ~60 checks
python3 selftest.py --offline  # skips the checks that need PyPI / npm / GitHub
```
Covers all five languages, multi-file builds, compile errors, the judge, terminal file
commands, path-traversal rejection, package installs in both scopes, and isolation.
The Maven check uses a local mock server (Maven Central wasn't reachable where this was built).

## Docker

`Dockerfile` installs gcc/g++, a JDK, Node/npm and `util-linux` (for `setpriv`/`unshare`).
Build and run from this folder:
```
docker build -t dracoskill-backend .
docker run -p 8787:8787 -v dracoskill-data:/var/data dracoskill-backend
```
Not built in the environment this was developed in (no Docker there): the toolchain
install list and the `setpriv`/`unshare` behaviour under Docker's seccomp profile are
the first things to verify after your first build.

## Certificate mail merge (optional, separate from the running server)

`generate_certificates.py` produces real, personalized copies of your
actual `certificate-template/template.pptx` — one per certificate in the
database — by editing the file's text and QR code directly rather than
redrawing the design. Same outcome as Word's mail merge; done in Python
because the template is a `.pptx`.

```
pip install python-pptx qrcode --break-system-packages
python3 generate_certificates.py
```

Needs at least one issued certificate to do anything (earn one in the app
first: Problems tab → solve all three → Certificates tab → Issue). Writes
to `certificate-template/output/` — a `.pptx` per certificate always, plus
a `.pdf` too if LibreOffice's `soffice` is on PATH (skipped otherwise,
not an error).

This script has its own dependencies on purpose — `server.py` and every
module it imports stay dependency-free, so running the actual platform
never requires installing anything beyond Python itself.

## Extending it

Adding a language: an entry in `SANDBOXES` (`sandbox.py`) and a branch in `runner.py`.
Adding a problem: one entry in `PROBLEMS` in `judge.py`.
Neither requires touching `server.py`.
