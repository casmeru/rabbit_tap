import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id   INTEGER PRIMARY KEY,
    username      TEXT,
    first_name    TEXT,
    last_name     TEXT,
    coins         REAL NOT NULL DEFAULT 0,
    total_coins   REAL NOT NULL DEFAULT 0,
    level         INTEGER NOT NULL DEFAULT 1,
    energy        REAL NOT NULL DEFAULT 1000,
    max_energy    REAL NOT NULL DEFAULT 1000,
    last_energy_ts INTEGER NOT NULL DEFAULT (unixepoch()),
    taps_total    INTEGER NOT NULL DEFAULT 0,
    is_banned     INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const stmts = {
  getUser: db.prepare('SELECT * FROM users WHERE telegram_id = ?'),
  insertUser: db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name, coins, total_coins, level, energy, max_energy, last_energy_ts)
    VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?, unixepoch())
  `),
  touchProfile: db.prepare(`
    UPDATE users SET username = ?, first_name = ?, last_name = ?, updated_at = unixepoch()
    WHERE telegram_id = ?
  `),
  updateState: db.prepare(`
    UPDATE users
    SET coins = ?, total_coins = ?, level = ?, energy = ?, max_energy = ?,
        last_energy_ts = ?, taps_total = ?, updated_at = unixepoch()
    WHERE telegram_id = ?
  `),
  topUsers: db.prepare(`
    SELECT telegram_id, username, first_name, total_coins, level
    FROM users ORDER BY total_coins DESC LIMIT ?
  `),
  communityStats: db.prepare(`
    SELECT
      COUNT(*) AS players,
      COALESCE(SUM(total_coins), 0) AS total_coins,
      COALESCE(SUM(taps_total), 0) AS total_taps,
      COALESCE(MAX(level), 1) AS top_level
    FROM users
  `),
  listUsers: db.prepare(`
    SELECT telegram_id, username, first_name, last_name, coins, total_coins, level,
           energy, max_energy, taps_total, is_banned, created_at, updated_at
    FROM users
    WHERE (@search = '' OR CAST(telegram_id AS TEXT) LIKE @like
           OR username LIKE @like OR first_name LIKE @like OR last_name LIKE @like)
    ORDER BY total_coins DESC
    LIMIT @limit OFFSET @offset
  `),
  countUsers: db.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE (@search = '' OR CAST(telegram_id AS TEXT) LIKE @like
           OR username LIKE @like OR first_name LIKE @like OR last_name LIKE @like)
  `),
  resetUser: db.prepare(`
    UPDATE users SET coins = 0, total_coins = 0, level = 1, energy = ?, max_energy = ?,
           taps_total = 0, last_energy_ts = unixepoch(), updated_at = unixepoch()
    WHERE telegram_id = ?
  `),
  grantUser: db.prepare(`
    UPDATE users SET coins = coins + ?, total_coins = total_coins + ?,
           energy = MIN(max_energy, energy + ?), updated_at = unixepoch()
    WHERE telegram_id = ?
  `),
  setBanned: db.prepare(`
    UPDATE users SET is_banned = ?, updated_at = unixepoch() WHERE telegram_id = ?
  `),
};

export function getUser(telegramId) {
  return stmts.getUser.get(telegramId);
}

export function createUser(telegramId, profile, maxEnergy) {
  stmts.insertUser.run(
    telegramId,
    profile.username ?? null,
    profile.first_name ?? null,
    profile.last_name ?? null,
    maxEnergy,
    maxEnergy
  );
  return getUser(telegramId);
}

export function touchProfile(telegramId, profile) {
  stmts.touchProfile.run(
    profile.username ?? null,
    profile.first_name ?? null,
    profile.last_name ?? null,
    telegramId
  );
}

export function saveState(user) {
  stmts.updateState.run(
    user.coins,
    user.total_coins,
    user.level,
    user.energy,
    user.max_energy,
    user.last_energy_ts,
    user.taps_total,
    user.telegram_id
  );
}

export function getLeaderboard(limit = 20) {
  return stmts.topUsers.all(limit);
}

export function getCommunityStats() {
  return stmts.communityStats.get();
}

export function listUsers({ search = '', limit = 50, offset = 0 } = {}) {
  const like = `%${search}%`;
  return stmts.listUsers.all({ search, like, limit, offset });
}

export function countUsers({ search = '' } = {}) {
  const like = `%${search}%`;
  return stmts.countUsers.get({ search, like }).n;
}

export function resetUser(telegramId, maxEnergy) {
  stmts.resetUser.run(maxEnergy, maxEnergy, telegramId);
  return getUser(telegramId);
}

export function grantUser(telegramId, { coins = 0, energy = 0 } = {}) {
  stmts.grantUser.run(coins, coins, energy, telegramId);
  return getUser(telegramId);
}

export function setBanned(telegramId, banned) {
  stmts.setBanned.run(banned ? 1 : 0, telegramId);
  return getUser(telegramId);
}
