import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceClassificationV1 } from '../src/api-classification-contracts.js';
import { acceptFinanceClassificationV1, validateFinanceClassificationV1 } from '../contracts/validators/finance-classification-consumer.js';

function db() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0018_finance_church_entries.sql', '0050_finance_settings.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return {
    prepare(sql) { return { bind(...args) { return { async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; }, async first() { return sqlite.prepare(sql).get(); } }; },
    raw: sqlite,
  };
}

describe('connect.finance-classification.v1', () => {
  it('builds the exact current-year groups with stored confirmations and honest guesses', async () => {
    const database = db();
    const insert = database.raw.prepare(`INSERT INTO finance_church_entries
      (fiscal_year,period_month,classification,category_path,account_name,own_actual_cents,own_budget_cents,source)
      VALUES (2026,0,?,?,?,?,?,'import')`);
    insert.run('Income', 'Income:40 Offerings', '40000 Contributions', 1000000, 1200000);
    insert.run('Income', 'Income:44 Rentals', '44000 Facility rent', 200000, 180000);
    insert.run('Expenses', 'Expenses:58 Salaries', '58000 Payroll', 700000, 700000);
    insert.run('Expenses', 'Expenses:62 Utilities', '62000 Electric', 100000, 90000);
    database.raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_revenue_streams',?)").run(JSON.stringify({ map: { '40 Offerings': 'donor' } }));
    database.raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_flow_expense_map',?)").run(JSON.stringify({ map: { '58 Salaries': 'salaries' } }));

    const payload = await buildFinanceClassificationV1(database, { fiscalYear: 2026, now: new Date('2026-09-26T00:00:00Z') });
    expect(validateFinanceClassificationV1(payload)).toEqual({ ok: true, errors: [] });
    expect(payload.revenueStreams.groups).toEqual([
      { label: '40 Offerings', actualCents: 1000000, budgetCents: 1200000, stream: 'donor', mapped: true },
      { label: '44 Rentals', actualCents: 200000, budgetCents: 180000, stream: 'earned', mapped: false },
    ]);
    expect(payload.expenseCategories.groups).toEqual([
      { label: '58 Salaries', actualCents: 700000, key: 'salaries', mapped: true },
      { label: '62 Utilities', actualCents: 100000, key: 'property', mapped: false },
    ]);
  });

  it('accepts a detached closed payload and rejects unknown or invalid categories', async () => {
    const payload = await buildFinanceClassificationV1(db(), { fiscalYear: 2026 });
    const accepted = acceptFinanceClassificationV1(payload);
    accepted.revenueStreams.options[0].label = 'changed';
    expect(payload.revenueStreams.options[0].label).not.toBe('changed');
    expect(validateFinanceClassificationV1({ ...payload, extra: true }).ok).toBe(false);
    const invalid = structuredClone(payload);
    invalid.revenueStreams.groups.push({ label: 'Bad', actualCents: 1, budgetCents: 1, stream: 'unknown', mapped: false });
    expect(validateFinanceClassificationV1(invalid).ok).toBe(false);
  });
});
