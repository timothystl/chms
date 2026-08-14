import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';
import { classifyRevenueStream, computeRevenueStreams } from '../src/api-finance.js';

// Three things reported together off the Planning tab, all about how the budget tree reads.
//
// 1. Every group printed its figures on a HEADER above its accounts. QuickBooks prints them
//    underneath as a computed "Total X", which is what the church reads the budget against.
// 2. "48001 Altar Guild" sat under Passive Income; it is a restricted gift.
// 3. "Unapplied Cash Bill Payment Expense" — a QuickBooks artifact nobody at the church chose —
//    was taking up a line.
//
// The renderers touch the DOM, so this loads the whole SHIPPED bundle into a vm behind a stub
// DOM (the finance-property-proforma technique). BOTH bundles: the renderers call esc(), which
// lives in core.
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
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
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

// Two levels of nesting, which is what the real chart of accounts has and what the old renderer
// got wrong: only the ROOT total had been moved beneath its accounts (FIN20); every group inside
// it still printed a header carrying the sum.
function sampleTree() {
  const sunday = node('Income:40 Donor:40085 Sunday Offering', '40085 Sunday Offering', 'Income', 2, 22671104, 42500000);
  const donor = node('Income:40 Donor', '40 Donor Income', 'Income', 1, 0, null, [sunday]);
  const revenue = node('Income', 'Revenue', 'Income', 0, 0, null, [donor]);
  const mdo = node('Expenses:57 MDO:57160 Supplies', '57160 MDO Supplies', 'Expenses', 2, 120000, 130000);
  const mdoGroup = node('Expenses:57 MDO', '57 MDO Expenses', 'Expenses', 1, 0, null, [mdo]);
  const expenses = node('Expenses', 'Expenses', 'Expenses', 0, 0, null, [mdoGroup]);
  return [revenue, expenses];
}

const rowsOf = (html) => html.split('<tr').slice(1).map(r => '<tr' + r);
const textOf = (row) => row.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

describe('Church Report detail table — QuickBooks order', () => {
  const fin = loadBundle();

  it('puts every group total UNDER its accounts, at every level, not only the root', () => {
    const html = fin.finRenderChurchDetailBody(sampleTree(), null, true);
    const order = rowsOf(html).map(textOf).map(t => t.split(' $')[0].trim());
    expect(order).toEqual([
      'Revenue',
      '40 Donor Income',
      '40085 Sunday Offering',
      'Total 40 Donor Income',
      'Total Revenue',
      'Expenses',
      '57 MDO Expenses',
      '57160 MDO Supplies',
      'Total 57 MDO Expenses',
      'Total Expenses',
    ]);
  });

  it('leaves the group header row empty of figures, so no number is printed twice', () => {
    const html = fin.finRenderChurchDetailBody(sampleTree(), null, true);
    const header = rowsOf(html).find(r => textOf(r) === '40 Donor Income');
    expect(header, 'the group header row').toBeTruthy();
    expect(header).not.toContain('$');
    // ...and the figure it used to carry is on the Total row beneath the account.
    const total = rowsOf(html).find(r => textOf(r).startsWith('Total 40 Donor Income'));
    expect(total).toContain('226,711.04');
  });

  it('still reconciles: each total equals the accounts printed above it', () => {
    const html = fin.finRenderChurchDetailBody(sampleTree(), null, true);
    const total = rowsOf(html).find(r => textOf(r).startsWith('Total Revenue'));
    expect(total).toContain('226,711.04');
    expect(total).toContain('425,000.00');
  });
});

