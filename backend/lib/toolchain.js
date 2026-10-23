// One-time toolchain setup, driven from a web page on THIS backend (GET /setup).
//
// Why it exists: Vercel's default sandbox image may not have gcc/g++/javac. We install them once into
// a named sandbox, take a snapshot (never expires), and from then on every run starts from that snapshot.
// The backend finds the newest snapshot of the sandbox named 'draco-toolchain' by itself, so there is no
// environment variable to set and no redeploy. (DRACO_SNAPSHOT_ID still works as an override.)
//
// Every step is short (start / status), so Vercel's function time limit is never a problem: the slow
// part (apt-get) runs as a DETACHED command inside the sandbox while we poll.
import { Sandbox, Snapshot } from '@vercel/sandbox';

export const TOOLCHAIN_NAME = 'draco-toolchain';
const ROOT = '/vercel/sandbox';

export const INSTALL_SCRIPT = `#!/bin/bash
mkdir -p .draco
exec > .draco/install.log 2>&1
set -x
need_apt=""; need_dnf=""
command -v gcc     >/dev/null || { need_apt="$need_apt gcc";                 need_dnf="$need_dnf gcc"; }
command -v g++     >/dev/null || { need_apt="$need_apt g++";                 need_dnf="$need_dnf gcc-c++"; }
command -v javac   >/dev/null || { need_apt="$need_apt default-jdk-headless"; need_dnf="$need_dnf java-21-openjdk-devel"; }
command -v python3 >/dev/null || { need_apt="$need_apt python3";             need_dnf="$need_dnf python3"; }
command -v node    >/dev/null || { need_apt="$need_apt nodejs";              need_dnf="$need_dnf nodejs"; }
rc=0
if [ -n "$need_apt$need_dnf" ]; then
  if command -v apt-get >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y && apt-get install -y --no-install-recommends $need_apt || rc=$?
  elif command -v dnf >/dev/null; then
    dnf install -y $need_dnf || rc=$?
  else
    echo "no apt-get or dnf found"; rc=90
  fi
fi
echo "$rc" > .draco/install.code
chmod -R a+rwX .draco 2>/dev/null
`;

export const SMOKE_SCRIPT = `cd ${ROOT}
mkdir -p .draco/smoke && cd .draco/smoke
printf '#include <stdio.h>\\nint main(){puts("ok");}\\n' > t.c
printf '#include <iostream>\\nint main(){std::cout<<"ok\\\\n";}\\n' > t.cpp
printf 'public class T{public static void main(String[] a){System.out.println("ok");}}\\n' > T.java
fail=""
python3 -c "print('ok')" | grep -qx ok || fail="$fail python"
node -e "console.log('ok')" | grep -qx ok || fail="$fail javascript"
gcc t.c -o tc && ./tc | grep -qx ok || fail="$fail c"
g++ t.cpp -o tcpp && ./tcpp | grep -qx ok || fail="$fail c++"
javac T.java && java T | grep -qx ok || fail="$fail java"
cd ${ROOT} && rm -rf .draco/smoke
if [ -z "$fail" ]; then echo ALL_OK; else echo "FAILED:$fail"; fi
`;

// ---------- finding the snapshot (used by every run) ----------
let cached = { id: undefined, at: 0 };
export function rememberSnapshot(id) { cached = { id, at: Date.now() }; }
export function forgetSnapshot() { cached = { id: undefined, at: 0 }; }

export async function findSnapshotId(client = getSetupClient()) {
  if (process.env.DRACO_SNAPSHOT_ID) return process.env.DRACO_SNAPSHOT_ID;
  const ttl = cached.id ? 10 * 60_000 : 30_000; // re-check "none yet" quickly so setup takes effect fast
  if (cached.id !== undefined && Date.now() - cached.at < ttl) return cached.id;
  let id = null;
  try { id = await client.findSnapshot(); } catch { id = null; }
  cached = { id, at: Date.now() };
  return id;
}

