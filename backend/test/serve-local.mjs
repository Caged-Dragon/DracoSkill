// Serves api/index.js on http://localhost:8787 using the LOCAL sandbox stand-in,
// so the frontend can be tried against this backend without a Vercel account.
import http from 'node:http';
import { fakeFactory } from './fake-sandbox.mjs';
import { makeFakeSetupClient } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
if (process.env.FAKE_SNAPSHOT === '1') { const c = makeFakeSetupClient(); c.st.snap = 'snap_local'; globalThis.__DRACO_SETUP_CLIENT = c; } // pretend /setup was already run
const { default: handler } = await import('../api/index.js');
http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  try { req.body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : raw || undefined; } catch { req.body = raw; }
  res.json = undefined;
  await handler(req, res);
}).listen(Number(process.env.PORT || 8787), () => console.log('local vercel-style backend on', process.env.PORT || 8787));
