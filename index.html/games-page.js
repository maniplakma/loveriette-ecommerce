/* Games hub — /games */
(function () {
  let hubEligibility = null;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function icon(name) {
    return typeof window.gamesIcon === 'function' ? window.gamesIcon(name) : '';
  }

  async function gamesApi(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return 'Now';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }

  function countdownHtml(iso, label) {
    if (!iso) return '';
    return `<div class="games-countdown">
      <span class="games-countdown-label">${esc(label)}</span>
      <strong class="games-countdown-value" data-countdown="${esc(iso)}">—</strong>
    </div>`;
  }

  function endsMetaHtml(endsAt) {
    if (!endsAt) return '';
    return `<p class="games-meta games-meta--timer">Ends: <span data-end-countdown="${esc(endsAt)}">${esc(fmtDate(endsAt))}</span></p>`;
  }

  function prizeChips(prizes) {
    if (!prizes?.length) return '<p class="games-meta">Prizes coming soon</p>';
    return `<div class="games-prize-chips">${prizes.map((p) => {
      const qty = p.quantity != null && p.quantity >= 0 ? ` · ${p.remaining != null ? p.remaining : p.quantity} left` : '';
      return `<span class="games-prize-chip games-prize-chip--${esc(p.tileStyle || 'gold')}">${esc(p.label)}${qty ? `<small>${qty}</small>` : ''}</span>`;
    }).join('')}</div>`;
  }

  function wheelVisualHtml(extraClass) {
    return `
      <div class="games-wheel-visual games-wheel-visual--lg${extraClass ? ` ${extraClass}` : ''}">
        <div class="games-wheel-segments" aria-hidden="true"></div>
        <div class="games-wheel-ring"></div>
        <div class="games-wheel-center">${icon('wheel', 'games-icon--wheel')}</div>
      </div>`;
  }

  function entriesWall(entries, winners, mySlots) {
    const list = entries?.length ? entries : [];
    const winOrders = new Set((winners || []).map((w) => w.orderNumber));
    const mine = new Set((mySlots || []).map((s) => s.orderNumber));
    if (!list.length) return '<p class="games-meta">No entries yet — be the first!</p>';
    return `
      <div class="games-entries-wall">
        <h4 class="games-arena-sub">Players (${list.length})</h4>
        <div class="games-slot-wall">${list.map((e) =>
    `<span class="games-slot-chip${winOrders.has(e.orderNumber) ? ' is-winner' : ''}${mine.has(e.orderNumber) ? ' is-mine' : ''}">${esc(e.displayName)}</span>`
  ).join('')}</div>
      </div>`;
  }

  function winnersPanel(winners) {
    if (!winners?.length) return '';
    return `
      <div class="games-winners-panel">
        <h4 class="games-arena-sub">Winners</h4>
        <ul class="games-winners-list">${winners.map((w) =>
    `<li><strong>${esc(w.displayName)}</strong><span>${esc(w.prizeLabel || 'Prize')}</span></li>`
  ).join('')}</ul>
      </div>`;
  }

  function arenaShell({ type, title, open, visible, statusLabel, body, prizesHtml, guideUrl, metaHtml, expandable }) {
    const isVisible = visible !== false;
    const state = !isVisible ? 'closed' : (open ? 'open' : 'results');
    const status = !isVisible ? 'Closed' : (statusLabel || (open ? 'Open' : 'Results'));
    const guide = guideUrl
      ? `<a href="${esc(guideUrl)}" class="games-guide-link" target="_blank" rel="noopener noreferrer" data-no-expand>How to play</a>`
      : '';
    const expandHint = expandable !== false
      ? '<span class="games-expand-hint" aria-hidden="true">Tap to expand</span>'
      : '';
    return `
      <article class="games-arena games-arena--${state} games-arena--${type}" data-game-type="${esc(type)}" data-expandable="${expandable !== false ? '1' : '0'}" tabindex="0" role="button" aria-label="Open ${esc(title)} full view">
        <div class="games-arena-glow" aria-hidden="true"></div>
        <header class="games-arena-head">
          ${icon(type, 'games-icon--head')}
          <h2>${esc(title)}</h2>
          ${guide}
          <span class="games-arena-status games-arena-status--${isVisible && open ? 'open' : 'closed'}">${esc(status)}</span>
        </header>
        ${metaHtml || ''}
        ${isVisible && prizesHtml ? `<div class="games-arena-prizes"><h3 class="games-arena-sub">Prizes</h3>${prizesHtml}</div>` : ''}
        <div class="games-arena-body">${body}</div>
        ${expandHint}
      </article>`;
  }

  function closedBody(channelUrl) {
    return `
      <div class="games-arena-closed">
        ${icon('lock', 'games-icon--gate')}
        <h3>Closed Game</h3>
        <p>Join our channel for games updates.</p>
        <a href="${esc(channelUrl)}" class="games-channel-btn" target="_blank" rel="noopener noreferrer">Join Channel</a>
      </div>`;
  }

  function gateBanner(kind, channelUrl, minTotal, elig) {
    if (kind === 'closed') return closedBody(channelUrl);
    const purchaseMsg = elig?.message || 'Shop order → unlock after approval';
    if (kind === 'purchase') {
      return `
        <div class="games-arena-gate games-arena-gate--compact">
          ${icon('cart', 'games-icon--gate')}
          <div><strong>Purchase to play</strong><span>${esc(purchaseMsg)}</span></div>
          <a href="/shop" class="games-shop-btn games-shop-btn--sm">Shop</a>
        </div>`;
    }
    return `
      <div class="games-arena-gate games-arena-gate--compact">
        ${icon('user', 'games-icon--gate')}
        <div><strong>Sign in to play</strong><span>Preview the game design below</span></div>
        <a href="login.html" class="games-shop-btn games-shop-btn--sm">Sign In</a>
      </div>`;
  }

  function demoBadge() {
    return '<span class="games-demo-badge">Preview</span>';
  }

  function demoWheel() {
    return `
      <div class="games-demo-stage games-demo-wheel">
        ${demoBadge()}
        <div class="games-wheel-visual games-wheel-visual--lg">
          <div class="games-wheel-segments" aria-hidden="true"></div>
          <div class="games-wheel-ring"></div>
          <div class="games-wheel-center">${icon('wheel', 'games-icon--wheel')}</div>
        </div>
        <p class="games-demo-caption">Grand draw — entries from approved orders</p>
      </div>`;
  }

  function demoScratch() {
    return `
      <div class="games-demo-stage">
        ${demoBadge()}
        <div class="games-scratch-grid games-scratch-grid--demo">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => '<div class="games-scratch-tile games-scratch-tile--demo"></div>').join('')}
        </div>
        <p class="games-demo-caption">Scratch 4 tiles to reveal your prize</p>
      </div>`;
  }

  function demoMystery() {
    return `
      <div class="games-demo-stage">
        ${demoBadge()}
        <div class="games-mystery-row">
          ${[0, 1, 2].map((i) => `<div class="games-mystery-box games-mystery-box--demo"><span>?</span><small>Box ${i + 1}</small></div>`).join('')}
        </div>
        <p class="games-demo-caption">Only one box holds the prize</p>
      </div>`;
  }

  function demoDice() {
    return `
      <div class="games-demo-stage games-demo-dice">
        ${demoBadge()}
        <div class="games-dice-row">
          <div class="games-die games-die--demo"><span>⚅</span></div>
          <div class="games-die games-die--demo"><span>⚃</span></div>
        </div>
        <button type="button" class="games-action-btn" disabled>Roll Dice</button>
        <p class="games-demo-caption">Match lucky sums for bigger prizes</p>
      </div>`;
  }

  function demoPick() {
    return `
      <div class="games-demo-stage">
        ${demoBadge()}
        <div class="games-pick-row">
          ${['♠', '♥', '♦'].map((s) => `<div class="games-pick-card games-pick-card--demo"><span>${s}</span></div>`).join('')}
        </div>
        <p class="games-demo-caption">Flip one card — ace wins big</p>
      </div>`;
  }

  function demoVault() {
    return `
      <div class="games-demo-stage games-demo-vault">
        ${demoBadge()}
        <div class="games-vault-row">
          ${['Bronze', 'Silver', 'Gold'].map((l) => `<div class="games-vault-door games-vault-door--demo"><span>${l}</span></div>`).join('')}
        </div>
        <p class="games-demo-caption">Pick a vault door to unlock treasure</p>
      </div>`;
  }

  function resolveGate(game, state) {
    if (!game.open) return 'closed';
    if (!state.authenticated) return 'signin';
    if (game.needsPurchase && !game.canPlay) return 'purchase';
    return null;
  }

  function guideFor(state, type) {
    return state?.eligibility?.guides?.[type] || `/guide.html#game-${type}`;
  }

  function showPrizeWin(result) {
    const f = result?.fulfillment;
    const prize = result?.prize;
    if (!f || f.type === 'none') return;
    let modal = document.getElementById('games-prize-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'games-prize-modal';
      modal.className = 'games-prize-modal';
      modal.innerHTML = '<div class="games-prize-modal-card" role="dialog" aria-modal="true"><button type="button" class="games-prize-modal-close" aria-label="Close">&times;</button><div id="games-prize-modal-body"></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('.games-prize-modal-close').addEventListener('click', () => modal.hidden = true);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    }
    const body = modal.querySelector('#games-prize-modal-body');
    const label = esc(prize?.label || f.label || 'Prize');
    let inner = `<h3 class="games-prize-modal-title">You won!</h3><p class="games-prize-modal-prize">${label}</p>`;

    if (f.type === 'loyalty' || f.type === 'wallet') {
      inner += `<p class="games-prize-modal-msg">${esc(f.message || `₱${f.amount} credited automatically.`)}</p>`;
      inner += '<p class="games-prize-modal-note">Check your wallet — we also sent a notification.</p>';
    } else if (f.type === 'redeem' && f.code) {
      inner += `<p class="games-prize-modal-msg">${esc(f.message || 'Your voucher is ready.')}</p>`;
      inner += `<div class="games-prize-code-row"><code id="games-prize-code">${esc(f.code)}</code><button type="button" class="games-shop-btn games-shop-btn--sm" id="games-copy-code">Copy code</button></div>`;
    } else if (f.type === 'product') {
      inner += `<p class="games-prize-modal-msg">${esc(f.instruction || f.message)}</p>`;
      inner += `<p class="games-prize-modal-telegram">Send screenshot to <strong>${esc(f.telegram || '@loveriette')}</strong> on Telegram</p>`;
      inner += '<p class="games-prize-modal-note">Take a screenshot of this screen before closing.</p>';
    } else {
      inner += `<p class="games-prize-modal-msg">${esc(f.message || '')}</p>`;
    }

    body.innerHTML = inner;
    modal.hidden = false;
    const copyBtn = document.getElementById('games-copy-code');
    if (copyBtn && f.code) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(f.code).then(() => {
          copyBtn.textContent = 'Copied!';
        }).catch(() => { copyBtn.textContent = f.code; });
      }, { once: true });
    }
  }

  function wrapPlay(game, state, type, demoFn, playHtml) {
    if (game.open === false && game.status !== 'drawn') {
      if (game.endsAt && new Date(game.endsAt).getTime() < Date.now()) {
        return `<div class="games-arena-ended"><p>This game has ended.</p>${endsMetaHtml(game.endsAt)}</div>`;
      }
      return closedBody(state.channelUrl);
    }
    const gate = resolveGate(game, state);
    const parts = [];
    if (gate) parts.push(gateBanner(gate, state.channelUrl, game.minOrderTotal, state.eligibility));
    if (game.canPlay && playHtml) parts.push(playHtml);
    else parts.push(demoFn());
    return parts.join('');
  }

  function renderWheel(game, state) {
    const drawn = game.status === 'drawn';
    const visible = game.visible !== false;
    const live = !!game.open && !drawn;
    let body = '';
    let metaHtml = '';

    if (!visible) {
      body = closedBody(state.channelUrl);
    } else if (drawn) {
      metaHtml = `<div class="games-arena-meta">${countdownHtml(game.drawnAt || game.drawAt, 'Drawn')}</div>`;
      body = `
        <div class="games-play-stage games-play-stage--results">
          ${wheelVisualHtml('is-spin-result')}
          ${winnersPanel(game.winners)}
          ${entriesWall(game.entries, game.winners, game.mySlots)}
          <p class="games-meta">${game.entryCount || 0} total entries</p>
        </div>`;
    } else {
      metaHtml = `<div class="games-arena-meta">${countdownHtml(game.drawAt, 'Results in')}</div>`;
      const slots = (game.mySlots || []).map((s) =>
        `<span class="games-slot-chip is-mine">#${esc(s.orderNumber)}</span>`
      ).join('');
      const play = `
        <div class="games-play-stage">
          ${wheelVisualHtml(live ? '' : '')}
          <p class="games-meta">${game.entryCount || 0} entries · Draw ${esc(fmtDate(game.drawAt))}</p>
          ${game.mySlots?.length ? `<p class="games-meta">Your slots: <strong>${game.mySlots.length}</strong></p><div class="games-slot-wall">${slots}</div>` : ''}
          ${entriesWall(game.entries, [], game.mySlots)}
        </div>`;
      body = wrapPlay({ ...game, open: live || visible }, state, 'wheel', demoWheel, play);
    }

    return arenaShell({
      type: 'wheel',
      title: game.title || 'Spin the Wheel',
      open: live,
      visible,
      statusLabel: drawn ? 'Drawn' : (live ? 'Live' : 'Scheduled'),
      prizesHtml: prizeChips(game.prizes),
      guideUrl: guideFor(state, 'wheel'),
      metaHtml,
      body
    });
  }

  function scratchPlay(card) {
    if (card.scratchedAt) {
      return `<article class="games-play-card"><h4>#${esc(card.orderNumber)}</h4>
        <p class="games-scratch-result">${esc(card.prizeLabel || 'No prize')}</p></article>`;
    }
    return `
      <article class="games-play-card" data-scratch-id="${card.id}">
        <h4>Order #${esc(card.orderNumber)}</h4>
        <div class="games-scratch-grid" id="scratch-grid-${card.id}">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    `<button type="button" class="games-scratch-tile" data-tile="${i}"></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="scratch-msg-${card.id}" hidden></p>
      </article>`;
  }

  function renderScratch(game, state) {
    const pending = (game.cards || []).filter((c) => !c.scratchedAt);
    const play = pending.length ? pending.map(scratchPlay).join('') : '';
    const metaHtml = game.endsAt ? `<div class="games-arena-meta">${countdownHtml(game.endsAt, 'Ends in')}</div>` : '';
    return arenaShell({
      type: 'scratch',
      title: game.title || 'Scratch Cards',
      open: game.open,
      visible: game.open || !!(game.endsAt && new Date(game.endsAt) > Date.now()),
      prizesHtml: prizeChips(game.prizes),
      guideUrl: guideFor(state, 'scratch'),
      metaHtml,
      body: wrapPlay(game, state, 'scratch', demoScratch, play)
    });
  }

  function mysteryPlay(play) {
    if (play.playedAt) {
      return `<article class="games-play-card"><h4>#${esc(play.orderNumber)}</h4>
        <p class="games-scratch-result">${esc(play.prizeLabel || 'No prize')}</p></article>`;
    }
    return `
      <article class="games-play-card" data-mystery-id="${play.id}">
        <h4>Order #${esc(play.orderNumber)}</h4>
        <div class="games-mystery-row">
          ${[0, 1, 2].map((i) =>
    `<button type="button" class="games-mystery-box" data-box="${i}"><span>?</span><small>Box ${i + 1}</small></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="mystery-msg-${play.id}" hidden></p>
      </article>`;
  }

  function renderMystery(game, state) {
    const pending = (game.plays || []).filter((p) => !p.playedAt);
    const metaHtml = game.endsAt ? `<div class="games-arena-meta">${countdownHtml(game.endsAt, 'Ends in')}</div>` : '';
    return arenaShell({
      type: 'mystery',
      title: game.title || 'Mystery Box',
      open: game.open,
      visible: game.open || !!(game.endsAt && new Date(game.endsAt) > Date.now()),
      prizesHtml: prizeChips(game.prizes),
      guideUrl: guideFor(state, 'mystery'),
      metaHtml,
      body: wrapPlay(game, state, 'mystery', demoMystery, pending.map(mysteryPlay).join(''))
    });
  }

  function instantPlay(game, state) {
    const pending = (game.plays || []).filter((p) => !p.playedAt);
    if (!pending.length) return '';
    const play = pending[0];
    if (game.gameKey === 'dice') {
      return `
        <article class="games-play-card" data-instant-id="${play.id}" data-instant-key="dice">
          <h4>Order #${esc(play.orderNumber)}</h4>
          <div class="games-dice-row" id="dice-row-${play.id}">
            <div class="games-die"><span>?</span></div>
            <div class="games-die"><span>?</span></div>
          </div>
          <button type="button" class="games-action-btn" data-roll-dice="${play.id}">Roll Dice</button>
          <p class="games-scratch-msg" id="instant-msg-${play.id}" hidden></p>
        </article>`;
    }
    if (game.gameKey === 'pick') {
      return `
        <article class="games-play-card" data-instant-id="${play.id}" data-instant-key="pick">
          <h4>Order #${esc(play.orderNumber)}</h4>
          <div class="games-pick-row">
            ${[0, 1, 2].map((i) =>
    `<button type="button" class="games-pick-card" data-pick="${i}"><span>?</span></button>`
  ).join('')}
          </div>
          <p class="games-scratch-msg" id="instant-msg-${play.id}" hidden></p>
        </article>`;
    }
    return `
      <article class="games-play-card" data-instant-id="${play.id}" data-instant-key="vault">
        <h4>Order #${esc(play.orderNumber)}</h4>
        <div class="games-vault-row">
          ${[0, 1, 2].map((i) =>
    `<button type="button" class="games-vault-door" data-vault="${i}"><span>${['B', 'S', 'G'][i]}</span></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="instant-msg-${play.id}" hidden></p>
      </article>`;
  }

  function renderInstant(game, state, type, demoFn) {
    const metaHtml = game.endsAt ? `<div class="games-arena-meta">${countdownHtml(game.endsAt, 'Ends in')}</div>` : '';
    return arenaShell({
      type,
      title: game.title || INSTANT_TITLES[type],
      open: game.open,
      visible: game.open || !!(game.endsAt && new Date(game.endsAt) > Date.now()),
      prizesHtml: prizeChips(game.prizes),
      guideUrl: guideFor(state, type),
      metaHtml,
      body: wrapPlay(game, state, type, demoFn, instantPlay(game, state))
    });
  }

  const INSTANT_TITLES = { dice: 'Lucky Dice', pick: 'Card Flip', vault: 'Treasure Vault' };

  function bindScratch() {
    document.querySelectorAll('[data-scratch-id]').forEach((card) => {
      const id = card.dataset.scratchId;
      const grid = card.querySelector('.games-scratch-grid');
      const msg = document.getElementById(`scratch-msg-${id}`);
      if (!grid || grid.dataset.bound) return;
      grid.dataset.bound = '1';
      let revealed = false;
      grid.addEventListener('click', async (e) => {
        const tile = e.target.closest('.games-scratch-tile');
        if (!tile || revealed) return;
        tile.classList.add('scratched');
        if (grid.querySelectorAll('.games-scratch-tile.scratched').length < 4) return;
        revealed = true;
        grid.querySelectorAll('.games-scratch-tile').forEach((t) => { t.disabled = true; });
        try {
          const result = await gamesApi(`/account/games/scratch/${id}/play`, { method: 'POST', body: '{}' });
          const label = result.prize?.label || 'No prize';
          grid.innerHTML = `<div class="games-scratch-reveal">${esc(label)}</div>`;
          if (msg) { msg.hidden = false; msg.textContent = `You won: ${label}`; }
          showPrizeWin(result);
          setTimeout(() => loadGamesHub(), 2500);
        } catch (err) {
          if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
          revealed = false;
        }
      });
    });
  }

  function bindMystery() {
    document.querySelectorAll('[data-mystery-id]').forEach((card) => {
      const id = card.dataset.mysteryId;
      const msg = document.getElementById(`mystery-msg-${id}`);
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      card.querySelectorAll('.games-mystery-box').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (card.dataset.playing) return;
          card.dataset.playing = '1';
          card.querySelectorAll('.games-mystery-box').forEach((b) => { b.disabled = true; });
          try {
            const result = await gamesApi(`/account/games/mystery/${id}/play`, {
              method: 'POST',
              body: JSON.stringify({ boxIndex: Number(btn.dataset.box) })
            });
            card.querySelector('.games-mystery-row').innerHTML = (result.boxes || []).map((b) =>
              `<div class="games-mystery-box revealed${b.winner ? ' is-winner' : ''}"><span>${esc(b.label)}</span></div>`
            ).join('');
            if (msg) { msg.hidden = false; msg.textContent = result.prize ? `You won: ${result.prize.label}` : 'No prize'; }
            showPrizeWin(result);
            setTimeout(() => loadGamesHub(), 2500);
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
            card.querySelectorAll('.games-mystery-box').forEach((b) => { b.disabled = false; });
          }
        });
      });
    });
  }

  const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function bindInstant() {
    document.querySelectorAll('[data-roll-dice]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async () => {
        const id = btn.dataset.rollDice;
        const card = btn.closest('[data-instant-id]');
        const msg = document.getElementById(`instant-msg-${id}`);
        btn.disabled = true;
        try {
          const result = await gamesApi(`/account/games/instant/dice/${id}/play`, { method: 'POST', body: '{}' });
          const dice = result.result?.dice || [1, 1];
          const row = card.querySelector('.games-dice-row');
          row.innerHTML = dice.map((d) => `<div class="games-die is-rolled"><span>${DICE_FACES[d - 1] || d}</span></div>`).join('');
          if (msg) { msg.hidden = false; msg.textContent = result.prize ? `You won: ${result.prize.label}` : 'No prize'; }
          showPrizeWin(result);
          setTimeout(() => loadGamesHub(), 2500);
        } catch (err) {
          if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-instant-key="pick"]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      const id = card.dataset.instantId;
      const msg = document.getElementById(`instant-msg-${id}`);
      card.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (card.dataset.playing) return;
          card.dataset.playing = '1';
          card.querySelectorAll('[data-pick]').forEach((b) => { b.disabled = true; });
          try {
            const result = await gamesApi(`/account/games/instant/pick/${id}/play`, {
              method: 'POST',
              body: JSON.stringify({ choice: Number(btn.dataset.pick) })
            });
            card.querySelector('.games-pick-row').innerHTML = (result.result?.cards || []).map((c) =>
              `<div class="games-pick-card revealed${c.winner ? ' is-winner' : ''}"><span>${esc(c.label)}</span></div>`
            ).join('');
            if (msg) { msg.hidden = false; msg.textContent = result.prize ? `You won: ${result.prize.label}` : 'No prize'; }
            showPrizeWin(result);
            setTimeout(() => loadGamesHub(), 2500);
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
          }
        });
      });
    });

    document.querySelectorAll('[data-instant-key="vault"]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      const id = card.dataset.instantId;
      const msg = document.getElementById(`instant-msg-${id}`);
      card.querySelectorAll('[data-vault]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (card.dataset.playing) return;
          card.dataset.playing = '1';
          card.querySelectorAll('[data-vault]').forEach((b) => { b.disabled = true; });
          try {
            const result = await gamesApi(`/account/games/instant/vault/${id}/play`, {
              method: 'POST',
              body: JSON.stringify({ choice: Number(btn.dataset.vault) })
            });
            card.querySelector('.games-vault-row').innerHTML = (result.result?.vaults || []).map((v) =>
              `<div class="games-vault-door revealed${v.winner ? ' is-winner' : ''}"><span>${esc(v.label)}</span></div>`
            ).join('');
            if (msg) { msg.hidden = false; msg.textContent = result.prize ? `You won: ${result.prize.label}` : 'No prize'; }
            showPrizeWin(result);
            setTimeout(() => loadGamesHub(), 2500);
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
          }
        });
      });
    });
  }

  let countdownTimer = null;
  let hubRefreshPending = false;

  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach((el) => {
      const target = el.dataset.countdown;
      if (!target) return;
      const ms = new Date(target.includes('T') ? target : `${target.replace(' ', 'T')}Z`).getTime() - Date.now();
      if (Number.isNaN(ms)) return;
      if (ms <= 0) {
        el.textContent = 'Drawing now…';
        el.classList.add('is-due');
        if (!hubRefreshPending && el.closest('[data-game-type="wheel"]')) {
          hubRefreshPending = true;
          setTimeout(() => { hubRefreshPending = false; loadGamesHub(); }, 2000);
        }
      } else {
        el.textContent = fmtCountdown(ms);
      }
    });
    document.querySelectorAll('[data-end-countdown]').forEach((el) => {
      const target = el.dataset.endCountdown;
      const ms = new Date(target.includes('T') ? target : `${target.replace(' ', 'T')}Z`).getTime() - Date.now();
      if (ms <= 0) el.textContent = 'Ended';
      else el.textContent = fmtCountdown(ms);
    });
  }

  function startCountdowns() {
    tickCountdowns();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(tickCountdowns, 1000);
  }

  function ensureExpandModal() {
    let modal = document.getElementById('games-expand-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'games-expand-modal';
    modal.className = 'games-expand-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="games-expand-panel" role="dialog" aria-modal="true">
        <header class="games-expand-head">
          <h2 id="games-expand-title"></h2>
          <button type="button" class="games-expand-close" aria-label="Close">&times;</button>
        </header>
        <div class="games-expand-body" id="games-expand-body"></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => { modal.hidden = true; document.body.classList.remove('games-expand-open'); };
    modal.querySelector('.games-expand-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
    return modal;
  }

  function openArenaExpand(arena) {
    if (!arena || arena.dataset.expandable === '0') return;
    const modal = ensureExpandModal();
    const title = arena.querySelector('.games-arena-head h2')?.textContent || 'Game';
    const body = arena.querySelector('.games-arena-body')?.innerHTML || '';
    const meta = arena.querySelector('.games-arena-meta')?.outerHTML || '';
    const prizes = arena.querySelector('.games-arena-prizes')?.outerHTML || '';
    modal.querySelector('#games-expand-title').textContent = title;
    modal.querySelector('#games-expand-body').innerHTML = `${meta}${prizes}<div class="games-expand-play">${body}</div>`;
    modal.hidden = false;
    document.body.classList.add('games-expand-open');
    bindScratch();
    bindMystery();
    bindInstant();
    tickCountdowns();
  }

  function bindExpand() {
    document.querySelectorAll('.games-arena[data-expandable="1"]').forEach((arena) => {
      if (arena.dataset.expandBound) return;
      arena.dataset.expandBound = '1';
      const open = (e) => {
        if (e.target.closest('[data-no-expand], a, button, input, .games-scratch-tile, .games-mystery-box, .games-pick-card, .games-vault-door, .games-action-btn')) return;
        openArenaExpand(arena);
      };
      arena.addEventListener('click', open);
      arena.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArenaExpand(arena); }
      });
    });
  }

  function renderRecentWinners(list) {
    const el = document.getElementById('games-recent-winners');
    if (!el || !list?.length) return;
    el.hidden = false;
    el.innerHTML = `
      <span class="games-recent-label">Recent wins</span>
      <div class="games-recent-track">${list.map((w) =>
    `<span class="games-recent-item"><strong>${esc(w.displayName)}</strong> won ${esc(w.label)}</span>`
  ).join('')}</div>`;
  }

  function renderHub(data) {
    hubEligibility = data.eligibility || null;
    const intro = document.getElementById('games-hub-intro');
    if (intro && data.eligibility?.message) {
      intro.querySelector('p').textContent = data.eligibility.message;
    }
    renderRecentWinners(data.recentWinners);
    const grid = document.getElementById('games-arena-grid');
    if (!grid) return;
    grid.innerHTML = [
      renderWheel(data.wheel || {}, data),
      renderScratch(data.scratch || {}, data),
      renderMystery(data.mystery || {}, data),
      renderInstant(data.dice || {}, data, 'dice', demoDice),
      renderInstant(data.pick || {}, data, 'pick', demoPick),
      renderInstant(data.vault || {}, data, 'vault', demoVault)
    ].join('');
    bindScratch();
    bindMystery();
    bindInstant();
    bindExpand();
    startCountdowns();
  }

  async function loadGamesHub() {
    const grid = document.getElementById('games-arena-grid');
    try {
      renderHub(await gamesApi('/api/games'));
    } catch (e) {
      if (grid) grid.innerHTML = `<p class="games-empty">${esc(e.message)}</p>`;
    }
  }

  function init() {
    if (typeof initPlatformNav === 'function') initPlatformNav('games');
    loadGamesHub();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.loadGamesHub = loadGamesHub;
})();
