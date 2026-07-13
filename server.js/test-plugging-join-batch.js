/**
 * Plugging join-groups batch tests (no Telegram network).
 */
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const {
  parseJoinGroups,
  buildJoinGroupsStatus,
  pruneJoinResults,
  isJoinBatchRunning,
  MAX_JOIN_ATTEMPTS
} = require('./plugging-join-batch');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE plugging_orders (
      id INTEGER PRIMARY KEY,
      join_groups_text TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE plugging_accounts (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL,
      label TEXT,
      phone TEXT,
      session_string TEXT,
      auth_status TEXT
    );
    CREATE TABLE plugging_join_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      group_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(order_id, account_id, group_ref)
    );
  `);
  return db;
}

function testParseJoinGroups() {
  assert.deepStrictEqual(parseJoinGroups('@a\n@b'), ['@a', '@b']);
  assert.deepStrictEqual(parseJoinGroups(''), []);
}

function testBuildJoinGroupsStatus() {
  const db = makeDb();
  db.prepare('INSERT INTO plugging_orders (id, join_groups_text) VALUES (1, ?)').run('@g1\n@g2');
  db.prepare(`
    INSERT INTO plugging_accounts (id, order_id, label, phone, session_string, auth_status)
    VALUES (1, 1, 'A1', '111', 'sess', 'authenticated'),
           (2, 1, 'A2', '222', 'sess', 'authenticated')
  `).run();
  db.prepare(`
    INSERT INTO plugging_join_results (order_id, account_id, group_ref, status, attempts)
    VALUES (1, 1, '@g1', 'completed', 1),
           (1, 2, '@g1', 'completed', 1),
           (1, 1, '@g2', 'error', ${MAX_JOIN_ATTEMPTS})
  `).run();

  const status = buildJoinGroupsStatus(db, 1, '@g1\n@g2');
  assert.deepStrictEqual(status.completed, ['@g1']);
  assert(status.pending.includes('@g2'));
  assert.strictEqual(status.errors.length, 1);
  assert.strictEqual(status.errors[0].groupRef, '@g2');
  assert.strictEqual(status.accountCount, 2);
}

function testPruneJoinResults() {
  const db = makeDb();
  db.prepare('INSERT INTO plugging_orders (id) VALUES (1)').run();
  db.prepare(`
    INSERT INTO plugging_join_results (order_id, account_id, group_ref, status)
    VALUES (1, 1, '@keep', 'completed'),
           (1, 1, '@drop', 'pending')
  `).run();
  pruneJoinResults(db, 1, ['@keep']);
  const rows = db.prepare('SELECT group_ref FROM plugging_join_results WHERE order_id = 1').all();
  assert.deepStrictEqual(rows.map((r) => r.group_ref), ['@keep']);
}

function testIsJoinBatchRunning() {
  assert.strictEqual(isJoinBatchRunning(999), false);
}

function main() {
  testParseJoinGroups();
  testBuildJoinGroupsStatus();
  testPruneJoinResults();
  testIsJoinBatchRunning();
  console.log('plugging-join-batch tests: OK');
}

main();
