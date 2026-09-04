import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// Budget Planning redesign, from design_handoff_budget_planning_categorization: a "Board view" /
// "QuickBooks order" toggle on the Planning table (Board view groups both revenue AND expenses by
// the new Chart of Accounts categories — a new capability for expenses, which had zero
// categorization before), column show/hide, "Choose rows" exclusion (always reflected in totals,
// whether or not picking is currently open), CSV export of exactly what's on screen, print, a
// per-leaf category picker on Planning itself, and the standalone Chart of Accounts page.
//
// Same vm-behind-a-stub-DOM technique as finance-qb-order.test.js — these renderers touch the DOM
// and call api()/fetch for the Chart of Accounts saves.
//
// api()'s own promise chain (fetch -> .then(r => r.json().then(...)) -> the caller's .then) is
// several microtask hops deep, so a fixed count of `await Promise.resolve()` is fragile — a
// setTimeout(...,0) macrotask boundary always fires after every pending microtask has drained
// (Node's microtask queue is shared across vm contexts), regardless of exactly how many hops the
// real chain turns out to be.
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
    confirm: () => true, alert() {}, print() {}, // finPlanPrint()'s deferred window.print() call
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

function node(path, label, classification, depth, actualCents, budgetCents, children) {
  const kids = children || [];
  const totalActual = kids.length ? kids.reduce((s, c) => s + c.totalActualCents, 0) : actualCents;
  const totalBudget = kids.length ? kids.reduce((s, c) => s + c.totalBudgetCents, 0) : (budgetCents || 0);
  return {
    path, label, classification, depth,
    ownActualCents: kids.length ? 0 : actualCents, ownBudgetCents: kids.length ? null : (budgetCents ?? null),
    totalActualCents: totalActual, totalBudgetCents: totalBudget,
    hasBudgetInfo: kids.length ? kids.some(c => c.hasBudgetInfo) : budgetCents != null,
    children: kids,
  };
}

