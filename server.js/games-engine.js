'use strict';

const crypto = require('crypto');

const PRIZE_TYPES = new Set([
  'none', 'bomb', 'wallet', 'loyalty', 'plug_access', 'custom', 'netflix', 'account'
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
    ORDER BY datetime(draw_at) DESC, id DESC
    LIMIT 1
  `).get() || null;
}

function mapPrizeRows(rows) {
  return (rows || []).map((p) => ({
    id: p.id,
    label: p.label,
    prizeType: p.prize_type,
    prizeValue: p.prize_value,
    weight: p.weight,
    tileStyle: p.tile_style
  }));
}

function buildGamesHubState(db, userId = null) {
  const enabled = isGamesEnabled(db);
  const channelUrl = readSetting(db, 'games_channel_url', 'https://t.me/loveriette');
  const now = new Date();
  const wheelRow = latestWheelCampaign(db);
  const scratchRow = db.prepare('SELECT * FROM game_scratch_pools ORDER BY id DESC LIMIT 1').get();
  const mysteryRow = db.prepare('SELECT * FROM game_mystery_pools ORDER BY id DESC LIMIT 1').get();

  const wheelOpen = enabled && isWheelCampaignOpen(wheelRow, now);
  const scratchOpen = enabled && !!scratchRow?.is_enabled;
  const mysteryOpen = enabled && !!mysteryRow?.is_enabled;

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
  if (wheelRow?.winner_slot_id) {
    wheelWinner = db.prepare(`
      SELECT display_name AS displayName, order_number AS orderNumber
      FROM game_wheel_slots WHERE id = ?
    `).get(wheelRow.winner_slot_id);
  }

  const wheelEntries = wheelRow
    ? db.prepare('SELECT COUNT(*) AS c FROM game_wheel_slots WHERE campaign_id = ?').get(wheelRow.id).c
    : 0;

  return {
    gamesEnabled: enabled,
    channelUrl,
    authenticated: !!userId,
    wheel: wheelRow ? {
      id: wheelRow.id,
      title: wheelRow.title,
      open: wheelOpen,
      status: wheelRow.status,
      drawAt: wheelRow.draw_at,
      minOrderTotal: wheelRow.min_order_total,
      prizes: wheelPrizes,
      entryCount: wheelEntries,
      winner: wheelWinner,
      mySlots: wheelSlots,
      canPlay: wheelOpen && wheelSlots.length > 0,
      needsPurchase: wheelOpen && !wheelSlots.length
    } : { open: false, title: 'Spin the Wheel', prizes: [], needsPurchase: false, canPlay: false },
    scratch: scratchRow ? {
      id: scratchRow.id,
      title: scratchRow.title,
      open: scratchOpen,
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
      minOrderTotal: mysteryRow.min_order_total,
      prizes: mysteryPrizes,
      plays: mysteryPlays,
      pending: mysteryPlays.filter((p) => !p.playedAt),
      canPlay: mysteryOpen && mysteryPlays.some((p) => !p.playedAt),
      needsPurchase: mysteryOpen && !mysteryPlays.length
    } : { open: false, title: 'Mystery Box', prizes: [], needsPurchase: false, canPlay: false }
  };
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
  return db.prepare(`
    SELECT * FROM game_scratch_pools WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1
  `).get() || null;
}

function activeMysteryPool(db) {
  return db.prepare(`
    SELECT * FROM game_mystery_pools WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1
  `).get() || null;
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

function fulfillPrize(db, deps, { userId, prize, orderRef, source }) {
  if (!prize || !userId) return { fulfilled: false };
  const type = String(prize.prize_type || 'none');
  const value = String(prize.prize_value || '').trim();
  const label = String(prize.label || 'Prize');
  const orderKey = `${source}:${orderRef}`;

  if (type === 'none' || type === 'bomb') {
    return { fulfilled: true, message: label };
  }

  if (type === 'wallet' || type === 'loyalty') {
    const amount = Math.max(0, Number(value) || 0);
    if (amount <= 0) return { fulfilled: true, message: label };
    const exists = db.prepare(`
      SELECT id FROM wallet_transactions WHERE user_id = ? AND order_number = ? AND type = 'loyalty'
    `).get(userId, orderKey);
    if (exists) return { fulfilled: true, message: label, duplicate: true };
    db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(amount, userId);
    db.prepare(`
      INSERT INTO wallet_transactions (user_id, type, amount, order_number, description)
      VALUES (?, 'loyalty', ?, ?, ?)
    `).run(userId, amount, orderKey, `${label} (${source})`);
    deps?.notify?.(userId, 'promo', 'You won a prize!', `${label} — ₱${amount} added to your wallet.`);
    return { fulfilled: true, message: label, amount };
  }

  if (type === 'plug_access') {
    deps?.notify?.(userId, 'promo', 'Plugging prize!', `${label}. Check your email or contact support for access details.`);
    return { fulfilled: true, message: label, manual: true };
  }

  deps?.notify?.(userId, 'promo', 'You won a prize!', `${label}. Our team will contact you with details.`);
  return { fulfilled: true, message: label, manual: true };
}

function grantGamesForApprovedOrder(db, deps, order) {
  if (readSetting(db, 'games_enabled', '1') !== '1') return;
  const userId = resolveUserId(db, { userId: order.user_id, email: order.email });
  if (!userId) return;

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
      deps?.notify?.(userId, 'promo', 'Spin the Wheel entry!', `Order #${orderNumber} earned you a slot on "${wheel.title}".`);
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

  const prize = db.prepare(`
    SELECT * FROM game_wheel_prizes WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1
  `).get(campaignId);
  if (!prize) return { error: 'Add a prize to this campaign first' };

  const winner = slots[Math.floor(Math.random() * slots.length)];
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE game_wheel_campaigns
    SET status = 'drawn', winner_slot_id = ?, winner_prize_id = ?, drawn_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(winner.id, prize.id, now, campaignId);

  fulfillPrize(db, deps, {
    userId: winner.user_id,
    prize,
    orderRef: winner.order_number,
    source: 'wheel'
  });

  return {
    ok: true,
    winner: {
      slotId: winner.id,
      displayName: winner.display_name,
      orderNumber: winner.order_number,
      userId: winner.user_id,
      email: winner.email
    },
    prize: { id: prize.id, label: prize.label, prizeType: prize.prize_type },
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

  if (prize) {
    db.prepare('UPDATE game_scratch_prizes SET won_count = won_count + 1 WHERE id = ?').run(prize.id);
    fulfillPrize(db, deps, { userId, prize, orderRef: card.order_number, source: 'scratch' });
  }

  return {
    ok: true,
    prize: prize ? {
      id: prize.id,
      label: prize.label,
      prizeType: prize.prize_type,
      tileStyle: prize.tile_style
    } : { label: 'No prize', prizeType: 'none', tileStyle: 'gray' }
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

  if (prize) {
    db.prepare('UPDATE game_mystery_prizes SET won_count = won_count + 1 WHERE id = ?').run(prize.id);
    fulfillPrize(db, deps, { userId, prize, orderRef: play.order_number, source: 'mystery' });
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
    boxes
  };
}

module.exports = {
  PRIZE_TYPES,
  parseDays,
  isGamesEnabled,
  buildGamesHubState,
  activeWheelCampaign,
  grantGamesForApprovedOrder,
  runWheelDraw,
  processDueWheelDraws,
  scratchCard,
  playMysteryBox,
  fulfillPrize,
  pickWeightedPrize,
  displayNameForUser
};
