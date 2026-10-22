# DracoSkill

A product by **CagedDragons**. Free platform to write and run real code in **Python, Java, JavaScript, C and C++** — compiled and executed in the cloud, with a built-in terminal to install libraries — plus judged problems and a real account.

## Structure

```text
dracoskill/
├── frontend/
│   ├── landing/              # marketing page — index.html, styles.css, app.js
│   ├── app/                  # the actual product — index.html, styles.css, app.js
│   ├── assets/               # real image files + config.js (the backend URL lives here)
│   └── vercel.json           # Vercel static-site config
├── backend/
│   ├── server.py             # entry point — run this
│   ├── db.py                 # SQLite
│   ├── auth.py               # accounts + sessions
│   ├── sandbox.py            # process isolation: per-user uid, no-network, rlimits, timeouts
│   ├── workspace.py          # per-user project/library folders on the server
│   ├── runner.py             # compile + run for all five languages
│   ├── packages.py           # pip / npm / jar / clib installs (project or account scope)
│   ├── terminal.py           # the in-browser terminal's command set
│   ├── selftest.py           # end-to-end test: boots the server, drives everything over HTTP
│   ├── Dockerfile            # image with every toolchain
│   ├── execution.py          # thin facade used by server.py and judge.py
│   ├── judge.py              # problems + judging
│   ├── projects.py           # project persistence
│   ├── certificates.py       # eligibility, issuance, verification
│   ├── confirmation_page.py  # the real page a scanned QR code lands on
│   ├── generate_certificates.py # mail-merges real data into your actual .pptx
│   ├── certificate-template/
│   │   └── template.pptx     # your uploaded design — edited in place, never redrawn
│   └── README.md             # backend-specific setup and API detail
├── render.yaml               # Render blueprint for the backend
└── docs/
    ├── version-map.md        # what's built, in order
    └── architecture-blueprint.md # the original phased plan this was built from
```

## Run it locally

Two terminals:

```bash
# terminal 1
cd backend
python3 server.py

# terminal 2
cd frontend
python3 -m http.server 8000
```

Open [http://localhost:8000/landing/](http://localhost:8000/landing/) for the marketing page, or [http://localhost:8000/app/](http://localhost:8000/app/) to go straight to the product. Don't open the HTML files directly (`file://...`) — browsers restrict requests to `localhost` under that protocol.

Running the backend locally needs gcc, g++, a JDK (`javac`), Node and Python on your machine — that is the *server's* requirement; end users of a deployed site need nothing. `GET /sandboxes` (and the chips in the IDE) show which toolchains are missing. To get the same environment without installing them, use the Docker image in `backend/`.

The app already knows to talk to `http://localhost:8787` — that default lives in one place, `frontend/assets/config.js`, not scattered through the code.

## Deploying it

The frontend and backend are two separate deployments on purpose — a static site and a persistent server are different things, and forcing them onto one host usually means compromising one of them.

### Backend → Render

Render runs persistent processes, which is what this backend actually is (a long-running server holding a SQLite connection and spawning subprocesses for code execution) — not a fit for serverless platforms, where each request can land on a fresh, stateless instance and your database file wouldn't reliably persist between calls.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. It'll read `render.yaml` and set up a web service named `dracoskill-backend` with the right start command and health check already configured. (No `render.yaml`? Set it up manually: root directory `backend`, start command `python3 server.py`, health check path `/health`.)
3. `PORT` is supplied by Render automatically — `server.py` already reads it from the environment, nothing to configure.
4. Once deployed, note the public URL Render gives you (something like `https://dracoskill-backend.onrender.com`) and set it as the `DRACOSKILL_BASE_URL` environment variable on that same service, so certificates' QR codes and confirmation links point at your real domain instead of `localhost`.
5. **Database persistence**: Render's default filesystem is ephemeral — a redeploy wipes it. For a real deployment, attach a Render **persistent disk**, mount it (e.g. at `/var/data`), and set `DRACOSKILL_DB_PATH=/var/data/dracoskill.db`. Without this, the app still works, but accounts and certificates reset on every redeploy.
6. **Render needs the Docker runtime now.** Java, C, C++ and Node need toolchains Render's stock Python environment lacks, so `render.yaml` uses `runtime: docker` with `backend/Dockerfile`. A persistent disk (paid plan) at `/var/data` keeps accounts *and* users' installed packages across redeploys.
7. **Read `backend/README.md` → "Security model" before opening this to the public.** It is process-level isolation with a per-user uid, not a hardened multi-tenant boundary.

### Frontend → Vercel

The frontend is static files — this is Vercel's actual strength, no caveats here.

1. In Vercel: **New Project**, import the same repo, set **Root Directory** to `frontend`. `vercel.json` (already in that folder) handles routing `/` to the landing page.
2. Deploy. You'll get a URL like `https://dracoskill.vercel.app`.
3. Open `frontend/assets/config.js` in the repo, change `BACKEND_URL` to your real Render backend URL from the step above, commit, and redeploy (Vercel redeploys automatically on push if connected to GitHub). Every page — the app, the connect field, the certificate module — picks up the new value from that one file.

### CORS — already handled, no extra config needed

The backend sends `Access-Control-Allow-Origin: *` on every response. That's deliberately fine here and not a security shortcut: authentication uses a bearer-style `X-Session-Token` header, not cookies, so there's no credentialed-request restriction that a wildcard origin would violate. A Vercel-hosted frontend calling a Render-hosted backend works with zero CORS configuration beyond what's already in `server.py`.

## Why restructured

The earlier version of this was two ~330KB HTML files with the entire stylesheet, script, and even a base64-encoded image all inlined into a single tag each, plus one large `server.py` mixing HTTP handling, database access, auth, and the judge together. This version is the same functionality split along real boundaries: markup separate from style separate from behavior on the frontend, and one module per concern on the backend.
