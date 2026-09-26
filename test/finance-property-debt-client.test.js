import { describe, expect, it } from 'vitest';
import { fetchFinancePropertyDebt } from '../apps/finance/finance-property-debt-client.js';

const VALID = { contract: 'connect.finance-property-debt.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', propertyKey: 'ivanhoe', generatedAt: '2026-09-26T00:00:00Z', loan: { lender: null, balanceCents: null, balanceAsOfDate: null, interestRatePct: null, monthlyPaymentCents: null, storedAnnualDebtServiceCents: null }, activity: [], projection: { currentBalanceCents: null, currentBalanceAsOf: null, derivedAnnualDebtServiceCents: null, monthsRemaining: null, payoffPeriod: null, totalInterestRemainingCents: null, status: 'missing_terms' } };

describe('Finance property debt client', () => {
  it('uses the keyed contract and validates the response', async () => {
    let request;
    const result = await fetchFinancePropertyDebt({ FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { request = req; return new Response(JSON.stringify(VALID)); } } });
    expect(result).toEqual({ ok: true, debt: VALID });
    expect(request.headers.get('X-Contract-Key')).toBe('secret');
  });
  it('never throws for missing configuration, transport errors, or drift', async () => {
    expect((await fetchFinancePropertyDebt({})).reason).toBe('not_configured');
    expect((await fetchFinancePropertyDebt({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { throw new Error('down'); } } })).reason).toBe('network_error');
    expect((await fetchFinancePropertyDebt({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { return new Response('{}'); } } })).reason).toBe('contract_validation_failed');
  });
});
