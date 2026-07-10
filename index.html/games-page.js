/* Games hub — /games */
(function () {
  const GAMES_LITE = document.documentElement.classList.contains('lite-ui');
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

  function scratchGridHtml(demo) {
    const tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
      if (demo) {
        return '<div class="games-scratch-tile games-scratch-tile--demo"><span class="games-scratch-foil"></span></div>';
      }
      return `<button type="button" class="games-scratch-tile" data-tile="${i}"><span class="games-scratch-foil"></span></button>`;
    }).join('');
    return `<div class="games-scratch-ticket"><div class="games-scratch-ticket-shine"></div><div class="games-scratch-ticket-label">Lucky Scratch</div><div class="games-scratch-grid">${tiles}</div></div>`;
  }

  function mysteryBoxHtml(i, demo) {
    const inner = `<span class="games-mystery-ribbon" aria-hidden="true"></span><span class="games-mystery-lid"></span><span class="games-mystery-body"><em>?</em><small>Box ${i + 1}</small></span>`;
    if (demo) return `<div class="games-mystery-box games-mystery-box--demo">${inner}</div>`;
    return `<button type="button" class="games-mystery-box" data-box="${i}">${inner}</button>`;
  }

  function pickCardHtml(suit, label, demo, idx) {
    const red = suit === '♥' || suit === '♦';
    const inner = `<span class="games-pick-corner games-pick-corner--tl">${suit}</span><span class="games-pick-center">${label || suit}</span><span class="games-pick-corner games-pick-corner--br">${suit}</span>`;
    if (demo) return `<div class="games-pick-card games-pick-card--demo${red ? ' is-red' : ''}">${inner}</div>`;
    return `<button type="button" class="games-pick-card${red ? ' is-red' : ''}" data-pick="${idx}">${inner}</button>`;
  }

  function vaultDoorHtml(tier, demo, idx) {
    const tiers = { Bronze: 'bronze', Silver: 'silver', Gold: 'gold', B: 'bronze', S: 'silver', G: 'gold' };
    const t = tiers[tier] || 'bronze';
    const label = tier.length === 1 ? { B: 'Bronze', S: 'Silver', G: 'Gold' }[tier] : tier;
    const inner = `<span class="games-vault-rivets" aria-hidden="true"></span><span class="games-vault-handle"></span><span class="games-vault-label">${label}</span>`;
    if (demo) return `<div class="games-vault-door games-vault-door--demo games-vault-door--${t}">${inner}</div>`;
    return `<button type="button" class="games-vault-door games-vault-door--${t}" data-vault="${idx}">${inner}</button>`;
  }

  function dieHtml(face, extraClass) {
    const v = Math.max(1, Math.min(6, Number(face) || 1));
    return `<div class="games-die games-die--pips games-die--${v}${extraClass ? ` ${extraClass}` : ''}"><div class="games-die-cube"><div class="games-die-face"></div></div></div>`;
  }

  function revealedMysteryBoxHtml(b) {
    const inner = `<span class="games-mystery-ribbon" aria-hidden="true"></span><span class="games-mystery-lid"></span><span class="games-mystery-body"><em>${b.winner ? '★' : '·'}</em><small>${esc(b.label)}</small></span>`;
    return `<div class="games-mystery-box revealed${b.winner ? ' is-winner' : ''}">${inner}</div>`;
  }

  function revealedPickCardHtml(c, idx) {
    const suits = ['♠', '♥', '♦'];
    const suit = suits[idx % 3];
    const red = suit === '♥' || suit === '♦';
    const display = c.winner ? c.label : c.label.replace(/^[♠♥♦♣]\s*/, '');
    const inner = `<span class="games-pick-corner games-pick-corner--tl">${suit}</span><span class="games-pick-center">${esc(display)}</span><span class="games-pick-corner games-pick-corner--br">${suit}</span>`;
    return `<div class="games-pick-card revealed${c.winner ? ' is-winner' : ''}${red ? ' is-red' : ''}">${inner}</div>`;
  }

  function revealedVaultDoorHtml(v, idx) {
    const tiers = ['bronze', 'silver', 'gold'];
    const t = tiers[idx] || 'bronze';
    const inner = `<span class="games-vault-rivets" aria-hidden="true"></span><span class="games-vault-handle"></span><span class="games-vault-label">${esc(v.label)}</span>`;
    return `<div class="games-vault-door revealed games-vault-door--${t}${v.winner ? ' is-winner' : ''}">${inner}</div>`;
  }

  const GAME_LABELS = {
    wheel: 'Spin the Wheel',
    scratch: 'Scratch Card',
    mystery: 'Mystery Box',
    dice: 'Lucky Dice',
    pick: 'Card Flip',
    vault: 'Treasure Vault'
  };

  function renderPendingChoices(state) {
    const credits = state.pendingCredits || [];
    const open = new Set(state.openGamesForChoice || []);
    if (!credits.length) return '';
    return `
      <section class="games-choice-panel" id="games-choice-panel" aria-live="polite">
        <h2 class="games-choice-title">Pick ONE game per purchase</h2>
        <p class="games-choice-note">Each delivered order unlocks a single game — choose wisely. This cannot be changed.</p>
        ${credits.map((credit) => `
          <article class="games-choice-card" data-credit-id="${credit.id}">
            <header class="games-choice-head">
              <strong>Order #${esc(credit.orderNumber)}</strong>
              <span class="games-choice-badge">Choose now</span>
            </header>
            <div class="games-choice-grid">
              ${Object.keys(GAME_LABELS).map((key) => {
    const enabled = open.has(key);
    return `<button type="button" class="games-choice-btn" data-choose-game="${key}" data-credit-id="${credit.id}"${enabled ? '' : ' disabled title="Game closed"'}>${esc(GAME_LABELS[key])}</button>`;
  }).join('')}
            </div>
          </article>
        `).join('')}
      </section>`;
  }

  function bindGameChoices() {
    document.querySelectorAll('.games-choice-btn:not([disabled])').forEach((btn) => {
      if (btn.dataset.choiceBound) return;
      btn.dataset.choiceBound = '1';
      btn.addEventListener('click', async () => {
        const creditId = btn.dataset.creditId;
        const gameType = btn.dataset.chooseGame;
        const label = GAME_LABELS[gameType] || gameType;
        if (!confirm(`Use order credit for ${label}? You cannot change this later.`)) return;
        btn.disabled = true;
        try {
          await gamesApi(`/account/games/credits/${creditId}/choose`, {
            method: 'POST',
            body: JSON.stringify({ gameType })
          });
          if (typeof window.showToast === 'function') window.showToast(`Locked to ${label}`, 'success');
          loadGamesHub();
        } catch (err) {
          btn.disabled = false;
          if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
          else alert(err.message);
        }
      });
    });
  }

  function pendingChoiceGate(state) {
    if (!state.hasPendingCredit) return '';
    return `
      <div class="games-arena-gate games-arena-gate--compact games-arena-gate--choice">
        ${icon('wheel', 'games-icon--gate')}
        <div><strong>Pick your game above</strong><span>One purchase = one game. Choose in the panel before playing.</span></div>
      </div>`;
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

  function isRealPrizeWin(result) {
    const t = result?.prize?.prizeType || result?.fulfillment?.type;
    return t && t !== 'none' && t !== 'bomb';
  }

  function playResultMessage(result) {
    return isRealPrizeWin(result)
      ? `You won: ${result.prize?.label || 'Prize'}`
      : (result.prize?.label || 'Better luck next time!');
  }

  function winnersPanel(winners) {
    if (!winners?.length) return '';
    const count = winners.length;
    return `
      <div class="games-winners-panel games-winners-panel--public">
        <h4 class="games-winners-title">Draw results — ${count} winner${count === 1 ? '' : 's'}</h4>
        <p class="games-winners-note">Visible to everyone · one spin per prize</p>
        <ol class="games-winners-list">${winners.map((w) =>
    `<li class="games-winner-row">
      <span class="games-winner-spin">Spin ${w.spinIndex || ''}</span>
      <strong class="games-winner-name">${esc(w.displayName)}</strong>
      <span class="games-winner-order">Order #${esc(w.orderNumber)}</span>
      <span class="games-winner-prize">${esc(w.prizeLabel || 'Prize')}</span>
    </li>`
  ).join('')}</ol>
      </div>`;
  }

  function formatGameWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
      return String(iso);
    }
  }

  function wheelCloseCopy(game) {
    switch (game.closeReason) {
      case 'games_off':
        return 'Shop games are paused in admin. Turn on <strong>Enable game credits after delivery</strong>, then open <strong>Spin the Wheel</strong>.';
      case 'no_campaign':
      case 'campaign_disabled':
        return 'No active wheel campaign. In admin, create a campaign and click <strong>Turn on (live)</strong>.';
      case 'full':
        return `All ${game.maxEntries || ''} entry slots are filled. The draw will run automatically.`;
      case 'not_started':
        return `This round opens on <strong>${esc(formatGameWhen(game.startsAt))}</strong>.`;
      case 'ended':
        return `This round ended on <strong>${esc(formatGameWhen(game.endsAt))}</strong>.`;
      case 'wrong_day':
        return `Open on: <strong>${esc(game.availableDaysLabel || 'selected days')}</strong>. Check back on those days.`;
      default:
        return 'Join our channel for updates — we&rsquo;ll announce when this game opens again.';
    }
  }

  function isGameAdminClosed(game) {
    if (!game) return true;
    if (game.campaignOn) return false;
    if (game?.status === 'drawn') return false;
    if (game?.open) return false;
    if (['full', 'not_started', 'ended', 'wrong_day'].includes(game?.closeReason)) return false;
    return ['games_off', 'no_campaign', 'campaign_disabled'].includes(game?.closeReason)
      || (!game.closeReason && !game.id);
  }

  function wheelStatusLabel(game, { drawn, live, rosterFull }) {
    if (drawn) return 'Drawn';
    if (live) return 'Open';
    if (rosterFull) return 'Full';
    if (game.campaignOn && game.closeReason === 'not_started') return 'Opens soon';
    if (game.campaignOn && game.closeReason === 'wrong_day') return 'Scheduled';
    if (game.campaignOn) return 'Open';
    return 'Closed';
  }

  function arenaStatusState({ adminClosed, open, campaignOn, statusLabel }) {
    if (adminClosed) return { state: 'closed', status: 'Closed' };
    if (open || campaignOn || statusLabel === 'Full' || statusLabel === 'Opens soon' || statusLabel === 'Scheduled') {
      return { state: 'open', status: statusLabel || 'Open' };
    }
    if (statusLabel === 'Drawn') return { state: 'results', status: 'Drawn' };
    return { state: 'results', status: statusLabel || 'Results' };
  }

  function arenaShell({ type, title, open, visible, statusLabel, body, prizesHtml, guideUrl, metaHtml, expandable, adminClosed, campaignOn }) {
    const listed = visible !== false;
    const { state, status } = arenaStatusState({ adminClosed, open, campaignOn, statusLabel });
    const closed = state === 'closed';
    const guideHref = guideUrl || `/guide.html#game-${type}`;
    const guide = `<a href="${esc(guideHref)}" class="games-guide-link" target="_blank" rel="noopener noreferrer" data-no-expand>How to play</a>`;
    const canExpand = expandable !== false && !closed;
    const expandBtn = canExpand
      ? '<button type="button" class="games-open-full" aria-label="Open full screen">⛶ Full screen</button>'
      : '';
    const expandHint = canExpand
      ? '<span class="games-expand-hint">Tap card or use Full screen</span>'
      : '';
    const statusClass = closed ? 'closed' : (state === 'open' ? 'open' : 'closed');
    return `
      <article class="games-arena games-arena--${state} games-arena--${type}${closed ? ' games-arena--listed-closed' : ''}" data-game-type="${esc(type)}" data-expandable="${canExpand ? '1' : '0'}" tabindex="0">
        <div class="games-arena-glow" aria-hidden="true"></div>
        <header class="games-arena-head">
          ${icon(type, 'games-icon--head')}
          <h2>${esc(title)}</h2>
          <span class="games-arena-status games-arena-status--${statusClass}">${esc(status)}</span>
        </header>
        <div class="games-arena-guide-row">${guide}${expandBtn}</div>
        ${metaHtml || ''}
        ${listed && prizesHtml && !closed ? `<div class="games-arena-prizes"><h3 class="games-arena-sub">Prizes</h3>${prizesHtml}</div>` : ''}
        <div class="games-arena-body">${body}</div>
        ${expandHint}
      </article>`;
  }

  function closedBody(channelUrl, type, customCopy, badge = 'Closed') {
    const gameType = type || 'lock';
    const copy = customCopy || 'Join our channel for updates — we&rsquo;ll announce when this game opens again.';
    return `
      <div class="games-closed-panel">
        <span class="games-closed-shine" aria-hidden="true"></span>
        <div class="games-closed-icon-wrap">${icon(gameType, 'games-icon--gate')}</div>
        <span class="games-closed-badge">${esc(badge)}</span>
        <h3 class="games-closed-title">Game Closed</h3>
        <p class="games-closed-copy">${copy}</p>
        <a href="${esc(channelUrl)}" class="games-closed-cta" target="_blank" rel="noopener noreferrer" data-no-expand>
          <span>Join channel for updates</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>`;
  }

  function gateBanner(kind, channelUrl, minTotal, elig, type, customCopy) {
    if (kind === 'closed') return closedBody(channelUrl, type, customCopy);
    if (kind === 'soon') {
      return `
        <div class="games-arena-gate games-arena-gate--soon games-arena-gate--compact">
          ${icon(type, 'games-icon--gate')}
          <div><strong>Opens soon</strong><div class="games-gate-copy">${customCopy || 'Check back shortly — this round is almost live.'}</div></div>
        </div>`;
    }
    if (kind === 'ended') {
      return `
        <div class="games-arena-gate games-arena-gate--ended games-arena-gate--compact">
          ${icon(type, 'games-icon--gate')}
          <div><strong>Round ended</strong><div class="games-gate-copy">${customCopy || 'This round has ended. Watch the channel for the next one.'}</div></div>
        </div>`;
    }
    const purchaseMsg = elig?.message || 'Shop order → unlock after delivery';
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
      <div class="games-demo-stage games-demo-stage--scratch">
        ${demoBadge()}
        ${scratchGridHtml(true)}
        <p class="games-demo-caption">Scratch 4 foil tiles to reveal your prize</p>
      </div>`;
  }

  function demoMystery() {
    return `
      <div class="games-demo-stage games-demo-stage--mystery">
        ${demoBadge()}
        <div class="games-mystery-row">${[0, 1, 2].map((i) => mysteryBoxHtml(i, true)).join('')}</div>
        <p class="games-demo-caption">Only one gift box holds the prize</p>
      </div>`;
  }

  function demoDice() {
    return `
      <div class="games-demo-stage games-demo-dice">
        ${demoBadge()}
        <div class="games-dice-row">
          ${dieHtml(6, 'games-die--demo')}
          ${dieHtml(4, 'games-die--demo')}
        </div>
        <button type="button" class="games-action-btn" disabled>Roll Dice</button>
        <p class="games-demo-caption">Match lucky sums for bigger prizes</p>
      </div>`;
  }

  function demoPick() {
    return `
      <div class="games-demo-stage games-demo-stage--pick">
        ${demoBadge()}
        <div class="games-pick-row">
          ${pickCardHtml('♠', 'A', true, 0)}
          ${pickCardHtml('♥', 'K', true, 1)}
          ${pickCardHtml('♦', 'Q', true, 2)}
        </div>
        <p class="games-demo-caption">Flip one card — ace wins big</p>
      </div>`;
  }

  function demoVault() {
    return `
      <div class="games-demo-stage games-demo-vault">
        ${demoBadge()}
        <div class="games-vault-row">
          ${vaultDoorHtml('Bronze', true, 0)}
          ${vaultDoorHtml('Silver', true, 1)}
          ${vaultDoorHtml('Gold', true, 2)}
        </div>
        <p class="games-demo-caption">Pick a vault door to unlock treasure</p>
      </div>`;
  }

  function resolveGate(game, state) {
    if (isGameAdminClosed(game)) return 'closed';
    if (!game.open) {
      if (game.closeReason === 'not_started' || game.closeReason === 'wrong_day') return 'soon';
      if (game.closeReason === 'ended') return 'ended';
      if (game.closeReason === 'full') return null;
    }
    if (!state.authenticated) return 'signin';
    if (game.needsPurchase && !game.canPlay) return 'purchase';
    return null;
  }

  function gateCopyFor(game, type) {
    if (type === 'wheel') return wheelCloseCopy(game);
    if (game.closeReason === 'not_started' && game.startsAt) {
      return `Opens on <strong>${esc(formatGameWhen(game.startsAt))}</strong>.`;
    }
    if (game.closeReason === 'wrong_day') {
      return `Open on: <strong>${esc(game.availableDaysLabel || 'selected days')}</strong>.`;
    }
    return '';
  }

  function guideFor(state, type) {
    return state?.eligibility?.guides?.[type] || `/guide.html#game-${type}`;
  }

  function wheelEntriesMetaHtml(game) {
    const max = Number(game.maxEntries);
    const count = Number(game.entryCount) || 0;
    if (!max) return `<p class="games-meta">${count} ${count === 1 ? 'entry' : 'entries'}</p>`;
    const pct = Math.min(100, Math.round((count / max) * 100));
    const left = Math.max(0, max - count);
    return `
      <div class="games-wheel-progress">
        <div class="games-wheel-progress-head">
          <span><strong>${count}</strong> / ${max} orders joined</span>
          <span>${left} slot${left === 1 ? '' : 's'} left</span>
        </div>
        <div class="games-wheel-progress-track" aria-hidden="true">
          <div class="games-wheel-progress-fill" style="width:${pct}%"></div>
        </div>
        <p class="games-meta games-meta--wheel">Auto-draw when full — no timer</p>
      </div>`;
  }

  function showCongratulations(result) {
    const f = result?.fulfillment;
    const prize = result?.prize;
    const label = prize?.label || f?.label;
    if (!label) return;
    const isRealWin = f?.type && f.type !== 'none' && prize?.prizeType !== 'bomb';
    let modal = document.getElementById('games-prize-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'games-prize-modal';
      modal.className = 'games-prize-modal';
      modal.innerHTML = '<div class="games-prize-modal-card" role="dialog" aria-modal="true"><button type="button" class="games-prize-modal-close" aria-label="Close">&times;</button><div id="games-prize-modal-body"></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('.games-prize-modal-close').addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    }
    const body = modal.querySelector('#games-prize-modal-body');
    const title = isRealWin ? 'Congratulations!' : 'Thanks for playing!';
    let inner = `<p class="games-prize-modal-kicker">${esc(title)}</p><h3 class="games-prize-modal-title">${esc(label)}</h3>`;

    if (!f || f.type === 'none') {
      inner += '<p class="games-prize-modal-msg">Better luck on your next game.</p>';
    } else if (f.type === 'loyalty' || f.type === 'wallet') {
      inner += `<p class="games-prize-modal-msg">${esc(f.message || `₱${f.amount} credited automatically.`)}</p>`;
      inner += '<p class="games-prize-modal-note">Check your wallet — we also sent a notification.</p>';
    } else if (f.type === 'redeem' && f.code) {
      inner += `<p class="games-prize-modal-msg">${esc(f.message || 'Your voucher is ready.')}</p>`;
      inner += `<div class="games-prize-code-row"><code id="games-prize-code">${esc(f.code)}</code><button type="button" class="games-shop-btn games-shop-btn--sm" id="games-copy-code">Copy code</button></div>`;
    } else if (f.type === 'product' || f.type === 'account' || f.type === 'netflix') {
      inner += `<p class="games-prize-modal-msg">${esc(f.instruction || f.message)}</p>`;
      inner += `<p class="games-prize-modal-telegram">Send screenshot to <strong>${esc(f.telegram || '@loveriette')}</strong> on Telegram</p>`;
      inner += '<p class="games-prize-modal-note">Take a screenshot of this screen before closing.</p>';
    } else {
      inner += `<p class="games-prize-modal-msg">${esc(f.message || 'Your prize is on the way!')}</p>`;
    }

    body.innerHTML = inner;
    modal.hidden = false;
    const copyBtn = document.getElementById('games-copy-code');
    if (copyBtn && f?.code) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(f.code).then(() => {
          copyBtn.textContent = 'Copied!';
        }).catch(() => { copyBtn.textContent = f.code; });
      }, { once: true });
    }
  }

  function showPrizeWin(result) {
    showCongratulations(result);
  }

  function wrapPlay(game, state, type, demoFn, playHtml) {
    if (isGameAdminClosed(game)) {
      if (game.endsAt && new Date(game.endsAt).getTime() < Date.now()) {
        return `<div class="games-arena-ended"><p>This game has ended.</p>${endsMetaHtml(game.endsAt)}</div>`;
      }
      const copy = type === 'wheel' ? wheelCloseCopy(game) : '';
      return closedBody(state.channelUrl, type, copy);
    }
    const gate = resolveGate(game, state);
    const parts = [];
    if (state.hasPendingCredit && !game.canPlay) parts.push(pendingChoiceGate(state));
    else if (gate) parts.push(gateBanner(gate, state.channelUrl, game.minOrderTotal, state.eligibility, type, gateCopyFor(game, type)));
    if (game.canPlay && playHtml) parts.push(playHtml);
    else parts.push(demoFn());
    return parts.join('');
  }

  function renderWheel(game, state) {
    const drawn = game.status === 'drawn';
    const rosterFull = game.closeReason === 'full' && !drawn;
    const adminClosed = isGameAdminClosed(game);
    const campaignOn = !!game.campaignOn;
    const live = !!game.open && !drawn;
    const statusLabel = wheelStatusLabel(game, { drawn, live, rosterFull });
    let body = '';
    let metaHtml = '';

    if (rosterFull) {
      metaHtml = `<div class="games-arena-meta">${wheelEntriesMetaHtml(game)}</div>`;
      body = `
        <div class="games-play-stage games-play-stage--full">
          ${wheelVisualHtml('')}
          <p class="games-meta games-meta--full">Roster full — waiting for the automatic draw.</p>
          ${entriesWall(game.entries, [], game.mySlots)}
          <p class="games-meta">${game.entryCount || 0} / ${game.maxEntries || '—'} entries joined</p>
        </div>`;
    } else if (adminClosed) {
      body = closedBody(state.channelUrl, 'wheel', wheelCloseCopy(game));
    } else if (drawn) {
      body = `
        <div class="games-play-stage games-play-stage--results" data-wheel-id="${game.id || ''}">
          <div class="games-wheel-spin-live" aria-live="polite"></div>
          ${wheelVisualHtml('')}
          <div class="games-wheel-reveal-mount"></div>
          ${winnersPanel(game.winners)}
          ${entriesWall(game.entries, game.winners, game.mySlots)}
          <p class="games-meta">${game.entryCount || 0} total entries · Draw complete</p>
        </div>`;
    } else {
      metaHtml = `<div class="games-arena-meta">${wheelEntriesMetaHtml(game)}</div>`;
      if (game.startsAt && game.closeReason === 'not_started') {
        metaHtml += `<div class="games-arena-meta">${countdownHtml(game.startsAt, 'Opens in')}</div>`;
      }
      const slots = (game.mySlots || []).map((s) =>
        `<span class="games-slot-chip is-mine">#${esc(s.orderNumber)}</span>`
      ).join('');
      const play = `
        <div class="games-play-stage">
          ${wheelVisualHtml('')}
          ${game.mySlots?.length ? `<p class="games-meta">Your slots: <strong>${game.mySlots.length}</strong></p><div class="games-slot-wall">${slots}</div>` : ''}
          ${entriesWall(game.entries, [], game.mySlots)}
        </div>`;
      body = wrapPlay({ ...game, open: live }, state, 'wheel', demoWheel, play);
    }

    return arenaShell({
      type: 'wheel',
      title: game.title || 'Spin the Wheel',
      open: live,
      campaignOn,
      visible: game.listed !== false,
      adminClosed,
      statusLabel,
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
        ${scratchGridHtml(false)}
        <p class="games-scratch-msg" id="scratch-msg-${card.id}" hidden></p>
      </article>`;
  }

  function renderScratch(game, state) {
    const adminClosed = isGameAdminClosed(game);
    const campaignOn = !!game.campaignOn;
    const pending = (game.cards || []).filter((c) => !c.scratchedAt);
    const play = pending.length ? pending.map(scratchPlay).join('') : '';
    const metaHtml = !adminClosed && game.endsAt ? `<div class="games-arena-meta">${countdownHtml(game.endsAt, 'Ends in')}</div>` : '';
    return arenaShell({
      type: 'scratch',
      title: game.title || 'Scratch Cards',
      open: game.open,
      campaignOn,
      visible: game.listed !== false,
      adminClosed,
      statusLabel: adminClosed ? 'Closed' : (game.open ? 'Open' : (campaignOn ? 'Open' : 'Closed')),
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
          ${[0, 1, 2].map((i) => mysteryBoxHtml(i, false)).join('')}
        </div>
        <p class="games-scratch-msg" id="mystery-msg-${play.id}" hidden></p>
      </article>`;
  }

  function renderMystery(game, state) {
    const adminClosed = isGameAdminClosed(game);
    const campaignOn = !!game.campaignOn;
    const pending = (game.plays || []).filter((p) => !p.playedAt);
    const metaHtml = !adminClosed && game.endsAt ? `<div class="games-arena-meta">${countdownHtml(game.endsAt, 'Ends in')}</div>` : '';
    return arenaShell({
      type: 'mystery',
      title: game.title || 'Mystery Box',
      open: game.open,
      campaignOn,
      visible: game.listed !== false,
      adminClosed,
      statusLabel: adminClosed ? 'Closed' : (game.open ? 'Open' : (campaignOn ? 'Open' : 'Closed')),
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
            ${dieHtml(1)}
            ${dieHtml(1)}
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
            ${pickCardHtml('♠', '?', false, 0)}
            ${pickCardHtml('♥', '?', false, 1)}
            ${pickCardHtml('♦', '?', false, 2)}
          </div>
          <p class="games-scratch-msg" id="instant-msg-${play.id}" hidden></p>
        </article>`;
    }
    return `
      <article class="games-play-card" data-instant-id="${play.id}" data-instant-key="vault">
        <h4>Order #${esc(play.orderNumber)}</h4>
        <div class="games-vault-row">
          ${vaultDoorHtml('Bronze', false, 0)}
          ${vaultDoorHtml('Silver', false, 1)}
          ${vaultDoorHtml('Gold', false, 2)}
        </div>
        <p class="games-scratch-msg" id="instant-msg-${play.id}" hidden></p>
      </article>`;
  }

  function renderInstant(game, state, type, demoFn) {
    const adminClosed = isGameAdminClosed(game);
    const campaignOn = !!game.campaignOn;
    const metaHtml = !adminClosed && game.endsAt ? `<div class="games-arena-meta">${countdownHtml(game.endsAt, 'Ends in')}</div>` : '';
    return arenaShell({
      type,
      title: game.title || INSTANT_TITLES[type],
      open: game.open,
      campaignOn,
      visible: game.listed !== false,
      adminClosed,
      statusLabel: adminClosed ? 'Closed' : (game.open ? 'Open' : (campaignOn ? 'Open' : 'Closed')),
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
          if (msg) { msg.hidden = false; msg.textContent = playResultMessage(result); }
          showPrizeWin(result);
          if (!GAMES_LITE) setTimeout(() => loadGamesHub(), 2500);
          else loadGamesHub();
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
              revealedMysteryBoxHtml(b)
            ).join('');
            if (msg) { msg.hidden = false; msg.textContent = playResultMessage(result); }
            showPrizeWin(result);
            if (!GAMES_LITE) setTimeout(() => loadGamesHub(), 2500);
            else loadGamesHub();
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
            card.querySelectorAll('.games-mystery-box').forEach((b) => { b.disabled = false; });
          }
        });
      });
    });
  }


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
          row.innerHTML = dice.map((d) => dieHtml(d, 'is-rolled')).join('');
          if (msg) { msg.hidden = false; msg.textContent = playResultMessage(result); }
          showPrizeWin(result);
          if (!GAMES_LITE) setTimeout(() => loadGamesHub(), 2500);
          else loadGamesHub();
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
            card.querySelector('.games-pick-row').innerHTML = (result.result?.cards || []).map((c, i) =>
              revealedPickCardHtml(c, i)
            ).join('');
            if (msg) { msg.hidden = false; msg.textContent = playResultMessage(result); }
            showPrizeWin(result);
            if (!GAMES_LITE) setTimeout(() => loadGamesHub(), 2500);
            else loadGamesHub();
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
            card.querySelector('.games-vault-row').innerHTML = (result.result?.vaults || []).map((v, i) =>
              revealedVaultDoorHtml(v, i)
            ).join('');
            if (msg) { msg.hidden = false; msg.textContent = playResultMessage(result); }
            showPrizeWin(result);
            if (!GAMES_LITE) setTimeout(() => loadGamesHub(), 2500);
            else loadGamesHub();
          } catch (err) {
            if (msg) { msg.hidden = false; msg.className = 'games-scratch-msg is-error'; msg.textContent = err.message; }
            delete card.dataset.playing;
          }
        });
      });
    });
  }

  function runWheelDrawSequence(wheel) {
    if (GAMES_LITE || !wheel?.winners?.length || wheel.status !== 'drawn') {
      if (wheel?.winners?.length) {
        const storageKey = `games-wheel-spins-${wheel.id}-${wheel.drawnAt || wheel.winners.length}`;
        sessionStorage.setItem(storageKey, '1');
      }
      return;
    }
    const stage = document.querySelector(`.games-play-stage--results[data-wheel-id="${wheel.id}"]`)
      || document.querySelector('.games-arena--wheel .games-play-stage--results');
    if (!stage) return;

    const storageKey = `games-wheel-spins-${wheel.id}-${wheel.drawnAt || wheel.winners.length}`;
    if (sessionStorage.getItem(storageKey)) return;

    const visual = stage.querySelector('.games-wheel-visual');
    const live = stage.querySelector('.games-wheel-spin-live');
    const mount = stage.querySelector('.games-wheel-reveal-mount');
    if (!visual || !live) return;

    const winners = wheel.winners;
    let step = 0;

    function revealCard(w) {
      if (!mount) return;
      const card = document.createElement('div');
      card.className = 'games-wheel-reveal-card';
      card.innerHTML = `
        <span class="games-wheel-reveal-kicker">Spin ${w.spinIndex || step} — Winner</span>
        <strong>${esc(w.displayName)}</strong>
        <span class="games-wheel-reveal-order">Order #${esc(w.orderNumber)}</span>
        <span class="games-wheel-reveal-prize">${esc(w.prizeLabel || 'Prize')}</span>`;
      mount.appendChild(card);
      requestAnimationFrame(() => card.classList.add('is-visible'));
    }

    function spinNext() {
      if (step >= winners.length) {
        live.innerHTML = '<strong>All spins complete!</strong> See full results below.';
        sessionStorage.setItem(storageKey, '1');
        return;
      }
      const w = winners[step];
      live.innerHTML = `<strong>Spin ${step + 1} of ${winners.length}</strong> — drawing…`;
      visual.classList.remove('is-spin-result');
      void visual.offsetWidth;
      visual.classList.add('is-spin-result');
      step += 1;
      setTimeout(() => {
        revealCard(w);
        spinNext();
      }, 2600);
    }

    spinNext();
  }

  let countdownTimer = null;
  let hubRefreshPending = false;
  let pageVisible = true;

  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState !== 'hidden';
    if (pageVisible) tickCountdowns();
  });

  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach((el) => {
      const target = el.dataset.countdown;
      const ms = new Date(target.includes('T') ? target : `${target.replace(' ', 'T')}Z`).getTime() - Date.now();
      el.textContent = ms <= 0 ? 'Now' : fmtCountdown(ms);
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
    countdownTimer = setInterval(() => {
      if (pageVisible) tickCountdowns();
    }, 5000);
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
    const close = () => {
      modal.hidden = true;
      document.body.classList.remove('games-expand-open');
      modal.classList.remove('games-expand-modal--immersive');
      modal.querySelector('.games-expand-panel').className = 'games-expand-panel';
    };
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
    const type = arena.dataset.gameType || '';
    const panel = modal.querySelector('.games-expand-panel');
    const title = arena.querySelector('.games-arena-head h2')?.textContent || 'Game';
    const body = arena.querySelector('.games-arena-body')?.innerHTML || '';
    const meta = arena.querySelector('.games-arena-meta')?.outerHTML || '';
    const prizes = arena.querySelector('.games-arena-prizes')?.outerHTML || '';
    const guide = arena.querySelector('.games-arena-guide-row')?.innerHTML || '';
    modal.classList.add('games-expand-modal--immersive');
    panel.className = `games-expand-panel games-expand-panel--immersive games-expand-panel--${type}`;
    modal.querySelector('#games-expand-title').textContent = title;
    modal.querySelector('#games-expand-body').innerHTML = `
      <div class="games-expand-guide">${guide}</div>
      ${meta}${prizes}
      <div class="games-expand-play games-expand-play--${type}">${body}</div>`;
    modal.hidden = false;
    document.body.classList.add('games-expand-open');
    bindScratch();
    bindMystery();
    bindInstant();
    bindExpand();
    tickCountdowns();
  }

  let arenaMotionObserver = null;

  function observeArenaMotion() {
    if (GAMES_LITE) return;
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.games-arena').forEach((a) => a.classList.add('is-in-view'));
      return;
    }
    if (!arenaMotionObserver) {
      arenaMotionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-in-view', entry.isIntersecting);
        });
      }, { rootMargin: '80px 0px', threshold: 0.08 });
    }
    document.querySelectorAll('.games-arena').forEach((arena) => {
      if (arena.dataset.motionObserved) return;
      arena.dataset.motionObserved = '1';
      arenaMotionObserver.observe(arena);
    });
  }

  function bindExpand() {
    document.querySelectorAll('.games-arena[data-expandable="1"]').forEach((arena) => {
      if (arena.dataset.expandBound) return;
      arena.dataset.expandBound = '1';
      arena.querySelector('.games-open-full')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openArenaExpand(arena);
      });
      const open = (e) => {
        if (e.target.closest('[data-no-expand], .games-open-full, a.games-guide-link, .games-scratch-tile, .games-mystery-box, .games-pick-card, .games-vault-door, .games-action-btn')) return;
        openArenaExpand(arena);
      };
      arena.addEventListener('click', open);
      arena.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArenaExpand(arena); }
      });
    });
    observeArenaMotion();
  }

  function renderRecentWinners(list) {
    const el = document.getElementById('games-recent-winners');
    if (!el || !list?.length) return;
    el.hidden = false;
    if (!GAMES_LITE) el.classList.add('is-animated');
    el.innerHTML = `
      <span class="games-recent-label">Recent wins</span>
      <div class="games-recent-track">${list.map((w) =>
    `<span class="games-recent-item"><strong>${esc(w.displayName)}</strong> won ${esc(w.label)}</span>`
  ).join('')}</div>`;
  }

  function renderHub(data) {
    hubEligibility = data.eligibility || null;
    const intro = document.getElementById('games-hub-intro');
    if (intro) {
      const lead = intro.querySelector('p');
      if (lead) {
        if (data.gamesEnabled === false) {
          lead.textContent = 'Games are paused for now — all rounds below are closed. Join our channel for updates when they reopen.';
        } else if (data.eligibility?.message) {
          lead.textContent = data.eligibility.message;
        }
      }
    }
    renderRecentWinners(data.recentWinners);
    const grid = document.getElementById('games-arena-grid');
    const choiceMount = document.getElementById('games-choice-mount');
    if (choiceMount) {
      choiceMount.innerHTML = data.hasPendingCredit ? renderPendingChoices(data) : '';
    }
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
    bindGameChoices();
    startCountdowns();
    runWheelDrawSequence(data.wheel);

    const wheel = data.wheel || {};
    if (wheel.myWin) {
      const key = `games-wheel-win-${wheel.id}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        showCongratulations({
          prize: { label: wheel.myWin.prizeLabel, prizeType: wheel.myWin.prizeType },
          fulfillment: wheel.myWin.fulfillment
        });
      }
    } else if (wheel.maxEntries && wheel.status === 'scheduled'
      && Number(wheel.entryCount) >= Number(wheel.maxEntries)) {
      if (!hubRefreshPending) {
        hubRefreshPending = true;
        setTimeout(() => { hubRefreshPending = false; loadGamesHub(); }, 2500);
      }
    }
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
