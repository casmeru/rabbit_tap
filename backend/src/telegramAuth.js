import { createHmac } from 'node:crypto';
import { config } from './config.js';

/**
 * Validates Telegram WebApp initData per the official spec:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Returns { ok: true, user, authDate } or { ok: false, reason }.
 */
export function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, reason: 'missing initData' };
  }
  if (!config.botToken) {
    return { ok: false, reason: 'server missing BOT_TOKEN' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing hash' };
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return { ok: false, reason: 'hash mismatch' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > config.initDataMaxAgeSec) {
    return { ok: false, reason: 'initData expired' };
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, reason: 'bad user payload' };
  }
  if (!user || !user.id) {
    return { ok: false, reason: 'missing user' };
  }

  return { ok: true, user, authDate };
}
