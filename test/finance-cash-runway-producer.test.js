import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceCashRunwayV1 } from '../src/api-contracts.js';
import { validateFinanceCashRunwayV1 } from '../contracts/validators/finance-cash-runway-consumer.js';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0016_finance.sql', '0018_finance_church_entries.sql', '0019_finance_church_balances.sql', '0050_finance_settings.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return {
    prepare(sql) {
      return {
        bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
      };
    },
    raw: sqlite,
  };
}

describe('buildFinanceCashRunwayV1', () => {
  it('reuses the pinned balance account and excludes daycare expense from church burn', async () => {
    const db = makeDb();
    db.raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_cash_policy',?)")
      .run(JSON.stringify({ policy_floor_months: 3, cash_account_code: '11027' }));
    const insertEntry = db.raw.prepare(`INSERT INTO finance_church_entries
      (fiscal_year,period_month,classification,category_path,account_name,own_actual_cents,source)
      VALUES (2026,0,'Expenses',?,?,?,'qbo_sync')`);
    insertEntry.run('Expenses:Operations', 'Operations', 900000);
    insertEntry.run('Expenses:MDO Payroll', 'MDO Payroll', 300000);
    db.raw.prepare(`INSERT INTO finance_church_balances
      (fiscal_year,as_of_date,classification,category_path,account_name,has_children,own_balance_cents,source)
      VALUES (2026,'2026-09-01','Assets','Assets:Current Assets:11027 Lindell','11027 Lindell Checking',1,2400000,'import')`).run();

    const result = await buildFinanceCashRunwayV1(db, { fiscalYear: 2026, now: new Date('2026-09-25T12:00:00Z') });
    expect(validateFinanceCashRunwayV1(result)).toEqual({ ok: true, errors: [] });
    expect(result).toMatchObject({
      available: true, cashSource: 'balance_sheet', onHandCents: 2400000,
      expensesYtdCents: 900000, daycareExcludedCents: 300000, allExpensesYtdCents: 1200000,
      monthsElapsed: 9, averageMonthlyExpenseCents: 100000, monthsOfCash: 24,
      floorCents: 300000, gapToFloorCents: 0, cashAccounts: ['11027 Lindell Checking'],
      policySettings: { floorMonths: 3, cashOnHandCents: null, cashAccountCode: '11027', generalFundBudgetCode: '' },
    });
  });

  it('returns a valid unavailable contract when no cash source exists', async () => {
    const db = makeDb();
    const result = await buildFinanceCashRunwayV1(db, { fiscalYear: 2026, now: new Date('2026-09-25T12:00:00Z') });
    expect(result.available).toBe(false);
    expect(result.cashSource).toBe('none');
    expect(result.monthsOfCash).toBeNull();
    expect(validateFinanceCashRunwayV1(result).ok).toBe(true);
  });
});
