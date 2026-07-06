'use strict';

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

function initGmailSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gmail_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connected_email TEXT NOT NULL UNIQUE,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      token_expiry TEXT,
      label TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      connected_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buyer_gmail_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      order_id INTEGER,
      stock_item_id INTEGER NOT NULL,
      gmail_connection_id INTEGER NOT NULL,
      assigned_gmail TEXT NOT NULL,
      assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (gmail_connection_id) REFERENCES gmail_connections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fetched_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      stock_item_id INTEGER NOT NULL,
      gmail_message_id TEXT,
      subject TEXT,
      body_text TEXT,
      body_html TEXT,
      from_address TEXT,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_gmail_connections_expires ON gmail_connections(expires_at);
    CREATE INDEX IF NOT EXISTS idx_buyer_gmail_assignments_stock ON buyer_gmail_assignments(stock_item_id, buyer_id);
    CREATE INDEX IF NOT EXISTS idx_fetched_emails_buyer ON fetched_emails(buyer_id, stock_item_id);
  `);
}

function expiresAtIso(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function purgeExpiredGmail(db) {
  try {
    const now = new Date().toISOString();
    db.prepare(`
      DELETE FROM fetched_emails
      WHERE datetime(fetched_at) <= datetime(?, '-30 days')
    `).run(now);
    db.prepare(`
      DELETE FROM buyer_gmail_assignments WHERE datetime(expires_at) <= datetime(?)
    `).run(now);
    db.prepare(`
      DELETE FROM gmail_connections WHERE datetime(expires_at) <= datetime(?)
    `).run(now);
  } catch (err) {
    if (err?.code !== 'ERR_SQLITE_ERROR' && err?.errcode !== 5) throw err;
  }
}

function getActiveGmailConnection(db) {
  purgeExpiredGmail(db);
  return db.prepare(`
    SELECT * FROM gmail_connections
    WHERE is_active = 1 AND datetime(expires_at) > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get();
}

function assignGmailToBuyer(db, { buyerId, orderId, stockItemId }) {
  const conn = getActiveGmailConnection(db);
  if (!conn || !buyerId || !stockItemId) return null;

  const existing = db.prepare(`
    SELECT id FROM buyer_gmail_assignments
    WHERE stock_item_id = ? AND buyer_id = ? AND datetime(expires_at) > datetime('now')
  `).get(stockItemId, buyerId);
  if (existing) return existing;

  const expires = expiresAtIso(30);
  const r = db.prepare(`
    INSERT INTO buyer_gmail_assignments
      (buyer_id, order_id, stock_item_id, gmail_connection_id, assigned_gmail, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(buyerId, orderId || null, stockItemId, conn.id, conn.connected_email, expires);
  return { id: r.lastInsertRowid, gmailConnectionId: conn.id, assignedGmail: conn.connected_email, expiresAt: expires };
}

function getAssignmentForStock(db, buyerId, stockItemId) {
  purgeExpiredGmail(db);
  return db.prepare(`
    SELECT a.*, c.access_token_enc, c.refresh_token_enc, c.token_expiry, c.connected_email
    FROM buyer_gmail_assignments a
    JOIN gmail_connections c ON c.id = a.gmail_connection_id
    WHERE a.buyer_id = ? AND a.stock_item_id = ?
      AND datetime(a.expires_at) > datetime('now')
      AND c.is_active = 1
      AND datetime(c.expires_at) > datetime('now')
  `).get(buyerId, stockItemId);
}

function saveFetchedEmail(db, row) {
  db.prepare(`
    INSERT INTO fetched_emails
      (buyer_id, stock_item_id, gmail_message_id, subject, body_text, body_html, from_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.buyerId,
    row.stockItemId,
    row.gmailMessageId || null,
    row.subject || '',
    row.bodyText || '',
    row.bodyHtml || '',
    row.fromAddress || ''
  );
}

module.exports = {
  THIRTY_DAYS_SEC,
  initGmailSchema,
  purgeExpiredGmail,
  getActiveGmailConnection,
  assignGmailToBuyer,
  getAssignmentForStock,
  saveFetchedEmail,
  expiresAtIso
};
