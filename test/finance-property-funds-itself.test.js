import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_EXT_JS, CHMS_APP_CORE_JS } from '../src/html-chms.js';
import { computePropertyAnnualSummary } from '../src/api-finance.js';

// Drives the real "Does it fund itself?" renderer out of the built bundle. The reported defect
// was arithmetic visible on the card's own face: revenue - expenses - reserves did not equal the
// printed total, because the total came from net income independently while the expenses line
// covered only the months that had an expenses figure.
function loadBundle() {
  const ctx = {
    console,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, appendChild() {} }),
      body: { appendChild() {} },
      addEventListener() {},
    },
    addEventListener() {},
    location: { href: '' },
    localStorage: { getItem: () => null, setItem() {} },
    scrollTo() {}, scrollY: 0,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx);
  vm.runInContext(CHMS_APP_EXT_JS, ctx);
  return ctx;
}
const fin = loadBundle();

const MONTHLY_2026 = [
  { period: '2026-01', total_revenue_cents: 932721, total_expenses_cents: null, net_income_cents: 509994, occupancy_pct: 1.0 },
  { period: '2026-02', total_revenue_cents: 1049520, total_expenses_cents: null, net_income_cents: 637333, occupancy_pct: 1.0 },
  { period: '2026-03', total_revenue_cents: 859000, total_expenses_cents: 576665, net_income_cents: 282335, occupancy_pct: 1.0 },
  { period: '2026-04', total_revenue_cents: 1318497, total_expenses_cents: null, net_income_cents: 975000, occupancy_pct: 1.0 },
  { period: '2026-05', total_revenue_cents: 927063, total_expenses_cents: null, net_income_cents: 448614, occupancy_pct: 0.8892 },
  { period: '2026-06', total_revenue_cents: 976527, total_expenses_cents: 446248, net_income_cents: 530279, occupancy_pct: 1.0,
    loan_payment_cents: 378303, interest_expense_cents: 95205 },
];
const D = {
  monthly: MONTHLY_2026,
  distributions: [{ period: '2026-04', amount_cents: 400000 }],
  capitalLedger: [],
  reserves: { property_tax: [{ report_month: '2026-07', contribution_cents: 110833, reserve_after_cents: 585833 }] },
  meta: {
    loan: { balance_cents: 27969113, balance_as_of_date: '2026-07-20', interest_rate_pct: 0.06375, monthly_payment_cents: 428303 },
    reserves: { base_minimum_cents: 450000 },
  },
  annualSummary: computePropertyAnnualSummary(MONTHLY_2026, [{ period: '2026-04', amount_cents: 400000 }], {}),
};

// Pull every "$1,234.56" out of the rendered card, in order, as integer cents.
function figures(html) {
  return [...html.matchAll(/\$([\d,]+\.\d\d)/g)].map((m) => Math.round(parseFloat(m[1].replace(/,/g, '')) * 100));
}

describe('finRenderPropertyFundsItself', () => {
  const html = fin.finRenderPropertyFundsItself(D);
  const nums = figures(html);

  it('the printed lines add up to the printed total', () => {
    // revenue - expenses - principal - reserves = net to the church. This is the exact defect
    // that was reported: on the live card these four did not reconcile.
    const [revenue, expenses, principal, reserves, total] = nums;
    expect(revenue - expenses - principal - reserves).toBe(total);
  });

  it('shows the reconciled expenses figure, not the two-months-only one', () => {
    expect(nums[0]).toBe(6063328); // revenue $60,633.28
    expect(nums[1]).toBe(2679773); // expenses $26,797.73, not $10,229.13
  });

  it('deducts mortgage principal', () => {
    const a = fin.finComputeAvailableForDistribution(D, { now: '2026-08-07' });
    expect(a.principalCents).toBeGreaterThan(0);
    expect(html).toMatch(/Mortgage principal/);
    expect(nums[2]).toBe(a.principalCents);
  });

  it('says how many months of expenses were reconstructed', () => {
    expect(html).toMatch(/4 months reconstructed/);
  });

  it('does not claim a surplus it has not got', () => {
    const total = figures(html)[4];
    // Whatever the sign, the headline sentence must agree with it.
    if (total >= 0) expect(html).toMatch(/Yes &mdash; with|Yes — with/);
    else expect(html).toMatch(/Not this year/);
  });
});
