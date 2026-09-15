# Finance production cutover runbook

Status as of 2026-09-15: **in progress.** Steps 1-4 are done — the real production D1
(`timothy-finance-db`) exists, migrations 0001-0004 are applied and confirmed empty, and
`timothy-finance-app` has been deployed once to production with `routes: []` (unreachable by any
domain). Step 5 is revised below from its original form: Cloudflare Workers Custom Domains only
provision DNS once the route is actually deployed, so attaching Access to `finance.timothystl.org`
*before* any route existed (the original Step 4/5 order) was not actually possible —
`ERR_NAME_NOT_RESOLVED` confirmed this directly when Andrew tried it. The corrected order still
preserves the runbook's core safety property (never let a route become reachable before Access
gates it) — see Step 5.

## Why this is a runbook and not a single deploy

`apps/finance` today is a staging-only shell serving synthetic fixture data
(`apps/finance/README.md`). Its own scope note is explicit: "Existing Finance remains operational
in the current Connect Worker. Moving a reader, writer, route, identity flow, or database table
requires a later reviewed slice with contract, reconciliation, and rollback evidence." Standing up
a production Finance Worker is that later slice. It is infrastructure creation and a real cutover
of a live financial system, not a code change — each step below needs its own go-ahead, not a
single blanket approval to "start Finance production."

## Step 1 — Create the real production D1 database

A Cloudflare account action, not a code change. Someone with Cloudflare dashboard/API access
(Andrew, or a session with his explicit go-ahead for this specific step) runs:

```sh
npx wrangler d1 create timothy-finance-db
```

Record the returned `database_id`. Do **not** reuse the staging database
(`timothy-finance-db-staging`, `59dfc662-9f43-469f-936e-d7a0d3247036`) — production needs its own,
per the same isolation `apps/finance/migrations` already assumes.

## Step 2 — Replace the placeholder database_id

Open a normal reviewed PR that replaces the placeholder in `wrangler.finance.jsonc`
(`00000000-0000-0000-0000-000000000000`) with the real `database_id` from Step 1. Nothing else in
that file should need to change. `npm run validate:finance:prod` must pass before merge.
`.github/workflows/deploy-finance.yml` refuses to deploy while the placeholder is still present, as
a backstop against dispatching it before this step happens for real.

## Step 3 — Apply the Finance migrations to the new database

Once Step 2 is merged:

```sh
npx wrangler d1 migrations apply timothy-finance-db --remote --config wrangler.finance.jsonc
```

This starts the production Finance database empty, exactly like the staging one did — it does not
copy any data from the shared Connect D1's `finance_*` tables. See
`architecture/evidence/2026-09-13-finance-schema-compatibility-diff.md` in the
`digital-architecture` repository for what does and does not carry over cleanly if/when a real data
migration from the old `finance_*` tables is scoped as its own later slice.

## Step 4 — Deploy once with an empty route (done, 2026-09-15)

Deploy with `routes: []` so the Worker exists in production but is unreachable by any custom
domain. This was the safe first deploy — no route, no exposure — and it succeeded.

## Step 5 — Add the production route, then attach Access immediately

Originally this runbook called for attaching Cloudflare Access to `finance.timothystl.org` in the
dashboard *before* adding any route, on the assumption that a hostname could be gated independent
of whether a Worker route existed yet. That assumption was wrong for this account's setup:
Cloudflare Workers Custom Domains (`"custom_domain": true`, the same mechanism
`wrangler.finance.staging.jsonc` already uses) only provision a real DNS record once the route is
actually deployed — there is no way to pre-stage Access against a hostname that doesn't resolve
yet. Andrew confirmed this directly (`finance.timothystl.org` returned `ERR_NAME_NOT_RESOLVED`
before any route existed).

**Corrected order**, which still keeps the same safety property (never let a route sit reachable
without Access gating it):

1. Add the real route to `wrangler.finance.jsonc` in a reviewed PR:

   ```jsonc
   "routes": [
     { "pattern": "finance.timothystl.org", "custom_domain": true }
   ]
   ```

2. Merge, then dispatch `.github/workflows/deploy-finance.yml` at that commit (this is what
   actually creates the DNS record and connects the domain to the Worker).
3. **Immediately** after that deploy finishes — before sharing or using the URL — attach Cloudflare
   Access to `finance.timothystl.org` in the dashboard, mirroring the staging app's policy.
4. Confirm a sign-in gate actually blocks an unauthenticated request (a private/incognito visit to
   `https://finance.timothystl.org` should land on a Cloudflare Access login page, not any content).

Only once step 4 above is confirmed should the URL be used or shared with anyone.

## Step 6 — Smoke-check and confirm isolation

- Confirm `/health` responds only through Access, not anonymously.
- Confirm the Worker's `CONNECT_SERVICE`/`PAYROLL_SERVICE` bindings resolve to the real production
  Workers (`tlc-chms`, `tlc-newsletter-admin`), not staging.
- Confirm no route on the shared Connect Worker (`tlc-chms`) changed — this cutover stands up a new
  surface, it does not yet remove or redirect the existing in-Connect Finance UI.
- Confirm the new database is genuinely empty (no synthetic fixtures were applied to it — those are
  a staging-only, explicitly-applied step per `apps/finance/README.md`, never part of a migration).

## What this runbook deliberately does not cover yet

Migrating real financial data out of the shared Connect D1's `finance_*` tables into
`timothy-finance-db`, cutting real users over to `finance.timothystl.org` instead of the in-Connect
UI, and retiring the in-Connect Finance module are separate, later slices — each needs its own
contract, reconciliation, and rollback plan, per `apps/finance/README.md`'s own scope boundary.
This runbook only gets an empty, Access-gated, isolated production Worker and database to exist.
