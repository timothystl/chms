import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { computePropertyAnnualSummary } from '../src/api-finance.js';

// Property print sheet — fifth and last section for the Full Report picker (see
// test/finance-full-report.test.js), completing the user's original four-section scope (Budget,
// Financial Health, Church Report, Balance Sheet/Property). Unlike the other sections, most of
// Property's own render functions already accept an isAdminUI flag and drop their Add/Delete/Save
// affordances when it's false (finRenderPropertyTaxReserve, finRenderCapitalImprovements,
// finRenderRepairs, finRenderCapitalAssumptionEditor), so finPropertyBuildPrintSheetHtml() reuses
// those unchanged with isAdminUI forced to false. Three screen-only pieces have no such flag and
// get trimmed finPropertyRpt* variants instead: the rent-roll table and the valuation worksheet
// are editable <input> grids on screen with no print equivalent, and the Monthly
// financials/Capital & repairs/Distributions sections are collapsed-by-default finLedgerStrip()
// toggles — same "always shows everything expanded" rule Church Report established.

function el() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  };
}
function loadBundle(store) {
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

// Real 3277 Ivanhoe figures, same fixture shape as test/finance-property-proforma.test.js and
// test/finance-property-funds-itself.test.js.
const REAL_VALUATION = {
  rent_roll: [
    { tenant: 'Apartment 1', sqft: 1500, annual_rent_cents: 1938000 },
    { tenant: 'Apartment 2', sqft: 1450, annual_rent_cents: 1499300 },
    { tenant: 'RJBJ - Crossfit', sqft: 3066, annual_rent_cents: 2759400 },
    { tenant: 'Magnatone', sqft: 7519, annual_rent_cents: 4082817 },
  ],
  utility_reimbursement_cents: 1626068,
  vacancy_rate_pct: 0,
  operating_costs: {
    utilities_cents: 1961363, trash_cents: 310668, maintenance_repairs_cents: 828700,
    landscaping_snow_cents: 400000, legal_cents: 0, taxes_cents: 1200000, insurance_cents: 1000000,
  },
  management_fee_pct: 0.06,
  cap_rate: 0.075,
  capitalized_value_cents: 850000000,
  as_of_date: '2026-07-01',
};
const REAL_LOAN = {
  balance_cents: 27969113, balance_as_of_date: '2026-07-20',
  interest_rate_pct: 0.06375, monthly_payment_cents: 428303,
};
const MONTHLY_2026 = [
  { period: '2026-01', total_revenue_cents: 932721, total_expenses_cents: null, net_income_cents: 509994, occupancy_pct: 1.0 },
  { period: '2026-02', total_revenue_cents: 1049520, total_expenses_cents: null, net_income_cents: 637333, occupancy_pct: 1.0 },
  { period: '2026-03', total_revenue_cents: 859000, total_expenses_cents: 576665, net_income_cents: 282335, occupancy_pct: 1.0 },
  { period: '2026-04', total_revenue_cents: 1318497, total_expenses_cents: null, net_income_cents: 975000, occupancy_pct: 1.0 },
  { period: '2026-05', total_revenue_cents: 927063, total_expenses_cents: null, net_income_cents: 448614, occupancy_pct: 0.8892 },
  { period: '2026-06', total_revenue_cents: 976527, total_expenses_cents: 446248, net_income_cents: 530279, occupancy_pct: 1.0,
    loan_payment_cents: 378303, interest_expense_cents: 95205 },
];
const DISTRIBUTIONS = [{ period: '2026-04', amount_cents: 400000 }];

function propertyFixture() {
  return {
    meta: {
      property: { name: '3277 Ivanhoe', type: 'Mixed-Use Commercial', owner: 'Timothy Lutheran Church', property_manager: 'AHRA' },
      valuation: REAL_VALUATION,
      loan: REAL_LOAN,
      reserves: { base_minimum_cents: 450000 },
      insurance: {
        policy_structure_note: 'GuideOne church-wide policy, allocated by building value share.',
        ivanhoe_allocation: { ivanhoe_share_of_total_insured_value_pct: 0.22, allocated_total_annual_cents: 1850000, estimate_note: 'Estimated from the 2026 renewal schedule.' },
      },
    },
    monthly: MONTHLY_2026,
    distributions: DISTRIBUTIONS,
    capitalLedger: [
      { id: 1, entry_date: '2024-06-01', amount_cents: 1500000, payee: 'ABC Roofing', description: 'Roof replacement', check_ref: '1042', project: 'Roof 2024' },
      { id: 2, entry_date: '2026-04-08', amount_cents: 1894775, payee: 'XYZ HVAC', description: 'Rooftop unit replacement', check_ref: '1098', project: 'HVAC 2026' },
    ],
    repairs: [
      { id: 1, entry_date: '2026-05-10', category: 'Plumbing', description: 'Water heater repair', amount_cents: 84500, payee: 'Metro Plumbing' },
    ],
    reserves: {
      property_tax: [
        { report_month: '2026-07', tax_year: 2026, target_estimate_cents: 1200000, reserve_before_cents: 475000, contribution_cents: 110833, reserve_after_cents: 585833, note: '' },
      ],
    },
    reserveDisbursements: { property_tax: [] },
    annualSummary: computePropertyAnnualSummary(MONTHLY_2026, DISTRIBUTIONS, {}),
  };
}

const NOW = { now: '2026-08-07' };
function propertySetup() {
  const propertyRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const printsheetRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const fin = loadBundle({ 'fin-property-root': propertyRoot, 'fin-property-printsheet-root': printsheetRoot });
  fin._finProperty = propertyFixture();
  fin._userRole = 'admin';
  return { fin, propertyRoot, printsheetRoot };
}

describe('Property print sheet — content', () => {
  it('shows a placeholder, not a crash, when there is no property data loaded yet', () => {
    const { fin } = propertySetup();
    fin._finProperty = null;
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('fin-property-rpt');
    expect(html).toMatch(/No property data loaded/i);
  });

  it('includes the property name/header and the distribution hero + funds-itself KPIs', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('3277 Ivanhoe');
    expect(html).toContain('Available to distribute today');
    expect(html).toContain('Does it fund itself?');
  });

  it('includes the revenue/expense and occupancy charts', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Monthly Revenue vs. Expenses');
    expect(html).toContain('Occupancy %');
  });

  it('includes every real unit in the rent roll, with no input fields or add/remove affordances', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Apartment 1');
    expect(html).toContain('Apartment 2');
    expect(html).toContain('RJBJ - Crossfit');
    expect(html).toContain('Magnatone');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('finValAddTenant');
    expect(html).not.toContain('finValRemoveTenant');
    expect(html).not.toContain('+ Add unit');
  });

  it('includes the cash-walk pro forma and the capital allowance note as plain text, not the admin editor', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Net operating income');
    expect(html).toContain('Cash to the church');
    expect(html).toContain('Capital allowance');
    expect(html).not.toContain('fin-cap-method');
    expect(html).not.toContain('Save assumption');
  });

  it('includes the valuation worksheet\'s costs, assumptions, and output table as plain stats, not editable inputs', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Operating Costs');
    expect(html).toContain('Utilities');
    expect(html).toContain('Capitalized value');
    expect(html).not.toContain('fin-val-oc-utilities_cents');
    expect(html).not.toContain('Save worksheet');
    expect(html).not.toContain('oninput=');
  });

  it('includes the Reserves card with the reserve schedule always shown, not collapsed behind a <details> disclosure', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Reserves');
    expect(html).toContain('Reserve schedule');
    expect(html).toContain('2026-07'); // a real schedule row, proving it isn't collapsed away
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
  });

  it('includes the Monthly financials, Capital & repairs, and Distributions sections always expanded, with no Show/Hide toggle', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Monthly financials');
    expect(html).toContain('2026-06'); // a real month row
    expect(html).toContain('Capital &amp; repairs ledger');
    expect(html).toContain('Roof replacement');
    expect(html).toContain('Water heater repair');
    expect(html).toContain('Distributions to church');
    expect(html).toContain('2026-04');
    expect(html).not.toContain('finPropertyToggleLedger');
    expect(html).not.toContain('Show &#9656;');
  });

  it('drops every admin-only Add/Delete/Save affordance', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).not.toContain('finPropertyOpenMonthModal');
    expect(html).not.toContain('finPropertyDeleteCapitalLedger');
    expect(html).not.toContain('finPropertyDeleteRepair');
    expect(html).not.toContain('finPropertyDeleteReserveMonth');
    expect(html).not.toContain('finNavGo(&#39;data&#39;)');
    expect(html).not.toContain('Record a distribution');
    expect(html).not.toContain('+ Add Month');
    expect(html).not.toContain('+ Add');
  });

  it('includes the insurance allocation reference card', () => {
    const { fin } = propertySetup();
    const html = fin.finPropertyBuildPrintSheetHtml();
    expect(html).toContain('Insurance Allocation');
    expect(html).toContain('Share of Insured Value');
  });
});

