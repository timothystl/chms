const READ_METHODS = Object.freeze(['GET', 'HEAD']);
const WRITE_METHODS = Object.freeze(['POST']);

const ROUTES = [
  { id: 'shell', paths: ['/', '/index.html'], dataSource: 'synthetic-d1', queryBudget: 'summary', optionalQueryBudgets: ['churchReport', 'churchTrends', 'balanceSheet', 'balanceTrends', 'daycareReport', 'daycareAllocation', 'propertyReport', 'propertyReserves', 'propertyLedgers', 'propertyValuation', 'propertyForecast', 'budgetReport', 'accountsReport', 'dataStatus', 'compensationReport', 'compensationBenchmark', 'compensationBenefits', 'cashRunway'] },
  { id: 'health', paths: ['/health'], dataSource: 'none' },
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
  // Compensation planning is target-architecture Finance-owned data (chms/AGENTS.md's product
  // boundary: "Finance owns ... compensation planning"), not a relay of someone else's
  // authoritative record, so a real local copy is the intended end state, not a stopgap. See
  // compensation-plan-write-service.js's header comment and apps/finance/README.md's changelog
  // entry for exactly what per-worker capability this table does and does not yet carry relative
  // to the legacy Salary Planner roster (src/api-finance.js).
  { id: 'compensation-plan-save-v1', paths: ['/api/v1/compensation-plan-save'], methods: WRITE_METHODS, dataSource: 'finance-db-write', writer: true },
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
