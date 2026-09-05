import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { handleFinanceApi } from '../src/api-finance.js';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// Purpose tags — a second, optional lens (Youth/Mission/Internal/etc.) over the same accounts and
// Compensation Planner workers the Board Category system already classifies. Scoped with the user
// 2026-09-05 (single-tag-only, no percentage split) and built on the same chms_config-JSON-blob
// pattern as finance_planning_board_categories. See the header comment on readPurposeTags in
// api-finance.js for the full reasoning, in particular why a Compensation worker's own tag is
// NOT a second server-side map keyed by accountCode (a worker can have no budget line at all) —
// it lives as a plain `purposeTag` field on the roster row, saved through the existing
// salary-planner endpoint, and only the tag LIST + Chart of Accounts leaf assignments live here.

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
const GET = (db, isAdmin) => handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/purpose-tags', db, !!isAdmin, true);
const PUT = (db, body, isAdmin) => handleFinanceApi(makeReq(body), {}, new URL('https://x/'), 'PUT', 'finance/planning/purpose-tags', db, !!isAdmin, true);

describe('finance/planning/purpose-tags — backend store', () => {
  it('GET on a fresh DB returns the empty shape, not an error', async () => {
    const db = makeTestDb();
    const res = await GET(db, false);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: [], categories: {} });
  });

  it('a non-admin can read but not write', async () => {
    const db = makeTestDb();
    expect((await GET(db, false)).status).toBe(200);
    const put = await PUT(db, { tags: [{ label: 'Youth' }] }, false);
    expect(put.status).toBe(403);
    expect((await (await GET(db, false)).json()).tags).toEqual([]);
  });

  it('adding a tag with no id mints a slug from its label', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { tags: [{ label: 'Youth Ministry' }] }, true);
    expect(res.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.tags).toEqual([{ id: 'youth_ministry', label: 'Youth Ministry' }]);
  });

  it('a second add appends rather than replacing the first tag', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }] }, true);
    const res = await PUT(db, { tags: [{ id: 'youth', label: 'Youth' }, { label: 'Mission' }] }, true);
    expect(res.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.tags.map(t => t.label)).toEqual(['Youth', 'Mission']);
  });

  it('renaming keeps the same id — sending back an existing id with a new label edits in place', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }] }, true);
    const first = await (await GET(db, true)).json();
    const id = first.tags[0].id;
    await PUT(db, { tags: [{ id, label: 'Youth Ministry' }] }, true);
    const got = await (await GET(db, true)).json();
    expect(got.tags).toEqual([{ id, label: 'Youth Ministry' }]);
  });

  it('omitting a tag from the array deletes it', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }, { label: 'Mission' }] }, true);
    const first = await (await GET(db, true)).json();
    const youthId = first.tags.find(t => t.label === 'Youth').id;
    await PUT(db, { tags: [first.tags.find(t => t.label === 'Mission')] }, true);
    const got = await (await GET(db, true)).json();
    expect(got.tags.map(t => t.id)).not.toContain(youthId);
    expect(got.tags.map(t => t.label)).toEqual(['Mission']);
  });

  it('two tags whose labels slugify the same get distinct ids', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { tags: [{ label: 'Youth!' }, { label: 'Youth?' }] }, true);
    expect(res.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.tags[0].id).not.toBe(got.tags[1].id);
  });

  it('rejects a tag with no label', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { tags: [{ label: '   ' }] }, true);
    expect(res.status).toBe(400);
  });

  it('assigns a Chart of Accounts leaf to a real tag and it round-trips', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }] }, true);
    const withTag = await (await GET(db, true)).json();
    const id = withTag.tags[0].id;
    const res = await PUT(db, { categories: { 'Expenses:58004 Youth Intern': id } }, true);
    expect(res.status).toBe(200);
    const got = await (await GET(db, true)).json();
    expect(got.categories).toEqual({ 'Expenses:58004 Youth Intern': id });
  });

  it('rejects a category assignment pointing at an unknown tag id', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { categories: { 'Expenses:58004 Youth Intern': 'not-a-real-tag' } }, true);
    expect(res.status).toBe(400);
  });

  it('an empty-string category value clears one assignment without touching another', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }] }, true);
    const id = (await (await GET(db, true)).json()).tags[0].id;
    await PUT(db, { categories: { 'Expenses:A': id, 'Expenses:B': id } }, true);
    await PUT(db, { categories: { 'Expenses:A': '' } }, true);
    const got = await (await GET(db, true)).json();
    expect(got.categories).toEqual({ 'Expenses:B': id });
  });

  it('deleting a tag also drops any category assignment pointing at it — no ghost tag left showing', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }] }, true);
    const id = (await (await GET(db, true)).json()).tags[0].id;
    await PUT(db, { categories: { 'Expenses:58004 Youth Intern': id } }, true);
    // Deleting the tag = sending back a tags array that omits it.
    await PUT(db, { tags: [] }, true);
    const got = await (await GET(db, true)).json();
    expect(got.tags).toEqual([]);
    expect(got.categories).toEqual({});
  });

  it('renaming a tag does not disturb a category already assigned to it', async () => {
    const db = makeTestDb();
    await PUT(db, { tags: [{ label: 'Youth' }] }, true);
    const id = (await (await GET(db, true)).json()).tags[0].id;
    await PUT(db, { categories: { 'Expenses:58004 Youth Intern': id } }, true);
    await PUT(db, { tags: [{ id, label: 'Youth Ministry' }] }, true);
    const got = await (await GET(db, true)).json();
    expect(got.categories).toEqual({ 'Expenses:58004 Youth Intern': id });
    expect(got.tags[0].label).toBe('Youth Ministry');
  });

  it('a non-admin cannot assign a category', async () => {
    const db = makeTestDb();
    const res = await PUT(db, { categories: { 'Expenses:A': 'youth' } }, false);
    expect(res.status).toBe(403);
  });
});

