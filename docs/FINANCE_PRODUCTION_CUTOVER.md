# Finance production cutover runbook

## September 23 cutover execution

The live destination inspection found migrations **0001–0004**, not the 0001–0006 recorded in
the older checkpoint. Private source/destination exports were restored locally and passed
SQLite integrity checks before applying the additive 0005–0009 migrations. The source is the
current `timothy-connect-db`, not the retained `tlc-volunteer-db`.

The cutover preserves 13 accounting tables plus the complete legacy `finance_settings` rows.
This avoids losing salary planner inputs, private overlays, and source-specific settings through
a partial translation. Existing handlers and contracts route these tables through
`financeStorageDb`; identity, Giving, and QuickBooks token tables stay in Connect. Website
continues to own payroll. Parallel native writer flags are not enabled.

Release procedure:
1. Deploy the tested Connect compatibility adapter with `FINANCE_STORAGE_MODE=copying`.
2. Export the frozen source and destination; restore both locally and verify integrity.
3. Prepare the exact copy with `scripts/finance-accounting-copy.mjs`; it refuses a nonempty
   destination or a missing/different column. Import only its allowlisted accounting tables.
4. Export the destination again and verify every row and column against the frozen source.
5. Deploy the tested main revision with `FINANCE_STORAGE_MODE=finance`, then deploy Finance.
6. Confirm production release revisions, authenticated reads, and the selected data owner.

Do not reverse the owner flag after accepting new writes without reconciling the newer data
back first. The retained source is a recovery snapshot, not an automatic failover database.
No backup, compensation record, or token belongs in Git.

Completed execution: Connect write-pause release `7995827500749be8f86cdfe5ec1cf165f402e409`
passed [deployment](https://github.com/timothystl/chms/actions/runs/35936148954).
The frozen source contained **13,411 rows across 14 tables**. The production destination copy
passed SQLite integrity checks, every full-row SHA-256 comparison, and all **13 accounting report
contract comparisons**. The activation release sets `FINANCE_STORAGE_MODE=finance`, restores
accounting writes onto the selected destination, and makes the standalone app the main Finance
entry from Connect. Advanced tools remain reachable and use the same selected accounting data.
Finance `1.0.0-alpha.53` also corrects production/staging labels and records its deployment SHA.

Alternate native draft/import writers are intentionally not enabled alongside the established
handlers. Their incomplete parallel schemas would create conflicting records. Production uses
the existing validated edit workflows against the migrated accounting tables instead.

## Current checkpoint — September 18, 2026

Infrastructure setup Steps 1–6 below completed September 15. They are a historical record;
do not recreate the database or repeat the initial route/Access setup for each release.
Production release `582c72a8f` succeeded
[September 18](https://github.com/timothystl/chms/actions/runs/35351838490).
Routine deployments use `deploy-finance.yml` with the tested main SHA/reason under current
[AGENTS.md](../AGENTS.md), without a new approval question.

Separate Worker/D1/domain and real contract/relay code are deployed. Data/user cutover and
legacy retirement remain unfinished. New Finance-owned writers are off by default. Safe
fixture reads and runtime role-failure denial have improved since September 15; remaining
permission/identity, fixture, import, and migration gaps are in
[Finance scope](../apps/finance/README.md).

The September 17 destination observation recorded migrations 0001–0006 and empty sampled
business tables; verify newer 0007–0009 schema and flags before dependent writes. Its source
inventory used retained `tlc-volunteer-db`, not current production `timothy-connect-db`.
Reconcile the current source before migrating. Step 7's Access parity checklist remains
unverified; blank boxes are not evidence of either current configuration or completion.

## Historical infrastructure setup and pending Access checklist

The procedures below preserve the original setup record. Current AGENTS.md supersedes their
per-step permission language. Use applicable technical checks when changing infrastructure,
not the completed setup sequence as a new release gate.

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
