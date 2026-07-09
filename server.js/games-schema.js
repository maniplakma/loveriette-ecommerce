'use strict';

function seedDefaultGames(db) {
  const drawAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  if (!db.prepare('SELECT id FROM game_wheel_campaigns LIMIT 1').get()) {
    const r = db.prepare(`
      INSERT INTO game_wheel_campaigns (title, is_enabled, available_days, draw_at, min_order_total, status)
      VALUES ('Weekend Spin Giveaway', 1, '0,1,2,3,4,5,6', ?, 0, 'scheduled')
    `).run(drawAt);
    const prizes = [
      ['Grand Prize — Netflix 1 Month', 'netflix', ''],
      ['₱500 Wallet Credit', 'wallet', '500'],
      ['₱100 Loyalty Points', 'loyalty', '100'],
      ['Plug Access 7 Days', 'plug_access', '7']
    ];
    const ins = db.prepare(`
      INSERT INTO game_wheel_prizes (campaign_id, label, prize_type, prize_value, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    prizes.forEach((p, i) => ins.run(r.lastInsertRowid, p[0], p[1], p[2], i));
  } else {
    db.prepare(`
      UPDATE game_wheel_campaigns
      SET is_enabled = 1, status = 'scheduled', draw_at = ?
      WHERE id = (SELECT id FROM game_wheel_campaigns ORDER BY id DESC LIMIT 1)
    `).run(drawAt);
  }

  if (!db.prepare('SELECT id FROM game_scratch_pools LIMIT 1').get()) {
    const r = db.prepare(`
      INSERT INTO game_scratch_pools (title, is_enabled, min_order_total) VALUES ('Golden Scratch Cards', 1, 0)
    `).run();
    const prizes = [
      ['₱200 Wallet', 'wallet', '200', 'gold'],
      ['₱50 Credit', 'wallet', '50', 'gold'],
      ['Free Plug Day', 'plug_access', '1', 'gold'],
      ['Better luck!', 'none', '', 'gray'],
      ['Boom!', 'bomb', '', 'gray']
    ];
    const ins = db.prepare(`
      INSERT INTO game_scratch_prizes (pool_id, label, prize_type, prize_value, weight, tile_style)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    prizes.forEach((p) => ins.run(r.lastInsertRowid, p[0], p[1], p[2], p[3]));
  } else {
    db.prepare(`UPDATE game_scratch_pools SET is_enabled = 1 WHERE id = (SELECT id FROM game_scratch_pools ORDER BY id DESC LIMIT 1)`).run();
  }

  if (!db.prepare('SELECT id FROM game_mystery_pools LIMIT 1').get()) {
    const r = db.prepare(`
      INSERT INTO game_mystery_pools (title, is_enabled, min_order_total) VALUES ('Mystery Box', 1, 0)
    `).run();
    const prizes = [
      ['Premium Account', 'account', ''],
      ['₱300 Wallet', 'wallet', '300'],
      ['₱75 Loyalty', 'loyalty', '75'],
      ['Empty box', 'none', '']
    ];
    const ins = db.prepare(`
      INSERT INTO game_mystery_prizes (pool_id, label, prize_type, prize_value, weight)
      VALUES (?, ?, ?, ?, 1)
    `);
    prizes.forEach((p) => ins.run(r.lastInsertRowid, p[0], p[1], p[2]));
  } else {
    db.prepare(`UPDATE game_mystery_pools SET is_enabled = 1 WHERE id = (SELECT id FROM game_mystery_pools ORDER BY id DESC LIMIT 1)`).run();
  }

  const instantDefaults = [
    {
      key: 'dice',
      title: 'Lucky Dice',
      prizes: [
        ['Jackpot — ₱1000', 'wallet', '1000', 'gold'],
        ['Double Six — ₱200', 'wallet', '200', 'gold'],
        ['₱50 Credit', 'wallet', '50', 'gold'],
        ['Roll again next order', 'none', '', 'gray']
      ]
    },
    {
      key: 'pick',
      title: 'Card Flip',
      prizes: [
        ['Ace — ₱500', 'wallet', '500', 'gold'],
        ['King — ₱150', 'wallet', '150', 'gold'],
        ['Queen — Plug Access', 'plug_access', '3', 'gold'],
        ['Joker — No prize', 'none', '', 'gray']
      ]
    },
    {
      key: 'vault',
      title: 'Treasure Vault',
      prizes: [
        ['Vault Jackpot ₱800', 'wallet', '800', 'gold'],
        ['Silver Key ₱100', 'wallet', '100', 'gold'],
        ['Bronze Key ₱25', 'wallet', '25', 'gold'],
        ['Empty vault', 'none', '', 'gray']
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
        VALUES (?, ?, ?, ?, 1, ?)
      `);
      game.prizes.forEach((p) => ins.run(pool.id, p[0], p[1], p[2], p[3]));
    } else {
      db.prepare('UPDATE game_instant_pools SET is_enabled = 1 WHERE id = ?').run(pool.id);
    }
  }
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
    'ALTER TABLE game_instant_pools ADD COLUMN ends_at TEXT'
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch (_) { /* column exists */ }
  }
}

module.exports = { initGamesSchema, seedDefaultGames };