export const realClient = {
  async findSnapshot() {
    const res = await Snapshot.list({ name: TOOLCHAIN_NAME, limit: 10, sortOrder: 'desc' });
    for await (const s of res) if (s.status === 'created') return s.id;
    return null;
  },
  async getSandbox() { try { return await Sandbox.get({ name: TOOLCHAIN_NAME }); } catch { return null; } },
  async createSandbox() {
    return Sandbox.create({ name: TOOLCHAIN_NAME, timeout: 20 * 60_000, resources: { vcpus: 2 }, snapshotExpiration: 0 });
  },
};
export function getSetupClient() { return globalThis.__DRACO_SETUP_CLIENT || realClient; }

async function readText(sb, rel) {
  try { const b = await sb.readFileToBuffer({ path: `${ROOT}/${rel}` }); return b ? b.toString('utf8') : null; } catch { return null; }
}
const tail = (s, n = 1500) => (s || '').slice(-n);

// ---------- start ----------
export async function startSetup(client = getSetupClient(), { installScript = INSTALL_SCRIPT } = {}) {
  const existing = await client.findSnapshot().catch(() => null);
  if (existing) { rememberSnapshot(existing); return { state: 'done', snapshotId: existing, message: 'Already set up.' }; }

  let sb = await client.getSandbox();
  if (sb) {
    const code = await readText(sb, '.draco/install.code');
    if (code === null && (await readText(sb, '.draco/install.sh')) !== null) {
      return { state: 'installing', message: 'Setup is already running.' }; // don't reset someone else's progress
    }
    try { await sb.delete(); } catch { /* ignore */ }   // leftover from a failed attempt: start clean
  }
  sb = await client.createSandbox();
  await sb.writeFiles([{ path: `${ROOT}/.draco/install.sh`, content: Buffer.from(installScript), mode: 0o755 }]);
  await sb.runCommand({ cmd: 'bash', args: ['.draco/install.sh'], cwd: ROOT, sudo: true, detached: true });
  return { state: 'installing', message: 'Installing compilers inside a sandbox. This takes a few minutes.' };
}

// ---------- status (polled by the /setup page) ----------
let snapshotting = false;
export async function setupStatus(client = getSetupClient()) {
  const existing = await client.findSnapshot().catch(() => null);
  if (existing) { rememberSnapshot(existing); return { state: 'done', snapshotId: existing }; }
  if (snapshotting) return { state: 'saving', message: 'Saving the snapshot…' };

  const sb = await client.getSandbox();
  if (!sb) return { state: 'idle' };
  const code = await readText(sb, '.draco/install.code');
  const log = tail(await readText(sb, '.draco/install.log'));
  if (code === null) return { state: 'installing', log };
  if (code.trim() !== '0') return { state: 'failed', message: `Install exited with code ${code.trim()}.`, log };

  snapshotting = true;
  try {
    await sb.writeFiles([{ path: `${ROOT}/.draco/smoke.sh`, content: Buffer.from(SMOKE_SCRIPT) }]);
    const r = await sb.runCommand({ cmd: 'bash', args: ['.draco/smoke.sh'], cwd: ROOT });
    const out = (await r.stdout()).trim();
    if (!out.endsWith('ALL_OK')) return { state: 'failed', message: 'A compiler did not pass its self-test.', log: tail(out + '\n' + log) };
    const snap = await sb.snapshot({ expiration: 0 });
    const id = snap.snapshotId ?? snap.id;
    rememberSnapshot(id);
    return { state: 'done', snapshotId: id };
  } catch (e) {
    return { state: 'failed', message: `Could not save the snapshot: ${e?.message || e}`, log };
  } finally {
    snapshotting = false;
  }
}

