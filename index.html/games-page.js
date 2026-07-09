/* Games hub — /games */
(function () {
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

  function prizeChips(prizes) {
    if (!prizes?.length) return '<p class="games-meta">Prizes coming soon</p>';
    return `<div class="games-prize-chips">${prizes.map((p) =>
      `<span class="games-prize-chip games-prize-chip--${esc(p.tileStyle || 'gold')}">${esc(p.label)}</span>`
    ).join('')}</div>`;
  }

  function arenaShell({ type, title, open, statusLabel, body, prizesHtml }) {
    const state = open ? 'open' : 'closed';
    const status = open ? (statusLabel || 'Open') : 'Closed';
    return `
      <article class="games-arena games-arena--${state} games-arena--${type}">
        <div class="games-arena-glow" aria-hidden="true"></div>
        <header class="games-arena-head">
          ${icon(type, 'games-icon--head')}
          <h2>${esc(title)}</h2>
          <span class="games-arena-status games-arena-status--${state}">${esc(status)}</span>
        </header>
        ${open && prizesHtml ? `<div class="games-arena-prizes"><h3 class="games-arena-sub">Prizes</h3>${prizesHtml}</div>` : ''}
        <div class="games-arena-body">${body}</div>
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

  function gateBanner(kind, channelUrl, minTotal) {
    if (kind === 'closed') return closedBody(channelUrl);
    const min = Number(minTotal) > 0 ? ` (min. ₱${minTotal})` : '';
    if (kind === 'purchase') {
      return `
        <div class="games-arena-gate games-arena-gate--compact">
          ${icon('cart', 'games-icon--gate')}
          <div><strong>Purchase to play</strong><span>Shop order${min} → unlock after approval</span></div>
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

  function wrapPlay(game, state, type, demoFn, playHtml) {
    const gate = resolveGate(game, state);
    if (!game.open) return closedBody(state.channelUrl);
    const parts = [];
    if (gate) parts.push(gateBanner(gate, state.channelUrl, game.minOrderTotal));
    if (game.canPlay && playHtml) parts.push(playHtml);
    else parts.push(demoFn());
    return parts.join('');
  }

  function renderWheel(game, state) {
    const drawn = game.status === 'drawn';
    let play = '';
    if (game.canPlay) {
      const slots = (game.mySlots || []).map((s) =>
        `<span class="games-slot-chip is-mine">#${esc(s.orderNumber)}</span>`
      ).join('');
      play = `
        <div class="games-play-stage">
          <div class="games-wheel-visual games-wheel-visual--lg">
            <div class="games-wheel-segments" aria-hidden="true"></div>
            <div class="games-wheel-ring"></div>
            <div class="games-wheel-center">${icon('wheel', 'games-icon--wheel')}</div>
          </div>
          <p class="games-meta">Draw: ${esc(fmtDate(game.drawAt))} · ${game.entryCount || 0} entries</p>
          <p class="games-meta">Your slots: <strong>${(game.mySlots || []).length}</strong></p>
          <div class="games-slot-wall">${slots}</div>
        </div>`;
    } else if (drawn && game.winner) {
      play = `<div class="games-win-banner">Winner: <strong>${esc(game.winner.displayName)}</strong></div>`;
    }
    return arenaShell({
      type: 'wheel',
      title: game.title || 'Spin the Wheel',
      open: game.open,
      statusLabel: drawn ? 'Drawn' : 'Open',
      prizesHtml: prizeChips(game.prizes),
      body: game.open ? wrapPlay(game, state, 'wheel', demoWheel, play) : closedBody(state.channelUrl)
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
    return arenaShell({
      type: 'scratch',
      title: game.title || 'Scratch Cards',
      open: game.open,
      prizesHtml: prizeChips(game.prizes),
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
    return arenaShell({
      type: 'mystery',
      title: game.title || 'Mystery Box',
      open: game.open,
      prizesHtml: prizeChips(game.prizes),
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
    return arenaShell({
      type,
      title: game.title || INSTANT_TITLES[type],
      open: game.open,
      prizesHtml: prizeChips(game.prizes),
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
          setTimeout(() => loadGamesHub(), 1500);
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
            setTimeout(() => loadGamesHub(), 2000);
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
          setTimeout(() => loadGamesHub(), 2000);
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
            setTimeout(() => loadGamesHub(), 2000);
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
            setTimeout(() => loadGamesHub(), 2000);
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
          }
        });
      });
    });
  }

  function renderHub(data) {
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
