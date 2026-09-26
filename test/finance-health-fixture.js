// Shared synthetic fixture for the connect.finance-health.v1 tests (contract and page). Not a
// test file itself; every account, fund and figure here is invented.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Every figure below is synthetic. The ledger is small enough to check by hand:
//   Income  $50,000 Sunday Offering + $1,000 Altar Guild + $8,000 Hall Rental + $30,000 MDO Tuition
//   Expense $40,000 Pastor Salary + $6,000 Electric + $4,000 Insurance + $40,000 MDO Wages
//   Net −$1,000 through July, projected straight-line to −$1,714.29 for the year.
export function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  }
  const statement = (sql, args = []) => ({
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args); },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return {
    prepare(sql) { return { bind: (...args) => statement(sql, args), ...statement(sql) }; },
    async batch(items) { const out = []; for (const item of items) out.push(await item.run()); return out; },
    raw: sqlite,
  };
}

export function seed(db) {
  const raw = db.raw;
  const entry = raw.prepare(`INSERT INTO finance_church_entries
    (fiscal_year,period_month,classification,category_path,account_name,depth,has_children,own_actual_cents,own_budget_cents,source)
    VALUES (2026,0,?,?,?,?,?,?,?,'import')`);
  entry.run('Income', 'Income', 'Income', 0, 1, 0, null);
  entry.run('Income', 'Income:40 Offerings & Contributions', '40 Offerings & Contributions', 1, 1, 0, null);
  entry.run('Income', 'Income:40 Offerings & Contributions:40085 Sunday Offering', '40085 Sunday Offering', 2, 0, 5000000, 12000000);
  entry.run('Income', 'Income:48 Other Income', '48 Other Income', 1, 1, 0, null);
  entry.run('Income', 'Income:48 Other Income:48001 Altar Guild', '48001 Altar Guild', 2, 0, 100000, null);
  entry.run('Income', 'Income:44 Facility Rentals', '44 Facility Rentals', 1, 1, 0, null);
  entry.run('Income', 'Income:44 Facility Rentals:44010 Hall Rental', '44010 Hall Rental', 2, 0, 800000, null);
  entry.run('Income', 'Income:57 MDO Tuition', '57 MDO Tuition', 1, 1, 0, null);
  entry.run('Income', 'Income:57 MDO Tuition:57010 Tuition', '57010 Tuition', 2, 0, 3000000, null);
  entry.run('Expenses', 'Expenses', 'Expenses', 0, 1, 0, null);
  entry.run('Expenses', 'Expenses:60 Salaries', '60 Salaries', 1, 1, 0, null);
  entry.run('Expenses', 'Expenses:60 Salaries:60010 Pastor Salary', '60010 Pastor Salary', 2, 0, 4000000, 6000000);
  entry.run('Expenses', 'Expenses:34 Utilities', '34 Utilities', 1, 1, 0, null);
  entry.run('Expenses', 'Expenses:34 Utilities:34010 Electric', '34010 Electric', 2, 0, 600000, 1200000);
  entry.run('Expenses', 'Expenses:35 Insurance', '35 Insurance', 1, 1, 0, null);
  entry.run('Expenses', 'Expenses:35 Insurance:35010 Property Insurance', '35010 Property Insurance', 2, 0, 400000, 1000000);
  entry.run('Expenses', 'Expenses:57 MDO Expenses', '57 MDO Expenses', 1, 1, 0, null);
  entry.run('Expenses', 'Expenses:57 MDO Expenses:57161 MDO - Wages', '57161 MDO - Wages', 2, 0, 4000000, null);
  // One prior year so the five-year mix has two columns.
  raw.prepare(`INSERT INTO finance_church_entries (fiscal_year,period_month,classification,category_path,account_name,depth,own_actual_cents,source)
    VALUES (2025,0,'Income','Income:40 Offerings & Contributions:40085 Sunday Offering','40085 Sunday Offering',2,9000000,'import')`).run();

  raw.prepare(`INSERT INTO finance_church_balances (fiscal_year,as_of_date,classification,category_path,account_name,has_children,own_balance_cents,source)
    VALUES (2026,'2026-06-30','Assets','Assets:11027 Operating Checking','11027 Operating Checking',0,2000000,'import')`).run();
  raw.prepare(`INSERT INTO finance_church_balances (fiscal_year,as_of_date,classification,category_path,account_name,has_children,own_balance_cents,source)
    VALUES (2026,'2026-06-30','Liabilities','Liabilities:25000 Funds:25004 Building Fund','25004 Building Fund',0,700000,'import')`).run();
  raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_cash_policy',?)").run(JSON.stringify({ policy_floor_months: 3, cash_account_code: '11027' }));

  raw.prepare("INSERT INTO funds (name) VALUES ('40085 General Fund')").run();
  raw.prepare("INSERT INTO funds (name) VALUES ('25004 Building Fund')").run();
  const fundId = (name) => raw.prepare('SELECT id FROM funds WHERE name=?').get(name).id;
  const gift = raw.prepare('INSERT INTO giving_monthly_fund_totals (month,fund_id,gift_count,total_cents) VALUES (?,?,1,?)');
  gift.run('2026-01', fundId('40085 General Fund'), 900000);
  gift.run('2026-02', fundId('40085 General Fund'), 800000);
  gift.run('2026-03', fundId('25004 Building Fund'), 250000);
  raw.prepare('INSERT INTO giving_year_stats (year,giving_households,giver_count,band_high,band_mid,band_low) VALUES (2026,40,55,6,14,20)').run();
  raw.prepare('INSERT INTO giving_year_person_rollup_ready (year) VALUES (2026)').run();

  const daycare = raw.prepare("INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,source) VALUES ('2026',?,?,?,?)");
  daycare.run('Tuition Income', 'actual', 3000000, 'church_budget_import');
  daycare.run('Payroll', 'actual', 2600000, 'church_budget_import');
  daycare.run('Payroll', 'budget', 5000000, 'church_budget_import');
  daycare.run('Payroll', 'actual', 999999, 'manual'); // not a counted source: never in the card

  const month = raw.prepare(`INSERT INTO finance_property_monthly (property_key,period,occupancy_pct,net_income_cents,available_for_distribution_cents,reserve_balance_cents)
    VALUES ('ivanhoe',?,?,?,?,?)`);
  month.run('2026-05', 0.9, 400000, 1500000, null);
  month.run('2026-06', 1.0, 420000, null, 1035833);
  raw.prepare("INSERT INTO finance_property_distributions (property_key,period,amount_cents) VALUES ('ivanhoe','2026-03',500000)").run();
  raw.prepare("INSERT INTO finance_daycare_rooms (period,room_name,capacity_per_day,avg_daily_enrolled,waitlist_families) VALUES ('2026-06','Infants',8,8,5)").run();
}
