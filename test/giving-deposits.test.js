import { describe, it, expect } from 'vitest';
import { computeDepositTotals } from '../src/api-utils.js';

describe('computeDepositTotals', () => {
  it('rolls up gross, fee, and net (gross - fee)', () => {
    const t = computeDepositTotals([
      { amount: 10000, fee_cents: 320 },  // $100 online, $3.20 fee
      { amount: 5000,  fee_cents: 0 },    // $50 check, no fee
    ]);
    expect(t.count).toBe(2);
    expect(t.gross_cents).toBe(15000);
    expect(t.fee_cents).toBe(320);
    expect(t.net_cents).toBe(14680);
  });

  it('returns zeros for an empty deposit', () => {
    const t = computeDepositTotals([]);
    expect(t).toEqual({ count: 0, gross_cents: 0, fee_cents: 0, net_cents: 0 });
  });

  it('computes variance against the bank amount and balances at zero', () => {
    const gifts = [{ amount: 10000, fee_cents: 320 }];
    const balanced = computeDepositTotals(gifts, 9680); // net = 10000 - 320
    expect(balanced.bank_cents).toBe(9680);
    expect(balanced.variance_cents).toBe(0);
    expect(balanced.balanced).toBe(true);

    const short = computeDepositTotals(gifts, 9600);
    expect(short.variance_cents).toBe(-80); // bank short by 80c
    expect(short.balanced).toBe(false);
  });

  it('omits bank/variance when no bank amount is given', () => {
    const t = computeDepositTotals([{ amount: 5000, fee_cents: 0 }]);
    expect(t.bank_cents).toBeUndefined();
    expect(t.variance_cents).toBeUndefined();
  });

  it('coerces missing/nonnumeric fee to 0', () => {
    const t = computeDepositTotals([{ amount: 5000 }, { amount: 2000, fee_cents: null }]);
    expect(t.fee_cents).toBe(0);
    expect(t.net_cents).toBe(7000);
  });
});
