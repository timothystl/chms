# Finance production cutover runbook

Status as of 2026-09-15: **complete through Step 6; Step 7 drafted, not yet executed.** Steps 1-6
below are done: a real, isolated, Access-gated production Finance Worker and database exist.
`finance.timothystl.org` resolves and Cloudflare Access confirmed blocking unauthenticated
requests (verified both by curl against the live edge and, separately, by Andrew's own browser
once a local DNS cache from his earlier pre-route test cleared). Step 5 below was revised from its
original form during execution: Cloudflare Workers Custom Domains only provision DNS once the
route is actually deployed, so attaching Access to `finance.timothystl.org` *before* any route
existed (the original Step 4/5 order) was not actually possible — `ERR_NAME_NOT_RESOLVED` confirmed
this directly when Andrew first tried it. The corrected order still preserved the runbook's core
safety property (never let a route become reachable before Access gates it) — see Step 5. Step 7
brings this Access app to parity with the branding/policy fix already shipped on Finance staging
(see `digital-architecture` architecture/11-overhaul-readiness-and-execution-plan.md, Sept 10
entries) — it is a dashboard-only checklist, not yet run against production. What this runbook
deliberately does not cover (real data migration, user cutover, retiring the in-Connect module)
remains open, later work — see the closing section.

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

**Corrected order actually followed** (done, 2026-09-15), which still kept the same safety
property (never let a route sit reachable without Access gating it):

1. Added the real route to `wrangler.finance.jsonc` in a reviewed PR (chms PR #998):

   ```jsonc
   "routes": [
     { "pattern": "finance.timothystl.org", "custom_domain": true }
   ]
   ```

2. Merged, then dispatched `.github/workflows/deploy-finance.yml` at that commit — this is what
   actually created the DNS record and connected the domain to the Worker. (The same commit also
   carried chms PR #999's fix repointing `CONNECT_SERVICE` from the now-defunct `tlc-chms` name to
   `timothy-connect`, after Andrew renamed the production Connect Worker in the Cloudflare
   dashboard — see that PR for the full account.)
3. Andrew had already created the Cloudflare Access application for `finance.timothystl.org`
   *before* the route/DNS existed (during the failed first attempt at the original Step 4/5 order);
   that configuration was saved regardless of the hostname not yet resolving, and started enforcing
   automatically the moment DNS came online in step 2 above — no separate "attach Access" action was
   actually needed after the route deployed.
4. Confirmed: a request to `https://finance.timothystl.org` redirects to
   `https://timothystl.cloudflareaccess.com/cdn-cgi/access/login/...` with a proper
   `www-authenticate: Cloudflare-Access` header — verified directly against the live edge, and
   separately by Andrew once a stale local DNS cache from his earlier pre-route test cleared.

## Step 6 — Smoke-check and confirm isolation (done, 2026-09-15)

- `/health` is only reachable through Access, not anonymously — confirmed by the redirect above;
  there is no route on this Worker that bypasses Access.
- The Worker's `CONNECT_SERVICE`/`PAYROLL_SERVICE` bindings resolve to the real production Workers
  (`timothy-connect`, `tlc-newsletter-admin`), not staging — confirmed directly in
  `wrangler.finance.jsonc`.
- No route on the shared Connect Worker (`timothy-connect`) changed — this cutover only ever
  touched `wrangler.finance.jsonc`, a separate config targeting a separate Worker; it does not
  remove or redirect the existing in-Connect Finance UI.
- The new database is confirmed genuinely empty (no synthetic fixtures were applied to it — those
  are a staging-only, explicitly-applied step per `apps/finance/README.md`, never part of a
  migration) — verified with a direct read-only row-count query.

## Step 7 — Access app parity with staging (drafted 2026-09-15, not yet executed)

Production's Access application (`finance.timothystl.org`) was created and is enforcing (Step 5),
but nothing in Steps 1-6 gave it the branding, Google Workspace sign-in, or session-duration
settings that Finance *staging*'s Access app already received on 2026-09-10 in response to
Andrew's live complaint that a bare Access page "reads as leaving the site." Production is a
**separate Access application** from staging's — fixing staging did not touch this one. This step
is Cloudflare Zero Trust dashboard configuration only; no application code, schema, or deploy is
involved. Fill in each item below as it's actually done — this runbook records what happened, not
just what was planned (see Step 5's own correction above for why).

- [ ] **Policy fixed.** Confirmed production's policy is not `Include: Everyone` (staging had
  drifted there before its own fix). Set to: `Emails ending in @timothystl.org`
  _[ ]_ plus a named-exception list for staff without a church Workspace account: `___________`
  (leave blank if none needed). Done by: _______ on: _______.

- [ ] **Google Workspace added as sign-in method.** Not restricted at the identity-provider level —
  the policy above is what filters who's actually let in. Done by: _______ on: _______.

- [ ] **Login page branded.** Zero Trust → Settings → Custom Pages → Customize Login Page: org
  name, logo, header text, message set to match staging's. Confirmed applied to *this* application,
  not just an org-wide default. Done by: _______ on: _______.

- [ ] **Session duration shortened.** Application or policy session duration set to one hour or
  less (Configure → Session Duration), per the revocation requirement in `digital-architecture`
  architecture/04-identity-and-security.md. Value set: _______. Done by: _______ on: _______.

- [ ] **Offboarding procedure confirmed real.** Verified that removing a Finance staff member
  requires both suspending/deleting their Google Workspace account *and* an explicit Revoke in
  Zero Trust → Team & Resources → Users — neither alone is sufficient. Where this procedure is
  written down for whoever handles staff departures: _______.

- [ ] **Re-verified live.** From an incognito window, `https://finance.timothystl.org` shows the
  branded page with Google Workspace as a sign-in option; a non-`@timothystl.org`/non-listed email
  is rejected; the shortened session duration is in effect. Verified by: _______ on: _______.

## What this runbook deliberately does not cover yet

Migrating real financial data out of the shared Connect D1's `finance_*` tables into
`timothy-finance-db`, cutting real users over to `finance.timothystl.org` instead of the in-Connect
UI, and retiring the in-Connect Finance module are separate, later slices — each needs its own
contract, reconciliation, and rollback plan, per `apps/finance/README.md`'s own scope boundary.
This runbook only gets an empty, Access-gated, isolated production Worker and database to exist.
