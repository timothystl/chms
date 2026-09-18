# Timothy Finance Alpha

This directory is the separately deployable Finance application boundary being built inside the
existing CHMS repository. It begins at `1.0.0-alpha.1`; legacy Connect/Finance version history is
preserved separately.

## Current scope — September 15, 2026

Finance has independent staging and production Workers/D1 databases. Production infrastructure
was deployed September 15; see [the runbook](../../docs/FINANCE_PRODUCTION_CUTOVER.md).
`finance.timothystl.org` and `finance-staging.timothystl.org` are separate surfaces; workers.dev
and preview URLs are disabled in production configuration. The runbook records Access protection
and an empty production database, not acceptance of every authenticated report.

The application has real Connect contract paths for Giving, data status, accounts, budget,
church reports (including the multi-year trend), balance sheet (including the multi-year
position), daycare, property valuation and compensation. All four Church Report sub-pages
(Overview, Income & expense detail, Multi-year trend, Budget vs actual) are now live-first with
synthetic fallback -- the trend page was the last one left on the synthetic reader; see
`church-report-service.js`'s `resolveChurchTrend` and `connect.finance-church-report-trend.v1`.
All three Balance Sheet sub-pages (Position, Account detail, Multi-year position) are likewise
now live-first with synthetic fallback -- the multi-year page was the last one left on the
synthetic reader; see `balance-sheet-service.js`'s `resolveBalanceSheetTrend` and
`connect.finance-balance-sheet-trend.v1`. Its `netAssetsCents` is total equity after the same
Designated-Funds-as-Equity reclassification the single-year contract already applies, matching
what the single-year 'position' page already labels "Net assets" for the same fiscal year, not a
separately recomputed assets-minus-liabilities figure. Property operating, reserves, ledgers, and
forecast (a straight port of the AHRA-imported `finance_property_budget_monthly` budget/plan
table, not a computed run-rate projection despite the page's label) joined main in #1002 and a
follow-on PR respectively, after the production deployment inspected in this review; do not infer
they are deployed. Giving writes relay to Connect and payroll operations relay to Website. Neither
relay transfers ownership of those records to Finance. Four CSV import routes (Church, Balance,
Daycare, Property Budget — see `csv-import-service.js` and the Alpha.43 entry below) write to
Finance's own database, but are gated off by default and not reachable in production.

Compensation's four sub-pages split unevenly on whether a real substitute for their synthetic
role-level fixture exists: Plan and Council snapshot both have an honest live version, gated to
admin/council/compensation exactly like the underlying `connect.finance-compensation.v1` roster
fetch; Benchmarks and Benefits & taxes stay synthetic for every role, permanently, because no real
data anywhere in Connect can honestly back them (see `compensation-pages.js`'s comment above its
`'benchmarks'`/`'benefits'` branches for exactly what was checked and why a real per-role
benchmark salary or benefits-component dollar breakdown does not exist). Council's own real rollup
carries only real, already-stored aggregate facts (worker count, entered/unentered current-pay
counts and totals) -- it never reconstructs the synthetic view's `benefitsSharePct` or
`weightedAdjustmentPct`, which have no real per-worker equivalent. Both Plan's per-person worker
table/KPIs and Council's rollup drop any worker flagged `hideFromCouncil` from what a `council`-role
viewer specifically sees, matching the same rule the real Salary Planner already enforces for that
role -- `filterCompensationWorkersForViewer`/`summarizeCompensationWorkers` in
`compensation-report-service.js` are the shared implementation both pages call, so the two can
never drift out of sync on who council is allowed to see.

**Compensation Planner editing/saving (September 17, 2026, code-complete but OFF by default).**
A real EDIT/SAVE write path now exists for the Compensation Planner, writing to Finance's OWN D1
(`finance_compensation_worker_plan`, migration 0007) instead of the flat, worker-less
`finance_compensation_plan` synthetic-report table (0002) -- the first route in this app that
writes to Finance's own database rather than relaying elsewhere (see `route-manifest.js`'s and
`compensation-plan-write-service.js`'s header comments for why that's the deliberate target
architecture here, not a regression of the relay-only pattern). It is disabled in every environment
today: `POST /api/v1/compensation-plan-save` checks `isCompensationPlanWriteEnabled()` (a
`finance_settings` flag, `compensation_plan_write_enabled`, or the `COMPENSATION_PLAN_WRITE_ENABLED`
env var) *before* any role check, and answers a plain "not yet enabled" until Andrew turns it on.
Role gating reuses `COMPENSATION_LIVE_ALLOWED_ROLES`/`filterCompensationWorkersForViewer` from
`compensation-report-service.js` rather than re-declaring the gate, so the write side can never
drift from the live read side's admin/council/compensation restriction, and a council editor gets
the identical generic denial for a worker that doesn't exist and one that is `hideFromCouncil` --
it can never distinguish the two by probing.

