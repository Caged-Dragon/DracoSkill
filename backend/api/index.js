// DracoSkill execution API on Vercel. One function, routed by path, so the
// frontend's existing calls (/health, /sandboxes, /execute, /problems, /submit)
// work unchanged. Accounts, projects, the terminal and certificates need a
// database and persistent disk that Vercel functions don't have; they answer
// 501 with a clear message (see README → "What this backend does not do").
import { execute } from '../lib/runner.js';
import { judge, listProblems } from '../lib/judge.js';
import { describe } from '../lib/status.js';
import { setupPage, startSetup, setupStatus } from '../lib/toolchain.js';
import { selfCheck } from '../lib/selfcheck.js';

const NOT_HERE = /^\/(auth|projects|terminal|certificates|confirmation|submissions)(\/|$)/;
const hits = new Map();

function limited(key, max, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return false;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // vercel.json rewrites every request to this function as /api/index?path=<original path>, so the
  // route never depends on how Vercel presents req.url. Falls back to req.url for direct calls/tests.
  const u = new URL(req.url, 'http://x');
  const forwarded = u.searchParams.get('path');
  const raw = forwarded !== null && u.pathname.startsWith('/api') ? '/' + forwarded : u.pathname;
  const path = raw.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
    return res.end();
  }
  try {
    if (req.method === 'GET' && path === '/setup') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(setupPage());
    }
    if (path === '/selfcheck' && req.method === 'GET') {
      const ipc = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited('selfcheck:' + ipc, 4)) return send(res, 429, { error: 'Self-check runs at most 4 times a minute.' });
      return send(res, 200, await selfCheck());
    }
    if (path === '/setup/status' && req.method === 'GET') return send(res, 200, await setupStatus());
    if (path === '/setup/start' && req.method === 'POST') {
      const ip0 = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited('setup:' + ip0, 6)) return send(res, 429, { error: 'Too many setup requests. Wait a minute.' });
      return send(res, 200, await startSetup());
    }
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', service: 'dracoskill-execution', backend: 'vercel-sandbox' });
    if (req.method === 'GET' && path === '/sandboxes') return send(res, 200, await describe(undefined, { probe: new URL(req.url, 'http://x').searchParams.get('probe') === '1' }));
    if (req.method === 'GET' && path === '/problems') return send(res, 200, { problems: listProblems() });
    if (req.method === 'GET' && path === '/auth/me') return send(res, 200, { authenticated: false, username: null });

    if (NOT_HERE.test(path)) {
      return send(res, 501, { error: "Accounts, projects, the terminal and certificates aren't available on the Vercel backend. Anonymous code running works; use the Python backend (Render/self-hosted) for the full platform." });
    }

    if (req.method === 'POST' && (path === '/execute' || path === '/submit')) {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited(ip, 20)) return send(res, 429, { error: 'Too many runs. Slow down a little.' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid JSON body' });
      const [result, status] = path === '/execute'
        ? await execute(body.language, body.code, body.stdin || '')
        : await judge(body.problemId, body.language, body.code);
      return send(res, status, result);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 500, { error: 'Internal error' });
  }
}
