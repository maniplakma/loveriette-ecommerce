# Gmail OAuth — Complete Setup Guide (Loveriette)

Use this guide from start to finish. Nothing is optional unless marked.

---

## What you already have

| Item | Value |
|------|--------|
| Website | https://loveriette.shop |
| OAuth redirect URI | `https://loveriette.shop/auth/google/callback` |
| Client ID | `1071810034337-kp5unsm46vbeikhfm0cn2g5a513ukk3u.apps.googleusercontent.com` |
| Client Secret | Set on VPS (starts with `GOCSPX-`) |

---

## PART A — Google Cloud Console (one-time)

### Step 1 — Open Google Cloud

1. Go to https://console.cloud.google.com/
2. Sign in with the **same Google account** you use for seller inbox (OTP emails).
3. Top bar → select your project (or create one):
   - **New Project** → Name: `Loveriette Email` → **Create**

---

### Step 2 — Enable Gmail API

1. Left menu → **APIs & Services** → **Library**
2. Search: `Gmail API`
3. Click **Gmail API** → **Enable**
4. Wait until it says **API enabled**

> This is the only API you need. No other API required.

---

### Step 3 — OAuth consent screen

1. **APIs & Services** → **OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - **App name:** `Loveriette Shop`
   - **User support email:** your email
   - **Developer contact:** your email
4. Click **Save and Continue**

#### Scopes (important)

5. Click **Add or Remove Scopes**
6. Add **both** scopes (loveriette uses read for OTP fetch and send for buyer emails if SMTP is off):
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   ```
7. Click **Update** → **Save and Continue**

#### Test users (required while app is in Testing)

9. **Test users** → **Add users**
10. Add the **exact Gmail address** of your seller inbox (the one that receives Netflix/OTP emails)
11. **Save and Continue** → **Back to Dashboard**

> While status is **Testing**, only emails listed as test users can connect.

---

### Step 4 — OAuth Client ID (you already created this)

1. **APIs & Services** → **Credentials**
2. Under **OAuth 2.0 Client IDs**, open your Web client
3. Verify these settings:

**Authorized JavaScript origins**
```
https://loveriette.shop
```

**Authorized redirect URIs**
```
https://loveriette.shop/auth/google/callback
```

4. Click **Save**

> If redirect URI is wrong, Connect Gmail will fail with `redirect_uri_mismatch`.

---

## PART B — Server (already done for you)

These are set on your VPS at `/var/www/ecommerce/.env`:

```env
PUBLIC_URL=https://loveriette.shop
GOOGLE_CLIENT_ID=1071810034337-kp5unsm46vbeikhfm0cn2g5a513ukk3u.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...(your secret)
```

After any `.env` change: `pm2 restart ecommerce`

---

## PART C — Connect Gmail in Admin Panel

### Step 5 — Login to admin

1. Open https://loveriette.shop/admin.html
2. Login with your admin account

### Step 6 — Go to Integrations

1. Left sidebar → **Integrations** (or find Gmail OAuth section)
2. You should see:
   - Green / ready state for OAuth (not grayed out)
   - Redirect URI shown: `https://loveriette.shop/auth/google/callback`

### Step 7 — Connect Gmail

1. Click **Connect Gmail**
2. Google sign-in opens → use your **seller inbox** (must be a **test user** from Step 3)
3. Review permissions → **Allow**
4. You return to admin with `Gmail connected` toast

### Step 8 — Configure filters

1. Under **Message filters**, add senders for your products, e.g.:
   - `netflix.com`
   - `account.netflix.com`
   - (add per product OTP sender)
2. Toggle **Gmail integration ON**
3. Click **Save**

### Step 9 — Test

1. Click **Test Fetcher**
2. Optional: enter a buyer test email if prompted
3. Should return success or “no unread message” (both mean OAuth works)

---

## PART D — Buyer side (how it works after setup)

1. Buyer places order → uploads payment proof
2. Admin **approves** order
3. Buyer goes to **Dashboard → Email Access**
4. Buyer clicks fetch → site reads **latest unread email** from connected Gmail matching your filters

---

## If you see "invalid client" / "invalid_client"

Google rejected the Client ID + Secret pair. This is **not** a website bug.

1. Go to **Google Cloud Console** → **APIs & Services** → **Credentials**
2. Open OAuth client: `...kp5unsm46vbeikhfm0cn2g5a513ukk3u...`
3. Click **Reset secret** (or delete this client and create a new Web client)
4. Copy the **new** Client Secret immediately (shown once)
5. Send the new secret to update the server, or run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\set-gmail-oauth.ps1 `
     -ClientId "YOUR_CLIENT_ID" `
     -ClientSecret "GOCSPX-NEW_SECRET"
   ```
6. Script must print `"googleCheck": "invalid_grant"` — that means Google accepts the secret

> **Delete old OAuth clients** you are not using (e.g. `...jgtnpnjgn2tssthv4atto4h0sbte0jl7...` or `...75rofo8rf...`) to avoid mixing credentials.

---

| Error | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Add exact URI in Google Console Step 4 |
| `Access blocked: app not verified` | Normal in Testing — use test user email only |
| `403 access_denied` | Add your Gmail as **Test user** in consent screen |
| Connect button grayed out | Check VPS `.env` has both CLIENT_ID and CLIENT_SECRET, restart PM2 |
| `Gmail OAuth disabled` | Set `PUBLIC_URL=https://loveriette.shop` in `.env` |
| No emails fetched | Check filters; ensure unread OTP exists in inbox |

---

## When ready for all customers (optional, later)

1. OAuth consent screen → **Publish App**
2. Google may ask for verification (because of Gmail scope)
3. For personal shop with 1 seller inbox, **Testing + test users** is usually enough

---

## Security reminders

- Never share Client Secret publicly
- Rotate secret in Google Console if exposed
- Only `gmail.readonly` + `gmail.send` — send is used for buyer transactional emails when SMTP is not configured

---

## Quick setup scripts (VPS)

```bash
# Check site readiness
bash scripts/gmail-oauth-preflight.sh https://loveriette.shop

# Save Client ID + Secret to .env and verify with Google
GOOGLE_CLIENT_ID='...' GOOGLE_CLIENT_SECRET='GOCSPX-...' bash scripts/set-gmail-oauth.sh
```

Tagalog short guide (your steps only): `docs/GMAIL-IKAW-LANG.md`

---

## Quick checklist

- [ ] Gmail API enabled
- [ ] OAuth consent screen created
- [ ] Scope: `gmail.readonly` added
- [ ] Seller Gmail added as test user
- [ ] Redirect URI: `https://loveriette.shop/auth/google/callback`
- [ ] JavaScript origin: `https://loveriette.shop`
- [ ] VPS `.env` has CLIENT_ID + CLIENT_SECRET
- [ ] PM2 restarted
- [ ] Admin → Connect Gmail → success
- [ ] Filters saved + integration ON
- [ ] Test Fetcher works
