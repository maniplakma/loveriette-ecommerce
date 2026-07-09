/* Admin — Shop Games */
(function () {
  const DAY_OPTS = [
    { v: 0, l: 'Sun' }, { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
    { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }
  ];
  const GAME_KEYS = [
    { key: 'wheel', label: 'Spin the Wheel' },
    { key: 'scratch', label: 'Scratch Cards' },
    { key: 'mystery', label: 'Mystery Box' },
    { key: 'dice', label: 'Lucky Dice' },
    { key: 'pick', label: 'Card Flip' },
    { key: 'vault', label: 'Treasure Vault' }
  ];
  const PRIZE_TYPES = [
    { v: 'wallet', l: 'Wallet credit (₱)' },
    { v: 'loyalty', l: 'Loyalty points — auto credit + notify' },
    { v: 'redeem', l: 'Voucher / redeem code — auto issue + copy' },
    { v: 'product', l: 'Product prize — Telegram screenshot' },
    { v: 'account', l: 'Account prize — Telegram screenshot' },
    { v: 'netflix', l: 'Netflix / streaming — Telegram screenshot' },
    { v: 'plug_access', l: 'Plug access' },
    { v: 'custom', l: 'Custom prize' },
    { v: 'none', l: 'No prize' },
    { v: 'bomb', l: 'Bomb (scratch)' }
  ];

  let gamesLoaded = false;
  let catalogProducts = [];

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

  function renderGuideFields(guides = {}) {
    const wrap = document.getElementById('games-guide-fields');
    if (!wrap) return;
    wrap.innerHTML = GAME_KEYS.map((g) => `
      <div class="admin-field">
        <label>${esc(g.label)} guide URL</label>
        <input type="text" class="admin-modal-input games-guide-input" data-guide-key="${g.key}"
          value="${esc(guides[g.key] || `/guide.html#game-${g.key}`)}" placeholder="/guide.html#game-${g.key}">
      </div>`).join('');
  }

  function fillProductSelect(selectedIds) {
    const sel = document.getElementById('games-required-products');
    if (!sel) return;
    const set = new Set((selectedIds || []).map(Number));
    sel.innerHTML = catalogProducts.map((p) =>
      `<option value="${p.id}"${set.has(Number(p.id)) ? ' selected' : ''}>${esc(p.name)} (#${p.id})</option>`
    ).join('');
  }

  async function loadGamesSettings() {
    const data = await api('/admin/games/settings');
    const toggle = document.getElementById('games-enabled-toggle');
    if (toggle) toggle.checked = !!data.gamesEnabled;
    const channel = document.getElementById('games-channel-url');
    if (channel) channel.value = data.channelUrl || 'https://t.me/loveriette';
    const strict = document.getElementById('games-strict-toggle');
    if (strict) strict.checked = data.strictEligibility !== false;
    const qty = document.getElementById('games-required-qty');
    if (qty) qty.value = data.requiredQuantity || 3;
    const tg = document.getElementById('games-telegram-handle');
    if (tg) tg.value = data.telegramHandle || '@loveriette';
    fillProductSelect(data.productIds || []);
    renderGuideFields(data.guides || {});
  }

  async function saveGamesSettings() {
    const toggle = document.getElementById('games-enabled-toggle');
    const channel = document.getElementById('games-channel-url');
    const strict = document.getElementById('games-strict-toggle');
    const qty = document.getElementById('games-required-qty');
    const tg = document.getElementById('games-telegram-handle');
    const sel = document.getElementById('games-required-products');
    const guides = {};
    document.querySelectorAll('.games-guide-input').forEach((inp) => {
      guides[inp.dataset.guideKey] = inp.value.trim();
    });
    await api('/admin/games/settings', {
      method: 'PUT',
      body: JSON.stringify({
        gamesEnabled: !!toggle?.checked,
        channelUrl: channel?.value || 'https://t.me/loveriette',
        strictEligibility: !!strict?.checked,
        requiredQuantity: Number(qty?.value || 3),
        telegramHandle: tg?.value || '@loveriette',
        productIds: [...(sel?.selectedOptions || [])].map((o) => Number(o.value)),
        guides
      })
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
        ${(c.winners || []).length > 1 ? `<p class="admin-muted">All winners: ${c.winners.map((w) => `${esc(w.displayName)} (${esc(w.prizeLabel)})`).join(', ')}</p>` : ''}
        <p><strong>Prizes:</strong> ${(c.prizes || []).map((p) => `${esc(p.label)} <small>×${p.quantity || 1} (${p.wonCount || 0} won)</small>`).join(', ') || '—'}</p>
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
          const names = (r.winners || []).map((w) => `${w.displayName} (${w.prize?.label || 'prize'})`).join(', ');
          alert(names ? `Winners: ${names}` : `Winner: ${r.winner?.displayName || '?'} — Prize: ${r.prize?.label || '?'}`);
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
    const type = prompt('Type: loyalty, redeem, product, wallet, account, netflix, plug_access, custom, none, bomb', 'loyalty');
    const value = prompt('Value: amount for loyalty/wallet; {"discountValue":50} for voucher; empty for product', '');
    const qtyRaw = prompt('How many winners for this prize? (1 = one winner only)', kind === 'wheel' ? '1' : '-1');
    const quantity = qtyRaw != null && qtyRaw !== '' ? Number(qtyRaw) : (kind === 'wheel' ? 1 : -1);
    const url = kind === 'wheel'
      ? `/admin/games/wheel/${parentId}/prizes`
      : kind === 'scratch'
        ? `/admin/games/scratch/${parentId}/prizes`
        : kind === 'mystery'
          ? `/admin/games/mystery/${parentId}/prizes`
          : `/admin/games/instant/${parentId}/prizes`;
    const body = kind === 'wheel'
      ? { label, prizeType: type || 'custom', prizeValue: value || '', quantity: Math.max(1, quantity || 1) }
      : kind === 'instant'
        ? { label, prizeType: type || 'none', prizeValue: value || '', weight: 10, quantity, tileStyle: 'gold' }
        : { label, prizeType: type || 'none', prizeValue: value || '', weight: 10, quantity };
    api(url, { method: 'POST', body: JSON.stringify(body) })
      .then(() => {
        if (kind === 'wheel') loadWheelAdmin();
        else if (kind === 'scratch') loadScratchAdmin();
        else if (kind === 'mystery') loadMysteryAdmin();
        else loadInstantAdmin();
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
        <p class="admin-muted">Min order: ₱${p.min_order_total || p.minOrderTotal || 0}${p.endsAt ? ` · Ends: ${esc(p.endsAt)}` : ''}</p>
        <button type="button" class="admin-btn admin-btn-outline admin-btn-sm admin-pool-ends" data-kind="scratch" data-id="${p.id}">Set end date</button>
        <ul>${(p.prizes || []).map((pr) =>
    `<li>${esc(pr.label)} <small>(${esc(pr.prizeType)} · weight ${pr.weight} · qty ${pr.quantity < 0 ? '∞' : pr.quantity} · won ${pr.wonCount || 0})</small></li>`
  ).join('') || '<li>None — add prizes</li>'}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-scratch-add-prize" data-id="${p.id}">Add scratch prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-scratch-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('scratch', btn.dataset.id));
    });
    list.querySelectorAll('.admin-pool-ends').forEach((btn) => {
      btn.addEventListener('click', () => setPoolEndDate(btn.dataset.kind, btn.dataset.id));
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
        <p class="admin-muted">Min order: ₱${p.min_order_total || p.minOrderTotal || 0}${p.endsAt ? ` · Ends: ${esc(p.endsAt)}` : ''}</p>
        <button type="button" class="admin-btn admin-btn-outline admin-btn-sm admin-pool-ends" data-kind="mystery" data-id="${p.id}">Set end date</button>
        <ul>${(p.prizes || []).map((pr) =>
    `<li>${esc(pr.label)} <small>(${esc(pr.prizeType)} · weight ${pr.weight} · qty ${pr.quantity < 0 ? '∞' : pr.quantity} · won ${pr.wonCount || 0})</small></li>`
  ).join('') || '<li>None</li>'}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-mystery-add-prize" data-id="${p.id}">Add box prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-mystery-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('mystery', btn.dataset.id));
    });
    list.querySelectorAll('.admin-pool-ends').forEach((btn) => {
      btn.addEventListener('click', () => setPoolEndDate(btn.dataset.kind, btn.dataset.id));
    });
  }

  async function setPoolEndDate(kind, id) {
    const raw = prompt('End date & time (YYYY-MM-DDTHH:mm) — leave empty to clear');
    if (raw === null) return;
    const endsAt = raw.trim() ? new Date(raw.trim()).toISOString() : null;
    const path = kind === 'instant'
      ? `/admin/games/instant/${id}`
      : `/admin/games/${kind}/${id}`;
    const body = kind === 'instant' ? { endsAt } : { endsAt };
    try {
      await api(path, { method: 'PUT', body: JSON.stringify(body) });
      if (kind === 'scratch') loadScratchAdmin();
      else if (kind === 'mystery') loadMysteryAdmin();
      else loadInstantAdmin();
    } catch (e) { alert(e.message); }
  }

  async function loadInstantAdmin() {
    const list = document.getElementById('admin-games-instant-list');
    if (!list) return;
    const pools = await api('/admin/games/instant');
    if (!pools.length) {
      list.innerHTML = '<p class="admin-muted">No instant games found.</p>';
      return;
    }
    list.innerHTML = pools.map((p) => `
      <div class="admin-card">
        <div class="admin-card-head">
          <strong>${esc(p.title)}</strong>
          <span class="admin-badge">${p.isEnabled ? 'ON' : 'OFF'} · ${esc(p.gameKey)}</span>
        </div>
        <p class="admin-muted">Min order: ₱${p.minOrderTotal || 0}${p.endsAt ? ` · Ends: ${esc(p.endsAt)}` : ''}</p>
        <button type="button" class="admin-btn admin-btn-outline admin-btn-sm admin-pool-ends" data-kind="instant" data-id="${p.gameKey}">Set end date</button>
        <ul>${(p.prizes || []).map((pr) =>
    `<li>${esc(pr.label)} <small>(${esc(pr.prizeType)} · qty ${pr.quantity < 0 ? '∞' : pr.quantity} · won ${pr.wonCount || 0})</small></li>`
  ).join('') || '<li>None</li>'}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-instant-add-prize" data-key="${p.gameKey}">Add prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-instant-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('instant', btn.dataset.key));
    });
    list.querySelectorAll('.admin-pool-ends').forEach((btn) => {
      btn.addEventListener('click', () => setPoolEndDate(btn.dataset.kind, btn.dataset.id));
    });
  }

  function bindGamesForms() {
    document.getElementById('games-enabled-toggle')?.addEventListener('change', () => {
      saveGamesSettings().catch((e) => alert(e.message));
    });
    document.getElementById('games-channel-url')?.addEventListener('change', () => {
      saveGamesSettings().catch((e) => alert(e.message));
    });
    document.getElementById('games-eligibility-save')?.addEventListener('click', () => {
      saveGamesSettings().then(() => alert('Games eligibility saved.')).catch((e) => alert(e.message));
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
            isEnabled: fd.get('isEnabled') === 'on',
            endsAt: fd.get('endsAt') ? new Date(fd.get('endsAt')).toISOString() : null
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
            isEnabled: fd.get('isEnabled') === 'on',
            endsAt: fd.get('endsAt') ? new Date(fd.get('endsAt')).toISOString() : null
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
    try {
      catalogProducts = await api('/admin/products');
    } catch (_) {
      catalogProducts = [];
    }
    await loadGamesSettings();
    await Promise.all([loadWheelAdmin(), loadScratchAdmin(), loadMysteryAdmin(), loadInstantAdmin()]);
    gamesLoaded = true;
  }

  window.loadPlatformGames = loadPlatformGames;
})();