// A flat QB-order tree — one root per real leaf, no intermediate groups — so board-tree bucketing
// is exercised straight off the regex/override rules rather than through a QuickBooks hierarchy
// that isn't the thing under test here.
function fixtureTree() {
  return [
    node('Income:40085 Sunday Offering', '40085 Sunday Offering', 'Income', 0, 5000000, 4800000), // -> donor (regex)
    node('Income:42010 Endowment Draw', '42010 Endowment Draw', 'Income', 0, 1200000, 1200000), // -> passive (regex)
    node('Income:44025 Facility Rental', '44025 Facility Rental', 'Income', 0, 300000, 250000), // -> earned (regex)
    node('Income:48001 Altar Guild', '48001 Altar Guild', 'Income', 0, 90000, 90000), // -> restricted (regex)
    node('Income:49999 Something Else', '49999 Something Else', 'Income', 0, 15000, 0), // matches nothing -> earned (default)
    node('Expenses:51010 Pastoral Salaries', '51010 Pastoral Salaries', 'Expenses', 0, 8000000, 8000000), // -> salaries
    node('Expenses:52010 Utilities', '52010 Utilities', 'Expenses', 0, 400000, 420000), // -> property
    node('Expenses:53010 Lutheran High Support', '53010 Lutheran High Support', 'Expenses', 0, 200000, 200000), // -> education
    node('Expenses:57160 MDO - Supplies', '57160 MDO - Supplies', 'Expenses', 0, 176414, 150000), // -> mdo
    node('Expenses:54010 Worship & Music', '54010 Worship & Music', 'Expenses', 0, 90000, 90000), // -> worship
    node('Expenses:58200 District & Synod Support', '58200 District & Synod Support', 'Expenses', 0, 60000, 60000), // -> district_synod
    node('Expenses:59999 Something Else Exp', '59999 Something Else Exp', 'Expenses', 0, 5000, 0), // matches nothing -> programs (default)
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
  fin.finRenderPlanning();
}

const rowsOf = (html) => html.split('<tr').slice(1).map(r => '<tr' + r);
const textOf = (row) => row.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

describe('finBuildBoardTree — regrouping the SAME leaves by Chart of Accounts category', () => {
  it('buckets every revenue leaf by its regex default when nothing is overridden', () => {
    const fin = loadBundle();
    const out = fin.finBuildBoardTree(fixtureTree());
    const labels = [];
    (function walk(ns) { ns.forEach(n => { labels.push(n.label); walk(n.children); }); })(out);
    // Donor Income wraps donor + restricted
    expect(labels).toContain('Donor Income');
    expect(labels).toContain('Unrestricted Gifts');
    expect(labels).toContain('Restricted Gifts');
    expect(labels).toContain('Earned Income');
    expect(labels).toContain('Passive Income');
    expect(labels).toContain('40085 Sunday Offering');
    expect(labels).toContain('48001 Altar Guild');
  });

  it('an unmatched revenue account defaults to Earned Income, never Unrestricted Gifts — overstating donor revenue overstates board leverage', () => {
    const fin = loadBundle();
    const out = fin.finBuildBoardTree(fixtureTree());
    const earnedGroup = out.find(n => n.label === 'Revenue').children.find(n => n.label === 'Earned Income');
    const earnedLabels = earnedGroup.children.map(n => n.label);
    expect(earnedLabels).toContain('49999 Something Else');
    expect(earnedLabels).toContain('44025 Facility Rental');
  });

  it('an unmatched expense account defaults to Programs', () => {
    const fin = loadBundle();
    const out = fin.finBuildBoardTree(fixtureTree());
    const programsGroup = out.find(n => n.label === 'Expenses').children.find(n => n.label === 'Programs');
    expect(programsGroup.children.map(n => n.label)).toContain('59999 Something Else Exp');
  });

  // Worship & Music and District & Synod Support are their own peer board categories, added
  // 2026-09-04 at the user's request after they reported "we lost" these — they used to be visible
  // headings under QuickBooks-order view but the flattened Board view (now the default) swept them
  // both into an undifferentiated "Programs" bucket with no heading of their own.
  it('Worship & Music and District & Synod Support are their own board categories, not folded into Programs', () => {
    const fin = loadBundle();
    const out = fin.finBuildBoardTree(fixtureTree());
    const expChildren = out.find(n => n.label === 'Expenses').children;
    const worshipGroup = expChildren.find(n => n.label === 'Worship & Music');
    const districtGroup = expChildren.find(n => n.label === 'District & Synod Support');
    expect(worshipGroup).toBeTruthy();
    expect(worshipGroup.children.map(n => n.label)).toContain('54010 Worship & Music');
    expect(districtGroup).toBeTruthy();
    expect(districtGroup.children.map(n => n.label)).toContain('58200 District & Synod Support');
    // Programs no longer catches either — only the genuinely-unmatched leaf still falls there.
    const programsGroup = expChildren.find(n => n.label === 'Programs');
    expect(programsGroup.children.map(n => n.label)).not.toContain('54010 Worship & Music');
    expect(programsGroup.children.map(n => n.label)).not.toContain('58200 District & Synod Support');
  });

  it('a saved override in _finPlanBoardCats wins over the regex default', () => {
    const fin = loadBundle();
    fin._finPlanBoardCats = { revenue: { 'Income:49999 Something Else': 'passive' }, expense: {}, revenueLabels: {}, expenseLabels: {} };
    const out = fin.finBuildBoardTree(fixtureTree());
    const passiveGroup = out.find(n => n.label === 'Revenue').children.find(n => n.label === 'Passive Income');
    expect(passiveGroup.children.map(n => n.label)).toContain('49999 Something Else');
    const earnedGroup = out.find(n => n.label === 'Revenue').children.find(n => n.label === 'Earned Income');
    expect(earnedGroup.children.map(n => n.label)).not.toContain('49999 Something Else');
  });

  it('group/root totals recompute bottom-up after regrouping — a Board-view total is never a stale QB-order figure', () => {
    const fin = loadBundle();
    const out = fin.finBuildBoardTree(fixtureTree());
    const revenueRoot = out.find(n => n.label === 'Revenue');
    const wantRevenue = 5000000 + 1200000 + 300000 + 90000 + 15000;
    expect(revenueRoot.totalActualCents).toBe(wantRevenue);
    const expenseRoot = out.find(n => n.label === 'Expenses');
    const wantExpense = 8000000 + 400000 + 200000 + 176414 + 90000 + 60000 + 5000;
    expect(expenseRoot.totalActualCents).toBe(wantExpense);
  });

  it('a custom category label (finBoardLabelFor) shows in place of the default in the tree', () => {
    const fin = loadBundle();
    fin._finPlanBoardCats = { revenue: {}, expense: {}, revenueLabels: { donor: 'Sunday & General Giving' }, expenseLabels: {} };
    const out = fin.finBuildBoardTree(fixtureTree());
    const donorWrapper = out.find(n => n.label === 'Revenue').children.find(n => n.label === 'Donor Income');
    expect(donorWrapper.children.map(n => n.label)).toContain('Sunday & General Giving');
    expect(donorWrapper.children.map(n => n.label)).not.toContain('Unrestricted Gifts');
  });
});

describe('Planning table — Board view / QuickBooks order toggle', () => {
  it('defaults to Board view and groups revenue+expenses by Chart of Accounts categories', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    expect(fin._finPlanViewMode).toBe('board');
    fin.finRenderPlanning();
    expect(root.innerHTML).toContain('Unrestricted Gifts');
    expect(root.innerHTML).toContain('Salaries &amp; Benefits');
  });

  it('finPlanSetView(\'qb\') switches to the raw QuickBooks-order tree, with no board category groups', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    expect(fin._finPlanViewMode).toBe('qb');
    expect(root.innerHTML).not.toContain('Unrestricted Gifts');
    expect(root.innerHTML).toContain('40085 Sunday Offering');
  });

  it('finPlanSetView back to \'board\' restores the category grouping', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    fin.finPlanSetView('board');
    expect(root.innerHTML).toContain('Unrestricted Gifts');
  });

  // No per-leaf category picker on Planning any more — reassigning an account is Chart of
  // Accounts' job alone now (finPlanSetBoardCategory still exists, and is still called, but only
  // from finCoaBuildCard's own <select> — see the "Chart of Accounts page" describe block below).
  it('an admin sees NO per-leaf category picker on a Board-view account row any more', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    const account = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('48001 Altar Guild'));
    expect(account).not.toContain('finPlanSetBoardCategory');
    expect(root.innerHTML).not.toContain('finPlanSetBoardCategory');
  });

  // The category headings themselves ("Unrestricted Gifts", etc.) and the "Donor Income" wrapper
  // ARE editable right here, admin-only — same rename controls Chart of Accounts offers, same
  // store, so a rename made from either screen shows up on both.
  it('an admin sees an editable "Unrestricted Gifts" category heading in Board view', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    const header = rowsOf(root.innerHTML).find(r => textOf(r) === 'Unrestricted Gifts');
    expect(header).toContain('contenteditable="true"');
    expect(header).toContain('finCoaRename(true,&quot;donor&quot;,this)');
  });

  it('an admin sees an editable "Donor Income" wrapper heading in Board view', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    const header = rowsOf(root.innerHTML).find(r => textOf(r) === 'Donor Income');
    expect(header).toContain('contenteditable="true"');
    expect(header).toContain('finCoaRenameWrapper(this)');
  });

  it('an admin sees an editable expense category heading too, tagged as expense (isRev=false)', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    const header = rowsOf(root.innerHTML).find(r => r.includes('Salaries &amp; Benefits'));
    expect(header).toContain('finCoaRename(false,&quot;salaries&quot;,this)');
  });

  it('a non-admin sees no editable headings at all — no picker, no contenteditable', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._userRole = 'staff';
    fin.finRenderPlanning();
    expect(root.innerHTML).not.toContain('finPlanSetBoardCategory');
    expect(root.innerHTML).not.toContain('contenteditable');
    const header = rowsOf(root.innerHTML).find(r => textOf(r) === 'Unrestricted Gifts');
    expect(header).toBeTruthy(); // the heading itself still renders, just as plain text
  });

  it('QuickBooks-order view group headers are never editable, even for an admin — there is no board category to rename there', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    expect(root.innerHTML).not.toContain('contenteditable');
  });

  it('a custom donorWrapperLabel from Chart of Accounts shows on the Budget tab\'s wrapper heading too', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._finPlanBoardCats.donorWrapperLabel = 'Giving';
    fin.finRenderPlanning();
    expect(root.innerHTML).not.toContain('Donor Income');
    const header = rowsOf(root.innerHTML).find(r => textOf(r) === 'Giving');
    expect(header).toContain('finCoaRenameWrapper(this)');
  });
});

