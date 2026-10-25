// DracoSkill online compiler API on Vercel. One function, routed by path:
//   POST /execute    run one program (python, javascript, java, c, cpp) with optional stdin
//   GET  /sandboxes  which languages this server can run (free, no sandbox is created)
//   GET  /setup      one-time page that installs the compilers; GET /selfcheck proves they really run
//   GET  /health
import { execute } from '../lib/runner.js';
import { describe } from '../lib/status.js';
import { setupPage, startSetup, setupStatus } from '../lib/toolchain.js';
import { selfCheck } from '../lib/selfcheck.js';

const hits = new Map();

function limited(key, max, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return false;
}

// ALLOWED_ORIGINS (comma separated, e.g. https://dracoskill-frontend.vercel.app) limits which websites may use this API.
// Unset = open to every site (so a fresh deploy just works). Same-origin calls (the /setup page) are always allowed.
// HONEST LIMIT: this stops other WEBSITES from spending your quota through visitors' browsers. It cannot stop a script that
// forges the Origin header; the per-address rate limit and the monthly allowance are the backstops for that.
function allowedList() { return (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean); }
function originAllowed(req) {
  const list = allowedList();
  const origin = req.headers.origin;
  if (!list.length || !origin) return true;                       // no Origin header = not a browser cross-site call
  try { if (new URL(origin).host === req.headers.host) return true; } catch { return false; }
  return list.includes(origin.replace(/\/$/, ''));
}
function applyCors(req, res) {
  const list = allowedList();
  if (!list.length) { res.setHeader('Access-Control-Allow-Origin', '*'); return; }
  res.setHeader('Vary', 'Origin');
  if (originAllowed(req) && req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // vercel.json rewrites every request to this function as /api/index?path=<original path>, so the
  // route never depends on how Vercel presents req.url. Falls back to req.url for direct calls/tests.
  const u = new URL(req.url, 'http://x');
  const forwarded = u.searchParams.get('path');
  const raw = forwarded !== null && u.pathname.startsWith('/api') ? '/' + forwarded : u.pathname;
  const path = raw.replace(/\/+$/, '') || '/';
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
    return res.end();
  }
  try {
    // every route can spend sandbox quota (POST /execute, /setup/start, GET /selfcheck, ?probe=1), so the check comes first
    if (!originAllowed(req)) return send(res, 403, { error: 'This website is not allowed to use this server.' });
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
    if (req.method === 'POST' && Number(req.headers['content-length'] || 0) > 400_000) return send(res, 413, { error: 'Request is too large.' });
    if (req.method === 'POST' && path === '/execute') {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited(ip, 20)) return send(res, 429, { error: 'Too many runs. Slow down a little.' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid JSON body' });
      const [result, status] = await execute(body.language, body.code, body.stdin || '');
      return send(res, status, result);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 500, { error: 'Internal error' });
  }
}
