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
