export const FINANCE_PARITY_SECTIONS = Object.freeze([
  { id: 'health', label: 'Financial Health', permission: 'finance', capabilities: ['KPI health', 'giving pace', 'cash runway', 'revenue and expense mix', 'entity overview', 'money flow'] },
  { id: 'giving', label: 'Giving Entry', permission: 'finance', capabilities: ['record a gift', 'relayed live to Connect, never stored in Finance'] },
  { id: 'church', label: 'Church Report', permission: 'finance', capabilities: ['current year', 'multi-year trends', 'income and expense detail', 'board packet'] },
  { id: 'balance', label: 'Balance Sheet', permission: 'finance', capabilities: ['assets', 'liabilities', 'equity', 'position trends'] },
  { id: 'daycare', label: 'Daycare Report', permission: 'finance', capabilities: ['actuals', 'budgets', 'shared-cost allocations'] },
  { id: 'property', label: 'Commercial Property', permission: 'finance', capabilities: ['monthly financials', 'reserves', 'capital', 'repairs', 'forecast', 'valuation'] },
  { id: 'planning', label: 'Budget', permission: 'budget', capabilities: ['budget builder', 'outlook', 'board categories', 'purpose tags'] },
  { id: 'accounts', label: 'Chart of Accounts', permission: 'finance', capabilities: ['account tree', 'board-category presentation'] },
  { id: 'compensation', label: 'Compensation', permission: 'compensation', capabilities: ['salary planning', 'benefits', 'district comparisons', 'council report'] },
  { id: 'data', label: 'Data & Imports', permission: 'finance', capabilities: ['connection status', 'file imports', 'staleness', 'classification and policy', 'administrative tools'] },
  // Full payroll parity with Website's admin/payroll.html, relayed live to Website's existing
  // payroll proxy the same way Giving Entry relays to Connect (never stored in Finance) -- see
  // payroll-section.js, payroll-calc.js and payroll-proxy-client.js. Emailing the report and the
  // "payroll ready" push notification are not included yet: both need a second Website route
  // extended to accept Finance's contract-relay identity, the same cross-repo change PR #586 made
  // for the /sb/* proxy's CSRF check -- separate work, tracked apart from this parity slice.
  { id: 'payroll', label: 'Payroll', permission: 'admin', capabilities: ['staff roster', 'hours and PTO entry', 'period approval', 'MDO hours integration', 'reports', 'CSV export', 'relayed live to Website, never stored in Finance'] },
].map((section) => Object.freeze({ ...section, capabilities: Object.freeze(section.capabilities) })));

const SECTION_BY_ID = new Map(FINANCE_PARITY_SECTIONS.map((section) => [section.id, section]));

export function resolveFinanceSection(id) {
  return SECTION_BY_ID.get(id) || SECTION_BY_ID.get('health');
}
