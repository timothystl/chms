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
  // Website's production payroll proxy end to end, before any real payroll UI is built on top of
  // it. Read-only from Finance's own perspective (no Finance DB write), but -- like the Giving
  // relay above -- it is a genuine live call out, not a synthetic fixture, so it gets its own
  // `dataSource` value rather than borrowing the synthetic ones. Remove once the real payroll
  // screens exist and exercise this path naturally.
  { id: 'payroll-relay-diagnostic-v1', paths: ['/api/v1/payroll-relay-diagnostic'], dataSource: 'live-relay-read', contract: 'finance.payroll-relay-diagnostic.v1' },
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
