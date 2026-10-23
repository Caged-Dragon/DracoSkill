// DracoSkill (Vercel) — runs ONE program in a fresh Vercel Sandbox microVM.
//
// Every run gets its own microVM with all outbound network blocked ('deny-all'),
// is never persisted, and is stopped when finished. That is stronger isolation
// than the Python backend's process-level sandbox, and it is the reason this
// backend exists.
//
// The compilers live in a SNAPSHOT you create once (scripts/make-snapshot.mjs)
// and reference with DRACO_SNAPSHOT_ID. Without it, runs use Vercel's default
// image, and any missing toolchain is reported clearly instead of crashing.
import { Sandbox } from '@vercel/sandbox';
import { findSnapshotId } from './toolchain.js';

export const RUN_LANGUAGES = ['python', 'javascript', 'java', 'c', 'cpp'];
export const LABELS = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++' };
const ROOT = '/vercel/sandbox';
const MAX_OUT = 20_000;
const RUN_TIMEOUT = Number(process.env.SF_TIMEOUT || 5);
const COMPILE_TIMEOUT = Number(process.env.SF_COMPILE_TIMEOUT || 25);
export const MAX_CODE = 200_000;
export const MAX_STDIN = 100_000;

const JAVA_FLAGS = '-Xmx256m -Xss1m -XX:+UseSerialGC -XX:TieredStopAtLevel=1';

// Tests replace this to run against a local stand-in instead of real microVMs.
export async function defaultFactory() {
  const params = { timeout: 90_000, persistent: false, networkPolicy: 'deny-all', resources: { vcpus: 1 } };
  const snapshotId = await findSnapshotId(); // env override, else the snapshot made by /setup
  if (snapshotId) params.source = { type: 'snapshot', snapshotId };
  return Sandbox.create(params);
}
export function getFactory() {
  return globalThis.__DRACO_SANDBOX_FACTORY || defaultFactory;
}

export function snippetFile(language, code) {
  if (language === 'java') {
    const m = /public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)/.exec(code);
    return { file: (m ? m[1] : 'Main') + '.java', cls: m ? m[1] : 'Main' };
  }
  return { file: { python: 'main.py', javascript: 'main.js', c: 'main.c', cpp: 'main.cpp' }[language] };
}

export class RunSession {
  constructor(language, code, factory = getFactory()) {
    this.language = language;
    this.code = code;
    this.factory = factory;
    this.sb = null;
    const f = snippetFile(language, code);
    this.file = f.file;
    this.cls = f.cls;
  }

  async open() {
    this.sb = await this.factory();
    await this.sb.writeFiles([{ path: `${ROOT}/${this.file}`, content: Buffer.from(this.code, 'utf8') }]);
  }

  async close() {
    try { await this.sb?.stop(); } catch { /* already stopped / expired */ }
  }

  // One shell phase with a hard timeout and file-size limit. Output goes to files
  // (not memory) so a flooding program can't blow up this function.
  async phase(name, command, { timeoutSec, stdin = null }) {
    const sb = this.sb;
    const files = [{ path: `${ROOT}/${name}.sh`, content: Buffer.from(command + '\n') }];
    const redirect = stdin === null ? '< /dev/null' : '< stdin.txt';
    if (stdin !== null) files.push({ path: `${ROOT}/stdin.txt`, content: Buffer.from(stdin, 'utf8') });
    files.push({
      path: `${ROOT}/w_${name}.sh`,
      content: Buffer.from(
        `ulimit -f 65536 2>/dev/null\n` +
        `timeout -k 1 ${timeoutSec} bash ${name}.sh ${redirect} > ${name}.out 2> ${name}.err\n` +
        `echo $? > ${name}.code\n`),
    });
    await sb.writeFiles(files);
    const t0 = Date.now();
    await sb.runCommand({ cmd: 'bash', args: [`w_${name}.sh`], cwd: ROOT });
    const ms = Date.now() - t0;
    const read = async (ext) => {
      const b = await sb.readFileToBuffer({ path: `${ROOT}/${name}.${ext}` });
      return b ? b.toString('utf8') : '';
    };
    const [out, err, codeTxt] = await Promise.all([read('out'), read('err'), read('code')]);
    let code = parseInt(codeTxt.trim(), 10);
    if (Number.isNaN(code)) code = null;
    const timedOut = code === 124 || (code === 137 && ms >= timeoutSec * 1000);
    return {
      stdout: out.slice(0, MAX_OUT),
      stderr: timedOut ? `${err.slice(0, MAX_OUT)}${err ? '\n' : ''}Execution timed out after ${timeoutSec}s` : err.slice(0, MAX_OUT),
      exitCode: timedOut ? null : code,
      timeMs: ms,
      timedOut,
      truncated: out.length > MAX_OUT || err.length > MAX_OUT,
    };
  }

