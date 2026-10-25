// What the sandbox image can run.
//
// Default answer is FREE and instant: no sandbox is created, so a page load never spends your monthly
// sandbox allowance. It reports what is known:
//   - Python and JavaScript exist on Vercel's default image.
//   - Java/C/C++ are reported ready only when the setup snapshot exists (setup smoke-tests all five before saving it).
// `verified:false` marks that inference. Real versions arrive when a self-check ran recently (it fills the cache
// below), or when a caller asks for ?probe=1, which does create one sandbox and reports facts, `verified:true`.
import { RUN_LANGUAGES, LABELS, getFactory, setupUrl } from './runner.js';
import { findSnapshotId } from './toolchain.js';

const FRESH_MS = 15 * 60_000;
let known = null; // { at, versions: { python: 'Python 3.12.3', ... } }

export function rememberVersions(versions) { known = { at: Date.now(), versions }; }
export function forgetVersions() { known = null; }

const TOOLS = {
  python: ['python3', 'python3 --version'],
  javascript: ['node', 'node --version'],
  java: ['javac', 'javac -version'],
  c: ['gcc', 'gcc --version | head -1'],
  cpp: ['g++', 'g++ --version | head -1'],
};

async function probeSandbox(factory) {
  const versions = {};
  let sb;
  try {
    sb = await factory();
    const script = Object.entries(TOOLS).map(([k, [bin, ver]]) =>
      `if command -v ${bin} >/dev/null 2>&1; then echo "${k}|$(${ver} 2>&1 | head -1)"; else echo "${k}|"; fi`).join('\n');
    await sb.writeFiles([{ path: '/vercel/sandbox/probe.sh', content: Buffer.from(script + '\n') }]);
    await sb.runCommand({ cmd: 'bash', args: ['-c', 'bash probe.sh > probe.out 2>&1'], cwd: '/vercel/sandbox' });
    const out = (await sb.readFileToBuffer({ path: '/vercel/sandbox/probe.out' }))?.toString('utf8') || '';
    for (const line of out.split('\n')) { const [k, v] = line.split('|'); if (k) versions[k] = (v || '').trim(); }
  } finally {
    try { await sb?.stop(); } catch { /* already stopped */ }
  }
  return versions;
}

export async function describe(factory = getFactory(), { probe = false } = {}) {
  const snapshotId = await findSnapshotId().catch(() => null); // one cheap API call, cached; never creates a sandbox
  let versions = known && Date.now() - known.at < FRESH_MS ? known.versions : null;
  let probeError = null;
  if (probe && !versions) {
    try { versions = await probeSandbox(factory); rememberVersions(versions); }
    catch (e) { probeError = String(e?.message || e); }
  }
  const verified = !!versions;
  const sandboxes = RUN_LANGUAGES.map((id) => ({
    id, label: LABELS[id], verified,
    available: verified ? !!versions[id] : (id === 'python' || id === 'javascript' || !!snapshotId),
    version: (versions && versions[id]) || null,
    network: 'blocked (own microVM, deny-all)',
  }));
  return {
    sandboxes,
    isolation: {
      driver: 'vercel-sandbox', perRunMicroVM: true, networkNamespace: true, perUserUid: false,
      snapshot: !!snapshotId, inferred: !verified,
      note: probeError ? `Could not probe the sandbox: ${probeError}`
        : snapshotId ? 'Each run is a fresh microVM with all outbound network blocked. The compiler snapshot was tested when it was created.'
        : `No toolchain snapshot yet: Java, C and C++ are not available. Open ${setupUrl()} to install the compilers.`,
    },
  };
}
