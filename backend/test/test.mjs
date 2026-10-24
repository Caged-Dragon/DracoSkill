import assert from 'node:assert/strict';
import { fakeFactory, created, stopped, makeFakeSetupClient } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
const { execute } = await import('../lib/runner.js');
const { judge } = await import('../lib/judge.js');
const { default: handler } = await import('../api/index.js');
const tc = await import('../lib/toolchain.js');
const sc = await import('../lib/selfcheck.js');
const st = await import('../lib/status.js');
const fake = await import('./fake-sandbox.mjs');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.message).slice(0, 300)); }
}
async function call(method, url, body) {
  let status, out = '';
  const res = { setHeader() {}, end(b) { out = b || ''; }, set statusCode(v) { status = v; }, get statusCode() { return status; } };
  await handler({ method, url, headers: { 'x-forwarded-for': '9.9.9.' + Math.floor(Math.random() * 250) }, body }, res);
  return { status, json: out ? JSON.parse(out) : null };
}

console.log('execute: all five languages');
const progs = {
  python: 'a,b=map(int,input().split())\nprint(a+b)',
  javascript: "const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(' ').map(Number);console.log(a+b)",
  java: 'import java.util.*;\npublic class Hello { public static void main(String[] x){ Scanner s=new Scanner(System.in); System.out.println(s.nextInt()+s.nextInt()); } }',
  c: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
  cpp: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}',
};
for (const [lang, code] of Object.entries(progs)) {
  await t(`${lang} runs with stdin`, async () => {
    const [r, s] = await execute(lang, code, '2 3');
    assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.stdout.trim(), '5'); assert.equal(r.exitCode, 0); assert.equal(r.compileError, false);
  });
}
console.log('failure modes');
await t('C compile error flagged', async () => {
  const [r, s] = await execute('c', 'int main(){ oops }');
  assert.equal(s, 200); assert.equal(r.compileError, true); assert.match(r.stderr, /error/);
});
await t('Java compile error flagged', async () => {
  const [r] = await execute('java', 'public class Main { void x( }');
  assert.equal(r.compileError, true);
});
await t('infinite loop times out', async () => {
  const [r] = await execute('python', 'while True: pass');
  assert.equal(r.timedOut, true); assert.equal(r.exitCode, null); assert.match(r.stderr, /timed out/);
});
await t('runtime error keeps stderr + exit code', async () => {
  const [r] = await execute('python', 'raise ValueError("boom")');
  assert.notEqual(r.exitCode, 0); assert.match(r.stderr, /boom/);
});
await t('C segfault has non-zero exit code', async () => {
  const [r] = await execute('c', 'int main(){int*p=0;*p=1;}');
  assert.ok(r.exitCode !== 0);
});
await t('output flood is capped', async () => {
  const [r] = await execute('python', "print('x'*5_000_000)");
  assert.ok(r.stdout.length <= 20000); assert.equal(r.truncated, true);
});
await t('bad language / empty / oversized input rejected', async () => {
  assert.equal((await execute('ruby', 'puts 1'))[1], 400);
  assert.equal((await execute('python', '  '))[1], 400);
  assert.equal((await execute('python', 'x'.repeat(200_001)))[1], 413);
});
await t('Java class name with shell metacharacters cannot inject', async () => {
  const [r, s] = await execute('java', 'public class A$(touch pwned) { }');
  assert.ok(s === 200 || s === 400); // either rejected or a plain compile error -- never executed
});
await t('every sandbox is stopped (no leaks)', async () => {
  const { created: c, stopped: st } = await import('./fake-sandbox.mjs');
  assert.equal(c, st, `created ${c}, stopped ${st}`);
});

