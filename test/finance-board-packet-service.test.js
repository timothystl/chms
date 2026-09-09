import { describe, expect, it } from 'vitest';
import { buildSyntheticBoardPacket } from '../apps/finance/board-packet-service.js';

const input = {
  summary: { balanceSheet: { assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 } },
  churchReport: { fiscalYear: 2026, totals: { actualNetCents: 4000000, budgetNetCents: 4000000 } },
  churchTrends: [
    { fiscal_year: 2025, net_cents: 3200000 },
    { fiscal_year: 2026, net_cents: 4000000 },
  ],
  giving: { totals: { netCents: 145000 }, reconciliation: { sourceRecordCount: 6, totalsMatch: true } },
};

describe('Finance synthetic board packet', () => {
  it('assembles one reconciled decision snapshot from existing bounded reads', () => {
    expect(buildSyntheticBoardPacket(input)).toEqual({
      fiscalYear: 2026,
      operating: { actualNetCents: 4000000, budgetNetCents: 4000000, varianceCents: 0, disposition: 'on budget' },
      position: { assetsCents: 30000000, liabilitiesCents: 10000000, netAssetsCents: 20000000, equationDifferenceCents: 0 },
      giving: { netCents: 145000, sourceRecordCount: 6, reconciled: true },
      trend: { priorFiscalYear: 2025, currentFiscalYear: 2026, priorNetCents: 3200000, currentNetCents: 4000000, changeCents: 800000 },
      ready: true,
    });
  });

  it('labels a negative budget variance unfavorable', () => {
    const packet = buildSyntheticBoardPacket({
      ...input,
      churchReport: { ...input.churchReport, totals: { actualNetCents: 3000000, budgetNetCents: 4000000 } },
    });
    expect(packet.operating).toMatchObject({ varianceCents: -1000000, disposition: 'unfavorable' });
  });

  it('fails closed on unreconciled, incomplete, or mismatched inputs', () => {
    expect(() => buildSyntheticBoardPacket({ ...input, giving: { ...input.giving, reconciliation: { totalsMatch: false } } })).toThrow('Synthetic board packet inputs invalid');
    expect(() => buildSyntheticBoardPacket({ ...input, churchTrends: [input.churchTrends[0]] })).toThrow('Synthetic board packet inputs invalid');
    expect(() => buildSyntheticBoardPacket({ ...input, churchTrends: [input.churchTrends[0], { ...input.churchTrends[1], fiscal_year: 2027 }] })).toThrow('Synthetic board packet periods invalid');
    expect(() => buildSyntheticBoardPacket({ ...input, summary: { balanceSheet: { ...input.summary.balanceSheet, equity_cents: 19000000 } } })).toThrow('Synthetic board packet position unreconciled');
  });
});
