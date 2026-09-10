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
].map((section) => Object.freeze({ ...section, capabilities: Object.freeze(section.capabilities) })));

const SECTION_BY_ID = new Map(FINANCE_PARITY_SECTIONS.map((section) => [section.id, section]));

export function resolveFinanceSection(id) {
  return SECTION_BY_ID.get(id) || SECTION_BY_ID.get('health');
}
