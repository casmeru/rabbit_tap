(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // When opened outside Telegram (plain browser testing), fall back to empty initData;
  // the backend will reject it — this is only useful for visual/layout testing.
  const API_BASE = window.location.origin;
  const initData = tg?.initData || '';

  const el = {
    playerName: document.getElementById('playerName'),
    levelLabel: document.getElementById('levelLabel'),
    coinAmount: document.getElementById('coinAmount'),
    levelProgressFill: document.getElementById('levelProgressFill'),
    levelProgressLabel: document.getElementById('levelProgressLabel'),
    energyFill: document.getElementById('energyFill'),
    energyText: document.getElementById('energyText'),
    tapZone: document.getElementById('tapZone'),
    rabbitBtn: document.getElementById('rabbitBtn'),
    toast: document.getElementById('toast'),
    leaderboardBtn: document.getElementById('leaderboardBtn'),
    leaderboardModal: document.getElementById('leaderboardModal'),
    leaderboardList: document.getElementById('leaderboardList'),
    closeLeaderboard: document.getElementById('closeLeaderboard'),
    adminBtn: document.getElementById('adminBtn'),
    communityPlayers: document.getElementById('communityPlayers'),
    communityCoins: document.getElementById('communityCoins'),
    communityTaps: document.getElementById('communityTaps'),
  };

  let state = null;          // last known-good server state
  let pendingTaps = 0;       // taps queued since last flush
  let flushTimer = null;
  let localEnergy = 0;       // optimistic local energy for instant feedback
  let localCoins = 0;

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function render(s) {
    state = s;
    localCoins = s.coins;
    localEnergy = s.energy;

    el.playerName.textContent = s.firstName || s.username || 'Игрок';
    el.levelLabel.textContent = `Уровень ${s.level}`;
    el.coinAmount.textContent = formatNumber(localCoins);

    const progressDone = s.totalCoins;
    const progressTotal = s.coinsForNextLevel;
    const pct = progressTotal > 0 ? Math.min(100, (progressDone / progressTotal) * 100) : 100;
    el.levelProgressFill.style.width = pct + '%';
    el.levelProgressLabel.textContent = `${formatNumber(progressDone)} / ${formatNumber(progressTotal)} до след. уровня`;

    updateEnergyUI();
  }

  function updateEnergyUI() {
    const pct = state ? Math.min(100, (localEnergy / state.maxEnergy) * 100) : 0;
    el.energyFill.style.width = pct + '%';
    el.energyText.textContent = `${Math.floor(localEnergy)} / ${state?.maxEnergy ?? 0}`;
  }

  function formatNumber(n) {
    n = Math.floor(n);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString('ru-RU');
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  function spawnFloatText(x, y, text) {
    const node = document.createElement('div');
    node.className = 'float-coin';
    node.textContent = text;
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    el.tapZone.appendChild(node);
    node.addEventListener('animationend', () => node.remove());
  }

  function handleTap(evt) {
    if (!state) return;
    if (localEnergy < 1) {
      showToast('Энергия закончилась ⚡');
      return;
    }

    const power = state.tapPower;
    localEnergy -= 1;
    localCoins += power;
    pendingTaps += 1;

    el.coinAmount.textContent = formatNumber(localCoins);
    updateEnergyUI();

    el.rabbitBtn.classList.add('pressed');
    setTimeout(() => el.rabbitBtn.classList.remove('pressed'), 90);

    const rect = el.tapZone.getBoundingClientRect();
    const point = evt.touches?.[0] || evt;
    const x = (point.clientX ?? rect.left + rect.width / 2) - rect.left + (Math.random() * 30 - 15);
    const y = (point.clientY ?? rect.top + rect.height / 2) - rect.top;
    spawnFloatText(x, y, `+${power}`);

    tg?.HapticFeedback?.impactOccurred('light');

    scheduleFlush();
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushTaps, 400);
  }

  async function flushTaps() {
    if (pendingTaps === 0) return;
    const taps = Math.min(pendingTaps, 200);
    pendingTaps -= taps;
    try {
      const updated = await api('/api/tap', { method: 'POST', body: JSON.stringify({ taps }) });
      const leveledUp = state && updated.level > state.level;
      render(updated);
      if (leveledUp) {
        showToast(`🎉 Новый уровень: ${updated.level}!`);
        tg?.HapticFeedback?.notificationOccurred('success');
      }
      if (pendingTaps > 0) scheduleFlush();
    } catch (err) {
      console.error('tap sync failed', err);
      pendingTaps += taps; // retry later
      scheduleFlush();
    }
  }

  async function refreshFromServer() {
    try {
      const s = await api('/api/me');
      // Only overwrite if no optimistic taps are in flight, to avoid visual jumps.
      if (pendingTaps === 0) render(s);
    } catch (err) {
      console.error('refresh failed', err);
      showToast('Нет соединения с сервером');
    }
  }

  async function refreshCommunityStats() {
    try {
      const s = await api('/api/community');
      el.communityPlayers.textContent = formatNumber(s.players);
      el.communityCoins.textContent = formatNumber(s.totalCoins);
      el.communityTaps.textContent = formatNumber(s.totalTaps);
    } catch (err) {
      console.error('community stats failed', err);
    }
  }

  async function checkAdmin() {
    try {
      const res = await fetch(API_BASE + '/api/admin/whoami', {
        headers: { 'X-Telegram-Init-Data': initData },
      });
      if (res.ok) el.adminBtn.hidden = false;
    } catch {
      /* not an admin, or offline — keep hidden */
    }
  }

  async function openLeaderboard() {
    el.leaderboardModal.classList.add('open');
    el.leaderboardList.innerHTML = '<li>Загрузка…</li>';
    try {
      const { leaderboard } = await api('/api/leaderboard');
      el.leaderboardList.innerHTML = leaderboard
        .map(
          (r) => `<li>
            <span class="lb-rank">#${r.rank}</span>
            <span class="lb-name">${escapeHtml(r.name)} · lvl ${r.level}</span>
            <span class="lb-coins">${formatNumber(r.totalCoins)}</span>
          </li>`
        )
        .join('');
    } catch {
      el.leaderboardList.innerHTML = '<li>Не удалось загрузить</li>';
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // --- wire up events ---
  el.rabbitBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleTap(e); }, { passive: false });
  el.rabbitBtn.addEventListener('click', (e) => {
    // Avoid double-firing on touch devices that emit both touchstart and click.
    if (e.pointerType === 'touch') return;
    handleTap(e);
  });

  el.leaderboardBtn.addEventListener('click', openLeaderboard);
  el.closeLeaderboard.addEventListener('click', () => el.leaderboardModal.classList.remove('open'));
  el.leaderboardModal.addEventListener('click', (e) => {
    if (e.target === el.leaderboardModal) el.leaderboardModal.classList.remove('open');
  });

  // Local energy regen ticking for smooth UI between server syncs.
  setInterval(() => {
    if (!state) return;
    localEnergy = Math.min(state.maxEnergy, localEnergy + state.energyRegenPerSecond);
    updateEnergyUI();
  }, 1000);

  // Periodic full resync (covers regen drift, multi-device play, etc.)
  setInterval(refreshFromServer, 15000);

  // --- boot ---
  (async () => {
    try {
      const s = await api('/api/me');
      render(s);
    } catch (err) {
      console.error(err);
      el.playerName.textContent = 'Ошибка';
      showToast(tg ? 'Не удалось авторизоваться' : 'Откройте через Telegram-бота');
    }
    refreshCommunityStats();
    checkAdmin();
  })();

  setInterval(refreshCommunityStats, 20000);
})();
