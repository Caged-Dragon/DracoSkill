# DracoSkill — deployment guide (no Docker needed on your PC)

Plan: GitHub holds the code -> Render builds and runs the backend (with Docker, in
Render's cloud) -> Vercel hosts the website.

## Step 1 - Put the code on GitHub
1. Create a free account at github.com.
2. Click New repository, name it `dracoskill`, choose Private, create it.
3. Unzip this project. Open the `dracoskill_v2` folder.
4. In the new repo choose Add file -> Upload files, and drag in what is INSIDE
   `dracoskill_v2` (the folders `backend`, `frontend`, `docs`, and the files
   `render.yaml`, `README.md`, ...). `backend` and `frontend` must be at the top
   level of the repo, not inside another folder.
5. Commit the upload.
(This zip has no database file. If you have an old `dracoskill.db`, do NOT upload it:
it contains account password hashes.)

## Step 2 - Deploy the backend on Render
1. Sign up at render.com with your GitHub account.
2. Choose New -> Blueprint, select your `dracoskill` repo, and continue.
3. Plan and cost:
   - Safer for real use: keep `plan: starter` in `render.yaml` (paid, includes a disk
     so accounts and installed packages survive redeploys).
   - To try it free first: edit `render.yaml` on GitHub, change `plan: starter` to
     `plan: free` and delete the whole `disk:` block (the 5 lines starting with
     `disk:`). Everything then resets on every redeploy and the service sleeps when idle.
4. Click Apply. The first build takes several minutes (it installs Java, gcc, Node).
5. When it shows Live, copy its address, e.g. https://dracoskill-backend.onrender.com
6. In the service -> Environment, set `DRACOSKILL_BASE_URL` to that same address.
7. If you are on a plan with about 512 MB RAM, also add `DRACOSKILL_MAX_RUNS` = `1`.

## Step 3 - Check the backend
Open these in your browser (use your address):
- `/health`      -> should show "status": "ok"
- `/sandboxes`   -> all six entries should show "available": true
  Also read "isolation": if "networkNamespace" is false, user code can reach the
  internet while running. Fine for a private demo; fix before opening to the public.
Then open the service Logs and look for lines starting with WARNING.

## Step 4 - Point the website at the backend
Edit `frontend/assets/config.js` (pencil icon on GitHub) and set:
    BACKEND_URL: "https://dracoskill-backend.onrender.com"
using YOUR Render address, no trailing slash. Commit.

## Step 5 - Deploy the website on Vercel
1. Sign in at vercel.com with GitHub -> New Project -> pick the repo.
2. Set Root Directory to `frontend`. Leave everything else. Deploy.
3. Open the address Vercel gives you.

## Step 6 - Test
1. IDE tab: the six language chips should be green.
2. Run each demo file (Python, JavaScript, Java, C, C++).
3. Register, create a project (+ button), open the Terminal tab, run `help`, then
   `pip install pyfiglet` and `libs`.

## Troubleshooting
- Chips crossed out / "Could not reach": the BACKEND_URL is wrong, or the free Render
  service is waking up (wait about a minute and retry).
- Build fails on Render: copy the build log and ask for help.
- Every run says "Permission denied": check the Render logs for a WARNING line.
- Java/C/C++ crash the server under load: lower DRACOSKILL_MAX_RUNS or use a bigger plan.

## Running the backend on your own PC instead (no Docker)
Needs Python, Node, a JDK (javac), gcc and g++ installed on that PC:
    cd backend && python3 server.py
    cd frontend && python3 -m http.server 8000
Open http://localhost:8000/app/
