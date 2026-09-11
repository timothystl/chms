// `group` clusters sections for the sidebar nav (apps/finance/shell.js renderSectionNav) into
// the same top-level categories the Finance App redesign uses. It's additive display metadata
// only -- resolveFinanceSection() and every route/permission check below key off `id`, not
// `group`, so this can grow (e.g. sub-pages within a group) without touching those.
export const FINANCE_PARITY_SECTIONS = Object.freeze([
  { id: 'health', label: 'Financial Health', group: 'Dashboard', permission: 'finance', capabilities: ['KPI health', 'giving pace', 'cash runway', 'revenue and expense mix', 'entity overview', 'money flow'] },
  { id: 'giving', label: 'Giving Entry', group: 'Giving', permission: 'finance', capabilities: ['record a gift', 'relayed live to Connect, never stored in Finance'] },
  { id: 'church', label: 'Church Report', group: 'Reports', permission: 'finance', capabilities: ['current year', 'multi-year trends', 'income and expense detail', 'board packet'] },
  { id: 'balance', label: 'Balance Sheet', group: 'Reports', permission: 'finance', capabilities: ['assets', 'liabilities', 'equity', 'position trends'] },
  { id: 'daycare', label: 'Daycare Report', group: 'Reports', permission: 'finance', capabilities: ['actuals', 'budgets', 'shared-cost allocations'] },
  { id: 'property', label: 'Commercial Property', group: 'Reports', permission: 'finance', capabilities: ['monthly financials', 'reserves', 'capital', 'repairs', 'forecast', 'valuation'] },
  { id: 'planning', label: 'Budget', group: 'Planning', permission: 'budget', capabilities: ['budget builder', 'outlook', 'board categories', 'purpose tags'] },
  { id: 'accounts', label: 'Chart of Accounts', group: 'Accounts & Data', permission: 'finance', capabilities: ['account tree', 'board-category presentation'] },
  { id: 'compensation', label: 'Compensation', group: 'Compensation', permission: 'compensation', capabilities: ['salary planning', 'benefits', 'district comparisons', 'council report'] },
  // 'connection status' and 'staleness' are real now, via the connect.finance-data-status.v1
  // contract (import-log recency + QuickBooks connection presence, no tokens) -- see
  // finance-data-status-client.js and data-status-service.js's resolveDataStatus, same
  // live-with-synthetic-fallback pattern Giving Entry established. File imports,
  // classification/policy, and administrative tools remain synthetic-only for now.
  { id: 'data', label: 'Data & Imports', group: 'Accounts & Data', permission: 'finance', capabilities: ['connection status', 'file imports', 'staleness', 'classification and policy', 'administrative tools'] },
  // Full payroll parity with Website's admin/payroll.html, relayed live to Website's existing
  // payroll proxy and payroll/email route the same way Giving Entry relays to Connect (never
  // stored in Finance) -- see payroll-section.js, payroll-calc.js, payroll-proxy-client.js and
  // payroll-email-client.js. The "payroll ready" push notification is not included yet: it needs
  // a third Website route extended to accept Finance's contract-relay identity, the same
  // cross-repo change PRs #586 and #587 made for /sb/* and /payroll/email -- separate work,
  // tracked apart from this parity slice.
  { id: 'payroll', label: 'Payroll', group: 'Payroll', permission: 'admin', capabilities: ['staff roster', 'hours and PTO entry', 'period approval', 'MDO hours integration', 'reports', 'CSV export', 'email the report', 'relayed live to Website, never stored in Finance'] },
].map((section) => Object.freeze({ ...section, capabilities: Object.freeze(section.capabilities) })));

const SECTION_BY_ID = new Map(FINANCE_PARITY_SECTIONS.map((section) => [section.id, section]));

export function resolveFinanceSection(id) {
  return SECTION_BY_ID.get(id) || SECTION_BY_ID.get('health');
}

// Explicit sidebar group order, independent of each section's position in FINANCE_PARITY_SECTIONS.
const GROUP_ORDER = ['Dashboard', 'Giving', 'Reports', 'Planning', 'Compensation', 'Payroll', 'Accounts & Data'];

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
