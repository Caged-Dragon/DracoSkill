# DracoSkill online compiler

A free online compiler for **Python, JavaScript, Java, C and C++**. One page: pick a language, write code, press Run,
read the output. Code runs on a server, never on the visitor's computer, so nothing needs installing.

Two folders, each deployed as its own Vercel project:

```
frontend/   Vercel project #1   (Root Directory: frontend)   the compiler page: index.html, compiler.js, compiler.css, assets/
backend/    Vercel project #2   (Root Directory: backend)    the API: api/index.js, lib/, vercel.json, package.json
```

## What the page does
Language tabs, a code editor (line numbers, syntax colour, auto-indent), an input box for stdin, Run (Ctrl/Cmd+Enter),
output with compile errors, exit code and timing, Copy / Clear output, Download the file, Share link (the code travels
inside the link, nothing is stored on a server), Reset to the sample, dark and light themes, draggable divider,
and autosave in the visitor's own browser. Works on phones.

## Installable app (PWA)
The page installs like an app (Chrome/Edge: the "Install app" button or the address-bar icon; Android: browser menu; iPhone/iPad:
Share, then Add to Home Screen). Installed, it opens in its own window, has home-screen shortcuts for Python, JavaScript, Java and C
(long-press the icon), and **opens offline**: the editor, syntax colour, theme and your autosaved code all work with no connection.
Running code needs the server, so Run says you are offline instead of failing silently. API calls are never cached.

**Releasing an update:** edit any frontend file, then change `const VERSION = 'v1'` in `frontend/sw.js` (to `v2`, `v3`...).
Visitors see "A new version of DracoSkill is ready. Reload to update". It never reloads by itself, so nobody loses code mid-edit.
Without a version bump, installed copies fix themselves on their second visit, but only the bump guarantees a clean switch.

**Icons:** they are generated from `assets/dracoskill-mark.png`, which is only 300 px, so the 512 px icons are slightly soft.
Replace that file with a 512 px or larger logo and regenerate `assets/icons/` (192, 512, maskable 512, 180 apple-touch, 32 favicon).

## How a run works
`POST /execute {language, code, stdin}` -> the backend starts a fresh **Vercel Sandbox** microVM with all outbound network
blocked -> writes the file, compiles (Java/C/C++), runs it under a time limit (5 s) and an output cap (20,000 characters)
-> returns stdout, stderr, exit code and timings -> the sandbox is stopped. One sandbox creation per Run.
Limits: 200 KB of code, 100 KB of input, 20 runs a minute per visitor address (best effort).

## Deploy, step by step
1. Put this repo on GitHub with `backend/` and `frontend/` at the top level.
2. **Backend:** Vercel -> Add New Project -> this repo -> **Root Directory `backend`** -> Framework **Other** -> Deploy.
   Open `https://<backend>.vercel.app/health`. You should see `{"status":"ok", ... "backend":"vercel-sandbox"}`.
   (A Vercel sign-in page instead? Project -> Settings -> Deployment Protection -> turn it off.)
3. **Compilers (one time, from your browser):** open `https://<backend>.vercel.app/setup` and click **Start setup**.
   It installs gcc, g++ and a JDK into a sandbox, tests all five languages, and saves a snapshot (3 to 8 minutes).
   The backend finds the snapshot by itself: no environment variable, no redeploy. Python and JavaScript work without it.
4. **Prove it works:** on the same `/setup` page click **Run self-check**. A fresh random number is generated each time
   and every language must compute `n*n+7` from it, so a canned answer cannot pass. It also shows real compiler versions.
5. **Frontend:** edit `frontend/assets/config.js` so `BACKEND_URL` is your backend address, then Vercel -> Add New Project
   -> same repo -> **Root Directory `frontend`** -> Deploy. Open the address Vercel gives you.

## Endpoints
| Route | Purpose |
|---|---|
| `POST /execute` | run one program |
| `GET /sandboxes` | which languages are ready. Free: it never creates a sandbox. `?probe=1` measures for real (one sandbox) |
| `GET /setup`, `/setup/status`, `POST /setup/start` | the one-time compiler setup page |
| `GET /selfcheck` | live proof that all five languages execute (rate limited) |
| `GET /health` | liveness |

## Free-plan notes (Vercel Hobby, as documented in September 2026: check current numbers)
Sandbox creations per month (documented as 5,000), 10 sandboxes at once, 45 minutes each, limited active CPU hours;
past the allowance, runs fail until the next cycle. Hobby is for non-commercial use. A busy public site will need a paid plan.
Environment variables (backend project): `SF_TIMEOUT` and `SF_COMPILE_TIMEOUT` change the run and compile limits (seconds),
`DRACO_SNAPSHOT_ID` overrides the snapshot, and **`ALLOWED_ORIGINS`** locks the API to your own site (below).

## Lock the API to your website (recommended)
By default any website can call your backend, and every run spends your free allowance. In the **backend** project add the
environment variable `ALLOWED_ORIGINS` = `https://dracoskill-frontend.vercel.app` (your real frontend address, comma separated if
you have several, no trailing slash; add `http://localhost:8000` for local testing) and redeploy. Other websites are then refused
**before any sandbox is created**. The `/setup` page on the backend itself keeps working.
Limit: this stops other *websites*. A script that forges the `Origin` header is not stopped by it; the per-address rate limit and the
monthly allowance are the backstop. If the allowance runs out, visitors see "This site has used up its free run allowance for now".

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Page loads but "Server unreachable" | `BACKEND_URL` is wrong, or the backend project failed to deploy: open `<backend>/health` |
| 404 on the backend address | the backend project's Root Directory is not `backend` |
| Java, C or C++ say "isn't installed in the sandbox image yet" (HTTP 503) | step 3 is not done |
| Runs suddenly fail for everyone | the month's free sandbox allowance is used up (the page says so) |
| "This website is not allowed" (403) | `ALLOWED_ORIGINS` does not contain your frontend's exact address |
| Installed app does not show my latest change | bump `VERSION` in `frontend/sw.js`, redeploy, reopen the app and choose Reload to update |

## Tests
```
cd backend && npm install && npm test        # 46 checks, using a LOCAL stand-in for the sandbox
pip install playwright && playwright install chromium
python3 backend/test/browser.py              # 37 checks driving the real page in a browser
python3 backend/test/pwa.py                  # 47 checks: manifest, icons, true offline, updates, install prompt
```
The stand-in runs commands on your own machine, so these tests verify this project's logic (scripts, limits, routing,
the page), **not** Vercel's API or isolation. Step 4 above is what verifies those on your real deployment.
