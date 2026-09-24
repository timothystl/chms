# Stax Giving Mockup — walkthrough

Status: prototype for review, not shipped. Built on branch `claude/zen-thompson-4t3emh`. This is
reference material (see AGENTS.md's Documentation discipline), not a startup instruction.

## What this is

A second, optional giving path alongside the existing Tithe.ly → give.timothystl.org (Website
repo) flow, which nothing here touches. It demonstrates, end to end, in Stax **sandbox** mode
only:

1. A public giving form, **served from the Website repo** at `give.timothystl.org/stax-mockup`
   (not from this repo — see "Where the public form actually lives" below), using Stax.js
   tokenized fields for card/ACH, with a fund picker, one-time or recurring giving.
2. A verified webhook (`/api/mockup/stax-giving/webhook`, this repo) that records a completed
   Stax gift into Connect's **existing** `giving_entries` ledger — not a parallel table.
3. Donor matching (email, then phone) against existing active `people` rows.
4. A staff review queue (`/admin/giving/stax-mockup`, this repo) for gifts that didn't match
   anyone, with a link-to-person action.
5. A note on where Apple Pay's domain-verification file goes (Website repo now — that's the
   domain a real Stax registration would use), without activating it.

Every response is labeled MOCKUP. No production Stax merchant account, and no change to
Tithe.ly's own sync into `giving_entries`.

## Where the public form actually lives

Andrew's call: the real giving portal needs to be on the main website domain, not
`connect.timothystl.org` (which also sits behind Cloudflare Access at the edge — dashboard
config outside any repo, and the reason a first pass of this mockup 401'd for him there). The
public form and its Apple Pay placeholder now live in the **Website repo**, at
`give.timothystl.org/stax-mockup` — see that repo's `docs/STAX_GIVING_MOCKUP.md` (or the
equivalent doc there) for its half of this walkthrough. This repo (`chms`/Connect) still owns
everything data-related, exactly per the original scope memo's reasoning ("the gift data,
matching, and statements still belong to chms"):

- `GET /api/mockup/stax-giving/funds` and `webpayments-token`
- `POST /api/mockup/stax-giving/checkout` and `recurring`
- `POST /api/mockup/stax-giving/webhook` (the verified Stax webhook)
- the staff review queue at `/admin/giving/stax-mockup`

The website's form calls the first three **cross-origin** (browser JS, not a server-side proxy)
— see `corsHeadersFor()`/`CORS_ALLOWED_ORIGINS` in `src/stax-giving-mockup.js`, which allowlists
`https://give.timothystl.org` and `https://timothystl.org` specifically (not `*`: `checkout` can
move money and both routes write donor-identifying data).

## Try it right now, with no setup

This environment almost certainly has no live Stax sandbox key configured. That's fine — the
Website repo's `give.timothystl.org/stax-mockup` form still works: the checkout endpoint here
detects the missing `STAX_SANDBOX_API_KEY`/`STAX_SANDBOX_WEB_PAYMENTS_TOKEN` and runs in **demo
mode**, skipping real Stax.js card fields and recording the gift through the *exact same*
`recordStaxGift()` path a verified webhook would use. So the matching, ledger, and staff review
queue are all fully clickable today. Then visit `/admin/giving/stax-mockup` on this repo's own
domain (signed in as admin/finance) to see any gift that didn't match a person, and link it.

## Wiring up a real Stax sandbox

Set these on **this repo's** Worker (secrets, not committed):

- `STAX_SANDBOX_API_KEY` — a Stax **sandbox** API key (server-only; never sent to the browser).
- `STAX_SANDBOX_WEB_PAYMENTS_TOKEN` — Stax's merchant-level web-payments token. Not a secret in
  the same sense as the API key (childcare-portal's `STAX_WEB_PAYMENTS_TOKEN` plays the identical
  role) — it's handed to the browser (now cross-origin, from the Website form) so Stax.js can
  mount hosted card fields — but it's still environment configuration, not something to hardcode.
- `STAX_GIVING_WEBHOOK_SECRET` — a random string you choose. Register the webhook in the Stax
  sandbox dashboard as:
  `https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=<STAX_GIVING_WEBHOOK_SECRET>`
  for `charge`, `refund`, and `void` events.

With those set, the Website form loads real Stax.js hosted card fields and its `checkout`/
`recurring` calls hit Stax's real sandbox `/customer` and `/charge` endpoints on this repo's
Worker (same request/response shape as childcare-portal's `create-stax-charge`/
`charge-stax-payment`, which verified them live against production on 2026-08-26 — see that
repo's `supabase/functions/charge-stax-payment/index.ts`).

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

## v2: multi-fund gifts, richer contact fields, curated public funds

Built in response to Andrew's live click-through of v1 (a screenshot of Tithe.ly's own checkout
as the reference bar) plus explicit research asks. What changed:

