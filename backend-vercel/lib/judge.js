// Same verdict rules as backend/judge.py, but all tests share ONE sandbox:
// compile once, run every test case. Hidden tests still run for real; their
// input and the submitter's output are just not returned.
import problems from './problems.json' with { type: 'json' };
import { RUN_LANGUAGES, RunSession, compileFailure, MAX_CODE, getFactory } from './runner.js';

export function listProblems() {
  return Object.values(problems).map(({ id, title, difficulty, description, starter }) => ({ id, title, difficulty, description, starter }));
}

export async function judge(problemId, language, code, factory = getFactory()) {
  const problem = problems[problemId];
  if (!problem) return [{ error: `Unknown problem: ${problemId}` }, 404];
  if (!RUN_LANGUAGES.includes(language)) return [{ error: `Unsupported language: ${language}.` }, 400];
  if (typeof code !== 'string' || !code.trim()) return [{ error: 'No code submitted' }, 400];
  if (code.length > MAX_CODE) return [{ error: 'Code is too large (200 KB max).' }, 413];

  const s = new RunSession(language, code, factory);
  try {
    await s.open();
    const c = await s.prepare();
    if (c && c.error) return [{ error: c.error }, 400];
    if (c && c.exitCode !== 0) {
      if (c.exitCode === 127 && /not found/i.test(c.stderr || '')) return [{ error: `${language} isn't installed in the sandbox image.` }, 503];
      const f = compileFailure(c);
      return [{
        verdict: 'Compilation Error',
        results: problem.tests.map((t, index) => ({ index, hidden: !!t.hidden, pass: false, stderr: f.stderr })),
      }, 200];
    }

    const results = [];
    let allPassed = true, sawTimeout = false, sawRuntimeError = false;
    for (let i = 0; i < problem.tests.length; i++) {
      const t = problem.tests[i];
      const res = await s.run(t.input);
      const badExit = res.exitCode !== 0 && res.exitCode !== null;
      const hasStderr = !!res.stderr || badExit;
      const actual = (res.stdout || '').trim();
      const expected = t.expected.trim();
      const passed = !res.timedOut && !hasStderr && actual === expected;
      if (res.timedOut) sawTimeout = true; else if (hasStderr) sawRuntimeError = true;
      if (!passed) allPassed = false;
      const entry = { index: i, hidden: !!t.hidden, pass: passed };
      if (!t.hidden) { entry.input = t.input; entry.expected = expected; entry.actual = actual; }
      if (hasStderr) entry.stderr = res.stderr || `Process exited with code ${res.exitCode}`;
      results.push(entry);
    }
    const verdict = allPassed ? 'Accepted' : sawTimeout ? 'Time Limit Exceeded' : sawRuntimeError ? 'Runtime Error' : 'Wrong Answer';
    return [{ verdict, results, saved: false }, 200];
  } catch (e) {
    return [{ error: `The sandbox service failed: ${e?.message || e}` }, 502];
  } finally {
    await s.close();
  }
}
