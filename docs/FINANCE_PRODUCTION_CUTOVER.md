# Finance production cutover runbook

Status as of 2026-09-15: **complete through Step 6; Step 7 drafted, not yet executed.** All of Steps 1-6 below are done: a real,
isolated, Access-gated production Finance Worker and database exist. `finance.timothystl.org`
resolves and Cloudflare Access confirmed blocking unauthenticated requests (verified both by curl
against the live edge and, separately, by Andrew's own browser once a local DNS cache from his
earlier pre-route test cleared). Step 5 records the actual DNS/Access sequence. The Access application had been saved before
DNS resolved and began enforcing when the route deployed; failed DNS resolution was not evidence
that an Access application could not be created. Real data migration, user cutover and retirement
of the in-Connect module remain open; see the closing section.

## Scope and acceptance limits

Steps 1–6 establish production infrastructure. They do not establish report parity, user cutover,
data migration or retirement of legacy Finance. New Finance includes real contract reads and
Giving/payroll relays as well as synthetic readers; the older “staging-only” description is obsolete.

September 15 source review found that eager synthetic-row reads can fail against the empty
production database even on sections with live report resolvers. The shell also continues when
its role lookup fails, and its permission model is incomplete. Compensation has an additional
verified-role gate. These are source findings, not live incidents reproduced in this review.
See [Finance scope](../apps/finance/README.md); authenticated per-page and per-role verification
remains required before general user cutover.

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

The initial attempt encountered an unresolved hostname before the custom-domain route was
deployed. Andrew had nevertheless already saved the Access application. Once the route created
DNS, that saved policy enforced automatically. The earlier inference that Access could not be
preconfigured for an unresolved hostname was incorrect; do not repeat it as a platform limitation.

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
