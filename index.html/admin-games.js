/* Admin — Shop Games */
(function () {
  const DAY_OPTS = [
    { v: 0, l: 'Sun' }, { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
    { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }
  ];
  const PRIZE_TYPES = [
    { v: 'wallet', l: 'Wallet credit (₱)' },
    { v: 'loyalty', l: 'Loyalty points (₱)' },
    { v: 'plug_access', l: 'Plug access' },
    { v: 'netflix', l: 'Netflix / account' },
    { v: 'custom', l: 'Custom prize' },
    { v: 'none', l: 'No prize' },
    { v: 'bomb', l: 'Bomb (scratch)' }
  ];

  let gamesLoaded = false;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function prizeTypeOptions(selected) {
    return PRIZE_TYPES.map((p) =>
      `<option value="${p.v}"${p.v === selected ? ' selected' : ''}>${esc(p.l)}</option>`
    ).join('');
  }

  async function loadGamesSettings() {
    const data = await api('/admin/games/settings');
    const toggle = document.getElementById('games-enabled-toggle');
    if (toggle) toggle.checked = !!data.gamesEnabled;
  }

  async function saveGamesSettings() {
    const toggle = document.getElementById('games-enabled-toggle');
    await api('/admin/games/settings', {
      method: 'PUT',
      body: JSON.stringify({ gamesEnabled: !!toggle?.checked })
    });
  }

  async function loadWheelAdmin() {
    const list = document.getElementById('admin-games-wheel-list');
    if (!list) return;
    const campaigns = await api('/admin/games/wheel');
    if (!campaigns.length) {
      list.innerHTML = '<p class="admin-muted">No wheel campaigns yet.</p>';
      return;
    }
    list.innerHTML = campaigns.map((c) => `
      <div class="admin-card" data-wheel-id="${c.id}">
        <div class="admin-card-head">
          <strong>${esc(c.title)}</strong>
          <span class="admin-badge">${c.isEnabled ? 'ON' : 'OFF'} · ${esc(c.status)}</span>
        </div>
        <p class="admin-muted">Draw: ${esc(c.drawAt)} · Entries: ${c.entryCount || 0} · Min order: ₱${c.minOrderTotal || 0}</p>
        ${c.winner ? `<p class="admin-success-text">Winner: ${esc(c.winner.displayName)} (#${esc(c.winner.orderNumber)})</p>` : ''}
        <p><strong>Prizes:</strong> ${(c.prizes || []).map((p) => esc(p.label)).join(', ') || '—'}</p>
        <div class="admin-inline-actions">
          ${c.status === 'scheduled' ? `<button type="button" class="admin-btn admin-btn-primary admin-wheel-draw" data-id="${c.id}">Run draw now</button>` : ''}
          <button type="button" class="admin-btn admin-btn-outline admin-wheel-add-prize" data-id="${c.id}">Add prize</button>
        </div>
        <details class="admin-details">
          <summary>Entries (${c.entryCount || 0})</summary>
          <div class="admin-chip-list">${(c.slots || []).map((s) =>
    `<span class="admin-chip">${esc(s.displayName)} · #${esc(s.orderNumber)}</span>`
  ).join('') || 'None yet'}</div>
        </details>
      </div>`).join('');

    list.querySelectorAll('.admin-wheel-draw').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Run the wheel draw now? This picks a random winner.')) return;
        try {
          const r = await api(`/admin/games/wheel/${btn.dataset.id}/draw`, { method: 'POST', body: '{}' });
          alert(`Winner: ${r.winner?.displayName || '?'} — Prize: ${r.prize?.label || '?'}`);
          loadWheelAdmin();
        } catch (e) { alert(e.message); }
      });
    });

    list.querySelectorAll('.admin-wheel-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('wheel', btn.dataset.id));
    });
  }

  function openPrizeModal(kind, parentId) {
    const label = prompt('Prize label (e.g. Loyalty ₱400, Netflix Solo)');
    if (!label) return;
    const type = prompt('Type: wallet, loyalty, plug_access, netflix, custom, none, bomb', 'custom');
    const value = prompt('Value (amount for wallet/loyalty, or notes)', '');
    const url = kind === 'wheel'
      ? `/admin/games/wheel/${parentId}/prizes`
      : kind === 'scratch'
        ? `/admin/games/scratch/${parentId}/prizes`
        : `/admin/games/mystery/${parentId}/prizes`;
    const body = kind === 'wheel'
      ? { label, prizeType: type || 'custom', prizeValue: value || '' }
      : { label, prizeType: type || 'none', prizeValue: value || '', weight: 10, quantity: -1 };
    api(url, { method: 'POST', body: JSON.stringify(body) })
      .then(() => {
        if (kind === 'wheel') loadWheelAdmin();
        else if (kind === 'scratch') loadScratchAdmin();
        else loadMysteryAdmin();
      })
      .catch((e) => alert(e.message));
  }

  async function loadScratchAdmin() {
    const list = document.getElementById('admin-games-scratch-list');
    if (!list) return;
    const pools = await api('/admin/games/scratch');
    if (!pools.length) {
      list.innerHTML = '<p class="admin-muted">No scratch pool yet.</p>';
      return;
    }
    list.innerHTML = pools.map((p) => `
      <div class="admin-card">
        <div class="admin-card-head">
          <strong>${esc(p.title)}</strong>
          <span class="admin-badge">${p.isEnabled ? 'ON' : 'OFF'}</span>
        </div>
        <p class="admin-muted">Min order: ₱${p.min_order_total || p.minOrderTotal || 0}</p>
        <p><strong>Prizes:</strong></p>
        <ul>${(p.prizes || []).map((pr) =>
    `<li>${esc(pr.label)} <small>(${esc(pr.prizeType)} · weight ${pr.weight})</small></li>`
  ).join('') || '<li>None — add prizes</li>'}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-scratch-add-prize" data-id="${p.id}">Add scratch prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-scratch-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('scratch', btn.dataset.id));
    });
  }

  async function loadMysteryAdmin() {
    const list = document.getElementById('admin-games-mystery-list');
    if (!list) return;
    const pools = await api('/admin/games/mystery');
    if (!pools.length) {
      list.innerHTML = '<p class="admin-muted">No mystery box pool yet.</p>';
      return;
    }
    list.innerHTML = pools.map((p) => `
      <div class="admin-card">
        <div class="admin-card-head">
          <strong>${esc(p.title)}</strong>
          <span class="admin-badge">${p.isEnabled ? 'ON' : 'OFF'}</span>
        </div>
        <p class="admin-muted">Min order: ₱${p.min_order_total || p.minOrderTotal || 0}</p>
        <ul>${(p.prizes || []).map((pr) =>
    `<li>${esc(pr.label)} <small>(${esc(pr.prizeType)} · weight ${pr.weight})</small></li>`
  ).join('') || '<li>None</li>'}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-mystery-add-prize" data-id="${p.id}">Add box prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-mystery-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('mystery', btn.dataset.id));
    });
  }

  function bindGamesForms() {
    document.getElementById('games-enabled-toggle')?.addEventListener('change', () => {
      saveGamesSettings().catch((e) => alert(e.message));
    });

    document.getElementById('admin-wheel-create-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const days = [...e.target.querySelectorAll('input[name="days"]:checked')].map((x) => Number(x.value));
      try {
        await api('/admin/games/wheel', {
          method: 'POST',
          body: JSON.stringify({
            title: fd.get('title'),
            drawAt: fd.get('drawAt'),
            startsAt: fd.get('startsAt') || null,
            endsAt: fd.get('endsAt') || null,
            minOrderTotal: Number(fd.get('minOrderTotal') || 0),
            isEnabled: fd.get('isEnabled') === 'on',
            availableDays: days.length ? days : [0, 1, 2, 3, 4, 5, 6]
          })
        });
        e.target.reset();
        loadWheelAdmin();
      } catch (err) { alert(err.message); }
    });

    document.getElementById('admin-scratch-create-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/admin/games/scratch', {
          method: 'POST',
          body: JSON.stringify({
            title: fd.get('title'),
            minOrderTotal: Number(fd.get('minOrderTotal') || 0),
            isEnabled: fd.get('isEnabled') === 'on'
          })
        });
        e.target.reset();
        loadScratchAdmin();
      } catch (err) { alert(err.message); }
    });

    document.getElementById('admin-mystery-create-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/admin/games/mystery', {
          method: 'POST',
          body: JSON.stringify({
            title: fd.get('title'),
            minOrderTotal: Number(fd.get('minOrderTotal') || 0),
            isEnabled: fd.get('isEnabled') === 'on'
          })
        });
        e.target.reset();
        loadMysteryAdmin();
      } catch (err) { alert(err.message); }
    });

    document.querySelectorAll('.admin-games-subtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.gamesTab;
        document.querySelectorAll('.admin-games-subtab').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.admin-games-pane').forEach((p) => {
          p.hidden = p.id !== `admin-games-pane-${tab}`;
        });
      });
    });
  }

  async function loadPlatformGames(force = false) {
    if (gamesLoaded && !force) return;
    const root = document.getElementById('tab-games');
    if (!root || root.hidden) return;
    bindGamesForms();
    await loadGamesSettings();
    await Promise.all([loadWheelAdmin(), loadScratchAdmin(), loadMysteryAdmin()]);
    gamesLoaded = true;
  }

  window.loadPlatformGames = loadPlatformGames;
})();