- **Multiple gifts, one charge, one card swipe.** The form now sends `gifts: [{fund_id, amount},
  ...]`, not a single fund/amount pair. `recordStaxGift()` turns that into one `giving_entries`
  row per fund, sharing a batch/person/payer, and sharing one Stax transaction: a single-fund
  gift keeps its external_txn_id exactly as Stax gave it, but each row of a multi-fund gift gets
  `<txnId>-f<fundId>` appended — same shape childcare-portal's `billing_payments` already uses
  for a split payment (`<transId>-inv<n>`), not a new pattern. The webhook's idempotency check
  (`existing.*.LIKE '<txnId>-f%'`) treats the whole group as one unit, so a redelivery can't
  double-record half of a multi-fund gift. **Partial refunds of a multi-fund gift are refused**
  (409, "needs manual handling") rather than guessed at — which fund absorbs a partial refund has
  no single right answer; a full refund/void reverses every split.
- **First name / last name, not one guessed-apart name field.** `payer_first_name`/
  `payer_last_name` travel through the whole path (form → checkout/recurring → Stax `/customer`
  call → webhook meta → `giving_stax_unmatched`) instead of one `payer_name` string the old code
  split on whitespace to build a Stax customer record. `payer_name` is still populated (as
  `first + ' ' + last`) for anything still reading it.
- **Address fields** (`payer_address_line1`/`city`/`state`/`zip`) are collected and shown in the
  staff review queue, but **not** used for matching — matching is still email-then-phone only
  (see `matchPersonForPayer`). Fuzzy address-based matching is a real feature, not a quick
  addition; flagged here rather than built half-right.
- **Cover the fees.** `cover_fees: true` adds an ESTIMATED fee (a flat percentage, 2% by
  default) to the total and rides on the first gift
  line. Andrew's own approximation of what Stax actually charges (real interchange + $0.12 per
  transaction, which he estimates nets to roughly 2% of a typical gift) — deliberately a single
  flat percentage rather than interchange-plus-fixed-cents, since interchange itself varies by
  card network/type and can't be known before a real charge. The rate that actually gets stored
  on a real charge (`fee_cents`) always comes from Stax's own response (`total_fees`), never
  this estimate.
  Finance/admin staff change the percentage on `/admin/giving/stax-mockup/funds` (linked from
  Giving → Recurring). It is stored as `stax_cover_fee_rate` in `giving_settings`, capped at
  10%, returned to the public form by `/funds`, and used by `checkout`/`recurring` — so a
  change takes effect on the next form load without a deploy.
- **Memo** (`memo`, up to 500 chars) is stored on the ledger row's `notes` and, on a real charge,
  sent to Stax as the transaction memo.
- **Wider recurring frequencies.** `weekly`/`biweekly`/`twice_monthly` (Tithe.ly's own "1st &
  15th")/`monthly` — was `weekly`/`monthly` only. A multi-fund recurring signup creates one
  `giving_stax_recurring_schedules` row per fund, tagged with a shared `schedule_group` (blank
  for every single-fund schedule, before and after this change).
- **`public_giving` fund flag** (migration 0054) — separate from `active` on purpose. Before
  this, the public `funds` endpoint returned every `active` fund, which in production is every
  budget line, not just the handful meant for donors ("the funds list took quite a while to
  load... it loaded every single budget line" — Andrew's own report clicking through v1). Staff
  now curate the public list at `/admin/giving/stax-mockup/funds`
  (`GET`/`POST /admin/api/giving/stax-mockup/funds`, `isFinance`-gated for the write). Defaults
  to **off** for every fund — nothing shows on the public form until staff opts funds in there.
- **Required-fields decision, made explicitly rather than by default:** first name, last name,
  and email are required; phone and address are optional. Donation-form research says every
  required field measurably costs completions (a cited figure: cutting fields boosted conversion
  39% in one study) against the case for collecting more to match donors better — this is where
  that tradeoff was drawn, not a compromise nobody chose.

## Simplifications vs. a production build

- **Refund/void handling** is a straight-line negative `giving_entries` insert
  (`recordStaxReversal` in `src/stax-giving-mockup.js`). childcare-portal does the equivalent as
  one atomic Postgres RPC (`stax_record_reversal`) against a richer ledger. A production version
  of this feature should give that the same care — a single transaction, explicit partial-refund
  handling (today refused outright for a multi-fund original, see the v2 section above).
- **Recurring schedules**: the `/customer` and `/charge` calls mirror childcare-portal's *verified
  live* shapes. The recurring-schedule call (`handleStaxGivingMockupPublicApi`'s `recurring`
  route) does **not** have that verification — childcare-portal's Stax integration never needed
  recurring billing (MDO schedules its own monthly charges), and Stax's own docs disagree with
  themselves on the endpoint path: docs.staxpayments.com currently names `POST
  /scheduled-invoices` (tried first, as the more likely current one); an older reference names
  `POST /invoice/schedule/`. Neither request/response schema could be confirmed via automated
  fetch — the interactive docs site is JS-rendered. It's wrapped in try/catch so a wrong guess
  doesn't break the mockup; on failure the schedule is still recorded locally with status
  `pending_manual_setup`. Verify directly against a live sandbox (or ask the Stax account rep for
  the current spec) before relying on it.
- **Stax.js origins for the page's CSP** are the Website repo's problem now, not this repo's —
  see its own doc for that flag. This repo's CSP is unchanged (its only page here, the staff
  review queue, needs nothing beyond `self`).
- **Gift receipt email** (`sendGiftReceiptEmail` in `src/stax-giving-mockup.js`) fires once a
  charge is actually confirmed — the synchronous checkout success path and the webhook's
  charge-success path, never demo mode's simulated gift or the recurring-signup endpoint (no
  charge has happened there yet). Reuses the same Brevo transactional-email path the
  giving-letter/thank-you-receipt features already use in production
  (`sendBrevoTransactionalEmail` in `src/api-emails.js`) — no new email vendor, and the same
  `church_from_name`/`church_from_email`/`church_ein` config keys and tax-deductibility wording
  the giving-letter templates use. Per-fund line items, memo, and total; idempotent the same way
  the ledger write is (a webhook redelivery of an already-recorded charge sends nothing). A
  missed receipt email never fails the gift itself — the ledger write already succeeded by the
  time this runs, and it's wrapped in its own try/catch.
