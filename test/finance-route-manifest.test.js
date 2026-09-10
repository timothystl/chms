import { describe, expect, it } from 'vitest';
import {
  FINANCE_ROUTE_MANIFEST,
  isMethodAllowedForRoute,
  resolveFinanceRoute,
} from '../apps/finance/route-manifest.js';

// A route is "read-only, synthetic" here unless it is one of the declared, named exceptions
// below: the Giving and payroll write relays relay a write to Website/Connect (never touch
// Finance's own database); the payroll read relays are live calls out to Website's payroll proxy,
// not synthetic fixtures. Anything else claiming non-GET/HEAD methods, a `writer` flag, or a live
// dataSource is a regression.
const WRITE_ROUTE_IDS = new Set([
  'giving-quick-entry-v1', 'payroll-hours-save-v1', 'payroll-period-approve-v1',
  'payroll-staff-save-v1', 'payroll-staff-deactivate-v1',
]);
const LIVE_READ_ROUTE_IDS = new Set(['payroll-relay-diagnostic-v1', 'payroll-csv-v1']);

describe('Finance staging route manifest', () => {
  it('is a closed, unique inventory with isolated data sources, read-only except the declared live relays', () => {
    const paths = FINANCE_ROUTE_MANIFEST.flatMap((route) => route.paths);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      '/', '/index.html', '/health', '/api/v1/summary',
      '/api/v1/connect-giving-preview', '/api/v1/connect-giving-transport-evidence',
      '/api/v1/connect-giving-quick-entry', '/api/summary', '/api/v1/payroll-relay-diagnostic',
      '/api/v1/payroll-hours-save', '/api/v1/payroll-period-approve',
      '/api/v1/payroll-staff-save', '/api/v1/payroll-staff-deactivate', '/api/v1/payroll-csv',
    ]);
    for (const route of FINANCE_ROUTE_MANIFEST) {
      if (WRITE_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['POST']);
        expect(route.writer).toBe(true);
        expect(route.dataSource).toBe('live-relay');
        continue;
      }
      if (LIVE_READ_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['GET', 'HEAD']);
        expect(route.dataSource).toBe('live-relay-read');
        expect(route).not.toHaveProperty('writer');
        continue;
      }
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
    expect(resolveFinanceRoute('/').optionalQueryBudgets).toEqual(['churchReport', 'churchTrends', 'balanceSheet', 'balanceTrends', 'daycareReport', 'daycareAllocation', 'propertyReport', 'propertyReserves', 'propertyLedgers', 'propertyValuation', 'propertyForecast', 'budgetReport', 'accountsReport', 'dataStatus', 'compensationReport', 'compensationBenchmark', 'compensationBenefits', 'cashRunway']);
    expect(resolveFinanceRoute('/api/v1/connect-giving-transport-evidence')).toMatchObject({
      id: 'giving-transport-evidence-v1', contract: 'finance.connect-giving-transport-evidence.v1', dataSource: 'synthetic-static',
    });
    expect(resolveFinanceRoute('/api/v1/connect-giving-quick-entry')).toMatchObject({
      id: 'giving-quick-entry-v1', contract: 'connect.giving-quick-entry-relay.v1',
    });
    expect(resolveFinanceRoute('/api/v1/payroll-relay-diagnostic')).toMatchObject({
      id: 'payroll-relay-diagnostic-v1', contract: 'finance.payroll-relay-diagnostic.v1', dataSource: 'live-relay-read',
    });
    expect(resolveFinanceRoute('/api/v1/payroll-hours-save')).toMatchObject({
      id: 'payroll-hours-save-v1', contract: 'finance.payroll-hours-save-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/payroll-period-approve')).toMatchObject({
      id: 'payroll-period-approve-v1', contract: 'finance.payroll-period-approve-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/payroll-staff-save')).toMatchObject({
      id: 'payroll-staff-save-v1', contract: 'finance.payroll-staff-save-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/payroll-staff-deactivate')).toMatchObject({
      id: 'payroll-staff-deactivate-v1', contract: 'finance.payroll-staff-deactivate-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/payroll-csv')).toMatchObject({
      id: 'payroll-csv-v1', contract: 'finance.payroll-csv-relay.v1', dataSource: 'live-relay-read',
    });
    expect(resolveFinanceRoute('/missing')).toBeUndefined();

    const readRoute = resolveFinanceRoute('/api/v1/summary');
    expect(isMethodAllowedForRoute(readRoute, 'GET')).toBe(true);
    expect(isMethodAllowedForRoute(readRoute, 'HEAD')).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(isMethodAllowedForRoute(readRoute, method)).toBe(false);
    }

    const writeRoute = resolveFinanceRoute('/api/v1/connect-giving-quick-entry');
    expect(isMethodAllowedForRoute(writeRoute, 'POST')).toBe(true);
    expect(isMethodAllowedForRoute(writeRoute, 'GET')).toBe(false);
    expect(isMethodAllowedForRoute(writeRoute, 'HEAD')).toBe(false);
  });
});