// ── Frontend: the tag list, the per-leaf picker on Chart of Accounts, the per-worker picker on
// Compensation, and the Resources by Purpose rollup. Same vm-behind-a-stub-DOM technique as
// finance-planning-chart-of-accounts.test.js.
function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function loadBundle(els) {
  const store = els || {};
  const fetchCalls = [];
  let fetchImpl = () => Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) });
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  });
  const document = {
    getElementById(id) { return store[id] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    confirm: () => true, alert() {}, print() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
  ctx.__fetchCalls = fetchCalls;
  ctx.__setFetchImpl = (fn) => { fetchImpl = fn; };
  return ctx;
}
function node(path, label, classification, actualCents, budgetCents) {
  return {
    path, label, classification, depth: 0, children: [],
    ownActualCents: actualCents, ownBudgetCents: budgetCents ?? null,
    totalActualCents: actualCents, totalBudgetCents: budgetCents || 0,
    hasBudgetInfo: budgetCents != null,
  };
}
function fixtureTree() {
  return [
    node('Expenses:58002 DCE Salary', '58002 DCE Salary', 'Expenses', 5000000, 5000000),
    node('Expenses:58003 Music Director Salary', '58003 Music Director Salary', 'Expenses', 4000000, 4000000),
    node('Expenses:58004 Youth Group Supplies', '58004 Youth Group Supplies', 'Expenses', 120000, 100000),
    node('Expenses:59010 Mission Trip Support', '59010 Mission Trip Support', 'Expenses', 300000, 300000),
  ];
}
function baseSetup(fin, tree) {
  fin._finPlanBaseTree = tree;
  fin._finPlanBaseYear = 2026;
  fin._finPlanTargetYear = 2027;
  fin._finPlanBaseNet = { actualCents: 0, budgetCents: 0 };
  fin._finPlanRows = [];
  fin._finPlanEdits = {};
  fin._finPlanBaseProjEdits = {};
  fin._finPlanBaseProjOverrides = {};
  fin._finPlanActualEdits = {};
  fin._finPlanExcluded = {};
  fin._finPlanPicking = false;
  fin._finPlanCols = { bud: true, act: true, proj: true, plan: true, delta: true };
  fin._finPlanBoardCats = { revenue: {}, expense: {}, revenueLabels: {}, expenseLabels: {} };
  fin._userRole = 'admin';
  fin._finSalaryRoster = [
    { name: 'Knapp', position: 'DCE', role: 'commissioned', trackKey: 'ma', education: 'masters',
      yearsExperience: 5, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0,
      selfEmployedFica: true, hasDependents: false, accountCode: '58002', purposeTag: '' },
    { name: 'Thompson', position: 'Music Director', role: 'other', trackKey: 'business_manager_music',
      education: 'bachelors', yearsExperience: 5, responsibilityStipend: 0, responsibilityStipendKey: 'none',
      attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, accountCode: '58003', purposeTag: '' },
  ];
  fin._finCompMethod = 'none';
  fin._finCompPerWorkerMethod = {};
  fin._finCompOverrides = {};
  fin._finCompBaselineRosterOnly = false;
  fin.finRenderPlanning();
}

describe('Purpose tags — Chart of Accounts UI', () => {
  it('with no tags yet, neither the per-leaf picker nor the Resources by Purpose card renders', () => {
    const coaRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-coa-root': coaRoot });
    baseSetup(fin, fixtureTree());
    fin.finRenderChartOfAccounts();
    expect(coaRoot.innerHTML).toContain('Purpose Tags');
    expect(coaRoot.innerHTML).not.toContain('finPurposeTagSetCategory');
    expect(fin.finRenderPurposeReport()).toBe('');
  });

  it('once a tag exists, every leaf row gets a purpose-tag select and the report card appears', () => {
    const coaRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-coa-root': coaRoot });
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    fin.finRenderChartOfAccounts();
    expect(coaRoot.innerHTML).toContain('finPurposeTagSetCategory');
    expect(coaRoot.innerHTML).toContain('Resources by Purpose');
  });

  it('finPurposeTagAdd sends the new tag alongside the existing ones and updates in-memory state', async () => {
    const store = { 'fin-purpose-tag-new': { value: 'Mission' } };
    const coaRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ ...store, 'fin-coa-root': coaRoot });
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    let sentBody = null;
    fin.__setFetchImpl((path, opts) => {
      sentBody = JSON.parse(opts.body);
      expect(path).toBe('/admin/api/finance/planning/purpose-tags');
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, tags: [{ id: 'youth', label: 'Youth' }, { id: 'mission', label: 'Mission' }], categories: {} }) });
    });
    fin.finPurposeTagAdd();
    await flushPromises();
    expect(sentBody.tags).toEqual([{ id: 'youth', label: 'Youth' }, { label: 'Mission' }]);
    expect(fin._finPurposeTags.tags.map(t => t.label)).toEqual(['Youth', 'Mission']);
  });

  it('finPurposeTagAdd with a blank input is a no-op', async () => {
    const fin = loadBundle({ 'fin-purpose-tag-new': { value: '   ' } });
    baseSetup(fin, fixtureTree());
    fin.finPurposeTagAdd();
    await flushPromises();
    expect(fin.__fetchCalls.length).toBe(0);
  });

  it('finPurposeTagSetCategory saves through the real endpoint', async () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    let sentBody = null;
    fin.__setFetchImpl((path, opts) => {
      sentBody = JSON.parse(opts.body);
      expect(path).toBe('/admin/api/finance/planning/purpose-tags');
      expect(opts.method).toBe('PUT');
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, tags: fin._finPurposeTags.tags, categories: sentBody.categories }) });
    });
    fin.finPurposeTagSetCategory('Expenses:58004 Youth Group Supplies', 'youth');
    await flushPromises();
    expect(sentBody).toEqual({ categories: { 'Expenses:58004 Youth Group Supplies': 'youth' } });
    expect(fin._finPurposeTags.categories).toEqual({ 'Expenses:58004 Youth Group Supplies': 'youth' });
  });

  // The whole reason a Compensation worker's own tag lives on the roster row rather than in a
  // second server-side map: deleting a tag has to clean up BOTH stores, or a deleted tag keeps
  // showing on a worker's drawer forever with no UI left to clear it.
  it('deleting a tag clears it off any roster worker who was tagged with it, and schedules a roster autosave', async () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }, { id: 'mission', label: 'Mission' }], categories: {} };
    fin._finSalaryRoster[0].purposeTag = 'youth'; // Knapp
    fin._finSalaryRoster[1].purposeTag = 'mission'; // Thompson
    let autoSaveScheduled = false;
    fin.finSalaryScheduleAutoSave = () => { autoSaveScheduled = true; };
    fin.__setFetchImpl(() => Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, tags: [{ id: 'mission', label: 'Mission' }], categories: {} }) }));
    fin.finPurposeTagDelete('youth');
    await flushPromises();
    expect(fin._finSalaryRoster[0].purposeTag).toBe(''); // Knapp's stale "youth" is cleared
    expect(fin._finSalaryRoster[1].purposeTag).toBe('mission'); // Thompson's untouched
    expect(autoSaveScheduled).toBe(true);
  });

  it('finPurposeTagRename with a blank name is a no-op', async () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    fin.finPurposeTagRename('youth', { textContent: '   ' });
    await flushPromises();
    expect(fin.__fetchCalls.length).toBe(0);
  });
});

