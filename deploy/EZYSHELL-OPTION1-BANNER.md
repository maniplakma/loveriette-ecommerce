# Option 1 — Ezyshell banner → Loveriette

When old clients open **ezyshell.com/store/loveriette**, they see a banner:

> **We've moved to loveriette!** — click to open the new shop. Same email & password. Orders already there.

---

## How it works

```
Client opens ezyshell store
        ↓
   Banner at top
        ↓
Clicks link → loveriette.com/login.html?from=ezyshell
        ↓
Welcome message: "Use your ezyshell account"
        ↓
Login once → orders & purchases ready
```

**Not auto-login** — they click the banner, then sign in with the **same account** (already migrated).

---

## Part A — Loveriette (welcome message)

Already added:
- `ezyshell-redirect.js` — shows welcome when URL has `?from=ezyshell`
- Works on login, signup, homepage

**Deploy to VPS:**

```powershell
scp -o StrictHostKeyChecking=accept-new C:\Users\kaye\OneDrive\Desktop\ecom-site\index.html\ezyshell-redirect.js root@161.97.78.192:/var/www/ecommerce/index.html/
```

Also upload updated `login.html`, `signup.html`, `index.html`, `auth.css` if not yet on server.

```bash
pm2 restart ecommerce
```

---

## Part B — Ezyshell banner (choose one)

### Way 1 — Ezyshell Admin (easiest, no code)

1. Login **ezyshell.com** as admin
2. Go to **Admin → Store Editor** (or Store Profile / Design)
3. Find **Announcement**, **Banner**, or **Store notice**
4. Paste:

```text
We've moved to loveriette! Open the new shop here: YOUR-LOVERIETTE-URL/login.html?from=ezyshell
Use the same email & password — your orders are already there ♡
```

5. Replace `YOUR-LOVERIETTE-URL` with your real shop URL, e.g.:
   - `http://161.97.78.192:3001`
   - or `https://shop.yourdomain.com`
6. **Save**

---

### Way 2 — Script on VPS (automatic)

**1. Upload script (PowerShell):**

```powershell
scp -o StrictHostKeyChecking=accept-new C:\Users\kaye\OneDrive\Desktop\ecom-site\scripts\set-ezyshell-store-banner.js root@161.97.78.192:/var/www/ecommerce/scripts/
```

**2. Run in Termius** (change URL to your shop):

```bash
cd /var/www/ezyshell/backend
```

```bash
LOVERIETTE_URL='http://161.97.78.192:3001/login.html?from=ezyshell' NODE_PATH=$(pwd)/node_modules node /var/www/ecommerce/scripts/set-ezyshell-store-banner.js --store-slug loveriette
```

**3. Refresh** ezyshell store page — banner should appear.

If the script says "Store not found", use **Way 1** (Admin panel) instead.

---

## Your loveriette link (use this in the banner)

| If shop is at | Banner link |
|---------------|-------------|
| IP + port | `http://161.97.78.192:3001/login.html?from=ezyshell` |
| Domain | `https://shop.yourdomain.com/login.html?from=ezyshell` |

---

## Test

1. Open **ezyshell.com/store/loveriette** — see banner
2. Click link → loveriette login with welcome message
3. Login with old ezyshell email + password
4. Check **My Purchases** — orders should show

---

## Note

Ezyshell frontend must **read** the banner field from the database. If Way 2 does not show visually, use **Way 1** in Admin — that always uses the built-in UI.
