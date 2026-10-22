# DracoSkill — project layout and deployment

The repo has exactly two top-level folders. Each is deployed as its own Vercel project.

```
backend/                 -> Vercel project #1   (Root Directory: backend)
  api/index.js           the API (one function, routed by path)
  lib/                   runner, judge, sandbox status
  scripts/make-snapshot.mjs   one-time: builds the compiler image
  test/                  tests (local stand-in for the sandbox)
  vercel.json  package.json  .vercelignore
  python-server/         OPTIONAL full Python backend (accounts, terminal, installs) for Render / your own PC.
                         Vercel ignores it (.vercelignore).
  docs/                  design documents
frontend/                -> Vercel project #2   (Root Directory: frontend)
  landing/  app/  assets/  vercel.json
```

## What the Vercel backend does
Runs Python, JavaScript, Java, C and C++ (stdin, compile errors, timeouts) and the Problems judge.
Each run is a fresh Vercel Sandbox microVM with all outbound network blocked.
It does **not** do accounts, saved projects, the terminal, package installs or certificates; those need a
database and persistent disk. Use `python-server/` (Render or your own machine) for them.

## Deploy — step by step

### 1. Backend project
Vercel -> Add New Project -> your repo -> **Root Directory: `backend`** -> Framework Preset: **Other** -> Deploy.
Then open `https://<backend>.vercel.app/health`. You should see
`{"status":"ok","service":"dracoskill-execution","backend":"vercel-sandbox"}`.
- A Vercel sign-in page instead? Backend project -> Settings -> Deployment Protection -> turn it off.
- A 404? The Root Directory is wrong (it must be `backend`, and `backend/api/index.js` must exist in the repo).

### 2. One-time compiler snapshot (needs Node 20.6+ on your PC; no Docker)
```
cd backend
npm install
npx vercel link          # pick the backend project
npx vercel env pull      # writes .env.local (a token for the SDK)
node --env-file=.env.local scripts/make-snapshot.mjs
```
It installs missing compilers into a sandbox, smoke-tests all five languages and prints `DRACO_SNAPSHOT_ID=...`.
Add that as an Environment Variable on the backend project, then redeploy.
Check `https://<backend>.vercel.app/sandboxes`: all five languages should say `"available": true`.

### 3. Frontend project
Vercel -> Add New Project -> same repo -> **Root Directory: `frontend`** -> Deploy.
`frontend/assets/config.js` holds `BACKEND_URL`; it must be your backend's address (no trailing slash).
Open `https://<frontend>.vercel.app/app/`.

### Connecting the two
Only one line connects them: `BACKEND_URL` in `frontend/assets/config.js`. Change it, commit, and Vercel redeploys the frontend.
(Quick test without redeploying: IDE -> Output tab -> paste the backend address -> Connect.)

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `404` when the page loads | Backend project's Root Directory isn't `backend`, or it was deployed from the Python server folder. |
| Chips crossed out / "Backend not reachable" | Wrong `BACKEND_URL`, or backend failing: open `/health` directly. |
| Python/JS fine, Java/C/C++ say "isn't installed in the sandbox image" | Step 2 not done: set `DRACO_SNAPSHOT_ID` and redeploy. |
| Login says "not available" | Expected on this backend (code running only). |
| Everything fails after heavy use | Free-plan sandbox allowance used up for the month. |

## Free plan notes
Vercel Hobby is non-commercial. Sandbox allowances (documented Sept 2026: 5,000 creations/month, 10 at once,
45 min max each, limited active CPU hours) change; check Vercel's current pricing page. Each Run is one creation.

## Tests
```
cd backend && npm install && npm test        # 33 checks against a LOCAL stand-in for the sandbox
cd backend/python-server && python3 selftest.py   # the Python backend's own end-to-end tests
```
The local stand-in checks this code's logic, not Vercel's API or isolation. Steps 1–2 above are what verify those.
