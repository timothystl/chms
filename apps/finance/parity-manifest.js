// Finance's sidebar nav registry. Each top-level entry below is one sidebar item (`id` is the
// `?section=` value, unchanged from the original 11-section parity plan so every existing link,
// bookmark, and test keeps working); `pages` breaks that section into the Finance App redesign's
// sub-pages, addressed as `?section=<id>&page=<pageId>` with `page` defaulting to `pages[0].id`.
//
// Every page is either:
//   - `status: 'live'`        — apps/finance/*-pages.js has a real render function for it, backed
//                                 by an existing service/table (never fabricated numbers), or
//   - `status: 'unavailable'` — no table/service computes this yet; shell.js renders a plain,
//                                 honestly-labeled "not yet available" page with `reason` instead
//                                 of guessing at data or hiding the nav entry.
// `resolveFinanceSection()` and every permission check still key off the top-level `id`, exactly
// as before PR #961 and the sub-page breakout -- `pages`/`group` are additive display metadata.
export const FINANCE_PARITY_SECTIONS = Object.freeze([
  {
    id: 'health', label: 'Financial Health', group: 'Dashboard', permission: 'finance',
    capabilities: ['KPI health', 'giving pace', 'cash runway', 'revenue and expense mix', 'entity overview', 'money flow'],
    pages: [{ id: 'overview', label: 'Are we okay?', status: 'live' }],
  },
  {
    id: 'giving', label: 'Giving Entry', group: 'Gift Entry', permission: 'finance',
    capabilities: ['record a gift', 'relayed live to Connect, never stored in Finance'],
    pages: [
      { id: 'quick-entry', label: 'Record a gift', status: 'live' },
      { id: 'funds', label: 'Funds', status: 'live' },
      { id: 'batch', label: 'Enter a batch', status: 'unavailable', reason: 'Finance has no deposit/batch table yet -- gifts are recorded one at a time, live into Connect. A batch/count-and-assign workflow needs a new data model and product decision before it can be built for real.' },
      { id: 'reconciliation', label: 'Reconciliation to bank', status: 'unavailable', reason: 'There is no batch or bank-deposit table to reconcile against yet. This page will need both a batch workflow and a bank-feed connection before it can show anything real.' },
      { id: 'reports', label: 'Batch reports', status: 'unavailable', reason: 'Batch reporting depends on the batch workflow above, which does not exist yet. Nothing to report on until gifts are grouped into batches somewhere.' },
    ],
  },
  {
    id: 'giving-analytics', label: 'Giving', group: 'Giving', permission: 'finance',
    capabilities: ['trends', 'year over year', 'household bands', 'pledges', 'what-if modeling', 'statements'],
    pages: [
      { id: 'trends', label: 'Trends', status: 'unavailable', reason: 'The Connect giving-summary contract Finance consumes is a single-period aggregate (this month’s fund totals), not a stored multi-period series -- there is nothing to trend yet.' },
      { id: 'year-over-year', label: 'Year over year', status: 'unavailable', reason: 'Same limit as Trends: only one period of aggregate giving data is available at a time, so there is no prior year to compare against.' },
      { id: 'household-bands', label: 'Household bands', status: 'unavailable', reason: 'The giving contract is deliberately aggregate-only, with no household-level rows -- Council Giving access is aggregate/anonymous by design, so this isn’t just unbuilt, it needs a new, explicitly-approved contract shape before it can exist.' },
      { id: 'pledges', label: 'Pledges', status: 'unavailable', reason: 'There is no pledge table anywhere in Connect or Finance today. This is a new feature, not a missing report.' },
      { id: 'what-if', label: 'Giving what-if', status: 'unavailable', reason: 'Modeling depends on the Trends data above, which does not exist yet.' },
      { id: 'statements', label: 'Giving statements', status: 'unavailable', reason: 'Donor-level statements need donor-level records. The contract Finance consumes is aggregate-only on purpose -- this needs a deliberate, approved change to what Connect shares with Finance, not just a new page.' },
    ],
  },
  {
    id: 'charts', label: 'Charts', group: 'Charts', permission: 'finance',
    capabilities: ['giving pace', 'cash and reserve', 'expense mix', 'revenue mix', 'giving concentration'],
    pages: [
      { id: 'revenue-mix', label: 'Revenue mix', status: 'live' },
      { id: 'expense-mix', label: 'Expense mix', status: 'live' },
      { id: 'cash-reserve', label: 'Cash & reserve', status: 'live' },
      { id: 'giving-pace', label: 'Giving vs. pace', status: 'live' },
      { id: 'concentration', label: 'Giving concentration', status: 'unavailable', reason: 'This needs a distribution of gift sizes across donors or households, which the aggregate-only giving contract does not provide.' },
    ],
  },
  {
    id: 'church', label: 'Church Report', group: 'Church', permission: 'finance',
    capabilities: ['current year', 'multi-year trends', 'income and expense detail', 'board packet'],
    pages: [
      { id: 'overview', label: 'Overview', status: 'live' },
      { id: 'income-expense', label: 'Income & expense detail', status: 'live' },
      { id: 'trend', label: 'Multi-year trend', status: 'live' },
      { id: 'budget-actual', label: 'Budget vs actual', status: 'live' },
    ],
  },
  {
    id: 'balance', label: 'Balance Sheet', group: 'Balance Sheet', permission: 'finance',
    capabilities: ['assets', 'liabilities', 'equity', 'position trends'],
    pages: [
      { id: 'position', label: 'Position', status: 'live' },
      { id: 'account-detail', label: 'Account detail', status: 'live' },
      { id: 'multi-year', label: 'Multi-year position', status: 'live' },
    ],
  },
  {
    id: 'daycare', label: 'Daycare Report', group: 'Daycare', permission: 'finance',
    capabilities: ['actuals', 'budgets', 'shared-cost allocations'],
    pages: [
      { id: 'overview', label: 'Overview', status: 'live' },
      { id: 'actuals', label: 'Actuals detail', status: 'live' },
      { id: 'budget-comparison', label: 'Budget comparison', status: 'live' },
      { id: 'shared-costs', label: 'Shared costs', status: 'live' },
    ],
  },
  {
    id: 'property', label: 'Commercial Property', group: 'Commercial Property', permission: 'finance',
    capabilities: ['monthly financials', 'reserves', 'capital', 'repairs', 'forecast', 'valuation'],
    pages: [
      { id: 'overview', label: 'Overview', status: 'live' },
      { id: 'operating-results', label: 'Operating results', status: 'live' },
      { id: 'rent-roll', label: 'Rent roll', status: 'live' },
      { id: 'receivables', label: 'Receivables & deposits', status: 'unavailable', reason: 'There is no tenant-receivable or security-deposit table -- the property model tracks monthly totals and ledgers, not per-tenant balances.' },
      { id: 'work-orders', label: 'Work orders & repairs', status: 'live' },
      { id: 'bank-rec', label: 'Position & bank rec', status: 'unavailable', reason: 'The property has no balance sheet or bank account of its own to reconcile -- only income/expense and reserve tables exist.' },
      { id: 'reserve-distribution', label: 'Reserve & distribution', status: 'live' },
      { id: 'capital', label: 'Capital improvements', status: 'live' },
      { id: 'valuation', label: 'Valuation', status: 'live' },
      { id: 'forecast', label: 'Run-rate forecast', status: 'live' },
      { id: 'distributions', label: 'Distributions', status: 'live' },
      { id: 'debt', label: 'Debt payoff & future', status: 'unavailable', reason: 'The monthly property table has loan-payment and interest-expense columns, but the synthetic fixture leaves them empty and nothing populates them yet -- there is no loan schedule to project.' },
      { id: 'acquisition', label: 'Acquisition model', status: 'unavailable', reason: 'There is no purchase-price or pro-forma data structure for a hypothetical acquisition -- this is a new modeling feature, not a missing report.' },
    ],
  },
  {
    id: 'planning', label: 'Budget', group: 'Planning', permission: 'budget',
    capabilities: ['budget builder', 'outlook', 'board categories', 'purpose tags'],
    pages: [
      { id: 'builder', label: 'Budget builder', status: 'live' },
      { id: 'scenarios', label: 'Scenarios', status: 'unavailable', reason: 'The budget plan table stores one plan per fiscal year -- there is no way to hold alternate what-if scenarios alongside it yet.' },
      { id: 'multi-year', label: 'Multi-year forecast', status: 'unavailable', reason: 'Only next fiscal year has planned figures today; there is no forward multi-year budget series to forecast from.' },
      { id: 'compensation-link', label: 'Compensation', status: 'live' },
    ],
  },
  {
    id: 'compensation', label: 'Compensation', group: 'Compensation', permission: 'compensation',
    capabilities: ['salary planning', 'benefits', 'district comparisons', 'council report'],
    pages: [
      { id: 'plan', label: 'Plan', status: 'live' },
      { id: 'benefits', label: 'Benefits & taxes', status: 'live' },
      { id: 'benchmarks', label: 'Benchmarks', status: 'live' },
      { id: 'council', label: 'Council snapshot', status: 'live' },
    ],
  },
  {
    id: 'quickbooks', label: 'QuickBooks', group: 'QuickBooks', permission: 'finance',
    capabilities: ['connection status', 'account mapping'],
    pages: [
      { id: 'sync-status', label: 'Sync status', status: 'live' },
      { id: 'account-mapping', label: 'Account mapping', status: 'live' },
      { id: 'transactions', label: 'Transactions', status: 'unavailable', reason: 'Finance only ever received period totals, never individual QuickBooks transactions -- there is no transaction-level table to list.' },
      { id: 'expense-drilldown', label: 'Expense drill-down', status: 'unavailable', reason: 'Drilling into an expense total needs the underlying transactions, which Finance does not have (see Transactions).' },
      { id: 'vendor-spend', label: 'Vendor spend', status: 'unavailable', reason: 'Only the property capital and repairs ledgers carry a payee field today -- there is no general vendor-spend rollup across the whole ledger.' },
      { id: 'exceptions', label: 'Exceptions', status: 'unavailable', reason: 'Exception detection needs transaction-level data to compare against, which does not exist here (see Transactions).' },
      { id: 'import-history', label: 'Import history', status: 'unavailable', reason: 'The import-log table keeps one current-status row per importer, not a history of past imports -- showing more than "current status" needs a schema change, not just a new query.' },
    ],
  },
  {
    id: 'packet', label: 'Board packet', group: 'Board packet', permission: 'finance',
    capabilities: ['pinned reports', 'cover note', 'export'],
    pages: [{ id: 'builder', label: 'Board packet', status: 'live' }],
  },
  {
    id: 'accounts', label: 'Chart of Accounts', group: 'Accounts & Data', permission: 'finance',
    capabilities: ['account tree', 'board-category presentation'],
    pages: [
      { id: 'chart', label: 'Chart of accounts', status: 'live' },
      { id: 'access', label: 'Access & roles', status: 'unavailable', reason: 'Role and permission data lives in Connect’s access control, not in a Finance-owned table -- Finance has nothing of its own to display here yet.' },
    ],
  },
  // 'connection status' and 'staleness' are real now, via the connect.finance-data-status.v1
  // contract (import-log recency + QuickBooks connection presence, no tokens) -- see
  // finance-data-status-client.js and data-status-service.js's resolveDataStatus, same
  // live-with-synthetic-fallback pattern Giving Entry established. File imports,
  // classification/policy, and administrative tools remain synthetic-only for now.
  { id: 'data', label: 'Data & Imports', group: 'Accounts & Data', permission: 'finance', capabilities: ['connection status', 'file imports', 'staleness', 'classification and policy', 'administrative tools'], pages: [{ id: 'overview', label: 'Data & Imports', status: 'live' }] },
  // Full payroll parity with Website's admin/payroll.html, relayed live to Website's existing
  // payroll proxy and payroll/email and (now) push/payroll-ready routes the same way Giving
  // Entry relays to Connect (never stored in Finance) -- see payroll-section.js,
  // payroll-calc.js, payroll-proxy-client.js, payroll-email-client.js, and
  // payroll-ready-client.js. Kept as one nav entry rather than split into the redesign's four
  // sub-pages: renderPayrollSection() already implements staff roster, hours & PTO, period
  // approval, and reports as client-side tabs inside one page -- splitting it into separate
  // server routes would fight that existing, working structure rather than improve it.
  { id: 'payroll', label: 'Payroll', group: 'Payroll', permission: 'admin', capabilities: ['staff roster', 'hours and PTO entry', 'period approval', 'MDO hours integration', 'reports', 'CSV export', 'email the report', 'relayed live to Website, never stored in Finance'], pages: [{ id: 'workspace', label: 'Payroll', status: 'live' }] },
].map((section) => Object.freeze({
  ...section,
  capabilities: Object.freeze(section.capabilities),
  pages: Object.freeze(section.pages.map((page) => Object.freeze({ ...page }))),
})));

const SECTION_BY_ID = new Map(FINANCE_PARITY_SECTIONS.map((section) => [section.id, section]));

export function resolveFinanceSection(id) {
  return SECTION_BY_ID.get(id) || SECTION_BY_ID.get('health');
}

export function resolveFinancePage(section, pageId) {
  return section.pages.find((page) => page.id === pageId) || section.pages[0];
}

// Explicit sidebar group order, independent of each section's position in FINANCE_PARITY_SECTIONS.
const GROUP_ORDER = [
  'Dashboard', 'Gift Entry', 'Giving', 'Charts', 'Church', 'Balance Sheet', 'Daycare',
  'Commercial Property', 'Planning', 'Compensation', 'Payroll', 'QuickBooks', 'Board packet',
  'Accounts & Data',
];

export function groupFinanceSections(sections = FINANCE_PARITY_SECTIONS) {
  const byGroup = new Map();
  for (const section of sections) {
    const group = section.group || 'Other';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(section);
  }
  const order = [...GROUP_ORDER, ...[...byGroup.keys()].filter((group) => !GROUP_ORDER.includes(group))];
  return order.filter((group) => byGroup.has(group)).map((group) => ({ group, sections: byGroup.get(group) }));
}
