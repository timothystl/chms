import { describe, expect, it } from 'vitest';
import { FINANCE_PARITY_SECTIONS, resolveFinanceSection, resolveFinancePage, groupFinanceSections } from '../apps/finance/parity-manifest.js';

describe('Finance interface parity manifest', () => {
  it('preserves the existing navigation order and permission boundaries, plus every redesign group', () => {
    expect(FINANCE_PARITY_SECTIONS.map(({ id, label, permission }) => ({ id, label, permission }))).toEqual([
      { id: 'health', label: 'Financial Health', permission: 'finance' },
      { id: 'giving', label: 'Giving Entry', permission: 'finance' },
      { id: 'giving-analytics', label: 'Giving', permission: 'finance' },
      { id: 'charts', label: 'Charts', permission: 'finance' },
      { id: 'church', label: 'Church Report', permission: 'finance' },
      { id: 'balance', label: 'Balance Sheet', permission: 'finance' },
      { id: 'daycare', label: 'Daycare Report', permission: 'finance' },
      { id: 'property', label: 'Commercial Property', permission: 'finance' },
      { id: 'planning', label: 'Budget', permission: 'budget' },
      { id: 'compensation', label: 'Compensation', permission: 'compensation' },
      { id: 'quickbooks', label: 'QuickBooks', permission: 'finance' },
      { id: 'packet', label: 'Board packet', permission: 'finance' },
      { id: 'accounts', label: 'Chart of Accounts', permission: 'finance' },
      { id: 'data', label: 'Data & Imports', permission: 'finance' },
      { id: 'payroll', label: 'Payroll', permission: 'admin' },
    ]);
  });

  it('fails unknown section requests back to Financial Health', () => {
    expect(resolveFinanceSection('property').label).toBe('Commercial Property');
    expect(resolveFinanceSection('unknown').id).toBe('health');
    expect(resolveFinanceSection(null).id).toBe('health');
  });

  it('groups sidebar sections into the Finance App redesign categories, in a fixed order', () => {
    expect(groupFinanceSections().map(({ group, sections }) => ({ group, ids: sections.map((s) => s.id) }))).toEqual([
      { group: 'Dashboard', ids: ['health'] },
      { group: 'Gift Entry', ids: ['giving'] },
      { group: 'Giving', ids: ['giving-analytics'] },
      { group: 'Charts', ids: ['charts'] },
      { group: 'Church', ids: ['church'] },
      { group: 'Balance Sheet', ids: ['balance'] },
      { group: 'Daycare', ids: ['daycare'] },
      { group: 'Commercial Property', ids: ['property'] },
      { group: 'Planning', ids: ['planning'] },
      { group: 'Compensation', ids: ['compensation'] },
      { group: 'Payroll', ids: ['payroll'] },
      { group: 'QuickBooks', ids: ['quickbooks'] },
      { group: 'Board packet', ids: ['packet'] },
      { group: 'Accounts & Data', ids: ['accounts', 'data'] },
    ]);
  });

  it('every section carries a known sidebar group and at least one page', () => {
    for (const section of FINANCE_PARITY_SECTIONS) {
      expect(section.group, `${section.id} is missing a sidebar group`).toBeTruthy();
      expect(section.pages.length, `${section.id} has no pages`).toBeGreaterThan(0);
    }
  });

  it('every page is either live or carries a non-empty reason for being unavailable', () => {
    for (const section of FINANCE_PARITY_SECTIONS) {
      for (const page of section.pages) {
        expect(['live', 'unavailable']).toContain(page.status);
        if (page.status === 'unavailable') {
          expect(typeof page.reason, `${section.id}/${page.id} is unavailable with no reason`).toBe('string');
          expect(page.reason.length).toBeGreaterThan(20);
        } else {
          expect(page.reason).toBeUndefined();
        }
      }
    }
  });

  it('resolveFinancePage defaults to the first page and falls back on an unknown page id', () => {
    const church = resolveFinanceSection('church');
    expect(resolveFinancePage(church, undefined).id).toBe('overview');
    expect(resolveFinancePage(church, 'not-a-real-page').id).toBe('overview');
    expect(resolveFinancePage(church, 'trend').id).toBe('trend');
  });
});
