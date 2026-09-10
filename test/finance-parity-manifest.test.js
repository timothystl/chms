import { describe, expect, it } from 'vitest';
import { FINANCE_PARITY_SECTIONS, resolveFinanceSection } from '../apps/finance/parity-manifest.js';

describe('Finance interface parity manifest', () => {
  it('preserves the existing navigation order and permission boundaries, plus Giving Entry and Payroll', () => {
    expect(FINANCE_PARITY_SECTIONS.map(({ id, label, permission }) => ({ id, label, permission }))).toEqual([
      { id: 'health', label: 'Financial Health', permission: 'finance' },
      { id: 'giving', label: 'Giving Entry', permission: 'finance' },
      { id: 'church', label: 'Church Report', permission: 'finance' },
      { id: 'balance', label: 'Balance Sheet', permission: 'finance' },
      { id: 'daycare', label: 'Daycare Report', permission: 'finance' },
      { id: 'property', label: 'Commercial Property', permission: 'finance' },
      { id: 'planning', label: 'Budget', permission: 'budget' },
      { id: 'accounts', label: 'Chart of Accounts', permission: 'finance' },
      { id: 'compensation', label: 'Compensation', permission: 'compensation' },
      { id: 'data', label: 'Data & Imports', permission: 'finance' },
      { id: 'payroll', label: 'Payroll', permission: 'admin' },
    ]);
  });

  it('fails unknown section requests back to Financial Health', () => {
    expect(resolveFinanceSection('property').label).toBe('Commercial Property');
    expect(resolveFinanceSection('unknown').id).toBe('health');
    expect(resolveFinanceSection(null).id).toBe('health');
  });
});