- **Apple Pay is not active.** The Website repo's `/.well-known/apple-developer-merchantid-domain-
  association` serves an explanatory placeholder, not real verification content (only Stax/Apple
  can issue that, per registered domain). Its form's wallet mount points
  (`#applePayMount`/`#googlePayMount`, same pattern as childcare-portal's parent-billing.js) exist
  but Stax.js will never populate them until a real domain is registered.
- **CORS allowlist is hand-maintained.** `CORS_ALLOWED_ORIGINS` in `src/stax-giving-mockup.js`
  lists `give.timothystl.org`/`timothystl.org` by hand — if the real giving portal ends up on a
  different subdomain, this list (and the Stax-side allowlist, if any) needs updating too.

## Open decisions (updated from the original scope memo — still Andrew's to make)

- ~~What domain hosts the real giving portal~~ — **resolved**: the main website
  (`give.timothystl.org`), not `connect.timothystl.org`. Still decides where the Apple Pay
  verification file goes (Website repo).
- ~~Whether the Stax merchant account/sub-account here should be distinct from myMDO's, for
  tuition/giving accounting separation~~ — **resolved, against**: Andrew checked — a separate
  Stax sub-account/store means a second monthly platform fee just to get separate settlement,
  and isn't worth it. myMDO and Giving stay on the one shared Stax merchant account. Practical
  effect: Stax will settle both as **one blended bank deposit** per payout, not two — the bank
  line alone can't be split into "tuition" vs. "giving." The bookkeeper reconciles it the same
  way `giving_deposits` was already built to handle a blended source (`source='mixed'`, migration
  0031/0032): take the Stax payout/settlement report for that date, cross-reference it against
  myMDO's own transaction list (childcare-portal) and this repo's `giving_entries` for the same
  date to get the tuition-portion and giving-portion subtotals, confirm they sum to the bank
  deposit total, and record the one bank deposit as `mixed` with a `giving_deposit_lines` entry
  covering only the giving portion (the tuition portion isn't this repo's ledger at all — it's
  matched and booked on myMDO's own side). No schema change needed; this is a reconciliation
  habit, not a missing feature.
- What funds should exist at launch, and who owns adding/retiring one.
- Review cadence for the unmatched-gift queue (same-day vs. a weekly batch like the current
  Tithe.ly sync habit).
- Whether this eventually lives in Finance instead of Connect, once Finance is fully live.
- **Donor login** (see giving history, manage/cancel a recurring gift) — a real, explicitly
  requested feature, but a different scope than this form redesign: it needs actual
  authentication for donors (who are not staff `app_users`), which is a standing decision, not a
  quick addition. Not started.

## Files touched (this repo)

- `migrations/0053_stax_giving_mockup.sql`, `migrations/0054_stax_giving_v2.sql`, `src/db.js`
  (matching runtime migrations)
- `src/stax-giving-mockup.js` (matching, multi-fund ledger insert/reversal, webhook, public data
  API, staff review page, funds-visibility admin page, CORS allowlist for the Website form's
  cross-origin calls)
- `src/api-giving.js` (staff review-queue endpoints + funds-visibility endpoints, same
  `isFinance` gate as the rest of Giving)
- `src/api-households.js` (optional `gl_code` write on the existing funds PUT route — unrelated
  to `public_giving`, which has its own dedicated endpoint above since it needs a fast bulk save
  across many funds, not a one-at-a-time edit)
- `connect-worker.js` (routing)
- `test/stax-giving-mockup.test.js`

The public form and Apple Pay placeholder that used to live here moved to the Website repo — see
that repo's own doc/PR for its files touched.
