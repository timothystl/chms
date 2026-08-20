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

### `EMAIL_FROM`
- **Purpose**: The `From:` address on every Resend email the Worker sends — birthday and anniversary greetings, scheduler assignments and reminders, Connect invites, password resets.
- **Format**: RFC 5322 format, e.g. `Timothy Lutheran <noreply@timothystl.org>`. Domain must be verified in Resend.
- **Rotation**: `wrangler secret put EMAIL_FROM`.
- **Risk if leaked**: Low — it's an email address, not a credential.
- **⚠ This entry used to read `ADMIN_EMAIL`, which was wrong**: nothing has ever sent mail from `ADMIN_EMAIL`. `sendResend()` reads `EMAIL_FROM` and refuses outright without it, so following the old instruction produced a Worker that sent no email at all, with the one variable that mattered undocumented. See "Variables the Worker does not read" below.

### `RESEND_API_KEY`
- **Purpose**: Authenticates calls to the Resend email API. Used for birthday and anniversary emails sent to members.
- **Format**: `re_` prefixed key from resend.com → API Keys.
- **Rotation**: Create a new key in Resend, `wrangler secret put RESEND_API_KEY`, delete old key in Resend dashboard.
- **Risk if leaked**: Ability to send email from the configured `EMAIL_FROM` address via Resend.

### `CHMS_INTAKE_API_KEY`
- **Purpose**: Shared secret for intake API endpoints (`/api/intake/connect-card`, `/api/intake/prayer`). The website Worker passes this key to authenticate form submissions without a user session.
- **Format**: Any strong random string (≥32 chars).
- **Rotation**: `wrangler secret put CHMS_INTAKE_API_KEY`, then update the same value in the website Worker.
- **Risk if leaked**: Ability to create person records and prayer requests via the intake endpoints.

