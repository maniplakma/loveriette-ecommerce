/* Buyer games — My Services panel */
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

  function renderWheelSection(wheels) {
    const el = document.getElementById('games-wheel-list');
    if (!el) return;
    const active = (wheels || []).filter((w) => w.isEnabled);
    if (!active.length) {
      el.innerHTML = '<p class="games-empty">No spin-the-wheel event right now. Check back after your next order!</p>';
      return;
    }
    el.innerHTML = active.map((w) => {
      const myCount = (w.mySlots || []).length;
      const days = (w.availableDays || []).map((d) => DAY_LABELS[d] || d).join(', ');
      const status = w.status === 'drawn'
        ? `<p class="games-win-banner">Winner: <strong>${esc(w.winner?.displayName || '—')}</strong> (Order #${esc(w.winner?.orderNumber || '')})</p>`
        : `<p class="games-meta">Draw: ${esc(fmtDate(w.drawAt))} · Days: ${esc(days)}</p>`;
      const slots = (w.slots || []).slice(0, 24).map((s) =>
        `<span class="games-slot-chip${(w.mySlots || []).some((m) => m.id === s.id) ? ' is-mine' : ''}">${esc(s.displayName)}</span>`
      ).join('');
      const prize = (w.prizes || [])[0];
      return `
        <article class="games-card info-card">
          <div class="games-card-head">
            <h3>${esc(w.title)}</h3>
            <span class="games-badge">${w.status === 'drawn' ? 'Drawn' : 'Open'}</span>
          </div>
          ${status}
          ${prize ? `<p class="games-prize-line">Grand prize: <strong>${esc(prize.label)}</strong></p>` : ''}
          <p class="games-meta">${w.entryCount || 0} entries · You have <strong>${myCount}</strong> slot${myCount !== 1 ? 's' : ''}</p>
          <div class="games-slot-wall">${slots || '<span class="games-meta">No entries yet — order to join!</span>'}</div>
          ${w.status !== 'drawn' && myCount ? '<p class="games-tip">One approved order = one wheel slot. Good luck!</p>' : ''}
        </article>`;
    }).join('');
  }

  function scratchHtml(card) {
    const done = !!card.scratchedAt;
    const prizeLabel = card.prizeLabel || '';
    if (done) {
      return `
        <article class="games-card info-card games-scratch-done">
          <h3>Order #${esc(card.orderNumber)}</h3>
          <p class="games-scratch-result ${card.prizeType === 'bomb' ? 'is-bomb' : ''}">${esc(prizeLabel || 'No prize')}</p>
          <small>Scratched ${esc(fmtDate(card.scratchedAt))}</small>
        </article>`;
    }
    return `
      <article class="games-card info-card" data-scratch-id="${card.id}">
        <h3>Order #${esc(card.orderNumber)}</h3>
        <p class="games-meta">${esc(card.poolTitle || 'Scratch Card')}</p>
        <div class="games-scratch-grid" id="scratch-grid-${card.id}">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    `<button type="button" class="games-scratch-tile" data-tile="${i}" aria-label="Scratch tile ${i + 1}"></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="scratch-msg-${card.id}" hidden></p>
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
        const scratched = grid.querySelectorAll('.games-scratch-tile.scratched').length;
        if (scratched < 4) return;
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
          setTimeout(() => window.loadBuyerGames?.(), 1500);
        } catch (err) {
          if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
          revealed = false;
        }
      });
    });
  }

  function renderScratchSection(cards) {
    const el = document.getElementById('games-scratch-list');
    if (!el) return;
    const pending = (cards || []).filter((c) => !c.scratchedAt);
    const done = (cards || []).filter((c) => c.scratchedAt);
    if (!cards?.length) {
      el.innerHTML = '<p class="games-empty">Order from the shop to unlock scratch cards when this game is active.</p>';
      return;
    }
    el.innerHTML = [
      pending.length ? '<h3 class="games-subtitle">Ready to scratch</h3>' : '',
      pending.map(scratchHtml).join(''),
      done.length ? '<h3 class="games-subtitle">Past scratches</h3>' : '',
      done.slice(0, 8).map(scratchHtml).join('')
    ].join('');
    bindScratchCards();
  }

  function mysteryHtml(play) {
    if (play.playedAt) {
      return `
        <article class="games-card info-card">
          <h3>Order #${esc(play.orderNumber)}</h3>
          <p class="games-scratch-result">${esc(play.prizeLabel || 'No prize')}</p>
          <small>Played ${esc(fmtDate(play.playedAt))}</small>
        </article>`;
    }
    return `
      <article class="games-card info-card" data-mystery-id="${play.id}">
        <h3>Order #${esc(play.orderNumber)}</h3>
        <p class="games-meta">Pick one box — only one has the prize!</p>
        <div class="games-mystery-row">
          ${[0, 1, 2].map((i) =>
    `<button type="button" class="games-mystery-box" data-box="${i}"><span>?</span><small>Box ${i + 1}</small></button>`
  ).join('')}
        </div>
        <p class="games-scratch-msg" id="mystery-msg-${play.id}" hidden></p>
      </article>`;
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
            row.innerHTML = (result.boxes || []).map((b, i) =>
              `<div class="games-mystery-box revealed${b.winner ? ' is-winner' : ''}"><span>${esc(b.label)}</span></div>`
            ).join('');
            if (msg) {
              msg.hidden = false;
              msg.textContent = result.prize ? `You won: ${result.prize.label}` : 'No prize this time.';
            }
            setTimeout(() => window.loadBuyerGames?.(), 2000);
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
            card.querySelectorAll('.games-mystery-box').forEach((b) => { b.disabled = false; });
          }
        });
      });
    });
  }

  function renderMysterySection(plays) {
    const el = document.getElementById('games-mystery-list');
    if (!el) return;
    if (!plays?.length) {
      el.innerHTML = '<p class="games-empty">Mystery box unlocks with approved shop orders when enabled.</p>';
      return;
    }
    el.innerHTML = plays.map(mysteryHtml).join('');
    bindMysteryBoxes();
  }

  async function loadBuyerGames() {
    const root = document.getElementById('panel-games');
    if (!root) return;
    try {
      const data = await gamesApi('/account/games');
      renderWheelSection(data.wheels);
      renderScratchSection(data.scratchCards);
      renderMysterySection(data.mysteryPlays);
    } catch (e) {
      root.querySelectorAll('.games-section').forEach((s) => {
        s.innerHTML = `<p class="games-empty">${esc(e.message)}</p>`;
      });
    }
  }

  window.loadBuyerGames = loadBuyerGames;
})();
