'use strict';

const {
  grantGamesForApprovedOrder,
  runWheelDraw,
  processDueWheelDraws,
  scratchCard,
  playMysteryBox,
  playInstantGame,
  chooseGameForCredit,
  orderAllowsGamePlay,
  playDeniedMessage,
  parseDays,
  buildGamesHubState,
  readGameEnabledState,
  applyGameEnabledState,
  ensureGamesMasterEnabled,
  disableAllGamePools,
  ensureLoserPrizeForPool,
  defaultPrizeWeight,
  isLoserPrizeType
} = require('./games-engine');
const { sendHtmlPage } = require('./send-html-page');
const { RIETTE_GAME_ROUTES } = require('./games-paths');
const {
  buildEligibilityHub,
  saveGamesRules,
  orderQualifiesForGames,
  eligibilityMessage
} = require('./games-eligibility');

function gamesDeniedError(db) {
  return eligibilityMessage(db);
}

function mapWheelCampaign(row, db) {
  if (!row) return null;
  const prizes = db.prepare('SELECT * FROM game_wheel_prizes WHERE campaign_id = ? ORDER BY sort_order, id').all(row.id);
  const slots = db.prepare(`
    SELECT id, display_name AS displayName, order_number AS orderNumber, created_at AS createdAt
    FROM game_wheel_slots WHERE campaign_id = ? ORDER BY id ASC
  `).all(row.id);
  let winner = null;
  let winners = [];
  if (row.status === 'drawn') {
    winners = db.prepare(`
      SELECT w.display_name AS displayName, w.order_number AS orderNumber,
             p.label AS prizeLabel, p.prize_type AS prizeType
      FROM game_wheel_winners w
      JOIN game_wheel_prizes p ON p.id = w.prize_id
      WHERE w.campaign_id = ?
      ORDER BY w.id ASC
    `).all(row.id);
    if (winners.length) winner = winners[0];
  }
  if (!winner && row.winner_slot_id) {
    winner = db.prepare(`
      SELECT display_name AS displayName, order_number AS orderNumber FROM game_wheel_slots WHERE id = ?
    `).get(row.winner_slot_id);
  }
  return {
    id: row.id,
    title: row.title,
    isEnabled: !!row.is_enabled,
    availableDays: parseDays(row.available_days),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    drawAt: row.draw_at,
    maxEntries: row.max_entries != null ? Number(row.max_entries) : null,
    minOrderTotal: row.min_order_total,
    status: row.status,
    drawnAt: row.drawn_at,
    winner,
    winners,
    prizes: prizes.map((p) => ({
      id: p.id,
      label: p.label,
      prizeType: p.prize_type,
      prizeValue: p.prize_value,
      sortOrder: p.sort_order,
      quantity: Number(p.quantity) || 1,
      wonCount: Number(p.won_count || 0)
    })),
    slots,
    entryCount: slots.length
  };
}

