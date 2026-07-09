'use strict';

const crypto = require('crypto');
const {
  orderQualifiesForGames,
  orderIsDeliveredForGames,
  eligibilityMessage,
  buildEligibilityHub,
  getGamesRules
} = require('./games-eligibility');

const PRIZE_TYPES = new Set([
  'none', 'bomb', 'wallet', 'loyalty', 'plug_access', 'custom', 'netflix', 'account',
  'product', 'redeem', 'voucher'
]);

function readSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function parseDays(raw) {
  return String(raw || '0,1,2,3,4,5,6')
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 0 && d <= 6);
}

function inDateRange(isoStart, isoEnd, now = new Date()) {
  if (isoStart && now < new Date(isoStart)) return false;
  if (isoEnd && now > new Date(isoEnd)) return false;
  return true;
}

function isDayAvailable(availableDays, now = new Date()) {
  return parseDays(availableDays).includes(now.getDay());
}

function isGamesEnabled(db) {
  return readSetting(db, 'games_enabled', '1') === '1';
}

function isWheelCampaignOpen(campaign, now = new Date()) {
  if (!campaign || !campaign.is_enabled) return false;
  if (campaign.status === 'drawn') return false;
  return inDateRange(campaign.starts_at, campaign.ends_at, now)
    && isDayAvailable(campaign.available_days, now);
}

function latestWheelCampaign(db) {
  return db.prepare(`
    SELECT * FROM game_wheel_campaigns
    WHERE is_enabled = 1
    ORDER BY datetime(COALESCE(drawn_at, draw_at)) DESC, id DESC
    LIMIT 1
  `).get() || null;
}

function resolveWheelCampaign(db, now = new Date()) {
  const active = activeWheelCampaign(db, now);
  if (active) {
    const entries = db.prepare('SELECT COUNT(*) AS c FROM game_wheel_slots WHERE campaign_id = ?').get(active.id).c;
    if (entries > 0) return active;
  }
  const drawn = db.prepare(`
    SELECT * FROM game_wheel_campaigns
    WHERE is_enabled = 1 AND status = 'drawn'
    ORDER BY datetime(drawn_at) DESC, id DESC
    LIMIT 1
  `).get();
  if (drawn) return drawn;
  return active || latestWheelCampaign(db);
}

function mapPrizeRows(rows) {
  return (rows || []).map((p) => ({
    id: p.id,
    label: p.label,
    prizeType: p.prize_type,
    prizeValue: p.prize_value,
    weight: p.weight,
    tileStyle: p.tile_style,
    quantity: p.quantity != null ? Number(p.quantity) : -1,
    wonCount: Number(p.won_count || 0),
    remaining: p.quantity != null && Number(p.quantity) >= 0
      ? Math.max(0, Number(p.quantity) - Number(p.won_count || 0))
      : null
  }));
}

function isPoolInSeason(pool, now = new Date()) {
  if (!pool) return false;
  return inDateRange(pool.starts_at, pool.ends_at, now);
}

function isScratchPoolOpen(pool, enabled, now = new Date()) {
  return enabled && !!pool?.is_enabled && isPoolInSeason(pool, now);
}

function isMysteryPoolOpen(pool, enabled, now = new Date()) {
  return enabled && !!pool?.is_enabled && isPoolInSeason(pool, now);
}

function isInstantPoolOpen(pool, enabled, now = new Date()) {
  return enabled && !!pool?.is_enabled && isPoolInSeason(pool, now);
}

function getWheelWinners(db, campaignId) {
  return db.prepare(`
    SELECT w.display_name AS displayName, w.order_number AS orderNumber,
           p.label AS prizeLabel, p.prize_type AS prizeType, w.created_at AS wonAt
    FROM game_wheel_winners w
    JOIN game_wheel_prizes p ON p.id = w.prize_id
    WHERE w.campaign_id = ?
    ORDER BY w.id ASC
  `).all(campaignId);
}

function getRecentPrizeWinners(db, limit = 10) {
  return db.prepare(`
    SELECT pa.prize_label AS label, pa.source,
           u.name AS displayName, pa.created_at AS wonAt
    FROM game_prize_awards pa
    LEFT JOIN users u ON u.id = pa.user_id
    WHERE pa.prize_type NOT IN ('none', 'bomb')
    ORDER BY pa.id DESC
    LIMIT ?
  `).all(limit).map((r) => ({
    label: r.label,
    source: r.source,
    displayName: String(r.displayName || '').trim() || 'Winner',
    wonAt: r.wonAt
  }));
}