### `ADMIN_PUSH_API_KEY`
- **Purpose**: Shared secret this Worker sends as `X-Push-Key` when calling `POST https://admin.timothystl.org/api/push/notify` — the website repo's cross-app web-push relay. Lets a new volunteer sign-up or an RSVP response ring admin staff's phones without this repo building its own push infrastructure (the website repo already has one, hand-rolled RFC 8291/8292, in `admin/webpush.js`). The reverse direction of `CHMS_INTAKE_API_KEY` above — same pattern, this repo is the caller here.
- **Format**: Any strong random string (≥32 chars); must be the exact same value as `ADMIN_PUSH_API_KEY` on the website Worker (`tlc-newsletter-admin`).
- **Rotation**: `wrangler secret put ADMIN_PUSH_API_KEY`, then update the same value on the website Worker.
- **Risk if leaked**: Ability to push an arbitrary title/body notification to every subscribed admin device — a nuisance/social-engineering vector, not a data-access one (the relay only accepts `{title, body, tag, url}`, no way to read anything back).
- **Fails safe**: if this secret is unset (or the website Worker hasn't set its matching copy), the push call is best-effort and `.catch()`'d — a new sign-up or an RSVP response is never blocked or delayed by a missing/misconfigured key.

### `BREVO_API_KEY`
- **Purpose**: Authenticates calls to the Brevo API. Used for (1) newsletter contact sync, (2) transactional SMS (birthday/anniversary texts), and (3) giving statement/mid-year-update emails (`giving/send-statement`, pinned to Brevo rather than Resend for its higher 300/day free-tier cap).
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

## Optional Secrets

These are not required for the app to function but unlock additional capabilities.

### `GOOGLE_ADDRESS_API_KEY`
- **Purpose**: Google Address Validation API — first choice for address validation (used for both the single-person "Verify Address" button and bulk validation). No meaningful rate limit at church scale, unlike the USPS OAuth API's 60 req/hour cap. Falls back to USPS/Lob/Census if absent.
- **Provision**: Google Cloud Console → create/select a project → enable billing → enable the "Address Validation API" → Credentials → Create API Key → restrict the key to the Address Validation API only. Free tier: 10,000 calls/month.
- **Set**: `wrangler secret put GOOGLE_ADDRESS_API_KEY`.
- **Risk if leaked**: Free-tier quota abuse; restrict the key server-side (API restriction) to limit blast radius.

### `GOOGLE_MAPS_API_KEY`
- **Purpose**: Google **Maps Static API** — powers the embedded map image on the Person Profile and Household View ("Show Map"). This is a **different Google product** than Address Validation, so it needs its own enablement/restriction. If absent, the code falls back to `GOOGLE_ADDRESS_API_KEY`, but a key restricted to Address Validation (as those provisioning steps instruct) will be **rejected** by the Static Maps API with a 403 — showing "Map unavailable" in the UI.
- **Provision**: Google Cloud Console → same or new project → enable billing → enable **"Maps Static API"** → Credentials → Create API Key → under API restrictions, allow **Maps Static API** (a server-side key; leave application/referrer restrictions off since the Worker calls it server-to-server).
- **Set**: `wrangler secret put GOOGLE_MAPS_API_KEY`.
- **Risk if leaked**: Free-tier/quota abuse; restrict the key to the Maps Static API only.

### `USPS_CLIENT_ID` + `USPS_CLIENT_SECRET`
- **Purpose**: USPS OAuth 2.0 address validation. Used if `GOOGLE_ADDRESS_API_KEY` is absent. Note: as of the January 2026 Web Tools shutdown, this API is rate-limited to 60 requests/hour — fine for the single-person button, impractical for bulk validation at scale.
- **Provision**: Register at https://developer.usps.com → create an app with the **Addresses (3.0)** API → copy Consumer Key and Consumer Secret.
- **Set**: `wrangler secret put USPS_CLIENT_ID` then `wrangler secret put USPS_CLIENT_SECRET`.
- **Risk if leaked**: Free-tier abuse of the church's USPS quota.

### `USPS_USER_ID`
- **Purpose**: USPS Web Tools (legacy) — only used as a fallback if Google and USPS OAuth credentials are both absent. Shut down January 2026; kept only for reference.
- **Provision**: https://www.usps.com/business/web-tools-apis/ (legacy registration; new signups disabled).
- **Set**: `wrangler secret put USPS_USER_ID`.

### `LOB_API_KEY`
- **Purpose**: Lob address verification — fallback if no Google/USPS credentials present.
- **Provision**: https://dashboard.lob.com → API Keys → live secret key.
- **Set**: `wrangler secret put LOB_API_KEY`.

### `REPLY_TO_EMAIL`
- **Purpose**: Overrides the `office@timothystl.org` default used in Resend `reply_to` for scheduler and ChMS emails.
- **Set**: `wrangler secret put REPLY_TO_EMAIL`.

### `ESV_API_KEY`
- **Purpose**: Lets the Scheduler send the **full ESV text** of each reading — either as an attached PDF sheet (the default, and what keeps the email short) or inline in the body. Entirely optional — with no key the readings are still named and linked to esv.org, which needs no setup at all. The mode is chosen per send on the Email Assignments panel. Read server-side only, via `/esv/passage` (`src/api-scheduler.js`); the key never reaches a browser, and it could not be used from one anyway (the embedded scheduler runs under CSP `connect-src 'self'`).
- **Provision**: https://api.esv.org → create an API key. Free for non-commercial personal, church and ministry use.
- **Set**: `wrangler secret put ESV_API_KEY`.
- **Licensing, per Crossway's own API terms** (worth reading before turning this on): the text **may** be redistributed by email; up to 500 verses per query and no more than half a book; 5,000 queries/day, 1,000/hour, 60/minute. Attribution is three separate duties, all of which this app satisfies deliberately — "(ESV)" with each quotation (requested via `include-short-copyright`), the full Crossway notice (printed once per email by `ESV_COPYRIGHT_NOTICE`), and a link to www.esv.org (every reading reference is one). **Nothing is cached**: Crossway does not document a caching allowance, and a church's send volume sits far under the daily limit, so their text is never stored on our side.

### `QB_CLIENT_ID` + `QB_CLIENT_SECRET`
- **Purpose**: QuickBooks Online OAuth 2.0 — powers the Finance tab's live Budget vs Actual + account balance sync. Unlike other integrations here, these are the *app's* credentials, not a per-connection token — the actual connection (which QuickBooks company, access/refresh tokens) is established by an admin clicking "Connect QuickBooks" in Settings and completing Intuit's consent screen, then stored in the `finance_qb_connection` D1 table (not a Worker secret, since it's obtained via OAuth and rotates over time).
- **Provision**: Register at https://developer.intuit.com → create an app → enable the **Accounting** scope → under Keys, copy the Client ID and Client Secret (use the Production keys, not Sandbox, unless testing) → under Redirect URIs, add `https://chms.timothystl.org/admin/api/finance/qb/callback` exactly.
- **Set**: `wrangler secret put QB_CLIENT_ID` then `wrangler secret put QB_CLIENT_SECRET`.
- **Risk if leaked**: Alone, these can't access church financial data (a real OAuth consent + this Worker's session cookie are also required) — but rotate if the Intuit app itself is compromised.
- **⚠ Needs live verification**: this app's QuickBooks Reports API and OAuth flow were built against Intuit's public API documentation; there is no live QuickBooks account in this environment to test against. Verify the full connect → sync → disconnect flow in production before relying on it, and check the Budget vs Actual report renders sensibly (it requires a Budget to already exist in QuickBooks under Settings > Budgeting).

