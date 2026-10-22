# DracoSkill backend for Vercel (`backend-vercel/`)

A second backend, written for Vercel. It runs your code in **Vercel Sandbox** microVMs
instead of on a server you manage. Deploy it as its own Vercel project; the frontend
is a separate Vercel project that talks to it.

## What works / what doesn't

| | `backend/` (Python, Render or your own server) | `backend-vercel/` (this folder) |
|---|---|---|
| Run Python, JavaScript, Java, C, C++ (stdin, compile errors, timeouts) | yes | yes |
| Problems + judge (all 5 languages) | yes | yes (verdicts not saved) |
| Accounts, saved projects, multi-file projects | yes | **no** |
| Terminal and `pip` / `npm` / `jar` / `clib` installs | yes | **no** |
| Certificates | yes | **no** |
| Isolation | process + per-user uid | **fresh microVM per run, all outbound network blocked** |

Accounts and the terminal need a database and a disk that persists between requests.
Vercel functions have neither, so those routes answer `501` with a clear message and the
frontend says so. Phase 2 would add an outside database (and per-user persistent sandboxes
for installed packages); it is not built.

## How a run works
Press Run -> frontend `POST /execute` -> `api/index.js` -> a new sandbox is created from your
toolchain snapshot with `networkPolicy: 'deny-all'` -> your file is written -> compiled (Java/C/C++)
and run under `timeout` and a file-size limit -> output is read back (capped at 20,000 chars) ->
the sandbox is stopped. One sandbox creation per run; a judge submission is also one creation
(compiled once, all tests run in it).

## Setup (you need Node 20.6+ on your PC once; no Docker)

1. **Create the Vercel project.** vercel.com -> Add New Project -> pick your repo ->
   **Root Directory: `backend-vercel`** -> Deploy. Name it e.g. `dracoskill-api`.
2. **Build the toolchain snapshot (one time).** In a terminal:
   ```
   cd backend-vercel
   npm install
   npx vercel link        # choose the backend project you just created
   npx vercel env pull    # writes .env.local with a token the SDK uses
   node --env-file=.env.local scripts/make-snapshot.mjs
   ```
   It checks for python3, node, javac, gcc, g++, installs what's missing, smoke-tests all five
   languages, and prints `DRACO_SNAPSHOT_ID=...`.
3. In the backend project -> Settings -> Environment Variables, add `DRACO_SNAPSHOT_ID`. Redeploy.
4. Open `https://<your-backend>.vercel.app/sandboxes`. All five languages should show `"available": true`.
   If you see a Vercel login page instead, turn off Deployment Protection for this project.
5. In `frontend/assets/config.js` set `BACKEND_URL` to the backend address, then deploy the frontend
   as a second Vercel project with **Root Directory: `frontend`**.

## Free-plan limits (Vercel Hobby, as documented in September 2026 — check current numbers)
Sandbox creations are limited per month (documented as 5,000), 10 sandboxes at once, 45 minutes
max each, and a few hours of active CPU a month; past the allowance, sandbox creation pauses until
the next cycle. Hobby is non-commercial use only.

## Environment variables
| Name | Purpose |
|---|---|
| `DRACO_SNAPSHOT_ID` | Required in practice: the snapshot with all five toolchains. |
| `SF_TIMEOUT` / `SF_COMPILE_TIMEOUT` | Seconds for a run (5) / a compile (25). |

## Testing
```
npm install
npm test            # 32 checks using a LOCAL stand-in for the sandbox (test/fake-sandbox.mjs)
PORT=8787 node test/serve-local.mjs   # serve this API locally with the stand-in, then open the frontend
```
**What the tests do not prove:** the stand-in runs commands on your own machine. They verify this
code's logic (scripts, output limits, timeouts, verdicts, routing, rate limiting), **not** Vercel's
API, the sandbox image's toolchains, or its isolation. Those are checked by steps 2 and 4 above.

## Known unverified points
- The real `@vercel/sandbox` calls (`create` with `source: snapshot` + `networkPolicy`, `runCommand`,
  `writeFiles`, `readFileToBuffer`, `stop`, `snapshot`) follow Vercel's documentation and the installed
  SDK's exported methods (v3.8.0) but have never been run against a live account here.
- Whether the default image can install a JDK and gcc (`make-snapshot.mjs` finds out and tells you).
- Per-run latency: creating a microVM and compiling adds time; expect slower than the Python backend.
- The rate limiter is in-memory per function instance, so it is best-effort only.
