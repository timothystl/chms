import { describe, expect, it } from 'vitest';
import { buildOperatingBridge } from '../apps/finance/operating-bridge-service.js';

describe('Finance synthetic operating bridge', () => {
  it('reconciles annual income through expenses to surplus', () => {
    expect(buildOperatingBridge({
      fiscalYear: 2026,
      totals: { incomeActualCents: 12000000, expenseActualCents: 8000000, actualNetCents: 4000000 },
    })).toEqual({
      fiscalYear: 2026,
      incomeCents: 12000000,
      expenseCents: 8000000,
      resultCents: 4000000,
      resultLabel: 'Surplus',
      resultMagnitudeCents: 4000000,
      reconciled: true,
      interpretation: 'arithmetic_bridge_only',
    });
  });

  it('labels and preserves a deficit without treating it as a negative expense', () => {
    expect(buildOperatingBridge({
      fiscalYear: 2026,
      totals: { incomeActualCents: 8000000, expenseActualCents: 9000000, actualNetCents: -1000000 },
    })).toMatchObject({ resultCents: -1000000, resultLabel: 'Deficit', resultMagnitudeCents: 1000000 });
  });

  it('fails closed on malformed amounts or a broken bridge equation', () => {
    expect(() => buildOperatingBridge({ fiscalYear: 2026, totals: { incomeActualCents: 1, expenseActualCents: 2, actualNetCents: 0 } })).toThrow('Synthetic operating bridge inputs invalid');
    expect(() => buildOperatingBridge({ fiscalYear: 2026, totals: { incomeActualCents: -1, expenseActualCents: 0, actualNetCents: -1 } })).toThrow('Synthetic operating bridge inputs invalid');
  });
});
