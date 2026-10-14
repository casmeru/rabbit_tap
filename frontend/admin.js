(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const API_BASE = window.location.origin;
  const initData = tg?.initData || '';

  const el = {
    deniedState: document.getElementById('deniedState'),
    adminContent: document.getElementById('adminContent'),
    backBtn: document.getElementById('backBtn'),
    statPlayers: document.getElementById('statPlayers'),
    statCoins: document.getElementById('statCoins'),
    statTaps: document.getElementById('statTaps'),
    statTopLevel: document.getElementById('statTopLevel'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    userList: document.getElementById('userList'),
    userModal: document.getElementById('userModal'),
    userModalTitle: document.getElementById('userModalTitle'),
    closeUserModal: document.getElementById('closeUserModal'),
    grantCoins: document.getElementById('grantCoins'),
    grantEnergy: document.getElementById('grantEnergy'),
    grantBtn: document.getElementById('grantBtn'),
    resetBtn: document.getElementById('resetBtn'),
    banBtn: document.getElementById('banBtn'),
  };

  let selectedUser = null;

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  function formatNumber(n) {
    n = Math.floor(n);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString('ru-RU');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function loadStats() {
    const s = await api('/api/admin/stats');
    el.statPlayers.textContent = formatNumber(s.players);
    el.statCoins.textContent = formatNumber(s.totalCoins);
    el.statTaps.textContent = formatNumber(s.totalTaps);
    el.statTopLevel.textContent = s.topLevel;
  }

  async function loadUsers(search = '') {
    el.userList.innerHTML = '<div class="loading">Загрузка…</div>';
    const { users } = await api('/api/admin/users?' + new URLSearchParams({ search, limit: 50 }));
    if (!users.length) {
      el.userList.innerHTML = '<div class="loading">Никого не найдено</div>';
      return;
    }
    el.userList.innerHTML = users.map((u) => `
      <button class="user-row ${u.banned ? 'banned' : ''}" data-id="${u.telegramId}">
        <div class="u-main">
          <div class="u-name">${escapeHtml(u.name)} ${u.banned ? '<span class="u-badge">БАН</span>' : ''}</div>
          <div class="u-sub">lvl ${u.level} · ⚡${u.energy}/${u.maxEnergy} · 👆${formatNumber(u.tapsTotal)}</div>
        </div>
        <div class="u-coins">🥕 ${formatNumber(u.totalCoins)}</div>
      </button>
    `).join('');

    el.userList.querySelectorAll('.user-row').forEach((row) => {
      row.addEventListener('click', () => openUserModal(users.find((u) => String(u.telegramId) === row.dataset.id)));
    });
  }

  function openUserModal(user) {
    selectedUser = user;
    el.userModalTitle.textContent = `${user.name} · lvl ${user.level}`;
    el.grantCoins.value = '';
    el.grantEnergy.value = '';
    el.banBtn.textContent = user.banned ? 'Разбанить' : 'Забанить';
    el.userModal.classList.add('open');
  }

  function closeModal() {
    el.userModal.classList.remove('open');
    selectedUser = null;
  }

  async function refreshAll() {
    const search = el.searchInput.value.trim();
    await Promise.all([loadStats(), loadUsers(search)]);
  }

  el.backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
  el.searchBtn.addEventListener('click', () => loadUsers(el.searchInput.value.trim()));
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUsers(el.searchInput.value.trim());
  });

  el.closeUserModal.addEventListener('click', closeModal);
  el.userModal.addEventListener('click', (e) => { if (e.target === el.userModal) closeModal(); });

  el.grantBtn.addEventListener('click', async () => {
    if (!selectedUser) return;
    const coins = Number(el.grantCoins.value) || 0;
    const energy = Number(el.grantEnergy.value) || 0;
    if (!coins && !energy) return;
    await api('/api/admin/grant', {
      method: 'POST',
      body: JSON.stringify({ telegramId: selectedUser.telegramId, coins, energy }),
    });
    closeModal();
    refreshAll();
  });

  el.resetBtn.addEventListener('click', async () => {
    if (!selectedUser) return;
    if (!confirm(`Сбросить весь прогресс у ${selectedUser.name}?`)) return;
    await api('/api/admin/reset', {
      method: 'POST',
      body: JSON.stringify({ telegramId: selectedUser.telegramId }),
    });
    closeModal();
    refreshAll();
  });

  el.banBtn.addEventListener('click', async () => {
    if (!selectedUser) return;
    const nextBanned = !selectedUser.banned;
    await api('/api/admin/ban', {
      method: 'POST',
      body: JSON.stringify({ telegramId: selectedUser.telegramId, banned: nextBanned }),
    });
    closeModal();
    refreshAll();
  });

  // --- boot ---
  (async () => {
    try {
      await api('/api/admin/whoami');
      el.adminContent.hidden = false;
      await refreshAll();
    } catch (err) {
      el.deniedState.hidden = false;
    }
  })();
})();
