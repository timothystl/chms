import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleReportsApi } from '../src/api-reports.js';

// ── Minimal D1-shaped wrapper around node:sqlite (same pattern as test/finance-church.test.js) ──
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0028_fund_budget.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0033_fund_category.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
    _raw: sqlite,
  };
}

function insertFund(db, name) {
  db._raw.prepare('INSERT INTO funds (name) VALUES (?)').run(name);
  return db._raw.prepare('SELECT id FROM funds WHERE name=?').get(name).id;
}
function insertBatch(db, date) {
  db._raw.prepare('INSERT INTO giving_batches (batch_date) VALUES (?)').run(date);
  return db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function insertEntry(db, { batchId, fundId, amount, date }) {
  db._raw.prepare(
    `INSERT INTO giving_entries (batch_id, fund_id, amount, contribution_date) VALUES (?,?,?,?)`
  ).run(batchId, fundId, amount, date);
}

// A fixture reproducing the real shape reported: "40085 General Fund" is the main account, plus
// several $0-in-this-window seasonal sub-funds under the same "40085" leading code, plus a couple
// of genuinely separate designated funds (different leading code) that should stay excluded.
async function seedBoardFixture(db, year) {
  const genFundId = insertFund(db, '40085 General Fund');
  const christmasFundId = insertFund(db, '40085 Christmas Offering');
  const buildingFundId = insertFund(db, '25004 Building Fund');
  const batchCur = insertBatch(db, `${year}-03-01`);
  const batchPrior = insertBatch(db, `${year - 1}-03-01`);
  insertEntry(db, { batchId: batchCur, fundId: genFundId, amount: 100000, date: `${year}-02-01` });
  insertEntry(db, { batchId: batchCur, fundId: christmasFundId, amount: 5000, date: `${year}-02-15` });
  insertEntry(db, { batchId: batchCur, fundId: buildingFundId, amount: 20000, date: `${year}-02-20` });
  insertEntry(db, { batchId: batchPrior, fundId: genFundId, amount: 90000, date: `${year - 1}-02-01` });
  insertEntry(db, { batchId: batchPrior, fundId: buildingFundId, amount: 15000, date: `${year - 1}-02-20` });
  // Prior full year (rest of the prior year, past the through-month window) so the projection
  // has a real seasonal shape to scale from.
  insertEntry(db, { batchId: batchPrior, fundId: genFundId, amount: 400000, date: `${year - 1}-09-01` });
  return { genFundId, christmasFundId, buildingFundId };
}

describe('giving-board General Fund split', () => {
  it('groups every fund sharing the General Fund\'s numeric prefix, separate from other funds', async () => {
    const db = makeTestDb();
    const year = 2026;
    await seedBoardFixture(db, year);
    const url = new URL(`https://x/admin/api/reports/giving-board?period=${year}-02`);
    const res = await handleReportsApi({}, {}, url, 'GET', 'reports/giving-board', db, true, true, true, true);
    const body = await res.json();
    // General Fund YTD = 40085 General Fund (100000) + 40085 Christmas Offering (5000), NOT the
    // 25004 Building Fund (20000) which has a different leading code.
    expect(body.general_fund.given_ytd_cents).toBe(105000);
    expect(body.general_fund.other_giving_cents).toBe(20000);
    expect(body.general_fund.other_fund_count).toBe(1);
    // Per-fund rows are flagged so the frontend/other reports can rely on the same classification.
    const byName = Object.fromEntries(body.funds.map(f => [f.name, f]));
    expect(byName['40085 General Fund'].is_general_fund).toBe(true);
    expect(byName['40085 Christmas Offering'].is_general_fund).toBe(true);
    expect(byName['25004 Building Fund'].is_general_fund).toBe(false);
  });

  it('projects General Fund year-end off only General Fund monthly data, not the all-funds total', async () => {
    const db = makeTestDb();
    const year = 2026;
    await seedBoardFixture(db, year);
    const url = new URL(`https://x/admin/api/reports/giving-board?period=${year}-02`);
    const res = await handleReportsApi({}, {}, url, 'GET', 'reports/giving-board', db, true, true, true, true);
    const body = await res.json();
    // Prior year General Fund through Feb = 90000; prior full year = 90000 + 400000 = 490000.
    // Ratio = 490000/90000. Current GF YTD = 105000 -> projected = round(105000 * 490000/90000).
    const expected = Math.round(105000 * (490000 / 90000));
    expect(body.general_fund.projection_cents).toBe(expected);
    // The all-funds projection (kpis.projection_cents) must differ, since it also carries the
    // Building Fund's contribution — proving the two are genuinely computed on different bases.
    expect(body.kpis.projection_cents).not.toBe(body.general_fund.projection_cents);
  });

  it('pulls Vs. Budget YTD from the Church Report account sharing the same numeric code', async () => {
    const db = makeTestDb();
    const year = 2026;
    await seedBoardFixture(db, year);
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, own_actual_cents, own_budget_cents, source)
       VALUES (?,0,'Income','Income:40085 Sunday Offering','40085 Sunday Offering',0,600000,'import')`
    ).run(year);
    const url = new URL(`https://x/admin/api/reports/giving-board?period=${year}-02`);
    const res = await handleReportsApi({}, {}, url, 'GET', 'reports/giving-board', db, true, true, true, true);
    const body = await res.json();
    expect(body.general_fund.annual_budget_cents).toBe(600000);
    expect(body.general_fund.budget_ytd_cents).not.toBeNull();
    expect(body.general_fund.budget_variance_cents).toBe(body.general_fund.given_ytd_cents - body.general_fund.budget_ytd_cents);
  });

  it('leaves the budget at null (not $0) when no Church Report account matches', async () => {
    const db = makeTestDb();
    const year = 2026;
    await seedBoardFixture(db, year);
    const url = new URL(`https://x/admin/api/reports/giving-board?period=${year}-02`);
    const res = await handleReportsApi({}, {}, url, 'GET', 'reports/giving-board', db, true, true, true, true);
    const body = await res.json();
    expect(body.general_fund.annual_budget_cents).toBeNull();
    expect(body.general_fund.budget_ytd_cents).toBeNull();
    expect(body.general_fund.budget_variance_cents).toBeNull();
  });
});
