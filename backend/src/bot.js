// Minimal Telegram bot: /start -> button that opens the Mini App.
// Uses long polling via the Bot API over node:https — no external packages needed.
import { request } from 'node:https';
import { config } from './config.js';

const APP_URL = process.env.WEBAPP_URL || 'https://example.com'; // set to your deployed frontend URL

if (!config.botToken) {
  console.error('BOT_TOKEN is not set. Put it in backend/.env');
  process.exit(1);
}

function api(method, payload) {
  const data = JSON.stringify(payload);
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${config.botToken}/${method}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  };
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  if (msg.text.startsWith('/start')) {
    await api('sendMessage', {
      chat_id: msg.chat.id,
      text: '🐇 Добро пожаловать в Rabbit Tap!\n\nТапай по кролику, зарабатывай монеты и качай уровень.',
      reply_markup: {
        inline_keyboard: [[{ text: '🐇 Играть', web_app: { url: APP_URL } }]],
      },
    });
  }
}

let offset = 0;
async function poll() {
  try {
    const res = await api('getUpdates', { offset, timeout: 25 });
    if (res.ok) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    }
  } catch (err) {
    console.error('Polling error:', err.message);
    await new Promise((r) => setTimeout(r, 2000));
  }
  setImmediate(poll);
}

console.log('🤖 Rabbit Tap bot started (long polling)...');
console.log(`   Mini App URL: ${APP_URL}`);
poll();
