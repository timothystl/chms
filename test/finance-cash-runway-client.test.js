import { describe, expect, it } from 'vitest';
import { fetchLiveFinanceCashRunway } from '../apps/finance/finance-cash-runway-client.js';

const VALID = {
  contract: 'connect.finance-cash-runway.v1', dataClassification: 'aggregate', sourceProduct: 'connect',
  consumerProduct: 'finance', currency: 'USD', fiscalYear: 2026, generatedAt: '2026-09-25T12:00:00Z',
  available: true, onHandCents: 2400000, expensesYtdCents: 900000, monthsElapsed: 9,
  averageMonthlyExpenseCents: 100000, monthsOfCash: 24, policyFloorMonths: 3,
  floorCents: 300000, gapToFloorCents: 0, cashSource: 'balance_sheet',
  cashAccounts: ['11027 Lindell Checking'], asOfDate: '2026-09-01', daycareExcludedCents: 300000,
  allExpensesYtdCents: 1200000,
};

describe('fetchLiveFinanceCashRunway', () => {
  it('sends the contract key and requested fiscal year', async () => {
    let request;
    const result = await fetchLiveFinanceCashRunway({
      FINANCE_CONTRACT_API_KEY: 'secret',
      CONNECT_SERVICE: { async fetch(input) { request = input; return new Response(JSON.stringify(VALID)); } },
    }, 2026);
    expect(result).toEqual({ ok: true, runway: VALID });
    expect(request.headers.get('X-Contract-Key')).toBe('secret');
    expect(new URL(request.url).pathname).toBe('/api/contracts/finance-cash-runway-v1');
    expect(new URL(request.url).searchParams.get('fiscal_year')).toBe('2026');
  });

  it('returns labeled failures instead of throwing', async () => {
    expect(await fetchLiveFinanceCashRunway({}, 2026)).toEqual({ ok: false, reason: 'not_configured' });
    const network = await fetchLiveFinanceCashRunway({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { throw new Error('boom'); } } }, 2026);
    expect(network).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
    const invalid = await fetchLiveFinanceCashRunway({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { return new Response('{}'); } } }, 2026);
    expect(invalid.reason).toBe('contract_validation_failed');
  });
});