describe('Planning table — column show/hide', () => {
  it('every column shows by default', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    expect(root.innerHTML).toContain('FY2026 Bud');
    expect(root.innerHTML).toContain('FY2026 Actual');
    expect(root.innerHTML).toContain('FY2026 Projected');
    expect(root.innerHTML).toContain('FY2027 Plan');
  });

  it('finPlanToggleCol hides that column\'s <th>/<td>s, but keeps its own toggle chip visible (struck through, not removed)', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    const before = fin._finPlanCsvRows[0].length;
    fin.finPlanToggleCol('bud');
    expect(fin._finPlanCols.bud).toBe(false);
    // The table header cell is gone...
    expect(root.innerHTML).not.toContain('<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">FY2026 Bud</th>');
    // ...but the chip that turns it back on is still there, so the column can be un-hidden again.
    expect(root.innerHTML).toContain('finPlanToggleCol(\'bud\')');
    expect(root.innerHTML).toContain('text-decoration:line-through');
    expect(root.innerHTML).toContain('FY2026 Actual'); // untouched sibling column's header still renders
    expect(fin._finPlanCsvRows[0].length).toBe(before - 1);
  });

  it('toggling the same column twice restores it', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanToggleCol('delta');
    fin.finPlanToggleCol('delta');
    expect(fin._finPlanCols.delta).toBe(true);
    expect(root.innerHTML).toContain('&Delta;%');
  });
});

