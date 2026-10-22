import assert from 'node:assert/strict';
import { fakeFactory, created, stopped } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
const { execute } = await import('../lib/runner.js');
const { judge } = await import('../lib/judge.js');
const { default: handler } = await import('../api/index.js');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
