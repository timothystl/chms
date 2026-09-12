import { describe, expect, it } from 'vitest';
import { readSyntheticPropertyDistributions, buildPropertyDistributionsView } from '../apps/finance/property-distributions-service.js';

const row = { period: '2026-01', amount_cents: 500000 };

function dbWith(rows = [row]) {
  return {
    statements: [],
    prepare(sql) { this.statements.push(sql); return { sql }; },
    async batch() { return [{ results: rows }]; },
  };
}

describe('Finance synthetic property distributions service', () => {
  it('uses one bounded SELECT scoped to the synthetic property and returns detached rows', async () => {
    const db = dbWith();
    await expect(readSyntheticPropertyDistributions(db)).resolves.toEqual([row]);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toMatch(/^SELECT\b/i);
    expect(db.statements[0]).toContain("property_key='synthetic-property'");
  });

  it('fails closed on missing rows, a malformed period, or a non-integer amount', async () => {
    await expect(readSyntheticPropertyDistributions(dbWith([]))).rejects.toThrow('Synthetic Commercial Property distribution rows invalid');
    await expect(readSyntheticPropertyDistributions(dbWith([{ period: '2026', amount_cents: 500000 }]))).rejects.toThrow('Synthetic Commercial Property distribution rows invalid');
    await expect(readSyntheticPropertyDistributions(dbWith([{ period: '2026-01', amount_cents: '500000' }]))).rejects.toThrow('Synthetic Commercial Property distribution rows invalid');
  });

  it('totals distributed amounts and averages per period', () => {
    expect(buildPropertyDistributionsView([row])).toEqual({
      rows: [row],
      totals: { distributionCents: 500000, distributionCount: 1, averageCents: 500000 },
    });
    expect(buildPropertyDistributionsView([row, { period: '2026-02', amount_cents: 300000 }])).toEqual({
      rows: [row, { period: '2026-02', amount_cents: 300000 }],
      totals: { distributionCents: 800000, distributionCount: 2, averageCents: 400000 },
    });
  });

  it('reports zero totals for an empty distribution history rather than dividing by zero', () => {
    expect(buildPropertyDistributionsView([])).toEqual({
      rows: [],
      totals: { distributionCents: 0, distributionCount: 0, averageCents: 0 },
    });
  });
});