describe('Planning budget builder — QuickBooks order', () => {
  function renderPlanning(tree) {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    fin._finPlanBaseTree = tree;
    fin._finPlanBaseYear = 2026;
    fin._finPlanTargetYear = 2027;
    fin._finPlanBaseNet = { actualCents: 0, budgetCents: 0 };
    fin._finPlanRows = [];
    fin._finPlanEdits = {};
    fin._finPlanBaseProjEdits = {};
    fin._finPlanBaseProjOverrides = {};
    fin._userRole = 'admin';
    fin.finRenderPlanning();
    return root.innerHTML;
  }

  it('prints each group total beneath its own accounts', () => {
    const html = renderPlanning(sampleTree());
    const labels = rowsOf(html).map(textOf).map(t => t.split(' $')[0].split(' —')[0].trim());
    const iAccount = labels.indexOf('40085 Sunday Offering');
    const iGroupTotal = labels.indexOf('Total 40 Donor Income');
    const iHeader = labels.indexOf('40 Donor Income');
    expect(iHeader).toBeGreaterThan(-1);
    expect(iAccount).toBeGreaterThan(iHeader);
    expect(iGroupTotal).toBeGreaterThan(iAccount);
  });

  it('never prints "Total Revenue" twice when Revenue is the only revenue root', () => {
    // The root now carries its own total, so the old section subtotal row would be the same
    // figure again on the very next line.
    const html = renderPlanning(sampleTree());
    const totals = rowsOf(html).map(textOf).filter(t => t.startsWith('Total Revenue'));
    expect(totals).toHaveLength(1);
  });

  it('still prints the section subtotal when a section has more than one root', () => {
    const tree = sampleTree();
    const other = node('Other Income:48 Other:48001 Altar Guild', '48001 Altar Guild', 'Other Income', 2, 100000, 100000);
    const otherGroup = node('Other Income:48 Other', '48 Other Income', 'Other Income', 1, 0, null, [other]);
    tree.splice(1, 0, node('Other Income', 'Other Revenue', 'Other Income', 0, 0, null, [otherGroup]));
    const html = renderPlanning(tree);
    const labels = rowsOf(html).map(textOf);
    expect(labels.some(t => t.startsWith('Total Other Revenue')), 'the second root still totals itself').toBe(true);
    expect(labels.some(t => t.startsWith('Total Revenue')), 'and the section aggregate is still needed').toBe(true);
  });

  it('offers no editable figure on a group row — a group is always the sum of its accounts', () => {
    const html = renderPlanning(sampleTree());
    const groupRows = rowsOf(html).filter(r => {
      const t = textOf(r);
      return t.startsWith('40 Donor Income') || t.startsWith('Total 40 Donor Income');
    });
    expect(groupRows).toHaveLength(2);
    for (const r of groupRows) expect(r).not.toContain('<input');
    // The account line beneath it is the one that takes a figure.
    const account = rowsOf(html).find(r => textOf(r).startsWith('40085 Sunday Offering'));
    expect(account).toContain('<input');
  });
});

describe('Unapplied Cash — a QuickBooks artifact, hidden only when it is empty', () => {
  const fin = loadBundle();

  function treeWith(actualCents, budgetCents) {
    const unapplied = node('Expenses:Unapplied', 'Unapplied Cash Bill Payment Expense', 'Expenses', 1, actualCents, budgetCents);
    const real = node('Expenses:57 MDO', '57 MDO Expenses', 'Expenses', 1, 120000, 130000);
    return [node('Expenses', 'Expenses', 'Expenses', 0, 0, null, [real, unapplied])];
  }

  it('drops the row when it carries nothing', () => {
    const out = fin.finReorganizeChurchTree(treeWith(0, 0));
    const labels = [];
    (function walk(ns) { ns.forEach(n => { labels.push(n.label); walk(n.children); }); })(out);
    expect(labels).not.toContain('Unapplied Cash Bill Payment Expense');
    expect(labels).toContain('57 MDO Expenses');
  });

  it('KEEPS the row when it carries real money, and explains what it is', () => {
    // Hiding a dollar that a total on the same screen still counts is the FIN58 defect; the
    // zero-only rule is the same one FIN60 set for Cost of Goods Sold.
    const out = fin.finReorganizeChurchTree(treeWith(45000, 0));
    const kept = out[0].children.find(n => n.label === 'Unapplied Cash Bill Payment Expense');
    expect(kept, 'a non-zero artifact row must stay visible').toBeTruthy();
    expect(kept.hint).toMatch(/QuickBooks/);
    expect(out[0].totalActualCents, 'and it still counts toward the total').toBe(165000);
  });

  it('renders the explanation as a tooltip rather than dropping it silently', () => {
    const html = fin.finRenderChurchDetailBody(fin.finReorganizeChurchTree(treeWith(45000, 0)), null, true);
    expect(html).toContain('Unapplied Cash Bill Payment Expense');
    expect(html).toMatch(/title="[^"]*QuickBooks/);
  });
});