export function setupPage(origin = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DracoSkill backend setup</title>
<style>
:root{color-scheme:dark light;--bg:#121317;--fg:#F5F3EF;--dim:#A39D95;--card:#1C1F26;--bd:#2E323C;--ok:#4ADE80;--err:#F07868;--accent:#E8453C}
@media (prefers-color-scheme:light){:root{--bg:#faf8f5;--fg:#1d1b19;--dim:#5e5851;--card:#fff;--bd:#ddd5cc}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 20px}
h1{font-size:22px;margin:0 0 6px}p{color:var(--dim)}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:20px;margin-top:18px}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:700;font-size:15px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
pre{background:#0F1115;color:#cfcac3;border-radius:8px;padding:12px;font-size:12px;max-height:260px;overflow:auto;white-space:pre-wrap}
.ok{color:var(--ok);font-weight:700}.err{color:var(--err);font-weight:700}
</style></head><body><main>
<h1>DracoSkill backend: one-time setup</h1>
<p>Java, C and C++ need compilers that Vercel's default sandbox may not include. This page installs them once and saves them as a snapshot. Python and JavaScript already work without it.</p>
<div class="card">
  <div id="state">Checking…</div>
  <p id="msg"></p>
  <button id="go" disabled>Start setup</button>
  <pre id="log" hidden></pre>
</div>
<div class="card">
  <b>Live self-check</b>
  <p>Runs a real program in each language inside a real sandbox. A fresh random number is sent each time and every program must compute <code>n*n+7</code> from it, so nothing can be canned.</p>
  <button id="chk">Run self-check</button>
  <div id="chkout"></div>
</div>
<p>Takes about 3 to 8 minutes and uses one sandbox from your free allowance. Keep this tab open. You only do this once.</p>
</main>
<script>
const $ = (id) => document.getElementById(id);
const base = ${JSON.stringify(origin)};
let running = false;
function show(s) {
  const st = s.state;
  $('state').innerHTML = st === 'done' ? '<span class="ok">All set.</span> Java, C and C++ are ready.'
    : st === 'failed' ? '<span class="err">Setup failed.</span>'
    : st === 'installing' ? 'Installing compilers…' : st === 'saving' ? 'Saving the snapshot…' : 'Not set up yet.';
  $('msg').textContent = s.message || (st === 'done' && s.snapshotId ? 'Snapshot: ' + s.snapshotId : '');
  $('log').hidden = !s.log; $('log').textContent = s.log || '';
  $('go').disabled = st === 'installing' || st === 'saving' || st === 'done';
  $('go').textContent = st === 'failed' ? 'Try again' : 'Start setup';
}
async function poll() {
  try { const r = await fetch(base + '/setup/status'); const s = await r.json(); show(s);
    if (s.state === 'installing' || s.state === 'saving') { setTimeout(poll, 6000); return; } } catch (e) { $('msg').textContent = 'Could not reach the backend: ' + e.message; }
  running = false;
}
$('go').onclick = async () => {
  $('go').disabled = true; running = true;
  try { const r = await fetch(base + '/setup/start', { method: 'POST' }); const s = await r.json(); show(s); if (s.state === 'installing') setTimeout(poll, 6000); }
  catch (e) { $('msg').textContent = 'Could not reach the backend: ' + e.message; $('go').disabled = false; }
};
poll();
$('chk').onclick = async () => {
  $('chk').disabled = true; $('chkout').textContent = 'Running real programs in a sandbox… (10 to 60 seconds)';
  try {
    const r = await (await fetch(base + '/selfcheck')).json();
    if (r.error && !r.results) { $('chkout').innerHTML = '<span class="err">' + r.error + '</span>'; return; }
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    let h = '<p>Input <b>' + r.input + '</b> → every program must print <b>' + esc(r.results[0].expected) + '</b></p><pre>';
    for (const x of r.results) h += (x.verified ? 'PASS ' : 'FAIL ') + x.label.padEnd(11) + (x.verified ? esc(x.version) + '  (' + x.timeMs + ' ms)' : esc(x.error || 'wrong output')) + '\\n';
    h += '</pre><p>' + (r.ok ? '<span class="ok">All five languages executed for real.</span>' : '<span class="err">Some languages did not run. Use Start setup above if compilers are missing.</span>')
       + ' Network blocked inside the sandbox: <b>' + (r.networkBlocked === true ? 'yes' : r.networkBlocked === false ? 'NO' : 'unknown') + '</b>. Used the compiler snapshot: <b>' + (r.usedSnapshot ? 'yes' : 'no') + '</b>.</p>';
    $('chkout').innerHTML = h;
  } catch (e) { $('chkout').textContent = 'Could not reach the backend: ' + e.message; }
  finally { $('chk').disabled = false; }
};
</script></body></html>`;
}
