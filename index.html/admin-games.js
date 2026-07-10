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
    { v: 'wallet', l: '₱ Wallet credit', help: 'Halagang idadagdag sa wallet (automatic). Sa Value: hal. 500', valueHint: 'Amount sa ₱, hal. 500', wheel: true },
    { v: 'loyalty', l: 'Loyalty points', help: 'Katulad ng wallet — auto credit + notification.', valueHint: 'Amount sa ₱, hal. 100', wheel: true },
    { v: 'redeem', l: 'Voucher / discount code', help: 'Auto-generate ng code sa checkout.', valueHint: 'Hal. 50 o {"discountValue":50}', wheel: true },
    { v: 'product', l: 'Product prize', help: 'Buyer mag-screenshot at mag-Telegram sa iyo.', valueHint: 'Pwede blank — message lang sa buyer', wheel: true },
    { v: 'account', l: 'Account prize', help: 'Account/credential prize — screenshot + Telegram.', valueHint: 'Pwede blank', wheel: true },
    { v: 'netflix', l: 'Netflix / streaming', help: 'Streaming subscription — screenshot + Telegram.', valueHint: 'Pwede blank', wheel: true },
    { v: 'plug_access', l: 'Plugging access', help: 'Access sa plugging (hal. bilang ng araw).', valueHint: 'Bilang ng araw, hal. 7', wheel: true },
    { v: 'custom', l: 'Custom prize', help: 'Ibang prize — ikaw ang mag-follow up sa buyer.', valueHint: 'Optional notes', wheel: true },
    { v: 'none', l: 'Walang panalo (Better luck)', help: 'Para sa scratch/dice/box — hindi nanalo. Gamitin ang mataas na weight (25–40).', valueHint: 'Blank lang', wheel: false },
    { v: 'bomb', l: 'Boom (scratch)', help: 'Visual na “boom” sa scratch — same as talo.', valueHint: 'Blank lang', wheel: false }
  ];

  let gamesLoaded = false;
  let catalogProducts = [];
  let prizeModalBound = false;
  let prizeModalKind = '';
  let prizeModalParent = '';

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

  function readGameOpenToggles() {
    const state = {};
    document.querySelectorAll('.games-open-toggle').forEach((inp) => {
      state[inp.dataset.gameKey] = !!inp.checked;
    });
    return state;
  }

  function renderGameOpenToggles(gameEnabled = {}) {
    const wrap = document.getElementById('games-open-toggles');
    if (!wrap) return;
    wrap.innerHTML = GAME_KEYS.map((g) => {
      const on = gameEnabled[g.key] !== false;
      return `
        <label class="admin-games-open-item">
          <input type="checkbox" class="games-open-toggle" data-game-key="${g.key}"${on ? ' checked' : ''}>
          <span class="admin-games-open-label">${esc(g.label)}</span>
          <span class="admin-games-open-state">${on ? 'Open' : 'Closed'}</span>
        </label>`;
    }).join('');
    wrap.querySelectorAll('.games-open-toggle').forEach((inp) => {
      inp.addEventListener('change', () => {
        const stateEl = inp.closest('.admin-games-open-item')?.querySelector('.admin-games-open-state');
        if (stateEl) stateEl.textContent = inp.checked ? 'Open' : 'Closed';
        saveGamesSettings().catch((e) => alert(e.message));
      });
    });
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
    renderGameOpenToggles(data.gameEnabled || {});
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
        guides,
        gameEnabled: readGameOpenToggles()
      })
    });
  }

  function prizeTypesForKind(kind) {
    if (kind === 'wheel') return PRIZE_TYPES.filter((t) => t.wheel !== false);
    return PRIZE_TYPES;
  }

  function findPrizeType(v) {
    return PRIZE_TYPES.find((t) => t.v === v) || PRIZE_TYPES[0];
  }

  function prizeListHtml(prizes, kind, parentId) {
    if (!prizes?.length) return '<li class="admin-muted">Wala pang prize — click Add prize</li>';
    return prizes.map((pr) => `
      <li class="admin-prize-li">
        <span><strong>${esc(pr.label)}</strong>
          <small class="admin-muted"> · ${esc(pr.prizeType)}
          ${kind !== 'wheel' ? ` · weight ${pr.weight}` : ''}
          · ${pr.quantity < 0 ? '∞' : `qty ${pr.quantity}`}
          · won ${pr.wonCount || 0}</small></span>
        <span class="admin-inline-actions">
          <button type="button" class="admin-btn admin-btn-outline admin-btn-sm admin-prize-edit"
            data-kind="${kind}" data-parent="${parentId}" data-id="${pr.id}"
            data-label="${esc(pr.label)}" data-type="${esc(pr.prizeType)}"
            data-value="${esc(pr.prizeValue || '')}" data-weight="${pr.weight ?? 3}"
            data-quantity="${pr.quantity ?? (kind === 'wheel' ? 1 : -1)}">Edit</button>
          <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm admin-prize-del"
            data-kind="${kind}" data-id="${pr.id}">Delete</button>
        </span>
      </li>`).join('');
  }

  function bindPrizeRowActions(root) {
    root.querySelectorAll('.admin-prize-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        openPrizeModal(btn.dataset.kind, btn.dataset.parent, {
          id: btn.dataset.id,
          label: btn.dataset.label,
          prizeType: btn.dataset.type,
          prizeValue: btn.dataset.value,
          weight: Number(btn.dataset.weight),
          quantity: Number(btn.dataset.quantity)
        });
      });
    });
    root.querySelectorAll('.admin-prize-del').forEach((btn) => {
      btn.addEventListener('click', () => deletePrize(btn.dataset.kind, btn.dataset.id));
    });
  }

  function refreshPrizeTypeFields() {
    const kind = document.getElementById('games-prize-kind')?.value || 'scratch';
    const typeSel = document.getElementById('games-prize-type');
    const type = typeSel?.value || 'wallet';
    const meta = findPrizeType(type);
    const help = document.getElementById('games-prize-type-help');
    const valueHint = document.getElementById('games-prize-value-hint');
    const qtyWrap = document.getElementById('games-prize-quantity-wrap');
    const weightWrap = document.getElementById('games-prize-weight-wrap');
    const qtyLabel = document.getElementById('games-prize-quantity-label');
    const qtyHint = document.getElementById('games-prize-quantity-hint');
    if (help) help.textContent = meta.help || '';
    if (valueHint) valueHint.textContent = meta.valueHint || '';
    if (kind === 'wheel') {
      if (weightWrap) weightWrap.hidden = true;
      if (qtyLabel) qtyLabel.textContent = 'Ilang nanalo para sa prize na ito?';
      if (qtyHint) qtyHint.textContent = '1 = isang spin/winner. Hal. 3 prizes × qty 1 = 3 spins.';
      if (qtyWrap) qtyWrap.hidden = false;
      const qty = document.getElementById('games-prize-quantity');
      if (qty && Number(qty.value) < 1) qty.value = '1';
    } else {
      if (weightWrap) weightWrap.hidden = false;
      if (qtyLabel) qtyLabel.textContent = 'Max winners (quantity)';
      if (qtyHint) qtyHint.textContent = '-1 = unlimited. Hal. 5 = max 5 buyers ang makakakuha ng prize na ito.';
      if (qtyWrap) qtyWrap.hidden = false;
    }
    const isLoser = type === 'none' || type === 'bomb';
    const weightInput = document.getElementById('games-prize-weight');
    if (weightInput && kind !== 'wheel' && !weightInput.dataset.touched) {
      weightInput.value = isLoser ? '30' : '3';
    }
  }

  function fillPrizeTypeSelect(kind, selected) {
    const sel = document.getElementById('games-prize-type');
    if (!sel) return;
    const types = prizeTypesForKind(kind);
    sel.innerHTML = types.map((t) =>
      `<option value="${t.v}"${t.v === selected ? ' selected' : ''}>${esc(t.l)}</option>`
    ).join('');
  }

  function openPrizeModal(kind, parentId, existing = null) {
    prizeModalKind = kind;
    prizeModalParent = parentId;
    const modal = document.getElementById('games-prize-modal');
    const title = document.getElementById('games-prize-modal-title');
    const editId = document.getElementById('games-prize-edit-id');
    const kindInput = document.getElementById('games-prize-kind');
    const parentInput = document.getElementById('games-prize-parent');
    const labelInput = document.getElementById('games-prize-label');
    const valueInput = document.getElementById('games-prize-value');
    const qtyInput = document.getElementById('games-prize-quantity');
    const weightInput = document.getElementById('games-prize-weight');
    if (!modal || !labelInput) return;

    if (title) title.textContent = existing?.id ? 'Edit prize' : 'Add prize';
    if (editId) editId.value = existing?.id || '';
    if (kindInput) kindInput.value = kind;
    if (parentInput) parentInput.value = parentId;

    const type = existing?.prizeType || (kind === 'wheel' ? 'loyalty' : 'wallet');
    fillPrizeTypeSelect(kind, type);
    labelInput.value = existing?.label || '';
    valueInput.value = existing?.prizeValue || '';
    qtyInput.value = existing?.quantity != null
      ? String(existing.quantity)
      : (kind === 'wheel' ? '1' : '-1');
    if (weightInput) {
      weightInput.value = existing?.weight != null ? String(existing.weight) : '3';
      weightInput.dataset.touched = existing?.id ? '1' : '';
    }

    refreshPrizeTypeFields();
    modal.hidden = false;
    labelInput.focus();
  }

  function closePrizeModal() {
    const modal = document.getElementById('games-prize-modal');
    if (modal) modal.hidden = true;
    document.getElementById('games-prize-form')?.reset();
    const weightInput = document.getElementById('games-prize-weight');
    if (weightInput) delete weightInput.dataset.touched;
  }

  async function savePrizeForm(e) {
    e.preventDefault();
    const kind = document.getElementById('games-prize-kind')?.value;
    const parentId = document.getElementById('games-prize-parent')?.value;
    const editId = document.getElementById('games-prize-edit-id')?.value;
    const label = document.getElementById('games-prize-label')?.value.trim();
    const prizeType = document.getElementById('games-prize-type')?.value;
    const prizeValue = document.getElementById('games-prize-value')?.value.trim() || '';
    const quantity = Number(document.getElementById('games-prize-quantity')?.value);
    const weight = Math.max(1, Number(document.getElementById('games-prize-weight')?.value) || 3);
    if (!label) { alert('Ilagay ang prize name'); return; }

    const isLoser = prizeType === 'none' || prizeType === 'bomb';
    let url;
    let body;
    if (kind === 'wheel') {
      url = editId
        ? `/admin/games/wheel/prizes/${editId}`
        : `/admin/games/wheel/${parentId}/prizes`;
      body = { label, prizeType, prizeValue, quantity: Math.max(1, quantity || 1) };
    } else if (kind === 'instant') {
      url = editId
        ? `/admin/games/instant/prizes/${editId}`
        : `/admin/games/instant/${parentId}/prizes`;
      body = {
        label, prizeType, prizeValue, weight,
        quantity: Number.isFinite(quantity) ? quantity : -1,
        tileStyle: isLoser ? 'gray' : 'gold'
      };
    } else {
      url = editId
        ? `/admin/games/${kind}/prizes/${editId}`
        : `/admin/games/${kind}/${parentId}/prizes`;
      body = { label, prizeType, prizeValue, weight, quantity: Number.isFinite(quantity) ? quantity : -1 };
    }

    await api(url, {
      method: editId ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    });
    closePrizeModal();
    if (kind === 'wheel') loadWheelAdmin();
    else if (kind === 'scratch') loadScratchAdmin();
    else if (kind === 'mystery') loadMysteryAdmin();
    else loadInstantAdmin();
  }

  async function deletePrize(kind, id) {
    if (!confirm('Delete this prize?')) return;
    const path = kind === 'wheel'
      ? `/admin/games/wheel/prizes/${id}`
      : kind === 'instant'
        ? `/admin/games/instant/prizes/${id}`
        : `/admin/games/${kind}/prizes/${id}`;
    await api(path, { method: 'DELETE' });
    if (kind === 'wheel') loadWheelAdmin();
    else if (kind === 'scratch') loadScratchAdmin();
    else if (kind === 'mystery') loadMysteryAdmin();
    else loadInstantAdmin();
  }

  function openWheelMaxModal(campaignId, currentMax) {
    const modal = document.getElementById('games-wheel-max-modal');
    document.getElementById('games-wheel-max-campaign').value = campaignId;
    document.getElementById('games-wheel-max-input').value = currentMax || 20;
    if (modal) modal.hidden = false;
  }

  function closeWheelMaxModal() {
    const modal = document.getElementById('games-wheel-max-modal');
    if (modal) modal.hidden = true;
  }

  function bindPrizeModal() {
    if (prizeModalBound) return;
    prizeModalBound = true;
    document.getElementById('games-prize-form')?.addEventListener('submit', (e) => {
      savePrizeForm(e).catch((err) => alert(err.message));
    });
    document.getElementById('games-prize-cancel')?.addEventListener('click', closePrizeModal);
    document.getElementById('games-prize-modal-close')?.addEventListener('click', closePrizeModal);
    document.getElementById('games-prize-type')?.addEventListener('change', () => {
      const w = document.getElementById('games-prize-weight');
      if (w) delete w.dataset.touched;
      refreshPrizeTypeFields();
    });
    document.getElementById('games-prize-weight')?.addEventListener('input', (e) => {
      e.target.dataset.touched = '1';
    });
    document.getElementById('games-wheel-max-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('games-wheel-max-campaign').value;
      const maxEntries = Math.max(1, Number(document.getElementById('games-wheel-max-input').value) || 0);
      try {
        await api(`/admin/games/wheel/${id}`, { method: 'PUT', body: JSON.stringify({ maxEntries }) });
        closeWheelMaxModal();
        loadWheelAdmin();
      } catch (err) { alert(err.message); }
    });
    document.getElementById('games-wheel-max-close')?.addEventListener('click', closeWheelMaxModal);
  }

  async function turnAllGamesOff() {
    renderGameOpenToggles({
      wheel: false,
      scratch: false,
      mystery: false,
      dice: false,
      pick: false,
      vault: false
    });
    await saveGamesSettings();
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
        <p class="admin-muted">Max entries: ${c.maxEntries || '—'} · Joined: ${c.entryCount || 0}${c.maxEntries ? ` / ${c.maxEntries}` : ''} · Min order: ₱${c.minOrderTotal || 0}</p>
        ${c.status === 'scheduled' ? `<button type="button" class="admin-btn admin-btn-outline admin-btn-sm admin-wheel-max" data-id="${c.id}" data-max="${c.maxEntries || 20}">Edit max entries</button>` : ''}
        ${c.winner ? `<p class="admin-success-text">Winner: ${esc(c.winner.displayName)} (#${esc(c.winner.orderNumber)})</p>` : ''}
        ${(c.winners || []).length > 1 ? `<p class="admin-muted">All winners: ${c.winners.map((w) => `${esc(w.displayName)} (${esc(w.prizeLabel)})`).join(', ')}</p>` : ''}
        <p><strong>Prizes:</strong></p>
        <ul class="admin-prize-list">${prizeListHtml(c.prizes, 'wheel', c.id)}</ul>
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

    list.querySelectorAll('.admin-wheel-max').forEach((btn) => {
      btn.addEventListener('click', () => openWheelMaxModal(btn.dataset.id, btn.dataset.max));
    });
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
    bindPrizeRowActions(list);
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
        <ul class="admin-prize-list">${prizeListHtml(p.prizes, 'scratch', p.id)}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-scratch-add-prize" data-id="${p.id}">Add scratch prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-scratch-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('scratch', btn.dataset.id));
    });
    list.querySelectorAll('.admin-pool-ends').forEach((btn) => {
      btn.addEventListener('click', () => setPoolEndDate(btn.dataset.kind, btn.dataset.id));
    });
    bindPrizeRowActions(list);
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
        <ul class="admin-prize-list">${prizeListHtml(p.prizes, 'mystery', p.id)}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-mystery-add-prize" data-id="${p.id}">Add box prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-mystery-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('mystery', btn.dataset.id));
    });
    list.querySelectorAll('.admin-pool-ends').forEach((btn) => {
      btn.addEventListener('click', () => setPoolEndDate(btn.dataset.kind, btn.dataset.id));
    });
    bindPrizeRowActions(list);
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
        <ul class="admin-prize-list">${prizeListHtml(p.prizes, 'instant', p.gameKey)}</ul>
        <button type="button" class="admin-btn admin-btn-outline admin-instant-add-prize" data-key="${p.gameKey}">Add prize</button>
      </div>`).join('');
    list.querySelectorAll('.admin-instant-add-prize').forEach((btn) => {
      btn.addEventListener('click', () => openPrizeModal('instant', btn.dataset.key));
    });
    list.querySelectorAll('.admin-pool-ends').forEach((btn) => {
      btn.addEventListener('click', () => setPoolEndDate(btn.dataset.kind, btn.dataset.id));
    });
    bindPrizeRowActions(list);
  }

  function bindGamesForms() {
    bindPrizeModal();
    document.getElementById('games-enabled-toggle')?.addEventListener('change', () => {
      saveGamesSettings().catch((e) => alert(e.message));
    });
    document.getElementById('games-channel-url')?.addEventListener('change', () => {
      saveGamesSettings().catch((e) => alert(e.message));
    });
    document.getElementById('games-eligibility-save')?.addEventListener('click', () => {
      saveGamesSettings().then(() => alert('Games eligibility saved.')).catch((e) => alert(e.message));
    });
    document.getElementById('games-all-off-btn')?.addEventListener('click', () => {
      turnAllGamesOff().then(() => alert('All games are now closed.')).catch((e) => alert(e.message));
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
            maxEntries: Number(fd.get('maxEntries') || 20),
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
