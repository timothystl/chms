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
    id: 'health', label: 'Financial Health', group: 'Financial Health', permission: 'finance',
    capabilities: ['KPI health', 'giving pace', 'cash runway', 'revenue and expense mix', 'entity overview', 'money flow'],
    pages: [{ id: 'overview', label: 'Are we okay?', status: 'live' }],
  },
  {
    id: 'giving', label: 'Giving Entry', group: 'Gift Entry', permission: 'finance',
    // Batches, deposits and gifts live in Connect's giving_* tables; these pages read and write
    // them through the giving-batch-*-v1 contracts (connect-giving-batch-client.js).
    capabilities: ['enter a batch', 'bank reconciliation', 'batch reports', 'record a gift', 'relayed live to Connect, never stored in Finance'],
    pages: [
      { id: 'batch', label: 'Enter a batch', status: 'live' },
      { id: 'funds', label: 'Funds', status: 'live' },
      { id: 'reconciliation', label: 'Reconciliation to bank', status: 'live' },
      { id: 'reports', label: 'Batch reports', status: 'live' },
      { id: 'quick-entry', label: 'Record a single gift', status: 'live' },
    ],
  },
  {
    id: 'giving-analytics', label: 'Giving', group: 'Giving', permission: 'finance',
    capabilities: ['trends', 'year over year', 'household bands', 'pledges', 'what-if modeling', 'statements', 'nudges'],
    pages: [
      { id: 'trends', label: 'Trends', status: 'live' },
      { id: 'year-over-year', label: 'Year over year', status: 'live' },
      { id: 'household-bands', label: 'Household bands', status: 'live' },
      { id: 'pledges', label: 'Pledges', status: 'live' },
      { id: 'what-if', label: 'Giving what-if', status: 'live' },
      { id: 'statements', label: 'Giving statements', status: 'live' },
      { id: 'nudges', label: 'Giving nudges', status: 'live' },
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
      { id: 'concentration', label: 'Giving concentration', status: 'live' },
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
      { id: 'receivables', label: 'Receivables & deposits', status: 'live' },
      { id: 'work-orders', label: 'Work orders & repairs', status: 'live' },
      { id: 'bank-rec', label: 'Position & bank rec', status: 'live' },
      { id: 'reserve-distribution', label: 'Reserve & distribution', status: 'live' },
      { id: 'capital', label: 'Capital improvements', status: 'live' },
      { id: 'valuation', label: 'Valuation', status: 'live' },
      { id: 'forecast', label: 'Run-rate forecast', status: 'live' },
      { id: 'distributions', label: 'Distributions', status: 'live' },
      { id: 'debt', label: 'Debt payoff & future', status: 'live' },
      { id: 'acquisition', label: 'Acquisition model', status: 'live' },
    ],
  },
  // Facilities is new in the v3 design: an asset register with service history, capital projects,
  // and a preventive-maintenance schedule, stored in Finance's own tables (migration 0010,
  // facilities-service.js).
  {
    id: 'facilities', label: 'Facilities', group: 'Facilities', permission: 'finance',
    capabilities: ['asset register', 'service history', 'capital projects', 'preventive maintenance'],
    pages: [
      { id: 'overview', label: 'Overview', status: 'live' },
      { id: 'assets', label: 'Assets', status: 'live' },
      { id: 'service-history', label: 'Service history', status: 'live' },
      { id: 'capital-projects', label: 'Capital projects', status: 'live' },
      { id: 'preventive-maintenance', label: 'Preventive maintenance', status: 'live' },
    ],
  },
  // The Budget builder is real now too, via the connect.finance-budget.v1 contract (real planned
  // dollar amounts per category/fiscal-year from finance_budget_plan) -- see
  // finance-budget-client.js and budget-report-service.js's resolveBudgetReport, same
  // live-with-synthetic-fallback pattern Giving Entry, Data & Imports, and Chart of Accounts
  // established. Unlike those, this carries real money, so dataClassification is 'aggregate'.
  {
    id: 'planning', label: 'Budget', group: 'Planning', permission: 'budget',
    capabilities: ['budget builder', 'scenarios', 'multi-year forecast', 'outlook', 'board categories', 'purpose tags'],
    pages: [
      { id: 'builder', label: 'Budget builder', status: 'live' },
      { id: 'scenarios', label: 'Scenarios', status: 'live' },
      { id: 'multi-year', label: 'Multi-year forecast', status: 'live' },
      { id: 'compensation-link', label: 'Compensation', status: 'live' },
    ],
  },
  // 'plan', 'council', 'benefits' and 'benchmarks' are built from the saved compensation plan
  // (LCMS Missouri District tables, Concordia Plans rates and health quote, each worker's Concordia
  // Compensation Decision Support ranges) for the roles allowed to read it (admin/council/
  // compensation -- see COMPENSATION_LIVE_ALLOWED_ROLES); other roles keep the synthetic fixture.
  {
    id: 'compensation', label: 'Compensation', group: 'Compensation', permission: 'compensation',
    capabilities: ['salary planning', 'benefits', 'district comparisons', 'council report'],
    pages: [
      { id: 'plan', label: 'Plan', status: 'live' },
      { id: 'connect', label: 'Connect planner', status: 'live' },
      { id: 'benefits', label: 'Benefits & taxes', status: 'live' },
      { id: 'benchmarks', label: 'Benchmarks', status: 'live' },
      { id: 'rates', label: 'Rates & ranges', status: 'live' },
      { id: 'council', label: 'Council report', status: 'live' },
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
  // The account tree and board-category/purpose-tag presentation are real now, via the
  // connect.finance-chart-of-accounts.v1 contract (account names + QuickBooks-derived category
  // paths + Finance's own categorization of them, never a dollar figure) -- see
  // finance-chart-of-accounts-client.js and accounts-report-service.js's resolveAccountsReport,
  // same live-with-synthetic-fallback pattern Giving Entry and Data & Imports established.
  {
    id: 'accounts', label: 'Chart of Accounts', group: 'Accounts & Data', permission: 'finance',
    capabilities: ['account tree', 'board-category presentation'],
    pages: [
      { id: 'chart', label: 'Chart of accounts', status: 'live' },
      { id: 'access', label: 'Access & roles', status: 'live' },
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
  // payroll-ready-client.js. Split into the v3 design's five pages (payroll-pages.js), all
  // rendered from the same one live workspace read; old ?view= links map onto them.
  { id: 'payroll', label: 'Payroll', group: 'Payroll', permission: 'admin', capabilities: ['staff roster', 'hours and PTO entry', 'period approval', 'MDO hours integration', 'reports', 'CSV export', 'email the report', 'relayed live to Website, never stored in Finance'], pages: [{ id: 'run', label: 'Run payroll', status: 'live' }, { id: 'staff', label: 'Staff entry', status: 'live' }, { id: 'mdo', label: 'Import from MDO', status: 'live' }, { id: 'report', label: 'Email / print', status: 'live' }, { id: 'history', label: 'History', status: 'live' }] },
  // HR & Staff is new in the v3 design and holds staff personnel records, so it is admin-only
  // (the design's own label: admin and lead pastor only). Church staff and key volunteers live
  // in Finance's own tables (migration 0011, hr-service.js); daycare staff stay in myMDO.
  {
    id: 'hr', label: 'HR & Staff', group: 'HR & Staff', permission: 'admin',
    capabilities: ['staff directory', 'org chart', 'performance reviews', 'background checks and certifications', 'required trainings', 'policies', 'benefits enrollment', 'volunteer screening'],
    pages: [
      { id: 'directory', label: 'Staff directory', status: 'live' },
      { id: 'org-chart', label: 'Org chart & job descriptions', status: 'live' },
      { id: 'reviews', label: 'Performance reviews', status: 'live' },
      { id: 'checks', label: 'Background checks & certs', status: 'live' },
      { id: 'trainings', label: 'Required trainings', status: 'live' },
      { id: 'policies', label: 'Policies & handbook', status: 'live' },
      { id: 'benefits', label: 'Benefits enrollment', status: 'live' },
      { id: 'volunteers', label: 'Volunteer screening', status: 'live' },
    ],
  },
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
  'Financial Health', 'Gift Entry', 'Giving', 'Charts', 'Church', 'Balance Sheet', 'Daycare',
  'Commercial Property', 'Facilities', 'Planning', 'Compensation', 'Payroll', 'HR & Staff',
  'QuickBooks', 'Board packet', 'Accounts & Data',
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
