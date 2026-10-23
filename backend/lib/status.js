// What the sandbox image can actually run. Probing costs one sandbox creation,
// so the answer is cached for 15 minutes per warm function instance.
import { RUN_LANGUAGES, LABELS, getFactory, setupUrl } from './runner.js';
import { findSnapshotId } from './toolchain.js';

const TOOLS = {
  python: ['python3', 'python3 --version'],
  javascript: ['node', 'node --version'],
  java: ['javac', 'javac -version'],
  c: ['gcc', 'gcc --version | head -1'],
  cpp: ['g++', 'g++ --version | head -1'],
};
let cache = null;

export async function describe(factory = getFactory()) {
  const ttl = cache && cache.complete ? 15 * 60_000 : 20_000;  // re-probe quickly while something is missing
  if (cache && Date.now() - cache.at < ttl) return cache.value;
  const versions = {};
  let probeError = null;
  const snapshotId = await findSnapshotId().catch(() => null);
  let sb;
  try {
    sb = await factory();
    const script = Object.entries(TOOLS).map(([k, [bin, ver]]) =>
      `if command -v ${bin} >/dev/null 2>&1; then echo "${k}|$(${ver} 2>&1 | head -1)"; else echo "${k}|"; fi`).join('\n');
    await sb.writeFiles([{ path: '/vercel/sandbox/probe.sh', content: Buffer.from(script + '\n') }]);
    await sb.runCommand({ cmd: 'bash', args: ['-c', 'bash probe.sh > probe.out 2>&1'], cwd: '/vercel/sandbox' });
    const out = (await sb.readFileToBuffer({ path: '/vercel/sandbox/probe.out' }))?.toString('utf8') || '';
    for (const line of out.split('\n')) { const [k, v] = line.split('|'); if (k) versions[k] = (v || '').trim(); }
  } catch (e) {
    probeError = String(e?.message || e);
  } finally {
    try { await sb?.stop(); } catch { /* ignore */ }
  }
  const sandboxes = RUN_LANGUAGES.map((id) => ({
    id, label: LABELS[id], available: !!versions[id], version: versions[id] || null,
    network: 'blocked (own microVM, deny-all)',
  }));
  sandboxes.push({ id: 'terminal', label: 'Terminal', available: false, version: null, network: 'not available on this backend' });
  const value = {
    sandboxes,
    features: { accounts: false, projects: false, terminal: false, certificates: false },
    isolation: {
      driver: 'vercel-sandbox', perRunMicroVM: true, networkNamespace: true, perUserUid: false,
      snapshot: !!snapshotId,
      note: probeError ? `Could not probe the sandbox: ${probeError}` :
        (snapshotId ? 'Each run is a fresh microVM with all outbound network blocked.' :
          `No toolchain snapshot yet: using the default image. Open ${setupUrl()} to install the compilers.`),
    },
  };
  if (!probeError) cache = { at: Date.now(), value, complete: sandboxes.slice(0, 5).every((x) => x.available) };
  return value;
}
