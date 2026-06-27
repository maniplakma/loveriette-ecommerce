# Ezyshell → Loveriette data migration

Move **loveriette store** buyers, orders, credentials, and wallet history from ezyshell (`/var/www/ezyshell`) into this app (`/var/www/ecommerce`).

Loveriette was built with the same concepts as ezyshell (users, orders, stock/credentials, wallet ledger). Migration is **read-only on ezyshell** — nothing there is modified.

---

## What gets migrated

| Data | Buyer experience after import |
|------|-------------------------------|
| **Users** | Same email + password login on loveriette |
| **Orders** | Past orders in My Account / wallet history |
| **Fulfillments + stock** | My Purchases shows old credentials |
| **Wallet transactions** | Balance history preserved |
| **Redeem codes** | Optional |

**Not migrated by default:** live chat, DMs, marketplace listings, CMS pages from ezyshell platform.

---

## Requirements

1. SSH access to your Contabo VPS
2. Read access to ezyshell database (usually PostgreSQL via `DATABASE_URL` in `/var/www/ezyshell/.env`)
3. Loveriette deployed at `/var/www/ecommerce` (or local dev copy)
4. **Backup both apps** before importing

---

## Step 1 — Backup (VPS)

```bash
# Ezyshell — backup only, do not stop unless you accept brief downtime
cp /var/www/ezyshell/.env ~/ezyshell-env-backup.txt

# Loveriette
pm2 stop ecommerce
cp /var/www/ecommerce/server.js/ecom.db /var/www/ecommerce/server.js/ecom.db.bak-$(date +%F)
pm2 start ecommerce
```

---

## Step 2 — Discover ezyshell database

```bash
cd /var/www/ezyshell
grep -E 'DATABASE_URL|POSTGRES|MONGO' .env
```

### If PostgreSQL (most common for Next.js)

```bash
# Install client if needed
sudo apt install -y postgresql-client

# Load URL from .env (adjust variable name if different)
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"

# List tables
psql "$DATABASE_URL" -c "\dt"
```

Send the table list (or a `pg_dump --schema-only` snippet) if you need help mapping SQL. Table names differ per ezyshell version.

### Find your store ID

Ezyshell is multi-store. Your shop slug is **`loveriette`** (`ezyshell.com/store/loveriette`).

Look for a `stores`, `shops`, or `sellers` table:

```bash
psql "$DATABASE_URL" -c "SELECT id, slug, name FROM stores WHERE slug ILIKE '%loveriette%' LIMIT 5;"
```

Note the store `id` — all export queries must filter by it.

---

## Step 3 — Export to JSON

### Option A — Manual export (safest)

Use ezyshell **admin → Manage Users / All Orders / Inventory** and export if the UI supports it, then shape data into `ezyshell-export.json` (see `scripts/ezyshell-export-sample.json`).

### Option B — SQL → JSON (recommended on VPS)

1. Copy `scripts/ezyshell-export-pg.sql` to the VPS
2. Edit table/column names to match your schema (from Step 2)
3. Run:

```bash
cd /var/www/ecommerce
psql "$DATABASE_URL" -f scripts/ezyshell-export-pg.sql -o /tmp/ezyshell-raw.json
# Or use the Node helper after adjusting SQL:
node scripts/ezyshell-export-pg.js --store-slug loveriette --out ./ezyshell-export.json
```

4. Download to your PC:

```bash
scp user@VPS:/var/www/ecommerce/ezyshell-export.json ./
```

### Export JSON shape

See `scripts/ezyshell-export-sample.json`. Critical fields:

- **users[].passwordHash** — copy bcrypt hash as-is (`$2a$` / `$2b$`) so passwords work unchanged
- **orders[].orderNumber** — keep original order IDs buyers recognize
- **orders[].fulfillments[]** — account email/password/profiles for My Purchases

---

## Step 4 — Import into loveriette

On the machine that owns `ecom.db`:

```bash
cd /var/www/ecommerce   # or local project root

# Preview counts (no writes)
node scripts/migrate-ezyshell.js import --file ./ezyshell-export.json --dry-run

# Real import (auto-backups ecom.db first)
node scripts/migrate-ezyshell.js import --file ./ezyshell-export.json

# Keep existing local users, only add new emails
node scripts/migrate-ezyshell.js import --file ./ezyshell-export.json --skip-existing-users
```

Or:

```bash
npm run migrate:ezyshell -- --file ./ezyshell-export.json
```

---

## Step 5 — Verify

```bash
npm run test:workflows
pm2 restart ecommerce
```

Manual checks:

- [ ] Log in as an **old ezyshell buyer** (same email/password)
- [ ] **My Purchases** shows delivered credentials
- [ ] **Wallet / order history** lists past orders
- [ ] Admin panel order totals look reasonable
- [ ] New checkout still works

---

## Password compatibility

| Ezyshell hash | Result on loveriette |
|---------------|----------------------|
| bcrypt (`$2a$`, `$2b$`, `$2y$`) | Same password works |
| Plain text or other | User must use **Forgot password** / admin reset |

---

## Rollback

```bash
pm2 stop ecommerce
cp server.js/ecom.db.bak-YYYY-MM-DD server.js/ecom.db
pm2 start ecommerce
```

Import also creates `ecom.db.pre-ezyshell-*.bak` automatically.

---

## What I need from you to finish the SQL export

If you want this fully automated, run on the VPS and paste the output (no passwords):

```bash
cd /var/www/ezyshell
grep '^DATABASE_URL=' .env | sed 's/:\/\/[^@]*@/:\/\/***@/'
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "SELECT id, slug FROM stores WHERE slug ILIKE '%loveriette%';"
```

With that, the export SQL can be tailored to your exact ezyshell schema so one command produces `ezyshell-export.json`.
