'use strict';

function initMailerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_buyer_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_type TEXT NOT NULL,
      reference_key TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(email_type, reference_key)
    );
    CREATE INDEX IF NOT EXISTS idx_sent_buyer_emails_recipient ON sent_buyer_emails(recipient, sent_at DESC);
  `);
}

function markBuyerEmailSent(db, emailType, referenceKey, recipient, subject) {
  try {
    db.prepare(`
      INSERT INTO sent_buyer_emails (email_type, reference_key, recipient, subject)
      VALUES (?, ?, ?, ?)
    `).run(emailType, referenceKey, recipient, subject || '');
    return true;
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return false;
    throw err;
  }
}

function wasBuyerEmailSent(db, emailType, referenceKey) {
  const row = db.prepare(`
    SELECT id FROM sent_buyer_emails WHERE email_type = ? AND reference_key = ?
  `).get(emailType, referenceKey);
  return !!row;
}

module.exports = {
  initMailerSchema,
  markBuyerEmailSent,
  wasBuyerEmailSent
};
