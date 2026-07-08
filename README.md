# Loveriette

**Loveriette** (`ecom-site`) is a portable, multi-service digital commerce platform. A single Node.js/Express application serves a vanilla HTML/CSS/JS frontend and exposes REST APIs backed by SQLite. Three customer-facing service modules share authentication, payments, admin tooling, and CMS infrastructure:

| Module | Purpose |
|--------|---------|
| **Shop** | Digital product storefront with inventory-backed credential delivery |
| **Plugging** | Telegram post auto-forwarder sold as a subscription with a self-service workspace |
| **Website Making** | Custom website service packages with inquiry and chat-based lead management |

The platform also includes a full **Admin Panel** (seller back-office) and **Buyer Panel** (My Account dashboard), Gmail OAuth integration for buyer email fetching, loyalty wallet credits, warranty/report workflows, and migration tooling from a legacy Ezyshell deployment.

---

## Table of Contents

- [Architecture](#architecture)
- [Folder Structure](#folder-structure)
- [Technologies Used](#technologies-used)
- [Features](#features)
- [Shop Module](#shop-module)
- [Plugging Module](#plugging-module)
- [Website Making Module](#website-making-module)
- [Admin Panel](#admin-panel)
- [Buyer Panel](#buyer-panel)
- [Authentication](#authentication)
- [Order Workflow](#order-workflow)
- [Payment Workflow](#payment-workflow)
- [Report Workflow](#report-workflow)
- [Product Delivery Workflow](#product-delivery-workflow)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Development](#development)
- [Deployment](#deployment)
- [Performance Optimizations](#performance-optimizations)
- [Security](#security)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [Related Documentation](#related-documentation)

---

## Architecture

```
Internet
   │
   ▼
Nginx (80/443) ──► Node.js / Express (server.js/server.js)
                        │
                        ├── SQLite (server.js/ecom.db)
                        ├── Uploads (server.js/uploads/)
                        ├── Branding assets (index.html/uploads/)
                        ├── Static frontend (index.html/)
                        ├── Gmail API (OAuth, buyer email fetch)
                        └── Telegram GramJS (plugging runners)
```

**Design characteristics:**

- **Monolithic Express app** — core shop APIs live in `server.js/server.js` (~5,800 lines); platform/CMS/plugging routes are in `platform-routes.js` and `plugging-service.js`.
- **No frontend build step** — static HTML pages are served directly; pretty URLs inject `<base href="/">` via `send-html-page.js`.
- **SQLite via `node:sqlite`** — requires Node.js 22+; schema split across `db.js` (core commerce) and `platform-db.js` (CMS, plugging, website-making).
- **Session-based auth** — `express-session` with HTTP-only cookies; no JWT.
- **Manual payment verification** — buyers upload receipt screenshots; admins approve before fulfillment.
- **In-process plugging runners** — Telegram forwarding runs inside the Node process (not a separate worker queue).

---

## Folder Structure

```
/
├── package.json                 # npm manifest, scripts, dependencies
├── ecosystem.config.cjs         # PM2 process configuration
├── .env.example                 # Environment variable template
├── DEPLOYMENT.md                # VPS deployment guide (Contabo-focused)
│
├── index.html/                  # FRONTEND_DIR — static site (~91 files)
│   ├── index.html               # Homepage
│   ├── shop.html, product.html  # Shop catalog and detail
│   ├── cart.html, checkout.html, payment.html, order-thanks.html
│   ├── plugging*.html           # Plugging landing, subscribe, payment, workspace
│   ├── website-making*.html     # Website packages and inquiry chat
│   ├── admin.html               # Admin panel
│   ├── dashboard.html           # Buyer panel (My Account)
│   ├── login.html, signup.html
│   ├── *.js                     # Page logic (shop.js, admin.js, dashboard.js, …)
│   ├── *.css                    # Styles (theme.css, admin.css, plugging.css, …)
│   └── uploads/                 # Store branding images (gitignored)
│
├── server.js/                   # BACKEND
│   ├── server.js                # Main Express app (auth, shop, orders, admin)
│   ├── config.js                # Central config from environment variables
│   ├── db.js                    # Core SQLite schema and migrations
│   ├── platform-db.js           # CMS, plugging, website-making schema
│   ├── platform-routes.js         # Platform APIs and pretty URL routes
│   ├── plugging-service.js        # Plugging orders, workspace, admin APIs
│   ├── plugging-*.js              # Telegram OTP, runner, forward, proxy, limits
│   ├── gmail-oauth.js, gmail-fetch.js, gmail-schema.js
│   ├── mailer.js, mailer-templates.js, mailer-schema.js
│   ├── token-crypto.js          # AES-256-GCM encryption for OAuth tokens
│   ├── domain-setup.js          # Custom domain / Gmail OAuth gating
│   ├── activity-feed.js, send-html-page.js, tunnel.js
│   ├── test-*.js                # Integration and regression tests
│   ├── ecom.db                    # SQLite database (gitignored)
│   ├── uploads/                   # Receipts, avatars, report proofs, payment QR
│   └── plugging-sessions/         # Telegram session files (gitignored)
│
├── scripts/                     # Build, admin, migration utilities
│   ├── prepare-production.js    # Production readiness check
│   ├── reset-admin.js, show-admin.js
│   └── migrate-ezyshell.js      # Legacy platform data import
│
├── deploy/                      # Nginx configs and deployment docs
│   ├── nginx/                   # Site configs (ecommerce.conf, etc.)
│   ├── PORTABLE.md, CONTABO-VPS.md, BACKUP-MIGRATION.md
│   └── EZYSHELL-MIGRATION.md
│
├── docs/
│   └── GMAIL-OAUTH-SETUP.md     # Google Cloud Console setup guide
│
└── logs/                        # PM2 / app logs (gitignored)
```

---

## Technologies Used

| Layer | Technology |
|-------|------------|
| Runtime | Node.js **≥ 22** (required for built-in `node:sqlite`) |
| Language | JavaScript (CommonJS) |
| Backend | Express **5.2** |
| Database | SQLite 3 via `node:sqlite` |
| Auth | `express-session` + `bcryptjs` (cost factor 10) |
| Frontend | Vanilla HTML, CSS, JavaScript (no React/Vue/bundler) |
| Process manager | PM2 (`ecosystem.config.cjs`) |
| Reverse proxy | Nginx (configs in `deploy/nginx/`) |
| Telegram | `telegram` npm package (GramJS) for plugging |
| Email | Gmail API with OAuth 2.0 (no separate mail transport package) |
| Dev tunnel | `cloudflared` via `npm run tunnel` |

**Direct npm dependencies:** `bcryptjs`, `express`, `express-session`, `telegram`

There are no `devDependencies` — tests are plain Node.js HTTP scripts.

---

## Features

### Cross-platform

- Multi-service homepage with CMS-driven service cards, FAQs, testimonials, and activity feed
- Module toggles: Shop, Plugging, and Website Making can be enabled/disabled from Admin → Overview
- Shared payment methods (GCash QR, etc.) across Shop and Plugging
- Sitewide theming: logo, fonts, Colorhunt palettes, custom CSS variables
- SEO: per-product meta tags, `sitemap.xml`, Open Graph images
- Platform analytics: page visits, top pages, cross-service inquiry counts
- Ezyshell migration support: import users/orders from legacy PostgreSQL app
- Gmail OAuth for admin-connected inbox; buyers can fetch OTP emails for purchased accounts
- Transactional buyer emails via Gmail API (welcome, order delivered)
- Promotional banners with scope (`shop`, etc.)
- Store announcements pushed to buyer Updates panel
- Direct message (DM) threads between buyers and seller
- Support tickets (buyer submit, admin manage)

### Shop-specific

- Product catalog with categories, search, featured products, SEO slugs
- Product variants (duration/plan tiers) with bulk pricing tiers
- Session + user cart with merge on login
- Redeem/discount codes (single and bulk creation)
- Tingi Drop: phased credential delivery for bulk/reseller orders
- Inventory-backed credential fulfillment from `stock_items`
- Product reviews (admin-managed, published on product pages)
- Loyalty wallet credits on order approval
- Warranty reports and refund requests with proof uploads

### Plugging-specific

- Subscription plans (VIP, VIP+) with duration-based pricing
- Self-service Telegram OTP login and multi-account workspace
- In-process message forwarding runner (fixed post link → multiple targets)
- Admin proxy pool, master workspace key, plan/product CRUD
- Activity log with live polling in workspace UI

### Website Making-specific

- Seven seeded service packages (ecommerce, auto-order, custom, business, landing page, maintenance, rental)
- Inquiry submission with reference IDs (`WEB-XXXXXXXX`)
- Client ↔ admin chat threads (email-verified, no login required)
- Inquiry status workflow and dashboard integration

---

## Shop Module

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/shop` | `shop.html` | Product catalog with category filters and search |
| `/product/:slug` | `product.html` | Product detail, variants, reviews, related products |
| `/cart` | `cart.html` | Session cart |
| `/checkout` | `checkout.html` | Direct buy or cart checkout; redeem codes; Tingi Drop option |
| `/payment` | `payment.html` | Receipt upload for shop orders |
| `/order-thanks` | `order-thanks.html` | Post-checkout confirmation |

### Key APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products`, `/products/:id` | Catalog with availability labels |
| GET | `/api/products/slug/:slug` | Product by slug with SEO and reviews |
| GET/POST/PUT/DELETE | `/cart`, `/cart/:productId` | Cart CRUD |
| POST | `/redeem/validate` | Validate discount code |
| POST | `/orders` | Create order (`pending_payment`) |
| POST | `/orders/:orderNumber/receipt` | Upload receipt → `pending` |
| GET | `/account/orders`, `/account/purchases` | Buyer order and credential history |
| POST | `/account/orders/:orderNumber/claim` | Tingi Drop: claim one credential unit |
| GET/POST/PUT/DELETE | `/admin/products`, `/admin/inventory` | Admin catalog and stock management |
| POST | `/admin/orders/:orderNumber/approve` | Approve and trigger fulfillment |

### Data model (core tables)

- `products`, `product_variants`, `categories` — catalog
- `stock_items` — credential inventory (`available` / `sold`)
- `orders`, `order_items`, `order_fulfillments` — purchase lifecycle
- `cart_items`, `payment_methods`, `redeem_codes`, `wallet_transactions`
- `product_reviews`, `promotional_banners` (scope `shop`)

### Availability logic

Products show **Available**, **Preorder**, **Sold Out**, or **Coming Soon** based on `stock_items` counts per variant. Bulk tier pricing is computed via `unitPriceForQuantity()`.

---

## Plugging Module

### What it does

Plugging is a **Telegram post auto-forwarder** sold as a subscription. After payment approval, the buyer receives an **access key** (`PLG-XXXX-XXXX`) and uses a private workspace to:

1. Log into their Telegram account (phone + OTP via GramJS — no password stored)
2. Configure a **source post link** (e.g. `https://t.me/channel/123`) and **target group links**
3. Start an in-process **runner** that repeatedly forwards that exact post to all targets

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/plugging` | `plugging.html` | Landing: hero, access key entry, plan cards, FAQs |
| `/plugging/plan/:slug` | `plugging-product.html` | Plan detail with variant cards |
| `/plugging/subscribe` | `plugging-subscribe.html` | Name/email → create order |
| `/plugging/payment` | `plugging-payment.html` | Payment method + receipt upload |
| `/plugging/status` | `plugging-status.html` | Order status; access key when approved |
| `/plugging/workspace` | `plugging-workspace.html` | Full workspace UI |

### Key APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plugging`, `/api/plugging/products/:slug` | Catalog and plan details |
| POST | `/api/plugging/subscribe` | Create `plugging_orders` row |
| POST | `/api/plugging/orders/:ref/payment` | Submit receipt → `pending_approval` |
| POST | `/api/plugging/workspace/unlock` | Validate access key → HTTP-only cookie |
| POST | `.../accounts`, `.../verify-code` | Add Telegram account, verify OTP |
| PUT | `.../accounts/:id` | Configure source link, targets, delay |
| POST | `.../start`, `.../stop` | Control forwarding runner |
| GET | `.../activity` | Activity log (UI polls every 4s) |
| PUT | `/admin/plugging/orders/:id` | Approve/reject → generates access key + expiry |

### Seeded plans

| Product | Limits | Plans |
|---------|--------|-------|
| VIP Plugging | 10 accounts × 50 groups | 7-day (₱499), 30-day (₱1,499) |
| VIP+ Plugging | Unlimited accounts/groups, priority | 7-day (₱999), 30-day (₱2,999) |

### Backend services

| File | Role |
|------|------|
| `plugging-service.js` | Orders, workspace auth, account CRUD, admin APIs |
| `plugging-telegram.js` | GramJS client: OTP login, sessions, proxy support |
| `plugging-runner.js` | Forwarding loop: resolve post → forward → cycle delay → repeat |
| `plugging-forward.js` | Native `forwardMessages` with retries |
| `plugging-join.js` | Join private groups via invite links |
| `plugging-proxy.js` | Round-robin proxy pool assignment |
| `plugging-limits.js` | Plan limits, expiry, master key unlimited access |
| `plugging-stealth.js` | Timing between targets and cycles |

### Legacy API

`POST /api/plugging/request` stores manual setup requests in `plugging_requests`. The primary customer flow is now subscribe → pay → workspace; no dedicated public form page exists for the legacy request endpoint.

---

## Website Making Module

### What it does

A **package catalog + inquiry/chat lead-generation** service for custom website development. There is no online checkout — payment is handled offline after scope is agreed (per FAQ copy).

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/website-making` | `website-making.html` | Package listing + FAQs |
| `/website-making/:slug` | `website-package.html` | Package detail + inquiry modal |
| `/website-making/inquiry/:ref` | `website-inquiry.html` | Client inquiry chat thread |

### Key APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/website-making` | Enabled packages, portfolio items, FAQs |
| GET | `/api/website-making/packages/:slug` | Package detail + related packages |
| POST | `/api/website-making/inquiry` | Create inquiry; returns `WEB-XXXXXXXX` ref |
| GET/POST | `/api/website-making/inquiry/:ref[/messages]` | Chat read/reply (email-verified) |
| GET/POST/PUT/DELETE | `/admin/website-making/*` | Admin package CRUD, inquiry management |

### Seeded packages

| Slug | Name | Price |
|------|------|-------|
| `ecommerce` | Ecommerce Website | ₱25,000 |
| `auto-order` | Auto Order Website | ₱18,000 |
| `custom` | Custom Website | ₱35,000 |
| `business` | Business Website | ₱15,000 |
| `landing-page` | Landing Page | ₱8,000 |
| `maintenance` | Maintenance Service | ₱3,000/month |
| `rental` | Monthly Website Rental | ₱2,500/month |

### Inquiry statuses

`new` → `open` → `reviewed` / `contacted` / `in_progress` → `closed`

Inquiries are linked to user accounts by **email match only** (no `user_id` column). Client chat access requires the inquiry email; no login is required.

---

## Admin Panel

**URL:** `/admin.html` (redirect: `/seller/dashboard`)

**Scripts:** `admin.js` (core store), `admin-platform.js` (CMS, plugging, website-making, analytics)

### Tabs and capabilities

| Tab | Capabilities |
|-----|--------------|
| **Overview** | Finance cards, sales chart, top sellers, module toggles |
| **All Orders** | Pending/approved/rejected; approve/reject with receipt view |
| **Transactions** | Approved/refunded ledger with filters |
| **Catalog** | Products and categories CRUD |
| **Inventory** | Stock tree (available + sold history) |
| **Manage Users** | Search, suspend/unsuspend, view details |
| **Redeem** | Discount codes (single + bulk) |
| **Store Updates** | Announcements to buyer Updates panel |
| **Direct Message** | Seller chat inbox with auto-reply bot config |
| **Support Tickets** | Open/closed buyer tickets |
| **Notifications** | Admin activity feed |
| **Product Reports** | Warranty/refund resolution (replace, refund, void, reject) |
| **Account Settings** | Security, payments, integrations, social, contact, Tingi |
| **Store Profile** | Bio, photo, vouch Telegram |
| **Site Theme** | Logo, fonts, Colorhunt, colors |
| **Content (CMS)** | Homepage services, FAQs, footer, testimonials |
| **Website Making** | Packages + inquiry admin chat |
| **Plugging** | Settings, proxies, products/plans, orders, setup requests |
| **Platform Analytics** | Traffic, top pages, cross-service stats |

### Admin-only operations

- Approve/reject shop and plugging payments
- Fulfill or re-fulfill orders manually
- Replace credentials on active reports (`fix_active`)
- Process refunds (credits wallet, marks order `refunded`)
- Gmail OAuth connection (requires HTTPS custom domain)
- Generate plugging master workspace key (`PLG-MASTER-...`)
- Nuclear **Reset Website** (clears transactional data, keeps catalog/admin)

---

## Buyer Panel

**URL:** `/dashboard.html` (redirect: `/buyer/dashboard`)

Labeled **My Account** in sitewide navigation.

### Panels

| Panel | Description |
|-------|-------------|
| **Dashboard** | Welcome, stats hero, recent orders |
| **Active Purchases** | Credentials for approved orders; Tingi claim button |
| **Plugging** | Subscription orders + workspace links |
| **Webtech** | Website-making inquiries + chat links |
| **Wallet** | Transaction history (orders + wallet ledger) |
| **Email Access** | Gmail OTP fetcher for purchased accounts |
| **Reports & Refunds** | Submitted reports with admin responses |
| **Settings** | Profile, password, social, preferences, support ticket |
| **Notifications** | In-app buyer notifications |
| **Updates** | Store announcements from admin |
| **Chat Seller** | DM thread with seller |
| **Vouch Seller** | Vouch instructions + Telegram link |

**Deep links:** `dashboard.html?order=<ref>#active-purchases`, hash panels like `#wallet`.

---

## Authentication

### Mechanism

- **Session cookies** via `express-session` (7-day `maxAge`, `httpOnly`, `sameSite: 'lax'`)
- **Password hashing** with `bcryptjs` (10 rounds)
- **Session invalidation** via `users.session_version` — incremented on password change or "logout all devices"
- **Suspended users** (`users.suspended = 1`) are blocked from all `requireAuth` endpoints

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account; merges guest cart |
| POST | `/auth/login` | Email + password login |
| POST | `/auth/logout` | Destroy session |
| GET | `/auth/me` | Current user or `null` |

### Access control middleware

- `requireAuth` — any logged-in, non-suspended user with valid session version
- `requireAdmin` — `users.is_admin = 1`

### Registration requirements

- Password minimum 8 characters with strength validation (`passwordStrengthError`)
- Rate limit: 30 attempts per IP per 15 minutes on `/auth/register` and `/auth/login`

### Admin seeding

On first boot when no admin exists, `db.js` seeds an admin from `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` environment variables. Use `npm run reset-admin` or `npm run show-admin` for admin management.

---

## Order Workflow

### Shop orders

```
Browse → Add to cart (or direct checkout)
    → POST /orders (status: pending_payment)
    → payment.html: select/confirm payment method
    → POST /orders/:orderNumber/receipt (status: pending)
    → Admin approves (POST /admin/orders/:orderNumber/approve)
    → status: approved → fulfillment runs
    → Buyer views credentials in My Purchases
```

**Order statuses:** `pending_payment` → `pending` → `approved` | `rejected` | `refunded`

**Order numbers** are sequential integers (`order_seq`) with collision-safe allocation. Guest checkout is supported (email-only, no `user_id`).

**Tingi Drop** (optional at checkout for bulk quantities):

- Sets `fulfillment_mode: 'manual'` and `tingi_drop_enabled: 1`
- On approval, sets a hold period (`tingi_hold_days`, default 10 days)
- Buyer claims one credential at a time via `POST /account/orders/:orderNumber/claim`
- After hold expires, `processExpiredTingiHolds()` auto-delivers remaining units

**Fulfillment modes:**

- `auto` — all stock assigned immediately on approval
- `manual` — Tingi Drop or quantities below `tingi_min_auto_drop` (default 5)

### Plugging orders

```
/plugging/plan/:slug → /plugging/subscribe
    → POST /api/plugging/subscribe (status: pending_payment)
    → /plugging/payment → POST /api/plugging/orders/:ref/payment (status: pending_approval)
    → Admin approves (PUT /admin/plugging/orders/:id)
    → access_key generated, expires_at set from plan duration
    → Buyer unlocks /plugging/workspace with access key
```

**Plugging statuses:** `pending_payment` → `pending_approval` → `approved` | `rejected`

### Website making inquiries

```
/website-making → package detail → inquiry modal
    → POST /api/website-making/inquiry (ref: WEB-XXXXXXXX, status: new)
    → /website-making/inquiry/:ref (chat)
    → Admin manages status and replies in admin panel
```

No payment or automated delivery step exists for website-making inquiries.

---

## Payment Workflow

Payment is **manual QR/bank transfer** with receipt verification — there is no payment gateway integration (Stripe, PayPal, etc.).

### Shared flow (Shop + Plugging)

1. Buyer selects an active payment method from `payment_methods` (admin-configured with QR image and instructions)
2. Buyer pays externally (GCash, bank transfer, etc.)
3. Buyer uploads a receipt screenshot (base64 image: JPG, PNG, or WebP)
4. Order moves to review status (`pending` for shop, `pending_approval` for plugging)
5. Admin reviews receipt in All Orders / Plugging Orders
6. Admin approves or rejects

### Shop-specific

- `PUT /orders/:orderNumber/payment-method` — change payment method before receipt upload
- Redeem codes applied at checkout reduce `orders.discount` and `orders.total`
- Default payment instructions warn against edited or downloaded receipts

### Plugging-specific

- Receipts saved to the same `server.js/uploads/receipts/` directory
- On approval, `access_key` (`PLG-XXXX-XXXX`) and `expires_at` are generated from plan `duration_days`

### Admin payment configuration

- `GET/PUT /admin/payment-methods` — CRUD with QR image upload
- `GET/PUT /admin/payment-settings` — global payment instruction text

---

## Report Workflow

Buyers can submit **warranty reports** or **refund requests** for delivered accounts from the Reports panel in My Account.

### Submission requirements

- Select one or more reportable stock items (`GET /account/report-targets`)
- Provide: name, issue details, remaining subscription days, product label
- **Vouch screenshot** (required — "no vouch = voided")
- **At least one additional proof photo** (minimum 2 photos total)
- For refunds: bank account details

Reports are stored in `product_reports` with `status: 'active'`.

### Admin resolution actions

`POST /admin/reports/:id/action` with `action`:

| Action | Effect |
|--------|--------|
| `fix_active` | Replace credentials on the linked `stock_item`; notify buyer |
| `refund` | Create `refund_records` entry; credit `wallet_balance`; mark order `refunded` |
| `void` | Void the report without replacement |
| `reject` | Reject with reason; notify buyer |

`POST /admin/reports/:id/resolve` provides an alternate resolution path with admin notes.

### Buyer visibility

- `GET /account/reports` — list of submitted reports with status and admin responses
- Notifications created on resolution

---

## Product Delivery Workflow

### Automatic delivery (standard orders)

On admin approval (`markOrderApprovedAndFulfill`):

1. Order status set to `approved`
2. Product `sold_count` incremented
3. For each order line item, available `stock_items` are assigned:
   - Matched by `variant_id` first, then `product_id`
   - `order_fulfillments` row created
   - Stock marked `sold` with `sold_to` buyer key
4. `email_access_credentials` upserted for Gmail fetch
5. If buyer is logged in, `buyer_gmail_assignments` may be created
6. When all units fulfilled, `trySendOrderDeliveredEmail()` queued via Gmail API
7. Loyalty wallet credited (`creditLoyaltyWallet`) if enabled

### Tingi Drop (phased delivery)

1. On approval, `tingi_hold_until` set to now + `tingi_hold_days`
2. Buyer claims one unit at a time: `POST /account/orders/:orderNumber/claim`
3. Each claim assigns one stock item and sends a notification
4. After hold expires, `processExpiredTingiHolds()` delivers all remaining units

### Buyer credential access

- `GET /account/purchases` — all purchased accounts with email, password, profiles, PIN, rules
- `GET /account/orders/:orderNumber/credentials` — credentials for a specific order
- `POST /account/email/fetch` — fetch latest Gmail for a stock item (requires admin Gmail OAuth)

### Admin manual fulfillment

`POST /admin/orders/:orderNumber/fulfill` — re-run fulfillment for approved orders with remaining units.

---

## Environment Variables

Copy `.env.example` to `.env` and configure. All paths are optional — defaults resolve relative to the app folder.

### Required in production

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` |
| `SESSION_SECRET` | Random 32-byte hex string (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | Set `1` when serving over HTTPS |
| `ADMIN_EMAIL` | Admin seed email (first deploy only) |
| `ADMIN_PASSWORD` | Admin seed password (first deploy only) |

### Recommended

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port (`.env.example` uses `3001`) |
| `HOST` | `0.0.0.0` | Bind address |
| `PUBLIC_URL` | — | Public site URL, no trailing slash (required for Gmail OAuth) |
| `ADMIN_NAME` | `Site Admin` | Admin display name (seed only) |

### Optional paths

| Variable | Default |
|----------|---------|
| `APP_ROOT` | Parent of `server.js/` |
| `FRONTEND_DIR` | `{APP_ROOT}/index.html` |
| `SERVER_DIR` | `{APP_ROOT}/server.js` |
| `DB_PATH` | `{SERVER_DIR}/ecom.db` |
| `UPLOADS_DIR` | `{SERVER_DIR}/uploads` |
| `BRANDING_UPLOADS_DIR` | `{FRONTEND_DIR}/uploads` |
| `LOG_DIR` | `{APP_ROOT}/logs` |

### Optional tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `JSON_BODY_LIMIT` | `12mb` | Max request body size (receipt/proof uploads) |
| `PM2_APP_NAME` | `ecommerce` | PM2 process name |
| `PM2_MAX_MEMORY` | `512M` | PM2 memory restart threshold |
| `DEFAULT_SOCIAL_LINKS_JSON` | `[]` | Fallback social links when DB empty |
| `EXPECTED_PUBLIC_HOST` | — | Enforce hostname for Gmail OAuth gate |

### Gmail OAuth

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Auto-derived from `PUBLIC_URL` if unset |
| `TOKEN_ENCRYPTION_KEY` | Encrypts OAuth tokens at rest (falls back to `SESSION_SECRET`) |

See `docs/GMAIL-OAUTH-SETUP.md` for Google Cloud Console setup.

### Development / testing

| Variable | Description |
|----------|-------------|
| `TUNNEL_TARGET_HOST` | Dev tunnel target (default `127.0.0.1`) |
| `TEST_BASE` | Base URL for test runners |
| `TEST_ADMIN_PASSWORD` | Admin password for CI tests |
| `PLUG_MASTER_KEY` | Legacy env fallback for plugging master key (prefer Admin UI) |

---

## Installation

### Prerequisites

- **Node.js 22+** (required for `node:sqlite`)
- **npm** (comes with Node.js)
- **PM2** (production process management)
- **Nginx** (production reverse proxy)

### Steps

```bash
# Clone or copy the project
cd /path/to/loveriette

# Install dependencies (production only)
npm ci --omit=dev

# Verify tree and create directories
npm run build

# Configure environment
cp .env.example .env
chmod 600 .env
# Edit .env — set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PUBLIC_URL

# Start the server
npm run start:prod
# Or with PM2:
pm2 start ecosystem.config.cjs --env production
```

On first start, SQLite schema is created and migrations run automatically. An admin user is seeded if none exists.

### Persistent data to back up

| Path | Contents |
|------|----------|
| `server.js/ecom.db` | All application data |
| `server.js/uploads/` | Receipts, avatars, report proofs, payment QR |
| `index.html/uploads/` | Branding assets |
| `server.js/plugging-sessions/` | Telegram session files |
| `.env` | Secrets and configuration |

---

## Development

### Local server

```bash
npm install
cp .env.example .env
# Set SESSION_SECRET (any value for dev) and ADMIN_PASSWORD
npm start
# Server runs at http://127.0.0.1:3000 (or PORT from .env)
```

### Phone testing via tunnel

```bash
npm run tunnel
# Starts cloudflared tunnel to local server
```

### Admin utilities

```bash
npm run show-admin      # Display current admin credentials
npm run reset-admin     # Reset admin password from .env
```

### No frontend build step

Edit HTML/CSS/JS files in `index.html/` directly. Changes are served immediately on refresh. Cache-busting query strings (`?v=...`) are used on asset links.

### Database

SQLite file at `server.js/ecom.db`. Schema migrations run on server start via `db.js` and `platform-db.js`. Use `scripts/repair-db.sh` for repair utilities.

---

## Deployment

Production deployment uses **Node.js + PM2 + Nginx** on a VPS. No Docker configuration is included.

### Quick deploy

```bash
npm ci --omit=dev
npm run build
cp .env.example .env && nano .env
pm2 start ecosystem.config.cjs --env production
pm2 save
```

### Nginx

Use configs in `deploy/nginx/`. Replace `SHOP_DOMAIN` with your domain. Nginx proxies to `127.0.0.1:{PORT}`.

```bash
# Example from deploy/setup-external-access.sh
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### SSL

Use Certbot with the Nginx site config. Set `COOKIE_SECURE=1` and `PUBLIC_URL=https://yourdomain.com` after SSL is active.

### PM2

`ecosystem.config.cjs` configures:

- Process name: `ecommerce` (override with `PM2_APP_NAME`)
- Memory restart at 512M (override with `PM2_MAX_MEMORY`)
- Logs in `logs/out.log` and `logs/err.log`
- Loads `.env` via `--env-file=.env`

### Migration from Ezyshell

```bash
npm run migrate:ezyshell
```

See `deploy/EZYSHELL-MIGRATION.md` for PostgreSQL/MongoDB export steps.

### Detailed guides

| Document | Description |
|----------|-------------|
| `DEPLOYMENT.md` | Full Contabo VPS walkthrough |
| `deploy/PORTABLE.md` | Provider-agnostic deployment |
| `deploy/CONTABO-VPS.md` | Contabo-specific paths and ports |
| `deploy/BACKUP-MIGRATION.md` | Backup, restore, server-to-server migration |

---

## Performance Optimizations

### Server-side

- **HTTP cache headers** on public API responses (`Cache-Control: public, max-age=30–120` for products, categories, branding)
- **HTML pages** served with `Cache-Control: no-cache, must-revalidate` to ensure fresh content after deploys
- **SQLite** with indexed columns (`order_seq`, slugs, foreign keys) and prepared statements throughout
- **Batch queries** for order items (`batchOrderItemsByNumber`) to avoid N+1 in dashboard APIs
- **PM2 memory restart** at 512M to prevent runaway plugging runners

### Client-side

- **`api-cache.js`** — in-memory GET response cache with 30s default TTL; invalidation by URL prefix
- **`theme-boot.js`** — applies theme before paint to prevent flash of unstyled content
- **`theme-critical.css`** — above-the-fold critical CSS loaded first
- **`performance-mobile.css`** — mobile-specific performance rules
- **Activity feed prefetch** on homepage (`window.__activityPrefetch`)
- **Font preconnect** to Google Fonts on key pages
- **Deferred script loading** (`defer` attribute on non-critical JS)
- **Plugging workspace** polls activity every 4s (not WebSocket)

### Operational

- Single PM2 instance (`instances: 1`, `exec_mode: 'fork'`) — appropriate for SQLite single-writer model
- Upload directories created on demand; no separate CDN layer

---

## Security

### Authentication and sessions

- `SESSION_SECRET` required in production (server refuses insecure default)
- HTTP-only session cookies with configurable `secure` flag
- `session_version` invalidates all sessions on password change or logout-all
- Suspended accounts blocked at middleware level
- Admin routes gated by `requireAdmin` checking `users.is_admin`

### Password policy

- Minimum 8 characters with strength validation
- `bcryptjs` hashing (cost 10)
- Registration/login rate limited: 30 attempts per IP per 15 minutes

### Data protection

- OAuth tokens encrypted at rest with AES-256-GCM (`token-crypto.js`)
- Gmail OAuth gated behind HTTPS custom domain check (`domain-setup.js`)
- Receipt and proof images stored on filesystem, not in database blobs
- `.env` excluded from git; `chmod 600` recommended

### Request handling

- `express.json` body limit configurable (default 12mb for image uploads)
- `trust proxy` enabled for correct IP behind Nginx
- Order ownership verified before credential/report access
- Plugging workspace uses HTTP-only `plug_access_key` cookie after key validation
- Email-verified access for website-making inquiry chat (no session required)

### What is not implemented

- No `helmet` middleware
- No CSRF tokens (relies on `sameSite: 'lax'` cookies)
- No API rate limiting beyond auth endpoints
- No Content Security Policy headers
- Plugging runners hold live Telegram sessions in the Node process

---

## Testing

Tests are plain Node.js HTTP scripts that require a **running server**. Set `TEST_BASE` and `TEST_ADMIN_PASSWORD` in environment.

| Script | Command | Coverage |
|--------|---------|----------|
| Platform smoke tests | `npm run test:platform` | Page routes, website-making, plugging, homepage APIs |
| Audit tests | `npm run test:audit` | Full shop order flow, reports, plugging, inquiry chat |
| Workflow tests | `npm run test:workflows` | Auth, cart, checkout, admin approve, credentials |
| E2E full | `npm run test:e2e` | End-to-end scenarios across modules |
| Production regression | `npm run test:prod` | Live deployment smoke checks |
| Full QA suite | `npm run test:qa` | Runs platform + audit + workflows + e2e sequentially |

### Example

```bash
# Terminal 1
npm start

# Terminal 2
export TEST_ADMIN_PASSWORD=your-admin-password
npm run test:qa
```

Test files live in `server.js/test-*.js`. They use the shared `request()` helper pattern with cookie-based session auth.

---

## Known Limitations

### Architecture

- **SQLite single-writer** — not suitable for high-concurrency multi-instance deployments without externalizing the database
- **In-process plugging runners** — server restart kills all active forwarding; no persistent job queue
- **No payment gateway** — all payments require manual receipt verification by admin
- **No frontend framework** — large monolithic JS files; no component hot-reload or type checking

### Module-specific gaps

| Area | Limitation |
|------|------------|
| **Website Making** | No online payment or automated project delivery |
| **Website Making** | `website_portfolio` table and API exist but no public UI renders portfolio items |
| **Website Making** | Admin package editing UI only supports add (prompt) and delete — full PUT API exists but no edit form |
| **Website Making** | `website_making_enabled` toggle saved to DB but does not hide public routes or navigation |
| **Website Making** | Inquiries linked by email only, not `user_id` |
| **Plugging** | Forwards a **fixed post link** repeatedly — does not monitor channels for new messages |
| **Plugging** | Requires Telegram API ID/hash configured in admin plugging settings |
| **Plugging** | Legacy `POST /api/plugging/request` API exists without a dedicated customer form page |
| **Shop** | Loyalty wallet balance displayed but no buyer-facing "pay with wallet" at checkout |
| **Shop** | No dedicated `/admin/loyalty` UI — loyalty runs via settings keys automatically |

### Security and ops

- Auth rate limiting is in-memory only (resets on server restart; not shared across instances)
- No automated database backups — manual scripts in `deploy/` and `scripts/`
- No Docker or container orchestration configs
- Windows `.bat` and PowerShell deploy scripts exist alongside bash equivalents

### External dependencies

- Gmail features require Google Cloud OAuth setup and a verified custom domain
- Plugging requires valid Telegram API credentials and optionally a proxy pool
- Email delivery depends on admin-connected Gmail account (no fallback SMTP)

---

## Related Documentation

| Document | Path |
|----------|------|
| Deployment guide | `DEPLOYMENT.md` |
| Portable deployment | `deploy/PORTABLE.md` |
| Contabo VPS setup | `deploy/CONTABO-VPS.md` |
| Backup and migration | `deploy/BACKUP-MIGRATION.md` |
| Ezyshell migration | `deploy/EZYSHELL-MIGRATION.md` |
| Gmail OAuth setup | `docs/GMAIL-OAUTH-SETUP.md` |
| Environment template | `.env.example` |

---

## License

ISC (per `package.json`).
