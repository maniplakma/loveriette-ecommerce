'use strict';

/**
 * Export ezyshell store data from PostgreSQL → JSON for loveriette import.
 *
 * BEFORE RUNNING: edit TABLE_MAP below to match your ezyshell schema.
 * Discover tables: psql "$DATABASE_URL" -c "\dt"
 *
 * Usage (on VPS, read-only):
 *   cd /var/www/ecommerce
 *   export DATABASE_URL="$(grep '^DATABASE_URL=' /var/www/ezyshell/.env | cut -d= -f2- | tr -d '"')"
 *   node scripts/ezyshell-export-pg.js --store-slug loveriette --out ./ezyshell-export.json
 */

const fs = require('fs');
const path = require('path');

const TABLE_MAP = {
  // TODO: adjust these to your ezyshell Postgres schema
  stores: 'stores',
  storeSlugCol: 'slug',
  storeIdCol: 'id',

  users: 'users',
  userIdCol: 'id',
  userEmailCol: 'email',
  userPasswordCol: 'password_hash',
  userNameCol: 'name',
  userUsernameCol: 'username',
  userWalletCol: 'wallet_balance',
  userCreatedCol: 'created_at',

  orders: 'orders',
  orderIdCol: 'id',
  orderNumberCol: 'order_number',
  orderUserIdCol: 'user_id',
  orderEmailCol: 'email',
  orderStatusCol: 'status',
  orderTotalCol: 'total',
  orderSubtotalCol: 'subtotal',
  orderDiscountCol: 'discount',
  orderPaymentCol: 'payment_method',
  orderCreatedCol: 'created_at',
  orderStoreIdCol: 'store_id',

  orderItems: 'order_items',
  orderItemOrderCol: 'order_id',
  orderItemNameCol: 'product_name',
  orderItemQtyCol: 'quantity',
  orderItemPriceCol: 'price',

  stock: 'stock_items',
  stockOrderCol: 'order_id',
  stockEmailCol: 'email',
  stockPasswordCol: 'password',
  stockProfilesCol: 'profiles',
  stockServiceCol: 'service_name'
};

function parseArgs(argv) {
  const args = { storeSlug: 'loveriette', out: 'ezyshell-export.json' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--store-slug' && argv[i + 1]) { args.storeSlug = argv[++i]; continue; }
    if (argv[i] === '--out' && argv[i + 1]) { args.out = argv[++i]; continue; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Set DATABASE_URL (from /var/www/ezyshell/.env) before running.');
    console.error('Example: export DATABASE_URL="$(grep ^DATABASE_URL= /var/www/ezyshell/.env | cut -d= -f2- | tr -d \'"\')"');
    process.exit(1);
  }

  let pg;
  try {
    pg = require('pg');
  } catch {
    console.error('Install pg on the VPS: npm install pg --no-save');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const M = TABLE_MAP;
  const storeRes = await client.query(
    `SELECT ${M.storeIdCol} AS id FROM ${M.stores} WHERE ${M.storeSlugCol} ILIKE $1 LIMIT 1`,
    [args.storeSlug]
  );
  if (!storeRes.rows.length) {
    console.error(`Store not found for slug: ${args.storeSlug}`);
    console.error('Edit TABLE_MAP in scripts/ezyshell-export-pg.js if table/column names differ.');
    await client.end();
    process.exit(1);
  }
  const storeId = storeRes.rows[0].id;

  const usersRes = await client.query(`
    SELECT u.${M.userIdCol} AS legacy_id,
           u.${M.userEmailCol} AS email,
           u.${M.userPasswordCol} AS password_hash,
           u.${M.userNameCol} AS name,
           u.${M.userUsernameCol} AS username,
           COALESCE(u.${M.userWalletCol}, 0) AS wallet_balance,
           u.${M.userCreatedCol} AS created_at
    FROM ${M.users} u
    WHERE EXISTS (
      SELECT 1 FROM ${M.orders} o
      WHERE o.${M.orderStoreIdCol} = $1 AND o.${M.orderUserIdCol} = u.${M.userIdCol}
    )
    OR u.email ILIKE '%@%'
  `, [storeId]);

  const ordersRes = await client.query(`
    SELECT o.${M.orderIdCol} AS legacy_id,
           o.${M.orderNumberCol} AS order_number,
           o.${M.orderEmailCol} AS email,
           o.${M.orderUserIdCol} AS legacy_user_id,
           o.${M.orderStatusCol} AS status,
           COALESCE(o.${M.orderSubtotalCol}, o.${M.orderTotalCol}, 0) AS subtotal,
           COALESCE(o.${M.orderDiscountCol}, 0) AS discount,
           COALESCE(o.${M.orderTotalCol}, 0) AS total,
           o.${M.orderPaymentCol} AS payment_method,
           o.${M.orderCreatedCol} AS created_at
    FROM ${M.orders} o
    WHERE o.${M.orderStoreIdCol} = $1
    ORDER BY o.${M.orderCreatedCol} ASC
  `, [storeId]);

  const payload = {
    meta: {
      source: 'ezyshell',
      store: args.storeSlug,
      storeId,
      exportedAt: new Date().toISOString()
    },
    users: usersRes.rows.map((r) => ({
      legacyId: r.legacy_id,
      email: r.email,
      passwordHash: r.password_hash,
      name: r.name,
      username: r.username,
      walletBalance: Number(r.wallet_balance || 0),
      createdAt: r.created_at
    })),
    orders: [],
    walletTransactions: [],
    redeemCodes: []
  };

  for (const o of ordersRes.rows) {
    let items = [];
    try {
      const itemsRes = await client.query(`
        SELECT ${M.orderItemNameCol} AS product_name,
               ${M.orderItemQtyCol} AS quantity,
               ${M.orderItemPriceCol} AS price
        FROM ${M.orderItems}
        WHERE ${M.orderItemOrderCol} = $1
      `, [o.legacy_id]);
      items = itemsRes.rows.map((i) => ({
        productName: i.product_name,
        quantity: Number(i.quantity || 1),
        price: Number(i.price || 0)
      }));
    } catch (_) { /* order_items table name may differ */ }

    let fulfillments = [];
    try {
      const stockRes = await client.query(`
        SELECT ${M.stockServiceCol} AS service_name,
               ${M.stockEmailCol} AS email,
               ${M.stockPasswordCol} AS password,
               ${M.stockProfilesCol} AS profiles
        FROM ${M.stock}
        WHERE ${M.stockOrderCol} = $1
      `, [o.legacy_id]);
      fulfillments = stockRes.rows.map((s) => ({
        serviceName: s.service_name,
        email: s.email,
        password: s.password,
        profiles: (() => {
          try { return JSON.parse(s.profiles || '[]'); } catch { return []; }
        })()
      }));
    } catch (_) { /* stock table may differ */ }

    payload.orders.push({
      legacyId: o.legacy_id,
      orderNumber: String(o.order_number || o.legacy_id),
      legacyUserId: o.legacy_user_id,
      email: o.email,
      status: o.status,
      subtotal: Number(o.subtotal || 0),
      discount: Number(o.discount || 0),
      total: Number(o.total || 0),
      paymentMethod: o.payment_method || 'GCash',
      createdAt: o.created_at,
      items,
      fulfillments
    });
  }

  await client.end();

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${payload.users.length} users, ${payload.orders.length} orders → ${outPath}`);
  console.log('Next: node scripts/migrate-ezyshell.js import --file', outPath);
}

main().catch((err) => {
  console.error(err.message || err);
  console.error('\nIf tables/columns differ, edit TABLE_MAP in scripts/ezyshell-export-pg.js');
  process.exit(1);
});
