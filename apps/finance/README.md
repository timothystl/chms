# Timothy Finance Alpha

This directory is the separately deployable Finance application boundary being built inside the
existing CHMS repository. It begins at `1.0.0-alpha.1`; legacy Connect/Finance version history is
preserved separately.

## Current scope

The alpha serves a branded staging shell, `/health`, and a versioned read-only
`/api/v1/summary` contract over explicitly
synthetic fixture data. It has no database mutation path, KV, R2, service binding, queue,
cron, email, payment, application authentication, production route, or production data connection.
A successful shell deployment proves packaging and release isolation only.

The initial deployment was intentionally unrouted until Cloudflare Access was enabled and attached
to the whole Worker. The only configured hostname is `finance-staging.timothystl.org`; both
`workers_dev` and preview URLs remain disabled. This prevents a second, unprotected URL from
bypassing the staging sign-in gate.

Existing Finance remains operational in the current Connect Worker. Moving a reader, writer,
route, identity flow, or database table requires a later reviewed slice with contract,
reconciliation, and rollback evidence.

The isolated database migration starts empty. It omits the retired QuickBooks OAuth/cache tables
and replaces Finance settings formerly mixed into `chms_config` with `finance_settings`. Applying
the migration does not copy production data or authorize a new writer.

## Files

- `shell.js` — Cloudflare Worker entry point and safe health endpoint.
- `version.js` — intentional semantic prerelease version.
- `migrations/` — Finance-only D1 migration ledger; never targets the shared Connect database.
- `fixtures/` — deterministic synthetic staging data, applied explicitly and never as a migration.
- `contracts/` — versioned JSON Schemas for staging APIs.
- `../../wrangler.finance.staging.jsonc` — isolated staging Worker configuration.
- `../../test/finance-alpha-shell.test.js` — boundary, response, and security regression tests.
- `connect-giving-consumer.js` — fail-closed parser for the proposed aggregate Giving contract.
- `connect-giving-transport.js` — pure staging harness for bounded attempts, idempotency, and reconciliation.
- `query-budget.js` — named, fail-closed D1 read budgets for independently observable routes.
- `summary-service.js` — synthetic D1 read and `finance.summary.v1` contract assembly boundary.
- `route-manifest.js` — executable route, method, contract, data-source, and query-budget registry.
- `parity-manifest.js` — source-backed inventory of the existing Finance navigation and capabilities.
- `health-view-model.js` — pure synthetic operating, position, Giving, and decision framing.
- `church-report-service.js` — one-query synthetic account detail and report totals boundary.
- `balance-sheet-service.js` — one-query synthetic position detail and equation reconciliation.
- `daycare-report-service.js` — one-query synthetic actuals and operating-result detail.
- `property-report-service.js` — one-query synthetic monthly property performance detail.
- `budget-report-service.js` — one-query synthetic future-plan detail and totals.
- `accounts-report-service.js` — one-query synthetic account inventory and classification summary.
- `data-status-service.js` — one-query synthetic import provenance and isolation status.
- `compensation-report-service.js` — one-query synthetic role-level compensation plan and totals.

The Giving consumer validates the closed `connect.giving-summary.v1` shape and its financial
reconciliation before returning detached aggregate data. Alpha.5 imports and validates only the
committed synthetic producer example, displays its aggregate net/count, and serves it at
`/api/v1/connect-giving-preview`. There is no network fetch, scheduled delivery, service binding,
or credential. Runtime producer transport remains a separately gated step.

The summary read is capped at one four-statement D1 batch. The budget helper rejects unknown
budgets, excess statements, non-`SELECT` SQL, and incomplete batch results before a response is
accepted. This makes query amplification a tested application boundary rather than an informal
expectation.

The route manifest is the closed inventory for the alpha Worker. Every published path is read-only
and declares whether it uses no data, the dedicated synthetic D1, or a committed synthetic static
fixture. Routes that read D1 name their query budget; unknown paths fail closed with `404`.

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

Every staging deployment records the exact main commit in `RELEASE_SHA`. Do not deploy this Worker
to a production route, attach production resources, or treat an alpha version as authoritative.

`/api/summary` remains a deprecated compatibility alias during alpha and points clients to
`/api/v1/summary`. New consumers must use the versioned path and validate its contract.
