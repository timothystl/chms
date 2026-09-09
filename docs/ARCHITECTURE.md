# Architecture

## Runtime boundaries

The production Worker `tlc-chms` starts at `tlc-volunteer-worker.js` and serves:

- Connect at `connect.timothystl.org`;
- public Serve routes at `serve.timothystl.org/*`;
- the legacy redirect at `chms.timothystl.org/*`;
- embedded Giving, Finance, and Scheduler modules.

Production binds D1 `tlc-volunteer-db` as `DB`, KV as `RSVP_STORE`, R2
`tlc-chms-photos` as `PHOTOS`, and a daily 14:00 UTC cron. `wrangler.toml` is the source
configuration; live attachment still outranks prose.

Connect staging runs the same entry point as Worker `timothy-connect-staging` (renamed 2026-09-09
from `breeze-proxy-worker-staging`) with separate D1, KV, and R2 resources and no cron. It is an
integration environment, not a production shadow.

The Finance staging Worker `timothy-finance-app-staging` starts at `apps/finance/shell.js` and uses
only D1 binding `FINANCE_DB`. Its sole configured hostname is
`finance-staging.timothystl.org`; Workers.dev and preview URLs are disabled, and Cloudflare Access
protects the whole Worker. It has no production route or production datastore binding.

## Source layout

- `src/api-*.js` contains server modules by capability.
- `src/frontend/` contains generated-in-page client modules; built-script validation must pass.
- `src/public/` contains public Serve presentation modules.
- `apps/finance/` contains the independent Finance alpha entry point, schema, fixtures, and version.
- `migrations/` is not a complete ledger of the production schema; runtime `initDb()` and
  `schema_fingerprint` remain part of current production initialization.

## Target direction

The supported target has four staff products: Church Website, Connect, Finance, and myMDO.
Physical separation proceeds through narrow versioned contracts and one authoritative writer per
business fact. A separate deployment does not by itself authorize data copying, dual writing, or a
production route.