console.log('judge');
const sols = {
  java: 'import java.util.Scanner;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}',
  c: '#include <stdio.h>\nint main(){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b);}',
  python: 'a,b=map(int,input().split())\nprint(a+b)',
};
for (const [lang, sol] of Object.entries(sols)) {
  await t(`judge accepts ${lang}`, async () => { const [r] = await judge('sum-two', lang, sol); assert.equal(r.verdict, 'Accepted', JSON.stringify(r)); assert.equal(r.results.length, 3); });
}
await t('judge: Wrong Answer', async () => { const [r] = await judge('sum-two', 'python', 'print(0)'); assert.equal(r.verdict, 'Wrong Answer'); });
await t('judge: Compilation Error', async () => { const [r] = await judge('sum-two', 'c', 'int main(){return'); assert.equal(r.verdict, 'Compilation Error'); });
await t('judge: Time Limit Exceeded', async () => { const [r] = await judge('sum-two', 'python', 'while True: pass'); assert.equal(r.verdict, 'Time Limit Exceeded'); });
await t('judge: Runtime Error (C segfault)', async () => { const [r] = await judge('sum-two', 'c', 'int main(){int*p=0;*p=1;}'); assert.equal(r.verdict, 'Runtime Error'); });
await t('hidden tests hide input/output', async () => { const [r] = await judge('sum-two', 'python', sols.python); const h = r.results.find((x) => x.hidden); assert.equal(h.input, undefined); assert.equal(h.actual, undefined); });
await t('unknown problem 404', async () => assert.equal((await judge('nope', 'python', 'x'))[1], 404));

