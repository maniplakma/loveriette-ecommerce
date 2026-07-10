#!/usr/bin/env node
'use strict';

const db = require('../server.js/db');
const { disableAllGamePools } = require('../server.js/games-engine');

disableAllGamePools(db);
db.prepare(`
  INSERT INTO settings (key, value) VALUES ('games_all_closed_v1', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run();

console.log('All shop games are now closed (is_enabled = 0 on every pool/campaign).');
