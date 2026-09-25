import { describe, expect, it } from 'vitest';
import {
  FINANCE_ROUTE_MANIFEST,
  isMethodAllowedForRoute,
  resolveFinanceRoute,
} from '../apps/finance/route-manifest.js';

// A route is "read-only, synthetic" here unless it is one of the declared, named exceptions
// below: the Giving, Budget (write/generate/generate-all/commit/remove), Compensation, and
// payroll write relays relay a write to Website/Connect (never touch Finance's own database);
// the payroll read relays are live calls out to Website's payroll proxy, not synthetic fixtures.
// `budget-plan-save-v1`, `compensation-plan-save-v1`, and the four `property-*-entry-v1` routes
// are the declared exceptions that DO write to Finance's own database (FINANCE_DB's
// finance_budget_plan, finance_compensation_worker_plan, and the property reserve/disbursement/
// distribution/capital-ledger tables respectively -- see budget-plan-write-service.js,
// compensation-plan-write-service.js, and property-ledger-write-service.js), each gated off by
// default. Anything else claiming non-GET/HEAD methods, a `writer` flag, or a live dataSource is
// a regression.
const WRITE_ROUTE_IDS = new Set([
  'giving-quick-entry-v1', 'budget-plan-write-v1', 'compensation-plan-write-v1', 'payroll-hours-save-v1', 'payroll-period-approve-v1',
  'payroll-staff-save-v1', 'payroll-staff-deactivate-v1', 'payroll-email-v1',
  'budget-generate-v1', 'budget-generate-all-v1', 'budget-commit-v1', 'budget-plan-remove-v1',
  'church-actual-override-v1', 'church-budget-xlsx-import-write-v1', 'church-balances-xlsx-import-write-v1',
  'church-monthly-xlsx-import-write-v1', 'church-activity-xlsx-import-write-v1',
  'church-budget-multi-year-xlsx-import-write-v1', 'church-balances-multi-year-xlsx-import-write-v1',
  'daycare-entry-v1', 'board-categories-write-v1', 'property-monthly-write-v1',
  'property-repair-write-v1', 'property-distribution-write-v1', 'property-reserve-monthly-write-v1',
  'property-reserve-disbursement-write-v1', 'property-capital-ledger-write-v1',
  'property-monthly-remove-v1', 'property-distribution-remove-v1', 'property-reserve-monthly-remove-v1',
  'property-reserve-disbursement-remove-v1', 'property-capital-ledger-remove-v1', 'property-repair-remove-v1',
  'property-meta-write-v1', 'property-budget-import-write-v1', 'property-monthly-import-csv-write-v1',
  'revenue-streams-write-v1', 'flow-expense-map-write-v1', 'cash-policy-write-v1',
  'daycare-allocation-config-write-v1', 'daycare-budget-override-write-v1', 'daycare-bulk-write-v1',
  'daycare-church-budget-import-write-v1', 'base-projection-write-v1', 'purpose-tags-write-v1',
  'daycare-entry-edit-v1', 'daycare-entry-remove-v1', 'daycare-sync-v1', 'daycare-rooms-sync-v1',
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
  'import-church-xlsx-v1', 'import-church-balances-xlsx-v1',
]);
const DB_WRITE_ROUTE_IDS = new Set([
  'compensation-plan-save-v1', 'property-reserve-entry-v1', 'property-reserve-disbursement-entry-v1',
  'property-distribution-entry-v1', 'property-capital-ledger-entry-v1',
  'compensation-raise-plan-save-v1', 'compensation-council-draft-save-v1',
]);

