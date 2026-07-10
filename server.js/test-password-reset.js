/**
 * Password reset token tests (no network).
 */
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const {
  initPasswordResetSchema,
  createPasswordResetToken,
  findPasswordResetToken,
  isPasswordResetTokenValid,
  markPasswordResetTokenUsed,
  hashToken
} = require('./password-reset');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      suspended INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0
    );
  `);
  initPasswordResetSchema(db);
  db.prepare(`INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)`)
    .run('buyer@test.com', 'hash', 'Buyer');
  return db;
}

function testHashTokenStable() {
  assert.strictEqual(hashToken('abc'), hashToken('abc'));
  assert.notStrictEqual(hashToken('abc'), hashToken('def'));
}

function testCreateAndValidateToken() {
  const db = makeDb();
  const userId = 1;
  const { rawToken } = createPasswordResetToken(db, userId);
  assert.ok(rawToken.length > 20);

  const row = findPasswordResetToken(db, rawToken);
  assert.strictEqual(row.user_id, userId);
  assert.strictEqual(isPasswordResetTokenValid(row), true);
}

function testUsedTokenInvalid() {
  const db = makeDb();
  const { rawToken } = createPasswordResetToken(db, 1);
  const row = findPasswordResetToken(db, rawToken);
  markPasswordResetTokenUsed(db, row.id);
  const after = findPasswordResetToken(db, rawToken);
  assert.strictEqual(isPasswordResetTokenValid(after), false);
}

function testInvalidToken() {
  const db = makeDb();
  assert.strictEqual(findPasswordResetToken(db, 'not-a-real-token'), undefined);
}

function main() {
  testHashTokenStable();
  testCreateAndValidateToken();
  testUsedTokenInvalid();
  testInvalidToken();
  console.log('password-reset tests: OK');
}

main();
