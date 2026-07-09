'use strict';

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

    CREATE INDEX IF NOT EXISTS idx_game_wheel_slots_campaign ON game_wheel_slots(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_game_scratch_cards_user ON game_scratch_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_mystery_plays_user ON game_mystery_plays(user_id);
  `);

  const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_enabled');
  if (!settings) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_enabled', '1');
  }
  const channel = db.prepare('SELECT value FROM settings WHERE key = ?').get('games_channel_url');
  if (!channel) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('games_channel_url', 'https://t.me/loveriette');
  }
}

module.exports = { initGamesSchema };