function buildGamesHubState(db, userId = null) {
  const enabled = isGamesEnabled(db);
  const channelUrl = readSetting(db, 'games_channel_url', 'https://t.me/loveriette');
  const now = new Date();
  const wheelRow = resolveWheelCampaign(db, now);
  const scratchRow = db.prepare('SELECT * FROM game_scratch_pools ORDER BY id DESC LIMIT 1').get();
  const mysteryRow = db.prepare('SELECT * FROM game_mystery_pools ORDER BY id DESC LIMIT 1').get();

  const wheelOpen = enabled && isWheelCampaignOpen(wheelRow, now);
  const wheelDrawn = wheelRow?.status === 'drawn';
  const wheelVisible = enabled && wheelRow?.is_enabled && (wheelOpen || wheelDrawn);
  const scratchOpen = isScratchPoolOpen(scratchRow, enabled, now);
  const mysteryOpen = isMysteryPoolOpen(mysteryRow, enabled, now);

  const wheelPrizes = wheelRow
    ? mapPrizeRows(db.prepare('SELECT * FROM game_wheel_prizes WHERE campaign_id = ? ORDER BY sort_order, id').all(wheelRow.id))
    : [];
  const scratchPrizes = scratchRow
    ? mapPrizeRows(db.prepare('SELECT * FROM game_scratch_prizes WHERE pool_id = ? ORDER BY id').all(scratchRow.id))
    : [];
  const mysteryPrizes = mysteryRow
    ? mapPrizeRows(db.prepare('SELECT * FROM game_mystery_prizes WHERE pool_id = ? ORDER BY id').all(mysteryRow.id))
    : [];

  let wheelSlots = [];
  let scratchCards = [];
  let mysteryPlays = [];
  if (userId) {
    if (wheelRow) {
      wheelSlots = db.prepare(`
        SELECT id, order_number AS orderNumber, display_name AS displayName, created_at AS createdAt
        FROM game_wheel_slots WHERE campaign_id = ? AND user_id = ?
      `).all(wheelRow.id, userId);
    }
    scratchCards = db.prepare(`
      SELECT sc.id, sc.order_number AS orderNumber, sc.scratched_at AS scratchedAt, sc.created_at AS createdAt,
             sp.label AS prizeLabel, sp.prize_type AS prizeType, sp.tile_style AS tileStyle
      FROM game_scratch_cards sc
      LEFT JOIN game_scratch_prizes sp ON sp.id = sc.prize_id
      WHERE sc.user_id = ?
      ORDER BY sc.id DESC LIMIT 20
    `).all(userId);
    mysteryPlays = db.prepare(`
      SELECT mp.id, mp.order_number AS orderNumber, mp.played_at AS playedAt, mp.created_at AS createdAt,
             pr.label AS prizeLabel, pr.prize_type AS prizeType
      FROM game_mystery_plays mp
      LEFT JOIN game_mystery_prizes pr ON pr.id = mp.prize_id
      WHERE mp.user_id = ?
      ORDER BY mp.id DESC LIMIT 20
    `).all(userId);
  }

  let wheelWinner = null;
  let wheelWinners = [];
  if (wheelRow) {
    wheelWinners = getWheelWinners(db, wheelRow.id);
    if (wheelWinners.length) wheelWinner = wheelWinners[0];
    else if (wheelRow.winner_slot_id) {
      wheelWinner = db.prepare(`
        SELECT display_name AS displayName, order_number AS orderNumber
        FROM game_wheel_slots WHERE id = ?
      `).get(wheelRow.winner_slot_id);
      if (wheelWinner) {
        const prize = wheelRow.winner_prize_id
          ? db.prepare('SELECT label AS prizeLabel FROM game_wheel_prizes WHERE id = ?').get(wheelRow.winner_prize_id)
          : null;
        wheelWinners = [{ ...wheelWinner, prizeLabel: prize?.prizeLabel || 'Prize' }];
      }
    }
  }

  const wheelEntries = wheelRow
    ? db.prepare(`
      SELECT display_name AS displayName, order_number AS orderNumber
      FROM game_wheel_slots WHERE campaign_id = ?
      ORDER BY id ASC LIMIT 100
    `).all(wheelRow.id)
    : [];
  const wheelEntryCount = wheelRow
    ? db.prepare('SELECT COUNT(*) AS c FROM game_wheel_slots WHERE campaign_id = ?').get(wheelRow.id).c
    : 0;

  const dice = buildInstantHubGame(db, 'dice', userId, enabled);
  const pick = buildInstantHubGame(db, 'pick', userId, enabled);
  const vault = buildInstantHubGame(db, 'vault', userId, enabled);

  const recentWinners = getRecentPrizeWinners(db, 8);

  return {
    gamesEnabled: enabled,
    channelUrl,
    authenticated: !!userId,
    previewExamples: true,
    eligibility: buildEligibilityHub(db),
    recentWinners,
    wheel: wheelRow ? {
      id: wheelRow.id,
      title: wheelRow.title,
      open: wheelOpen,
      visible: wheelVisible,
      status: wheelRow.status,
      drawAt: wheelRow.draw_at,
      drawnAt: wheelRow.drawn_at,
      endsAt: wheelRow.ends_at,
      minOrderTotal: wheelRow.min_order_total,
      prizes: wheelPrizes,
      entryCount: wheelEntryCount,
      entries: wheelEntries,
      winner: wheelWinner,
      winners: wheelWinners,
      mySlots: wheelSlots,
      canPlay: wheelOpen && wheelSlots.length > 0,
      needsPurchase: wheelOpen && !wheelSlots.length
    } : { open: false, visible: false, title: 'Spin the Wheel', prizes: [], needsPurchase: false, canPlay: false },
    scratch: scratchRow ? {
      id: scratchRow.id,
      title: scratchRow.title,
      open: scratchOpen,
      endsAt: scratchRow.ends_at,
      startsAt: scratchRow.starts_at,
      minOrderTotal: scratchRow.min_order_total,
      prizes: scratchPrizes,
      cards: scratchCards,
      pending: scratchCards.filter((c) => !c.scratchedAt),
      canPlay: scratchOpen && scratchCards.some((c) => !c.scratchedAt),
      needsPurchase: scratchOpen && !scratchCards.length
    } : { open: false, title: 'Scratch Cards', prizes: [], needsPurchase: false, canPlay: false },
    mystery: mysteryRow ? {
      id: mysteryRow.id,
      title: mysteryRow.title,
      open: mysteryOpen,
      endsAt: mysteryRow.ends_at,
      startsAt: mysteryRow.starts_at,
      minOrderTotal: mysteryRow.min_order_total,
      prizes: mysteryPrizes,
      plays: mysteryPlays,
      pending: mysteryPlays.filter((p) => !p.playedAt),
      canPlay: mysteryOpen && mysteryPlays.some((p) => !p.playedAt),
      needsPurchase: mysteryOpen && !mysteryPlays.length
    } : { open: false, title: 'Mystery Box', prizes: [], needsPurchase: false, canPlay: false },
    dice,
    pick,
    vault
  };
}

