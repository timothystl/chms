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
- `query-budget.js` — named, fail-closed D1 read budgets for independently observable routes.
- `summary-service.js` — synthetic D1 read and `finance.summary.v1` contract assembly boundary.
- `route-manifest.js` — executable route, method, contract, data-source, and query-budget registry.
- `parity-manifest.js` — source-backed inventory of the existing Finance navigation and capabilities.
- `health-view-model.js` — pure synthetic operating, position, Giving, and decision framing.
- `church-report-service.js` — one-query synthetic account detail and report totals boundary.
- `balance-sheet-service.js` — one-query synthetic position detail and equation reconciliation.

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
