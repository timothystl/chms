# Finance production cutover runbook

Status as of this writing: **not started.** `wrangler.finance.jsonc`,
`.github/workflows/deploy-finance.yml`, and `npm run validate:finance:prod` exist as prepared
config only — none of the steps below have been executed. This document exists so that when
Andrew is ready to actually start the cutover, the steps are ordered and each one's prerequisites
are explicit, rather than being decided live against production.

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

## Step 4 — Attach Cloudflare Access to the Worker, before any route

Deploy once with `routes: []` (as `wrangler.finance.jsonc` already has it) so the Worker exists but
is unreachable by any custom domain. In the Cloudflare dashboard, attach Access to
`timothy-finance-app` and confirm a sign-in gate actually blocks an unauthenticated request. This
is the same order staging followed for the same reason: a route must never go live before Access
is confirmed attached, or it is a second, unprotected door into Finance.

## Step 5 — Add the production route

Only after Step 4 is confirmed, add the real route back to `wrangler.finance.jsonc` in a reviewed
PR:

```jsonc
"routes": [
  { "pattern": "finance.timothystl.org", "custom_domain": true }
]
```

## Step 6 — Dispatch the production deploy

`.github/workflows/deploy-finance.yml`, dispatched with the approved `main` commit SHA and a
release reason — same discipline as `.github/workflows/deploy.yml` for the main Connect Worker.
Never dispatch it without Andrew's explicit production-release approval for that specific commit.

## Step 7 — Smoke-check and confirm isolation

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
