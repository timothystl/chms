# Stax Giving Mockup — walkthrough

Status: prototype for review, not shipped. Built on branch `claude/zen-thompson-4t3emh`. This is
reference material (see AGENTS.md's Documentation discipline), not a startup instruction.

## What this is

A second, optional giving path alongside the existing Tithe.ly → give.timothystl.org (Website
repo) flow, which nothing here touches. It demonstrates, end to end, in Stax **sandbox** mode
only:

1. A public giving form (`/give/stax-mockup`) using Stax.js tokenized fields for card/ACH, with a
   fund picker, one-time or recurring giving.
2. A verified webhook (`/api/mockup/stax-giving/webhook`) that records a completed Stax gift into
   Connect's **existing** `giving_entries` ledger — not a parallel table.
3. Donor matching (email, then phone) against existing active `people` rows.
4. A staff review queue (`/admin/giving/stax-mockup`) for gifts that didn't match anyone, with a
   link-to-person action.
5. A note on where Apple Pay's domain-verification file goes, without activating it.

Every response is labeled MOCKUP. No production Stax merchant account, and no change to
Tithe.ly's own sync into `giving_entries`.

## Try it right now, with no setup

This environment almost certainly has no live Stax sandbox key configured. That's fine — visit
`/give/stax-mockup` and submit a gift; the checkout endpoint detects the missing
`STAX_SANDBOX_API_KEY`/`STAX_SANDBOX_WEB_PAYMENTS_TOKEN` and runs in **demo mode**: it skips the
real Stax.js card fields and records the gift through the *exact same* `recordStaxGift()` path a
verified webhook would use. So the matching, ledger, and staff review queue are all fully
clickable today. Then visit `/admin/giving/stax-mockup` (signed in as admin/finance) to see any
gift that didn't match a person, and link it.

## Wiring up a real Stax sandbox

Set these (Worker secrets, not committed):

- `STAX_SANDBOX_API_KEY` — a Stax **sandbox** API key (server-only; never sent to the browser).
- `STAX_SANDBOX_WEB_PAYMENTS_TOKEN` — Stax's merchant-level web-payments token. Not a secret in
  the same sense as the API key (childcare-portal's `STAX_WEB_PAYMENTS_TOKEN` plays the identical
  role) — it's handed to the browser so Stax.js can mount hosted card fields — but it's still
  environment configuration, not something to hardcode.
- `STAX_GIVING_WEBHOOK_SECRET` — a random string you choose. Register the webhook in the Stax
  sandbox dashboard as:
  `https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=<STAX_GIVING_WEBHOOK_SECRET>`
  for `charge`, `refund`, and `void` events.

With those set, `/give/stax-mockup` loads real Stax.js hosted card fields and `checkout`/
`recurring` call Stax's real sandbox `/customer` and `/charge` endpoints (same request/response
shape as childcare-portal's `create-stax-charge`/`charge-stax-payment`, which verified them live
against production on 2026-08-26 — see that repo's `supabase/functions/charge-stax-payment/
index.ts`).

## Where gifts land — and why there's almost no new schema

`giving_entries` already carried `person_id` (nullable), `fund_id`, `source`, `processor`,
`external_txn_id`, `fee_cents`, and `reconcile_status` from the earlier deposit-reconciliation
work (migration 0031) — exactly the shape a second processor needs. A Stax mockup gift is a
normal row there: `source='stax_mockup'`, `processor='stax'`, `external_txn_id=<Stax transaction
id>`. A donor who gives through both Tithe.ly and this mockup reads as one giving history, not
two, and the existing year/month rollups (`giving_year_person_totals`,
`giving_monthly_fund_totals`) and whatever currently produces tax statements pick it up exactly
like a Tithe.ly-imported gift, with no changes needed on that side.

Migration 0053 (`migrations/0053_stax_giving_mockup.sql`) adds only what genuinely didn't exist:

- `funds.gl_code` — optional, for Finance if they want it. Not yet surfaced in the Manage Funds
  screen (`PUT /admin/api/funds/:id` accepts it if a caller sends it, same optional-field pattern
  as `budget_annual_cents`/`category`) — a follow-up if Finance actually wants to use it.
- `idx_giving_external_txn` — a unique index on `(processor, external_txn_id)`, which is what
  makes the webhook idempotent on redelivery, mirroring childcare-portal's stax-webhook
  contract.
- `giving_stax_customers` — person ↔ Stax customer id, so a returning donor giving from a new
  device (different browser, no local card-on-file) is still recognized once linked once.
- `giving_stax_recurring_schedules` — genuinely new: there was no existing "standing payment
  instruction" concept (`pledges` records an annual dollar commitment, not a schedule).
- `giving_stax_unmatched` — the staff review queue's raw payer detail (name/email/phone/card),
  one row per unmatched `giving_entries` row.

## Simplifications vs. a production build

- **Refund/void handling** is a straight-line negative `giving_entries` insert
  (`recordStaxReversal` in `src/stax-giving-mockup.js`). childcare-portal does the equivalent as
  one atomic Postgres RPC (`stax_record_reversal`) against a richer ledger. A production version
  of this feature should give that the same care — a single transaction, explicit partial-refund
  handling.
- **Recurring schedules**: the `/customer` and `/charge` calls mirror childcare-portal's *verified
  live* shapes. The `/schedule` call (`handleStaxGivingMockupPublicApi`'s `recurring` route) does
  **not** have that verification — childcare-portal's Stax integration never needed recurring
  billing (MDO schedules its own monthly charges). It's wrapped in try/catch so a wrong shape
  doesn't break the mockup; on failure the schedule is still recorded locally with status
  `pending_manual_setup`. Recheck against a live sandbox before relying on it.
- **Stax.js origins in the page's CSP** (`STAX_GIVING_MOCKUP_CSP` in `src/stax-giving-mockup.js`):
  `*.staxpayments.com` / `*.fattlabs.com` is a reasonable guess, not something verified against a
  live page load. Recheck with browser devtools' CSP violation reports once real sandbox keys are
  wired in, and narrow it back down.
- **No receipt email.** childcare-portal's webhook sends a branded receipt on every recovered
  charge. This mockup doesn't — worth adding before any real use.
- **Apple Pay is not active.** `/.well-known/apple-developer-merchantid-domain-association`
  serves an explanatory placeholder, not real verification content (only Stax/Apple can issue
  that, per registered domain). The wallet mount points exist in the form's markup
  (`#applePayMount`/`#googlePayMount`, same pattern as childcare-portal's parent-billing.js) but
  Stax.js will never populate them until a real domain is registered.

## Open decisions (unchanged from the original scope memo — still Andrew's to make)

- What domain hosts the real giving portal (decides where the Apple Pay verification file goes).
- Whether the Stax merchant account/sub-account here should be distinct from myMDO's, for
  tuition/giving accounting separation.
- What funds should exist at launch, and who owns adding/retiring one.
- Review cadence for the unmatched-gift queue (same-day vs. a weekly batch like the current
  Tithe.ly sync habit).
- Whether this eventually lives in Finance instead of Connect, once Finance is fully live.

## Files touched

- `migrations/0053_stax_giving_mockup.sql`, `src/db.js` (matching runtime migration)
- `src/stax-giving-mockup.js` (new — matching, ledger insert, webhook, public API, both HTML pages)
- `src/api-giving.js` (staff review-queue endpoints, same `isFinance` gate as the rest of Giving)
- `src/api-households.js` (optional `gl_code` write on the existing funds PUT route)
- `connect-worker.js` (routing)
- `test/stax-giving-mockup.test.js`