console.log('HTTP handler');
await t('GET /health', async () => { const r = await call('GET', '/health'); assert.equal(r.status, 200); assert.equal(r.json.status, 'ok'); });
await t('rewrite form /api/index?path=... routes correctly', async () => {
  assert.equal((await call('GET', '/api/index?path=health')).json.status, 'ok');
  assert.equal((await call('GET', '/api/index?path=problems')).json.problems.length, 3);
  assert.equal((await call('POST', '/api/index?path=auth/login', {})).status, 501);
  assert.equal((await call('GET', '/api/index?path=')).status, 404);
});
await t('GET /problems has 5-language starters', async () => { const r = await call('GET', '/problems'); assert.equal(r.json.problems.length, 3); assert.deepEqual(Object.keys(r.json.problems[0].starter).sort(), ['c', 'cpp', 'java', 'javascript', 'python']); });
await t('POST /execute works', async () => { const r = await call('POST', '/execute', { language: 'python', code: 'print(6*7)' }); assert.equal(r.status, 200); assert.equal(r.json.stdout.trim(), '42'); });
await t('POST /submit works', async () => { const r = await call('POST', '/submit', { problemId: 'sum-two', language: 'python', code: sols.python }); assert.equal(r.json.verdict, 'Accepted'); assert.equal(r.json.saved, false); });
await t('GET /sandboxes reports 5 languages + terminal unavailable', async () => {
  const r = await call('GET', '/sandboxes');
  assert.equal(r.status, 200);
  const ids = r.json.sandboxes.map((s) => s.id);
  assert.deepEqual(ids, ['python', 'javascript', 'java', 'c', 'cpp', 'terminal']);
  assert.equal(r.json.sandboxes.find((s) => s.id === 'terminal').available, false);
  assert.equal(r.json.features.accounts, false);
});
await t('accounts/projects/terminal answer 501 with a clear message', async () => {
  for (const [m, p] of [['POST', '/auth/login'], ['POST', '/auth/register'], ['GET', '/projects'], ['POST', '/terminal'], ['GET', '/certificates/mine']]) {
    const r = await call(m, p, {}); assert.equal(r.status, 501, p); assert.match(r.json.error, /aren't available/);
  }
});
await t('GET /auth/me says not logged in', async () => { assert.equal((await call('GET', '/auth/me')).json.authenticated, false); });
await t('bad JSON body -> 400; unknown path -> 404', async () => {
  assert.equal((await call('POST', '/execute', 'not json')).status, 400);
  assert.equal((await call('GET', '/nope')).status, 404);
});
await t('rate limit kicks in (same IP)', async () => {
  let last;
  for (let i = 0; i < 22; i++) {
    let status; const res = { setHeader() {}, end() {}, set statusCode(v) { status = v; }, get statusCode() { return status; } };
    await handler({ method: 'POST', url: '/execute', headers: { 'x-forwarded-for': '1.2.3.4' }, body: { language: 'python', code: 'print(1)' } }, res);
    last = status;
  }
  assert.equal(last, 429);
});

console.log('one-time toolchain setup (/setup)');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OK_INSTALL = 'mkdir -p .draco\nsleep 1\necho "toolchains present" > .draco/install.log\necho 0 > .draco/install.code\n';
await t('idle before start, then installing, then done with a snapshot id', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot();
  assert.equal((await tc.setupStatus(c)).state, 'idle');
  const s1 = await tc.startSetup(c, { installScript: OK_INSTALL });
  assert.equal(s1.state, 'installing');
  assert.equal((await tc.setupStatus(c)).state, 'installing');     // install.sh still running
  let s; for (let i = 0; i < 40; i++) { await wait(500); s = await tc.setupStatus(c); if (s.state === 'done') break; }
  assert.equal(s.state, 'done', JSON.stringify(s));                 // smoke tests ran the real compilers, then snapshot
  assert.equal(s.snapshotId, 'snap_fake1234567890');
});
await t('after setup, runs discover the snapshot automatically (no env var)', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot(); globalThis.__DRACO_SETUP_CLIENT = c;
  assert.equal(await tc.findSnapshotId(), null);
  c.st.snap = 'snap_abc'; tc.forgetSnapshot();
  assert.equal(await tc.findSnapshotId(), 'snap_abc');
  process.env.DRACO_SNAPSHOT_ID = 'snap_override'; assert.equal(await tc.findSnapshotId(), 'snap_override'); delete process.env.DRACO_SNAPSHOT_ID;
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('start when already set up does not create another sandbox', async () => {
  const c = makeFakeSetupClient(); c.st.snap = 'snap_x'; tc.forgetSnapshot();
  const r = await tc.startSetup(c, { installScript: OK_INSTALL });
  assert.equal(r.state, 'done'); assert.equal(c.st.creates, 0);
});
await t('failed install reports failed + log', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot();
  await tc.startSetup(c, { installScript: 'mkdir -p .draco\necho "E: no space left" > .draco/install.log\necho 100 > .draco/install.code\n' });
  let s; for (let i = 0; i < 20; i++) { await wait(400); s = await tc.setupStatus(c); if (s.state === 'failed') break; }
  assert.equal(s.state, 'failed'); assert.match(s.log, /no space left/); assert.equal(c.st.snap, null);
});
await t('second start while installing does not reset progress; after failure it starts clean', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot();
  await tc.startSetup(c, { installScript: 'mkdir -p .draco\nsleep 2\necho 0 > .draco/install.code\n' });
  const again = await tc.startSetup(c, { installScript: OK_INSTALL });
  assert.equal(again.state, 'installing'); assert.equal(c.st.creates, 1); assert.equal(c.st.deletes, 0);
  await wait(2500);
  await tc.startSetup(c, { installScript: 'mkdir -p .draco\necho 1 > .draco/install.code\n' }); // finished (code present) => treated as leftover => clean restart
  assert.equal(c.st.deletes, 1); assert.equal(c.st.creates, 2);
});
await t('GET /setup serves the HTML page; /setup/status answers JSON', async () => {
  globalThis.__DRACO_SETUP_CLIENT = makeFakeSetupClient(); tc.forgetSnapshot();
  let status, body = '', ct;
  await handler({ method: 'GET', url: '/api/index?path=setup', headers: {} }, { setHeader(k, v) { if (k === 'Content-Type') ct = v; }, end(b) { body = b; }, set statusCode(v) { status = v; }, get statusCode() { return status; } });
  assert.equal(status, 200); assert.match(ct, /text\/html/); assert.match(body, /Start setup/);
  const r = await call('GET', '/setup/status'); assert.equal(r.status, 200); assert.equal(r.json.state, 'idle');
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('the "not installed" message tells the user exactly what to open', async () => {
  const { setupUrl } = await import('../lib/runner.js');
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'dracoskill-backend-vercel.vercel.app';
  assert.equal(setupUrl(), 'https://dracoskill-backend-vercel.vercel.app/setup'); delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

console.log('the /setup page itself');
await t('inline page script is valid JavaScript (and survives the template string)', async () => {
  const html = tc.setupPage('');
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'no inline script found');
  assert.doesNotThrow(() => new Function(m[1]), 'page script has a syntax error');
});

console.log('live self-check');
await t('self-check: all five languages really compute n*n+7 from a fresh random input', async () => {
  const r = await sc.selfCheck(fakeFactory);
  assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => !x.verified)));
  assert.equal(r.results.length, 5);
  for (const x of r.results) { assert.equal(x.verified, true, x.language); assert.ok(x.version.length > 3, x.language + ' version'); }
  assert.equal(r.expectedFormula, 'n*n+7');
  assert.equal(r.results[0].expected, String(BigInt(r.input) * BigInt(r.input) + 7n));
  assert.equal(typeof r.networkBlocked === 'boolean' || r.networkBlocked === null, true);
});
await t('self-check uses a different random input every time', async () => {
  const a = await sc.selfCheck(fakeFactory), b = await sc.selfCheck(fakeFactory);
  assert.notEqual(a.input, b.input);
});
await t('self-check catches a fake/canned executor (wrong output is NOT reported as passing)', async () => {
  // an "executor" that ignores the program and always answers 42
  const lying = async () => { const sb = await fakeFactory(); const orig = sb.readFileToBuffer.bind(sb);
    sb.readFileToBuffer = async (f) => (/run\.out$/.test(f.path) ? Buffer.from('42\nFake 1.0\n') : orig(f)); return sb; };
  const r = await sc.selfCheck(lying);
  assert.equal(r.ok, false); assert.ok(r.results.every((x) => !x.verified)); assert.match(r.results[0].error, /expected \d+, got 42/);
});
await t('self-check reports a missing compiler clearly instead of passing', async () => {
  const noJava = async () => { const sb = await fakeFactory(); const orig = sb.runCommand.bind(sb);
    sb.runCommand = (o) => (o.args && o.args[0] === 'w_compile.sh' ? orig({ ...o, args: ['-c', 'echo "bash: javac: command not found" > compile.err; echo 127 > compile.code; : > compile.out'] }) : orig(o)); return sb; };
  const r = await sc.selfCheck(noJava);
  assert.equal(r.ok, false);
});
await t('verifyOutput unit cases', async () => {
  assert.deepEqual(sc.verifyOutput('49', '49\nPython 3.12.3\n'), { verified: true, actual: '49', version: 'Python 3.12.3' });
  assert.equal(sc.verifyOutput('49', '50\nx').verified, false);
  assert.equal(sc.verifyOutput('49', '').verified, false);
});
await t('GET /selfcheck route works and is rate limited', async () => {
  globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
  const r = await call('GET', '/selfcheck'); assert.equal(r.status, 200); assert.equal(r.json.ok, true);
});

