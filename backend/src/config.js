// Central game-balance config. Tweak numbers here to rebalance the whole game.

export const config = {
  port: Number(process.env.PORT || 3000),
  botToken: process.env.BOT_TOKEN || '',
  dbPath: process.env.DB_PATH || './data/game.db',

  // How stale initData is allowed to be, in seconds (Telegram sends auth_date).
  initDataMaxAgeSec: 24 * 60 * 60,

  // Telegram numeric user IDs that get admin rights (comma-separated in .env).
  // Find your own ID by messaging @userinfobot on Telegram.
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  game: {
    // Energy
    baseMaxEnergy: 1000,
    energyPerLevel: 50, // extra max energy per level
    energyRegenPerSecond: 1000 / (3 * 60 * 60), // full refill in ~3 hours

    // Tapping
    baseCoinsPerTap: 1,
    coinsPerTapPerLevel: 1, // tap power grows by this much each level

    // Leveling: coins required to reach level N (index 0 = level 1 threshold)
    // Simple growing curve; level = how many thresholds have been passed.
    levelThreshold(level) {
      // coins needed to go from `level` to `level + 1`
      return Math.floor(1000 * Math.pow(1.6, level - 1));
    },
  },
};
