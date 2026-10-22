// What the sandbox image can actually run. Probing costs one sandbox creation,
// so the answer is cached for 15 minutes per warm function instance.
import { RUN_LANGUAGES, LABELS, getFactory } from './runner.js';

const TOOLS = {
  python: ['python3', 'python3 --version'],
  javascript: ['node', 'node --version'],
  java: ['javac', 'javac -version'],
  c: ['gcc', 'gcc --version | head -1'],
  cpp: ['g++', 'g++ --version | head -1'],
};
let cache = null;

export async function describe(factory = getFactory()) {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.value;
  const versions = {};
  let probeError = null;
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
      snapshot: !!process.env.DRACO_SNAPSHOT_ID,
      note: probeError ? `Could not probe the sandbox: ${probeError}` :
        (process.env.DRACO_SNAPSHOT_ID ? 'Each run is a fresh microVM with all outbound network blocked.' :
          'DRACO_SNAPSHOT_ID is not set: using the default image. Create the toolchain snapshot (README).'),
    },
  };
  if (!probeError) cache = { at: Date.now(), value };
  return value;
}
