import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { config } from './config.js';
import { validateInitData } from './telegramAuth.js';
import {
  getUser, createUser, touchProfile, saveState, getLeaderboard,
  getCommunityStats, listUsers, countUsers, resetUser, grantUser, setBanned,
} from './db.js';
import { applyEnergyRegen, applyTaps, publicState, maxEnergyFor, recalcLevel } from './game.js';

const FRONTEND_DIR = process.env.FRONTEND_DIR || join(import.meta.dirname, '../../frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function getInitData(req, body) {
  return req.headers['x-telegram-init-data'] || body.initData || '';
}

/** Validate initData, load-or-create user, regen energy, enforce ban. Returns user row or sends an error. */
function authenticate(req, body, res) {
  const result = validateInitData(getInitData(req, body));
  if (!result.ok) {
    sendJson(res, 401, { error: 'unauthorized', reason: result.reason });
    return null;
  }

  const tgUser = result.user;
  let user = getUser(tgUser.id);
  if (!user) {
    user = createUser(tgUser.id, tgUser, maxEnergyFor(1));
  } else {
    touchProfile(tgUser.id, tgUser);
    user = getUser(tgUser.id);
  }

  if (user.is_banned) {
    sendJson(res, 403, { error: 'banned' });
    return null;
  }

  applyEnergyRegen(user);
  return user;
}

/** Validate initData AND require the user's Telegram ID to be in config.adminIds. */
function authenticateAdmin(req, body, res) {
  const result = validateInitData(getInitData(req, body));
  if (!result.ok) {
    sendJson(res, 401, { error: 'unauthorized', reason: result.reason });
    return null;
  }
  if (!config.adminIds.includes(result.user.id)) {
    sendJson(res, 403, { error: 'forbidden', reason: 'not an admin' });
    return null;
  }
  return result.user;
}

const routes = {
  'GET /api/me': async (req, res, body) => {
    const user = authenticate(req, body, res);
    if (!user) return;
    saveState(user);
    sendJson(res, 200, publicState(user));
  },

  'POST /api/tap': async (req, res, body) => {
    const user = authenticate(req, body, res);
    if (!user) return;

    const requested = Number(body.taps);
    if (!Number.isFinite(requested) || requested <= 0 || requested > 200) {
      sendJson(res, 400, { error: 'invalid taps count (1-200 per request)' });
      return;
    }

    const applied = applyTaps(user, Math.floor(requested));
    saveState(user);
    sendJson(res, 200, { ...publicState(user), tapsApplied: applied });
  },

  'GET /api/leaderboard': async (req, res) => {
    const rows = getLeaderboard(20).map((r, i) => ({
      rank: i + 1,
      telegramId: r.telegram_id,
      name: r.username ? `@${r.username}` : (r.first_name || 'Игрок'),
      totalCoins: Math.floor(r.total_coins),
      level: r.level,
    }));
    sendJson(res, 200, { leaderboard: rows });
  },

  'GET /api/community': async (req, res) => {
    const s = getCommunityStats();
    sendJson(res, 200, {
      players: s.players,
      totalCoins: Math.floor(s.total_coins),
      totalTaps: s.total_taps,
      topLevel: s.top_level,
    });
  },

  // ---- Admin ----
  'GET /api/admin/whoami': async (req, res, body) => {
    const admin = authenticateAdmin(req, body, res);
    if (!admin) return;
    sendJson(res, 200, { ok: true, telegramId: admin.id });
  },

  'GET /api/admin/stats': async (req, res, body) => {
    const admin = authenticateAdmin(req, body, res);
    if (!admin) return;
    const s = getCommunityStats();
    sendJson(res, 200, {
      players: s.players,
      totalCoins: Math.floor(s.total_coins),
      totalTaps: s.total_taps,
      topLevel: s.top_level,
    });
  },

  'GET /api/admin/users': async (req, res, body, query) => {
    const admin = authenticateAdmin(req, body, res);
    if (!admin) return;
    const search = query.get('search') || '';
    const limit = Math.min(200, Number(query.get('limit')) || 50);
    const offset = Math.max(0, Number(query.get('offset')) || 0);

    const rows = listUsers({ search, limit, offset }).map((u) => ({
      telegramId: u.telegram_id,
      name: u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Игрок',
      coins: Math.floor(u.coins),
      totalCoins: Math.floor(u.total_coins),
      level: u.level,
      energy: Math.floor(u.energy),
      maxEnergy: u.max_energy,
      tapsTotal: u.taps_total,
      banned: !!u.is_banned,
      createdAt: u.created_at,
    }));
    sendJson(res, 200, { users: rows, total: countUsers({ search }) });
  },

  'POST /api/admin/reset': async (req, res, body) => {
    const admin = authenticateAdmin(req, body, res);
    if (!admin) return;
    const id = Number(body.telegramId);
    if (!id) return sendJson(res, 400, { error: 'telegramId required' });
    const user = resetUser(id, maxEnergyFor(1));
    if (!user) return sendJson(res, 404, { error: 'user not found' });
    sendJson(res, 200, { ok: true, user: publicState(user) });
  },

  'POST /api/admin/grant': async (req, res, body) => {
    const admin = authenticateAdmin(req, body, res);
    if (!admin) return;
    const id = Number(body.telegramId);
    const coins = Number(body.coins) || 0;
    const energy = Number(body.energy) || 0;
    if (!id) return sendJson(res, 400, { error: 'telegramId required' });
    let user = grantUser(id, { coins, energy });
    if (!user) return sendJson(res, 404, { error: 'user not found' });
    recalcLevel(user); // coins/energy were written directly in SQL, so level needs recomputing here
    saveState(user);
    sendJson(res, 200, { ok: true, user: publicState(user) });
  },

  'POST /api/admin/ban': async (req, res, body) => {
    const admin = authenticateAdmin(req, body, res);
    if (!admin) return;
    const id = Number(body.telegramId);
    if (!id) return sendJson(res, 400, { error: 'telegramId required' });
    const user = setBanned(id, !!body.banned);
    if (!user) return sendJson(res, 404, { error: 'user not found' });
    sendJson(res, 200, { ok: true, banned: !!user.is_banned });
  },
};

async function serveStatic(req, res, pathname) {
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(FRONTEND_DIR, safePath);

  if (!filePath.startsWith(FRONTEND_DIR) || !existsSync(filePath)) {
    send(res, 404, 'Not found');
    return;
  }
  const ext = extname(filePath);
  const data = await readFile(filePath);
  send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, '', {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    });
    return;
  }

  const parsedUrl = new URL(req.url, 'http://internal');
  const pathname = parsedUrl.pathname;
  const routeKey = `${req.method} ${pathname}`;
  const handler = routes[routeKey];

  if (handler) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      await handler(req, res, body, parsedUrl.searchParams);
    } catch (err) {
      console.error('Request error:', err);
      sendJson(res, 500, { error: 'internal error' });
    }
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(req, res, pathname);
    return;
  }

  send(res, 404, 'Not found');
});

server.listen(config.port, () => {
  console.log(`🐇 Rabbit Tap backend running on http://localhost:${config.port}`);
  console.log(`   Serving frontend from: ${FRONTEND_DIR}`);
  if (!config.botToken) {
    console.warn('⚠️  BOT_TOKEN is not set — initData validation will fail. Set it in .env');
  }
  if (!config.adminIds.length) {
    console.warn('⚠️  ADMIN_IDS is not set — nobody will have admin access. Set it in .env');
  } else {
    console.log(`   Admins: ${config.adminIds.join(', ')}`);
  }
});
