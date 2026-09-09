const READ_METHODS = Object.freeze(['GET', 'HEAD']);

const ROUTES = [
  { id: 'shell', paths: ['/', '/index.html'], dataSource: 'synthetic-d1', queryBudget: 'summary', optionalQueryBudgets: ['churchReport', 'balanceSheet', 'daycareReport', 'propertyReport', 'budgetReport', 'accountsReport'] },
  { id: 'health', paths: ['/health'], dataSource: 'none' },
  { id: 'summary-v1', paths: ['/api/v1/summary'], dataSource: 'synthetic-d1', queryBudget: 'summary', contract: 'finance.summary.v1' },
  { id: 'giving-preview-v1', paths: ['/api/v1/connect-giving-preview'], dataSource: 'synthetic-static', contract: 'connect.giving-summary.v1' },
  { id: 'summary-legacy', paths: ['/api/summary'], dataSource: 'synthetic-d1', queryBudget: 'summary', deprecated: true },
];

export const FINANCE_ROUTE_MANIFEST = Object.freeze(ROUTES.map((route) => Object.freeze({
  ...route,
  methods: READ_METHODS,
  paths: Object.freeze([...route.paths]),
  ...(route.optionalQueryBudgets ? { optionalQueryBudgets: Object.freeze([...route.optionalQueryBudgets]) } : {}),
})));

const ROUTE_BY_PATH = new Map(
  FINANCE_ROUTE_MANIFEST.flatMap((route) => route.paths.map((path) => [path, route])),
);

export function resolveFinanceRoute(pathname) {
  return ROUTE_BY_PATH.get(pathname);
}

export function isFinanceMethodAllowed(method) {
  return READ_METHODS.includes(method);
}
