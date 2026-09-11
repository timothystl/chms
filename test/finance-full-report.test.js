import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// Full Report — the user's own request, after the Budget print redesign: pick which of the
// module's own reports to include, then export the lot as one combined PDF. The app has no
// PDF-generation capability of its own, so this reuses the same mechanism every other print
// feature already relies on (build an off-screen printable document, hand it to the browser's
// own print dialog) rather than inventing a second one — see finFullReportPrint in js-finance.js.
//
// Budget, Financial Health, Church Report, Balance Sheet, and Commercial Property are wired into
// FIN_FULLREPORT_SECTIONS — the user's full original four-section scope, now complete.
// Compensation is deliberately excluded pending its own access-control pass (its "Print for
// Council" report exists specifically to redact figures for a council audience).

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function loadBundle(els) {
  const store = els || {};
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
    fetch: () => Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) }),
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
  return ctx;
}
function node(path, label, classification, actualCents, budgetCents) {
  return {
    path, label, classification, depth: 0,
    ownActualCents: actualCents, ownBudgetCents: budgetCents ?? null,
    totalActualCents: actualCents, totalBudgetCents: budgetCents || 0,
    hasBudgetInfo: budgetCents != null,
    children: [],
  };
}
function fixtureTree() {
  return [
    node('Income:40085 Sunday Offering', '40085 Sunday Offering', 'Income', 500000, 480000),
    node('Expenses:51010 Pastoral Salaries', '51010 Pastoral Salaries', 'Expenses', 800000, 800000),
  ];
}
function baseSetup(fin) {
  fin._finPlanBaseTree = fixtureTree();
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
  fin._finPlanBoardCats = { revenue: {}, expense: {}, revenueLabels: {}, expenseLabels: {}, donorWrapperLabel: '', accountLabels: {} };
  fin._userRole = 'admin';
}
function fullReportSetup(role) {
  const fullreportRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const printsheetRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const fin = loadBundle({ 'fin-fullreport-root': fullreportRoot, 'fin-fullreport-printsheet-root': printsheetRoot });
  baseSetup(fin);
  if (role) { fin._userRole = role; fin._perm = {}; }
  return { fin, fullreportRoot, printsheetRoot };
}

