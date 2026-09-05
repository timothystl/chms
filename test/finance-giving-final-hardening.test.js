import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

describe('final Finance/Giving read hardening migration', () => {
  it('cleans historical gift duplicates once and indexes balance import dates', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE giving_entries(id INTEGER PRIMARY KEY,breeze_id TEXT NOT NULL DEFAULT '',fund_id INTEGER);
      CREATE TABLE finance_church_balances(id INTEGER PRIMARY KEY,source TEXT NOT NULL DEFAULT '',synced_at TEXT NOT NULL DEFAULT '');
      INSERT INTO giving_entries VALUES(1,'payment-1',7),(2,'payment-1',7),(3,'payment-1',8),(4,'',7),(5,'',7);
    `);

    db.exec(readFileSync(new URL('../migrations/0048_giving_import_and_finance_indexes.sql', import.meta.url), 'utf8'));

    expect(db.prepare('SELECT id FROM giving_entries ORDER BY id').all()).toEqual([{ id: 1 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const plan = db.prepare(
      "EXPLAIN QUERY PLAN SELECT MAX(synced_at) FROM finance_church_balances WHERE source='import' AND synced_at != ''"
    ).all().map(row => row.detail).join('\n');
    expect(plan).toContain('USING COVERING INDEX idx_church_balances_source_synced');
  });

  it('keeps routine aggregate endpoints off the individual gift ledger', () => {
    const households = readFileSync(new URL('../src/api-households.js', import.meta.url), 'utf8');
    const imports = readFileSync(new URL('../src/api-import.js', import.meta.url), 'utf8');
    const finance = readFileSync(new URL('../src/api-finance.js', import.meta.url), 'utf8');

    expect(households).toContain('FROM giving_monthly_fund_totals GROUP BY fund_id');
    expect(imports).toContain('LEFT JOIN giving_monthly_fund_totals mt ON mt.fund_id=f.id');
    expect(finance).toContain('FROM giving_monthly_fund_totals mt JOIN funds');

    expect(households).not.toContain('FROM giving_entries GROUP BY fund_id');
    expect(imports).not.toContain('LEFT JOIN giving_entries ge ON ge.fund_id = f.id');
    expect(finance).not.toContain('FROM giving_entries ge\n          JOIN funds f');
  });
});