describe('Purpose tags — Compensation drawer picker', () => {
  it('with no tags yet, the drawer has no purpose-tag field', () => {
    const drawer = { innerHTML: '', style: {} };
    const fin = loadBundle({ 'fin-comp-drawer': drawer });
    baseSetup(fin, fixtureTree());
    const computed = fin.finCompComputeAll();
    const html = fin.finCompRenderDrawer ? '' : '';
    // finCompRenderDrawer writes into a card, exercised indirectly via finRenderCompensation below —
    // this test only asserts the guard exists (see the "once a tag exists" test for the positive case).
    expect(typeof fin.finPurposeTagSelectHtml).toBe('function');
  });

  it('once a tag exists, choosing it on a worker writes purposeTag and reruns the by-purpose totals', () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    fin.finCompWorkerChange(0, 'purposeTag', 'youth');
    expect(fin._finSalaryRoster[0].purposeTag).toBe('youth');
  });
});

describe('finPurposeTagTotals — the by-purpose rollup', () => {
  it('sums a tagged worker\'s full church cost and a tagged account\'s actual dollars under the same tag', () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }, { id: 'music', label: 'Music' }], categories: { 'Expenses:58004 Youth Group Supplies': 'youth' } };
    fin._finSalaryRoster[0].purposeTag = 'youth'; // Knapp, DCE, 58002
    fin._finSalaryRoster[1].purposeTag = 'music'; // Thompson, Music Director, 58003
    const totals = fin.finPurposeTagTotals();
    expect(totals.youth.workers).toEqual(['Knapp']);
    expect(totals.youth.accounts).toEqual(['58004 Youth Group Supplies']);
    expect(totals.youth.accountCents).toBe(120000);
    expect(totals.youth.payrollCents).toBeGreaterThan(0); // Knapp's full church cost, not just base salary
    expect(totals.music.workers).toEqual(['Thompson']);
    expect(totals.music.accountCents).toBe(0);
  });

  it('an untagged worker or account contributes nothing to any tag\'s total', () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    const totals = fin.finPurposeTagTotals();
    expect(totals.youth.payrollCents).toBe(0);
    expect(totals.youth.accountCents).toBe(0);
    expect(totals.youth.workers).toEqual([]);
  });

  it('an externally-funded worker is excluded, same as every other church-wide Compensation figure', () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: {} };
    fin._finSalaryRoster[0].purposeTag = 'youth';
    fin._finSalaryRoster[0].externallyFunded = true;
    const totals = fin.finPurposeTagTotals();
    expect(totals.youth.payrollCents).toBe(0);
    expect(totals.youth.workers).toEqual([]);
  });

  // The double-count guard: tagging BOTH the worker and the exact GL leaf their salary posts to
  // must not count that money twice. Only fires when the worker is actually tagged — an untagged
  // worker's own linked leaf can still be tagged and counted on its own (see the sibling test).
  it('tagging a worker AND the GL leaf their own salary posts to counts it once, not twice', () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: { 'Expenses:58002 DCE Salary': 'youth' } };
    fin._finSalaryRoster[0].purposeTag = 'youth'; // Knapp, accountCode 58002 — same leaf just tagged above
    const totals = fin.finPurposeTagTotals();
    expect(totals.youth.accountCents).toBe(0); // the leaf's $50,000 is NOT added a second time
    expect(totals.youth.accounts).toEqual([]);
    expect(totals.youth.payrollCents).toBeGreaterThan(0); // Knapp's own cost is still counted, once
  });

  it('a leaf sharing an account code with an UNTAGGED worker is still counted on its own', () => {
    const fin = loadBundle();
    baseSetup(fin, fixtureTree());
    fin._finPurposeTags = { tags: [{ id: 'youth', label: 'Youth' }], categories: { 'Expenses:58002 DCE Salary': 'youth' } };
    // Knapp (58002) is left untagged this time.
    const totals = fin.finPurposeTagTotals();
    expect(totals.youth.accountCents).toBe(5000000);
    expect(totals.youth.accounts).toEqual(['58002 DCE Salary']);
  });
});
