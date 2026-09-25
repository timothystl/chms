const READ_METHODS = Object.freeze(['GET', 'HEAD']);
const WRITE_METHODS = Object.freeze(['POST']);

const ROUTES = [
  { id: 'shell', paths: ['/', '/index.html'], dataSource: 'synthetic-d1', queryBudget: 'summary', optionalQueryBudgets: ['churchReport', 'churchTrends', 'balanceSheet', 'balanceTrends', 'daycareReport', 'daycareAllocation', 'propertyReport', 'propertyReserves', 'propertyLedgers', 'propertyValuation', 'propertyForecast', 'budgetReport', 'accountsReport', 'dataStatus', 'compensationReport', 'compensationBenchmark', 'compensationBenefits', 'compensationPlanRaw', 'cashRunway', 'facilities'] },
  { id: 'health', paths: ['/health'], dataSource: 'none' },
  // Self-hosted logo and fonts for the v3 design (see brand-assets.js); static bytes, no data.
  { id: 'brand-asset', paths: ['/assets/tlc-logo.png', '/assets/fonts/outfit.woff2', '/assets/fonts/figtree.woff2'], dataSource: 'none' },
  { id: 'summary-v1', paths: ['/api/v1/summary'], dataSource: 'synthetic-d1', queryBudget: 'summary', contract: 'finance.summary.v1' },
  { id: 'giving-preview-v1', paths: ['/api/v1/connect-giving-preview'], dataSource: 'synthetic-static', contract: 'connect.giving-summary.v1' },
  { id: 'giving-transport-evidence-v1', paths: ['/api/v1/connect-giving-transport-evidence'], dataSource: 'synthetic-static', contract: 'finance.connect-giving-transport-evidence.v1' },
  // The one deliberate exception to "Finance is read-only": relays a gift entry to Connect's own
  // giving-quick-entry-v1 contract endpoint (never writes to Finance's own database). `writer: true`
  // and a `methods` override are both explicit here so the exception is visible in this one file,
  // not buried in a conditional elsewhere -- see test/finance-route-manifest.test.js's invariant.
  { id: 'giving-quick-entry-v1', paths: ['/api/v1/connect-giving-quick-entry'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.giving-quick-entry-relay.v1' },
  // ── The Budget builder's real edit/save write, ported from legacy's
  // finance/planning/church/override-bulk (src/api-finance.js) onto Finance's OWN
  // finance_budget_plan table via FINANCE_DB -- NOT a relay, unlike every other write route in
  // this manifest. `dataSource: 'finance-d1-write'` names that distinction explicitly so it stays
  // visible in one place (see test/finance-route-manifest.test.js's invariant) rather than being
  // mistaken for another live-relay write. Off by default in every environment: see
  // budget-plan-write-service.js's `isBudgetPlanWritesEnabled` (a finance_settings flag, checked
  // by shell.js before this route does anything else) -- the route exists and is fully tested, but
  // does not go live until a later, separately approved cutover stage flips that flag on.
  { id: 'budget-plan-save-v1', paths: ['/api/v1/budget-plan-save'], methods: WRITE_METHODS, dataSource: 'finance-d1-write', writer: true, contract: 'finance.budget-plan-save.v1' },
  // Same deliberate exception as the Giving relay above, for Budget Planner's manual edit/save:
  // relays a hand-typed planned-amount row to Connect's own finance-budget-write-v1 contract
  // endpoint (never writes to Finance's own database). Gated admin/council only, on Connect's
  // side, matching the legacy in-Connect Budget Planner's own override-bulk route exactly.
  { id: 'budget-plan-write-v1', paths: ['/api/v1/connect-budget-plan-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-budget-write-relay.v1' },
  // Same deliberate exception as the Giving/Budget relays above, for the Compensation Plan roster
  // editor: relays a fetch-edit-resubmit add/update/remove to Connect's own
  // finance-compensation-write-v1 contract endpoint (never writes to Finance's own database).
  // Gated admin/compensation only, on Connect's side, matching the legacy in-Connect Salary
  // Planner's own PUT route exactly -- council's real editing surface stays the separate, narrower
  // raise-plan-field overlay, not this route.
  { id: 'compensation-plan-write-v1', paths: ['/api/v1/connect-compensation-plan-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-compensation-write-relay.v1' },
  // Same deliberate exception as the relays above, for Budget Planner's admin-only generate/
  // generate-all/commit/remove-a-category operations: each relays to its own Connect contract
  // endpoint (never writes to Finance's own database), gated admin-only on Connect's side,
  // matching the legacy in-Connect Budget Planner's own generate[-all]/commit/DELETE routes
  // exactly -- see the shared helpers' header comment in src/api-finance.js.
  { id: 'budget-generate-v1', paths: ['/api/v1/connect-budget-generate'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-budget-generate-relay.v1' },
  { id: 'budget-generate-all-v1', paths: ['/api/v1/connect-budget-generate-all'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-budget-generate-all-relay.v1' },
  { id: 'budget-commit-v1', paths: ['/api/v1/connect-budget-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-budget-commit-relay.v1' },
  { id: 'budget-plan-remove-v1', paths: ['/api/v1/connect-budget-plan-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-budget-remove-relay.v1' },
  // Same deliberate exception as the relays above, for the Budget builder's admin-only
  // "FY{base} Projected" column correction: relays to Connect's own
  // finance-base-projection-write-v1 contract endpoint (never writes to Finance's own database),
  // matching the legacy in-Connect Planning table's own finance/planning/base-projection PUT route
  // exactly (whole-dollar corrections, keyed by fiscal year; an empty amount clears one category).
  { id: 'base-projection-write-v1', paths: ['/api/v1/connect-base-projection-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-base-projection-write-relay.v1' },
  // Same deliberate exception as the relays above, for Church Report's admin-only actual-figure
  // correction: relays to Connect's own finance-church-actual-override-v1 contract endpoint
  // (never writes to Finance's own database), matching the legacy in-Connect Church Report's own
  // finance/church/actual-override route exactly.
  { id: 'church-actual-override-v1', paths: ['/api/v1/connect-church-actual-override'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-actual-override-relay.v1' },
  // Same deliberate exception as the relays above, for the two remaining legacy Excel import
  // routes: Church Report's annual "Budget vs. Actuals" import and Balance Sheet's single-snapshot
  // "Statement of Financial Position" import. Each relays an uploaded file to its own Connect
  // contract endpoint (never writes to Finance's own database), matching the legacy in-Connect
  // finance/church/import(-preview) and finance/church/balances/import(-preview) routes' own
  // parsing/validation/persistence exactly (admin-only) -- but as ONE request that parses AND
  // persists, not legacy's separate preview-then-checkbox-commit steps (see
  // importChurchBudgetXlsx's/importChurchBalancesXlsx's own header comments in src/api-finance.js
  // for why that reduction is deliberate here, matching the already-accepted Alpha.45 precedent in
  // apps/finance's own xlsx-import-service.js for this same report-type pair). The uploaded file
  // travels as a base64 string in the JSON relay body -- shell.js reads the browser's real
  // multipart upload and re-encodes it before calling out.
  { id: 'church-budget-xlsx-import-write-v1', paths: ['/api/v1/connect-church-budget-xlsx-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-budget-xlsx-import-write-relay.v1' },
  { id: 'church-budget-xlsx-preview-v1', paths: ['/api/v1/connect-church-budget-xlsx-preview'], methods: WRITE_METHODS, dataSource: 'live-relay', contract: 'connect.finance-church-budget-xlsx-preview-relay.v1' },
  { id: 'church-budget-xlsx-commit-v1', paths: ['/api/v1/connect-church-budget-xlsx-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-budget-xlsx-commit-relay.v1' },
  { id: 'church-balances-xlsx-import-write-v1', paths: ['/api/v1/connect-church-balances-xlsx-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-balances-xlsx-import-write-relay.v1' },
  { id: 'church-balances-xlsx-preview-v1', paths: ['/api/v1/connect-church-balances-xlsx-preview'], methods: WRITE_METHODS, dataSource: 'live-relay', contract: 'connect.finance-church-balances-xlsx-preview-relay.v1' },
  { id: 'church-balances-xlsx-commit-v1', paths: ['/api/v1/connect-church-balances-xlsx-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-balances-xlsx-commit-relay.v1' },
  // Same deliberate exception as the two routes above, for the four remaining legacy Church Excel
  // import routes: Monthly P&L, multi-year "Statement of Activity", multi-year "Budget by Year",
  // and multi-year "Statement of Financial Position" -- completing Church's Excel import write
  // parity (every legacy Church import route except the deliberately-excluded
  // finance/church/clear-all now has a relay counterpart). Each relays an uploaded file to its own
  // Connect contract endpoint (never writes to Finance's own database), matching the legacy
  // in-Connect finance/church/monthly-import(-preview), finance/church/activity-import(-preview),
  // finance/church/budget-multi-year-import(-preview), and finance/church/balances/
  // multi-year-import(-preview) routes' own parsing/validation/persistence exactly -- but as ONE
  // request that parses AND persists, not legacy's separate preview-then-checkbox-commit steps
  // (see importChurchMonthlyXlsx's/importChurchActivityXlsx's/importChurchBudgetMultiYearXlsx's/
  // importChurchBalancesMultiYearXlsx's own header comments in src/api-finance.js). Unlike the two
  // routes above, none of these four legacy routes carries an explicit isAdmin check of its own --
  // verified directly against src/api-finance.js's source, not assumed -- so Connect's own gate is
  // the same looser blanket "finance edit" re-derivation the Daycare relays above already
  // established for legacy routes with no isAdmin check, not admin-only (see each contract
  // handler's own header comment in src/api-contracts-service.js). The uploaded file travels as a
  // base64 string in the JSON relay body, same as the two routes above.
  { id: 'church-monthly-xlsx-import-write-v1', paths: ['/api/v1/connect-church-monthly-xlsx-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-monthly-xlsx-import-write-relay.v1' },
  { id: 'church-monthly-xlsx-preview-v1', paths: ['/api/v1/connect-church-monthly-xlsx-preview'], methods: WRITE_METHODS, dataSource: 'live-relay', contract: 'connect.finance-church-monthly-xlsx-preview-relay.v1' },
  { id: 'church-monthly-xlsx-commit-v1', paths: ['/api/v1/connect-church-monthly-xlsx-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-monthly-xlsx-commit-relay.v1' },
  { id: 'church-activity-xlsx-import-write-v1', paths: ['/api/v1/connect-church-activity-xlsx-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-activity-xlsx-import-write-relay.v1' },
  { id: 'church-activity-xlsx-preview-v1', paths: ['/api/v1/connect-church-activity-xlsx-preview'], methods: WRITE_METHODS, dataSource: 'live-relay', contract: 'connect.finance-church-activity-xlsx-preview-relay.v1' },
  { id: 'church-activity-xlsx-commit-v1', paths: ['/api/v1/connect-church-activity-xlsx-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-activity-xlsx-commit-relay.v1' },
  { id: 'church-budget-multi-year-xlsx-import-write-v1', paths: ['/api/v1/connect-church-budget-multi-year-xlsx-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-budget-multi-year-xlsx-import-write-relay.v1' },
  { id: 'church-budget-multi-year-xlsx-preview-v1', paths: ['/api/v1/connect-church-budget-multi-year-xlsx-preview'], methods: WRITE_METHODS, dataSource: 'live-relay', contract: 'connect.finance-church-budget-multi-year-xlsx-preview-relay.v1' },
  { id: 'church-budget-multi-year-xlsx-commit-v1', paths: ['/api/v1/connect-church-budget-multi-year-xlsx-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-budget-multi-year-xlsx-commit-relay.v1' },
  { id: 'church-balances-multi-year-xlsx-import-write-v1', paths: ['/api/v1/connect-church-balances-multi-year-xlsx-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-balances-multi-year-xlsx-import-write-relay.v1' },
  { id: 'church-balances-multi-year-xlsx-preview-v1', paths: ['/api/v1/connect-church-balances-multi-year-xlsx-preview'], methods: WRITE_METHODS, dataSource: 'live-relay', contract: 'connect.finance-church-balances-multi-year-xlsx-preview-relay.v1' },
  { id: 'church-balances-multi-year-xlsx-commit-v1', paths: ['/api/v1/connect-church-balances-multi-year-xlsx-commit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-church-balances-multi-year-xlsx-commit-relay.v1' },
  // Same deliberate exception as the relays above, for a single Daycare Report entry: relays to
  // Connect's own finance-daycare-entry-v1 contract endpoint (never writes to Finance's own
  // database), matching the legacy in-Connect Daycare Report's own finance/daycare route exactly
  // -- gated on Connect's side by real edit permission on any of finance/budget/compensation, not
  // a simple role-name check (see the contract handler's own comment).
  { id: 'daycare-entry-v1', paths: ['/api/v1/connect-daycare-entry'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-entry-relay.v1' },
  // Same deliberate exception as the relays above, for Chart of Accounts' board-category
  // assignment: relays to Connect's own finance-board-categories-write-v1 contract endpoint
  // (never writes to Finance's own database), matching the legacy in-Connect Chart of Accounts'
  // own finance/planning/board-categories PUT route exactly (admin-only, a MERGE not a replace).
  { id: 'board-categories-write-v1', paths: ['/api/v1/connect-board-categories-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-board-categories-write-relay.v1' },
  // Same deliberate exception as the relays above, for Chart of Accounts' purpose-tag list and
  // per-account tag assignment: relays to Connect's own finance-purpose-tags-write-v1 contract
  // endpoint (never writes to Finance's own database), matching the legacy in-Connect Chart of
  // Accounts' own finance/planning/purpose-tags PUT route exactly (admin-only). `tags` is a full
  // replace of the whole tag list; `categories` merges, same as board-categories-write-v1 above.
  { id: 'purpose-tags-write-v1', paths: ['/api/v1/connect-purpose-tags-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-purpose-tags-write-relay.v1' },
  // Same deliberate exception as the relays above, for Commercial Property's monthly financials
  // entry: relays to Connect's own finance-property-monthly-write-v1 contract endpoint (never
  // writes to Finance's own database), matching the legacy in-Connect Property Operating Results'
  // own finance/property/ivanhoe/monthly POST route exactly (admin-only, one property/period
  // upsert). Distinct from the separately-merged Finance-owned-D1 reserve/disbursement/
  // distribution/capital-ledger routes -- this is the core monthly revenue/expense/NOI row those
  // don't cover.
  { id: 'property-monthly-write-v1', paths: ['/api/v1/connect-property-monthly-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-monthly-write-relay.v1' },
  // Same deliberate exception as the relays above, for Commercial Property's repairs &
  // maintenance log: relays to Connect's own finance-property-repair-write-v1 contract endpoint
  // (never writes to Finance's own database), matching the legacy in-Connect Work orders page's
  // own finance/property/ivanhoe/repairs POST route exactly (admin-only).
  { id: 'property-repair-write-v1', paths: ['/api/v1/connect-property-repair-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-repair-write-relay.v1' },
  // Same deliberate exception as the relays above, for Commercial Property's Distributions,
  // Reserve schedule/disbursement, and Capital-improvements ledger: each relays to its own Connect
  // contract endpoint (never writes to Finance's own database), matching the legacy in-Connect
  // Property pages' own finance/property/ivanhoe/distributions, .../reserves/:reserveKey/monthly,
  // .../reserves/:reserveKey/disbursements, and .../capital-ledger POST routes exactly
  // (admin-only). Distinct from the separately-merged, still-OFF Finance-owned-D1
  // property-reserve-entry-v1/property-reserve-disbursement-entry-v1/property-distribution-entry-v1/
  // property-capital-ledger-entry-v1 routes further below, which write to Finance's OWN database
  // instead of relaying -- these four `-write-v1` routes are the live-relay counterparts, following
  // the same "full function, same data, same app" relay pattern as property-monthly-write-v1/
  // property-repair-write-v1 above.
  { id: 'property-distribution-write-v1', paths: ['/api/v1/connect-property-distribution-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-distribution-write-relay.v1' },
  { id: 'property-reserve-monthly-write-v1', paths: ['/api/v1/connect-property-reserve-monthly-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-reserve-monthly-write-relay.v1' },
  { id: 'property-reserve-disbursement-write-v1', paths: ['/api/v1/connect-property-reserve-disbursement-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-reserve-disbursement-write-relay.v1' },
  { id: 'property-capital-ledger-write-v1', paths: ['/api/v1/connect-property-capital-ledger-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-capital-ledger-write-relay.v1' },
  // Same deliberate exception as the relays above, completing Commercial Property's write parity:
  // the six remaining legacy DELETE-by-key routes (each removes one row by its natural key --
  // never taking the property key from the request body, same 'ivanhoe' hardcoding as every other
  // property relay), the meta PATCH (a per-section MERGE into the finance_settings JSON blob), and
  // the two bulk-import routes (the AHRA "Budget Detail" .xlsx upload and the pasted-in monthly-
  // financials CSV) -- each relays to its own Connect contract endpoint (never writes to Finance's
  // own database), matching the legacy in-Connect Property pages' own DELETE/PATCH/POST routes
  // exactly (admin-only). Route ids and paths use "remove" rather than "delete", the same
  // word-substitution shell.js's literal-word ban already established for budget-plan-remove-v1.
  { id: 'property-monthly-remove-v1', paths: ['/api/v1/connect-property-monthly-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-monthly-remove-relay.v1' },
  { id: 'property-distribution-remove-v1', paths: ['/api/v1/connect-property-distribution-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-distribution-remove-relay.v1' },
  { id: 'property-reserve-monthly-remove-v1', paths: ['/api/v1/connect-property-reserve-monthly-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-reserve-monthly-remove-relay.v1' },
  { id: 'property-reserve-disbursement-remove-v1', paths: ['/api/v1/connect-property-reserve-disbursement-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-reserve-disbursement-remove-relay.v1' },
  { id: 'property-capital-ledger-remove-v1', paths: ['/api/v1/connect-property-capital-ledger-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-capital-ledger-remove-relay.v1' },
  { id: 'property-repair-remove-v1', paths: ['/api/v1/connect-property-repair-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-repair-remove-relay.v1' },
  { id: 'property-meta-write-v1', paths: ['/api/v1/connect-property-meta-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-meta-write-relay.v1' },
  { id: 'property-budget-import-write-v1', paths: ['/api/v1/connect-property-budget-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-budget-import-write-relay.v1' },
  { id: 'property-monthly-import-csv-write-v1', paths: ['/api/v1/connect-property-monthly-import-csv-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-property-monthly-import-csv-write-relay.v1' },
  // Same deliberate exception as the relays above, for Financial Health/Charts' three settings-
  // blob edits (revenue-stream classification, flow-diagram expense-category mapping, and the
  // cash-runway policy settings): each relays to its own Connect contract endpoint (never writes
  // to Finance's own database), matching the legacy in-Connect finance/revenue-streams,
  // finance/flow-expense-map, and finance/cash-policy PUT routes exactly (admin-only). No existing
  // live page in this app surfaces the underlying read data yet, so these three routes have no
  // calling form today -- see apps/finance/README.md's changelog entry for why, and
  // finance-chart-of-accounts-client.js for the transports.
  { id: 'revenue-streams-write-v1', paths: ['/api/v1/connect-revenue-streams-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-revenue-streams-write-relay.v1' },
  { id: 'flow-expense-map-write-v1', paths: ['/api/v1/connect-flow-expense-map-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-flow-expense-map-write-relay.v1' },
  { id: 'cash-policy-write-v1', paths: ['/api/v1/connect-cash-policy-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-cash-policy-write-relay.v1' },
  // Same deliberate exception as the relays above, for the Daycare Report's Utilities/Insurance
  // cost-share config: relays to Connect's own finance-daycare-allocation-config-write-v1 contract
  // endpoint (never writes to Finance's own database), matching the legacy in-Connect Daycare
  // Report's own finance/daycare/allocation-config PUT route exactly (admin-only).
  { id: 'daycare-allocation-config-write-v1', paths: ['/api/v1/connect-daycare-allocation-config-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-allocation-config-write-relay.v1' },
  // Same deliberate exception as the relays above, for the Daycare Report's per-(year,category)
  // Budget-cell override: relays to Connect's own finance-daycare-budget-override-write-v1
  // contract endpoint (never writes to Finance's own database), matching the legacy in-Connect
  // Daycare Report's own finance/daycare/budget-override POST route exactly (admin-only).
  { id: 'daycare-budget-override-write-v1', paths: ['/api/v1/connect-daycare-budget-override-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-budget-override-write-relay.v1' },
  // Same deliberate exception as the relays above, for the Daycare Report's bulk paste-in entry
  // and Church-Budget re-derivation: each relays to its own Connect contract endpoint (never
  // writes to Finance's own database), matching the legacy in-Connect Daycare Report's own
  // finance/daycare/bulk and finance/daycare/church-budget-import POST routes exactly -- gated on
  // Connect's side by real edit permission on any of finance/budget/compensation, not a simple
  // role-name check, the same looser gate as daycare-entry-v1 above (see each contract handler's
  // own comment in src/api-contracts-service.js).
  { id: 'daycare-bulk-write-v1', paths: ['/api/v1/connect-daycare-bulk-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-bulk-write-relay.v1' },
  { id: 'daycare-church-budget-import-write-v1', paths: ['/api/v1/connect-daycare-church-budget-import-write'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-church-budget-import-write-relay.v1' },
  // Same deliberate exception as the relays above, completing the Daycare Report's write parity:
  // an existing entry's edit/remove (by id) and the two trigger-a-sync actions -- each relays to
  // its own Connect contract endpoint (never writes to Finance's own database), matching the
  // legacy in-Connect Daycare Report's own finance/daycare/:id PUT/DELETE and finance/daycare/sync,
  // finance/daycare/rooms/sync POST routes exactly. Edit/remove use the same looser blanket-
  // permission gate (edit on any of finance/budget/compensation, not a simple role-name check) as
  // daycare-entry-v1/daycare-bulk-write-v1 above, since the legacy PUT/DELETE routes carry no role
  // check of their own beyond the blanket ACCESS_GATE -- re-verified directly against
  // src/api-finance.js's source for this batch, not assumed. The money sync uses that SAME looser
  // gate (finance/daycare/sync also carries no isAdmin check of its own); the room sync is
  // admin-only, matching finance/daycare/rooms/sync's own explicit isAdmin check exactly.
  { id: 'daycare-entry-edit-v1', paths: ['/api/v1/connect-daycare-entry-edit'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-entry-edit-relay.v1' },
  { id: 'daycare-entry-remove-v1', paths: ['/api/v1/connect-daycare-entry-remove'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-entry-remove-relay.v1' },
  { id: 'daycare-sync-v1', paths: ['/api/v1/connect-daycare-sync'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-sync-relay.v1' },
  { id: 'daycare-rooms-sync-v1', paths: ['/api/v1/connect-daycare-rooms-sync'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'connect.finance-daycare-rooms-sync-relay.v1' },
  // Facilities (v3 design): Finance-owned asset register, service history, maintenance schedule,
  // and capital projects (migration 0010, facilities-service.js). Form posts that redirect back.
  { id: 'facilities-asset-save-v1', paths: ['/api/v1/facilities/asset-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true, contract: 'finance.facilities-asset-save.v1' },
  { id: 'facilities-service-log-v1', paths: ['/api/v1/facilities/service-log'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true, contract: 'finance.facilities-service-log.v1' },
  { id: 'facilities-service-remove-v1', paths: ['/api/v1/facilities/service-remove'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true, contract: 'finance.facilities-service-remove.v1' },
  { id: 'facilities-pm-save-v1', paths: ['/api/v1/facilities/pm-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true, contract: 'finance.facilities-pm-save.v1' },
  { id: 'facilities-pm-done-v1', paths: ['/api/v1/facilities/pm-done'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true, contract: 'finance.facilities-pm-done.v1' },
  { id: 'facilities-project-save-v1', paths: ['/api/v1/facilities/project-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true, contract: 'finance.facilities-project-save.v1' },
  { id: 'summary-legacy', paths: ['/api/summary'], dataSource: 'synthetic-d1', queryBudget: 'summary', deprecated: true },
  // Temporary diagnostic to confirm the payroll relay (payroll-proxy-client.js) actually reaches
  // Website's production payroll proxy end to end. Read-only from Finance's own perspective (no
  // Finance DB write), but -- like the Giving relay above -- it is a genuine live call out, not a
  // synthetic fixture, so it gets its own `dataSource` value rather than borrowing the synthetic
  // ones. The real payroll screens now exist (see payroll-section.js) and exercise this path
  // naturally through their own routes below; this stays only as a narrow, no-data-shown probe.
  { id: 'payroll-relay-diagnostic-v1', paths: ['/api/v1/payroll-relay-diagnostic'], dataSource: 'live-relay-read', contract: 'finance.payroll-relay-diagnostic.v1' },
  // ── Real payroll parity, relayed live to Website's existing payroll proxy, the same way the
  // Giving relay above reaches Connect. Never stored in Finance's own database -- every read is
  // re-fetched from Website on each request and every write below is a live RPC call out, gated
  // entirely by Website's own payroll_manage check on the resolved contract-relay identity (see
  // payroll-contract-auth.js in the website repo). `writer: true` on the four write routes for
  // the same reason as the Giving relay: this is the one deliberate exception to "Finance is
  // read-only", made visible here rather than in a conditional elsewhere.
  { id: 'payroll-hours-save-v1', paths: ['/api/v1/payroll-hours-save'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'finance.payroll-hours-save-relay.v1' },
  { id: 'payroll-period-approve-v1', paths: ['/api/v1/payroll-period-approve'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'finance.payroll-period-approve-relay.v1' },
  { id: 'payroll-staff-save-v1', paths: ['/api/v1/payroll-staff-save'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'finance.payroll-staff-save-relay.v1' },
  { id: 'payroll-staff-deactivate-v1', paths: ['/api/v1/payroll-staff-deactivate'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'finance.payroll-staff-deactivate-relay.v1' },
  { id: 'payroll-csv-v1', paths: ['/api/v1/payroll-csv'], dataSource: 'live-relay-read', contract: 'finance.payroll-csv-relay.v1' },
  // Emails the report to the bookkeeper through Website's own /payroll/email route (not a
  // Supabase RPC -- see payroll-email-client.js) now that it accepts Finance's contract-relay
  // identity (timothystl/website PR #587).
  { id: 'payroll-email-v1', paths: ['/api/v1/payroll-email'], methods: WRITE_METHODS, dataSource: 'live-relay', writer: true, contract: 'finance.payroll-email-relay.v1' },
  // ── CSV import writes (see csv-import-service.js) and the Compensation Planner save below are
  // the routes in this app that write to Finance's OWN database (FINANCE_DB) rather than relaying
  // to Connect/Website or reading a synthetic fixture. Each of these routes is gated OFF by
  // default inside its own handler (`isCsvImportWritesEnabled` / `isCompensationPlanWriteEnabled`,
  // checked before any role check) — reachable and fully tested here, but not live in production
  // until a later, separately-approved cutover stage flips the gate.
  { id: 'import-church-v1', paths: ['/api/v1/import/church'], methods: WRITE_METHODS, dataSource: 'd1-write', writer: true, contract: 'finance.import-church.v1' },
  { id: 'import-church-balances-v1', paths: ['/api/v1/import/church-balances'], methods: WRITE_METHODS, dataSource: 'd1-write', writer: true, contract: 'finance.import-church-balances.v1' },
  { id: 'import-daycare-v1', paths: ['/api/v1/import/daycare'], methods: WRITE_METHODS, dataSource: 'd1-write', writer: true, contract: 'finance.import-daycare.v1' },
  { id: 'import-property-budget-v1', paths: ['/api/v1/import/property-budget'], methods: WRITE_METHODS, dataSource: 'd1-write', writer: true, contract: 'finance.import-property-budget.v1' },
  // ── .xlsx (Excel) import writes for the same two report types csv-import-service.js already
  // covers by CSV -- see xlsx-import-service.js's header comment for the ported grid-reader
  // parsing rules and why this is a SEPARATE gate from the CSV routes above (never piggybacked on
  // isCsvImportWritesEnabled). Same 'd1-write' dataSource and off-by-default shape as the CSV
  // import routes; writes to the exact same finance_church_entries/finance_church_balances tables,
  // tagged with their own 'import_xlsx' source.
  { id: 'import-church-xlsx-v1', paths: ['/api/v1/import/church-xlsx'], methods: WRITE_METHODS, dataSource: 'd1-write', writer: true, contract: 'finance.import-church-xlsx.v1' },
  { id: 'import-church-balances-xlsx-v1', paths: ['/api/v1/import/church-balances-xlsx'], methods: WRITE_METHODS, dataSource: 'd1-write', writer: true, contract: 'finance.import-church-balances-xlsx.v1' },
  // Compensation planning is target-architecture Finance-owned data (chms/AGENTS.md's product
  // boundary: "Finance owns ... compensation planning"), not a relay of someone else's
  // authoritative record, so a real local copy is the intended end state, not a stopgap. See
  // compensation-plan-write-service.js's header comment and apps/finance/README.md's changelog
  // entry for exactly what per-worker capability this table does and does not yet carry relative
  // to the legacy Salary Planner roster (src/api-finance.js).
  { id: 'compensation-plan-save-v1', paths: ['/api/v1/compensation-plan-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
  // A further deliberate finance-db-write group, same "writes to Finance's own database, off by
  // default" pattern as compensation-plan-save-v1/budget-plan-save-v1/the import-*-v1 routes
  // above, for the Commercial Property reserve schedule/disbursements/distributions/capital
  // ledger -- ported from legacy's real write routes in src/api-finance.js's handlePropertyApi
  // onto Finance's own already-matching schema (see property-ledger-write-service.js's header for
  // the ported validation and the verified real finding that legacy enforces no reserve-overdraw
  // check on this path). isPropertyLedgerWritesEnabled() is checked first, before any role check,
  // exactly like the other finance-db-write gates above -- until Andrew explicitly turns it on.
  // See apps/finance/README.md's changelog entry.
  { id: 'property-reserve-entry-v1', paths: ['/api/v1/property-reserve-entry'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
  { id: 'property-reserve-disbursement-entry-v1', paths: ['/api/v1/property-reserve-disbursement-entry'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
  { id: 'property-distribution-entry-v1', paths: ['/api/v1/property-distribution-entry'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
  { id: 'property-capital-ledger-entry-v1', paths: ['/api/v1/property-capital-ledger-entry'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
  // ── Compensation Planner GLOBAL raise-plan options + per-council-member private draft --
  // additive to compensation-plan-save-v1 above, never a replacement for it (see
  // compensation-raise-plan-service.js's and compensation-council-draft-service.js's header
  // comments). Same 'finance-db-write' shape, same reused isCompensationPlanWriteEnabled gate --
  // one Compensation Planner write rollout decision, not a second flag to keep in sync.
  { id: 'compensation-raise-plan-save-v1', paths: ['/api/v1/compensation-raise-plan-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
  { id: 'compensation-council-draft-save-v1', paths: ['/api/v1/compensation-council-draft-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
];

export const FINANCE_ROUTE_MANIFEST = Object.freeze(ROUTES.map((route) => Object.freeze({
  ...route,
  methods: Object.freeze(route.methods || READ_METHODS),
  paths: Object.freeze([...route.paths]),
  ...(route.optionalQueryBudgets ? { optionalQueryBudgets: Object.freeze([...route.optionalQueryBudgets]) } : {}),
})));

const ROUTE_BY_PATH = new Map(
  FINANCE_ROUTE_MANIFEST.flatMap((route) => route.paths.map((path) => [path, route])),
);

export function resolveFinanceRoute(pathname) {
  return ROUTE_BY_PATH.get(pathname);
}

// Every route defaults to read-only (GET/HEAD, see FINANCE_ROUTE_MANIFEST above). A route only
// accepts anything else by declaring its own `methods` explicitly in the table above -- there is
// no blanket "Finance now allows writes" switch, only per-route opt-ins that stay visible in one
// place. Callers check the method against the RESOLVED route, not globally, so an unlisted path
// still 404s before this ever runs.
export function isMethodAllowedForRoute(route, method) {
  return route.methods.includes(method);
}
