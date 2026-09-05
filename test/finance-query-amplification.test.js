import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi } from '../src/api-finance.js';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// ── Why this file exists ────────────────────────────────────────────────────────────────────
// Opening the Finance tab used to run finance/church/this-year THREE times (Financial Health,
// Church Report and Budget each fetched it independently), every section click re-ran all seven
// section loaders, and that one payload scanned giving_entries FOUR times. On 2026-09-04 that
// amplification took tlc-volunteer-db past the D1 free-tier row-read ceiling and unrelated
// church APIs started failing. These tests pin the three fixes: fewer scans per request, one
// request per year across screens, and only the visible section loading.

// A D1-shaped stub that also counts what it was asked to run, so "how many times does this touch
// giving_entries" is an assertion rather than a reading of the source.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0019_finance_church_balances.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', active INTEGER DEFAULT 1)`);
  sqlite.exec(`CREATE TABLE people (id INTEGER PRIMARY KEY, household_id INTEGER, member_type TEXT NOT NULL DEFAULT 'member')`);
  sqlite.exec(`CREATE TABLE giving_entries (id INTEGER PRIMARY KEY, person_id INTEGER, fund_id INTEGER, amount INTEGER NOT NULL DEFAULT 0, contribution_date TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE finance_qb_snapshot (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  const sql_log = [];
  return {
    sql_log,
    prepare(sql) {
      sql_log.push(sql);
      const run = (args) => ({
        async run() { sqlite.prepare(sql).run(...args); },
        async first() { return sqlite.prepare(sql).get(...args); },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}

const YEAR = 2026;
function seed(db) {
  db._raw.exec(`INSERT INTO funds (id,name,category) VALUES
    (1,'40085 General Fund','general'),
    (2,'40085 Christmas Offering','general'),
    (3,'25010 Concordia Children''s Services','restricted')`);
  // Three households: one over $2,000/yr, one in the $500-$2,000 band, one under $500. Plus an
  // organization (must be excluded from both the count and the bands) and a giver with no
  // household (counts as their own household).
  db._raw.exec(`INSERT INTO people (id,household_id,member_type) VALUES
    (1,10,'member'), (2,10,'member'), (3,11,'member'), (4,NULL,'member'), (5,12,'organization')`);
  const g = db._raw.prepare('INSERT INTO giving_entries (person_id,fund_id,amount,contribution_date) VALUES (?,?,?,?)');
  g.run(1, 1, 150000, `${YEAR}-01-11`);   // household 10 -> 150000 + 100000 = 250000  (high)
  g.run(2, 1, 100000, `${YEAR}-02-08`);
  g.run(3, 2,  60000, `${YEAR}-03-15`);   // household 11 -> 60000                     (mid)
  g.run(4, 3,  10000, `${YEAR}-04-19`);   // no household -> 10000                     (low)
  g.run(5, 1, 900000, `${YEAR}-05-24`);   // organization -> excluded entirely
  g.run(1, 9,  77000, `${YEAR}-06-14`);   // fund 9 does not exist in `funds`
  g.run(1, 1,  50000, `${YEAR - 1}-12-28`); // previous year, out of range
}
async function getPayload(db, year = YEAR) {
  const url = new URL('https://x/admin/api/finance/church/this-year?year=' + year);
  const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/this-year', db, true, true);
  return await res.json();
}
const givingScans = (db) => db.sql_log.filter((q) => /FROM giving_entries/.test(q)).length;

describe('finance/church/this-year — how often it reads giving_entries', () => {
  it('scans giving_entries twice per request, not four times', async () => {
    const db = makeTestDb();
    seed(db);
    await getPayload(db);
    expect(givingScans(db)).toBe(2);
  });

  it('still reports the same per-fund totals it did when they were their own scan', async () => {
    const db = makeTestDb();
    seed(db);
    const d = await getPayload(db);
    // Highest first, and fund 9 — which has giving but no row in `funds` — is absent, because
    // the query this replaced was an INNER JOIN onto funds.
    expect(d.givingByFund).toEqual([
      { fundName: '40085 General Fund', cents: 250000 + 900000 },
      { fundName: '40085 Christmas Offering', cents: 60000 },
      { fundName: '25010 Concordia Children\'s Services', cents: 10000 },
    ]);
    expect(d.givingCents).toBe(250000 + 900000 + 60000 + 10000);
  });

  it('still counts giving households and buckets donor bands the way two scans did', async () => {
    const db = makeTestDb();
    seed(db);
    const d = await getPayload(db);
    // households 10 and 11, plus the householdless giver; the organization is excluded.
    expect(d.givingHouseholds).toBe(3);
    expect(d.donorBands).toEqual([
      { label: '$2,000+ / yr', households: 1 },
      { label: '$500–$2,000', households: 1 },
      { label: 'Under $500', households: 1 },
    ]);
  });

  it('leaves the month-by-month General Fund pace unchanged', async () => {
    const db = makeTestDb();
    seed(db);
    const d = await getPayload(db);
    expect(d.givingPace.scope).toBe('general_fund');
    const byMonth = Object.fromEntries(d.givingMonthly.filter((m) => m.cents).map((m) => [m.month, m.cents]));
    // Jan/Feb/Mar/May are General Fund family (funds 1 and 2). April is Concordia and June is the
    // orphan fund; both are excluded from the pace and counted as excluded instead.
    expect(byMonth).toEqual({ 1: 150000, 2: 100000, 3: 60000, 5: 900000 });
    expect(d.givingPace.excludedCents).toBe(10000 + 77000);
  });
});

describe('finance/church/this-year — concurrent requests share one computation', () => {
  it('three simultaneous callers for the same year do the work once', async () => {
    const db = makeTestDb();
    seed(db);
    const [a, b, c] = await Promise.all([getPayload(db), getPayload(db), getPayload(db)]);
    expect(givingScans(db)).toBe(2);
    expect(a.givingCents).toBe(b.givingCents);
    expect(b.givingCents).toBe(c.givingCents);
  });

  it('does not become a cache — a request after the first has settled recomputes', async () => {
    const db = makeTestDb();
    seed(db);
    await getPayload(db);
    const afterFirst = givingScans(db);
    db._raw.exec(`INSERT INTO giving_entries (person_id,fund_id,amount,contribution_date) VALUES (3,1,500000,'${YEAR}-07-04')`);
    const d = await getPayload(db);
    expect(givingScans(db)).toBe(afterFirst + 2);
    expect(d.givingCents).toBe(250000 + 900000 + 60000 + 10000 + 500000);
  });

  it('keeps different years apart', async () => {
    const db = makeTestDb();
    seed(db);
    const [now, last] = await Promise.all([getPayload(db, YEAR), getPayload(db, YEAR - 1)]);
    expect(now.givingCents).toBe(250000 + 900000 + 60000 + 10000);
    expect(last.givingCents).toBe(50000);
  });
});

// ── The frontend, run out of the real served bundles ────────────────────────────────────────
function makeApp() {
  const calls = [];
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    encodeURIComponent, decodeURIComponent, URL, URLSearchParams, TextDecoder, TextEncoder,
    // api() is defined inside js-core.js, so it cannot be stubbed from the sandbox — fetch is
    // the real seam, and it is also the honest one: what this file measures is requests.
    fetch(path) {
      calls.push(path);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        entries: [], rows: [], overrides: {}, monthly: [], distributions: [], meta: {}, years: [],
        netIncome: { actualCents: 0, budgetCents: 0 },
        revenueStreams: { map: {}, streams: {}, totalCents: 0 },
      }) });
    },
    matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
    navigator: { userAgent: 'test', serviceWorker: { register: () => Promise.resolve() } },
    Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set, isNaN, isFinite, parseInt, parseFloat,
    _userRole: 'admin',
    calls,
    // Every screen renders into an element it looks up by id; hand back a fresh stub for any of
    // them so a render is exercised rather than short-circuited by a missing mount.
    document: {
      getElementById: () => ({ style: {}, set innerHTML(_v) {}, get innerHTML() { return ''; },
        textContent: '', value: '', classList: { add() {}, remove() {}, toggle() {} },
        querySelectorAll: () => [], appendChild() {}, addEventListener() {}, dataset: {} }),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      body: { classList: { add() {}, remove() {} } },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: '', search: '', href: '' },
    history: { pushState() {}, replaceState() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS + '\n' + CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS, ctx);
  return ctx;
}
const finCalls = (ctx) => ctx.calls.filter((p) => p.indexOf('/admin/api/finance/') === 0);
const thisYearCalls = (ctx) => ctx.calls.filter((p) => p.indexOf('church/this-year') !== -1);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the Finance tab loads only the section it is showing', () => {
  it('opening Financial Health does not fetch Balance Sheet, Budget or Daycare-rooms data', async () => {
    const ctx = makeApp();
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    const paths = finCalls(ctx);
    expect(paths.some((p) => p.indexOf('church/balances') !== -1)).toBe(false);
    expect(paths.some((p) => p.indexOf('planning/church') !== -1)).toBe(false);
    expect(paths.some((p) => p.indexOf('daycare/rooms') !== -1)).toBe(false);
  });

  it('fetches finance/church/this-year exactly once for the year, not once per screen', async () => {
    const ctx = makeApp();
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    expect(thisYearCalls(ctx).length).toBe(1);
  });

  it('Health, Church Report and Budget on the same year share that one request', async () => {
    const ctx = makeApp();
    const year = new Date().getFullYear();
    ctx._finPlanBaseYear = year;
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    ctx.finShowSection('church');
    ctx.finShowSection('planning');
    for (let i = 0; i < 12; i++) await flush();
    expect(thisYearCalls(ctx).filter((p) => p.indexOf('year=' + year) !== -1).length).toBe(1);
  });

  it('switching back to a section already open re-fetches nothing', async () => {
    const ctx = makeApp();
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    ctx.finShowSection('property');
    for (let i = 0; i < 12; i++) await flush();
    const before = finCalls(ctx).length;
    ctx.finShowSection('health');
    ctx.finShowSection('property');
    ctx.finShowSection('health');
    for (let i = 0; i < 12; i++) await flush();
    expect(finCalls(ctx).length).toBe(before);
  });

  it('re-entering the Finance tab does not re-run the whole bootstrap', async () => {
    const ctx = makeApp();
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    const before = finCalls(ctx).length;
    ctx.loadFinance();
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    expect(finCalls(ctx).length).toBe(before);
  });

  it('Financial Health still fetches the property payload it reads, whatever tab is open', async () => {
    const ctx = makeApp();
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    expect(finCalls(ctx).some((p) => p.indexOf('/finance/property/ivanhoe') !== -1)).toBe(true);
  });

  it('an import marks Health and Budget for reload rather than leaving them on stale figures', async () => {
    const ctx = makeApp();
    ctx._finActiveNavId = 'health';
    ctx.loadFinance();
    for (let i = 0; i < 12; i++) await flush();
    expect(ctx._finSectionLoaded.health).toBe(true);
    ctx.finRenderChurchReport();
    expect(ctx._finSectionLoaded.health).toBeUndefined();
    expect(ctx._finSectionLoaded.planning).toBeUndefined();
    expect(ctx._finHealthData).toBe(null);
    // Reopening Health rebuilds it from the payload the import's own refresh just fetched, so it
    // comes back with current figures and without a second request for the same year.
    const before = thisYearCalls(ctx).length;
    ctx.finShowSection('health');
    for (let i = 0; i < 12; i++) await flush();
    expect(ctx._finSectionLoaded.health).toBe(true);
    expect(ctx._finHealthData).not.toBe(null);
    expect(thisYearCalls(ctx).length).toBe(before);
  });
});
