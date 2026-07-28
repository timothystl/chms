import { describe, it, expect } from 'vitest';
import { suggestMonthlyFromGift, computeReceiptQueue, MONTHLY_SUGGESTION_LADDER_CENTS } from '../src/api-utils.js';

describe('suggestMonthlyFromGift', () => {
  it('suggests ~a quarter of the gift, snapped to a clean rung', () => {
    expect(suggestMonthlyFromGift(10000)).toBe(2500);  // $100 -> $25/mo (the stated example)
    expect(suggestMonthlyFromGift(4000)).toBe(1000);   // $40 -> $10/mo (floor)
  });
  it('always returns a clean ladder value', () => {
    for (const g of [15000, 25000, 40000, 100000, 500000]) {
      expect(MONTHLY_SUGGESTION_LADDER_CENTS).toContain(suggestMonthlyFromGift(g));
    }
  });
  it('returns 0 for a non-positive gift', () => {
    expect(suggestMonthlyFromGift(0)).toBe(0);
    expect(suggestMonthlyFromGift(-500)).toBe(0);
  });
});

describe('computeReceiptQueue', () => {
  const base = [
    { person_id: 1, gift_date: '2026-07-06', amount_cents: 30000, name: 'Big Gift',   email: 'a@x.org', household_id: 10, funds: 'General' },
    { person_id: 2, gift_date: '2026-07-06', amount_cents: 10000, name: 'First Timer', email: 'b@x.org', household_id: 20, funds: 'General' },
    { person_id: 3, gift_date: '2026-07-06', amount_cents: 5000,  name: 'Small Repeat',email: '',        household_id: 30, funds: 'General' },
  ];
  const first = { 1: '2020-01-01', 2: '2026-07-06', 3: '2019-05-01' }; // person 2's first gift is this one

  it('qualifies gifts over threshold OR first-time; drops the rest', () => {
    const { receipts, counts } = computeReceiptQueue(base, {
      thresholdCents: 25000, includeFirstGift: true, firstGiftDateByPerson: first, sentKeys: new Set(),
    });
    // person 1 (over $250) and person 2 (first gift) qualify; person 3 ($50 repeat) does not.
    expect(counts.total).toBe(2);
    const names = receipts.map(r => r.name);
    expect(names).toContain('Big Gift');
    expect(names).toContain('First Timer');
    expect(names).not.toContain('Small Repeat');
  });

  it('tags reasons and a suggested monthly per qualifying gift', () => {
    const { receipts } = computeReceiptQueue(base, {
      thresholdCents: 25000, firstGiftDateByPerson: first, sentKeys: new Set(),
    });
    const big = receipts.find(r => r.person_id === 1);
    expect(big.reasons).toContain('over_threshold');
    expect(big.suggested_monthly_cents).toBeGreaterThan(0);
    const firstTimer = receipts.find(r => r.person_id === 2);
    expect(firstTimer.reasons).toContain('first_gift');
  });

  it('honors includeFirstGift=false (threshold only)', () => {
    const { receipts } = computeReceiptQueue(base, {
      thresholdCents: 25000, includeFirstGift: false, firstGiftDateByPerson: first, sentKeys: new Set(),
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].person_id).toBe(1);
  });

  it('flags no_email and already-sent via recipient_key', () => {
    const sent = new Set(['ge1:2026-07-06']);
    const { receipts, counts } = computeReceiptQueue(base, {
      thresholdCents: 25000, firstGiftDateByPerson: first, sentKeys: sent,
    });
    expect(receipts.find(r => r.person_id === 1).sent).toBe(true);
    expect(counts.sent).toBe(1);
    // person 3 has no email, but only qualifiers are counted (person 3 doesn't qualify here)
    expect(counts.no_email).toBe(0);
  });

  it('sorts largest gift first', () => {
    const rows = [
      { person_id: 5, gift_date: '2026-01-01', amount_cents: 26000, name: 'A' },
      { person_id: 6, gift_date: '2026-01-01', amount_cents: 90000, name: 'B' },
    ];
    const { receipts } = computeReceiptQueue(rows, { thresholdCents: 25000, firstGiftDateByPerson: {}, sentKeys: new Set() });
    expect(receipts[0].name).toBe('B');
  });
});
