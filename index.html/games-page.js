/* Games hub — /games */
(function () {
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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

  function closedOverlay(channelUrl) {
    return `
      <div class="games-arena-closed">
        <div class="games-arena-closed-icon" aria-hidden="true">🔒</div>
        <h3>Closed Game</h3>
        <p>Join our channel for games updates.</p>
        <a href="${esc(channelUrl)}" class="games-channel-btn" target="_blank" rel="noopener noreferrer">Join Channel</a>
      </div>`;
  }

  function purchaseGate(minTotal) {
    const min = Number(minTotal) > 0 ? ` (min. ₱${minTotal} order)` : '';
    return `
      <div class="games-arena-gate">
        <div class="games-arena-gate-icon" aria-hidden="true">🛒</div>
        <h3>Purchase to Play</h3>
        <p>Buy from the shop first${min} — your game unlocks after payment approval.</p>
        <a href="/shop" class="games-shop-btn">Browse Shop</a>
      </div>`;
  }

  function signInGate() {
    return `
      <div class="games-arena-gate">
        <div class="games-arena-gate-icon" aria-hidden="true">👤</div>
        <h3>Sign in to Play</h3>
        <p>Log in to see your unlocked games and play.</p>
        <a href="login.html" class="games-shop-btn">Sign In</a>
      </div>`;
  }

  function renderWheelArena(wheel, state) {
    const { channelUrl, authenticated } = state;
    const icon = '🎡';
    const title = wheel.title || 'Spin the Wheel';

    if (!wheel.open) {
      return `
        <article class="games-arena games-arena--closed games-arena--wheel">
          <header class="games-arena-head"><span class="games-arena-emoji">${icon}</span><h2>${esc(title)}</h2><span class="games-arena-status games-arena-status--closed">Closed</span></header>
          <div class="games-arena-body">${closedOverlay(channelUrl)}</div>
        </article>`;
    }

    const grandPrize = wheel.prizes?.[0];
    const drawn = wheel.status === 'drawn';
    let playArea = '';

    if (drawn && wheel.winner) {
      playArea = `
        <div class="games-win-banner">Winner: <strong>${esc(wheel.winner.displayName)}</strong> · Order #${esc(wheel.winner.orderNumber)}</div>`;
    } else if (!authenticated) {
      playArea = signInGate();
    } else if (wheel.needsPurchase) {
      playArea = purchaseGate(wheel.minOrderTotal);
    } else if (wheel.canPlay) {
      const slots = (wheel.mySlots || []).map((s) =>
        `<span class="games-slot-chip is-mine">#${esc(s.orderNumber)}</span>`
      ).join('');
      playArea = `
        <div class="games-wheel-stage">
          <div class="games-wheel-visual" aria-hidden="true">
            <div class="games-wheel-ring"></div>
            <div class="games-wheel-center">${icon}</div>
          </div>
          <div class="games-wheel-info">
            ${grandPrize ? `<p class="games-prize-line">Grand prize: <strong>${esc(grandPrize.label)}</strong></p>` : ''}
            <p class="games-meta">Draw: ${esc(fmtDate(wheel.drawAt))} · ${wheel.entryCount || 0} entries</p>
            <p class="games-meta">Your slots: <strong>${(wheel.mySlots || []).length}</strong></p>
            <div class="games-slot-wall">${slots}</div>
            <p class="games-tip">You're in! Winner drawn automatically at draw time.</p>
          </div>
        </div>`;
    } else {
      playArea = purchaseGate(wheel.minOrderTotal);
    }

    return `
      <article class="games-arena games-arena--open games-arena--wheel">
        <header class="games-arena-head">
          <span class="games-arena-emoji">${icon}</span>
          <h2>${esc(title)}</h2>
          <span class="games-arena-status games-arena-status--open">${drawn ? 'Drawn' : 'Open'}</span>
        </header>
        <div class="games-arena-prizes">
          <h3 class="games-arena-sub">Prizes</h3>
          ${prizeChips(wheel.prizes)}
        </div>
        <div class="games-arena-body">${playArea}</div>
      </article>`;
  }

  function scratchHtml(card) {
    const done = !!card.scratchedAt;
    const prizeLabel = card.prizeLabel || '';
    if (done) {
      return `
        <article class="games-play-card games-scratch-done">
          <h4>Order #${esc(card.orderNumber)}</h4>
          <p class="games-scratch-result ${card.prizeType === 'bomb' ? 'is-bomb' : ''}">${esc(prizeLabel || 'No prize')}</p>
          <small>Scratched ${esc(fmtDate(card.scratchedAt))}</small>
        </article>`;
    }
    return `
      <article class="games-play-card" data-scratch-id="${card.id}">
        <h4>Order #${esc(card.orderNumber)}</h4>
        <div class="games-scratch-grid" id="scratch-grid-${card.id}">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    `<button type="button" class="games-scratch-tile" data-tile="${i}" aria-label="Scratch tile ${i + 1}"></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="scratch-msg-${card.id}" hidden></p>
      </article>`;
  }

  function renderScratchArena(scratch, state) {
    const { channelUrl, authenticated } = state;
    const icon = '🎫';
    const title = scratch.title || 'Scratch Cards';

    if (!scratch.open) {
      return `
        <article class="games-arena games-arena--closed games-arena--scratch">
          <header class="games-arena-head"><span class="games-arena-emoji">${icon}</span><h2>${esc(title)}</h2><span class="games-arena-status games-arena-status--closed">Closed</span></header>
          <div class="games-arena-body">${closedOverlay(channelUrl)}</div>
        </article>`;
    }

    let playArea = '';
    if (!authenticated) {
      playArea = signInGate();
    } else if (scratch.needsPurchase) {
      playArea = purchaseGate(scratch.minOrderTotal);
    } else if (scratch.canPlay) {
      const pending = (scratch.cards || []).filter((c) => !c.scratchedAt);
      playArea = pending.map(scratchHtml).join('');
    } else if ((scratch.cards || []).length) {
      const done = scratch.cards.filter((c) => c.scratchedAt).slice(0, 4);
      playArea = done.map(scratchHtml).join('');
    } else {
      playArea = purchaseGate(scratch.minOrderTotal);
    }

    return `
      <article class="games-arena games-arena--open games-arena--scratch">
        <header class="games-arena-head">
          <span class="games-arena-emoji">${icon}</span>
          <h2>${esc(title)}</h2>
          <span class="games-arena-status games-arena-status--open">Open</span>
        </header>
        <div class="games-arena-prizes">
          <h3 class="games-arena-sub">Prize Pool</h3>
          ${prizeChips(scratch.prizes)}
        </div>
        <div class="games-arena-body games-arena-body--play">${playArea}</div>
      </article>`;
  }

  function mysteryHtml(play) {
    if (play.playedAt) {
      return `
        <article class="games-play-card">
          <h4>Order #${esc(play.orderNumber)}</h4>
          <p class="games-scratch-result">${esc(play.prizeLabel || 'No prize')}</p>
          <small>Played ${esc(fmtDate(play.playedAt))}</small>
        </article>`;
    }
    return `
      <article class="games-play-card" data-mystery-id="${play.id}">
        <h4>Order #${esc(play.orderNumber)}</h4>
        <p class="games-meta">Pick one box — only one has the prize!</p>
        <div class="games-mystery-row">
          ${[0, 1, 2].map((i) =>
    `<button type="button" class="games-mystery-box" data-box="${i}"><span>?</span><small>Box ${i + 1}</small></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="mystery-msg-${play.id}" hidden></p>
      </article>`;
  }

  function renderMysteryArena(mystery, state) {
    const { channelUrl, authenticated } = state;
    const icon = '🎁';
    const title = mystery.title || 'Mystery Box';

    if (!mystery.open) {
      return `
        <article class="games-arena games-arena--closed games-arena--mystery">
          <header class="games-arena-head"><span class="games-arena-emoji">${icon}</span><h2>${esc(title)}</h2><span class="games-arena-status games-arena-status--closed">Closed</span></header>
          <div class="games-arena-body">${closedOverlay(channelUrl)}</div>
        </article>`;
    }

    let playArea = '';
    if (!authenticated) {
      playArea = signInGate();
    } else if (mystery.needsPurchase) {
      playArea = purchaseGate(mystery.minOrderTotal);
    } else if (mystery.canPlay) {
      const pending = (mystery.plays || []).filter((p) => !p.playedAt);
      playArea = pending.map(mysteryHtml).join('');
    } else if ((mystery.plays || []).length) {
      playArea = mystery.plays.filter((p) => p.playedAt).slice(0, 4).map(mysteryHtml).join('');
    } else {
      playArea = purchaseGate(mystery.minOrderTotal);
    }

    return `
      <article class="games-arena games-arena--open games-arena--mystery">
        <header class="games-arena-head">
          <span class="games-arena-emoji">${icon}</span>
          <h2>${esc(title)}</h2>
          <span class="games-arena-status games-arena-status--open">Open</span>
        </header>
        <div class="games-arena-prizes">
          <h3 class="games-arena-sub">Possible Prizes</h3>
          ${prizeChips(mystery.prizes)}
        </div>
        <div class="games-arena-body games-arena-body--play">${playArea}</div>
      </article>`;
  }

  function bindScratchCards() {
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
          const isBomb = result.prize?.prizeType === 'bomb';
          grid.innerHTML = `<div class="games-scratch-reveal ${isBomb ? 'is-bomb' : ''}">${esc(label)}</div>`;
          if (msg) {
            msg.hidden = false;
            msg.textContent = isBomb ? 'Boom! Better luck next time.' : `You won: ${label}`;
          }
          setTimeout(() => loadGamesHub(), 1500);
        } catch (err) {
          if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
          revealed = false;
        }
      });
    });
  }

  function bindMysteryBoxes() {
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
            const row = card.querySelector('.games-mystery-row');
            row.innerHTML = (result.boxes || []).map((b) =>
              `<div class="games-mystery-box revealed${b.winner ? ' is-winner' : ''}"><span>${esc(b.label)}</span></div>`
            ).join('');
            if (msg) {
              msg.hidden = false;
              msg.textContent = result.prize ? `You won: ${result.prize.label}` : 'No prize this time.';
            }
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

  function renderHub(data) {
    const grid = document.getElementById('games-arena-grid');
    if (!grid) return;
    grid.innerHTML = [
      renderWheelArena(data.wheel || {}, data),
      renderScratchArena(data.scratch || {}, data),
      renderMysteryArena(data.mystery || {}, data)
    ].join('');
    bindScratchCards();
    bindMysteryBoxes();
  }

  async function loadGamesHub() {
    const grid = document.getElementById('games-arena-grid');
    try {
      const data = await gamesApi('/api/games');
      renderHub(data);
    } catch (e) {
      if (grid) grid.innerHTML = `<p class="games-empty">${esc(e.message)}</p>`;
    }
  }

  function init() {
    if (typeof initPlatformNav === 'function') initPlatformNav('games');
    loadGamesHub();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.loadGamesHub = loadGamesHub;
})();
