import { describe, expect, it } from 'vitest';
import {
  FINANCE_ROUTE_MANIFEST,
  isMethodAllowedForRoute,
  resolveFinanceRoute,
} from '../apps/finance/route-manifest.js';

// A route is "read-only, synthetic" here unless it is one of the declared, named exceptions
// below: the Giving and payroll write relays relay a write to Website/Connect (never touch
// Finance's own database); the payroll read relays are live calls out to Website's payroll proxy,
// not synthetic fixtures. `budget-plan-save-v1`, `compensation-plan-save-v1`, and the four
// `property-*-entry-v1` routes are the declared exceptions that DO write to Finance's own
// database (FINANCE_DB's finance_budget_plan, finance_compensation_worker_plan, and the property
// reserve/disbursement/distribution/capital-ledger tables respectively -- see
// budget-plan-write-service.js, compensation-plan-write-service.js, and
// property-ledger-write-service.js), each gated off by default. Anything else claiming
// non-GET/HEAD methods, a `writer` flag, or a live dataSource is a regression.
const WRITE_ROUTE_IDS = new Set([
  'giving-quick-entry-v1', 'budget-plan-write-v1', 'compensation-plan-write-v1', 'payroll-hours-save-v1', 'payroll-period-approve-v1',
  'payroll-staff-save-v1', 'payroll-staff-deactivate-v1', 'payroll-email-v1',
]);
const OWN_DB_WRITE_ROUTE_IDS = new Set(['budget-plan-save-v1']);
const LIVE_READ_ROUTE_IDS = new Set(['payroll-relay-diagnostic-v1', 'payroll-csv-v1']);
// The routes in this manifest that write to Finance's OWN database (FINANCE_DB) rather than
// relaying a write to Connect/Website — see csv-import-service.js's and
// compensation-plan-write-service.js's header comments. Every one is gated off by default inside
// its own handler; this manifest test only asserts the route SHAPE (method/writer/dataSource),
// not the runtime gate itself (see test/finance-csv-import.test.js and
// test/finance-compensation-plan-write-service.test.js).
const D1_WRITE_ROUTE_IDS = new Set([
  'import-church-v1', 'import-church-balances-v1', 'import-daycare-v1', 'import-property-budget-v1',
]);
const DB_WRITE_ROUTE_IDS = new Set([
  'compensation-plan-save-v1', 'property-reserve-entry-v1', 'property-reserve-disbursement-entry-v1',
  'property-distribution-entry-v1', 'property-capital-ledger-entry-v1',
]);