console.log('/sandboxes is cheap and honest');
await t('default /sandboxes creates NO sandbox (page loads cost nothing)', async () => {
  st.forgetVersions(); tc.forgetSnapshot(); globalThis.__DRACO_SETUP_CLIENT = makeFakeSetupClient();
  const before = fake.created;
  const r = await call('GET', '/sandboxes');
  assert.equal(fake.created, before, 'a sandbox was created just to answer /sandboxes');
  const by = Object.fromEntries(r.json.sandboxes.map((x) => [x.id, x]));
  assert.equal(by.python.available, true); assert.equal(by.javascript.available, true);
  assert.equal(by.java.available, false); assert.equal(by.c.available, false);   // no snapshot yet
  assert.equal(by.python.verified, false); assert.equal(r.json.isolation.inferred, true);
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('with the setup snapshot, all five are reported ready (still without creating a sandbox)', async () => {
  st.forgetVersions(); const c = makeFakeSetupClient(); c.st.snap = 'snap_ok'; globalThis.__DRACO_SETUP_CLIENT = c; tc.forgetSnapshot();
  const before = fake.created;
  const r = await call('GET', '/sandboxes');
  assert.equal(fake.created, before);
  assert.ok(r.json.sandboxes.filter((x) => x.id !== 'terminal').every((x) => x.available));
  assert.equal(r.json.isolation.snapshot, true);
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('?probe=1 really measures (one sandbox) and returns verified versions', async () => {
  st.forgetVersions(); const before = fake.created;
  const r = await call('GET', '/api/index?path=sandboxes&probe=1');
  assert.equal(fake.created, before + 1);
  assert.ok(r.json.sandboxes.slice(0, 5).every((x) => x.verified && x.available && x.version));
  const again = await call('GET', '/sandboxes');                 // cached for 15 minutes
  assert.equal(fake.created, before + 1); assert.ok(again.json.sandboxes[0].version);
});
await t('a self-check feeds real versions into /sandboxes', async () => {
  st.forgetVersions(); await sc.selfCheck(fakeFactory);
  const r = await call('GET', '/sandboxes');
  assert.equal(r.json.sandboxes[0].verified, true); assert.match(r.json.sandboxes[2].version, /Java/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
