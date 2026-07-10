'use strict';

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function initPasswordResetSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);
  `);
}

function purgeExpiredPasswordResetTokens(db) {
  db.prepare(`
    DELETE FROM password_reset_tokens
    WHERE expires_at < datetime('now') OR used_at IS NOT NULL
  `).run();
}

function createPasswordResetToken(db, userId) {
  purgeExpiredPasswordResetTokens(db);
  db.prepare(`
    UPDATE password_reset_tokens SET used_at = datetime('now')
    WHERE user_id = ? AND used_at IS NULL
  `).run(userId);

  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, tokenHash, expiresAt);

  return { rawToken, expiresAt };
}

function findPasswordResetToken(db, rawToken) {
  const tokenHash = hashToken(rawToken);
  return db.prepare(`
    SELECT t.id, t.user_id, t.expires_at, t.used_at,
           u.id AS user_id, u.email, u.name, u.suspended
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
    LIMIT 1
  `).get(tokenHash);
}

function isPasswordResetTokenValid(row) {
  if (!row || row.used_at) return false;
  const expires = Date.parse(String(row.expires_at || ''));
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  return true;
}

function markPasswordResetTokenUsed(db, tokenId) {
  db.prepare(`
    UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?
  `).run(tokenId);
}

module.exports = {
  TOKEN_TTL_MS,
  initPasswordResetSchema,
  purgeExpiredPasswordResetTokens,
  createPasswordResetToken,
  findPasswordResetToken,
  isPasswordResetTokenValid,
  markPasswordResetTokenUsed,
  hashToken
};