function mountGamesService(app, db, deps) {
  const { requireAdmin, requireAuth, createUserNotification, frontendDir, trackVisit } = deps;
  const engineDeps = {
    notify: (userId, type, title, body) => {
      try { createUserNotification?.(userId, type, title, body); } catch (_) { /* ignore */ }
    }
  };

  setInterval(() => processDueWheelDraws(db, engineDeps), 30 * 1000);

  app.get('/games', (req, res) => {
    trackVisit?.(req);
    sendHtmlPage(res, frontendDir, 'games.html');
  });

  RIETTE_GAME_ROUTES.forEach((route) => {
    app.get(route, (req, res) => {
      trackVisit?.(req);
      sendHtmlPage(res, frontendDir, 'games.html');
    });
  });

  app.get('/api/games', (req, res) => {
    const userId = req.session?.userId || null;
    res.json(buildGamesHubState(db, userId));
  });

  // ── Buyer (legacy dashboard API) ──
  app.get('/account/games', requireAuth, (req, res) => {
    res.json(buildGamesHubState(db, req.session.userId));
  });

  app.post('/account/games/credits/:id/choose', requireAuth, (req, res) => {
    const gameType = String(req.body?.gameType || '').trim();
    const result = chooseGameForCredit(db, engineDeps, {
      creditId: Number(req.params.id),
      userId: req.session.userId,
      gameType
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/account/games/scratch/:id/play', requireAuth, (req, res) => {
    const owned = db.prepare('SELECT id, order_id FROM game_scratch_cards WHERE id = ? AND user_id = ? AND scratched_at IS NULL')
      .get(req.params.id, req.session.userId);
    if (!owned) return res.status(403).json({ error: gamesDeniedError(db) });
    if (!orderQualifiesForGames(db, owned.order_id)) {
      return res.status(403).json({ error: gamesDeniedError(db) });
    }
    if (!orderAllowsGamePlay(db, owned.order_id, 'scratch')) {
      return res.status(403).json({ error: playDeniedMessage(db, owned.order_id) });
    }
    const result = scratchCard(db, engineDeps, { cardId: req.params.id, userId: req.session.userId });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/account/games/mystery/:id/play', requireAuth, (req, res) => {
    const owned = db.prepare('SELECT id, order_id FROM game_mystery_plays WHERE id = ? AND user_id = ? AND played_at IS NULL')
      .get(req.params.id, req.session.userId);
    if (!owned) return res.status(403).json({ error: gamesDeniedError(db) });
    if (!orderQualifiesForGames(db, owned.order_id)) {
      return res.status(403).json({ error: gamesDeniedError(db) });
    }
    if (!orderAllowsGamePlay(db, owned.order_id, 'mystery')) {
      return res.status(403).json({ error: playDeniedMessage(db, owned.order_id) });
    }
    const result = playMysteryBox(db, engineDeps, {
      playId: req.params.id,
      userId: req.session.userId,
      boxIndex: req.body?.boxIndex
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/account/games/instant/:key/:id/play', requireAuth, (req, res) => {
    const owned = db.prepare(`
      SELECT ip.id, ip.order_id FROM game_instant_plays ip
      JOIN game_instant_pools p ON p.id = ip.pool_id
      WHERE ip.id = ? AND ip.user_id = ? AND ip.played_at IS NULL AND p.game_key = ?
    `).get(req.params.id, req.session.userId, req.params.key);
    if (!owned) return res.status(403).json({ error: gamesDeniedError(db) });
    if (!orderQualifiesForGames(db, owned.order_id)) {
      return res.status(403).json({ error: gamesDeniedError(db) });
    }
    if (!orderAllowsGamePlay(db, owned.order_id, req.params.key)) {
      return res.status(403).json({ error: playDeniedMessage(db, owned.order_id) });
    }
    const result = playInstantGame(db, engineDeps, {
      playId: req.params.id,
      userId: req.session.userId,
      gameKey: req.params.key,
      choice: req.body?.choice
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  // ── Admin settings ──
  app.get('/admin/games/settings', requireAdmin, (req, res) => {
    const enabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_enabled');
    const channel = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_channel_url');
    const hub = buildEligibilityHub(db);
    res.json({
      gamesEnabled: (enabled?.value ?? '1') === '1',
      channelUrl: channel?.value || 'https://t.me/loveriette',
      requiredQuantity: hub.requiredQuantity,
      productIds: hub.products.map((p) => p.id),
      products: hub.products,
      telegramHandle: hub.telegramHandle,
      guides: hub.guides,
      shopLinks: hub.shopLinks,
      strictEligibility: hub.strict,
      gameEnabled: readGameEnabledState(db)
    });
  });

  app.put('/admin/games/settings', requireAdmin, (req, res) => {
    const enabled = req.body?.gamesEnabled ? '1' : '0';
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('games_enabled', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(enabled);
    if (req.body?.channelUrl != null) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('games_channel_url', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(req.body.channelUrl).trim());
    }
    saveGamesRules(db, {
      requiredQuantity: req.body?.requiredQuantity,
      productIds: req.body?.productIds,
      telegramHandle: req.body?.telegramHandle,
      guides: req.body?.guides,
      shopLinks: req.body?.shopLinks,
      strictEligibility: req.body?.strictEligibility
    });
    if (req.body?.gameEnabled && typeof req.body.gameEnabled === 'object') {
      applyGameEnabledState(db, req.body.gameEnabled);
    }
    res.json({
      ok: true,
      gamesEnabled: enabled === '1',
      gameEnabled: readGameEnabledState(db)
    });
  });

  // ── Wheel campaigns ──
  app.get('/admin/games/wheel', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT * FROM game_wheel_campaigns ORDER BY id DESC').all();
    res.json(rows.map((r) => mapWheelCampaign(r, db)));
  });

  app.post('/admin/games/wheel', requireAdmin, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const maxEntries = Math.max(1, Number(b.maxEntries) || 0);
    if (!maxEntries) return res.status(400).json({ error: 'Max entries is required (minimum 1)' });
    const days = Array.isArray(b.availableDays) ? b.availableDays.join(',') : String(b.availableDays || '0,1,2,3,4,5,6');
    const placeholderDrawAt = '2099-12-31T00:00:00.000Z';
    const r = db.prepare(`
      INSERT INTO game_wheel_campaigns (title, is_enabled, available_days, starts_at, ends_at, draw_at, min_order_total, max_entries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      b.isEnabled ? 1 : 0,
      days,
      b.startsAt || null,
      b.endsAt || null,
      b.drawAt || placeholderDrawAt,
      Math.max(0, Number(b.minOrderTotal) || 0),
      maxEntries
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/games/wheel/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM game_wheel_campaigns WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const days = b.availableDays != null
      ? (Array.isArray(b.availableDays) ? b.availableDays.join(',') : String(b.availableDays))
      : row.available_days;
    db.prepare(`
      UPDATE game_wheel_campaigns SET
        title = COALESCE(?, title),
        is_enabled = COALESCE(?, is_enabled),
        available_days = ?,
        starts_at = COALESCE(?, starts_at),
        ends_at = COALESCE(?, ends_at),
        draw_at = COALESCE(?, draw_at),
        min_order_total = COALESCE(?, min_order_total),
        max_entries = COALESCE(?, max_entries),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title != null ? String(b.title).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      days,
      b.startsAt,
      b.endsAt,
      b.drawAt,
      b.minOrderTotal != null ? Math.max(0, Number(b.minOrderTotal) || 0) : null,
      b.maxEntries != null ? Math.max(1, Number(b.maxEntries) || 1) : null,
      row.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/wheel/:id/prizes', requireAdmin, (req, res) => {
    const campaign = db.prepare('SELECT id FROM game_wheel_campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Prize label required' });
    const r = db.prepare(`
      INSERT INTO game_wheel_prizes (campaign_id, label, prize_type, prize_value, sort_order, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      label,
      String(b.prizeType || 'custom'),
      String(b.prizeValue || ''),
      Number(b.sortOrder) || 0,
      Math.max(1, Number(b.quantity) || 1)
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/wheel/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_wheel_prizes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/games/wheel/prizes/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM game_wheel_prizes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Prize not found' });
    const b = req.body || {};
    db.prepare(`
      UPDATE game_wheel_prizes SET
        label = COALESCE(?, label),
        prize_type = COALESCE(?, prize_type),
        prize_value = COALESCE(?, prize_value),
        quantity = COALESCE(?, quantity)
      WHERE id = ?
    `).run(
      b.label != null ? String(b.label).trim() : null,
      b.prizeType != null ? String(b.prizeType) : null,
      b.prizeValue != null ? String(b.prizeValue) : null,
      b.quantity != null ? Math.max(1, Number(b.quantity) || 1) : null,
      req.params.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/wheel/:id/activate', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT id FROM game_wheel_campaigns WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    ensureGamesMasterEnabled(db);
    db.prepare('UPDATE game_wheel_campaigns SET is_enabled = 0').run();
    db.prepare(`
      UPDATE game_wheel_campaigns SET is_enabled = 1, starts_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);
    res.json({ ok: true, gamesEnabled: true });
  });

  app.delete('/admin/games/wheel/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT id FROM game_wheel_campaigns WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Campaign not found' });
    db.prepare('DELETE FROM game_wheel_campaigns WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/games/wheel/:id/draw', requireAdmin, (req, res) => {
    const result = runWheelDraw(db, engineDeps, Number(req.params.id));
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  // ── Scratch pools ──
  app.get('/admin/games/scratch', requireAdmin, (req, res) => {
    const pools = db.prepare('SELECT * FROM game_scratch_pools ORDER BY id DESC').all();
    res.json(pools.map((p) => ({
      ...p,
      isEnabled: !!p.is_enabled,
      minOrderTotal: p.min_order_total,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      prizes: db.prepare('SELECT * FROM game_scratch_prizes WHERE pool_id = ? ORDER BY id').all(p.id).map((pr) => ({
        id: pr.id,
        label: pr.label,
        prizeType: pr.prize_type,
        prizeValue: pr.prize_value,
        weight: pr.weight,
        quantity: pr.quantity,
        wonCount: pr.won_count,
        tileStyle: pr.tile_style
      }))
    })));
  });

  app.post('/admin/games/scratch', requireAdmin, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || 'Scratch Cards').trim();
    const r = db.prepare(`
      INSERT INTO game_scratch_pools (title, is_enabled, min_order_total, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      title,
      b.isEnabled ? 1 : 0,
      Math.max(0, Number(b.minOrderTotal) || 0),
      b.startsAt || null,
      b.endsAt || null
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/games/scratch/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE game_scratch_pools SET
        title = COALESCE(?, title),
        is_enabled = COALESCE(?, is_enabled),
        min_order_total = COALESCE(?, min_order_total),
        starts_at = COALESCE(?, starts_at),
        ends_at = COALESCE(?, ends_at),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title != null ? String(b.title).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      b.minOrderTotal != null ? Math.max(0, Number(b.minOrderTotal) || 0) : null,
      b.startsAt,
      b.endsAt,
      req.params.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/scratch/:id/activate', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT id FROM game_scratch_pools WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pool not found' });
    ensureGamesMasterEnabled(db);
    db.prepare('UPDATE game_scratch_pools SET is_enabled = 0').run();
    db.prepare(`
      UPDATE game_scratch_pools SET is_enabled = 1, starts_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);
    res.json({ ok: true, gamesEnabled: true });
  });

  app.delete('/admin/games/scratch/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT id FROM game_scratch_pools WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pool not found' });
    db.prepare('DELETE FROM game_scratch_pools WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/games/scratch/:id/prizes', requireAdmin, (req, res) => {
    const pool = db.prepare('SELECT id FROM game_scratch_pools WHERE id = ?').get(req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Label required' });
    const prizeType = String(b.prizeType || 'none');
    const weight = Math.max(1, Number(b.weight) || defaultPrizeWeight(prizeType));
    const r = db.prepare(`
      INSERT INTO game_scratch_prizes (pool_id, label, prize_type, prize_value, weight, quantity, tile_style)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pool.id,
      label,
      prizeType,
      String(b.prizeValue || ''),
      weight,
      b.quantity != null ? Number(b.quantity) : -1,
      String(b.tileStyle || (isLoserPrizeType(prizeType) ? 'gray' : 'gold'))
    );
    if (!isLoserPrizeType(prizeType)) {
      ensureLoserPrizeForPool(db, { prizeTable: 'game_scratch_prizes', poolColumn: 'pool_id', poolId: pool.id, extra: { tileStyle: true } });
    }
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/scratch/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_scratch_prizes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/games/scratch/prizes/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM game_scratch_prizes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Prize not found' });
    const b = req.body || {};
    const prizeType = b.prizeType != null ? String(b.prizeType) : null;
    db.prepare(`
      UPDATE game_scratch_prizes SET
        label = COALESCE(?, label),
        prize_type = COALESCE(?, prize_type),
        prize_value = COALESCE(?, prize_value),
        weight = COALESCE(?, weight),
        quantity = COALESCE(?, quantity),
        tile_style = COALESCE(?, tile_style)
      WHERE id = ?
    `).run(
      b.label != null ? String(b.label).trim() : null,
      prizeType,
      b.prizeValue != null ? String(b.prizeValue) : null,
      b.weight != null ? Math.max(1, Number(b.weight) || 1) : null,
      b.quantity != null ? Number(b.quantity) : null,
      prizeType && (prizeType === 'none' || prizeType === 'bomb') ? 'gray' : (b.tileStyle || null),
      req.params.id
    );
    res.json({ ok: true });
  });

  // ── Mystery pools ──
  app.get('/admin/games/mystery', requireAdmin, (req, res) => {
    const pools = db.prepare('SELECT * FROM game_mystery_pools ORDER BY id DESC').all();
    res.json(pools.map((p) => ({
      ...p,
      isEnabled: !!p.is_enabled,
      minOrderTotal: p.min_order_total,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      prizes: db.prepare('SELECT * FROM game_mystery_prizes WHERE pool_id = ? ORDER BY id').all(p.id).map((pr) => ({
        id: pr.id,
        label: pr.label,
        prizeType: pr.prize_type,
        prizeValue: pr.prize_value,
        weight: pr.weight,
        quantity: pr.quantity,
        wonCount: pr.won_count
      }))
    })));
  });

  app.post('/admin/games/mystery', requireAdmin, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || 'Mystery Box').trim();
    const r = db.prepare(`
      INSERT INTO game_mystery_pools (title, is_enabled, min_order_total, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      title,
      b.isEnabled ? 1 : 0,
      Math.max(0, Number(b.minOrderTotal) || 0),
      b.startsAt || null,
      b.endsAt || null
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/games/mystery/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE game_mystery_pools SET
        title = COALESCE(?, title),
        is_enabled = COALESCE(?, is_enabled),
        min_order_total = COALESCE(?, min_order_total),
        starts_at = COALESCE(?, starts_at),
        ends_at = COALESCE(?, ends_at),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title != null ? String(b.title).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      b.minOrderTotal != null ? Math.max(0, Number(b.minOrderTotal) || 0) : null,
      b.startsAt,
      b.endsAt,
      req.params.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/mystery/:id/activate', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT id FROM game_mystery_pools WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pool not found' });
    ensureGamesMasterEnabled(db);
    db.prepare('UPDATE game_mystery_pools SET is_enabled = 0').run();
    db.prepare(`
      UPDATE game_mystery_pools SET is_enabled = 1, starts_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);
    res.json({ ok: true, gamesEnabled: true });
  });

  app.delete('/admin/games/mystery/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT id FROM game_mystery_pools WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pool not found' });
    db.prepare('DELETE FROM game_mystery_pools WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/games/mystery/:id/prizes', requireAdmin, (req, res) => {
    const pool = db.prepare('SELECT id FROM game_mystery_pools WHERE id = ?').get(req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Label required' });
    const prizeType = String(b.prizeType || 'none');
    const weight = Math.max(1, Number(b.weight) || defaultPrizeWeight(prizeType));
    const r = db.prepare(`
      INSERT INTO game_mystery_prizes (pool_id, label, prize_type, prize_value, weight, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      pool.id,
      label,
      prizeType,
      String(b.prizeValue || ''),
      weight,
      b.quantity != null ? Number(b.quantity) : -1
    );
    if (!isLoserPrizeType(prizeType)) {
      ensureLoserPrizeForPool(db, { prizeTable: 'game_mystery_prizes', poolColumn: 'pool_id', poolId: pool.id });
    }
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/mystery/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_mystery_prizes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/games/mystery/prizes/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM game_mystery_prizes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Prize not found' });
    const b = req.body || {};
    db.prepare(`
      UPDATE game_mystery_prizes SET
        label = COALESCE(?, label),
        prize_type = COALESCE(?, prize_type),
        prize_value = COALESCE(?, prize_value),
        weight = COALESCE(?, weight),
        quantity = COALESCE(?, quantity)
      WHERE id = ?
    `).run(
      b.label != null ? String(b.label).trim() : null,
      b.prizeType != null ? String(b.prizeType) : null,
      b.prizeValue != null ? String(b.prizeValue) : null,
      b.weight != null ? Math.max(1, Number(b.weight) || 1) : null,
      b.quantity != null ? Number(b.quantity) : null,
      req.params.id
    );
    res.json({ ok: true });
  });

  // ── Instant games (dice, pick, vault) ──
  app.get('/admin/games/instant', requireAdmin, (req, res) => {
    const pools = db.prepare('SELECT * FROM game_instant_pools ORDER BY game_key ASC').all();
    res.json(pools.map((p) => ({
      id: p.id,
      gameKey: p.game_key,
      title: p.title,
      isEnabled: !!p.is_enabled,
      minOrderTotal: p.min_order_total,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      prizes: db.prepare('SELECT * FROM game_instant_prizes WHERE pool_id = ? ORDER BY id').all(p.id).map((pr) => ({
        id: pr.id,
        label: pr.label,
        prizeType: pr.prize_type,
        prizeValue: pr.prize_value,
        weight: pr.weight,
        quantity: pr.quantity,
        wonCount: pr.won_count,
        tileStyle: pr.tile_style
      }))
    })));
  });

  app.put('/admin/games/instant/:key', requireAdmin, (req, res) => {
    const pool = db.prepare('SELECT * FROM game_instant_pools WHERE game_key = ?').get(req.params.key);
    if (!pool) return res.status(404).json({ error: 'Game not found' });
    const b = req.body || {};
    if (b.isEnabled) ensureGamesMasterEnabled(db);
    db.prepare(`
      UPDATE game_instant_pools SET
        title = COALESCE(?, title),
        is_enabled = COALESCE(?, is_enabled),
        min_order_total = COALESCE(?, min_order_total),
        starts_at = COALESCE(?, starts_at),
        ends_at = COALESCE(?, ends_at),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title != null ? String(b.title).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      b.minOrderTotal != null ? Math.max(0, Number(b.minOrderTotal) || 0) : null,
      b.startsAt,
      b.endsAt,
      pool.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/instant/:key/prizes', requireAdmin, (req, res) => {
    const pool = db.prepare('SELECT * FROM game_instant_pools WHERE game_key = ?').get(req.params.key);
    if (!pool) return res.status(404).json({ error: 'Game not found' });
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Label required' });
    const prizeType = String(b.prizeType || 'none');
    const weight = Math.max(1, Number(b.weight) || defaultPrizeWeight(prizeType));
    const r = db.prepare(`
      INSERT INTO game_instant_prizes (pool_id, label, prize_type, prize_value, weight, quantity, tile_style)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pool.id,
      label,
      prizeType,
      String(b.prizeValue || ''),
      weight,
      b.quantity != null ? Number(b.quantity) : -1,
      String(b.tileStyle || (isLoserPrizeType(prizeType) ? 'gray' : 'gold'))
    );
    if (!isLoserPrizeType(prizeType)) {
      ensureLoserPrizeForPool(db, { prizeTable: 'game_instant_prizes', poolColumn: 'pool_id', poolId: pool.id, extra: { tileStyle: true } });
    }
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/instant/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_instant_prizes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/games/instant/prizes/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM game_instant_prizes WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Prize not found' });
    const b = req.body || {};
    const prizeType = b.prizeType != null ? String(b.prizeType) : null;
    db.prepare(`
      UPDATE game_instant_prizes SET
        label = COALESCE(?, label),
        prize_type = COALESCE(?, prize_type),
        prize_value = COALESCE(?, prize_value),
        weight = COALESCE(?, weight),
        quantity = COALESCE(?, quantity),
        tile_style = COALESCE(?, tile_style)
      WHERE id = ?
    `).run(
      b.label != null ? String(b.label).trim() : null,
      prizeType,
      b.prizeValue != null ? String(b.prizeValue) : null,
      b.weight != null ? Math.max(1, Number(b.weight) || 1) : null,
      b.quantity != null ? Number(b.quantity) : null,
      prizeType && (prizeType === 'none' || prizeType === 'bomb') ? 'gray' : (b.tileStyle || null),
      req.params.id
    );
    res.json({ ok: true });
  });

  return { grantGamesForApprovedOrder: (order) => grantGamesForApprovedOrder(db, engineDeps, order) };
}

module.exports = { mountGamesService };
