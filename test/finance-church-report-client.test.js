import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceChurchReport, defaultLiveChurchReportFiscalYear } from '../apps/finance/finance-church-report-client.js';

const VALID = {
  contract: 'connect.finance-church-report.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  fiscalYear: 2026,
  generatedAt: '2026-09-14T12:00:00Z',
  accounts: [{
    classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions',
    depth: 0, hasChildren: false, actualCents: 1300000, budgetCents: 1250000, source: 'import',
  }],
  totals: {
    incomeActualCents: 1300000, incomeBudgetCents: 1250000, expenseActualCents: 0, expenseBudgetCents: 0,
    netIncomeActualCents: 1300000, netIncomeBudgetCents: 1250000, hasBudgetData: true,
  },
  reconciliation: {
    accountCount: 1, incomeCount: 1, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0,
    costOfGoodsSoldCount: 0, accountsWithBudgetCount: 1, totalsMatch: true,
  },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('defaultLiveChurchReportFiscalYear', () => {
  it('is the current calendar year -- matching production\'s own "This Year" default', () => {
    expect(defaultLiveChurchReportFiscalYear(new Date('2026-09-14T12:00:00Z'))).toBe(2026);
    expect(defaultLiveChurchReportFiscalYear(new Date('2027-01-01T00:00:00Z'))).toBe(2027);
  });
});

describe('fetchLiveFinanceChurchReport', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceChurchReport({ FINANCE_CONTRACT_API_KEY: 'x' }, 2026);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceChurchReport({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, 2026);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and requested fiscal year, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceChurchReport(env, 2026);
    expect(result.ok).toBe(true);
    expect(result.report.contract).toBe('connect.finance-church-report.v1');
    expect(result.report.accounts).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-church-report-v1');
    expect(url.searchParams.get('fiscal_year')).toBe('2026');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceChurchReport(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceChurchReport(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceChurchReport(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-church-report.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceChurchReport(env, 2026);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