describe('Planning table — "Choose rows" exclusion', () => {
  it('an excluded leaf is dropped from Total Revenue and Net, whether or not picking is currently open', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    fin.finPlanToggleExcluded('Income:40085 Sunday Offering');
    expect(fin._finPlanExcluded['Income:40085 Sunday Offering']).toBe(true);
    // Not picking — the excluded row is gone entirely, and the total reflects its removal.
    const revenueTotal = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('Total Revenue'));
    expect(revenueTotal).not.toBeUndefined();
    expect(rowsOf(root.innerHTML).some(r => textOf(r).startsWith('40085 Sunday Offering'))).toBe(false);
    // Now open picking — the row reappears (so it can be put back), but the total is UNCHANGED —
    // it never re-includes an excluded leaf just because picking is open.
    fin.finPlanTogglePicking();
    expect(rowsOf(root.innerHTML).some(r => textOf(r).startsWith('40085 Sunday Offering'))).toBe(true);
    const revenueTotalWhilePicking = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('Total Revenue'));
    expect(textOf(revenueTotalWhilePicking)).toBe(textOf(revenueTotal));
  });

  it('a leaf still visible during picking (because excluded) shows its OWN real value, not zero', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    fin.finPlanToggleExcluded('Income:40085 Sunday Offering');
    fin.finPlanTogglePicking();
    const row = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('40085 Sunday Offering'));
    // Admin role, so the Actual cell is an editable input seeded with its own real dollar figure
    // (5000000 cents -> "50000") — not blanked to "0" just because the row is excluded.
    expect(row).toContain('value="50000"');
  });

  it('finPlanResetExcluded clears every exclusion and the total is restored', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    const before = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('Total Revenue'));
    fin.finPlanToggleExcluded('Income:40085 Sunday Offering');
    fin.finPlanResetExcluded();
    expect(fin._finPlanExcluded).toEqual({});
    const after = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('Total Revenue'));
    expect(textOf(after)).toBe(textOf(before));
  });
});

