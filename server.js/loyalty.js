'use strict';

/** ₱1 loyalty credit per ₱200 spent */
const LOYALTY_PER_PESO_SPENT = 200;

function readSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function resolveUserId(db, { userId, email }) {
  if (userId) return Number(userId);
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const row = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(em);
  return row?.id || null;
}

function creditLoyaltyForPurchase(db, { userId, email, total, orderRef, source = 'order' }) {
  if (readSetting(db, 'loyalty_enabled', '1') !== '1') return { credited: 0 };
  const uid = resolveUserId(db, { userId, email });
  if (!uid) return { credited: 0 };
  const ref = String(orderRef || '').trim();
  if (!ref) return { credited: 0 };

  const exists = db.prepare(`
    SELECT id FROM wallet_transactions WHERE order_number = ? AND user_id = ? AND type = 'loyalty'
  `).get(ref, uid);
  if (exists) return { credited: 0, duplicate: true };

  const credit = Math.floor(Number(total) / LOYALTY_PER_PESO_SPENT);
  if (credit <= 0) return { credited: 0 };

  db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(credit, uid);
  const desc = source === 'plugging'
    ? `Loyalty credit for plugging order ${ref}`
    : `Loyalty credit for order ${ref}`;
  db.prepare(`
    INSERT INTO wallet_transactions (user_id, type, amount, order_number, description)
    VALUES (?, 'loyalty', ?, ?, ?)
  `).run(uid, credit, ref, desc);

  return { credited: credit, userId: uid };
}

function getLoyaltyBalance(db, { userId, email }) {
  const uid = resolveUserId(db, { userId, email });
  if (!uid) return null;
  const row = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(uid);
  return {
    userId: uid,
    balance: row?.wallet_balance || 0,
    earnRateLabel: `₱1 per ₱${LOYALTY_PER_PESO_SPENT} spent`
  };
}

module.exports = {
  LOYALTY_PER_PESO_SPENT,
  creditLoyaltyForPurchase,
  getLoyaltyBalance,
  resolveUserId
};