### `QB_ENVIRONMENT`
- **Purpose**: `sandbox` or `production` (default `production` if unset). Only matters for testing against an Intuit Developer sandbox company before connecting the real one.
- **Set**: `wrangler secret put QB_ENVIRONMENT` (value `sandbox` or `production`).

### `DAYCARE_API_URL` + `DAYCARE_API_KEY`
- **Purpose**: Pulls budget/actual line items from the daycare app's own finance API into the Finance tab (`POST /admin/api/finance/daycare/sync`). Optional — the Finance tab's daycare section works with hand-entered rows regardless of whether this is configured.
- **`DAYCARE_API_URL` is the COMPLETE endpoint URL**, not a base domain — the daycare app's actual implementation is a Supabase Edge Function at its own specific path, e.g. `https://<project-ref>.supabase.co/functions/v1/finance-summary`. `src/daycare.js` fetches this URL directly with no path appended.
- **Live contract** (as actually implemented by the daycare app, 2026-07-16): `GET {DAYCARE_API_URL}`, header `X-Api-Key: <DAYCARE_API_KEY>` (the daycare app calls this same value `FINANCE_API_KEY` on its own side — same secret, different name), returning:
  ```json
  {
    "updated_at": "2026-07-16T14:32:00Z",
    "accounts": [],
    "budget": [
      { "period": "2026-07", "category": "Tuition Income", "type": "actual", "amount_cents": 8850000 },
      { "period": "2026-07", "category": "Tuition Income", "type": "budget", "amount_cents": 9000000 }
    ]
  }
  ```
  `period` is `YYYY-MM`, covering the current month + 12 prior (13 months). `type` is exactly `"actual"` or `"budget"`. All money in integer **cents**, not dollars. Return 401 for a missing/wrong key.
  - `accounts` is always `[]` — the daycare app has no bank/checking balance data; that stays manual-entry only.
  - Categories: Tuition Income, Payroll, Payroll Taxes, Workers Comp, Other Payroll Expenses, Other Expenses. Tuition Income/Payroll actuals are computed live from real billing/payroll data; everything else (all budget figures, and actuals for the last four categories) is an annual figure divided by 12, since the daycare app has no monthly-granular budget.
  - **Known limitation**: Payroll actual can't account for staff who left mid-window (no termination date tracked on the daycare side), so it may run slightly high for months after someone departs.
- **Set**: `wrangler secret put DAYCARE_API_URL` (the full Supabase function URL above) then `wrangler secret put DAYCARE_API_KEY` (same value as the daycare app's `FINANCE_API_KEY`).
- **Risk if leaked**: Read-only access to the daycare app's financial summary endpoint (as scoped by whatever the daycare app itself enforces on that key).

---

## Variables the Worker does not read

Four names that look like live credentials in an older read of this file, or in a Cloudflare
secret list, and are not. `handleAdminLogin` used to pull all four out of `env` and never
reference them again; they were deleted in v1.196.0 (P22-G/SEC22).

| Name | Reality |
|---|---|
| `FINANCE_PASSWORD` | **Never a login.** No env-var role password has ever existed. |
| `STAFF_PASSWORD` | Same. |
| `MEMBER_PASSWORD` | Same. |
| `ADMIN_EMAIL` | Never the `From:` address, despite what this file said until v1.196.0 — that is `EMAIL_FROM`. |

**⚠ The three `*_PASSWORD` names matter more than the dead code did.** Anyone reading them in a
secret list would reasonably conclude the app has per-role shared passwords, and would treat
rotating them as a security control. It is not one: every real credential lives in `app_users`,
plus `ADMIN_PASSWORD` for break-glass. A shared role password is deliberately not a thing here —
it would be an authentication path with no account behind it, so nothing to deactivate, nothing
to audit, and no way to tell afterwards whose login it was.

If any of these four are set on the live Worker, they can be deleted
(`wrangler secret delete <NAME>`) — nothing reads them. Deleting them is optional; leaving them
is only a documentation hazard, not an access one.

`test/admin-login-credentials.test.js` fails if a role-password env read reappears in the
login path.

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
