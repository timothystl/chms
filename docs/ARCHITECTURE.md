# Architecture

## Runtime boundaries

The production Worker `timothy-connect` starts at `connect-worker.js` and serves:

- Connect at `connect.timothystl.org`;
- public Serve routes at `serve.timothystl.org/*`;
- the legacy redirect at `chms.timothystl.org/*`;
- embedded Giving, Finance, and Scheduler modules.

Production binds D1 `timothy-connect-db` as `DB`, KV `timothy-connect-kv` as `KV`, R2
`timothy-connect-photos` as `PHOTOS`, and a daily 14:00 UTC cron. `wrangler.toml` is the source
configuration; live attachment still outranks prose.

Connect staging runs the same entry point as Worker `timothy-connect-staging` (renamed 2026-09-09
from `breeze-proxy-worker-staging`) with separate D1, KV, and R2 resources and no cron. It is an
integration environment, not a production shadow.

The Finance staging Worker `timothy-finance-app-staging` starts at `apps/finance/shell.js` and uses
only D1 binding `FINANCE_DB`. Its sole configured hostname is
`finance-staging.timothystl.org`; Workers.dev and preview URLs are disabled, and Cloudflare Access
protects the whole Worker. It has no production route or production datastore binding.

## Two Finance implementations — September 18, 2026

Legacy Finance remains inside Connect (`src/api-finance.js`, `src/frontend/js-finance.js`),
with real accounting tables and `finance_settings` in `timothy-connect-db`.
The old `tlc-volunteer-db` is a retained pre-cutover resource, not the current source.

New Finance under `apps/finance/` has separate production and staging Workers/D1.
Production is `timothy-finance-app` with `timothy-finance-db` at `finance.timothystl.org`.
Its production config binds Connect and Website payroll services. Real report contracts and
legacy-workflow relays coexist with fixture fallback/unavailable sections and off-by-default
Finance-owned writers. Migration tooling exists; authoritative data and reader/writer cutover
remain unfinished. QuickBooks schema/design code now exists but is unwired.

