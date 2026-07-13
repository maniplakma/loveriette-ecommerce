# Gmail OAuth — Ikaw lang ang gagawa (5 steps)

Ang **loveriette.shop** side ay ready na (domain, privacy page, redirect URI).  
Hindi ko magagawa ang Google login mo — ikaw lang sa browser.

---

## Step 1 — Google Cloud (15–20 min)

1. https://console.cloud.google.com/ → bagong project: **Loveriette Shop**
2. **APIs & Services → Library** → enable **Gmail API**
3. **OAuth consent screen** → **External** → Create
   - App name: `Loveriette Shop`
   - Homepage: `https://loveriette.shop`
   - Privacy policy: `https://loveriette.shop/privacy.html`
   - Support + developer email: email mo
4. **Scopes** → Add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
5. **Test users** → idagdag ang **seller Gmail** (inbox ng OTP)
6. **Credentials** → Create **OAuth client ID** → **Web application**
   - Origin: `https://loveriette.shop`
   - Redirect: `https://loveriette.shop/auth/google/callback`
7. Kopyahin **Client ID** + **Client Secret**

---

## Step 2 — Ilagay sa VPS (copy-paste sa Termius)

```bash
cd /var/www/ecommerce
git pull origin main
chmod +x scripts/set-gmail-oauth.sh scripts/gmail-oauth-preflight.sh

GOOGLE_CLIENT_ID='PASTE_CLIENT_ID' \
GOOGLE_CLIENT_SECRET='PASTE_CLIENT_SECRET' \
bash scripts/set-gmail-oauth.sh
```

Dapat may `"googleCheck": "invalid_grant"` — ibig sabihin valid ang credentials.

---

## Step 3 — Connect Gmail (browser, ikaw)

1. https://loveriette.shop/admin.html → login
2. **Integrations** → **Gmail OAuth**
3. **Connect Gmail** → sign in seller inbox → **Allow**
4. Dapat: toast **Gmail connected**

---

## Step 4 — Filters (ikaw, 2 min)

Sa same page:

- Allowed senders: `netflix.com`, `account.netflix.com`, etc.
- Subject keywords: `code, OTP, verify`
- **Save filters** → toggle Gmail **ON** → **Save**

---

## Step 5 — Test

- Click **Test Fetcher** sa admin
- Approve test order → buyer dashboard → **Email Fetcher**

---

## Kung may error

```bash
bash scripts/gmail-oauth-preflight.sh https://loveriette.shop
```

| Error | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Exact redirect sa Google Console |
| `403` / Access blocked | Seller Gmail = Test user |
| `invalid_client` | Mali secret — reset sa Google, ulitin Step 2 |

---

## Ano ang kailangan mo ipadala sa akin (kung may problema)

1. Screenshot ng error (Google o admin)
2. Output ng: `bash scripts/gmail-oauth-preflight.sh`
3. **Huwag** i-send ang Client Secret sa public chat — kung kailangan i-update, gamitin Step 2 sa VPS lang

Full technical guide: `docs/GMAIL-OAUTH-SETUP.md`
