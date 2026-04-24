# Secrets & Environment Variables

All secrets are stored as Cloudflare Worker secrets (`wrangler secret put <NAME>`).
**Never commit secret values to the repo.**

---

## Required Secrets

### `ADMIN_PASSWORD`
- **Purpose**: Two roles — (1) break-glass admin login when no `app_users` row exists, (2) HMAC-SHA256 signing key for all session cookies.
- **Format**: Any strong random string (≥32 chars recommended).
- **Rotation**: `wrangler secret put ADMIN_PASSWORD` → all active sessions immediately invalidate (users must re-login). Update any scripts/tools that use the break-glass password.
- **Risk if leaked**: Full admin access to the app + ability to forge session cookies.

### `BREEZE_API_KEY`
- **Purpose**: Authenticates calls to the Breeze ChMS REST API (`https://<subdomain>.breezechms.com/api/`). Used for people sync, giving sync, fund import, tag sync.
- **Format**: API key string from Breeze → Account Settings → API.
- **Rotation**: Generate a new key in Breeze, then `wrangler secret put BREEZE_API_KEY`. No app downtime — next sync uses the new key.
- **Risk if leaked**: Read/write access to all Breeze ChMS data (people, giving, tags).

### `BREEZE_SUBDOMAIN`
- **Purpose**: The subdomain portion of `<subdomain>.breezechms.com`. Used to construct all Breeze API URLs.
- **Format**: Plain string, e.g. `timothylc` (no protocol, no `.breezechms.com`).
- **Rotation**: Only changes if the church switches Breeze accounts. `wrangler secret put BREEZE_SUBDOMAIN`.
- **Risk if leaked**: Low on its own — just the subdomain, not the API key.

### `RESEND_API_KEY`
- **Purpose**: Authenticates calls to the Resend email API. Used for birthday and anniversary emails sent to members.
- **Format**: `re_` prefixed key from resend.com → API Keys.
- **Rotation**: Create a new key in Resend, `wrangler secret put RESEND_API_KEY`, delete old key in Resend dashboard.
- **Risk if leaked**: Ability to send email from the configured `EMAIL_FROM` address via Resend.

### `EMAIL_FROM`
- **Purpose**: The `From:` address on all Resend emails (birthday, anniversary).
- **Format**: RFC 5322 format, e.g. `Timothy Lutheran <noreply@timothystl.org>`. Domain must be verified in Resend.
- **Rotation**: Update DNS records in Resend for new domain, then `wrangler secret put EMAIL_FROM`.
- **Risk if leaked**: Low — it's an email address, not a credential.

### `BREVO_API_KEY`
- **Purpose**: Authenticates calls to the Brevo API. Used for (1) newsletter contact sync and (2) transactional SMS (birthday/anniversary texts).
- **Format**: `xkeysib-` prefixed key from brevo.com → SMTP & API → API Keys.
- **Rotation**: Generate a new key in Brevo, `wrangler secret put BREVO_API_KEY`, delete old key.
- **Risk if leaked**: Ability to send SMS and email campaigns, and read/write Brevo contact lists.

### `BREVO_LIST_ID`
- **Purpose**: The numeric ID of the Brevo contact list used for newsletter sync.
- **Format**: Integer string, e.g. `"3"`. Found in Brevo → Contacts → Lists → list URL.
- **Rotation**: Only changes if the newsletter list is recreated. `wrangler secret put BREVO_LIST_ID`.
- **Risk if leaked**: Low — just a list ID, not a credential.

### `WORKER_SECRET`
- **Purpose**: Shared secret for internal service-to-service calls to the scheduler backend routes. The website Worker (or any authorized service) passes this in the `X-Worker-Secret` header to authenticate without a user session cookie.
- **Format**: Any strong random string (≥32 chars).
- **Rotation**: `wrangler secret put WORKER_SECRET` on this Worker, then update the same value in any calling Workers. Brief window during rotation where calls will be rejected.
- **Risk if leaked**: Ability to call scheduler admin endpoints without a user session.

---

## Bindings (not secrets — configured in `wrangler.toml`)

| Binding | Type | Resource | Purpose |
|---------|------|----------|---------|
| `DB` | D1 | `tlc-volunteer-db` | Primary database |
| `RSVP_STORE` | KV | `3db4fdc3...` | Rate limiting + dedup store |
| `PHOTOS` | R2 | `tlc-chms-photos` | Member and household photos |

These are wired by resource ID, not by secret — they survive a Worker rename (IN1).

---

## Adding a New Secret

```bash
wrangler secret put SECRET_NAME
# prompts for value — never pass on the command line
```

To list currently set secrets:
```bash
wrangler secret list
```

To delete a rotated/obsolete secret:
```bash
wrangler secret delete OLD_SECRET_NAME
```