describe('Finance staging route manifest', () => {
  it('is a closed, unique inventory with isolated data sources, read-only except the declared live relays', () => {
    const paths = FINANCE_ROUTE_MANIFEST.flatMap((route) => route.paths);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      '/', '/index.html', '/health', '/assets/tlc-logo.png', '/assets/fonts/outfit.woff2', '/assets/fonts/figtree.woff2', '/api/v1/summary',
      '/api/v1/connect-giving-preview', '/api/v1/connect-giving-transport-evidence',
      '/api/v1/connect-giving-quick-entry', '/api/v1/budget-plan-save', '/api/v1/connect-budget-plan-write', '/api/v1/connect-compensation-plan-write',
      '/api/v1/connect-budget-generate', '/api/v1/connect-budget-generate-all', '/api/v1/connect-budget-commit', '/api/v1/connect-budget-plan-remove',
      '/api/v1/connect-base-projection-write',
      '/api/v1/connect-church-actual-override',
      '/api/v1/connect-church-budget-xlsx-import-write', '/api/v1/connect-church-balances-xlsx-import-write',
      '/api/v1/connect-church-monthly-xlsx-import-write', '/api/v1/connect-church-activity-xlsx-import-write',
      '/api/v1/connect-church-budget-multi-year-xlsx-import-write', '/api/v1/connect-church-balances-multi-year-xlsx-import-write',
      '/api/v1/connect-daycare-entry', '/api/v1/connect-board-categories-write',
      '/api/v1/connect-purpose-tags-write',
      '/api/v1/connect-property-monthly-write', '/api/v1/connect-property-repair-write',
      '/api/v1/connect-property-distribution-write', '/api/v1/connect-property-reserve-monthly-write',
      '/api/v1/connect-property-reserve-disbursement-write', '/api/v1/connect-property-capital-ledger-write',
      '/api/v1/connect-property-monthly-remove', '/api/v1/connect-property-distribution-remove',
      '/api/v1/connect-property-reserve-monthly-remove', '/api/v1/connect-property-reserve-disbursement-remove',
      '/api/v1/connect-property-capital-ledger-remove', '/api/v1/connect-property-repair-remove',
      '/api/v1/connect-property-meta-write', '/api/v1/connect-property-budget-import-write',
      '/api/v1/connect-property-monthly-import-csv-write',
      '/api/v1/connect-revenue-streams-write', '/api/v1/connect-flow-expense-map-write', '/api/v1/connect-cash-policy-write',
      '/api/v1/connect-daycare-allocation-config-write', '/api/v1/connect-daycare-budget-override-write',
      '/api/v1/connect-daycare-bulk-write', '/api/v1/connect-daycare-church-budget-import-write',
      '/api/v1/connect-daycare-entry-edit', '/api/v1/connect-daycare-entry-remove',
      '/api/v1/connect-daycare-sync', '/api/v1/connect-daycare-rooms-sync',
      '/api/summary', '/api/v1/payroll-relay-diagnostic',
      '/api/v1/payroll-hours-save', '/api/v1/payroll-period-approve',
      '/api/v1/payroll-staff-save', '/api/v1/payroll-staff-deactivate', '/api/v1/payroll-csv',
      '/api/v1/payroll-email',
      '/api/v1/import/church', '/api/v1/import/church-balances', '/api/v1/import/daycare', '/api/v1/import/property-budget',
      '/api/v1/import/church-xlsx', '/api/v1/import/church-balances-xlsx',
      '/api/v1/compensation-plan-save', '/api/v1/property-reserve-entry',
      '/api/v1/property-reserve-disbursement-entry', '/api/v1/property-distribution-entry',
      '/api/v1/property-capital-ledger-entry',
      '/api/v1/compensation-raise-plan-save', '/api/v1/compensation-council-draft-save',
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
    expect(resolveFinanceRoute('/api/v1/connect-budget-generate')).toMatchObject({
      id: 'budget-generate-v1', contract: 'connect.finance-budget-generate-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-budget-generate-all')).toMatchObject({
      id: 'budget-generate-all-v1', contract: 'connect.finance-budget-generate-all-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-budget-commit')).toMatchObject({
      id: 'budget-commit-v1', contract: 'connect.finance-budget-commit-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-budget-plan-remove')).toMatchObject({
      id: 'budget-plan-remove-v1', contract: 'connect.finance-budget-remove-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-base-projection-write')).toMatchObject({
      id: 'base-projection-write-v1', contract: 'connect.finance-base-projection-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-actual-override')).toMatchObject({
      id: 'church-actual-override-v1', contract: 'connect.finance-church-actual-override-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-budget-xlsx-import-write')).toMatchObject({
      id: 'church-budget-xlsx-import-write-v1', contract: 'connect.finance-church-budget-xlsx-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-balances-xlsx-import-write')).toMatchObject({
      id: 'church-balances-xlsx-import-write-v1', contract: 'connect.finance-church-balances-xlsx-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-monthly-xlsx-import-write')).toMatchObject({
      id: 'church-monthly-xlsx-import-write-v1', contract: 'connect.finance-church-monthly-xlsx-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-activity-xlsx-import-write')).toMatchObject({
      id: 'church-activity-xlsx-import-write-v1', contract: 'connect.finance-church-activity-xlsx-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-budget-multi-year-xlsx-import-write')).toMatchObject({
      id: 'church-budget-multi-year-xlsx-import-write-v1', contract: 'connect.finance-church-budget-multi-year-xlsx-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-church-balances-multi-year-xlsx-import-write')).toMatchObject({
      id: 'church-balances-multi-year-xlsx-import-write-v1', contract: 'connect.finance-church-balances-multi-year-xlsx-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-entry')).toMatchObject({
      id: 'daycare-entry-v1', contract: 'connect.finance-daycare-entry-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-board-categories-write')).toMatchObject({
      id: 'board-categories-write-v1', contract: 'connect.finance-board-categories-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-purpose-tags-write')).toMatchObject({
      id: 'purpose-tags-write-v1', contract: 'connect.finance-purpose-tags-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-property-monthly-write')).toMatchObject({
      id: 'property-monthly-write-v1', contract: 'connect.finance-property-monthly-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-property-repair-write')).toMatchObject({
      id: 'property-repair-write-v1', contract: 'connect.finance-property-repair-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-property-distribution-write')).toMatchObject({
      id: 'property-distribution-write-v1', contract: 'connect.finance-property-distribution-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-property-reserve-monthly-write')).toMatchObject({
      id: 'property-reserve-monthly-write-v1', contract: 'connect.finance-property-reserve-monthly-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-property-reserve-disbursement-write')).toMatchObject({
      id: 'property-reserve-disbursement-write-v1', contract: 'connect.finance-property-reserve-disbursement-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-property-capital-ledger-write')).toMatchObject({
      id: 'property-capital-ledger-write-v1', contract: 'connect.finance-property-capital-ledger-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-revenue-streams-write')).toMatchObject({
      id: 'revenue-streams-write-v1', contract: 'connect.finance-revenue-streams-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-flow-expense-map-write')).toMatchObject({
      id: 'flow-expense-map-write-v1', contract: 'connect.finance-flow-expense-map-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-cash-policy-write')).toMatchObject({
      id: 'cash-policy-write-v1', contract: 'connect.finance-cash-policy-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-allocation-config-write')).toMatchObject({
      id: 'daycare-allocation-config-write-v1', contract: 'connect.finance-daycare-allocation-config-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-budget-override-write')).toMatchObject({
      id: 'daycare-budget-override-write-v1', contract: 'connect.finance-daycare-budget-override-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-bulk-write')).toMatchObject({
      id: 'daycare-bulk-write-v1', contract: 'connect.finance-daycare-bulk-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-church-budget-import-write')).toMatchObject({
      id: 'daycare-church-budget-import-write-v1', contract: 'connect.finance-daycare-church-budget-import-write-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-entry-edit')).toMatchObject({
      id: 'daycare-entry-edit-v1', contract: 'connect.finance-daycare-entry-edit-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-entry-remove')).toMatchObject({
      id: 'daycare-entry-remove-v1', contract: 'connect.finance-daycare-entry-remove-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-sync')).toMatchObject({
      id: 'daycare-sync-v1', contract: 'connect.finance-daycare-sync-relay.v1', dataSource: 'live-relay',
    });
    expect(resolveFinanceRoute('/api/v1/connect-daycare-rooms-sync')).toMatchObject({
      id: 'daycare-rooms-sync-v1', contract: 'connect.finance-daycare-rooms-sync-relay.v1', dataSource: 'live-relay',
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
    expect(resolveFinanceRoute('/api/v1/import/church-xlsx')).toMatchObject({
      id: 'import-church-xlsx-v1', contract: 'finance.import-church-xlsx.v1', dataSource: 'd1-write', writer: true,
    });
    expect(resolveFinanceRoute('/api/v1/import/church-balances-xlsx')).toMatchObject({
      id: 'import-church-balances-xlsx-v1', contract: 'finance.import-church-balances-xlsx.v1', dataSource: 'd1-write', writer: true,
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
    expect(resolveFinanceRoute('/api/v1/compensation-raise-plan-save')).toMatchObject({
      id: 'compensation-raise-plan-save-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
    });
    expect(resolveFinanceRoute('/api/v1/compensation-council-draft-save')).toMatchObject({
      id: 'compensation-council-draft-save-v1', dataSource: 'finance-db-write', writer: true, methods: ['POST'],
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