const INSTANT_DEFAULTS = {
  dice: 'Lucky Dice',
  pick: 'Card Flip',
  vault: 'Treasure Vault'
};

function buildInstantHubGame(db, gameKey, userId, enabled) {
  const pool = db.prepare('SELECT * FROM game_instant_pools WHERE game_key = ?').get(gameKey);
  const fallbackTitle = INSTANT_DEFAULTS[gameKey] || 'Instant Game';
  if (!pool) {
    return { gameKey, open: false, title: fallbackTitle, prizes: [], needsPurchase: false, canPlay: false };
  }
  const open = isInstantPoolOpen(pool, enabled, new Date());
  const prizes = mapPrizeRows(
    db.prepare('SELECT * FROM game_instant_prizes WHERE pool_id = ? ORDER BY id').all(pool.id)
  );
  let plays = [];
  if (userId) {
    plays = db.prepare(`
      SELECT ip.id, ip.order_number AS orderNumber, ip.played_at AS playedAt, ip.created_at AS createdAt,
             ip.result_json AS resultJson,
             pr.label AS prizeLabel, pr.prize_type AS prizeType, pr.tile_style AS tileStyle
      FROM game_instant_plays ip
      LEFT JOIN game_instant_prizes pr ON pr.id = ip.prize_id
      WHERE ip.pool_id = ? AND ip.user_id = ?
      ORDER BY ip.id DESC LIMIT 20
    `).all(pool.id, userId).map((p) => {
      let result = null;
      if (p.resultJson) {
        try { result = JSON.parse(p.resultJson); } catch (_) { /* ignore */ }
      }
      return { ...p, result };
    });
  }
  return {
    id: pool.id,
    gameKey,
    title: pool.title,
    open,
    endsAt: pool.ends_at,
    startsAt: pool.starts_at,
    minOrderTotal: pool.min_order_total,
    prizes,
    plays,
    pending: plays.filter((p) => !p.playedAt),
    canPlay: open && plays.some((p) => !p.playedAt),
    needsPurchase: open && !plays.length
  };
}