  // Compile step (Java/C/C++). Returns null for interpreted languages, or the compile phase result.
  async prepare() {
    const l = this.language;
    if (l === 'java') {
      if (!/^[A-Za-z_]\w*$/.test(this.cls)) return { error: 'Invalid Java class name.' };
      return this.phase('compile', `mkdir -p build && javac -nowarn -encoding UTF-8 -J-Xmx256m -J-XX:+UseSerialGC -d build ${this.file}`, { timeoutSec: COMPILE_TIMEOUT });
    }
    if (l === 'c') return this.phase('compile', `gcc -std=gnu17 -O1 -Wall -pipe -o app ${this.file} -lm -lpthread`, { timeoutSec: COMPILE_TIMEOUT });
    if (l === 'cpp') return this.phase('compile', `g++ -std=gnu++17 -O1 -Wall -pipe -o app ${this.file} -lm -lpthread`, { timeoutSec: COMPILE_TIMEOUT });
    return null;
  }

  runCommandText() {
    switch (this.language) {
      case 'python': return `python3 ${this.file}`;
      case 'javascript': return `node ${this.file}`;
      case 'java': return `java ${JAVA_FLAGS} -cp build ${this.cls}`;
      default: return './app';
    }
  }

  run(stdin) {
    return this.phase('run', this.runCommandText(), { timeoutSec: RUN_TIMEOUT, stdin: stdin || '' });
  }
}

// bash reports a missing program as exit 127 + 'not found'; require both so a user program that merely exits 127 isn't misreported.
const missingTool = (r) => r.exitCode === 127 && /not found/i.test(r.stderr || '');

export function setupUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host}/setup` : '<your backend address>/setup';
}

function missingMessage(language) {
  return `${LABELS[language]} isn't installed in the sandbox image yet. One-time fix: open ${setupUrl()} in your browser and click "Start setup". ` +
         `It takes a few minutes; Python and JavaScript work in the meantime.`;
}

export function compileFailure(c) {
  return {
    stdout: '', stderr: c.stderr || c.stdout || 'Compilation failed.', exitCode: c.exitCode ?? 1,
    timeMs: c.timeMs, timedOut: false, truncated: c.truncated,
    compile: { stdout: c.stdout, stderr: c.stderr, exitCode: c.exitCode, timeMs: c.timeMs },
    compileError: true,
  };
}

// Single snippet. Returns [result, httpStatus].
export async function execute(language, code, stdin = '', factory = getFactory()) {
  if (!RUN_LANGUAGES.includes(language)) return [{ error: `Unsupported language: ${language}. Supported: ${RUN_LANGUAGES.join(', ')}.` }, 400];
  if (typeof code !== 'string' || !code.trim()) return [{ error: 'No code submitted' }, 400];
  if (code.length > MAX_CODE) return [{ error: 'Code is too large (200 KB max).' }, 413];
  if ((stdin || '').length > MAX_STDIN) return [{ error: 'Input is too large (100 KB max).' }, 413];

  const s = new RunSession(language, code, factory);
  try {
    await s.open();
    const c = await s.prepare();
    if (c && c.error) return [{ error: c.error }, 400];
    if (c && c.exitCode !== 0) {
      if (missingTool(c)) return [{ error: missingMessage(language) }, 503];
      return [compileFailure(c), 200];
    }
    const r = await s.run(stdin);
    if (missingTool(r)) return [{ error: missingMessage(language) }, 503];
    r.compile = c ? { stdout: c.stdout, stderr: c.stderr, exitCode: c.exitCode, timeMs: c.timeMs } : null;
    r.compileError = false;
    return [r, 200];
  } catch (e) {
    return [{ error: `The sandbox service failed: ${e?.message || e}` }, 502];
  } finally {
    await s.close();
  }
}