This does **not** reach parity with the legacy in-Connect Salary Planner roster
(`SALARY_PLANNER_KEY` in `src/api-finance.js`), by design, and the gap is deliberate, not an
oversight:
- Covered: a real per-worker row (`fiscal_year`, `worker_key`) with seed facts (name, role label,
  salary, benefits, notes), a per-worker `hideFromCouncil` flag enforced identically to the read
  side, and a per-worker raise `comp_method`/`adjustment_pct` that a `council` viewer may edit on a
  *visible* row only (the per-worker analogue of legacy's `COUNCIL_EDITABLE_FIELDS`).
- Not covered: legacy's GLOBAL `compCustomPct`/`compScalePct`/`compBaselineRosterOnly` raise-plan
  assumptions; legacy's hand-typed `compOverrides` dollar overrides; and legacy's private
  per-council-member overlay fork (`finance_salary_planner_council_<username>`) -- a council save
  here lands directly on the ONE shared table (restricted to the two fields above, on rows they may
  see), not an isolated per-user draft, so two council users editing the same fiscal year can now
  see and overwrite each other's `comp_method`/`adjustment_pct` choice. This mirrors how Finance's
  existing read side already has no per-council-overlay concept at all, rather than introducing a
  second, divergent council-state model just for this write path.
See `compensation-plan-write-service.js`'s header comment for the same list with full rationale,
and `test/finance-compensation-plan-write-service.test.js` /
`test/finance-compensation-plan-write-route.test.js` for the tests, including the council-isolation
precedent matching `test/council-compensation-role.test.js`.

**Property reserve/distribution/capital-ledger entry (September 17, 2026, code-complete but OFF by
default).** A further real write path now exists, this time for the Commercial Property reserve
schedule, reserve disbursements, distributions, and capital-improvements ledger, writing to
Finance's OWN D1 (`finance_property_reserves`, `finance_property_reserve_disbursements`,
`finance_property_distributions`, `finance_property_capital_ledger` -- all already present in
migration 0001, unchanged) instead of the shared Connect D1 legacy still writes to. It is a
straight port of legacy's real `finance/property/ivanhoe/reserves/:reserveKey/monthly`,
`.../disbursements`, `finance/property/ivanhoe/distributions`, and
`finance/property/ivanhoe/capital-ledger` POST routes (`src/api-finance.js`'s `handlePropertyApi`)
-- same field validation, same `reserve_before_cents` default-from-prior-month rule, same
`reserve_after_cents = reserve_before_cents + contribution_cents` running balance, same
capital-ledger `sort_order` auto-increment (see `property-ledger-write-service.js`'s header
comment). It is disabled in every environment today, the same shape as the write paths just above:
each of `POST /api/v1/property-reserve-entry`, `/api/v1/property-reserve-disbursement-entry`,
`/api/v1/property-distribution-entry`, and `/api/v1/property-capital-ledger-entry` checks
`isPropertyLedgerWritesEnabled()` (a `finance_settings` flag, `property_ledger_writes_enabled`, or
the `PROPERTY_LEDGER_WRITES_ENABLED` env var) *before* any role check, and answers a plain
`503 {"error":"not_yet_enabled"}` until Andrew turns it on. Role gating is admin-only, matching
legacy's own `isAdmin` gate for editing property financials -- a narrower, different set than
Compensation Planner's admin/council/compensation, because that is what legacy itself enforces for
this data, not an invented stricter or looser rule.

One real finding from porting this validation, worth stating plainly: **legacy enforces no
sufficient-funds or reserve-overdraw check anywhere on this path.** A reserve's
`reserve_after_cents` is a plain running total that a disbursement never reads back to reduce, and
a disbursement's own amount is never checked against it -- the reserve schedule and the
disbursement log are independent tables in legacy today. This port matches that reality rather than
inventing a stricter rule legacy never had; see `property-ledger-write-service.js`'s header comment
and `test/finance-property-ledger-write-service.test.js`'s dedicated test (a disbursement for one
hundred times the reserve's own balance still succeeds) for the concrete proof. If a real balance
check is ever wanted, that is a new product decision requiring its own sign-off, not something a
straight port should add silently.

This is code-complete and covered by `test/finance-property-ledger-write-service.test.js` (write
logic and validation, against a real in-memory SQLite database migrated from
`migrations/0001_finance_foundation.sql`) and `test/finance-property-ledger-write-route.test.js`
(the flag, the admin-only check, and end-to-end writes through `shell.js`'s actual route dispatch)
-- but it is deliberately not part of any cutover yet. No production or staging `finance_settings`
row or environment variable turns it on; see the Timothy Digital overhaul checkpoint in `AGENTS.md`
for the still-unfinished authoritative data/writer migration this is one piece of.

Existing Finance remains operational in Connect. Moving authoritative accounting data and writers,
cutting users over and retiring the old module remain unfinished. The new schema does not include
the legacy QuickBooks OAuth/cache tables; that is not evidence the existing integration was retired.

### Known readiness limitations

- **Fixed (September 18, 2026).** The shell used to eagerly load synthetic rows for Financial
  Health and companion data in Church, Balance, Property and Compensation, and a throw from any
  one of those reads took down the entire request with a 503 "Synthetic staging data unavailable,"
  even when every other section's own data was fine. Every one of those per-request reads in
  `shell.js`'s `'shell'` route is now wrapped in `synthetic-read-guard.js`'s `safeSyntheticRead()`:
  a read that throws degrades to the distinct `SYNTHETIC_UNAVAILABLE` sentinel (never confused with
  `null`'s existing "not applicable to this section" meaning, and never a fabricated zero/blank),
  and each section/page renderer shows an honest "data unavailable" placeholder for just that one
  piece. Empty or non-fixture production data — production's real Finance D1 genuinely has zero
  `source='synthetic_fixture'` rows today — degrades gracefully instead of crashing the page. This
  does not change what data is real; it only stops one missing dependency from masking every other
  section's real or synthetic data behind an unrelated 503.
- **Fixed (September 18, 2026).** Section denial used to be conditional on successful role lookup:
  every verification failure other than a genuinely wrong role fell through to full access. `shell.js`'s
  `'shell'` route now fails closed on every verification failure — no Access identity, a network
  error, a non-200 from Connect, malformed JSON, or a malformed role payload all deny access with a
  403 — with one remaining, deliberate, disclosed exception: `not_configured` (no `CONNECT_SERVICE`
  binding/key at all) still fails open OUTSIDE production, because staging/local do not have that
  binding provisioned yet (see the Giving-relay paragraph above) and denying everything there would
  make the app unusable for review before cutover. In **production** (`env.ENVIRONMENT ===
  'production'`, set by `wrangler.finance.jsonc`'s own `vars`, distinct from staging's `'staging'`),
  `not_configured` now ALSO fails closed — a live financial system silently missing its own
  role-check wiring (e.g. a forgotten secret) is exactly the fail-open condition this was meant to
  close, not an acceptable state to disclose-and-continue. See
  `test/finance-alpha-shell.test.js`'s `'fails closed (403) on every role-verification failure...'`
  block for the full matrix, including the production-vs-staging contrast. The coarse section
  mapping (`roleCanAccessSection` in `connect-role-client.js`) still does not reproduce every legacy
  admin/finance/staff/council permission, by design — see that file's own header comment. Access
  sign-in is not product authorization.
- `status: 'live'` in `parity-manifest.js` means a renderer exists, not that its data is production
  data or its workflow has passed acceptance. Several pages remain explicitly unavailable.
- Older alpha notes and blanket “synthetic/read-only/no writers” copy describe historical stages;
  they must not be used to characterize current Giving/payroll relays or real report contracts.

Finance's database migrations start empty. Fixtures are explicit staging inputs, never a migration.
A schema migration does not copy Connect history or authorize a new writer.

## File orientation

This list began with the synthetic alpha; service files now also contain live resolvers where
noted above. Consult their source and the page registry for current per-page behavior.

- `shell.js` — Cloudflare Worker entry point and safe health endpoint.
- `version.js` — intentional semantic prerelease version.
- `migrations/` — Finance-only D1 migration ledger; never targets the shared Connect database.
- `fixtures/` — deterministic synthetic staging data, applied explicitly and never as a migration.
- `contracts/` — versioned JSON Schemas for staging APIs.
- `../../wrangler.finance.staging.jsonc` — isolated staging Worker configuration.
- `../../test/finance-alpha-shell.test.js` — boundary, response, and security regression tests.
- `connect-giving-consumer.js` — fail-closed parser for the proposed aggregate Giving contract.
- `connect-giving-client.js` — real transport for the live endpoint, with a fail-closed fallback to the synthetic fixture.
- `connect-giving-transport.js` — pure staging harness for bounded attempts, idempotency, and reconciliation.
- `query-budget.js` — named, fail-closed D1 read budgets for independently observable routes.
- `summary-service.js` — synthetic D1 read and `finance.summary.v1` contract assembly boundary.
- `route-manifest.js` — executable route, method, contract, data-source, and query-budget registry.
- `parity-manifest.js` — source-backed inventory of the existing Finance navigation and capabilities.
- `health-view-model.js` — Operating result and Financial position each try the same live-first
  `resolveChurchReport`/`resolveBalanceSheet` results Church Report/Balance Sheet already use
  (labeled `live` or `synthetic-fallback` per card, independently), falling back to the synthetic
  `summary` aggregate; Giving and the decision framing are unchanged.
- `church-report-service.js` — one-query synthetic account detail and report totals boundary; `resolveChurchReport` and `resolveChurchTrend` each try their own real `connect.finance-church-report*.v1` contract first and fall back to the synthetic fixture on any failure.
- `finance-church-report-trend-consumer.js` — fail-closed parser for the `connect.finance-church-report-trend.v1` contract (the multi-year trend; the single-year contract has its own consumer alongside it in this directory).
- `finance-church-report-trend-client.js` — real transport for the live multi-year endpoint, with a fail-closed fallback to the synthetic fixture (same shape as `finance-church-report-client.js`).
- `balance-sheet-service.js` — one-query synthetic position detail and equation reconciliation; `resolveBalanceSheet` and `resolveBalanceSheetTrend` each try their own real `connect.finance-balance-sheet*.v1` contract first and fall back to the synthetic fixture on any failure.
- `finance-balance-sheet-trend-consumer.js` — fail-closed parser for the `connect.finance-balance-sheet-trend.v1` contract (the multi-year trend; the single-year contract has its own consumer alongside it in this directory).
- `finance-balance-sheet-trend-client.js` — real transport for the live multi-year endpoint, with a fail-closed fallback to the synthetic fixture (same shape as `finance-balance-sheet-client.js`).
- `daycare-report-service.js` — one-query synthetic actuals and operating-result detail.
- `property-report-service.js` — one-query synthetic monthly property performance detail.
- `property-forecast-service.js` — one-query 12-month synthetic property plan with monthly and annual reconciliation.
- `property-ledger-write-service.js` — real, off-by-default writes into Finance's OWN `FINANCE_DB` for the property reserve schedule, reserve disbursements, distributions, and capital-improvements ledger; a straight port of legacy's real `handlePropertyApi` validation and running-balance rule (see the changelog paragraph above for the verified real finding on reserve-overdraw enforcement).
- `budget-report-service.js` — one-query synthetic future-plan detail and totals; `resolveBudgetReport` tries the real `connect.finance-budget.v1` contract first and falls back to the synthetic fixture on any failure.
- `finance-budget-client.js` — real transport for the live budget read (same shape as `finance-data-status-client.js`), plus `postConnectFinanceBudgetWrite`, the write relay for Budget Planner's manual edit/save form (see the route-manifest paragraph below).
- `budget-plan-write-service.js` — validation and upsert for Budget builder's OWN edit/save write into Finance's own `finance_budget_plan` table (`FINANCE_DB`), gated off by default; see the route-manifest paragraph and the Alpha.42 entry below for how this differs from `budget-plan-write-v1`'s Connect relay above.
- `accounts-report-service.js` — one-query synthetic account inventory and classification summary.
- `data-status-service.js` — resolves real-or-synthetic import provenance and isolation status; `resolveDataStatus` tries the live `connect.finance-data-status.v1` contract first, falls back to the one-query synthetic reader on any failure.
- `finance-data-status-consumer.js` — fail-closed parser for the `connect.finance-data-status.v1` contract.
- `finance-data-status-client.js` — real transport for the live endpoint, with a fail-closed fallback to the synthetic fixture (same shape as `connect-giving-client.js`).
- `compensation-report-service.js` — one-query synthetic role-level compensation plan and reconciled totals, `resolveCompensationReport`'s live-with-synthetic-fallback for the real per-person `connect.finance-compensation.v1` roster (admin/council/compensation only), a synthetic role-only council review snapshot that cannot imply approval, and `buildLiveCompensationCouncilSnapshot`'s real aggregate equivalent for that same allowed-role set (real worker/entered-pay counts and totals only -- no fabricated benefits-share or weighted-adjustment figure, since the real roster stores neither per worker).
- `compensation-benchmark-service.js` — one-query role-level synthetic benchmark comparison with explicit non-published source classification.
- `compensation-benefits-service.js` — one-query role-level benefits and employer-tax breakdown with exact plan reconciliation.
- `cash-runway-service.js` — two-query synthetic operating-cash and expense-coverage boundary.
- `financial-mix-service.js` — pure reconciled income/expense composition view; `buildLiveFinancialMixView` builds the same `{fiscalYear, income, expenses}` shape directly from a live church-report contract result, used by Charts' revenue/expense mix pages and now Financial Health's Operating mix, each independently, whenever `resolveChurchReport` came back live.
- `entity-overview-service.js` — pure separately-periodized Church, Daycare, and Property view; still synthetic-only by investigated decision, not merely unwired -- see the Financial Health entry below.
- `operating-bridge-service.js` — pure reconciled annual Church income-to-result bridge; reads only `fiscalYear`/`totals.{incomeActualCents,expenseActualCents,actualNetCents}`, a shape the live Church Report view (`buildLiveChurchReportView`) already matches exactly, so no live-aware wrapper was needed to make Financial Health's Church operating bridge live-first too.
- `csv-import-service.js` — CSV parsing, validation, and FINANCE_DB persistence for the Church/Balance/Daycare/Property Budget import write paths, plus the off-by-default `isCsvImportWritesEnabled` gate; see the Alpha.43 entry below.
- `synthetic-read-guard.js` — wraps a single per-request synthetic-fixture read (or a live-first resolver's own synthetic fallback read) so a genuine missing-row throw degrades to the `SYNTHETIC_UNAVAILABLE` sentinel instead of taking down the whole request; see the "Known readiness limitations" fix above.

The Giving consumer validates the closed `connect.giving-summary.v1` shape and its financial
reconciliation before returning detached aggregate data, served at `/api/v1/connect-giving-preview`.
`connect-giving-client.js` now attempts the real endpoint first — a Cloudflare service binding
(`CONNECT_SERVICE`) to Connect's Worker plus a shared secret (`FINANCE_CONTRACT_API_KEY`), matching
the pattern the website repo already uses for its own cross-Worker calls — and falls back to the
committed synthetic fixture whenever that binding/secret isn't configured yet or the call fails for
any reason; the response's `X-Giving-Source` header (`live` or `synthetic-fallback`) and the shell's
own footer note say which happened. Neither is provisioned in staging yet, so every request still
falls back today exactly as before. No writer, schedule, queue, or production data connection exists.

The summary read is capped at one four-statement D1 batch. The budget helper rejects unknown
budgets, excess statements, non-`SELECT` SQL, and incomplete batch results before a response is
accepted. This makes query amplification a tested application boundary rather than an informal
expectation.

The route manifest is the closed inventory for the alpha Worker. Every published path defaults to
read-only (`GET`/`HEAD`) and declares whether it uses no data, the dedicated synthetic D1, or a
committed synthetic static fixture. Routes that read D1 name their query budget; unknown paths fail
closed with `404`. Three routes are deliberate exceptions: `giving-quick-entry-v1` and
`budget-plan-write-v1` each accept `POST` and relay the write to Connect's own contract endpoint —
neither ever writes to Finance's own database; `budget-plan-save-v1` is the one route that DOES
write to Finance's own database. Their own `methods`/`writer`/`dataSource` fields in the manifest
keep all three exceptions visible in one place rather than hidden behind a runtime check.
`budget-plan-write-v1` relays a hand-typed Budget Plan category/fiscal-year edit from the new
Budget builder edit form (`planning-pages.js`'s `renderBudgetEditForm`, shown only to a viewer
Finance's own role check independently verified as admin or council) to Connect's
`finance-budget-write-v1` contract endpoint, which itself calls the exact same
`applyBudgetPlanOverrideRows()` helper (`src/api-finance.js`) the legacy in-Connect Budget
Planner's `finance/planning/church/override-bulk` route already uses — one shared implementation,
so the two entry points can never drift on validation, on the admin/council-only gate, or on
council's fork-into-their-own-overlay behavior. Budget Planner's generate/generate-all/commit/delete
operations remain legacy-only (in Connect) for now. `budget-plan-save-v1` (Alpha.42, below) is a
separately built, independent write path onto Finance's OWN `finance_budget_plan` table via
`FINANCE_DB` -- part of the longer-term move of authoritative Budget data into Finance's own
database rather than another consumer of the Connect relay above -- and stays off by default behind
a `finance_settings` flag until a later, separately approved cutover stage. `compensation-plan-save-v1`
and the four `property-*-entry-v1` routes (see the changelog paragraph above) are further such writes onto Finance's
own database (`dataSource: 'finance-db-write'`), also off by default; see their own paragraphs
above and `route-manifest.js`'s comments on them.

Alpha.9 begins interface parity with the existing nine-section Finance information architecture.
Only Financial Health renders synthetic metrics; the other familiar sections are explicit staging
scaffolds listing the workflows that must be rebuilt or deliberately retired. This is not visual or
functional parity, and product-specific authorization is not yet connected.

Alpha.10 replaces the generic Financial Health cards with the existing workspace's decision-led
framing: operating result versus budget, financial position, aggregate Giving reconciliation, and
the board's distinct authority over donor, earned, and passive income. The calculations use only
the dedicated synthetic D1 aggregates and committed synthetic Giving fixture.

Alpha.11 adds the first functional Church Report slice: fiscal-year income, expenses, net result,
budget comparison, favorable variance, and account detail. It uses one separately named read budget
and only rows marked as the deterministic synthetic fixture. Imports, adjustments, drill-downs,
board packets, production data, and writers remain disconnected.

Alpha.12 adds the first functional Balance Sheet slice: assets, liabilities, net assets, accounting
equation difference, and account detail as of the synthetic fixture date. It uses one separately
named read budget. Imports, adjustments, trends, production data, and writers remain disconnected.

Alpha.13 adds the first functional Daycare Report slice: synthetic tuition, labor, and operating
result with category detail. It uses one separately named read budget. Budgets, shared-cost
allocations, room operations, imports, production data, and writers remain disconnected.

Alpha.14 adds the first functional Commercial Property slice: monthly revenue, expenses, net
income, occupancy, distributable cash, and reserve balance. It uses one separately named read
budget. Reserve schedules, capital, repairs, forecasts, valuation, imports, production data, and
writers remain disconnected.

Alpha.15 adds the first functional Budget slice: future-year planned income, expenses, net result,
and category detail. It uses one separately named read budget. Editing, growth scenarios, board
categories, purpose tags, imports, production data, and writers remain disconnected.

Alpha.16 adds the first functional Chart of Accounts slice: synthetic account paths,
classifications, and classification counts. It uses one separately named read budget. Account
editing, board-category mapping, imports, production data, and writers remain disconnected.

Alpha.17 adds the first functional Data & Imports slice: fixture provenance, last-import time, and
explicit connection/writer isolation status. It uses one separately named read budget. Uploads,
connections, administrative tools, production data, and writers remain disconnected.

Alpha.18 adds the first functional Compensation slice and a Finance-owned staging schema:
synthetic role-level salary, benefits, adjustment assumptions, and plan totals. It uses one
separately named read budget. Personal identities, editing, comparisons, production data, and
writers remain disconnected.

Alpha.19 replaces the dark engineering presentation with the established Timothy Finance visual
language: warm page surfaces, navy display headings, gold/teal accents, white elevated cards, and
the existing flat horizontal subnavigation. This changes presentation only; routes, queries,
bindings, synthetic data, access controls, and writer isolation are unchanged.

Alpha.20 adds a bounded multi-year Church operating trend using a second, explicitly named
one-query read budget. Current-year summaries and account detail remain scoped to the latest
synthetic fiscal year, while the trend compares deterministic 2025 and 2026 fixture totals.
Production data, imports, drill-downs, and writers remain disconnected.

Alpha.21 adds a bounded multi-year Balance Sheet position view through a second named one-query
read budget. Each fixture year must satisfy the accounting equation before it is rendered, while
the current position remains scoped to the latest synthetic fiscal year. Production data, imports,
adjustments, drill-downs, and writers remain disconnected.

Alpha.22 adds the first Commercial Property reserve workflow: a read-only property-tax reserve
schedule with target, carried balance, monthly contribution, ending balance, and funding progress.
Its separately named one-query reader rejects broken month-to-month carry-forward. Production
property data, reserve editing, disbursements, imports, and writers remain disconnected.

Alpha.23 adds bounded read-only Commercial Property capital-project and repair ledgers with
separate totals and line detail. The two-statement ledger budget validates synthetic dates,
amounts, classifications, and descriptive fields before rendering. Production property data,
editing, imports, and writers remain disconnected.

Alpha.24 completes the initial Daycare reporting capability set with synthetic budget comparison
and a 50% utilities/insurance shared-cost allocation calculated from the latest synthetic Church
actuals. Allocation settings and source rows are read through one named two-statement budget and
validated before use. Production data, allocation editing, imports, and writers remain disconnected.

Alpha.25 adds an offline synthetic Giving transport/reconciliation harness and a protected
read-only evidence endpoint. It proves fail-closed contract validation, bounded retry outcomes,
terminal-failure handling, idempotent duplicate disposition, and cent-level reconciliation without
a service binding, credential, network fetch, schedule, queue, receipt writer, or production data.

Alpha.26 adds explicit Data & Imports freshness evaluation. The staging fixture is classified
against a documented 30-day review window at request time, showing its exact timestamp, age, and
stale/current state while continuing to state that no production connection or writer exists.

Alpha.27 expands Budget into a deterministic read-only outlook. Each synthetic category carries a
base amount and explicit growth assumption; the service rejects malformed or arithmetically
inconsistent rows, then renders base and planned income, expenses, net result, and change with a
cent-level reconciliation. Editing, production data, imports, and writers remain disconnected.

Alpha.28 adds a Finance-owned account-presentation table instead of extending Connect's shared
configuration blobs. The read-only Chart of Accounts joins each synthetic ledger path to a board
category and an independent optional purpose tag, while preserving the original ledger path and
rejecting missing or malformed mappings. Production mappings, editing, imports, and writers remain
disconnected.

Alpha.29 adds a normalized Finance-owned property valuation model with separate assumptions, rent
roll, and operating-cost tables. The read-only income approach follows the existing worksheet rule
from contract rent through vacancy, management fee, NOI, and cap-rate value, and exposes the full
reconciling walk using only deterministic synthetic inputs. Production property values, editing,
imports, debt workflows, and writers remain disconnected.

Alpha.30 assembles a decision-ready synthetic board packet snapshot from the Church report,
multi-year operating trend, balance-sheet totals, and aggregate Giving evidence already read by
the page. It fails closed on mismatched periods or unreconciled position/Giving inputs and adds no
query, export, writer, production data, or board-delivery path.

Alpha.31 adds operating cash runway to Financial Health. A named two-query budget reads one
synthetic operating-cash account and latest-year synthetic expenses, rejects missing, mismatched,
negative-cash, or nonpositive-expense inputs, and calculates average monthly expense and months of
coverage. Account selection, production data, editing, imports, alerts, and writers remain
disconnected.

Alpha.32 adds reconciled revenue and expense composition to Financial Health. It reuses the
existing one-query Church detail boundary, validates a single fiscal period and nonnegative
integer-cent amounts, and shows each account's share of its source total. It adds no query-budget
type, migration, production data, classification writer, or charting dependency.

Alpha.33 adds a separately periodized entity overview to Financial Health using the existing
Church, Daycare, and Commercial Property readers. Each source retains its own reporting window and
validated income/expense/result arithmetic; the UI explicitly refuses to present a consolidated
total across unlike periods. It adds no query-budget type, migration, production data, writer, or
inter-entity accounting rule.

Alpha.34 adds a reconciled annual Church operating bridge to Financial Health. It reuses the
validated Church detail view to show income minus expenses equals surplus or deficit, and labels
the result as arithmetic only rather than donor-to-expense tracing. It adds no query, migration,
production data, allocation rule, charting dependency, or writer.

Alpha.35 renders Chart of Accounts as a deterministic hierarchy while preserving every source
ledger path, Finance-owned board category, and independent purpose tag. Empty path segments and
duplicate leaves fail closed. It reuses the existing one-query account reader and adds no
migration, production mapping, account edit, classification writer, or ledger mutation.

Alpha.36 adds the second real contract, `connect.finance-data-status.v1`: Connect now produces
real import-log recency and QuickBooks connection presence (never tokens) at
`/api/contracts/finance-data-status-v1`, and the Data & Imports section tries that live before
falling back to the synthetic fixture, labeling which happened the same way Giving already does.
No other section changes; imports, uploads, and administrative tools remain disconnected.

Financial Health's Operating result and Financial position cards now try the same live
`connect.finance-church-report.v1`/`connect.finance-balance-sheet.v1` resolvers the Church
Report/Balance Sheet sections already use (`resolveChurchReport`/`resolveBalanceSheet`), each
independently falling back to the existing synthetic `summary` aggregate and labeling itself
`live from Connect` or `synthetic fixture` per card -- Giving reconciliation (already live-first)
is unchanged. "Net assets" on the Financial position card is `totals.equityCents`: the whole
Designated-Funds-reclassified Equity total the live Balance Sheet contract already computes,
guaranteed equal to `equityReclass.totalEquityCents` -- not one component of that reclassification
-- matching what this card has always meant by "net assets" (assets minus liabilities). No new
contract, query budget, migration, or writer; this only adds a second consumer of two contracts
already live in production.

Financial Health's Operating mix and Church operating bridge are now live-first too, both reusing
`churchReportLive` (already fetched for this section by the change above) rather than any new read.
Operating mix calls `buildLiveFinancialMixView` -- the same function Charts' revenue/expense mix
pages already use -- directly on `churchReportLive.accounts`/`.totals` when live. Church operating
bridge passes the live church view straight into the existing `buildOperatingBridge` unchanged: its
`fiscalYear`/`totals.{incomeActualCents,expenseActualCents,actualNetCents}` reads already match
`buildLiveChurchReportView`'s output field-for-field, so no live-aware wrapper was needed, unlike
Operating mix/Operating result/Financial position above. Both fall back to the existing synthetic
builders and are labeled `Live from Connect`/`Synthetic staging` in their own section badge,
independent of Operating result/Financial position and of each other.

Entity overview was investigated for the same treatment and deliberately left fully synthetic.
Daycare's live resolver (`resolveDaycareReport`/`buildLiveDaycareReportView`) reports one
whole-fiscal-year total whose `period` is just the fiscal year (e.g. `"2026"`), not the monthly
`YYYY-MM` window `buildEntityOverview`'s own validation requires for Daycare/Property (the
synthetic fixture's own entity-overview periods are genuinely monthly, e.g. `Daycare · 2026-01`) --
a real granularity mismatch, not a formatting detail, so "all three live" cannot occur with today's
resolver shapes. Property's live resolver can also carry a null `totalExpensesCents`/
`netOperatingIncomeCents`/`availableForDistributionCents`/`reserveBalanceCents` on any given period
(confirmed production behavior -- see `property-report-service.js`'s `resolvePropertyReport`
comment); summing those into `buildPropertyReportView`'s totals would produce `NaN`, and
`buildEntityOverview`'s integer validation would then throw with no per-panel guard around that one
call, taking down the entire Financial Health section rather than degrading just this row.
Independently mixing sources instead (e.g. live Church alongside synthetic Daycare/Property) was
also rejected: `renderEntityCards` carries no per-card source label today, so three cards from two
different sources would sit side by side with no way for a reader to tell which is real Connect
data -- the exact misleading mix this page's honest-degradation discipline exists to prevent.
`daycareReportLive`/`propertyReportLive` are therefore still not resolved for `'health'` at all;
resolving them unused would only add query-budget cost. No new contract, query budget, migration,
or writer.

Board packet is no longer 100% synthetic. Its Operating result, Financial position, and Operating
trend cards each independently try the same live-first resolvers Church Report/Balance Sheet
already use -- `resolveChurchReport`, `resolveBalanceSheet`, and `resolveChurchTrend` -- falling
back to the same synthetic fixture, labeled `live from Connect`/`synthetic fixture` per card, the
same convention Church Report/Balance Sheet/Property/Charts already use. Giving evidence was
already live-first and unconditional for this section before this change; only its own label is
newly shown here. The retired all-or-nothing `buildSyntheticBoardPacket` (all four inputs present
and reconciled, or it throws) is untouched and keeps its own test coverage, but nothing on this
page calls it anymore -- `buildLiveBoardPacket` replaces it, resolving each card independently and
degrading only that one card to an honest "unavailable" placeholder (never a fabricated $0, never a
crash of the other three) when its own data isn't there, matching the standard Financial Health's
cards already apply. Operating trend's "net" figure is each fiscal year's own reconciled
`netIncomeActualCents` -- the same bottom line Operating result and Financial Health's own
Operating result card already use -- not a naive income-minus-expense figure, and the trend card's
fiscal year is no longer required to match Operating result's, since each card is now independently
sourced. No new contract, query budget, migration, or writer.

Alpha.42 adds Budget builder's real edit/save write onto Finance's OWN database -- `finance_budget_plan`
via `FINANCE_DB` -- the first write anywhere in this app that is not a relay to Connect or Website
(compare `giving-quick-entry-v1`/`budget-plan-write-v1`/the payroll routes, all of which relay
out and never touch `FINANCE_DB`). `budget-plan-write-service.js` ports the validation and upsert
SQL of legacy's `finance/planning/church/override-bulk` admin path (`src/api-finance.js`) --
category/fiscal-year required, whole-dollar rounding, fiscal-year bounded to a sane 2000-2100
range, classification restricted to Income/Expenses, and the whole batch rejected together if any
one row is malformed, matching the legacy route's own all-or-nothing behavior -- as a local
reimplementation rather than an import from `src/`, keeping Finance's own Worker independent of
the legacy Connect codebase the way `apps/finance` is meant to be. It is deliberately narrower
than legacy's override-bulk in one respect: council's private per-user `finance_settings` overlay
fork is not ported, since Finance's own role contract (`connect-role-client.js`) does not carry a
verified username yet; only the admin path is ported now, which is still a strict subset of what
legacy already allows (never a new capability legacy denies). The route
(`POST /api/v1/budget-plan-save`) is registered in the manifest and fully implemented and tested,
but reachability is off by default everywhere: `isBudgetPlanWritesEnabled` checks a
`finance_settings` key (`finance_budget_builder_writes_enabled`, defaulting to disabled, and
failing closed on any read error) before role verification even runs, so a real request today gets
a plain `not_yet_enabled` response regardless of role or environment. Turning it on is a later,
separately approved cutover-stage change, not part of this slice. No query budget, migration, or
Budget builder UI form changes -- this is the write path only.

Alpha.43 adds CSV import write paths for Church Report (annual Budget-vs-Actuals), Balance Sheet
(Statement of Financial Position), Daycare (category actuals/budget), and Commercial Property
(monthly budget) — see `csv-import-service.js`. Each is a narrow, CSV-only port of one of legacy
Connect's real import routes (`src/api-finance.js`'s `finance/church/import`,
`finance/church/balances/import`, `finance/daycare/bulk`, and the AHRA
`finance/property/:key/budget-import`/`monthly-import-csv` routes) — not the ~750-line server-side
`.xlsx` grid reader those Church/Balance routes also support, which is out of scope here. The CSV
tokenizer and thousands-comma-aware money parser are ported verbatim from `src/api-utils.js`'s
`parseCsvRows` and `src/api-finance.js`'s `dollarsToCents` (this app never imports from legacy
`src/`), but validation is deliberately stricter: an unparsable amount is a hard row-level error
for the whole import, never a silently-substituted 0, matching this app's existing
"never fabricate a number" discipline. This is the first capability in the new Finance app that
writes to Finance's OWN database (`FINANCE_DB`) rather than relaying a write to Connect/Website
(the Giving/Budget-plan/payroll relays above never touch this app's own tables) — each of the four
new `/api/v1/import/*` routes (`route-manifest.js`'s new `dataSource: 'd1-write'`) writes real rows
via wholesale-replace-by-key (Church/Balance/Daycare, tagged `source='import_csv'`) or per-key
upsert (Property Budget), plus a `finance_import_log` row, matching legacy's logging discipline.
Every one of the four routes is gated OFF by default — checked first, inside the handler, before
any parsing or writing — by `isCsvImportWritesEnabled()` (an env var or a `finance_settings` row,
either defaulting to disabled and failing closed on any read error): shipped code-complete and
fully tested, but a real request today gets a 403 with a clear "not yet enabled" message, not a
write. Turning it on is a later, separately-approved production cutover decision, not part of this
change. No existing route, reader, or synthetic fixture is affected.

Alpha.44 (September 18, 2026) closes the two readiness gaps `AGENTS.md` and this file's own "Known
readiness limitations" called out by name — see that section above for the full detail. In short:
(1) every per-request synthetic/live-fallback read in the `'shell'` route is now wrapped in the new
`synthetic-read-guard.js`'s `safeSyntheticRead()`, so one missing fixture row degrades to an honest
per-section "unavailable" placeholder instead of a blanket 503 for the whole page; and (2) the
`'shell'` route's role-verification gate now fails closed on every verification failure in
production, including `not_configured` (previously the one case that always fell through to full
access everywhere) — outside production, `not_configured` still fails open, disclosed via the
existing banner, because staging/local genuinely have no `CONNECT_SERVICE` binding provisioned yet.
Neither change alters what data is real, adds a query budget or migration, or touches any write
path. See `test/finance-alpha-shell.test.js`'s production-vs-staging `not_configured` tests for the
regression coverage.

## Validate

From the repository root:

```sh
npm ci
npx vitest run test/finance-alpha-shell.test.js
npx wrangler deploy --dry-run --config wrangler.finance.staging.jsonc
```

The dedicated local/CI boundary gate is:

```sh
npm run validate:finance
```

`.github/workflows/validate-finance.yml` runs the Finance test family and Finance-only Wrangler
dry run for Finance boundary changes. It has read-only repository permissions and no deployment
step or Cloudflare credential.

Run the repository's full required validation before merging:

```sh
npm test
node .github/scripts/check-built-scripts.js
```

## Release sequence

Use intentional versions only:

`1.0.0-alpha.x` → `1.0.0-beta.x` → `1.0.0-rc.x` → `1.0.0`

Deployments record the approved release SHA. Production infrastructure now exists; further
production releases still require approval. A prerelease version, successful deployment or
reachable login page does not establish authoritative data or workflow parity.

`/api/summary` remains a deprecated compatibility alias during alpha and points clients to
`/api/v1/summary`. New consumers must use the versioned path and validate its contract.
