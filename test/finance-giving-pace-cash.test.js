import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi } from '../src/api-finance.js';
import { resolveGeneralFundIds } from '../src/api-utils.js';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// The Financial Health page's giving-pace chart counted EVERY fund, so pass-through giving —
// Concordia Children's Services and the like, money that arrives and leaves — was reported as
// progress against the operating budget. It is now the General Fund family only, using the same
// rule the board report uses, and the operating-cash figure comes off the imported balance
// sheet's own operating account rather than a name match over connected QuickBooks accounts.

describe('resolveGeneralFundIds', () => {
  it('uses funds.category when an admin has categorised anything', () => {
    const { ids } = resolveGeneralFundIds([
      { id: 1, name: '40085 General Fund', category: 'general' },
      { id: 2, name: '40085 Christmas Offering', category: 'restricted' },
      { id: 3, name: '25010 Concordia Children\'s', category: 'restricted' },
    ]);
    // The admin's own answer wins over the name prefix — fund 2 shares the code but was
    // deliberately categorised restricted.
    expect([...ids]).toEqual([1]);
  });

  it('falls back to the whole numeric-code family before anything is categorised', () => {
    const { ids, prefix } = resolveGeneralFundIds([
      { id: 1, name: '40085 General Fund', category: '' },
      { id: 2, name: '40085 Christmas Offering', category: '' },
      { id: 3, name: '25010 Concordia Children\'s', category: '' },
    ]);
    expect(prefix).toBe('40085');
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it('reports no General Fund at all rather than guessing one', () => {
    const { ids } = resolveGeneralFundIds([{ id: 9, name: 'Memorials', category: '' }]);
    expect(ids.size).toBe(0);
  });
});

// ── The real route, against real SQL ────────────────────────────────────────────────────────
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0019_finance_church_balances.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', active INTEGER DEFAULT 1)`);
  sqlite.exec(`CREATE TABLE people (id INTEGER PRIMARY KEY, household_id INTEGER, member_type TEXT NOT NULL DEFAULT 'member')`);
  sqlite.exec(`CREATE TABLE giving_entries (id INTEGER PRIMARY KEY, person_id INTEGER, fund_id INTEGER, amount INTEGER NOT NULL DEFAULT 0, method TEXT DEFAULT 'check', contribution_date TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE finance_qb_snapshot (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE finance_daycare_entries (id INTEGER PRIMARY KEY, period TEXT, category TEXT, entry_type TEXT, amount_cents INTEGER, notes TEXT, source TEXT)`);
  return {
    prepare(sql) {
      const stmt = {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async first() { return sqlite.prepare(sql).get(); },
        async run() { sqlite.prepare(sql).run(); },
      };
      return stmt;
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}

const YEAR = 2026;
function seedGiving(db) {
  db._raw.exec(`INSERT INTO funds (id,name,category) VALUES
    (1,'40085 General Fund','general'),
    (2,'40085 Christmas Offering','general'),
    (3,'25010 Concordia Children''s Services','restricted')`);
  db._raw.exec(`INSERT INTO people (id,household_id,member_type) VALUES (1,10,'member')`);
  const g = db._raw.prepare('INSERT INTO giving_entries (person_id,fund_id,amount,contribution_date) VALUES (?,?,?,?)');
  g.run(1, 1, 100000, `${YEAR}-01-11`);   // General Fund, January
  g.run(1, 2, 25000, `${YEAR}-01-18`);    // Christmas Offering — same 40085 family
  g.run(1, 3, 500000, `${YEAR}-01-25`);   // Concordia — pass-through, must NOT count
  g.run(1, 1, 200000, `${YEAR}-02-08`);
}
function seedChurchEntries(db) {
  const e = db._raw.prepare(`INSERT INTO finance_church_entries
    (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
    VALUES (?,0,?,?,?,0,0,?,?,'import','2026-01-01')`);
  e.run(YEAR, 'Income', 'Income:40 Offerings:40085 Sunday Offering', '40085 Sunday Offering', 30000000, 42500000);
  e.run(YEAR, 'Income', 'Income:40 Offerings:40085 Christmas', '40085 Christmas Offering', 2000000, 2500000);
  e.run(YEAR, 'Income', 'Income:57 MDO Tuition', '57 MDO Tuition', 28000000, 30000000);
  e.run(YEAR, 'Expenses', 'Expenses:58 Salaries', '58 Salaries', 24000000, 40000000);
}
async function getHealth(db, year = YEAR) {
  const url = new URL('https://x/admin/api/finance/church/this-year?year=' + year);
  const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/this-year', db, true, true);
  return await res.json();
}

describe('GET finance/church/this-year — giving pace scoped to the General Fund', () => {
  it('counts only the General Fund family, and reports what it left out', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db);
    const d = await getHealth(db);
    expect(d.givingPace.scope).toBe('general_fund');
    expect(d.givingMonthly[0].cents, 'January = 1,000.00 + 250.00, not the 5,000.00 Concordia gift').toBe(125000);
    expect(d.givingMonthly[1].cents).toBe(200000);
    expect(d.givingPace.excludedCents).toBe(500000);
  });

  it('prices the pace line off the General Fund accounts, not all donor revenue', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db);
    const d = await getHealth(db);
    // The two 40085 ledger accounts, and NOT MDO tuition's budget.
    expect(d.givingPace.budgetCents).toBe(42500000 + 2500000);
  });

  it('leaves the all-funds giving total alone — only the pace chart is scoped', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db);
    const d = await getHealth(db);
    expect(d.givingCents, 'the Church Report reference line still shows every fund').toBe(825000);
  });

  it('draws no pace line rather than a $0 one when the General Fund has no budget on file', async () => {
    const db = makeTestDb();
    seedGiving(db);
    const e = db._raw.prepare(`INSERT INTO finance_church_entries
      (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
      VALUES (?,0,'Income','Income:40085','40085 Sunday Offering',0,0,?,NULL,'import','2026-01-01')`);
    e.run(YEAR, 30000000);
    const d = await getHealth(db);
    expect(d.givingPace.budgetCents).toBeNull();
  });

  it('falls back to every fund, and says so, when no General Fund can be identified', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO funds (id,name,category) VALUES (1,'Memorials',''), (2,'Flowers','')`);
    db._raw.exec(`INSERT INTO people (id,household_id,member_type) VALUES (1,10,'member')`);
    db._raw.prepare('INSERT INTO giving_entries (person_id,fund_id,amount,contribution_date) VALUES (1,1,?,?)').run(50000, `${YEAR}-03-01`);
    const d = await getHealth(db);
    expect(d.givingPace.scope).toBe('all_funds');
    expect(d.givingMonthly[2].cents).toBe(50000);
  });
});

describe('GET finance/church/this-year — operating cash from the balance sheet', () => {
  function seedBalances(db, year = YEAR) {
    const b = db._raw.prepare(`INSERT INTO finance_church_balances
      (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
      VALUES (?,?,?,?,?,0,?,?,'import','2026-01-01')`);
    b.run(year, `12/31/${year}`, 'Assets', 'Assets:11027', '11027 Lindell Checking xx9105', 0, 18450000);
    b.run(year, `12/31/${year}`, 'Assets', 'Assets:12010', '12010 Thrivent Endowment', 0, 20572408);
  }

  it('reads the pinned operating account and names it', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db); seedBalances(db);
    db._raw.prepare("INSERT INTO chms_config (key,value) VALUES ('finance_cash_policy',?)")
      .run(JSON.stringify({ policy_floor_months: 3, cash_on_hand_cents: null, cash_account_code: '11027' }));
    const d = await getHealth(db);
    expect(d.cash.source).toBe('balance_sheet');
    expect(d.cash.onHandCents).toBe(18450000);
    expect(d.cash.accounts).toEqual(['11027 Lindell Checking xx9105']);
    expect(d.cash.asOfDate).toBe('12/31/2026');
    expect(d.cash.available).toBe(true);
  });

  it('beats the QuickBooks account snapshot — a confirmed statement outranks a name match', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db); seedBalances(db);
    db._raw.prepare("INSERT INTO finance_qb_snapshot (key,value) VALUES ('accounts',?)")
      .run(JSON.stringify({ QueryResponse: { Account: [{ Name: 'Operating Checking', CurrentBalance: 999999 }] } }));
    const d = await getHealth(db);
    expect(d.cash.source).toBe('balance_sheet');
    expect(d.cash.onHandCents).toBe(18450000);
  });

  it('still lets an admin override the balance sheet by hand', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db); seedBalances(db);
    db._raw.prepare("INSERT INTO chms_config (key,value) VALUES ('finance_cash_policy',?)")
      .run(JSON.stringify({ policy_floor_months: 3, cash_on_hand_cents: 5000000, cash_account_code: '11027' }));
    const d = await getHealth(db);
    expect(d.cash.source).toBe('manual');
    expect(d.cash.onHandCents).toBe(5000000);
  });

  it('uses the most recent balance sheet on or before the year, and dates it', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db);
    seedBalances(db, 2024); // nothing for 2026
    const d = await getHealth(db);
    expect(d.cash.source).toBe('balance_sheet');
    expect(d.cash.asOfDate, 'a figure from an older statement must not read as today\'s balance').toBe('12/31/2024');
  });

  it('reports unavailable rather than $0 when no balance sheet has been imported', async () => {
    const db = makeTestDb();
    seedGiving(db); seedChurchEntries(db);
    const d = await getHealth(db);
    expect(d.cash.source).toBe('none');
    expect(d.cash.available).toBe(false);
  });
});

// ── The real render functions, out of the real built bundle ─────────────────────────────────
function makeCtx() {
  const store = {};
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    files: [], classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, setAttribute() {}, focus() {},
  });
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = el(id)); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement: () => el('x'), addEventListener() {}, body: el('body'), activeElement: null,
    },
    console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, Promise, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    FormData: class { append() {} }, navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  return ctx;
}
const paceData = (over) => Object.assign({
  year: new Date().getFullYear(),
  givingMonthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, cents: i < 3 ? 10000000 : 0 })),
  givingPace: { scope: 'general_fund', budgetCents: 42500000, excludedCents: 3400000 },
  revenueStreams: { streams: { donor: { budgetCents: 99900000 } } },
}, over || {});

describe('Giving pace card', () => {
  it('says General Fund in the title and names the money it excluded', () => {
    const html = makeCtx().finRenderGivingPace(paceData());
    expect(html).toContain('General Fund giving against budget pace');
    expect(html).toContain('$34,000');
    expect(html).toMatch(/designated and pass-through/);
  });

  it('never quotes the all-donor-revenue budget as the General Fund pace line', () => {
    // revenueStreams.donor.budgetCents ($999,000) was the old source; using it here would compare
    // one fund's giving against every donor account's target and read as a permanent shortfall.
    const html = makeCtx().finRenderGivingPace(paceData());
    expect(html).not.toContain('999,000');
  });

  it('drops the pace line, and says why, when the General Fund has no budget', () => {
    const html = makeCtx().finRenderGivingPace(paceData({ givingPace: { scope: 'general_fund', budgetCents: null, excludedCents: 0 } }));
    expect(html).toContain('No budget is on file for the General Fund accounts');
    expect(html).not.toContain('stroke-dasharray');
  });

  it('says plainly when it is still counting every fund', () => {
    const html = makeCtx().finRenderGivingPace(paceData({ givingPace: { scope: 'all_funds', budgetCents: null, excludedCents: 0 } }));
    expect(html).toContain('Giving against budget pace');
    expect(html).toContain('Every fund is counted');
  });
});

describe('finPaceEndLabels', () => {
  // The overlap is not "the lines are equal" — the two labels carry opposite fixed offsets, so
  // they collide when the actual line sits ~14px ABOVE the budget line, i.e. giving running a
  // little ahead of pace. That is the screenshot that was reported, and it is the healthy case.
  it('separates the labels when giving runs a little ahead of budget', () => {
    const ctx = makeCtx();
    const ys = [...ctx.finPaceEndLabels(100, 115).matchAll(/y="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(12.9);
  });

  it('keeps each label on the side of its own line', () => {
    const ctx = makeCtx();
    // Actual is above (smaller y) — its label must stay above the budget label.
    const ys = [...ctx.finPaceEndLabels(100, 115).matchAll(/y="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(ys[0]).toBeLessThan(ys[1]);
  });

  it('leaves well-separated labels where they are', () => {
    const ctx = makeCtx();
    const ys = [...ctx.finPaceEndLabels(60, 160).matchAll(/y="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(ys[0]).toBe(64);
    expect(ys[1]).toBe(150);
  });

  it('pulls apart the exact stack — the two labels printed at the same y', () => {
    // actualY 100 / budgetY 114 put both labels at y=104 under the old fixed offsets.
    const ctx = makeCtx();
    const ys = [...ctx.finPaceEndLabels(100, 114).matchAll(/y="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(ys[0]).not.toBe(ys[1]);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(12.9);
  });

  it('renders one label when there is no budget line to label', () => {
    expect(makeCtx().finPaceEndLabels(100, null)).not.toContain('Budget');
  });
});

describe('Cash runway card', () => {
  const cash = (over) => ({ cash: Object.assign({
    available: true, onHandCents: 18450000, avgMonthlyExpenseCents: 5000000,
    monthsOfCash: 3.7, policyFloorMonths: 3, source: 'balance_sheet',
    accounts: ['11027 Lindell Checking xx9105'], asOfDate: '12/31/2026',
  }, over || {}) });

  it('names the account and the as-of date the figure came from', () => {
    const html = makeCtx().finRenderCashRunway(cash());
    expect(html).toContain('11027 Lindell Checking xx9105');
    expect(html).toContain('as of 12/31/2026');
  });

  it('still labels a QuickBooks or hand-entered figure for what it is', () => {
    const ctx = makeCtx();
    expect(ctx.finRenderCashRunway(cash({ source: 'quickbooks', accounts: [] }))).toContain('QuickBooks');
    expect(ctx.finRenderCashRunway(cash({ source: 'manual', accounts: [] }))).toContain('entered by hand');
  });

  it('points at the balance sheet when there is no figure yet', () => {
    const html = makeCtx().finRenderCashRunway({ cash: { available: false } });
    expect(html).toContain('balance sheet');
  });
});