describe('Property print sheet — finPropertyPrint', () => {
  it('builds the sheet into #fin-property-printsheet-root, marks body.printing-property, and cleans up after printing', async () => {
    const { fin, printsheetRoot } = propertySetup();
    const bodyClasses = [];
    fin.document.body.classList.add = (c) => bodyClasses.push(c);
    fin.document.body.classList.remove = (c) => { const i = bodyClasses.indexOf(c); if (i > -1) bodyClasses.splice(i, 1); };
    let printed = false;
    fin.print = () => { printed = true; };
    fin.finPropertyPrint();
    expect(printsheetRoot.innerHTML).toContain('fin-property-rpt');
    expect(printsheetRoot.innerHTML).toContain('3277 Ivanhoe');
    expect(bodyClasses).toEqual(['printing-property']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(printed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bodyClasses).toEqual([]);
    expect(printsheetRoot.innerHTML).toBe('');
  }, 2000);

  it('is a no-op when the print-sheet mount is missing from the DOM', () => {
    const fin = loadBundle({});
    fin._finProperty = propertyFixture();
    expect(() => fin.finPropertyPrint()).not.toThrow();
  });
});

// Same class of bug this app has hit before on the Budget/Financial Health/Balance Sheet print
// sheets: a rule that hides the whole panel (or misses a sibling) before the print sheet ever
// gets to show. Property needs the SAME two levels of nesting as Balance Sheet (not Church
// Report's one-level exception) because finRenderProperty() rebuilds #fin-property-root's whole
// innerHTML on every render.
describe('body.printing-property CSS contract', () => {
  it('names both nesting levels explicitly: #fin-panel-property > #fin-property-root > #fin-property-printsheet-root', () => {
    expect(HTML_HEAD).toMatch(/body\.printing-property \.tab-panel:not\(#tab-finance\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-property #tab-finance\{display:block!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-property #tab-finance > div > div > div:not\(#fin-panel-property\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-property #fin-panel-property > \*:not\(#fin-property-root\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-property #fin-property-root > \*:not\(#fin-property-printsheet-root\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-property #fin-property-printsheet-root\{display:block!important;\}/);
    // The regression shape: skipping the intermediate #fin-property-root level entirely.
    expect(HTML_HEAD).not.toMatch(/#fin-panel-property\s*>\s*\*:not\(#fin-property-printsheet-root\)/);
  });

  it('#fin-property-printsheet-root is hidden on screen by default', () => {
    expect(HTML_HEAD).toMatch(/\.fin-property-printsheet-root\{display:none;\}/);
  });

  it('collapses .fin-grid-hero/.fin-grid-charts/.fin-grid-3/.fin-grid-2 to one column, and keeps cards from splitting across a page break', () => {
    expect(HTML_HEAD).toMatch(/\.fin-property-rpt \.fin-grid-3,\.fin-property-rpt \.fin-grid-hero,\.fin-property-rpt \.fin-grid-charts,\.fin-property-rpt \.fin-grid-2\{grid-template-columns:1fr!important;\}/);
    const cardRule = HTML_HEAD.match(/\.fin-health-rpt \.fin-card[^{]*\{break-inside:avoid;margin-bottom:14px;\}/);
    expect(cardRule).toBeTruthy();
    expect(cardRule[0]).toContain('.fin-property-rpt .fin-card');
  });
});
