import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi, computePropertyAnnualSummary } from '../src/api-finance.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as test/finance-church.test.js and
// test/scheduler-volunteers.test.js — runs against real SQL instead of a hand-rolled mock.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(readFileSync(new URL('../migrations/0022_finance_property.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0023_finance_property_reserves.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE finance_daycare_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period       TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT '',
    entry_type   TEXT    NOT NULL DEFAULT 'actual',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    notes        TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT 'manual',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}

function makeReq(body) {
  return { json: async () => body };
}

describe('computePropertyAnnualSummary', () => {
  it('groups monthly rows by calendar year and sums revenue/expenses/net income', () => {
    const monthly = [
      { period: '2024-05', total_revenue_cents: 100000, total_expenses_cents: 40000, net_income_cents: 60000, occupancy_pct: 0.9 },
      { period: '2024-06', total_revenue_cents: 200000, total_expenses_cents: 50000, net_income_cents: 150000, occupancy_pct: 1.0 },
      { period: '2025-01', total_revenue_cents: 90000, total_expenses_cents: 30000, net_income_cents: 60000, occupancy_pct: 1.0 },
    ];
    const dists = [{ period: '2024-06', amount_cents: 70000 }];
    const notes = { 2024: 'note for 2024' };
    const out = computePropertyAnnualSummary(monthly, dists, notes);
    expect(out).toHaveLength(2);
    const y2024 = out.find(y => y.year === 2024);
    expect(y2024.total_revenue_cents).toBe(300000);
    expect(y2024.total_expenses_cents).toBe(90000);
    expect(y2024.net_income_cents).toBe(210000);
    expect(y2024.avg_occupancy_pct).toBeCloseTo(0.95);
    expect(y2024.confirmed_distributions_cents).toBe(70000);
    expect(y2024.notes).toBe('note for 2024');
    const y2025 = out.find(y => y.year === 2025);
    expect(y2025.confirmed_distributions_cents).toBe(0);
    expect(y2025.notes).toBe('');
  });

  it('ignores null figures instead of treating them as zero', () => {
    const monthly = [{ period: '2026-01', total_revenue_cents: 100000, total_expenses_cents: null, net_income_cents: 50000, occupancy_pct: null }];
    const out = computePropertyAnnualSummary(monthly, [], {});
    expect(out[0].total_expenses_cents).toBe(0); // sum starts at 0, null just isn't added
    expect(out[0].avg_occupancy_pct).toBeNull();
  });
});

describe('handleFinanceApi — commercial property routes', () => {
  it('POST monthly converts dollars to cents and GET returns them back, with the equity computed from meta', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?)`
    ).bind(JSON.stringify({ valuation: { capitalized_value_cents: 68631486 }, loan: { balance_cents: 29733600 } })).run();

    const postReq = makeReq({ period: '2026-06', occupancy_pct: 95, total_revenue: '9000.50', total_expenses: '3000.25', net_income: '6000.25', net_operating_income: '', available_for_distribution: '', reserve_balance: '', source_report: 'test.pdf' });
    const postRes = await handleFinanceApi(postReq, {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly', db, true, true);
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const getBody = await getRes.json();
    expect(getBody.monthly).toHaveLength(1);
    const row = getBody.monthly[0];
    expect(row.total_revenue_cents).toBe(900050);
    expect(row.total_expenses_cents).toBe(300025);
    expect(row.net_income_cents).toBe(600025);
    expect(row.net_operating_income_cents).toBeNull();
    expect(getBody.equity.equity_cents).toBe(68631486 - 29733600);
    expect(getBody.annualSummary).toHaveLength(1);
    expect(getBody.annualSummary[0].year).toBe(2026);
  });

  it('rejects writes from a non-admin finance user', async () => {
    const db = makeTestDb();
    const postReq = makeReq({ period: '2026-06', total_revenue: '100' });
    const res = await handleFinanceApi(postReq, {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly', db, false, true);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed period', async () => {
    const db = makeTestDb();
    const postReq = makeReq({ period: 'not-a-period', total_revenue: '100' });
    const res = await handleFinanceApi(postReq, {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly', db, true, true);
    expect(res.status).toBe(400);
  });

  it('upserts a distribution and deletes it', async () => {
    const db = makeTestDb();
    const addRes = await handleFinanceApi(makeReq({ period: '2026-04', amount: '4000' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/distributions', db, true, true);
    expect(addRes.status).toBe(200);
    let getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    let body = await getRes.json();
    expect(body.distributions).toHaveLength(1);
    expect(body.distributions[0].amount_cents).toBe(400000);

    const delRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/distributions/2026-04', db, true, true);
    expect(delRes.status).toBe(200);
    getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    body = await getRes.json();
    expect(body.distributions).toHaveLength(0);
  });

  it('PATCH meta merges into the existing loan/valuation sections without clobbering other keys', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?)`
    ).bind(JSON.stringify({ loan: { balance_cents: 29733600, lender: 'LCEF' }, property: { name: '3277 Ivanhoe' } })).run();
    const res = await handleFinanceApi(makeReq({ loan: { balance_cents: 29000000 } }), {}, new URL('https://x/'), 'PATCH', 'finance/property/ivanhoe/meta', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.loan.balance_cents).toBe(29000000);
    expect(body.meta.loan.lender).toBe('LCEF'); // untouched sibling field survives the merge
    expect(body.meta.property.name).toBe('3277 Ivanhoe'); // untouched section survives too
  });

  it('denies all property access to a non-finance role', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, false, false);
    expect(res.status).toBe(403);
  });
});

