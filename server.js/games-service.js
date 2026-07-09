'use strict';

const {
  grantGamesForApprovedOrder,
  runWheelDraw,
  processDueWheelDraws,
  scratchCard,
  playMysteryBox,
  playInstantGame,
  parseDays,
  buildGamesHubState,
  isGamesEnabled
} = require('./games-engine');
const { sendHtmlPage } = require('./send-html-page');

function mapWheelCampaign(row, db) {
  if (!row) return null;
  const prizes = db.prepare('SELECT * FROM game_wheel_prizes WHERE campaign_id = ? ORDER BY sort_order, id').all(row.id);
  const slots = db.prepare(`
    SELECT id, display_name AS displayName, order_number AS orderNumber, created_at AS createdAt
    FROM game_wheel_slots WHERE campaign_id = ? ORDER BY id ASC
  `).all(row.id);
  let winner = null;
  if (row.winner_slot_id) {
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
    minOrderTotal: row.min_order_total,
    status: row.status,
    drawnAt: row.drawn_at,
    winner,
    prizes: prizes.map((p) => ({
      id: p.id,
      label: p.label,
      prizeType: p.prize_type,
      prizeValue: p.prize_value,
      sortOrder: p.sort_order
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

  setInterval(() => processDueWheelDraws(db, engineDeps), 60 * 1000);

  app.get('/games', (req, res) => {
    if (!isGamesEnabled(db)) return res.redirect(302, '/shop');
    trackVisit?.(req);
    sendHtmlPage(res, frontendDir, 'games.html');
  });

  app.get('/api/games', (req, res) => {
    const userId = req.session?.userId || null;
    res.json(buildGamesHubState(db, userId));
  });

  // ── Buyer (legacy dashboard API) ──
  app.get('/account/games', requireAuth, (req, res) => {
    res.json(buildGamesHubState(db, req.session.userId));
  });

  app.post('/account/games/scratch/:id/play', requireAuth, (req, res) => {
    const owned = db.prepare('SELECT id FROM game_scratch_cards WHERE id = ? AND user_id = ? AND scratched_at IS NULL')
      .get(req.params.id, req.session.userId);
    if (!owned) return res.status(403).json({ error: 'Purchase from the shop first to unlock a scratch card.' });
    const result = scratchCard(db, engineDeps, { cardId: req.params.id, userId: req.session.userId });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.post('/account/games/mystery/:id/play', requireAuth, (req, res) => {
    const owned = db.prepare('SELECT id FROM game_mystery_plays WHERE id = ? AND user_id = ? AND played_at IS NULL')
      .get(req.params.id, req.session.userId);
    if (!owned) return res.status(403).json({ error: 'Purchase from the shop first to unlock mystery box.' });
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
      SELECT ip.id FROM game_instant_plays ip
      JOIN game_instant_pools p ON p.id = ip.pool_id
      WHERE ip.id = ? AND ip.user_id = ? AND ip.played_at IS NULL AND p.game_key = ?
    `).get(req.params.id, req.session.userId, req.params.key);
    if (!owned) return res.status(403).json({ error: 'Purchase from the shop first to unlock this game.' });
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
    res.json({
      gamesEnabled: (enabled?.value ?? '1') === '1',
      channelUrl: channel?.value || 'https://t.me/loveriette'
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
    res.json({ ok: true, gamesEnabled: enabled === '1' });
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
    if (!b.drawAt) return res.status(400).json({ error: 'Draw date/time is required' });
    const days = Array.isArray(b.availableDays) ? b.availableDays.join(',') : String(b.availableDays || '0,1,2,3,4,5,6');
    const r = db.prepare(`
      INSERT INTO game_wheel_campaigns (title, is_enabled, available_days, starts_at, ends_at, draw_at, min_order_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      b.isEnabled ? 1 : 0,
      days,
      b.startsAt || null,
      b.endsAt || null,
      b.drawAt,
      Math.max(0, Number(b.minOrderTotal) || 0)
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
      INSERT INTO game_wheel_prizes (campaign_id, label, prize_type, prize_value, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      label,
      String(b.prizeType || 'custom'),
      String(b.prizeValue || ''),
      Number(b.sortOrder) || 0
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/wheel/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_wheel_prizes WHERE id = ?').run(req.params.id);
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
      INSERT INTO game_scratch_pools (title, is_enabled, min_order_total) VALUES (?, ?, ?)
    `).run(title, b.isEnabled ? 1 : 0, Math.max(0, Number(b.minOrderTotal) || 0));
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/games/scratch/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE game_scratch_pools SET
        title = COALESCE(?, title),
        is_enabled = COALESCE(?, is_enabled),
        min_order_total = COALESCE(?, min_order_total),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title != null ? String(b.title).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      b.minOrderTotal != null ? Math.max(0, Number(b.minOrderTotal) || 0) : null,
      req.params.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/scratch/:id/prizes', requireAdmin, (req, res) => {
    const pool = db.prepare('SELECT id FROM game_scratch_pools WHERE id = ?').get(req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Label required' });
    const r = db.prepare(`
      INSERT INTO game_scratch_prizes (pool_id, label, prize_type, prize_value, weight, quantity, tile_style)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pool.id,
      label,
      String(b.prizeType || 'none'),
      String(b.prizeValue || ''),
      Math.max(1, Number(b.weight) || 1),
      b.quantity != null ? Number(b.quantity) : -1,
      String(b.tileStyle || 'gold')
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/scratch/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_scratch_prizes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Mystery pools ──
  app.get('/admin/games/mystery', requireAdmin, (req, res) => {
    const pools = db.prepare('SELECT * FROM game_mystery_pools ORDER BY id DESC').all();
    res.json(pools.map((p) => ({
      ...p,
      isEnabled: !!p.is_enabled,
      minOrderTotal: p.min_order_total,
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
      INSERT INTO game_mystery_pools (title, is_enabled, min_order_total) VALUES (?, ?, ?)
    `).run(title, b.isEnabled ? 1 : 0, Math.max(0, Number(b.minOrderTotal) || 0));
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/games/mystery/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE game_mystery_pools SET
        title = COALESCE(?, title),
        is_enabled = COALESCE(?, is_enabled),
        min_order_total = COALESCE(?, min_order_total),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      b.title != null ? String(b.title).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      b.minOrderTotal != null ? Math.max(0, Number(b.minOrderTotal) || 0) : null,
      req.params.id
    );
    res.json({ ok: true });
  });

  app.post('/admin/games/mystery/:id/prizes', requireAdmin, (req, res) => {
    const pool = db.prepare('SELECT id FROM game_mystery_pools WHERE id = ?').get(req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Label required' });
    const r = db.prepare(`
      INSERT INTO game_mystery_prizes (pool_id, label, prize_type, prize_value, weight, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      pool.id,
      label,
      String(b.prizeType || 'none'),
      String(b.prizeValue || ''),
      Math.max(1, Number(b.weight) || 1),
      b.quantity != null ? Number(b.quantity) : -1
    );
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/games/mystery/prizes/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM game_mystery_prizes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return { grantGamesForApprovedOrder: (order) => grantGamesForApprovedOrder(db, engineDeps, order) };
}

module.exports = { mountGamesService };
