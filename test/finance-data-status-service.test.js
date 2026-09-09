import { describe, expect, it } from 'vitest';
import { buildDataStatusView, readSyntheticDataStatus } from '../apps/finance/data-status-service.js';

const row = { importer_key: 'synthetic_fixture', last_imported_at: '2026-01-01T00:00:00Z', note: 'Synthetic fixture only' };

describe('Finance synthetic Data and Imports status', () => {
  it('runs one fixture-only SELECT and returns a detached row', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: [row] }]; },
    };
    const result = await readSyntheticDataStatus(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("importer_key='synthetic_fixture'");
    expect(result).toEqual(row);
    expect(result).not.toBe(row);
  });

  it('states both production and writer isolation', () => {
    expect(buildDataStatusView(row, '2026-01-15T00:00:00Z')).toMatchObject({
      source: 'synthetic_fixture', productionConnected: false, writerConnected: false,
      freshnessWindowDays: 30, ageDays: 14, freshness: 'current',
    });
  });

  it('marks data beyond the 30-day review window stale', () => {
    expect(buildDataStatusView(row, '2026-02-01T00:00:00Z')).toMatchObject({ ageDays: 31, freshness: 'stale' });
  });

  it('fails closed on an invalid clock or future import timestamp', () => {
    expect(() => buildDataStatusView(row, 'invalid')).toThrow('Synthetic Data freshness timestamps invalid');
    expect(() => buildDataStatusView(row, '2025-12-31T23:59:59Z')).toThrow('Synthetic Data freshness timestamps invalid');
  });

  it('fails closed on missing, duplicate, or malformed provenance', async () => {
    for (const results of [[], [row, row], [{ ...row, importer_key: 'production' }]]) {
      const db = {
        prepare(sql) { return { sql }; },
        async batch() { return [{ results }]; },
      };
      await expect(readSyntheticDataStatus(db)).rejects.toThrow('Synthetic Data status row invalid');
    }
  });
});
