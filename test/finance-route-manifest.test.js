import { describe, expect, it } from 'vitest';
import {
  FINANCE_ROUTE_MANIFEST,
  isFinanceMethodAllowed,
  resolveFinanceRoute,
} from '../apps/finance/route-manifest.js';

describe('Finance staging route manifest', () => {
  it('is a closed, unique inventory with read-only methods and isolated data sources', () => {
    const paths = FINANCE_ROUTE_MANIFEST.flatMap((route) => route.paths);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      '/', '/index.html', '/health', '/api/v1/summary',
      '/api/v1/connect-giving-preview', '/api/summary',
    ]);
    for (const route of FINANCE_ROUTE_MANIFEST) {
      expect(route.methods).toEqual(['GET', 'HEAD']);
      expect(['none', 'synthetic-d1', 'synthetic-static']).toContain(route.dataSource);
      expect(route).not.toHaveProperty('writer');
      expect(route).not.toHaveProperty('production');
      if (route.dataSource === 'synthetic-d1') expect(route.queryBudget).toBe('summary');
    }
  });

  it('resolves only declared paths and methods', () => {
    expect(resolveFinanceRoute('/api/v1/summary')).toMatchObject({
      id: 'summary-v1', contract: 'finance.summary.v1', dataSource: 'synthetic-d1',
    });
    expect(resolveFinanceRoute('/').optionalQueryBudgets).toEqual(['churchReport', 'churchTrends', 'balanceSheet', 'balanceTrends', 'daycareReport', 'daycareAllocation', 'propertyReport', 'propertyReserves', 'propertyLedgers', 'budgetReport', 'accountsReport', 'dataStatus', 'compensationReport']);
    expect(resolveFinanceRoute('/missing')).toBeUndefined();
    expect(isFinanceMethodAllowed('GET')).toBe(true);
    expect(isFinanceMethodAllowed('HEAD')).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(isFinanceMethodAllowed(method)).toBe(false);
    }
  });
});
