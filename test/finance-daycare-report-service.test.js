import { describe, expect, it } from 'vitest';
import { buildDaycareReportView, readSyntheticDaycareReport } from '../apps/finance/daycare-report-service.js';

const rows = [
  { period: '2026-01', category: 'Synthetic Tuition', entry_type: 'actual', amount_cents: 4000000 },
  { period: '2026-01', category: 'Synthetic Labor', entry_type: 'actual', amount_cents: 2500000 },
];

describe('Finance synthetic Daycare Report service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
    const result = await readSyntheticDaycareReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("source='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('classifies tuition, totals expenses, and calculates the operating result', () => {
    expect(buildDaycareReportView(rows)).toMatchObject({
      period: '2026-01',
      totals: {
        incomeActualCents: 4000000,
        expenseActualCents: 2500000,
        netActualCents: 1500000,
        netBudgetCents: 0,
      },
    });
  });

  it('fails closed on malformed rows and mixed periods', async () => {
    const db = {
      prepare(sql) { return { sql }; },
      async batch() { return [{ results: [{ ...rows[0], amount_cents: 2.5 }] }]; },
    };
    await expect(readSyntheticDaycareReport(db)).rejects.toThrow('Synthetic Daycare Report rows invalid');
    expect(() => buildDaycareReportView([rows[0], { ...rows[1], period: '2026-02' }])).toThrow('Synthetic Daycare Report period mismatch');
  });
});
