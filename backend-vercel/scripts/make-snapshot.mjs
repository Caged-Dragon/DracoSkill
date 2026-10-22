// One-time setup: build a sandbox image that has every toolchain, snapshot it,
// and print the snapshot id to put in DRACO_SNAPSHOT_ID.
//
//   cd backend-vercel
//   npm install
//   npx vercel link            # link this folder to your backend Vercel project
//   npx vercel env pull        # gives the SDK a token (.env.local)
//   node --env-file=.env.local scripts/make-snapshot.mjs
//
// Uses one sandbox creation + a few minutes of the free Hobby allowance.
import { Sandbox } from '@vercel/sandbox';

const TOOLS = ['python3', 'node', 'javac', 'java', 'gcc', 'g++'];

const sb = await Sandbox.create({ timeout: 15 * 60_000, persistent: false, resources: { vcpus: 2 } });
console.log('sandbox created:', sb.name ?? '(unnamed)');

async function sh(script, sudo = false) {
  const r = await sb.runCommand({ cmd: 'bash', args: ['-c', script], sudo });
  return { code: r.exitCode, out: (await r.stdout()).trim(), err: (await r.stderr()).trim() };
}
async function missing() {
  const out = [];
  for (const t of TOOLS) if ((await sh(`command -v ${t}`)).code !== 0) out.push(t);
  return out;
}

try {
  console.log('OS:', (await sh('. /etc/os-release && echo "$PRETTY_NAME"')).out);
  let miss = await missing();
  console.log('missing before install:', miss.length ? miss.join(', ') : 'none');

  if (miss.length) {
    const hasApt = (await sh('command -v apt-get')).code === 0;
    const hasDnf = (await sh('command -v dnf')).code === 0;
    let cmd;
    if (hasApt) cmd = 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get install -y gcc g++ default-jdk-headless nodejs python3';
    else if (hasDnf) cmd = 'dnf install -y gcc gcc-c++ java-21-openjdk-devel nodejs python3';
    else throw new Error('No apt-get or dnf found; install the toolchains manually.');
    console.log('installing with', hasApt ? 'apt-get' : 'dnf', '(this takes a few minutes)...');
    const r = await sh(cmd, true);
    console.log(r.code === 0 ? 'install finished' : `install exited ${r.code}\n${r.err.slice(-800)}`);
    miss = await missing();
  }

  if (miss.length) {
    console.error('\nStill missing:', miss.join(', '), '\nNot snapshotting. Fix the install above and rerun.');
    await sb.stop();
    process.exit(1);
  }

  // Prove each toolchain really works before freezing the image.
  await sb.writeFiles([
    { path: '/vercel/sandbox/t.c', content: Buffer.from('#include <stdio.h>\nint main(){puts("ok");}') },
    { path: '/vercel/sandbox/t.cpp', content: Buffer.from('#include <iostream>\nint main(){std::cout<<"ok\\n";}') },
    { path: '/vercel/sandbox/T.java', content: Buffer.from('public class T{public static void main(String[] a){System.out.println("ok");}}') },
  ]);
  const smoke = {
    python: 'python3 -c "print(\'ok\')"', node: 'node -e "console.log(\'ok\')"',
    c: 'cd /vercel/sandbox && gcc t.c -o tc && ./tc', cpp: 'cd /vercel/sandbox && g++ t.cpp -o tcpp && ./tcpp',
    java: 'cd /vercel/sandbox && javac T.java && java T',
  };
  let bad = false;
  for (const [k, c] of Object.entries(smoke)) {
    const r = await sh(c);
    const good = r.code === 0 && r.out.split('\n').pop() === 'ok';
    console.log(`  ${good ? 'OK ' : 'FAIL'} ${k}`);
    if (!good) { bad = true; console.log('     ', (r.err || r.out).slice(0, 300)); }
  }
  if (bad) { await sb.stop(); process.exit(1); }
  await sh('rm -f /vercel/sandbox/t.c /vercel/sandbox/t.cpp /vercel/sandbox/T.java /vercel/sandbox/tc /vercel/sandbox/tcpp /vercel/sandbox/*.class');

  const snap = await sb.snapshot({ expiration: 0 }); // 0 = never expires
  console.log('\nSnapshot created.\n');
  console.log('  DRACO_SNAPSHOT_ID=' + snap.snapshotId + '\n');
  console.log('Add that as an Environment Variable on the BACKEND Vercel project, then redeploy.');
} catch (e) {
  console.error('\nFailed:', e?.message || e);
  try { await sb.stop(); } catch {}
  process.exit(1);
}
