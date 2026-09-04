import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleFinanceApi, REVENUE_STREAMS, FLOW_EXPENSE_KEYS } from '../src/api-finance.js';

// Chart of Accounts: which board category a real fund/account reads under (display only —
// finance_church_entries and QuickBooks itself are never touched by any of this), and what each
// category is called. Stored as one JSON blob in chms_config, keyed 'finance_planning_board_categories'.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
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
function makeReq(body) { return { json: async () => body }; }
const GET = (db, isAdmin) => handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/board-categories', db, !!isAdmin, true);
const PUT = (db, body, isAdmin) => handleFinanceApi(makeReq(body), {}, new URL('https://x/'), 'PUT', 'finance/planning/board-categories', db, !!isAdmin, true);

describe('finance/planning/board-categories', () => {
  it('GET on a fresh DB returns the empty shape, not an error', async () => {
    const db = makeTestDb();
    const res = await GET(db, false);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ revenue: {}, expense: {}, revenueLabels: {}, expenseLabels: {} });
  });

  it('a non-admin can read but not write', async () => {
    const db = makeTestDb();
    const getRes = await GET(db, false);
    expect(getRes.status).toBe(200);
    const putRes = await PUT(db, { revenue: { 'Income:40085 Sunday Offering': 'earned' } }, false);
    expect(putRes.status).toBe(403);
    // and the refused write really didn't land
    const after = await (await GET(db, false)).json();
    expect(after.revenue).toEqual({});
  });

  it('admin PUT assigns a revenue account to a category and it round-trips on GET', async () => {
    const db = makeTestDb();
    const put = await PUT(db, { revenue: { 'Income:40085 Sunday Offering': 'donor' } }, true);
    expect(put.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.revenue).toEqual({ 'Income:40085 Sunday Offering': 'donor' });
  });

  it('rejects a revenue category not in REVENUE_STREAMS', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { revenue: { 'Income:X': 'not-a-real-stream' } }, true);
    expect(res.status).toBe(400);
    const got = await (await GET(db, true)).json();
    expect(got.revenue).toEqual({}); // the bad write never landed
  });

  it('rejects an expense category not in FLOW_EXPENSE_KEYS', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { expense: { 'Expenses:X': 'not-a-real-category' } }, true);
    expect(res.status).toBe(400);
  });

  it('accepts every real key from both allowlists', async () => {
    const db = makeTestDb();
    const revenue = {}; REVENUE_STREAMS.forEach((k, i) => { revenue['Income:acct' + i] = k; });
    const expense = {}; FLOW_EXPENSE_KEYS.forEach((k, i) => { expense['Expenses:acct' + i] = k; });
    const res = await PUT(db, { revenue, expense }, true);
    expect(res.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.revenue).toEqual(revenue);
    expect(got.expense).toEqual(expense);
  });

  it('a second PUT merges into the first — a save made from Planning and one made from Chart of Accounts land in the same store', async () => {
    const db = makeTestDb();
    await PUT(db, { revenue: { 'Income:A': 'donor' } }, true);
    await PUT(db, { revenue: { 'Income:B': 'earned' } }, true);
    const got = await (await GET(db, true)).json();
    expect(got.revenue).toEqual({ 'Income:A': 'donor', 'Income:B': 'earned' });
  });

  it('an empty-string value clears one entry back to the computed default, without touching any other entry', async () => {
    const db = makeTestDb();
    await PUT(db, { revenue: { 'Income:A': 'donor', 'Income:B': 'earned' } }, true);
    const res = await PUT(db, { revenue: { 'Income:A': '' } }, true);
    expect(res.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.revenue).toEqual({ 'Income:B': 'earned' });
  });

  it('renames a revenue category label and an expense category label independently', async () => {
    const db = makeTestDb();
    await PUT(db, { revenueLabels: { donor: 'Sunday & General Giving' } }, true);
    await PUT(db, { expenseLabels: { mdo: 'Mother\'s Day Out' } }, true);
    const got = await (await GET(db, true)).json();
    expect(got.revenueLabels).toEqual({ donor: 'Sunday & General Giving' });
    expect(got.expenseLabels).toEqual({ mdo: "Mother's Day Out" });
  });

  it('ignores a rename for a key that is not a real category, rather than storing garbage', async () => {
    const db = makeTestDb();
    await PUT(db, { revenueLabels: { 'not-a-real-key': 'Whatever' } }, true);
    const got = await (await GET(db, true)).json();
    expect(got.revenueLabels).toEqual({});
  });

  it('a blank rename clears the custom label back to the default, rather than saving whitespace', async () => {
    const db = makeTestDb();
    await PUT(db, { revenueLabels: { donor: 'Custom Name' } }, true);
    await PUT(db, { revenueLabels: { donor: '   ' } }, true);
    const got = await (await GET(db, true)).json();
    expect(got.revenueLabels).toEqual({});
  });

  it('trims a rename\'s leading/trailing whitespace — internal whitespace collapsing is the frontend\'s own job (finCoaRename), not this route\'s', async () => {
    const db = makeTestDb();
    await PUT(db, { revenueLabels: { earned: '  Earned Income  ' } }, true);
    const got = await (await GET(db, true)).json();
    expect(got.revenueLabels.earned).toBe('Earned Income');
  });
});