describe('Full Report — the picker', () => {
  it('an admin sees a Budget checkbox, checked by default', () => {
    const { fin, fullreportRoot } = fullReportSetup();
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('Budget (Summary, Revenue, Expenses)');
    expect(fullreportRoot.innerHTML).toContain('finFullReportToggle(&quot;budget&quot;,this.checked)');
    expect(fullreportRoot.innerHTML).toMatch(/<input type="checkbox" checked [^>]*finFullReportToggle\(&quot;budget&quot;/);
  });

  it('an admin also sees a Financial Health checkbox, checked by default', () => {
    const { fin, fullreportRoot } = fullReportSetup();
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('Financial Health (incl. money-flow diagram)');
    expect(fullreportRoot.innerHTML).toMatch(/<input type="checkbox" checked [^>]*finFullReportToggle\(&quot;health&quot;/);
  });

  it('an admin also sees a Church Report checkbox, checked by default', () => {
    const { fin, fullreportRoot } = fullReportSetup();
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('Church Report (incl. multi-year comparison)');
    expect(fullreportRoot.innerHTML).toMatch(/<input type="checkbox" checked [^>]*finFullReportToggle\(&quot;church&quot;/);
  });

  it('an admin also sees a Balance Sheet checkbox, checked by default', () => {
    const { fin, fullreportRoot } = fullReportSetup();
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('Balance Sheet (incl. multi-year trend)');
    expect(fullreportRoot.innerHTML).toMatch(/<input type="checkbox" checked [^>]*finFullReportToggle\(&quot;balance&quot;/);
  });

  it('an admin also sees a Commercial Property checkbox, checked by default', () => {
    const { fin, fullreportRoot } = fullReportSetup();
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('Commercial Property (3277 Ivanhoe)');
    expect(fullreportRoot.innerHTML).toMatch(/<input type="checkbox" checked [^>]*finFullReportToggle\(&quot;property&quot;/);
  });

  it('a role with plain "finance" access but no "budget" grant sees Financial Health, Church Report, Balance Sheet and Property but never the Budget checkbox — a picker can\'t be the only gate', () => {
    const { fin, fullreportRoot } = fullReportSetup('staff');
    fin._perm = { finance: 'view' };
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('finFullReportToggle(&quot;health&quot;,this.checked)');
    expect(fullreportRoot.innerHTML).toContain('finFullReportToggle(&quot;church&quot;,this.checked)');
    expect(fullreportRoot.innerHTML).toContain('finFullReportToggle(&quot;balance&quot;,this.checked)');
    expect(fullreportRoot.innerHTML).toContain('finFullReportToggle(&quot;property&quot;,this.checked)');
    expect(fullreportRoot.innerHTML).not.toContain('finFullReportToggle(&quot;budget&quot;,this.checked)');
  });

  it('a role with neither "finance" nor "budget" access sees no checkboxes at all', () => {
    const { fin, fullreportRoot } = fullReportSetup('staff');
    fin._perm = {};
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).not.toContain('finFullReportToggle');
    expect(fullreportRoot.innerHTML).toContain('No reports are available to include yet.');
  });

  it('a role that also holds "budget" access does see the checkbox', () => {
    const { fin, fullreportRoot } = fullReportSetup('staff');
    fin._perm = { finance: 'view', budget: 'view' };
    fin.finRenderFullReport();
    expect(fullreportRoot.innerHTML).toContain('finFullReportToggle');
  });

  it('finFullReportToggle flips the in-memory selection', () => {
    const { fin } = fullReportSetup();
    expect(fin._finFullReportSelected.budget).toBe(true);
    fin.finFullReportToggle('budget', false);
    expect(fin._finFullReportSelected.budget).toBe(false);
    fin.finFullReportToggle('budget', true);
    expect(fin._finFullReportSelected.budget).toBe(true);
  });
});

describe('Full Report — combined print', () => {
  it('prints nothing and toasts instead, when no section is selected', async () => {
    const { fin, printsheetRoot } = fullReportSetup();
    fin.finFullReportToggle('budget', false);
    fin.finFullReportToggle('health', false);
    fin.finFullReportToggle('church', false);
    fin.finFullReportToggle('balance', false);
    fin.finFullReportToggle('property', false);
    let toasted = '';
    fin.finToast = (m) => { toasted = m; };
    fin.finFullReportPrint();
    expect(toasted).toMatch(/choose at least one/i);
    expect(printsheetRoot.innerHTML).toBe('');
  });

  it('builds the combined document from just the Budget print sheet when only Budget is selected, marks body.printing-fullreport, and cleans up after printing', async () => {
    const { fin, printsheetRoot } = fullReportSetup();
    fin.finFullReportToggle('health', false);
    fin.finFullReportToggle('church', false);
    fin.finFullReportToggle('balance', false);
    fin.finFullReportToggle('property', false);
    const bodyClasses = [];
    fin.document.body.classList.add = (c) => bodyClasses.push(c);
    fin.document.body.classList.remove = (c) => { const i = bodyClasses.indexOf(c); if (i > -1) bodyClasses.splice(i, 1); };
    let printed = false;
    fin.print = () => { printed = true; };
    fin.finFullReportPrint();
    expect(printsheetRoot.innerHTML).toContain('fin-plan-rpt');
    expect(printsheetRoot.innerHTML).toContain('Pastoral Salaries');
    // The lone selected section is the FIRST one, so it must not carry the between-sections
    // break-before class — that's only for sections after the first.
    expect(printsheetRoot.innerHTML).toMatch(/<div class="fin-fullreport-section">/);
    expect(printsheetRoot.innerHTML).not.toContain('fin-fullreport-section-newpage');
    expect(bodyClasses).toEqual(['printing-fullreport']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(printed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bodyClasses).toEqual([]);
    expect(printsheetRoot.innerHTML).toBe('');
  }, 2000);

  it('combines Financial Health and Budget in registry order (Health first) when only those two are selected, with the break-before class only on the second section', async () => {
    const { fin, printsheetRoot } = fullReportSetup();
    fin.finFullReportToggle('church', false);
    fin.finFullReportToggle('balance', false);
    fin.finFullReportToggle('property', false);
    fin.finFullReportPrint();
    const html = printsheetRoot.innerHTML;
    expect(html).toContain('fin-health-rpt');
    expect(html).toContain('fin-plan-rpt');
    expect(html.indexOf('fin-health-rpt')).toBeLessThan(html.indexOf('fin-plan-rpt'));
    expect(html).toMatch(/<div class="fin-fullreport-section"><div class="fin-health-rpt">/);
    expect(html).toMatch(/<div class="fin-fullreport-section fin-fullreport-section-newpage"><div class="fin-plan-rpt">/);
  });

  it('combines all five sections in registry order (Health, Church, Balance, Property, Budget) when all are selected by default', async () => {
    const { fin, printsheetRoot } = fullReportSetup();
    fin.finFullReportPrint();
    const html = printsheetRoot.innerHTML;
    expect(html).toContain('fin-health-rpt');
    expect(html).toContain('fin-church-rpt');
    expect(html).toContain('fin-balance-rpt');
    expect(html).toContain('fin-property-rpt');
    expect(html).toContain('fin-plan-rpt-table');
    // Church Report's, Balance Sheet's and Property's own no-data fallbacks (there's no
    // _finChurchThisYearData/_finBalanceData/_finProperty in this fixture) reuse Budget's
    // .fin-plan-rpt-page/.fin-plan-rpt-p classes for consistency, so a bare "fin-plan-rpt"
    // substring search would find those fallbacks rather than Budget's real content —
    // "fin-plan-rpt-table" only ever appears inside Budget's own actual print sheet.
    expect(html.indexOf('fin-health-rpt')).toBeLessThan(html.indexOf('fin-church-rpt'));
    expect(html.indexOf('fin-church-rpt')).toBeLessThan(html.indexOf('fin-balance-rpt'));
    expect(html.indexOf('fin-balance-rpt')).toBeLessThan(html.indexOf('fin-property-rpt'));
    expect(html.indexOf('fin-property-rpt')).toBeLessThan(html.indexOf('fin-plan-rpt-table'));
    // Only the section after the first carries the break-before class at its own top level —
    // Church Report's own build() output already carries an INTERNAL .fin-plan-rpt-newpage on its
    // multi-year page, which is a separate concern from Full Report's own section-to-section break.
    expect(html).toMatch(/<div class="fin-fullreport-section"><div class="fin-health-rpt">/);
    expect(html).toMatch(/<div class="fin-fullreport-section fin-fullreport-section-newpage"><div class="fin-church-rpt">/);
    expect(html).toMatch(/<div class="fin-fullreport-section fin-fullreport-section-newpage"><div class="fin-balance-rpt">/);
    expect(html).toMatch(/<div class="fin-fullreport-section fin-fullreport-section-newpage"><div class="fin-property-rpt">/);
    expect(html).toMatch(/<div class="fin-fullreport-section fin-fullreport-section-newpage"><div class="fin-plan-rpt">/);
  });

  it('never includes a section the current role no longer has access to, even if it was checked earlier under a different role', () => {
    const { fin, printsheetRoot } = fullReportSetup();
    fin.finFullReportToggle('budget', true);
    fin.finFullReportToggle('health', false);
    fin.finFullReportToggle('church', false);
    fin.finFullReportToggle('balance', false);
    fin.finFullReportToggle('property', false);
    // Role/permissions can change between rendering the picker and clicking print (e.g. a stale
    // tab left open); finFullReportPrint re-checks permView itself rather than trusting whatever
    // was selected earlier under different access.
    fin._userRole = 'staff';
    fin._perm = { finance: 'view' };
    let toasted = '';
    fin.finToast = (m) => { toasted = m; };
    fin.finFullReportPrint();
    expect(toasted).toMatch(/choose at least one/i);
    expect(printsheetRoot.innerHTML).toBe('');
  });
});

// Same class of bug this app has hit twice already on the Budget print sheet: a rule reaching
// straight from the outer panel to the print-sheet root, skipping the intermediate mount node,
// silently hides the whole thing. Verified at the CSS-source level, same technique as the
// printing-plan tests this mirrors (finance-planning-print-empty.test.js).
describe('body.printing-fullreport CSS contract', () => {
  it('names both nesting levels explicitly: #fin-panel-fullreport > #fin-fullreport-root > #fin-fullreport-printsheet-root', () => {
    expect(HTML_HEAD).toMatch(/#fin-panel-fullreport\s*>\s*\*:not\(#fin-fullreport-root\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
    expect(HTML_HEAD).toMatch(/#fin-fullreport-root\s*>\s*\*:not\(#fin-fullreport-printsheet-root\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
    // The regression shape: skipping the intermediate #fin-fullreport-root level entirely.
    expect(HTML_HEAD).not.toMatch(/#fin-panel-fullreport\s*>\s*\*:not\(#fin-fullreport-printsheet-root\)/);
  });

  it('#fin-fullreport-printsheet-root is forced visible in print, and hidden on screen otherwise', () => {
    const printBlock = HTML_HEAD.match(/body\.printing-fullreport #fin-fullreport-printsheet-root\{([^}]*)\}/);
    expect(printBlock).toBeTruthy();
    expect(printBlock[1]).toMatch(/display:\s*block\s*!important/);
    expect(HTML_HEAD).toMatch(/\.fin-fullreport-printsheet-root\{display:none;\}/);
  });

  it('carries the same html,body/.app-shell print-layout resets every other report already relies on (they are not scoped per-feature, so this needs no new rule of its own)', () => {
    expect(HTML_HEAD).toMatch(/html,body\{height:auto!important;overflow:visible!important;\}/);
    expect(HTML_HEAD).toMatch(/\.app-shell,\.content-area\{display:block!important;height:auto!important;overflow:visible!important;\}/);
  });

  it('a between-section page break is a direct class on the element, not an adjacent-sibling rule — the pattern already proven NOT to paginate reliably in Chrome', () => {
    expect(HTML_HEAD).toMatch(/\.fin-fullreport-section-newpage\{break-before:page;page-break-before:always;\}/);
    expect(HTML_HEAD).not.toMatch(/\.fin-fullreport-section\s*\+\s*\.fin-fullreport-section/);
  });
});