function activeInstantPool(db, gameKey) {
  const pool = db.prepare(`
    SELECT * FROM game_instant_pools WHERE game_key = ? AND is_enabled = 1 LIMIT 1
  `).get(gameKey) || null;
  if (pool && !isPoolInSeason(pool)) return null;
  return pool;
}

function activeWheelCampaign(db, now = new Date()) {
  const rows = db.prepare(`
    SELECT * FROM game_wheel_campaigns
    WHERE is_enabled = 1 AND status = 'scheduled'
    ORDER BY datetime(draw_at) ASC
  `).all();
  return rows.find((c) => inDateRange(c.starts_at, c.ends_at, now) && isDayAvailable(c.available_days, now)) || null;
}

function activeScratchPool(db) {
  const pool = db.prepare(`
    SELECT * FROM game_scratch_pools WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1
  `).get() || null;
  if (pool && !isPoolInSeason(pool)) return null;
  return pool;
}

function activeMysteryPool(db) {
  const pool = db.prepare(`
    SELECT * FROM game_mystery_pools WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1
  `).get() || null;
  if (pool && !isPoolInSeason(pool)) return null;
  return pool;
}

function resolveUserId(db, { userId, email }) {
  if (userId) return Number(userId);
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const row = db.prepare('SELECT id, name FROM users WHERE LOWER(email) = ?').get(em);
  return row?.id || null;
}

function displayNameForUser(db, userId, email) {
  const user = userId
    ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId)
    : null;
  const name = String(user?.name || '').trim();
  if (name) return name;
  const em = String(user?.email || email || '').trim();
  if (em.includes('@')) return em.split('@')[0];
  return `Buyer #${userId || '?'}`;
}

function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

function pickWeightedPrize(prizes) {
  const available = prizes.filter((p) => {
    const qty = Number(p.quantity);
    const won = Number(p.won_count || 0);
    return qty < 0 || won < qty;
  });
  if (!available.length) return null;
  const total = available.reduce((sum, p) => sum + Math.max(1, Number(p.weight) || 1), 0);
  let roll = Math.random() * total;
  for (const prize of available) {
    roll -= Math.max(1, Number(prize.weight) || 1);
    if (roll <= 0) return prize;
  }
  return available[available.length - 1];
}

function recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment }) {
  try {
    db.prepare(`
      INSERT INTO game_prize_awards (user_id, prize_type, prize_label, redeem_code, order_ref, source, fulfillment_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      String(prize?.prize_type || 'none'),
      String(prize?.label || 'Prize'),
      fulfillment?.code || null,
      String(orderRef || ''),
      String(source || ''),
      JSON.stringify(fulfillment || {})
    );
  } catch (_) { /* ignore */ }
}

function issueGameRedeemCode(db, prize) {
  const raw = String(prize?.prize_value || '').trim();
  let discountType = 'fixed';
  let discountValue = 50;
  if (raw.startsWith('{')) {
    try {
      const cfg = JSON.parse(raw);
      discountType = cfg.discountType || cfg.type || 'fixed';
      discountValue = Math.max(0, Number(cfg.discountValue ?? cfg.amount ?? 50));
    } catch (_) { /* use defaults */ }
  } else if (raw) {
    const n = Number(raw);
    if (!Number.isNaN(n) && n > 0) discountValue = n;
  }
  let code;
  do {
    code = `GAME-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  } while (db.prepare('SELECT id FROM redeem_codes WHERE UPPER(code) = UPPER(?)').get(code));
  db.prepare(`
    INSERT INTO redeem_codes (code, discount_type, discount_value, is_active, max_uses, used_count)
    VALUES (?, ?, ?, 1, 1, 0)
  `).run(code, discountType, discountValue);
  return { code, discountType, discountValue };
}

function fulfillPrize(db, deps, { userId, prize, orderRef, source }) {
  if (!prize || !userId) return { fulfilled: false, fulfillment: { type: 'none' } };
  const type = String(prize.prize_type || 'none');
  const value = String(prize.prize_value || '').trim();
  const label = String(prize.label || 'Prize');
  const orderKey = `${source}:${orderRef}`;
  const rules = getGamesRules(db);
  const telegram = rules.telegramHandle || '@loveriette';

  if (type === 'none' || type === 'bomb') {
    const fulfillment = { type: 'none', label, message: label };
    recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
    return { fulfilled: true, message: label, fulfillment };
  }

  if (type === 'wallet' || type === 'loyalty') {
    const amount = Math.max(0, Number(value) || 0);
    if (amount <= 0) {
      const fulfillment = { type, label, message: label };
      recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
      return { fulfilled: true, message: label, fulfillment };
    }
    const exists = db.prepare(`
      SELECT id FROM wallet_transactions WHERE user_id = ? AND order_number = ? AND type = 'loyalty'
    `).get(userId, orderKey);
    if (exists) {
      const fulfillment = { type, label, amount, message: label, duplicate: true };
      return { fulfilled: true, message: label, duplicate: true, fulfillment };
    }
    db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(amount, userId);
    db.prepare(`
      INSERT INTO wallet_transactions (user_id, type, amount, order_number, description)
      VALUES (?, 'loyalty', ?, ?, ?)
    `).run(userId, amount, orderKey, `${label} (${source})`);
    const msg = type === 'loyalty'
      ? `You won ${label}! ₱${amount} loyalty credit was added to your wallet automatically.`
      : `${label} — ₱${amount} added to your wallet.`;
    deps?.notify?.(userId, 'promo', 'You won a prize!', msg);
    const fulfillment = {
      type: type === 'loyalty' ? 'loyalty' : 'wallet',
      label,
      amount,
      message: msg,
      auto: true
    };
    recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
    return { fulfilled: true, message: label, amount, fulfillment };
  }

  if (type === 'redeem' || type === 'voucher' || type === 'discount') {
    const issued = issueGameRedeemCode(db, prize);
    const msg = `You won ${label}! Your discount code ${issued.code} is ready — use it at checkout.`;
    deps?.notify?.(userId, 'promo', 'You won a voucher!', msg);
    const fulfillment = {
      type: 'redeem',
      label,
      code: issued.code,
      discountType: issued.discountType,
      discountValue: issued.discountValue,
      message: msg,
      copyLabel: 'Copy voucher code'
    };
    recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
    return { fulfilled: true, message: label, fulfillment };
  }

  if (type === 'product' || type === 'account' || type === 'netflix' || type === 'custom') {
    const msg = `You won ${label}! Screenshot this prize screen and send it to ${telegram} on Telegram to claim.`;
    deps?.notify?.(userId, 'promo', 'You won a product prize!', msg);
    const fulfillment = {
      type: 'product',
      label,
      telegram,
      message: msg,
      instruction: `Screenshot this and send to ${telegram} on Telegram.`
    };
    recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
    return { fulfilled: true, message: label, manual: true, fulfillment };
  }

  if (type === 'plug_access') {
    const msg = `${label}. Check your email or contact support for access details.`;
    deps?.notify?.(userId, 'promo', 'Plugging prize!', msg);
    const fulfillment = { type: 'plug_access', label, message: msg };
    recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
    return { fulfilled: true, message: label, manual: true, fulfillment };
  }

  const msg = `${label}. Our team will contact you with details.`;
  deps?.notify?.(userId, 'promo', 'You won a prize!', msg);
  const fulfillment = { type: 'custom', label, message: msg };
  recordPrizeAward(db, { userId, prize, orderRef, source, fulfillment });
  return { fulfilled: true, message: label, manual: true, fulfillment };
}

function tryGrantGamesForDeliveredOrder(db, deps, orderId) {
  if (!orderIsDeliveredForGames(db, orderId)) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;
  grantGamesForApprovedOrder(db, deps, order);
}

function grantGamesForApprovedOrder(db, deps, order) {
  if (readSetting(db, 'games_enabled', '1') !== '1') return;
  const userId = resolveUserId(db, { userId: order.user_id, email: order.email });
  if (!userId) return;
  if (!orderIsDeliveredForGames(db, order.id)) return;
  if (!orderQualifiesForGames(db, order.id)) return;

  const total = Number(order.total) || 0;
  const orderId = order.id;
  const orderNumber = String(order.order_number || order.id);
  const displayName = displayNameForUser(db, userId, order.email);

  const wheel = activeWheelCampaign(db);
  if (wheel && total >= Number(wheel.min_order_total || 0)) {
    const exists = db.prepare('SELECT id FROM game_wheel_slots WHERE order_id = ?').get(orderId);
    if (!exists) {
      db.prepare(`
        INSERT INTO game_wheel_slots (campaign_id, user_id, order_id, order_number, display_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(wheel.id, userId, orderId, orderNumber, displayName);
      deps?.notify?.(userId, 'promo', 'Spin the Wheel entry!', `Order #${orderNumber} is delivered — you earned a slot on "${wheel.title}".`);
    }
  }

  const scratch = activeScratchPool(db);
  if (scratch && total >= Number(scratch.min_order_total || 0)) {
    const exists = db.prepare('SELECT id FROM game_scratch_cards WHERE order_id = ?').get(orderId);
    if (!exists) {
      const token = genToken();
      db.prepare(`
        INSERT INTO game_scratch_cards (pool_id, user_id, order_id, order_number, token)
        VALUES (?, ?, ?, ?, ?)
      `).run(scratch.id, userId, orderId, orderNumber, token);
      deps?.notify?.(userId, 'promo', 'Scratch card unlocked!', `Scratch your card in Games for order #${orderNumber}.`);
    }
  }

  const mystery = activeMysteryPool(db);
  if (mystery && total >= Number(mystery.min_order_total || 0)) {
    const exists = db.prepare('SELECT id FROM game_mystery_plays WHERE order_id = ?').get(orderId);
    if (!exists) {
      db.prepare(`
        INSERT INTO game_mystery_plays (pool_id, user_id, order_id, order_number)
        VALUES (?, ?, ?, ?)
      `).run(mystery.id, userId, orderId, orderNumber);
      deps?.notify?.(userId, 'promo', 'Mystery box ready!', `Pick a box in Games for order #${orderNumber}.`);
    }
  }

  for (const gameKey of ['dice', 'pick', 'vault']) {
    const pool = activeInstantPool(db, gameKey);
    if (pool && total >= Number(pool.min_order_total || 0)) {
      const exists = db.prepare('SELECT id FROM game_instant_plays WHERE order_id = ? AND pool_id = ?').get(orderId, pool.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO game_instant_plays (pool_id, user_id, order_id, order_number)
          VALUES (?, ?, ?, ?)
        `).run(pool.id, userId, orderId, orderNumber);
        const label = INSTANT_DEFAULTS[gameKey] || 'Game';
        deps?.notify?.(userId, 'promo', `${label} unlocked!`, `Play in Games for order #${orderNumber}.`);
      }
    }
  }
}

function runWheelDraw(db, deps, campaignId) {
  const campaign = db.prepare('SELECT * FROM game_wheel_campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return { error: 'Campaign not found' };
  if (campaign.status !== 'scheduled') return { error: 'Campaign already drawn or cancelled' };

  const slots = db.prepare(`
    SELECT s.*, u.email FROM game_wheel_slots s
    JOIN users u ON u.id = s.user_id
    WHERE s.campaign_id = ?
    ORDER BY s.id ASC
  `).all(campaignId);
  if (!slots.length) return { error: 'No entries yet' };

  const prizes = db.prepare(`
    SELECT * FROM game_wheel_prizes WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC
  `).all(campaignId);
  if (!prizes.length) return { error: 'Add a prize to this campaign first' };

  const remaining = [...slots];
  const winners = [];
  const now = new Date().toISOString();

  for (const prize of prizes) {
    const qty = Math.max(1, Number(prize.quantity) || 1);
    const alreadyWon = Number(prize.won_count || 0);
    const need = Math.max(0, qty - alreadyWon);
    for (let n = 0; n < need && remaining.length; n++) {
      const idx = Math.floor(Math.random() * remaining.length);
      const winner = remaining.splice(idx, 1)[0];
      db.prepare(`
        INSERT INTO game_wheel_winners (campaign_id, slot_id, prize_id, user_id, display_name, order_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(campaignId, winner.id, prize.id, winner.user_id, winner.display_name, winner.order_number, now);
      db.prepare('UPDATE game_wheel_prizes SET won_count = won_count + 1 WHERE id = ?').run(prize.id);

      const fulfilled = fulfillPrize(db, deps, {
        userId: winner.user_id,
        prize,
        orderRef: winner.order_number,
        source: 'wheel'
      });

      winners.push({
        slotId: winner.id,
        displayName: winner.display_name,
        orderNumber: winner.order_number,
        userId: winner.user_id,
        email: winner.email,
        prize: { id: prize.id, label: prize.label, prizeType: prize.prize_type },
        fulfillment: fulfilled.fulfillment
      });
    }
  }

  if (!winners.length) return { error: 'No winners could be drawn — check prize winner counts' };

  const first = winners[0];
  db.prepare(`
    UPDATE game_wheel_campaigns
    SET status = 'drawn', winner_slot_id = ?, winner_prize_id = ?, drawn_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(first.slotId, first.prize.id, now, campaignId);

  return {
    ok: true,
    winner: {
      slotId: first.slotId,
      displayName: first.displayName,
      orderNumber: first.orderNumber,
      userId: first.userId,
      email: first.email
    },
    winners,
    prize: first.prize,
    fulfillment: first.fulfillment,
    entryCount: slots.length
  };
}

function processDueWheelDraws(db, deps) {
  const now = new Date();
  const due = db.prepare(`
    SELECT * FROM game_wheel_campaigns
    WHERE is_enabled = 1 AND status = 'scheduled' AND datetime(draw_at) <= datetime('now')
  `).all();
  for (const c of due) {
    try {
      runWheelDraw(db, deps, c.id);
    } catch (err) {
      console.error('[games] wheel draw failed', c.id, err.message);
    }
  }
}

function scratchCard(db, deps, { cardId, userId }) {
  const card = db.prepare('SELECT * FROM game_scratch_cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  if (!card) return { error: 'Card not found' };
  if (card.scratched_at) return { error: 'Already scratched' };

  const prizes = db.prepare('SELECT * FROM game_scratch_prizes WHERE pool_id = ?').all(card.pool_id);
  const prize = pickWeightedPrize(prizes);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE game_scratch_cards SET prize_id = ?, scratched_at = ? WHERE id = ? AND scratched_at IS NULL
  `).run(prize?.id || null, now, card.id);

  let fulfilled = { fulfillment: { type: 'none' } };
  if (prize) {
    db.prepare('UPDATE game_scratch_prizes SET won_count = won_count + 1 WHERE id = ?').run(prize.id);
    fulfilled = fulfillPrize(db, deps, { userId, prize, orderRef: card.order_number, source: 'scratch' });
  }

  return {
    ok: true,
    prize: prize ? {
      id: prize.id,
      label: prize.label,
      prizeType: prize.prize_type,
      tileStyle: prize.tile_style
    } : { label: 'No prize', prizeType: 'none', tileStyle: 'gray' },
    fulfillment: fulfilled.fulfillment
  };
}

function playMysteryBox(db, deps, { playId, userId, boxIndex }) {
  const play = db.prepare('SELECT * FROM game_mystery_plays WHERE id = ? AND user_id = ?').get(playId, userId);
  if (!play) return { error: 'Game not found' };
  if (play.played_at) return { error: 'Already played' };

  const prizes = db.prepare('SELECT * FROM game_mystery_prizes WHERE pool_id = ?').all(play.pool_id);
  const prize = pickWeightedPrize(prizes);
  const now = new Date().toISOString();
  const pickedBox = Math.max(0, Math.min(2, Number(boxIndex) || 0));

  db.prepare(`
    UPDATE game_mystery_plays SET prize_id = ?, played_at = ? WHERE id = ? AND played_at IS NULL
  `).run(prize?.id || null, now, play.id);

  let fulfilled = { fulfillment: { type: 'none' } };
  if (prize) {
    db.prepare('UPDATE game_mystery_prizes SET won_count = won_count + 1 WHERE id = ?').run(prize.id);
    fulfilled = fulfillPrize(db, deps, { userId, prize, orderRef: play.order_number, source: 'mystery' });
  }

  const decoys = ['Empty box', 'Try again', 'No luck'];
  const boxes = [0, 1, 2].map((i) => {
    if (i === pickedBox) {
      return prize ? { label: prize.label, prizeType: prize.prize_type, winner: true }
        : { label: 'No prize', prizeType: 'none', winner: true };
    }
    return { label: decoys[i % decoys.length], prizeType: 'none', winner: false };
  });

  return {
    ok: true,
    pickedBox,
    prize: prize ? { id: prize.id, label: prize.label, prizeType: prize.prize_type } : null,
    fulfillment: fulfilled.fulfillment,
    boxes
  };
}

function playInstantGame(db, deps, { playId, userId, gameKey, choice }) {
  const play = db.prepare(`
    SELECT ip.*, p.game_key AS gameKey FROM game_instant_plays ip
    JOIN game_instant_pools p ON p.id = ip.pool_id
    WHERE ip.id = ? AND ip.user_id = ?
  `).get(playId, userId);
  if (!play) return { error: 'Game not found' };
  if (play.played_at) return { error: 'Already played' };
  if (gameKey && play.gameKey !== gameKey) return { error: 'Invalid game' };

  const prizes = db.prepare('SELECT * FROM game_instant_prizes WHERE pool_id = ?').all(play.pool_id);
  const prize = pickWeightedPrize(prizes);
  const now = new Date().toISOString();
  let result = { choice: Number(choice) || 0 };

  if (play.gameKey === 'dice') {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    result = { dice: [d1, d2], sum: d1 + d2, choice: Number(choice) || 0 };
  } else if (play.gameKey === 'pick') {
    const idx = Math.max(0, Math.min(2, Number(choice) || 0));
    const suits = ['♠ Ace', '♥ King', '♦ Queen'];
    result = {
      pickedCard: idx,
      cards: [0, 1, 2].map((i) => ({
        index: i,
        label: i === idx
          ? (prize?.label || 'No prize')
          : suits[i % suits.length],
        winner: i === idx
      }))
    };
  } else if (play.gameKey === 'vault') {
    const idx = Math.max(0, Math.min(2, Number(choice) || 0));
    result = {
      pickedVault: idx,
      vaults: [0, 1, 2].map((i) => ({
        index: i,
        label: i === idx ? (prize?.label || 'Empty') : ['Bronze', 'Silver', 'Gold'][i],
        winner: i === idx
      }))
    };
  }

  db.prepare(`
    UPDATE game_instant_plays SET prize_id = ?, played_at = ?, result_json = ? WHERE id = ? AND played_at IS NULL
  `).run(prize?.id || null, now, JSON.stringify(result), play.id);

  let fulfilled = { fulfillment: { type: 'none' } };
  if (prize) {
    db.prepare('UPDATE game_instant_prizes SET won_count = won_count + 1 WHERE id = ?').run(prize.id);
    fulfilled = fulfillPrize(db, deps, { userId, prize, orderRef: play.order_number, source: play.gameKey });
  }

  return {
    ok: true,
    gameKey: play.gameKey,
    result,
    prize: prize ? {
      id: prize.id,
      label: prize.label,
      prizeType: prize.prize_type,
      tileStyle: prize.tile_style
    } : { label: 'No prize', prizeType: 'none', tileStyle: 'gray' },
    fulfillment: fulfilled.fulfillment
  };
}

module.exports = {
  PRIZE_TYPES,
  parseDays,
  isGamesEnabled,
  buildGamesHubState,
  activeWheelCampaign,
  grantGamesForApprovedOrder,
  tryGrantGamesForDeliveredOrder,
  runWheelDraw,
  processDueWheelDraws,
  scratchCard,
  playMysteryBox,
  playInstantGame,
  activeInstantPool,
  buildInstantHubGame,
  fulfillPrize,
  pickWeightedPrize,
  orderQualifiesForGames,
  eligibilityMessage,
  buildEligibilityHub,
  getGamesRules,
  recordPrizeAward,
  displayNameForUser
};
