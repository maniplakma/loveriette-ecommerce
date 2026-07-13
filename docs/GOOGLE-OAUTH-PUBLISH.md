# Publish Gmail OAuth app (remove 100-user Testing limit)

Use after Gmail is connected and working in **Testing** mode.

## Assets

| Item | URL / file |
|------|------------|
| App logo (upload to Google) | `docs/assets/google-oauth-app-logo.png` |
| Homepage | https://loveriette.shop |
| Privacy policy | https://loveriette.shop/privacy.html |
| Redirect URI | https://loveriette.shop/auth/google/callback |

## Scopes to justify

| Scope | Why |
|-------|-----|
| `gmail.readonly` | Buyers fetch OTP/verification emails for purchased accounts only |
| `gmail.send` | Transactional shop emails (order delivered, password reset) when SMTP is not used |

## Verification form — suggested answers

**Application name:** Loveriette Shop

**How does your app use Gmail data?**

> Loveriette is an ecommerce site. The shop owner connects one Gmail inbox via OAuth. After a buyer’s order is approved, the buyer can click “Email Fetcher” in their dashboard to retrieve the latest verification email sent to their purchased account address. The app searches only messages matching configured filters (sender, subject). OAuth tokens are encrypted on the server. We do not sell or share Gmail data.

**Is your app for personal or organizational use?**

> Organizational / small business — one seller inbox for customer OTP delivery.

**Demo video (if requested):**

1. Admin logs in → Integrations → Connect Gmail  
2. Approve a test order → Inventory delivers account  
3. Buyer logs in → Dashboard → Email Fetcher → Fetch  

Record with Loom or phone; upload unlisted YouTube link in the form.

## Steps in Google Cloud Console

1. **OAuth consent screen** → complete all fields (logo, homepage, privacy link)
2. **Publish app** (move from Testing to Production)
3. Submit **verification** if Google prompts (sensitive scopes)
4. Wait for Google email (often 3–14 days)

While waiting, **Testing** mode still works for emails listed under **Test users**.

## Security

- Never share Gmail passwords in chat or code — use **Connect Gmail** (OAuth) only.
- Rotate any password that was exposed outside Google’s login page.
