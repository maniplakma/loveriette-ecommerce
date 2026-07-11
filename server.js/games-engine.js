'use strict';

const crypto = require('crypto');
const {
  orderQualifiesForGames,
  orderQualifiesForGrandDraw,
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatAvailableDays(raw) {
  const days = parseDays(raw);
  if (days.length === 7) return 'every day';
  if (!days.length) return 'selected days';
  return days.map((d) => DAY_LABELS[d] || `Day ${d}`).join(', ');
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

function ensureGamesMasterEnabled(db) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('games_enabled', '1')
    ON CONFLICT(key) DO UPDATE SET value = '1'
  `).run();
}

function countWheelEntries(db, campaignId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM game_wheel_slots WHERE campaign_id = ?
  `).get(campaignId);
  return Number(row?.c) || 0;
}

function isWheelFull(db, campaign) {
  if (!campaign || !db) return false;
  const max = Number(campaign.max_entries);
  if (!max || max < 1) return false;
  return countWheelEntries(db, campaign.id) >= max;
}

function pickEnabledScheduledWheel(db) {
  return db.prepare(`
    SELECT * FROM game_wheel_campaigns
    WHERE is_enabled = 1 AND status = 'scheduled'
    ORDER BY id DESC
    LIMIT 1
  `).get() || null;
}

function diagnoseWheelPlayState(campaign, db, gamesEnabled, now = new Date()) {
  if (!gamesEnabled) return { open: false, closeReason: 'games_off' };
  if (!campaign) return { open: false, closeReason: 'no_campaign' };
  if (!campaign.is_enabled) return { open: false, closeReason: 'campaign_disabled' };
  if (campaign.status === 'drawn') return { open: false, closeReason: 'drawn' };
  if (db && isWheelFull(db, campaign)) return { open: false, closeReason: 'full' };
  if (campaign.starts_at && now < new Date(campaign.starts_at)) {
    return { open: false, closeReason: 'not_started', startsAt: campaign.starts_at };
  }
  if (campaign.ends_at && now > new Date(campaign.ends_at)) {
    return { open: false, closeReason: 'ended', endsAt: campaign.ends_at };
  }
  if (!isDayAvailable(campaign.available_days, now)) {
    return {
      open: false,
      closeReason: 'wrong_day',
      availableDays: parseDays(campaign.available_days),
      availableDaysLabel: formatAvailableDays(campaign.available_days)
    };
  }
  return { open: true, closeReason: null };
}

function isWheelCampaignOpen(campaign, now = new Date(), db = null) {
  return diagnoseWheelPlayState(campaign, db, true, now).open;
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
  return activeWheelCampaign(db, now) || resolveWheelDisplayCampaign(db, now);
}

