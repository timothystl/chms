import { describe, expect, it } from 'vitest';
import { buildEntityOverview } from '../apps/finance/entity-overview-service.js';

const input = {
  church: { fiscalYear: 2026, totals: { incomeActualCents: 12000000, expenseActualCents: 8000000, actualNetCents: 4000000 } },
  daycare: { period: '2026-01', totals: { incomeActualCents: 4000000, expenseActualCents: 2500000, netActualCents: 1500000 } },
  property: { periodStart: '2026-01', periodEnd: '2026-02', totals: { revenueCents: 4000000, expenseCents: 2400000, netIncomeCents: 1600000 } },
};

describe('Finance synthetic entity overview', () => {
  it('keeps unlike reporting periods explicit and refuses to imply consolidation', () => {
    expect(buildEntityOverview(input)).toEqual({
      consolidated: false,
      entities: [
        { id: 'church', label: 'Church', periodLabel: 'FY2026', incomeCents: 12000000, expenseCents: 8000000, resultCents: 4000000 },
        { id: 'daycare', label: 'Daycare', periodLabel: '2026-01', incomeCents: 4000000, expenseCents: 2500000, resultCents: 1500000 },
        { id: 'property', label: 'Commercial Property', periodLabel: '2026-01–2026-02', incomeCents: 4000000, expenseCents: 2400000, resultCents: 1600000 },
      ],
    });
  });

  it('fails closed on broken arithmetic, malformed periods, or reversed property ranges', () => {
    expect(() => buildEntityOverview({ ...input, church: { ...input.church, totals: { ...input.church.totals, actualNetCents: 1 } } })).toThrow('Synthetic entity overview inputs invalid');
    expect(() => buildEntityOverview({ ...input, daycare: { ...input.daycare, period: '2026' } })).toThrow('Synthetic entity overview inputs invalid');
    expect(() => buildEntityOverview({ ...input, property: { ...input.property, periodStart: '2026-03' } })).toThrow('Synthetic entity overview inputs invalid');
    expect(() => buildEntityOverview({ ...input, property: { ...input.property, totals: { ...input.property.totals, netIncomeCents: 1 } } })).toThrow('Synthetic entity overview inputs invalid');
  });
});
