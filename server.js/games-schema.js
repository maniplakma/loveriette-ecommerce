'use strict';

function seedDefaultGames(db) {
  const drawAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  if (!db.prepare('SELECT id FROM game_wheel_campaigns LIMIT 1').get()) {
    const r = db.prepare(`
      INSERT INTO game_wheel_campaigns (title, is_enabled, available_days, draw_at, min_order_total, max_entries, status)
      VALUES ('Weekend Spin Giveaway', 1, '0,1,2,3,4,5,6', ?, 0, 20, 'scheduled')
    `).run(drawAt);
    const prizes = [
      ['Grand Prize — Netflix 1 Month', 'netflix', '', 3, 1],
      ['₱500 Wallet Credit', 'wallet', '500', 3, 1],
      ['₱100 Loyalty Points', 'loyalty', '100', 3, 1],
      ['Plug Access 7 Days', 'plug_access', '7', 3, 1]
    ];
    const ins = db.prepare(`
      INSERT INTO game_wheel_prizes (campaign_id, label, prize_type, prize_value, sort_order, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    prizes.forEach((p, i) => ins.run(r.lastInsertRowid, p[0], p[1], p[2], i, p[4]));
  }

  if (!db.prepare('SELECT id FROM game_scratch_pools LIMIT 1').get()) {
    const r = db.prepare(`
      INSERT INTO game_scratch_pools (title, is_enabled, min_order_total) VALUES ('Golden Scratch Cards', 1, 0)
    `).run();
    const prizes = [
      ['₱200 Wallet', 'wallet', '200', 3, 'gold'],
      ['₱50 Credit', 'wallet', '50', 3, 'gold'],
      ['Free Plug Day', 'plug_access', '1', 3, 'gold'],
      ['Better luck!', 'none', '', 30, 'gray'],
      ['Boom!', 'bomb', '', 25, 'gray']
    ];
    const ins = db.prepare(`
      INSERT INTO game_scratch_prizes (pool_id, label, prize_type, prize_value, weight, tile_style)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    prizes.forEach((p) => ins.run(r.lastInsertRowid, p[0], p[1], p[2], p[3], p[4]));
  }

  if (!db.prepare('SELECT id FROM game_mystery_pools LIMIT 1').get()) {
    const r = db.prepare(`
      INSERT INTO game_mystery_pools (title, is_enabled, min_order_total) VALUES ('Mystery Box', 1, 0)
    `).run();
    const prizes = [
      ['Premium Account', 'account', '', 3],
      ['₱300 Wallet', 'wallet', '300', 3],
      ['₱75 Loyalty', 'loyalty', '75', 3],
      ['Empty box', 'none', '', 30]
    ];
    const ins = db.prepare(`
      INSERT INTO game_mystery_prizes (pool_id, label, prize_type, prize_value, weight)
      VALUES (?, ?, ?, ?, ?)
    `);
    prizes.forEach((p) => ins.run(r.lastInsertRowid, p[0], p[1], p[2], p[3]));
  }

  const instantDefaults = [
    {
      key: 'dice',
      title: 'Lucky Dice',
      prizes: [
        ['Jackpot — ₱1000', 'wallet', '1000', 2, 'gold'],
        ['Double Six — ₱200', 'wallet', '200', 3, 'gold'],
        ['₱50 Credit', 'wallet', '50', 3, 'gold'],
        ['Roll again next order', 'none', '', 30, 'gray']
      ]
    },
    {
      key: 'pick',
      title: 'Card Flip',
      prizes: [
        ['Ace — ₱500', 'wallet', '500', 2, 'gold'],
        ['King — ₱150', 'wallet', '150', 3, 'gold'],
        ['Queen — Plug Access', 'plug_access', '3', 3, 'gold'],
        ['Joker — No prize', 'none', '', 30, 'gray']
      ]
    },
    {
      key: 'vault',
      title: 'Treasure Vault',
      prizes: [
        ['Vault Jackpot ₱800', 'wallet', '800', 2, 'gold'],
        ['Silver Key ₱100', 'wallet', '100', 3, 'gold'],
        ['Bronze Key ₱25', 'wallet', '25', 3, 'gold'],
        ['Empty vault', 'none', '', 30, 'gray']
      ]
    }
  ];

  for (const game of instantDefaults) {
    let pool = db.prepare('SELECT id FROM game_instant_pools WHERE game_key = ?').get(game.key);
    if (!pool) {
      const r = db.prepare(`
        INSERT INTO game_instant_pools (game_key, title, is_enabled, min_order_total)
        VALUES (?, ?, 1, 0)
      `).run(game.key, game.title);
      pool = { id: r.lastInsertRowid };
      const ins = db.prepare(`
        INSERT INTO game_instant_prizes (pool_id, label, prize_type, prize_value, weight, tile_style)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      game.prizes.forEach((p) => ins.run(pool.id, p[0], p[1], p[2], p[3], p[4]));
    }
  }
}

function applyLoserWeightsMigration(db) {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'games_loser_weights_v1'").get();
  if (flag?.value === '1') return;

  for (const table of ['game_scratch_prizes', 'game_mystery_prizes', 'game_instant_prizes']) {
    db.prepare(`UPDATE ${table} SET weight = 30 WHERE prize_type IN ('none', 'bomb')`).run();
    db.prepare(`UPDATE ${table} SET weight = 3 WHERE prize_type NOT IN ('none', 'bomb')`).run();
  }

  const scratchPools = db.prepare('SELECT id FROM game_scratch_pools').all();
  for (const p of scratchPools) {
    insertDefaultLoserPrize(db, { prizeTable: 'game_scratch_prizes', poolId: p.id, withTile: true });
  }
  const mysteryPools = db.prepare('SELECT id FROM game_mystery_pools').all();
  for (const p of mysteryPools) {
    insertDefaultLoserPrize(db, { prizeTable: 'game_mystery_prizes', poolId: p.id, withTile: false });
  }
  const instantPools = db.prepare('SELECT id FROM game_instant_pools').all();
  for (const p of instantPools) {
    insertDefaultLoserPrize(db, { prizeTable: 'game_instant_prizes', poolId: p.id, withTile: true });
  }

  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('games_loser_weights_v1', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}

function insertDefaultLoserPrize(db, { prizeTable, poolId, withTile }) {
  const hasLoser = db.prepare(`
    SELECT id FROM ${prizeTable}
    WHERE pool_id = ? AND prize_type IN ('none', 'bomb')
    LIMIT 1
  `).get(poolId);
  if (hasLoser) return;
  if (withTile) {
    db.prepare(`
      INSERT INTO ${prizeTable} (pool_id, label, prize_type, prize_value, weight, quantity, tile_style)
      VALUES (?, 'Better luck next time!', 'none', '', 30, -1, 'gray')
    `).run(poolId);
  } else {
    db.prepare(`
      INSERT INTO ${prizeTable} (pool_id, label, prize_type, prize_value, weight, quantity)
      VALUES (?, 'Better luck next time!', 'none', '', 30, -1)
    `).run(poolId);
  }
}

function applyWheelStaleStartsClear(db) {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'wheel_stale_starts_cleared_v1'").get();
  if (flag?.value === '1') return;
  db.prepare(`
    UPDATE game_wheel_campaigns SET starts_at = NULL
    WHERE is_enabled = 1 AND status = 'scheduled'
      AND starts_at IS NOT NULL AND TRIM(starts_at) != ''
  `).run();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('wheel_stale_starts_cleared_v1', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}

function applyGamesClosedMigration(db) {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'games_all_closed_v1'").get();
  if (flag?.value === '1') return;
  db.prepare('UPDATE game_wheel_campaigns SET is_enabled = 0').run();
  db.prepare('UPDATE game_scratch_pools SET is_enabled = 0').run();
  db.prepare('UPDATE game_mystery_pools SET is_enabled = 0').run();
  db.prepare('UPDATE game_instant_pools SET is_enabled = 0').run();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('games_all_closed_v1', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}

function initGamesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_wheel_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      available_days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
      starts_at TEXT,
      ends_at TEXT,
      draw_at TEXT NOT NULL,
      min_order_total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'scheduled',
      winner_slot_id INTEGER,
      winner_prize_id INTEGER,
      drawn_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_wheel_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      prize_type TEXT NOT NULL DEFAULT 'custom',
      prize_value TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES game_wheel_campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_wheel_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL UNIQUE,
      order_number TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES game_wheel_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS game_scratch_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      min_order_total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_scratch_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      prize_type TEXT NOT NULL DEFAULT 'none',
      prize_value TEXT NOT NULL DEFAULT '',
      weight INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT -1,
      won_count INTEGER NOT NULL DEFAULT 0,
      tile_style TEXT NOT NULL DEFAULT 'gold',
      FOREIGN KEY (pool_id) REFERENCES game_scratch_pools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_scratch_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL UNIQUE,
      order_number TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      prize_id INTEGER,
      scratched_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pool_id) REFERENCES game_scratch_pools(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (prize_id) REFERENCES game_scratch_prizes(id)
    );

    CREATE TABLE IF NOT EXISTS game_mystery_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      min_order_total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_mystery_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      prize_type TEXT NOT NULL DEFAULT 'none',
      prize_value TEXT NOT NULL DEFAULT '',
      weight INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT -1,
      won_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (pool_id) REFERENCES game_mystery_pools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_mystery_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL UNIQUE,
      order_number TEXT NOT NULL,
      prize_id INTEGER,
      played_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pool_id) REFERENCES game_mystery_pools(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (prize_id) REFERENCES game_mystery_prizes(id)
    );

    CREATE TABLE IF NOT EXISTS game_instant_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      min_order_total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_instant_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      prize_type TEXT NOT NULL DEFAULT 'none',
      prize_value TEXT NOT NULL DEFAULT '',
      weight INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT -1,
      won_count INTEGER NOT NULL DEFAULT 0,
      tile_style TEXT NOT NULL DEFAULT 'gold',
      FOREIGN KEY (pool_id) REFERENCES game_instant_pools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_instant_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      prize_id INTEGER,
      played_at TEXT,
      result_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(pool_id, order_id),
      FOREIGN KEY (pool_id) REFERENCES game_instant_pools(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (prize_id) REFERENCES game_instant_prizes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_game_wheel_slots_campaign ON game_wheel_slots(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_game_scratch_cards_user ON game_scratch_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_mystery_plays_user ON game_mystery_plays(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_instant_plays_user ON game_instant_plays(user_id);

    CREATE TABLE IF NOT EXISTS game_order_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      chosen_game TEXT,
      chosen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_game_order_credits_user ON game_order_credits(user_id);

    CREATE TABLE IF NOT EXISTS game_wheel_winners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL,
      prize_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES game_wheel_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (slot_id) REFERENCES game_wheel_slots(id),
      FOREIGN KEY (prize_id) REFERENCES game_wheel_prizes(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_game_wheel_winners_campaign ON game_wheel_winners(campaign_id);

    CREATE TABLE IF NOT EXISTS game_prize_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      prize_type TEXT NOT NULL,
      prize_label TEXT NOT NULL,
      redeem_code TEXT,
      order_ref TEXT,
      source TEXT,
      fulfillment_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_enabled');
  if (!settings) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_enabled', '1');
  }
  const channel = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_channel_url');
  if (!channel) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_channel_url', 'https://t.me/loveriette');
  }
  const tg = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_telegram_handle');
  if (!tg) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_telegram_handle', '@loveriette');
  }
  const qty = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_required_quantity');
  if (!qty) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_required_quantity', '3');
  }
  const strict = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_strict_eligibility');
  if (!strict) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_strict_eligibility', '1');
  }

  migrateGamesSchema(db);

  try { seedDefaultGames(db); } catch (err) {
    console.error('[games] seed defaults failed:', err.message);
  }
  try { applyGamesClosedMigration(db); } catch (err) {
    console.error('[games] closed migration failed:', err.message);
  }
  try { applyWheelStaleStartsClear(db); } catch (err) {
    console.error('[games] wheel starts clear failed:', err.message);
  }
  try { applyLoserWeightsMigration(db); } catch (err) {
    console.error('[games] loser weights migration failed:', err.message);
  }
}

function migrateGamesSchema(db) {
  const alters = [
    'ALTER TABLE game_wheel_prizes ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE game_wheel_prizes ADD COLUMN won_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE game_scratch_pools ADD COLUMN starts_at TEXT',
    'ALTER TABLE game_scratch_pools ADD COLUMN ends_at TEXT',
    'ALTER TABLE game_mystery_pools ADD COLUMN starts_at TEXT',
    'ALTER TABLE game_mystery_pools ADD COLUMN ends_at TEXT',
    'ALTER TABLE game_instant_pools ADD COLUMN starts_at TEXT',
    'ALTER TABLE game_instant_pools ADD COLUMN ends_at TEXT',
    'ALTER TABLE game_wheel_campaigns ADD COLUMN max_entries INTEGER'
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch (_) { /* column exists */ }
  }
}

module.exports = { initGamesSchema, seedDefaultGames };
