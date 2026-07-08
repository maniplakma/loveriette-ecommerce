#!/usr/bin/env node
'use strict';

/**
 * Delete orders stuck in pending/pending_payment without a real receipt file.
 * Run on VPS after deploy:
 *   cd /var/www/ecommerce && node scripts/purge-ghost-orders.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const appConfig = require(path.join(root, 'server.js', 'config'));
const db = require(path.join(root, 'server.js', 'db'));

const receiptsDir = path.join(appConfig.uploadsDir, 'receipts');
const PAYMENT_WINDOW_MS = 30 * 60 * 1000;

function hasProof(row) {
  const url = String(row.receipt_url || '').trim();
  if (!url || url === 'null' || url === 'undefined') return false;
  if (!url.startsWith('/uploads/receipts/')) return false;
  return fs.existsSync(path.join(receiptsDir, path.basename(url)));
}

function deleteOrder(row) {
  if (row.redeem_code_id) {
    db.prepare('UPDATE redeem_codes SET used_count = used_count - 1 WHERE id = ? AND used_count > 0')
      .run(row.redeem_code_id);
  }
  db.prepare('DELETE FROM orders WHERE id = ?').run(row.id);
}

const rows = db.prepare(`
  SELECT id, redeem_code_id, receipt_url, status, created_at, order_number, order_seq
  FROM orders
  WHERE status IN ('pending', 'pending_payment')
`).all();

const removed = [];
for (const row of rows) {
  if (hasProof(row)) continue;
  if (row.status === 'pending_payment') {
    const created = row.created_at
      ? new Date(row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`).getTime()
      : 0;
    if (Date.now() - created <= PAYMENT_WINDOW_MS) continue;
  }
  deleteOrder(row);
  removed.push(row.order_seq ?? row.order_number ?? row.id);
}

if (removed.length) {
  console.log(`Removed ${removed.length} ghost order(s): ${removed.join(', ')}`);
} else {
  console.log('No ghost orders to remove.');
}