Check [Finance's current scope](../apps/finance/README.md), route manifest, handlers, and
feature flags before calling a workflow complete. A renderer or deployed commit does not
establish real data, enabled writes, role parity, or user acceptance.

## Source layout

**Entry points and shared plumbing:**

| File | Purpose |
|---|---|
| `connect-worker.js` | Production Worker entry point; routes to every module below. |
| `src/api-chms.js` | The main admin API dispatcher for Connect/Giving. Holds `ACCESS_GATE` (see below) and delegates by URL segment to the handler modules listed next. |
| `src/auth.js` | Session cookie signing/verification (`vol_auth`, HMAC-SHA256), login/logout, `app_users` lookups. |
| `src/api-utils.js` | Shared helpers used across every `api-*.js` module: role/permission resolution, anonymous-Giving safety checks, misc formatting. |
| `src/db.js` | Schema initialization (`initDb()`) and `schema_fingerprint` — production schema setup is **not** fully captured by the numbered `migrations/` ledger; see `AGENTS.md`. |
| `src/access-jwt.js` | Verifies the `Cf-Access-Jwt-Assertion` header Cloudflare Access attaches to requests — used by the contract endpoints below, independently of session cookies. |

**Domain handlers** (each dispatched from `api-chms.js` by URL segment):

| File | Owns |
|---|---|
| `src/api-people.js` | People, follow-up, archive, Brevo sync, photos. |
| `src/api-households.js` | Households, organizations, tags, funds. |
| `src/api-giving.js` | Giving entries, batches, quick entry. |
| `src/api-finance.js` | The **old, production** Finance implementation (QuickBooks, church/daycare/property ledgers, budgets, compensation planner) — see "Two Finance codebases" above. |
| `src/api-tuition-aid.js` | Tuition Aid Planner (Finance-only feature, gated the same way as Finance). |
| `src/api-scheduler.js` | Scheduler & volunteer sign-up. |
| `src/api-reports.js` | Reports, engagement, prayer. |
| `src/api-import.js` | Import, config, register/export, Breeze sync. |
| `src/api-admin.js` | General admin API handlers. |
| `src/api-mobile.js` | Backs the phone-optimized mobile admin experience (`src/mobile-admin-html.js`). |
| `src/api-emails.js` | Birthday/anniversary emails via Resend. |
| `src/api-intake.js` | Server-to-server endpoints called **from** the `website` repo's Workers (not a browser). |
| `src/api-contracts.js` + `src/api-contracts-service.js` | Versioned cross-product contracts (see below) — the human-role-gated admin route and the shared-secret server-to-server route, respectively, for the same contracts. |

**Frontend and presentation:**

| File | Purpose |
|---|---|
| `src/html-chms.js` | The Connect/ChMS single-page app shell, service worker, and manifest. |
| `src/frontend/*.js` | Generated-in-page client modules injected into the shell (e.g. `js-finance.js`, the old production Finance UI). Built-script validation (`.github/scripts/check-built-scripts.js`) must pass after any change here. |
| `src/mobile-admin-html.js` | The separate mobile-optimized admin page. |
| `src/scheduler-html.js` / `src/scheduler-inline.js` | The Scheduler app's full page and its inline-embed variant. |
| `src/html-templates.js` | Login and public-signup page templates. |
| `src/legal-pages.js` | Public Privacy Policy / Terms of Service pages. |

**Integrations:**

| File | Purpose |
|---|---|
| `src/breeze.js` | Breeze ChMS API client (returns `null` when unconfigured, never throws). |
| `src/quickbooks.js` | QuickBooks Online OAuth + Reports/Query API client (old Finance only). |
| `src/daycare.js` | Client for the separate MDO daycare app's own finance API. |
| `src/push-sender.js` | Web Push (VAPID/RFC 8291) sender, pure Web Crypto, no npm dependency. |
| `src/lectionary.js` | Bundled LCMS lectionary calendar data. |
| `src/giving-rollups.js` | Maintains compact Giving read-models (year/month rollups) so dashboards don't re-aggregate the raw ledger. |

**Finance staging** (`apps/finance/`) has its own detailed file-by-file map in
`apps/finance/README.md` — that file also carries the full alpha-by-alpha build history.

## Request authorization: `ACCESS_GATE`

Every admin API request in `src/api-chms.js` passes through one array of rules, `ACCESS_GATE`,
matched in order (first match wins):

```js
const ACCESS_GATE = [
  { match: (s) => s.startsWith('giving') || s.startsWith('reports/giving'), item: 'giving' },
  { match: (s) => s.startsWith('contracts/connect-giving-summary'), item: 'giving' },
  { match: (s) => s.startsWith('contracts/finance-data-status'), item: 'finance' },
  { match: (s) => s.startsWith('tuition-aid'), item: 'tuitionaid' },
  { match: (s) => s.startsWith('finance'), item: 'finance' },
  // ... attendance, followups, audit, register, reports
];
```

Each rule maps a URL segment prefix to a permission **item** (`giving`, `finance`, `tuitionaid`,
etc.). The server-side permission matrix (roles: `admin`, `finance`, `staff`, `council`, `member`,
`volunteer`, `compensation`) resolves whether the current role can view/edit that item; a
non-`GET` request additionally requires edit access. **A URL segment matching no rule reaches its
handler with no permission check at all** — when adding a new segment (especially a new
`contracts/*` route), add an `ACCESS_GATE` rule for it explicitly. This was missed once already
for `contracts/finance-data-status-v1` and caught only during review.

UI hiding is never authorization — every check that matters lives here or in the handler itself,
never only in what the frontend chooses to render.

## Cross-product contracts

Finance separation (see the architecture repo's overhaul plan) proceeds through small, versioned,
one-way contracts rather than either app reaching into the other's database. Two exist today, and
both follow the same shape — use them as the template for the next one:

1. **Producer** (`src/api-contracts.js`, in this repo, since Connect owns the source data): a pure
   `buildX(db, {...})` function that runs a bounded query and returns the exact contract shape,
   plus a `respondWithX(...)` wrapper that validates its own output against the shared consumer
   validator before ever returning it (fail closed — a producer bug must never reach Finance as a
   malformed contract).
2. **Two entry points to the same producer**: a human-role-gated route inside `api-chms.js` (via
   `ACCESS_GATE`, above) for admin/debugging use, and a shared-secret (`X-Contract-Key` /
   `FINANCE_CONTRACT_API_KEY`) server-to-server route in `src/api-contracts-service.js`, which is
   what Finance's Worker actually calls via a Cloudflare service binding.
3. **Consumer** (`apps/finance/*-consumer.js`): a pure `validateX`/`acceptX` pair with no I/O —
   closed-shape validation (`additionalProperties: false`-style exact key checks), so producer and
   consumer can never silently drift apart.
4. **Client/transport** (`apps/finance/*-client.js`): calls the server-to-server route via the
   `CONNECT_SERVICE` binding, and **never throws** — every failure mode (binding/key not
   configured, network error, non-200, malformed JSON, contract-validation failure) resolves to
   `{ ok: false, reason }` so the caller can fall back to a committed synthetic fixture instead of
   breaking the page.
5. The caller (typically `apps/finance/shell.js`) tries live first, falls back to synthetic on any
   failure, and always labels which happened in the rendered UI ("live from Connect" vs. "synthetic
   fixture") — never silently.

Existing contracts: `connect.giving-summary.v1` (aggregate Giving data) and
`connect.finance-data-status.v1` (import-log recency + QuickBooks connection presence, never
tokens). Their JSON Schemas live in `contracts/*.schema.json`.

## Target direction

The supported target has four staff products: Church Website, Connect, Finance, and myMDO.
Physical separation proceeds through narrow versioned contracts and one authoritative writer per
business fact. A separate deployment does not by itself authorize data copying, dual writing, or a
production route.