describe('classifyRevenueStream reads the accounts when the group name says nothing', () => {
  it('classifies a generic bucket holding only Altar Guild as restricted', () => {
    // The restricted rule spells out "altar guild", but only ever saw the GROUP label — and this
    // church files Altar Guild as 48001 inside a group called "48 Other Income", so the rule
    // could never once fire. It defaulted to earned.
    expect(classifyRevenueStream('48 Other Income').stream).toBe('earned');
    expect(classifyRevenueStream('48 Other Income', null, ['48001 Altar Guild']).stream).toBe('restricted');
  });

  it('refuses to guess for a mixed bucket', () => {
    const r = classifyRevenueStream('48 Other Income', null, ['48001 Altar Guild', '48002 Facility Rental']);
    expect(r.stream, 'no single answer is right, so it falls back to the default').toBe('earned');
  });

  it('refuses to guess when any account in the bucket is unrecognized', () => {
    const r = classifyRevenueStream('48 Other Income', null, ['48001 Altar Guild', '48009 Sundry']);
    expect(r.stream).toBe('earned');
  });

  it('never overrides the group label when the label itself is recognized', () => {
    expect(classifyRevenueStream('42 Passive Income', null, ['42001 Altar Guild']).stream).toBe('passive');
  });

  it('never overrides a saved classification — that stays the admin\'s call', () => {
    const r = classifyRevenueStream('48 Other Income', { '48 Other Income': 'passive' }, ['48001 Altar Guild']);
    expect(r).toEqual({ stream: 'passive', mapped: true });
  });

  it('flows through computeRevenueStreams from real row shapes', () => {
    const entries = [
      { classification: 'Income', category_path: 'Income:48 Other Income:48001 Altar Guild', account_name: '48001 Altar Guild', own_actual_cents: 100000, own_budget_cents: 100000 },
      { classification: 'Income', category_path: 'Income:40 Donor Income:40085 Sunday Offering', account_name: '40085 Sunday Offering', own_actual_cents: 22671104, own_budget_cents: 42500000 },
    ];
    const r = computeRevenueStreams(entries);
    expect(r.map['48 Other Income']).toBe('restricted');
    expect(r.streams.restricted.cents).toBe(100000);
    expect(r.streams.donor.cents).toBe(22671104);
  });

  it('ignores $0 accounts when reading a bucket, including the group header row', () => {
    // A zero line names nothing worth classifying on, and the group's own header row carries no
    // own amount at all — counting either would let an empty account veto the guess.
    const entries = [
      { classification: 'Income', category_path: 'Income:48 Other Income', account_name: '48 Other Income', own_actual_cents: 0, own_budget_cents: null },
      { classification: 'Income', category_path: 'Income:48 Other Income:48001 Altar Guild', account_name: '48001 Altar Guild', own_actual_cents: 100000, own_budget_cents: null },
      { classification: 'Income', category_path: 'Income:48 Other Income:48009 Sundry', account_name: '48009 Sundry', own_actual_cents: 0, own_budget_cents: null },
    ];
    expect(computeRevenueStreams(entries).map['48 Other Income']).toBe('restricted');
  });
});
