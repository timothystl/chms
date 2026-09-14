import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceDaycareReport, defaultLiveDaycareReportFiscalYear } from '../apps/finance/finance-daycare-client.js';

const VALID = {
  contract: 'connect.finance-daycare-report.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  fiscalYear: 2026,
  generatedAt: '2026-09-14T12:00:00Z',
  categories: [
    { category: 'Tuition Income', classification: 'Income', actualCents: 40000000, budgetCents: 39000000 },
  ],
  allocation: { utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 0, churchInsuranceActualCents: 0, mdoUtilityCents: 0, mdoInsuranceCents: 0 },
  totals: { incomeActualCents: 40000000, incomeBudgetCents: 39000000, expenseActualCents: 0, expenseBudgetCents: 0, netActualCents: 40000000, netBudgetCents: 39000000 },
  reconciliation: { categoryCount: 1, incomeCategoryCount: 1, expenseCategoryCount: 0, totalsMatch: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('defaultLiveDaycareReportFiscalYear', () => {
  it('is the current calendar year -- matching production\'s own calendar-year Daycare Report periods', () => {
    expect(defaultLiveDaycareReportFiscalYear(new Date('2026-09-14T12:00:00Z'))).toBe(2026);
    expect(defaultLiveDaycareReportFiscalYear(new Date('2027-01-01T00:00:00Z'))).toBe(2027);
  });
});

describe('fetchLiveFinanceDaycareReport', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceDaycareReport({ FINANCE_CONTRACT_API_KEY: 'x' }, 2026);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceDaycareReport({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, 2026);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and requested fiscal year, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceDaycareReport(env, 2026);
    expect(result.ok).toBe(true);
    expect(result.report.contract).toBe('connect.finance-daycare-report.v1');
    expect(result.report.categories).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-daycare-report-v1');
    expect(url.searchParams.get('fiscal_year')).toBe('2026');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceDaycareReport(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceDaycareReport(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceDaycareReport(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-daycare-report.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceDaycareReport(env, 2026);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
