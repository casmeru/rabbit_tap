import { config } from './config.js';

const { game } = config;

/** Recompute energy based on elapsed time since last_energy_ts (lazy regen, no cron needed). */
export function applyEnergyRegen(user, now = Math.floor(Date.now() / 1000)) {
  const elapsed = Math.max(0, now - user.last_energy_ts);
  if (elapsed > 0) {
    const regen = elapsed * game.energyRegenPerSecond;
    user.energy = Math.min(user.max_energy, user.energy + regen);
    user.last_energy_ts = now;
  }
  return user;
}

export function tapPowerFor(level) {
  return game.baseCoinsPerTap + (level - 1) * game.coinsPerTapPerLevel;
}

export function maxEnergyFor(level) {
  return game.baseMaxEnergy + (level - 1) * game.energyPerLevel;
}

/** Re-evaluate level from total_coins, growing max energy/tap power as needed. */
export function recalcLevel(user) {
  let level = user.level;
  while (user.total_coins >= cumulativeCoinsForLevel(level + 1)) {
    level += 1;
  }
  if (level !== user.level) {
    const grewEnergyCap = maxEnergyFor(level) - user.max_energy;
    user.level = level;
    user.max_energy = maxEnergyFor(level);
    user.energy = Math.min(user.max_energy, user.energy + Math.max(0, grewEnergyCap));
  }
  return user;
}

function cumulativeCoinsForLevel(level) {
  // total coins required to *reach* `level` (level 1 requires 0)
  let total = 0;
  for (let l = 1; l < level; l++) total += game.levelThreshold(l);
  return total;
}

export function nextLevelInfo(user) {
  const need = cumulativeCoinsForLevel(user.level + 1);
  return {
    coinsForNextLevel: need,
    coinsRemaining: Math.max(0, need - user.total_coins),
  };
}

/** Apply N taps to a user object (mutates), clamped by available energy. Returns taps actually applied. */
export function applyTaps(user, requestedTaps) {
  const power = tapPowerFor(user.level);
  const affordableByEnergy = Math.floor(user.energy);
  const taps = Math.max(0, Math.min(requestedTaps, affordableByEnergy));

  if (taps > 0) {
    user.energy -= taps;
    const earned = taps * power;
    user.coins += earned;
    user.total_coins += earned;
    user.taps_total += taps;
    recalcLevel(user);
  }
  return taps;
}

export function publicState(user) {
  const { coinsForNextLevel, coinsRemaining } = nextLevelInfo(user);
  return {
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    coins: Math.floor(user.coins),
    totalCoins: Math.floor(user.total_coins),
    level: user.level,
    tapPower: tapPowerFor(user.level),
    energy: Math.floor(user.energy),
    maxEnergy: user.max_energy,
    energyRegenPerSecond: game.energyRegenPerSecond,
    tapsTotal: user.taps_total,
    coinsForNextLevel,
    coinsRemaining,
  };
}