describe('Planning table — Export CSV', () => {
  it('finPlanExportCsv is a no-op with a toast when there is nothing to export', () => {
    const fin = loadBundle();
    fin._finPlanCsvRows = [];
    let toasted = '';
    fin.finToast = (m) => { toasted = m; };
    fin.finPlanExportCsv();
    expect(toasted).toMatch(/nothing/i);
  });

  it('the CSV rows reflect the exact column set and row exclusion currently on screen', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin.finPlanSetView('qb');
    fin.finPlanToggleCol('delta');
    fin.finPlanToggleExcluded('Income:40085 Sunday Offering');
    const rows = fin._finPlanCsvRows;
    expect(rows.some(r => r[0] === '40085 Sunday Offering')).toBe(false);
    // label + Bud + Actual + Projected + Plan = 5 columns; Δ% was toggled off above, so every row
    // is 5 long, not 6 — a hidden column disappears from the export, not just the on-screen table.
    expect(rows[0].length).toBe(5);
  });
});

describe('Chart of Accounts page', () => {
  // Deliberately no 'fin-plan-root' mounted — Chart of Accounts has to render fine on its own,
  // whether or not the Planning table happens to be the panel currently in the DOM.
  function coaSetup() {
    const coaRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-coa-root': coaRoot });
    baseSetup(fin, fixtureTree());
    return { fin, coaRoot };
  }

  it('renders a Revenue card and an Expenses card, each with every real leaf under some category', () => {
    const { fin, coaRoot } = coaSetup();
    fin.finRenderChartOfAccounts();
    expect(coaRoot.innerHTML).toContain('Revenue');
    expect(coaRoot.innerHTML).toContain('Expenses');
    expect(coaRoot.innerHTML).toContain('48001 Altar Guild');
    expect(coaRoot.innerHTML).toContain('57160 MDO - Supplies');
  });

  it('a category with no accounts yet shows the empty-state line, not a blank section', () => {
    const { fin, coaRoot } = coaSetup();
    // Fixture has no restricted EXPENSE... wait, expenses have no "restricted"-shaped category; use
    // a revenue category guaranteed empty in the fixture instead — none of the fixture's revenue
    // leaves match /passive|endowment|investment|interest|dividend|ivanhoe|bequest|trust/ EXCEPT
    // Endowment Draw, so passive is not empty. Use a fixture with only donor+earned to leave
    // restricted/passive genuinely empty.
    fin._finPlanBaseTree = [
      node('Income:40085 Sunday Offering', '40085 Sunday Offering', 'Income', 0, 100, 100),
    ];
    fin.finRenderChartOfAccounts();
    expect(coaRoot.innerHTML).toContain('No accounts read under this category yet.');
  });

  it('finCoaToggleOne selects an account and shows the bulk "Move to" bar for its own card only', () => {
    const { fin, coaRoot } = coaSetup();
    fin.finCoaToggleOne('Income:48001 Altar Guild');
    expect(fin._finCoaSelected['Income:48001 Altar Guild']).toBe(true);
    expect(coaRoot.innerHTML).toContain('1 account selected');
    expect(coaRoot.innerHTML).toContain('Move to');
  });

  it('finCoaToggleGroup selects every account in one category at once, and can deselect them all again', () => {
    const { fin, coaRoot } = coaSetup();
    const donorCodes = ['Income:40085 Sunday Offering'];
    fin.finCoaToggleGroup(donorCodes, true);
    expect(fin._finCoaSelected['Income:40085 Sunday Offering']).toBe(true);
    fin.finCoaToggleGroup(donorCodes, false);
    expect(fin._finCoaSelected['Income:40085 Sunday Offering']).toBeUndefined();
  });

  it('finPlanSetBoardCategory saves through the real PUT endpoint and updates the in-memory board categories', async () => {
    const { fin } = coaSetup();
    let sentBody = null;
    fin.__setFetchImpl((path, opts) => {
      sentBody = JSON.parse(opts.body);
      expect(path).toBe('/admin/api/finance/planning/board-categories');
      expect(opts.method).toBe('PUT');
      return Promise.resolve({
        status: 200, ok: true,
        json: async () => ({ ok: true, revenue: sentBody.revenue, expense: {}, revenueLabels: {}, expenseLabels: {} }),
      });
    });
    fin.finPlanSetBoardCategory('Income:48001 Altar Guild', true, 'passive');
    await flushPromises();
    expect(sentBody).toEqual({ revenue: { 'Income:48001 Altar Guild': 'passive' } });
    expect(fin._finPlanBoardCats.revenue['Income:48001 Altar Guild']).toBe('passive');
  });

  it('finPlanSetBoardCategory does nothing on an empty value — a stray call can never wipe a category', async () => {
    const { fin } = coaSetup();
    fin.finPlanSetBoardCategory('Income:48001 Altar Guild', true, '');
    await flushPromises();
    expect(fin.__fetchCalls.length).toBe(0);
  });

  it('finCoaBulkMove reassigns every selected account and clears the selection', async () => {
    const { fin } = coaSetup();
    let sentBody = null;
    fin.__setFetchImpl((path, opts) => {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, revenue: sentBody.revenue, expense: {}, revenueLabels: {}, expenseLabels: {} }) });
    });
    fin.finCoaToggleOne('Income:40085 Sunday Offering');
    fin.finCoaToggleOne('Income:48001 Altar Guild');
    fin.finCoaBulkMove(['Income:40085 Sunday Offering', 'Income:48001 Altar Guild'], true, 'passive');
    await flushPromises();
    expect(sentBody.revenue).toEqual({ 'Income:40085 Sunday Offering': 'passive', 'Income:48001 Altar Guild': 'passive' });
    expect(fin._finCoaSelected['Income:40085 Sunday Offering']).toBeFalsy();
    expect(fin._finCoaSelected['Income:48001 Altar Guild']).toBeFalsy();
  });

  it('finCoaBulkMove with no value and finCoaBulkMove with no codes are both no-ops', async () => {
    const { fin } = coaSetup();
    fin.finCoaBulkMove(['Income:40085 Sunday Offering'], true, '');
    fin.finCoaBulkMove([], true, 'passive');
    await flushPromises();
    expect(fin.__fetchCalls.length).toBe(0);
  });

  it('finCoaRename trims/collapses whitespace and saves a custom category label', async () => {
    const { fin } = coaSetup();
    let sentBody = null;
    fin.__setFetchImpl((path, opts) => {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, revenue: {}, expense: {}, revenueLabels: sentBody.revenueLabels, expenseLabels: {} }) });
    });
    fin.finCoaRename(true, 'donor', { textContent: '  Sunday  &  General  Giving  ' });
    await flushPromises();
    expect(sentBody.revenueLabels).toEqual({ donor: 'Sunday & General Giving' });
    expect(fin._finPlanBoardCats.revenueLabels.donor).toBe('Sunday & General Giving');
  });

  it('finCoaRename with a blank name is a no-op, not a save of an empty string', async () => {
    const { fin } = coaSetup();
    fin.finCoaRename(true, 'donor', { textContent: '   ' });
    await flushPromises();
    expect(fin.__fetchCalls.length).toBe(0);
  });

  it('the footer states plainly that nothing here touches QuickBooks', () => {
    const { fin, coaRoot } = coaSetup();
    fin.finRenderChartOfAccounts();
    expect(coaRoot.innerHTML).toMatch(/QuickBooks/);
  });
});

describe('Planning table — Print', () => {
  it('finPlanPrint marks body.printing-plan before the print dialog fires — the same body.printing-<feature> contract as .printing-comp/.printing-board', () => {
    const fin = loadBundle();
    const added = [];
    fin.document.body.classList.add = (c) => added.push(c);
    fin.finPlanPrint();
    expect(added).toEqual(['printing-plan']);
  });
});
