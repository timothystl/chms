import { describe, expect, it } from 'vitest';
import { fetchFinanceClassification } from '../apps/finance/finance-classification-client.js';

const VALID = {
  contract: 'connect.finance-classification.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', fiscalYear: 2026, generatedAt: '2026-09-26T00:00:00Z',
  revenueStreams: { options: [{ key: 'donor', label: 'Donor income' }], groups: [{ label: 'Offerings', actualCents: 100, budgetCents: 120, stream: 'donor', mapped: true }] },
  expenseCategories: { options: [{ key: 'programs', label: 'Programs' }], groups: [{ label: 'Programs', actualCents: 50, key: 'programs', mapped: false }] },
};

describe('Finance classification client', () => {
  it('uses the narrow service contract and validates the response', async () => {
    let request;
    const result = await fetchFinanceClassification({ FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { request = req; return new Response(JSON.stringify(VALID)); } } }, 2026);
    expect(result).toEqual({ ok: true, classification: VALID });
    expect(request.headers.get('X-Contract-Key')).toBe('secret');
    expect(new URL(request.url).searchParams.get('fiscal_year')).toBe('2026');
  });

  it('fails closed without configuration, on transport failure, or on malformed data', async () => {
    expect(await fetchFinanceClassification({}, 2026)).toEqual({ ok: false, reason: 'not_configured' });
    expect((await fetchFinanceClassification({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { throw new Error('boom'); } } }, 2026)).reason).toBe('network_error');
    expect((await fetchFinanceClassification({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { return new Response('{}'); } } }, 2026)).reason).toBe('contract_validation_failed');
  });
});