describe('Finance staging route manifest', () => {
  it('is a closed, unique inventory with isolated data sources, read-only except the declared live relays', () => {
    const paths = FINANCE_ROUTE_MANIFEST.flatMap((route) => route.paths);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      '/', '/index.html', '/health', '/api/v1/summary',
      '/api/v1/connect-giving-preview', '/api/v1/connect-giving-transport-evidence',
      '/api/v1/connect-giving-quick-entry', '/api/v1/budget-plan-save', '/api/v1/connect-budget-plan-write', '/api/v1/connect-compensation-plan-write', '/api/summary', '/api/v1/payroll-relay-diagnostic',
      '/api/v1/payroll-hours-save', '/api/v1/payroll-period-approve',
      '/api/v1/payroll-staff-save', '/api/v1/payroll-staff-deactivate', '/api/v1/payroll-csv',
      '/api/v1/payroll-email',
      '/api/v1/import/church', '/api/v1/import/church-balances', '/api/v1/import/daycare', '/api/v1/import/property-budget',
      '/api/v1/compensation-plan-save', '/api/v1/property-reserve-entry',
      '/api/v1/property-reserve-disbursement-entry', '/api/v1/property-distribution-entry',
      '/api/v1/property-capital-ledger-entry',
    ]);
    for (const route of FINANCE_ROUTE_MANIFEST) {
      if (WRITE_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['POST']);
        expect(route.writer).toBe(true);
        expect(route.dataSource).toBe('live-relay');
        continue;
      }
      if (OWN_DB_WRITE_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['POST']);
        expect(route.writer).toBe(true);
        expect(route.dataSource).toBe('finance-d1-write');
        continue;
      }
      if (LIVE_READ_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['GET', 'HEAD']);
        expect(route.dataSource).toBe('live-relay-read');
        expect(route).not.toHaveProperty('writer');
        continue;
      }
      if (D1_WRITE_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['POST']);
        expect(route.writer).toBe(true);
        expect(route.dataSource).toBe('d1-write');
        continue;
      }
      if (DB_WRITE_ROUTE_IDS.has(route.id)) {
        expect(route.methods).toEqual(['POST']);
        expect(route.writer).toBe(true);
        expect(route.dataSource).toBe('finance-db-write');
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
    expect(resolveFinanceRoute('/').optionalQueryBudgets).toEqual(['churchReport', 'churchTrends', 'balanceSheet', 'balanceTrends', 'daycareReport', 'daycareAllocation', 'propertyReport', 'propertyReserves', 'propertyLedgers', 'propertyValuation', 'propertyForecast', 'budgetReport', 'accountsReport', 'dataStatus', 'compensationReport', 'compensationBenchmark', 'compensationBenefits', 'compensationPlanRaw', 'cashRunway']);
    expect(resolveFinanceRoute('/api/v1/connect-giving-transport-evidence')).toMatchObject({
      id: 'giving-transport-evidence-v1', contract: 'finance.connect-giving-transport-evidence.v1', dataSource: 'synthetic-static',
    });
    expect(resolveFinanceRoute('/api/v1/connect-giving-quick-entry')).toMatchObject({
      id: 'giving-quick-entry-v1', contract: 'connect.giving-quick-entry-relay.v1',
    });
    expect(resolveFinanceRoute('/api/v1/budget-plan-save')).toMatchObject({
      id: 'budget-plan-save-v1', contract: 'finance.budget-plan-save.v1', dataSource: 'finance-d1-write',
    });
    expect(resolveFinanceRoute('/api/v1/connect-budget-plan-write')).toMatchObject({
      id: 'budget-plan-write-v1', contract: 'connect.finance-budget-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-compensation-plan-write')).toMatchObject({
      id: 'compensation-plan-write-v1', contract: 'connect.finance-compensation-write-relay.v1', dataSource: 'live-relay',
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
    expect(resolveFinanceRoute('/api/v1/payroll-email')).toMatchObject({
      id: 'payroll-email-v1', contract: 'finance.payroll-email-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/import/church')).toMatchObject({
      id: 'import-church-v1', contract: 'finance.import-church.v1', dataSource: 'd1-write', writer: true,
    });
    expect(resolveFinanceRoute('/api/v1/import/church-balances')).toMatchObject({
      id: 'import-church-balances-v1', contract: 'finance.import-church-balances.v1', dataSource: 'd1-write', writer: true,
    });
    expect(resolveFinanceRoute('/api/v1/import/daycare')).toMatchObject({
      id: 'import-daycare-v1', contract: 'finance.import-daycare.v1', dataSource: 'd1-write', writer: true,
    });
    expect(resolveFinanceRoute('/api/v1/import/property-budget')).toMatchObject({
      id: 'import-property-budget-v1', contract: 'finance.import-property-budget.v1', dataSource: 'd1-write', writer: true,
    });
    expect(resolveFinanceRoute('/api/v1/compensation-plan-save')).toMatchObject({
      id: 'compensation-plan-save-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
    });
    expect(resolveFinanceRoute('/api/v1/property-reserve-entry')).toMatchObject({
      id: 'property-reserve-entry-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
    });
    expect(resolveFinanceRoute('/api/v1/property-reserve-disbursement-entry')).toMatchObject({
      id: 'property-reserve-disbursement-entry-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
    });
    expect(resolveFinanceRoute('/api/v1/property-distribution-entry')).toMatchObject({
      id: 'property-distribution-entry-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
    });
    expect(resolveFinanceRoute('/api/v1/property-capital-ledger-entry')).toMatchObject({
      id: 'property-capital-ledger-entry-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
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

    const dbWriteRoute = resolveFinanceRoute('/api/v1/property-capital-ledger-entry');
    expect(isMethodAllowedForRoute(dbWriteRoute, 'POST')).toBe(true);
    expect(isMethodAllowedForRoute(dbWriteRoute, 'GET')).toBe(false);
  });
});
