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
church reports (including the multi-year trend), balance sheet, daycare, property valuation and
compensation. All four Church Report sub-pages (Overview, Income & expense detail, Multi-year
trend, Budget vs actual) are now live-first with synthetic fallback -- the trend page was the last
one left on the synthetic reader; see `church-report-service.js`'s `resolveChurchTrend` and
`connect.finance-church-report-trend.v1`. Property operating, reserves, ledgers, and forecast (a
straight port of the AHRA-imported `finance_property_budget_monthly` budget/plan table, not a
computed run-rate projection despite the page's label) joined main in #1002 and a follow-on PR
respectively, after the production deployment inspected in this review; do not infer they are
deployed. Giving writes relay to Connect and payroll operations relay to Website. Neither relay
transfers ownership of those records to Finance.

Compensation's four sub-pages split unevenly on whether a real substitute for their synthetic
role-level fixture exists: Plan and Council snapshot both have an honest live version, gated to
admin/council/compensation exactly like the underlying `connect.finance-compensation.v1` roster
fetch; Benchmarks and Benefits & taxes stay synthetic for every role, permanently, because no real
data anywhere in Connect can honestly back them (see `compensation-pages.js`'s comment above its
`'benchmarks'`/`'benefits'` branches for exactly what was checked and why a real per-role
benchmark salary or benefits-component dollar breakdown does not exist). Council's own real rollup
carries only real, already-stored aggregate facts (worker count, entered/unentered current-pay
counts and totals) -- it never reconstructs the synthetic view's `benefitsSharePct` or
`weightedAdjustmentPct`, which have no real per-worker equivalent, and it drops any worker flagged
`hideFromCouncil` from what a `council`-role viewer specifically sees, matching the same rule the
real Salary Planner already enforces for that role.

Existing Finance remains operational in Connect. Moving authoritative accounting data and writers,
cutting users over and retiring the old module remain unfinished. The new schema does not include
the legacy QuickBooks OAuth/cache tables; that is not evidence the existing integration was retired.

### Known readiness limitations

- The shell eagerly loads synthetic rows for Financial Health and companion data in Church,
  Balance, Property and Compensation. Empty/non-fixture production data can make these readers
  throw, yielding 503 “Synthetic staging data unavailable,” even when a real contract exists.
  This is a source finding, not an authenticated live reproduction. Remove fixture dependencies
  and verify real/empty/error states; do not populate production with sample financial data.
- Section denial is conditional on successful role lookup. An unverified role currently continues,
  and the coarse section mapping does not reproduce all legacy permissions. Compensation's live
  fetch separately requires an allowed verified role. Access sign-in is not product authorization.
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
- `balance-sheet-service.js` — one-query synthetic position detail and equation reconciliation.
- `daycare-report-service.js` — one-query synthetic actuals and operating-result detail.
- `property-report-service.js` — one-query synthetic monthly property performance detail.
- `property-forecast-service.js` — one-query 12-month synthetic property plan with monthly and annual reconciliation.
- `budget-report-service.js` — one-query synthetic future-plan detail and totals.
- `accounts-report-service.js` — one-query synthetic account inventory and classification summary.
- `data-status-service.js` — resolves real-or-synthetic import provenance and isolation status; `resolveDataStatus` tries the live `connect.finance-data-status.v1` contract first, falls back to the one-query synthetic reader on any failure.
- `finance-data-status-consumer.js` — fail-closed parser for the `connect.finance-data-status.v1` contract.
- `finance-data-status-client.js` — real transport for the live endpoint, with a fail-closed fallback to the synthetic fixture (same shape as `connect-giving-client.js`).
- `compensation-report-service.js` — one-query synthetic role-level compensation plan and reconciled totals, `resolveCompensationReport`'s live-with-synthetic-fallback for the real per-person `connect.finance-compensation.v1` roster (admin/council/compensation only), a synthetic role-only council review snapshot that cannot imply approval, and `buildLiveCompensationCouncilSnapshot`'s real aggregate equivalent for that same allowed-role set (real worker/entered-pay counts and totals only -- no fabricated benefits-share or weighted-adjustment figure, since the real roster stores neither per worker).
- `compensation-benchmark-service.js` — one-query role-level synthetic benchmark comparison with explicit non-published source classification.
- `compensation-benefits-service.js` — one-query role-level benefits and employer-tax breakdown with exact plan reconciliation.
- `cash-runway-service.js` — two-query synthetic operating-cash and expense-coverage boundary.
- `financial-mix-service.js` — pure reconciled income/expense composition view.
- `entity-overview-service.js` — pure separately-periodized Church, Daycare, and Property view.
- `operating-bridge-service.js` — pure reconciled annual Church income-to-result bridge.

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
closed with `404`. One route is a deliberate exception: `giving-quick-entry-v1` accepts `POST` and
relays the entry to Connect's own contract endpoint — it never writes to Finance's own database,
and its own `methods`/`writer` fields in the manifest keep that exception visible in one place
rather than hidden behind a runtime check.

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
