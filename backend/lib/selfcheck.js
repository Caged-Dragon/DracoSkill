// Live self-check: proves, on THIS deployment, that code really executes.
//
// A fresh random number N is generated per check. Each of the five programs must READ N from stdin,
// compute N*N+7 with real arithmetic, and print the result plus its own toolchain version.
// The server compares the first output line with the value it computed itself. A canned or cached
// answer cannot pass, because N is different every time. One extra program tries to open an outbound
// connection to confirm the sandbox network really is blocked.
//
// All six programs run in ONE sandbox (one creation from the free allowance).
import { RunSession, getFactory, LABELS } from './runner.js';
import { findSnapshotId } from './toolchain.js';
import { rememberVersions } from './status.js';
import { randomInt } from 'node:crypto';

const PROGRAMS = {
  python: `import sys
n = int(sys.stdin.readline())
print(n * n + 7)
print("Python " + sys.version.split()[0])
`,
  javascript: `const n = BigInt(require('fs').readFileSync(0, 'utf8').trim());
console.log((n * n + 7n).toString());
console.log('Node ' + process.version);
`,
  java: `import java.util.Scanner;
public class SelfCheck {
    public static void main(String[] args) {
        long n = new Scanner(System.in).nextLong();
        System.out.println(n * n + 7);
        System.out.println("Java " + System.getProperty("java.version"));
    }
}
`,
  c: `#include <stdio.h>
int main(void) {
    long long n;
    scanf("%lld", &n);
    printf("%lld\\n", n * n + 7);
    printf("C (gcc %s)\\n", __VERSION__);
    return 0;
}
`,
  cpp: `#include <iostream>
int main() {
    long long n;
    std::cin >> n;
    std::cout << n * n + 7 << "\\n";
    std::cout << "C++ (g++ " << __VERSION__ << ")" << "\\n";
    return 0;
}
`,
};

const NET_PROBE = `import socket
try:
    socket.create_connection(("1.1.1.1", 53), timeout=3)
    print("OPEN")
except Exception:
    print("BLOCKED")
`;

// Pure function, unit-tested: does the program's stdout carry the right answer?
export function verifyOutput(expected, stdout) {
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { verified: lines[0] === String(expected), actual: lines[0] ?? '', version: lines[1] ?? '' };
}

export async function selfCheck(factory = getFactory(), randomN = () => randomInt(100_000, 9_000_000)) {
  const n = randomN();
  const expected = String(BigInt(n) * BigInt(n) + 7n);
  const startedAt = Date.now();
  const snapshotId = await findSnapshotId().catch(() => null);
  const results = [];
  let networkBlocked = null;
  let shared;
  try {
    shared = await factory();
    const same = async () => shared; // all programs share one sandbox
    for (const [language, code] of Object.entries(PROGRAMS)) {
      const row = { language, label: LABELS[language], verified: false, expected, actual: '', version: '', timeMs: 0 };
      try {
        const s = new RunSession(language, code, same);
        await s.open();
        const c = await s.prepare();
        if (c && c.exitCode !== 0) {
          row.error = c.exitCode === 127 ? 'compiler not installed in the sandbox image' : (c.stderr || c.stdout || 'compilation failed').slice(0, 400);
        } else {
          const r = await s.run(String(n));
          row.timeMs = r.timeMs;
          if (r.exitCode === 127 && /not found/i.test(r.stderr || '')) row.error = 'runtime not installed in the sandbox image';
          else if (r.timedOut) row.error = 'timed out';
          else if (r.exitCode !== 0) row.error = (r.stderr || `exit code ${r.exitCode}`).slice(0, 400);
          else Object.assign(row, verifyOutput(expected, r.stdout));
          if (!row.verified && !row.error) row.error = `expected ${expected}, got ${row.actual || '(nothing)'}`;
        }
      } catch (e) {
        row.error = String(e?.message || e).slice(0, 400);
      }
      results.push(row);
    }
    try {
      const p = new RunSession('python', NET_PROBE, async () => shared);
      await p.open();
      const r = await p.run('');
      networkBlocked = r.stdout.trim() === 'BLOCKED' ? true : r.stdout.trim() === 'OPEN' ? false : null;
    } catch { networkBlocked = null; }
  } catch (e) {
    return { ok: false, error: `Could not start a sandbox: ${e?.message || e}`, results, usedSnapshot: !!snapshotId };
  } finally {
    try { await shared?.stop(); } catch { /* already stopped */ }
  }
  // a self-check is a real measurement: remember it so /sandboxes can show real versions without spending a sandbox
  const seen = {};
  for (const r of results) if (r.verified) seen[r.language] = r.version;
  rememberVersions(seen);
  return {
    ok: results.every((r) => r.verified),
    input: n, expectedFormula: 'n*n+7',
    results, networkBlocked,
    usedSnapshot: !!snapshotId,
    totalMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
}
