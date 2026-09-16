import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceChurchReportTrend } from '../apps/finance/finance-church-report-trend-client.js';

const VALID = {
  contract: 'connect.finance-church-report-trend.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  generatedAt: '2026-09-15T12:00:00Z',
  years: [{
    fiscalYear: 2026, incomeActualCents: 1300000, expenseActualCents: 900000,
    otherIncomeActualCents: 0, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
    netIncomeActualCents: 400000, accountCount: 12,
  }],
  reconciliation: { yearCount: 1, totalsMatch: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchLiveFinanceChurchReportTrend', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceChurchReportTrend({ FINANCE_CONTRACT_API_KEY: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceChurchReportTrend({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header with no query parameters, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceChurchReportTrend(env);
    expect(result.ok).toBe(true);
    expect(result.trend.contract).toBe('connect.finance-church-report-trend.v1');
    expect(result.trend.years).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-church-report-trend-v1');
    expect(url.search).toBe('');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceChurchReportTrend(env);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceChurchReportTrend(env);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceChurchReportTrend(env);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-church-report-trend.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceChurchReportTrend(env);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