describe('handleFinanceApi — reserve schedules (property tax, capital, ...)', () => {
  it('auto-computes reserve_before from the prior month and carries the running balance forward', async () => {
    const db = makeTestDb();
    const jan = await handleFinanceApi(makeReq({ report_month: '2026-01', tax_year: 2026, target_estimate: '11400', contribution: '950' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    expect(jan.status).toBe(200);
    const janBody = await jan.json();
    expect(janBody.reserve_before_cents).toBe(0);
    expect(janBody.reserve_after_cents).toBe(95000);

    const feb = await handleFinanceApi(makeReq({ report_month: '2026-02', tax_year: 2026, target_estimate: '11400', contribution: '950' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    const febBody = await feb.json();
    expect(febBody.reserve_before_cents).toBe(95000); // carried from January's reserve_after
    expect(febBody.reserve_after_cents).toBe(190000);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const body = await getRes.json();
    expect(body.reserves.property_tax).toHaveLength(2);
  });

  it('a zero-contribution "paid" month can be recorded, and a disbursement logged separately', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ report_month: '2025-10', contribution: '674.20' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    const paidRes = await handleFinanceApi(makeReq({ report_month: '2025-11', tax_year: 2025, target_estimate: '0', contribution: '0', reserve_before: '0', note: 'tax paid, reserve zeroed' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    expect((await paidRes.json()).reserve_after_cents).toBe(0);

    const disRes = await handleFinanceApi(makeReq({ period_key: '2025', amount: '11349.64', paid_via_report_month: '2025-11', note: 'annual tax bill' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/disbursements', db, true, true);
    expect(disRes.status).toBe(200);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const body = await getRes.json();
    expect(body.reserveDisbursements.property_tax[0].amount_cents).toBe(1134964);
  });

  it('deletes a reserve month and a disbursement', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ report_month: '2026-01', contribution: '950' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    await handleFinanceApi(makeReq({ period_key: '2025', amount: '100' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/disbursements', db, true, true);

    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/reserves/property_tax/monthly/2026-01', db, true, true);
    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/reserves/property_tax/disbursements/2025', db, true, true);

    const body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.reserves.property_tax).toBeUndefined();
    expect(body.reserveDisbursements.property_tax).toBeUndefined();
  });
});

describe('handleFinanceApi — capital improvements ledger', () => {
  it('adds ledger entries, assigns increasing sort_order, and totals them', async () => {
    const db = makeTestDb();
    const r1 = await handleFinanceApi(makeReq({ entry_date: '2024-10-07', amount: '5400', payee: 'Vail Contracting LLC', description: 'renovation', project: 'Apartment renovation' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/capital-ledger', db, true, true);
    expect(r1.status).toBe(200);
    await handleFinanceApi(makeReq({ entry_date: '2024-10-19', amount: '2302.25', payee: 'SS Stone', description: 'countertop', project: 'Apartment renovation' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/capital-ledger', db, true, true);

    const body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.capitalLedger).toHaveLength(2);
    expect(body.capitalLedger[0].sort_order).toBe(0);
    expect(body.capitalLedger[1].sort_order).toBe(1);
    expect(body.capitalLedgerTotalCents).toBe(540000 + 230225);
  });

  it('deletes a ledger entry by id', async () => {
    const db = makeTestDb();
    const addRes = await handleFinanceApi(makeReq({ entry_date: '2024-10-07', amount: '5400' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/capital-ledger', db, true, true);
    const { id } = await addRes.json();
    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/capital-ledger/' + id, db, true, true);
    const body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.capitalLedger).toHaveLength(0);
  });
});

describe('handleFinanceApi — repairs & maintenance log', () => {
  it('adds and deletes a repair entry, tolerating a null amount', async () => {
    const db = makeTestDb();
    const addRes = await handleFinanceApi(makeReq({ entry_date: '2026-05', category: 'HVAC', description: 'AC repair' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/repairs', db, true, true);
    expect(addRes.status).toBe(200);
    const { id } = await addRes.json();

    let body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.repairs).toHaveLength(1);
    expect(body.repairs[0].amount_cents).toBeNull();

    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/repairs/' + id, db, true, true);
    body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.repairs).toHaveLength(0);
  });

  it('rejects writes from a non-admin', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ category: 'HVAC' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/repairs', db, false, true);
    expect(res.status).toBe(403);
  });
});

describe('handleFinanceApi — daycare bulk past-year import', () => {
  it('imports multiple rows in one call', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ rows: [
      { period: '2023', category: 'Tuition Income', entry_type: 'actual', amount_cents: 28500000 },
      { period: '2023', category: 'Payroll', entry_type: 'actual', amount_cents: 19000000 },
    ] }), {}, new URL('https://x/'), 'POST', 'finance/daycare/bulk', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    const rows = db._raw.prepare('SELECT * FROM finance_daycare_entries').all();
    expect(rows).toHaveLength(2);
  });

  it('rejects the whole batch if one row is malformed', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ rows: [
      { period: '2023', category: 'Tuition Income', amount_cents: 100 },
      { period: 'not-a-period', category: 'Payroll', amount_cents: 100 },
    ] }), {}, new URL('https://x/'), 'POST', 'finance/daycare/bulk', db, true, true);
    expect(res.status).toBe(400);
    const rows = db._raw.prepare('SELECT * FROM finance_daycare_entries').all();
    expect(rows).toHaveLength(0); // nothing committed from the bad batch
  });
});
