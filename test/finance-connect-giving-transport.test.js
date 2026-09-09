import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { reconcileSyntheticGivingDelivery } from '../apps/finance/connect-giving-transport.js';

const payload = JSON.parse(fs.readFileSync(
  new URL('../contracts/examples/giving-summary-v1.synthetic.json', import.meta.url),
  'utf8',
));

const base = { deliveryId: 'synthetic-giving-2026-01-v1', payload };

describe('Finance synthetic Connect Giving transport harness', () => {
  it('accepts after a bounded temporary failure and preserves reconciled totals', () => {
    expect(reconcileSyntheticGivingDelivery({ ...base, attemptedOutcomes: ['temporary_failure', 'delivered'] })).toEqual({
      deliveryId: base.deliveryId,
      status: 'accepted',
      attemptsUsed: 2,
      maxAttempts: 3,
      retryable: false,
      receiptAction: 'record_once',
      totals: { grossCents: 150000, refundCents: 5000, netCents: 145000 },
      reconciliation: { sourceRecordCount: 6, fundCount: 2, totalsMatch: true },
    });
  });

  it('ignores an already-recorded delivery without another receipt action', () => {
    expect(reconcileSyntheticGivingDelivery({ ...base, attemptedOutcomes: ['delivered'], processedDeliveryIds: [base.deliveryId] })).toMatchObject({
      status: 'duplicate_ignored', attemptsUsed: 0, retryable: false, receiptAction: 'retain_existing',
    });
  });

  it('distinguishes retry pending, exhausted, and permanent rejection', () => {
    expect(reconcileSyntheticGivingDelivery({ ...base, attemptedOutcomes: ['temporary_failure'] }).status).toBe('retry_pending');
    expect(reconcileSyntheticGivingDelivery({ ...base, attemptedOutcomes: ['temporary_failure', 'temporary_failure', 'temporary_failure'] }).status).toBe('retry_exhausted');
    expect(reconcileSyntheticGivingDelivery({ ...base, attemptedOutcomes: ['permanent_failure'] }).status).toBe('rejected');
  });

  it('rejects invalid identifiers, unbounded attempts, post-terminal outcomes, and invalid payloads', () => {
    expect(() => reconcileSyntheticGivingDelivery({ ...base, deliveryId: 'bad', attemptedOutcomes: ['delivered'] })).toThrow('deliveryId invalid');
    expect(() => reconcileSyntheticGivingDelivery({ ...base, maxAttempts: 6, attemptedOutcomes: ['delivered'] })).toThrow('maxAttempts must be 1-5');
    expect(() => reconcileSyntheticGivingDelivery({ ...base, attemptedOutcomes: ['delivered', 'temporary_failure'] })).toThrow('continues after terminal');
    const invalidPayload = structuredClone(payload);
    invalidPayload.totals.netCents += 1;
    expect(() => reconcileSyntheticGivingDelivery({ ...base, payload: invalidPayload, attemptedOutcomes: ['delivered'] })).toThrow(/Rejected connect\.giving-summary\.v1/);
  });
});