function resolveWheelDisplayCampaign(db, now = new Date()) {
  const drawn = db.prepare(`
    SELECT * FROM game_wheel_campaigns
    WHERE is_enabled = 1 AND status = 'drawn'
    ORDER BY datetime(COALESCE(drawn_at, updated_at)) DESC, id DESC
    LIMIT 1
  `).get();

  const active = activeWheelCampaign(db, now);
  if (active) {
    const entries = countWheelEntries(db, active.id);
    if (drawn && Number(drawn.id) > Number(active.id)) return drawn;
    if (entries > 0) return active;
    if (!isWheelFull(db, active) && (!drawn || Number(active.id) > Number(drawn.id))) return active;
  }
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
  const rows = db.prepare(`
    SELECT w.display_name AS displayName, w.order_number AS orderNumber,
           p.label AS prizeLabel, p.prize_type AS prizeType, w.created_at AS wonAt,
           p.sort_order AS prizeSort
    FROM game_wheel_winners w
    JOIN game_wheel_prizes p ON p.id = w.prize_id
    WHERE w.campaign_id = ?
    ORDER BY w.id ASC
  `).all(campaignId);
  return rows.map((r, i) => ({
    displayName: r.displayName,
    orderNumber: r.orderNumber,
    prizeLabel: r.prizeLabel,
    prizeType: r.prizeType,
    wonAt: r.wonAt,
    spinIndex: i + 1
  }));
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
  const hubListed = true;
  const channelUrl = readSetting(db, 'games_channel_url', 'https://t.me/loveriette');
  const now = new Date();
  const wheelCandidate = pickEnabledScheduledWheel(db);
  const wheelDiagnosis = diagnoseWheelPlayState(wheelCandidate, db, enabled, now);
  const wheelPlayRow = wheelDiagnosis.open ? wheelCandidate : null;
  const wheelDisplayRow = wheelCandidate
    || resolveWheelDisplayCampaign(db, now)
    || db.prepare('SELECT * FROM game_wheel_campaigns ORDER BY id DESC LIMIT 1').get();
  const scratchRow = db.prepare('SELECT * FROM game_scratch_pools ORDER BY id DESC LIMIT 1').get();
  const mysteryRow = db.prepare('SELECT * FROM game_mystery_pools ORDER BY id DESC LIMIT 1').get();

  const wheelOpen = wheelDiagnosis.open;
  const wheelCampaignOn = !!(enabled && wheelCandidate?.is_enabled);
  const wheelDrawn = wheelDisplayRow?.status === 'drawn';
  const scratchOpen = isScratchPoolOpen(scratchRow, enabled, now);
  const mysteryOpen = isMysteryPoolOpen(mysteryRow, enabled, now);

  const wheelPrizes = wheelDisplayRow
    ? mapPrizeRows(db.prepare('SELECT * FROM game_wheel_prizes WHERE campaign_id = ? ORDER BY sort_order, id').all(wheelDisplayRow.id))
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
    const slotCampaignId = wheelPlayRow?.id || wheelDisplayRow?.id;
    if (slotCampaignId) {
      wheelSlots = db.prepare(`
        SELECT id, order_number AS orderNumber, display_name AS displayName, created_at AS createdAt
        FROM game_wheel_slots WHERE campaign_id = ? AND user_id = ?
      `).all(slotCampaignId, userId);
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
  if (wheelDisplayRow) {
    wheelWinners = getWheelWinners(db, wheelDisplayRow.id);
    if (wheelWinners.length) wheelWinner = wheelWinners[0];
    else if (wheelDisplayRow.winner_slot_id) {
      wheelWinner = db.prepare(`
        SELECT display_name AS displayName, order_number AS orderNumber
        FROM game_wheel_slots WHERE id = ?
      `).get(wheelDisplayRow.winner_slot_id);
      if (wheelWinner) {
        const prize = wheelDisplayRow.winner_prize_id
          ? db.prepare('SELECT label AS prizeLabel FROM game_wheel_prizes WHERE id = ?').get(wheelDisplayRow.winner_prize_id)
          : null;
        wheelWinners = [{ ...wheelWinner, prizeLabel: prize?.prizeLabel || 'Prize' }];
      }
    }
  }

  const wheelEntries = wheelDisplayRow
    ? db.prepare(`
      SELECT s.display_name AS displayName, s.order_number AS orderNumber,
             u.username, u.name AS userName, u.email,
             o.email AS orderEmail
      FROM game_wheel_slots s
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN orders o ON o.id = s.order_id
      WHERE s.campaign_id = ?
      ORDER BY s.id ASC LIMIT 100
    `).all(wheelDisplayRow.id).map((row) => ({
      orderNumber: row.orderNumber,
      displayName: wheelLabelFromRow(row)
    }))
    : [];
  const wheelEntryCount = wheelDisplayRow
    ? countWheelEntries(db, wheelDisplayRow.id)
    : 0;

  const pendingCredits = userId ? listPendingCredits(db, userId) : [];
  const hasPendingCredit = pendingCredits.length > 0;
  const openGamesForChoice = GAME_TYPES.filter((key) => isGameTypeOpen(db, key, 0));

  const dice = buildInstantHubGame(db, 'dice', userId, enabled, hasPendingCredit);
  const pick = buildInstantHubGame(db, 'pick', userId, enabled, hasPendingCredit);
  const vault = buildInstantHubGame(db, 'vault', userId, enabled, hasPendingCredit);

  const recentWinners = getRecentPrizeWinners(db, 8);

  let myWheelWin = null;
  if (userId && wheelDisplayRow && (wheelPlayRow?.status === 'drawn' || wheelDisplayRow.status === 'drawn')) {
    const winRow = db.prepare(`
      SELECT w.display_name AS displayName, w.order_number AS orderNumber,
             p.label AS prizeLabel, p.prize_type AS prizeType, p.prize_value AS prizeValue
      FROM game_wheel_winners w
      JOIN game_wheel_prizes p ON p.id = w.prize_id
      WHERE w.campaign_id = ? AND w.user_id = ?
      ORDER BY w.id ASC LIMIT 1
    `).get(wheelDisplayRow.id, userId);
    if (winRow) {
      myWheelWin = {
        displayName: winRow.displayName,
        orderNumber: winRow.orderNumber,
        prizeLabel: winRow.prizeLabel,
        prizeType: winRow.prizeType,
        fulfillment: { type: winRow.prizeType, label: winRow.prizeLabel, message: `You won ${winRow.prizeLabel}!` }
      };
    }
  }

  return {
    gamesEnabled: enabled,
    channelUrl,
    authenticated: !!userId,
    previewExamples: true,
    eligibility: buildEligibilityHub(db),
    pendingCredits,
    hasPendingCredit,
    openGamesForChoice,
    recentWinners,
    wheel: wheelDisplayRow ? {
      id: wheelDisplayRow.id,
      title: wheelDisplayRow.title,
      listed: hubListed,
      open: wheelOpen,
      campaignOn: wheelCampaignOn,
      closeReason: wheelDiagnosis.closeReason,
      availableDaysLabel: wheelDiagnosis.availableDaysLabel || formatAvailableDays(wheelDisplayRow.available_days),
      visible: hubListed,
      status: wheelDiagnosis.closeReason === 'full' ? 'full' : wheelDisplayRow.status,
      drawAt: wheelDisplayRow.draw_at,
      maxEntries: wheelDisplayRow.max_entries != null ? Number(wheelDisplayRow.max_entries) : null,
      entriesRemaining: wheelDisplayRow.max_entries != null
        ? Math.max(0, Number(wheelDisplayRow.max_entries) - wheelEntryCount)
        : null,
      drawnAt: wheelDisplayRow.drawn_at,
      startsAt: wheelDiagnosis.startsAt || wheelDisplayRow.starts_at,
      endsAt: wheelDiagnosis.endsAt || wheelDisplayRow.ends_at,
      minOrderTotal: wheelDisplayRow.min_order_total,
      prizes: wheelPrizes,
      entryCount: wheelEntryCount,
      entries: wheelEntries,
      winner: wheelWinner,
      winners: wheelWinners,
      mySlots: wheelSlots,
      myWin: myWheelWin,
      canPlay: wheelOpen && wheelSlots.length > 0,
      needsPurchase: wheelOpen && !wheelSlots.length && !hasPendingCredit
    } : {
      listed: hubListed,
      open: false,
      closeReason: wheelDiagnosis.closeReason || 'no_campaign',
      visible: hubListed,
      title: 'Spin the Wheel',
      prizes: [],
      needsPurchase: false,
      canPlay: false
    },
    scratch: scratchRow ? {
      id: scratchRow.id,
      title: scratchRow.title,
      listed: hubListed,
      open: scratchOpen,
      campaignOn: !!(enabled && scratchRow.is_enabled),
      visible: hubListed,
      endsAt: scratchRow.ends_at,
      startsAt: scratchRow.starts_at,
      minOrderTotal: scratchRow.min_order_total,
      prizes: scratchPrizes,
      cards: scratchCards,
      pending: scratchCards.filter((c) => !c.scratchedAt),
      canPlay: scratchOpen && scratchCards.some((c) => !c.scratchedAt),
      needsPurchase: scratchOpen && !scratchCards.length && !hasPendingCredit
    } : { listed: hubListed, open: false, visible: hubListed, title: 'Scratch Cards', prizes: [], needsPurchase: false, canPlay: false },
    mystery: mysteryRow ? {
      id: mysteryRow.id,
      title: mysteryRow.title,
      listed: hubListed,
      open: mysteryOpen,
      campaignOn: !!(enabled && mysteryRow.is_enabled),
      visible: hubListed,
      endsAt: mysteryRow.ends_at,
      startsAt: mysteryRow.starts_at,
      minOrderTotal: mysteryRow.min_order_total,
      prizes: mysteryPrizes,
      plays: mysteryPlays,
      pending: mysteryPlays.filter((p) => !p.playedAt),
      canPlay: mysteryOpen && mysteryPlays.some((p) => !p.playedAt),
      needsPurchase: mysteryOpen && !mysteryPlays.length && !hasPendingCredit
    } : { listed: hubListed, open: false, visible: hubListed, title: 'Mystery Box', prizes: [], needsPurchase: false, canPlay: false },
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

function buildInstantHubGame(db, gameKey, userId, enabled, hasPendingCredit = false) {
  const hubListed = true;
  const pool = db.prepare('SELECT * FROM game_instant_pools WHERE game_key = ?').get(gameKey);
  const fallbackTitle = INSTANT_DEFAULTS[gameKey] || 'Instant Game';
  if (!pool) {
    return {
      gameKey,
      listed: hubListed,
      open: false,
      visible: hubListed,
      title: fallbackTitle,
      prizes: [],
      needsPurchase: false,
      canPlay: false
    };
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
    listed: hubListed,
    open,
    campaignOn: !!(enabled && pool.is_enabled),
    visible: hubListed,
    endsAt: pool.ends_at,
    startsAt: pool.starts_at,
    minOrderTotal: pool.min_order_total,
    prizes,
    plays,
    pending: plays.filter((p) => !p.playedAt),
    canPlay: open && plays.some((p) => !p.playedAt),
    needsPurchase: open && !plays.length && !hasPendingCredit
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
  const row = pickEnabledScheduledWheel(db);
  if (!row) return null;
  return diagnoseWheelPlayState(row, db, true, now).open ? row : null;
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

/** Buyer identity for wheel slots — order email wins over stale session user_id. */
function resolveOrderBuyer(db, order) {
  const email = String(order?.email || '').trim().toLowerCase();
  if (!email) {
    return { userId: order?.user_id ? Number(order.user_id) : null, email: '' };
  }
  const byEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
  if (byEmail?.id) return { userId: byEmail.id, email };
  if (order?.user_id) {
    const linked = db.prepare('SELECT id, email FROM users WHERE id = ?').get(order.user_id);
    if (linked && String(linked.email || '').trim().toLowerCase() === email) {
      return { userId: linked.id, email };
    }
  }
  return { userId: order?.user_id ? Number(order.user_id) : null, email };
}

function displayNameForUser(db, userId, email) {
  const user = userId
    ? db.prepare('SELECT name, email, username FROM users WHERE id = ?').get(userId)
    : null;
  const name = String(user?.name || '').trim();
  if (name) return name;
  const em = String(user?.email || email || '').trim();
  if (em.includes('@')) return em.split('@')[0];
  return `Buyer #${userId || '?'}`;
}

function wheelLabelForUser(db, userId, email) {
  const user = userId
    ? db.prepare('SELECT name, email, username FROM users WHERE id = ?').get(userId)
    : null;
  const username = String(user?.username || '').trim().replace(/^@/, '');
  if (username) return username.slice(0, 14);
  const name = String(user?.name || '').trim();
  if (name) {
    const first = name.split(/\s+/).find(Boolean);
    if (first) return first.slice(0, 14);
  }
  const em = String(user?.email || email || '').trim();
  if (em.includes('@')) return em.split('@')[0].slice(0, 14);
  return 'Player';
}

/** Wheel label from the order buyer (email on receipt), not the logged-in account username. */
function wheelLabelForOrder(db, order) {
  const email = String(order?.email || '').trim().toLowerCase();
  if (email.includes('@')) {
    const local = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '');
    if (local) return local.slice(0, 14);
  }
  const buyer = resolveOrderBuyer(db, order);
  return wheelLabelForUser(db, buyer.userId, email);
}

function wheelLabelFromRow(row) {
  const stored = String(row?.displayName || '').trim();
  if (stored) {
    const first = stored.split(/\s+/).find(Boolean);
    if (first) return first.slice(0, 14);
  }
  const orderEmail = String(row?.orderEmail || '').trim().toLowerCase();
  if (orderEmail.includes('@')) {
    const local = orderEmail.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '');
    if (local) return local.slice(0, 14);
  }
  const username = String(row?.username || '').trim().replace(/^@/, '');
  if (username) return username.slice(0, 14);
  const name = String(row?.userName || row?.name || '').trim();
  if (name) {
    const first = name.split(/\s+/).find(Boolean);
    if (first) return first.slice(0, 14);
  }
  const em = String(row?.email || '').trim();
  if (em.includes('@')) return em.split('@')[0].slice(0, 14);
  return 'Player';
}

function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

/** Minimum collective loser weight vs winner weight (~80% lose when pool is balanced). */
const HOUSE_LOSER_RATIO = 4;

function isLoserPrizeType(prizeType) {
  const t = String(prizeType || 'none');
  return t === 'none' || t === 'bomb';
}

function isLoserPrize(prize) {
  return isLoserPrizeType(prize?.prize_type);
}

function defaultPrizeWeight(prizeType) {
  return isLoserPrizeType(prizeType) ? 25 : 3;
}

function pickWeightedPrize(prizes) {
  const available = (prizes || []).filter((p) => {
    const qty = Number(p.quantity);
    const won = Number(p.won_count || 0);
    return qty < 0 || won < qty;
  });
  if (!available.length) return null;

  const entries = available.map((p) => ({
    prize: p,
    weight: Math.max(1, Number(p.weight) || defaultPrizeWeight(p.prize_type))
  }));

  let winWeight = 0;
  let loseWeight = 0;
  for (const e of entries) {
    if (isLoserPrize(e.prize)) loseWeight += e.weight;
    else winWeight += e.weight;
  }

  const minLoseWeight = Math.max(loseWeight, winWeight * HOUSE_LOSER_RATIO);
  const extraLose = minLoseWeight - loseWeight;

  if (extraLose > 0) {
    if (loseWeight > 0) {
      const boost = minLoseWeight / loseWeight;
      for (const e of entries) {
        if (isLoserPrize(e.prize)) e.weight *= boost;
      }
    } else {
      entries.push({
        prize: { prize_type: 'none', label: 'Better luck next time!', __virtual: true },
        weight: extraLose
      });
    }
  }

  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.prize;
  }
  return entries[entries.length - 1].prize;
}

function ensureLoserPrizeForPool(db, { prizeTable, poolColumn, poolId, extra }) {
  const hasLoser = db.prepare(`
    SELECT id FROM ${prizeTable}
    WHERE ${poolColumn} = ? AND prize_type IN ('none', 'bomb')
    LIMIT 1
  `).get(poolId);
  if (hasLoser) return;

  const cols = extra?.tileStyle != null
    ? `(pool_id, label, prize_type, prize_value, weight, quantity, tile_style)`
    : `(pool_id, label, prize_type, prize_value, weight, quantity)`;
  const vals = extra?.tileStyle != null
    ? `(?, 'Better luck next time!', 'none', '', 30, -1, 'gray')`
    : `(?, 'Better luck next time!', 'none', '', 30, -1)`;

  db.prepare(`INSERT INTO ${prizeTable} ${cols} VALUES ${vals}`).run(poolId);
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

const GAME_TYPES = ['wheel', 'scratch', 'mystery', 'dice', 'pick', 'vault'];

function getOrderCredit(db, orderId) {
  return db.prepare('SELECT * FROM game_order_credits WHERE order_id = ?').get(orderId) || null;
}

function listPendingCredits(db, userId) {
  return db.prepare(`
    SELECT id, order_id AS orderId, order_number AS orderNumber, created_at AS createdAt
    FROM game_order_credits
    WHERE user_id = ? AND chosen_game IS NULL
    ORDER BY id ASC
  `).all(userId);
}

function orderAllowsGamePlay(db, orderId, gameType) {
  const credit = getOrderCredit(db, orderId);
  if (!credit) return true;
  if (!credit.chosen_game) return false;
  return credit.chosen_game === gameType;
}

function playDeniedMessage(db, orderId) {
  const credit = getOrderCredit(db, orderId);
  if (credit && !credit.chosen_game) {
    return 'Pick ONE game for this order in the Games hub before playing.';
  }
  if (credit && credit.chosen_game) {
    const labels = {
      wheel: 'Spin the Wheel',
      scratch: 'Scratch Cards',
      mystery: 'Mystery Box',
      dice: 'Lucky Dice',
      pick: 'Card Flip',
      vault: 'Treasure Vault'
    };
    return `This order is locked to ${labels[credit.chosen_game] || credit.chosen_game} only.`;
  }
  return eligibilityMessage(db);
}

function readGameEnabledState(db) {
  const wheelOn = !!db.prepare(`
    SELECT 1 FROM game_wheel_campaigns
    WHERE is_enabled = 1 AND status = 'scheduled'
    LIMIT 1
  `).get();
  const scratchRow = db.prepare('SELECT is_enabled FROM game_scratch_pools ORDER BY id DESC LIMIT 1').get();
  const mysteryRow = db.prepare('SELECT is_enabled FROM game_mystery_pools ORDER BY id DESC LIMIT 1').get();
  const state = {
    wheel: wheelOn,
    scratch: !!scratchRow?.is_enabled,
    mystery: !!mysteryRow?.is_enabled
  };
  for (const key of ['dice', 'pick', 'vault']) {
    const row = db.prepare('SELECT is_enabled FROM game_instant_pools WHERE game_key = ?').get(key);
    state[key] = !!row?.is_enabled;
  }
  return state;
}

function applyGameEnabledState(db, patch = {}) {
  const enablingAny = ['wheel', 'scratch', 'mystery', 'dice', 'pick', 'vault'].some((k) => patch[k] === true);
  if (enablingAny) ensureGamesMasterEnabled(db);

  if (patch.wheel != null) {
    if (patch.wheel) {
      db.prepare('UPDATE game_wheel_campaigns SET is_enabled = 0').run();
      db.prepare(`
        UPDATE game_wheel_campaigns SET is_enabled = 1
        WHERE id = (
          SELECT id FROM game_wheel_campaigns
          WHERE status = 'scheduled'
          ORDER BY id DESC
          LIMIT 1
        )
      `).run();
    } else {
      db.prepare('UPDATE game_wheel_campaigns SET is_enabled = 0').run();
    }
  }
  if (patch.scratch != null) {
    if (patch.scratch) {
      db.prepare(`
        UPDATE game_scratch_pools SET is_enabled = 1
        WHERE id = (SELECT id FROM game_scratch_pools ORDER BY id DESC LIMIT 1)
      `).run();
    } else {
      db.prepare('UPDATE game_scratch_pools SET is_enabled = 0').run();
    }
  }
  if (patch.mystery != null) {
    if (patch.mystery) {
      db.prepare(`
        UPDATE game_mystery_pools SET is_enabled = 1
        WHERE id = (SELECT id FROM game_mystery_pools ORDER BY id DESC LIMIT 1)
      `).run();
    } else {
      db.prepare('UPDATE game_mystery_pools SET is_enabled = 0').run();
    }
  }
  for (const key of ['dice', 'pick', 'vault']) {
    if (patch[key] != null) {
      db.prepare('UPDATE game_instant_pools SET is_enabled = ? WHERE game_key = ?').run(patch[key] ? 1 : 0, key);
    }
  }
}

function disableAllGamePools(db) {
  db.prepare('UPDATE game_wheel_campaigns SET is_enabled = 0').run();
  db.prepare('UPDATE game_scratch_pools SET is_enabled = 0').run();
  db.prepare('UPDATE game_mystery_pools SET is_enabled = 0').run();
  db.prepare('UPDATE game_instant_pools SET is_enabled = 0').run();
}

function isGameTypeOpen(db, gameType, orderTotal = 0) {
  const enabled = isGamesEnabled(db);
  const now = new Date();
  const total = Number(orderTotal) || 0;
  if (gameType === 'wheel') {
    const wheel = activeWheelCampaign(db, now);
    return enabled && isWheelCampaignOpen(wheel, now, db) && total >= Number(wheel?.min_order_total || 0);
  }
  if (gameType === 'scratch') {
    const pool = activeScratchPool(db);
    return isScratchPoolOpen(pool, enabled, now) && total >= Number(pool?.min_order_total || 0);
  }
  if (gameType === 'mystery') {
    const pool = activeMysteryPool(db);
    return isMysteryPoolOpen(pool, enabled, now) && total >= Number(pool?.min_order_total || 0);
  }
  const pool = activeInstantPool(db, gameType);
  return pool && isInstantPoolOpen(pool, enabled, now) && total >= Number(pool.min_order_total || 0);
}

function isGrandDrawWheel(campaign) {
  const max = Number(campaign?.max_entries);
  return max > 0;
}

function insertWheelSlot(db, deps, { wheel, order, userId, notify }) {
  const orderId = order.id;
  const orderNumber = String(order.order_number || order.id);
  const buyer = resolveOrderBuyer(db, order);
  const slotUserId = buyer.userId || userId;
  const displayName = wheelLabelForOrder(db, order);

  db.prepare(`
    INSERT INTO game_wheel_slots (campaign_id, user_id, order_id, order_number, display_name, entry_units)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(wheel.id, slotUserId, orderId, orderNumber, displayName);

  const title = notify?.title || 'Grand draw entry!';
  const body = notify?.body || `Order #${orderNumber} joined the wheel. Good luck!`;
  deps?.notify?.(slotUserId, 'promo', title, body);
  return 1;
}

function maybeAutoJoinGrandDrawWheelOnApproval(db, deps, order) {
  if (!isGamesEnabled(db) || !order?.id) return { joined: false };
  if (String(order.status || '').toLowerCase() !== 'approved') return { joined: false };

  const wheel = pickEnabledScheduledWheel(db);
  if (!wheel || !isGrandDrawWheel(wheel) || !wheel.is_enabled) return { joined: false };

  const total = Number(order.total) || 0;
  if (total < Number(wheel.min_order_total || 0)) return { joined: false };
  if (!orderQualifiesForGrandDraw(db, order.id)) return { joined: false };
  if (isWheelFull(db, wheel)) return { joined: false };

  const exists = db.prepare('SELECT id FROM game_wheel_slots WHERE order_id = ?').get(order.id);
  if (exists) return { joined: false };

  const userId = resolveOrderBuyer(db, order).userId || resolveUserId(db, { userId: order.user_id, email: order.email });
  if (!userId) return { joined: false, reason: 'no_user' };

  insertWheelSlot(db, deps, { wheel, order, userId });
  maybeAutoDrawWheel(db, deps, wheel.id);
  return { joined: true, entryUnits: 1, wheelId: wheel.id };
}

function syncGrandDrawEntriesForApprovedOrders(db, deps, limit = 200) {
  if (!isGamesEnabled(db)) return { synced: 0 };
  const wheel = pickEnabledScheduledWheel(db);
  if (!wheel || !isGrandDrawWheel(wheel)) return { synced: 0 };

  const orders = db.prepare(`
    SELECT o.* FROM orders o
    WHERE o.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM game_wheel_slots s WHERE s.order_id = o.id)
    ORDER BY o.id ASC
    LIMIT ?
  `).all(Math.max(1, Number(limit) || 200));

  let synced = 0;
  for (const order of orders) {
    try {
      const result = maybeAutoJoinGrandDrawWheelOnApproval(db, deps, order);
      if (result.joined) synced += 1;
    } catch (err) {
      console.error('[games] grand draw backfill failed', order.id, err.message);
    }
  }
  return { synced };
}

/** Fix wheel names from order email when account username was shown instead of buyer. */
function repairWheelSlotDisplayNames(db) {
  const rows = db.prepare(`
    SELECT s.id AS slotId, s.display_name AS slotName, s.user_id AS slotUserId,
           o.email AS orderEmail, o.user_id AS orderUserId
    FROM game_wheel_slots s
    INNER JOIN orders o ON o.id = s.order_id
  `).all();
  const updateSlot = db.prepare('UPDATE game_wheel_slots SET display_name = ?, user_id = ? WHERE id = ?');
  const updateWinner = db.prepare(`
    UPDATE game_wheel_winners SET display_name = ?, user_id = ?
    WHERE slot_id = ?
  `);
  let fixed = 0;
  for (const row of rows) {
    const order = { email: row.orderEmail, user_id: row.orderUserId };
    const buyer = resolveOrderBuyer(db, order);
    const label = wheelLabelForOrder(db, order);
    const nextUserId = buyer.userId || row.slotUserId;
    if (label !== row.slotName || nextUserId !== row.slotUserId) {
      updateSlot.run(label, nextUserId, row.slotId);
      updateWinner.run(label, nextUserId, row.slotId);
      fixed += 1;
    }
  }
  return fixed;
}

function grantSingleGameForOrder(db, deps, order, gameType) {
  const userId = resolveUserId(db, { userId: order.user_id, email: order.email });
  if (!userId) return;
  const orderId = order.id;
  const orderNumber = String(order.order_number || order.id);
  const displayName = displayNameForUser(db, userId, order.email);
  const total = Number(order.total) || 0;

  if (gameType === 'wheel') {
    const wheel = activeWheelCampaign(db);
    if (!wheel || total < Number(wheel.min_order_total || 0)) return;
    if (isWheelFull(db, wheel)) return;
    const exists = db.prepare('SELECT id FROM game_wheel_slots WHERE order_id = ?').get(orderId);
    if (exists) return;
    insertWheelSlot(db, deps, {
      wheel,
      order,
      userId,
      notify: {
        title: 'Spin the Wheel entry!',
        body: `Order #${orderNumber} — you chose the wheel. Good luck!`
      }
    });
    return;
  }

  if (gameType === 'scratch') {
    const scratch = activeScratchPool(db);
    if (!scratch || total < Number(scratch.min_order_total || 0)) return;
    const exists = db.prepare('SELECT id FROM game_scratch_cards WHERE order_id = ?').get(orderId);
    if (exists) return;
    db.prepare(`
      INSERT INTO game_scratch_cards (pool_id, user_id, order_id, order_number, token)
      VALUES (?, ?, ?, ?, ?)
    `).run(scratch.id, userId, orderId, orderNumber, genToken());
    deps?.notify?.(userId, 'promo', 'Scratch card ready!', `Order #${orderNumber} — scratch your card in Games.`);
    return;
  }

  if (gameType === 'mystery') {
    const mystery = activeMysteryPool(db);
    if (!mystery || total < Number(mystery.min_order_total || 0)) return;
    const exists = db.prepare('SELECT id FROM game_mystery_plays WHERE order_id = ?').get(orderId);
    if (exists) return;
    db.prepare(`
      INSERT INTO game_mystery_plays (pool_id, user_id, order_id, order_number)
      VALUES (?, ?, ?, ?)
    `).run(mystery.id, userId, orderId, orderNumber);
    deps?.notify?.(userId, 'promo', 'Mystery box ready!', `Order #${orderNumber} — pick a box in Games.`);
    return;
  }

  const pool = activeInstantPool(db, gameType);
  if (!pool || total < Number(pool.min_order_total || 0)) return;
  const exists = db.prepare('SELECT id FROM game_instant_plays WHERE order_id = ? AND pool_id = ?').get(orderId, pool.id);
  if (exists) return;
  db.prepare(`
    INSERT INTO game_instant_plays (pool_id, user_id, order_id, order_number)
    VALUES (?, ?, ?, ?)
  `).run(pool.id, userId, orderId, orderNumber);
  const label = INSTANT_DEFAULTS[gameType] || 'Game';
  deps?.notify?.(userId, 'promo', `${label} unlocked!`, `Order #${orderNumber} — play in Games.`);
}

function chooseGameForCredit(db, deps, { creditId, userId, gameType }) {
  if (!GAME_TYPES.includes(gameType)) return { error: 'Invalid game type' };

  const credit = db.prepare('SELECT * FROM game_order_credits WHERE id = ? AND user_id = ?').get(creditId, userId);
  if (!credit) return { error: 'Game credit not found' };
  if (credit.chosen_game) return { error: 'You already chose a game for this order' };
  if (!orderQualifiesForGames(db, credit.order_id)) return { error: eligibilityMessage(db) };

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(credit.order_id);
  if (!order) return { error: 'Order not found' };
  if (!isGameTypeOpen(db, gameType, order.total)) return { error: 'This game is not open right now' };

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN');
    const updated = db.prepare(`
      UPDATE game_order_credits SET chosen_game = ?, chosen_at = ? WHERE id = ? AND chosen_game IS NULL
    `).run(gameType, now, creditId);
    if (!updated.changes) {
      db.exec('ROLLBACK');
      return { error: 'Game already chosen for this order' };
    }
    grantSingleGameForOrder(db, deps, order, gameType);
    db.exec('COMMIT');
    if (gameType === 'wheel') {
      const wheel = db.prepare(`
        SELECT * FROM game_wheel_campaigns WHERE id = (
          SELECT campaign_id FROM game_wheel_slots WHERE order_id = ? LIMIT 1
        )
      `).get(order.id);
      if (wheel) maybeAutoDrawWheel(db, deps, wheel.id);
    }
    return { ok: true, gameType, orderNumber: credit.order_number };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    return { error: err.message || 'Could not lock game choice' };
  }
}

function maybeAutoDrawWheel(db, deps, campaignId) {
  const campaign = db.prepare('SELECT * FROM game_wheel_campaigns WHERE id = ?').get(campaignId);
  if (!campaign || campaign.status !== 'scheduled' || !campaign.is_enabled) return null;
  const max = Number(campaign.max_entries);
  if (!max || max < 1) return null;
  const count = countWheelEntries(db, campaignId);
  if (count < max) return null;
  return runWheelDraw(db, deps, campaignId);
}

function processFullWheelDraws(db, deps) {
  const full = db.prepare(`
    SELECT c.* FROM game_wheel_campaigns c
    WHERE c.is_enabled = 1 AND c.status = 'scheduled'
      AND c.max_entries IS NOT NULL AND c.max_entries > 0
      AND (
        SELECT COUNT(*) FROM game_wheel_slots s WHERE s.campaign_id = c.id
      ) >= c.max_entries
  `).all();
  for (const c of full) {
    try {
      runWheelDraw(db, deps, c.id);
    } catch (err) {
      console.error('[games] wheel auto-draw failed', c.id, err.message);
    }
  }
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

  const orderId = order.id;
  const orderNumber = String(order.order_number || order.id);
  const exists = db.prepare('SELECT id FROM game_order_credits WHERE order_id = ?').get(orderId);
  if (exists) return;

  db.prepare(`
    INSERT INTO game_order_credits (order_id, user_id, order_number, created_at)
    VALUES (?, ?, ?, ?)
  `).run(orderId, userId, orderNumber, new Date().toISOString());

  deps?.notify?.(
    userId,
    'promo',
    'Choose your game!',
    `Order #${orderNumber} is delivered — pick ONE game in the Games hub.`
  );
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
  processFullWheelDraws(db, deps);
}

function scratchCard(db, deps, { cardId, userId }) {
  const card = db.prepare('SELECT * FROM game_scratch_cards WHERE id = ? AND user_id = ?').get(cardId, userId);
  if (!card) return { error: 'Card not found' };
  if (card.scratched_at) return { error: 'Already scratched' };
  if (!orderAllowsGamePlay(db, card.order_id, 'scratch')) {
    return { error: playDeniedMessage(db, card.order_id) };
  }

  const prizes = db.prepare('SELECT * FROM game_scratch_prizes WHERE pool_id = ?').all(card.pool_id);
  const prize = pickWeightedPrize(prizes);
  const now = new Date().toISOString();
  const isVirtual = prize?.__virtual;
  const prizeId = prize?.id && !isVirtual ? prize.id : null;

  db.prepare(`
    UPDATE game_scratch_cards SET prize_id = ?, scratched_at = ? WHERE id = ? AND scratched_at IS NULL
  `).run(prizeId, now, card.id);

  let fulfilled = { fulfillment: { type: 'none' } };
  if (prize) {
    if (prizeId) db.prepare('UPDATE game_scratch_prizes SET won_count = won_count + 1 WHERE id = ?').run(prizeId);
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
  if (!orderAllowsGamePlay(db, play.order_id, 'mystery')) {
    return { error: playDeniedMessage(db, play.order_id) };
  }

  const prizes = db.prepare('SELECT * FROM game_mystery_prizes WHERE pool_id = ?').all(play.pool_id);
  const prize = pickWeightedPrize(prizes);
  const now = new Date().toISOString();
  const pickedBox = Math.max(0, Math.min(2, Number(boxIndex) || 0));
  const isVirtual = prize?.__virtual;
  const prizeId = prize?.id && !isVirtual ? prize.id : null;
  const isRealWin = prize && !isLoserPrize(prize);

  db.prepare(`
    UPDATE game_mystery_plays SET prize_id = ?, played_at = ? WHERE id = ? AND played_at IS NULL
  `).run(prizeId, now, play.id);

  let fulfilled = { fulfillment: { type: 'none' } };
  if (prize) {
    if (prizeId) db.prepare('UPDATE game_mystery_prizes SET won_count = won_count + 1 WHERE id = ?').run(prizeId);
    fulfilled = fulfillPrize(db, deps, { userId, prize, orderRef: play.order_number, source: 'mystery' });
  }

  const decoys = ['Empty box', 'Try again', 'No luck'];
  const boxes = [0, 1, 2].map((i) => {
    if (i === pickedBox) {
      return {
        label: prize?.label || 'No prize',
        prizeType: prize?.prize_type || 'none',
        winner: isRealWin
      };
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
  if (!orderAllowsGamePlay(db, play.order_id, play.gameKey)) {
    return { error: playDeniedMessage(db, play.order_id) };
  }

  const prizes = db.prepare('SELECT * FROM game_instant_prizes WHERE pool_id = ?').all(play.pool_id);
  const prize = pickWeightedPrize(prizes);
  const now = new Date().toISOString();
  const isVirtual = prize?.__virtual;
  const prizeId = prize?.id && !isVirtual ? prize.id : null;
  const isRealWin = prize && !isLoserPrize(prize);
  let result = { choice: Number(choice) || 0 };

  if (play.gameKey === 'dice') {
    let d1;
    let d2;
    if (isRealWin) {
      d1 = 5 + Math.floor(Math.random() * 2);
      d2 = 5 + Math.floor(Math.random() * 2);
    } else {
      d1 = Math.floor(Math.random() * 4) + 1;
      d2 = Math.floor(Math.random() * 4) + 1;
    }
    result = { dice: [d1, d2], sum: d1 + d2, choice: Number(choice) || 0 };
  } else if (play.gameKey === 'pick') {
    const idx = Math.max(0, Math.min(2, Number(choice) || 0));
    const suits = ['♠ Ace', '♥ King', '♦ Queen'];
    result = {
      pickedCard: idx,
      cards: [0, 1, 2].map((i) => ({
        index: i,
        label: i === idx ? (prize?.label || 'No prize') : suits[i % suits.length],
        winner: i === idx && isRealWin
      }))
    };
  } else if (play.gameKey === 'vault') {
    const idx = Math.max(0, Math.min(2, Number(choice) || 0));
    result = {
      pickedVault: idx,
      vaults: [0, 1, 2].map((i) => ({
        index: i,
        label: i === idx ? (prize?.label || 'Empty vault') : ['Bronze', 'Silver', 'Gold'][i],
        winner: i === idx && isRealWin
      }))
    };
  }

  db.prepare(`
    UPDATE game_instant_plays SET prize_id = ?, played_at = ?, result_json = ? WHERE id = ? AND played_at IS NULL
  `).run(prizeId, now, JSON.stringify(result), play.id);

  let fulfilled = { fulfillment: { type: 'none' } };
  if (prize) {
    if (prizeId) db.prepare('UPDATE game_instant_prizes SET won_count = won_count + 1 WHERE id = ?').run(prizeId);
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
  HOUSE_LOSER_RATIO,
  parseDays,
  isGamesEnabled,
  isLoserPrizeType,
  isLoserPrize,
  defaultPrizeWeight,
  pickWeightedPrize,
  ensureLoserPrizeForPool,
  buildGamesHubState,
  activeWheelCampaign,
  grantGamesForApprovedOrder,
  tryGrantGamesForDeliveredOrder,
  chooseGameForCredit,
  maybeAutoJoinGrandDrawWheelOnApproval,
  syncGrandDrawEntriesForApprovedOrders,
  listPendingCredits,
  orderAllowsGamePlay,
  playDeniedMessage,
  GAME_TYPES,
  runWheelDraw,
  processDueWheelDraws,
  processFullWheelDraws,
  maybeAutoDrawWheel,
  countWheelEntries,
  isWheelFull,
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
  displayNameForUser,
  wheelLabelForUser,
  wheelLabelForOrder,
  wheelLabelFromRow,
  resolveOrderBuyer,
  repairWheelSlotDisplayNames,
  diagnoseWheelPlayState,
  pickEnabledScheduledWheel,
  formatAvailableDays,
  readGameEnabledState,
  applyGameEnabledState,
  ensureGamesMasterEnabled,
  disableAllGamePools,
  isGameTypeOpen
};
