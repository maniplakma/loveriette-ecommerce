/**
 * Activity log for plugging forwarder events.
 */
function logPlugActivity(db, accountId, kind, message, targetRef = '') {
  db.prepare(`
    INSERT INTO plugging_activity_log (account_id, kind, message, target_ref)
    VALUES (?, ?, ?, ?)
  `).run(accountId, kind, String(message).slice(0, 500), String(targetRef).slice(0, 200));

  db.prepare(`
    DELETE FROM plugging_activity_log
    WHERE account_id = ?
      AND id NOT IN (
        SELECT id FROM plugging_activity_log
        WHERE account_id = ?
        ORDER BY id DESC
        LIMIT 200
      )
  `).run(accountId, accountId);
}

function mapActivityRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    targetRef: row.target_ref,
    createdAt: row.created_at
  };
}

function getAccountActivity(db, accountId, since = 0, limit = 80) {
  const sinceId = Math.max(0, Number(since) || 0);
  const cap = Math.min(200, Math.max(1, Number(limit) || 80));

  if (sinceId > 0) {
    return db.prepare(`
      SELECT * FROM plugging_activity_log
      WHERE account_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `).all(accountId, sinceId, cap).map(mapActivityRow);
  }

  return db.prepare(`
    SELECT * FROM (
      SELECT * FROM plugging_activity_log
      WHERE account_id = ?
      ORDER BY id DESC
      LIMIT ?
    ) sub
    ORDER BY id ASC
  `).all(accountId, cap).map(mapActivityRow);
}

function clearAccountActivity(db, accountId) {
  db.prepare('DELETE FROM plugging_activity_log WHERE account_id = ?').run(accountId);
}

module.exports = { logPlugActivity, getAccountActivity, clearAccountActivity, mapActivityRow };
