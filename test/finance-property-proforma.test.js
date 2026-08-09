import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// The unit-level pro forma reaches across finComputePropertyValuation, finAmortizationSchedule
// and finComputePropertyCapitalAllowanceCents, and its renderers touch the DOM, so this loads the
// whole served bundle into a vm behind a stub DOM — the same technique the sibling remittable
// test uses, and the only way to be sure the SHIPPED code is what is under test.
//
// BOTH bundles, not just ext: the renderers call esc(), which the app splits into the core file.
// Loading ext alone would test a function the browser never runs in that state.
function loadBundle(els) {
  const store = els || {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
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
const fin = loadBundle();

// The real 3277 Ivanhoe worksheet and loan, as seeded in src/db.js. The four units are the four
// the pastor asked to be able to enter directly.
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
    utilities_cents: 1961363,
    trash_cents: 310668,
    maintenance_repairs_cents: 828700,
    landscaping_snow_cents: 400000,
    legal_cents: 0,
    taxes_cents: 1200000,
    insurance_cents: 1000000,
  },
  management_fee_pct: 0.06,
  cap_rate: 0.075,
};
const REAL_LOAN = {
  balance_cents: 27969113,
  balance_as_of_date: '2026-07-20',
  interest_rate_pct: 0.06375,
  monthly_payment_cents: 428303,
};
function realProperty(over) {
  return Object.assign({
    meta: { valuation: REAL_VALUATION, loan: REAL_LOAN },
    monthly: [
      { period: '2026-05', net_income_cents: 480000 },
      { period: '2026-06', net_income_cents: 530279 },
    ],
    capitalLedger: [
      { entry_date: '2024-06-01', amount_cents: 1500000 },
      { entry_date: '2026-04-08', amount_cents: 1894775 },
    ],
  }, over || {});
}

describe('finPropertyValuationInputsFromMeta', () => {
  it('maps the stored snake_case worksheet onto the shape the pure calculator wants', () => {
    const i = fin.finPropertyValuationInputsFromMeta({ valuation: REAL_VALUATION });
    expect(i.rentRoll).toHaveLength(4);
    expect(i.rentRoll[3].tenant).toBe('Magnatone');
    expect(i.cap_rate).toBe(0.075);
    expect(i.management_fee_pct).toBe(0.06);
  });

  it('degrades to a zeroed worksheet rather than throwing when nothing is stored', () => {
    const i = fin.finPropertyValuationInputsFromMeta({});
    expect(i.rentRoll).toEqual([]);
    expect(i.cap_rate).toBe(0);
    expect(fin.finComputePropertyValuation(i).capitalizedValueCents).toBe(0);
  });
});

describe('finComputePropertyUnits', () => {
  const roll = fin.finComputePropertyUnits(REAL_VALUATION.rent_roll);

  it('totals the four real units to their real contract rent', () => {
    expect(roll.count).toBe(4);
    // 19,380 + 14,993 + 27,594 + 40,828.17
    expect(roll.totalAnnualCents).toBe(10279517);
    expect(roll.totalSqft).toBe(13535);
  });

  it('derives a monthly rent and a per-square-foot rent per unit', () => {
    const magnatone = roll.units[3];
    expect(magnatone.monthlyRentCents).toBe(Math.round(4082817 / 12));
    // $40,828.17 over 7,519 SF is about $5.43/SF.
    expect(magnatone.rentPerSqftCents).toBe(Math.round(4082817 / 7519));
  });

  it('shares sum to the whole', () => {
    const total = roll.units.reduce((s, u) => s + u.sharePct, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('counts a zero-rent unit as vacant and drops its square footage from the leased figure', () => {
    const withEmpty = fin.finComputePropertyUnits([
      { tenant: 'Apartment 1', sqft: 1000, annual_rent_cents: 1200000 },
      { tenant: 'Apartment 2', sqft: 1000, annual_rent_cents: 0 },
    ]);
    expect(withEmpty.vacantCount).toBe(1);
    expect(withEmpty.leasedSqft).toBe(1000);
    expect(withEmpty.leasedPct).toBeCloseTo(0.5, 10);
    // A vacant unit must not be silently dropped from the roll itself.
    expect(withEmpty.count).toBe(2);
  });

  it('reports no leased percentage rather than a false 100% when no square footage is recorded', () => {
    const noSqft = fin.finComputePropertyUnits([{ tenant: 'X', sqft: 0, annual_rent_cents: 100000 }]);
    expect(noSqft.leasedPct).toBeNull();
    expect(noSqft.units[0].rentPerSqftCents).toBeNull();
  });
});

describe('finComputePropertyProForma', () => {
  const pf = fin.finComputePropertyProForma(realProperty(), { year: 2027 });

  it('starts from the rent roll and reaches the same NOI as the valuation worksheet', () => {
    const v = fin.finComputePropertyValuation(fin.finPropertyValuationInputsFromMeta({ valuation: REAL_VALUATION }));
    expect(pf.valuation.noiCents).toBe(v.noiCents);
    expect(pf.valuation.totalAnnualRentCents).toBe(pf.roll.totalAnnualCents);
  });

  it('reconciles line by line, so the printed walk cannot disagree with its own total', () => {
    const v = pf.valuation;
    expect(v.grossRentalIncomeCents - v.vacancyCents).toBe(v.effectiveRentalIncomeCents);
    expect(v.effectiveRentalIncomeCents - v.itemizedOpCostsCents - v.managementFeeCents).toBe(v.noiCents);
    expect(v.noiCents - pf.interestCents - pf.principalCents - pf.capitalCents).toBe(pf.cashToChurchCents);
  });

  it('subtracts mortgage principal, which is not an expense and so is not already inside NOI', () => {
    const sched = fin.finAmortizationSchedule(REAL_LOAN);
    expect(pf.principalCents).toBe(sched.byYear[2027].principalCents);
    expect(pf.principalCents).toBeGreaterThan(0);
    // Net income stops at interest; cash keeps going.
    expect(pf.netIncomeCents).toBe(pf.valuation.noiCents - pf.interestCents);
    expect(pf.cashAfterDebtCents).toBe(pf.netIncomeCents - pf.principalCents);
  });

  it('deducts the capital allowance, which never touches the P&L', () => {
    const cap = fin.finComputePropertyCapitalAllowanceCents(realProperty());
    expect(pf.capitalCents).toBe(cap.cents);
    expect(pf.cashToChurchCents).toBe(pf.cashAfterDebtCents - cap.cents);
  });

  it('does not deduct property tax twice — it is an itemized operating cost, nothing more', () => {
    const noTax = JSON.parse(JSON.stringify(REAL_VALUATION));
    noTax.operating_costs.taxes_cents = 0;
    const withoutTax = fin.finComputePropertyProForma(
      realProperty({ meta: { valuation: noTax, loan: REAL_LOAN } }), { year: 2027 });
    // Removing the tax line moves cash by exactly the tax figure, once.
    expect(withoutTax.cashToChurchCents - pf.cashToChurchCents).toBe(1200000);
  });

  it('reports debt-service coverage, and reports it as absent rather than infinite after payoff', () => {
    expect(pf.dscr).toBeCloseTo(pf.valuation.noiCents / (pf.interestCents + pf.principalCents), 10);
    const post = fin.finComputePropertyProForma(realProperty(), { year: 2040 });
    expect(post.debtServiceCents).toBe(0);
    expect(post.dscr).toBeNull();
    expect(post.cashToChurchCents).toBeGreaterThan(pf.cashToChurchCents);
  });

  it('names the gap against the operating statements instead of averaging it away', () => {
    // The fixture months average $5,051.40/mo, i.e. $60,616.74/yr of reported net income.
    expect(pf.actualNetIncome.annualCents).toBe(6061674);
    expect(pf.varianceVsActualCents).toBe(pf.netIncomeCents - 6061674);
  });

  it('reports no variance at all when there are no operating statements to compare against', () => {
    const bare = fin.finComputePropertyProForma(realProperty({ monthly: [] }), { year: 2027 });
    expect(bare.varianceVsActualCents).toBeNull();
  });

  it('still produces a walk when the loan record cannot be amortized, rather than throwing', () => {
    const noLoan = fin.finComputePropertyProForma(
      realProperty({ meta: { valuation: REAL_VALUATION, loan: {} } }), { year: 2027 });
    expect(noLoan.schedule).toBeNull();
    expect(noLoan.debtServiceKnown).toBe(false);
    expect(noLoan.interestCents).toBe(0);
    expect(noLoan.cashToChurchCents).toBe(noLoan.valuation.noiCents - noLoan.capitalCents);
  });

  it('takes live edits over the stored worksheet, which is what makes the card recompute as you type', () => {
    const edited = fin.finPropertyValuationInputsFromMeta({ valuation: REAL_VALUATION });
    edited.rentRoll[3].annual_rent_cents += 1200000; // +$1,000/mo from Magnatone
    const after = fin.finComputePropertyProForma(realProperty(), { year: 2027, inputs: edited });
    // The extra rent flows through the management fee, so cash rises by slightly less than it.
    expect(after.cashToChurchCents - pf.cashToChurchCents).toBe(Math.round(1200000 * 0.94));
  });
});

describe('rendering', () => {
  it('prints a cash walk whose bottom line is the arithmetic of the lines above it', () => {
    const pf = fin.finComputePropertyProForma(realProperty(), { year: 2027 });
    const html = fin.finRenderProFormaBody(pf);
    expect(html).toContain('Contract rent, all units');
    expect(html).toContain('Net operating income');
    expect(html).toContain('Mortgage principal');
    expect(html).toContain('Cash to the church, 2027');
    // Every div opened is closed — a broken card silently swallows the rest of the tab.
    expect((html.match(/<div/g) || []).length).toBe((html.match(/<\/div>/g) || []).length);
  });

  it('renders the whole card, rent roll included, without a stored worksheet', () => {
    const html = fin.finRenderPropertyIncomeCard({ meta: {}, monthly: [], capitalLedger: [] }, true);
    expect(html).toContain('No units recorded yet.');
    expect((html.match(/<div/g) || []).length).toBe((html.match(/<\/div>/g) || []).length);
    expect((html.match(/<table/g) || []).length).toBe((html.match(/<\/table>/g) || []).length);
  });

  it('renders the four real units with both a monthly and an annual rent box', () => {
    const html = fin.finRenderPropertyIncomeCard(realProperty(), true);
    expect(html).toContain('Magnatone');
    expect(html).toContain('fin-val-rr-3-monthly');
    expect(html).toContain('fin-val-rr-3-rent');
    expect(html).toContain('4 units');
    expect((html.match(/<tr/g) || []).length).toBe((html.match(/<\/tr>/g) || []).length);
  });

  it('gives a non-admin no inputs it could type into', () => {
    const html = fin.finRenderPropertyIncomeCard(realProperty(), false);
    expect(html).not.toContain('+ Add unit');
    expect(html).not.toContain('Save worksheet');
    // Every input that is rendered is disabled.
    const inputs = html.match(/<input[^>]*>/g) || [];
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((i) => expect(i).toContain('disabled'));
  });

  it('still shows the full valuation worksheet, line by line, not just a total', () => {
    const html = fin.finRenderValuationWorksheet(realProperty(), true);
    ['Gross rental income', 'Less vacancy', 'Effective rental income', 'Itemized operating costs',
      'Management fee', 'Total operating costs', 'Net operating income', 'Capitalized value']
      .forEach((label) => expect(html).toContain(label));
    expect(html).toContain('fin-val-caprate');
    expect(html).toContain('Save worksheet');
  });
});

describe('typing into a rent box', () => {
  // A fake input element is enough: the handler only ever reads and writes .value / .innerHTML.
  function el() { return { value: '', innerHTML: '' }; }

  it('writes a monthly rent through to the annual figure and refreshes only the other box', () => {
    const els = {};
    [0, 1, 2, 3].forEach((i) => {
      els['fin-val-rr-' + i + '-monthly'] = el();
      els['fin-val-rr-' + i + '-rent'] = el();
      els['fin-val-rr-' + i + '-psf'] = el();
      els['fin-val-rr-' + i + '-share'] = el();
    });
    const ctx = loadBundle(els);
    ctx.finRenderPropertyIncomeCard(realProperty(), true); // seeds _finValRentRoll
    ctx.finValRentRollFieldChange(0, 'monthly_rent_cents', '2000');
    expect(ctx._finValRentRoll[0].annual_rent_cents).toBe(2400000);
    // The paired ANNUAL box is rewritten; the MONTHLY box being typed in is left alone, which is
    // the controlled-input round-trip FIN52 root-caused.
    expect(els['fin-val-rr-0-rent'].value).toBe(24000);
    expect(els['fin-val-rr-0-monthly'].value).toBe('');
  });

  it('writes an annual rent through to the monthly figure, and not the reverse', () => {
    const els = {};
    [0, 1, 2, 3].forEach((i) => {
      els['fin-val-rr-' + i + '-monthly'] = el();
      els['fin-val-rr-' + i + '-rent'] = el();
      els['fin-val-rr-' + i + '-psf'] = el();
      els['fin-val-rr-' + i + '-share'] = el();
    });
    const ctx = loadBundle(els);
    ctx.finRenderPropertyIncomeCard(realProperty(), true);
    ctx.finValRentRollFieldChange(1, 'annual_rent_cents', '18000');
    expect(ctx._finValRentRoll[1].annual_rent_cents).toBe(1800000);
    expect(els['fin-val-rr-1-monthly'].value).toBe(150000 / 100);
    expect(els['fin-val-rr-1-rent'].value).toBe('');
  });

  it('marks a unit vacant the moment its rent is zeroed', () => {
    const els = {};
    [0, 1, 2, 3].forEach((i) => {
      els['fin-val-rr-' + i + '-monthly'] = el();
      els['fin-val-rr-' + i + '-rent'] = el();
      els['fin-val-rr-' + i + '-psf'] = el();
      els['fin-val-rr-' + i + '-share'] = el();
    });
    const ctx = loadBundle(els);
    ctx.finRenderPropertyIncomeCard(realProperty(), true);
    ctx.finValRentRollFieldChange(2, 'annual_rent_cents', '0');
    expect(els['fin-val-rr-2-share'].innerHTML).toContain('vacant');
  });
});

// The capital allowance used to be derived only — the ledger average, projected forward forever.
// For this property that is three FINISHED one-time projects (a 2024 apartment renovation, a 2025
// HVAC replacement, a washer/dryer hookup) charged every year in perpetuity, which is most of why
// 2027 read as deeply negative. It is now an entered assumption with the average as a flagged
// fallback.
describe('capital allowance assumption', () => {
  function withCapital(capital) {
    const d = realProperty();
    d.meta = { ...d.meta, capital };
    return d;
  }
  // $15,000 over 2024-06 .. 2026-04 (23 months, 1.9167 years) = $7,826.09/yr + the 2026 entry.
  const LEDGER_CENTS = fin.finComputePropertyCapitalAllowanceCents(realProperty()).cents;

  it('falls back to the ledger average, and says that is what it did', () => {
    const cap = fin.finComputePropertyCapitalAllowanceCents(realProperty());
    expect(cap.source).toBe('ledger');
    expect(cap.cents).toBe(LEDGER_CENTS);
    expect(cap.cents).toBeGreaterThan(0);
    // The fallback must be flagged as history, not presented as a forecast.
    expect(fin.finPropertyCapitalSourceNote(cap)).toContain('not a forward assumption');
  });

  it('honours a flat figure, including a deliberate zero', () => {
    const flat = fin.finComputePropertyCapitalAllowanceCents(
      withCapital({ method: 'flat', annual_allowance_cents: 300000 }));
    expect(flat.source).toBe('flat');
    expect(flat.cents).toBe(300000);
    // Zero is a real answer ("we plan no capital"), not a missing value to be overridden.
    const zero = fin.finComputePropertyCapitalAllowanceCents(
      withCapital({ method: 'flat', annual_allowance_cents: 0 }));
    expect(zero.source).toBe('flat');
    expect(zero.cents).toBe(0);
  });

  it('multiplies a $/SF rate by the real leasable area', () => {
    const cap = fin.finComputePropertyCapitalAllowanceCents(
      withCapital({ method: 'per_sqft', per_sqft_cents: 20 })); // $0.20/SF
    expect(cap.source).toBe('per_sqft');
    expect(cap.sqft).toBe(13535);
    expect(cap.cents).toBe(20 * 13535); // $2,707.00/yr
    expect(fin.finPropertyCapitalSourceNote(cap)).toContain('13,535 SF');
  });

  it('never resolves a $/SF rate to a confident $0 when no square footage is recorded', () => {
    const noSqft = withCapital({ method: 'per_sqft', per_sqft_cents: 20 });
    noSqft.meta.valuation = { ...REAL_VALUATION, rent_roll: [{ tenant: 'X', sqft: 0, annual_rent_cents: 100000 }] };
    const cap = fin.finComputePropertyCapitalAllowanceCents(noSqft);
    expect(cap.source).toBe('per_sqft_no_sqft');
    expect(cap.cents).toBe(LEDGER_CENTS); // fell back rather than deleting a real cost
    expect(fin.finPropertyCapitalSourceNote(cap)).toContain('no unit square footage');
  });

  it('tracks live square footage while the rent roll is being edited', () => {
    const d = withCapital({ method: 'per_sqft', per_sqft_cents: 20 });
    const live = fin.finComputePropertyCapitalAllowanceCents(d, { sqft: 20000 });
    expect(live.cents).toBe(20 * 20000);
    // ...and the pro forma passes the live roll through, so the card cannot show a stale figure.
    const edited = fin.finPropertyValuationInputsFromMeta(d.meta);
    edited.rentRoll[3].sqft = 7519 + 6465; // push the total to 20,000
    const pf = fin.finComputePropertyProForma(d, { year: 2027, inputs: edited });
    expect(pf.capital.sqft).toBe(20000);
    expect(pf.capitalCents).toBe(20 * 20000);
  });

  it('reaches BOTH the pro forma and the remittable forecast — the drift the resolver prevents', () => {
    const d = withCapital({ method: 'flat', annual_allowance_cents: 300000 });
    const pf = fin.finComputePropertyProForma(d, { year: 2027 });
    const rf = fin.finComputeRemittableForecast(d, { years: 1, startYear: 2027 });
    expect(pf.capitalCents).toBe(300000);
    expect(rf.capitalAllowanceCents).toBe(300000);
    expect(rf.rows[0].capitalCents).toBe(300000);
  });

  it('moves the bottom line by exactly the change in the assumption', () => {
    const before = fin.finComputePropertyProForma(realProperty(), { year: 2027 });
    const after = fin.finComputePropertyProForma(
      withCapital({ method: 'flat', annual_allowance_cents: 0 }), { year: 2027 });
    expect(after.cashToChurchCents - before.cashToChurchCents).toBe(LEDGER_CENTS);
  });

  it('names its source everywhere it prints, rather than asserting the ledger', () => {
    const flat = withCapital({ method: 'flat', annual_allowance_cents: 300000 });
    const html = fin.finRenderProFormaBody(fin.finComputePropertyProForma(flat, { year: 2027 }), true);
    expect(html).toContain('a set allowance of');
    expect(html).not.toContain('averaged from the capital ledger');
  });

  it('gives a non-admin the figure and its basis, but nothing to change it with', () => {
    const cap = fin.finComputePropertyCapitalAllowanceCents(realProperty());
    const html = fin.finRenderCapitalAssumptionEditor(cap, false);
    expect(html).toContain('Capital allowance');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Save assumption');
  });

  it('renders an admin editor whose basis picker and inputs stay tag-balanced', () => {
    ['ledger', 'flat', 'per_sqft'].forEach((method) => {
      const cap = fin.finComputePropertyCapitalAllowanceCents(
        withCapital({ method, annual_allowance_cents: 300000, per_sqft_cents: 20 }));
      const html = fin.finRenderCapitalAssumptionEditor(cap, true);
      expect(html).toContain('Save assumption');
      ['div', 'label', 'select', 'details', 'span'].forEach((t) => {
        expect((html.match(new RegExp('<' + t + '\\b', 'g')) || []).length)
          .toBe((html.match(new RegExp('</' + t + '>', 'g')) || []).length);
      });
    });
  });
});

// FIN52's rule, relearned the hard way: the container holding a live input must never be the
// container a recompute rewrites. The capital editor was first shipped INSIDE the pro-forma body,
// whose host element is rewritten wholesale on every keystroke — so the field accepted exactly one
// character before being destroyed and recreated. These pin the structure and the behaviour.
describe('capital assumption editor does not eat keystrokes', () => {
  // Walks the div nesting for real. An earlier version of this test only checked that the capital
  // id appeared AFTER the pro-forma id in the string, which is equally true when it is nested
  // inside — it passed against the exact bug it was meant to catch.
  function divRangeOf(html, idAttr) {
    const at = html.indexOf(idAttr);
    if (at < 0) return null;
    const open = html.lastIndexOf('<div', at);
    let i = html.indexOf('>', at) + 1;
    let depth = 1;
    while (depth > 0 && i < html.length) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
      else { depth--; i = nextClose + 6; }
    }
    return { start: open, end: i };
  }

  it('is rendered as a sibling of the recompute target, never inside it', () => {
    const html = fin.finRenderPropertyIncomeCard(realProperty(), true);
    const pf = divRangeOf(html, 'id="fin-proforma-out"');
    const cap = divRangeOf(html, 'id="fin-capital-assumption"');
    expect(pf).not.toBeNull();
    expect(cap).not.toBeNull();
    // The capital editor must begin at or after the pro-forma container has CLOSED.
    expect(cap.start).toBeGreaterThanOrEqual(pf.end);
    // Belt and braces: no input of any kind inside the container that gets rewritten.
    const inside = html.slice(pf.start, pf.end);
    expect(inside).not.toContain('<input');
    expect(inside).not.toContain('<select');
    // ...and the walk builder itself renders no controls.
    const body = fin.finRenderProFormaBody(fin.finComputePropertyProForma(realProperty(), { year: 2027 }));
    expect(body).not.toContain('<input');
    expect(body).not.toContain('<select');
  });

  it('typing a multi-digit figure never replaces the field being typed in', () => {
    const els = {};
    const mk = () => ({ value: '', innerHTML: '', textContent: '' });
    els['fin-cap-method'] = { ...mk(), value: 'flat' };
    els['fin-cap-flat'] = mk();
    els['fin-cap-headline'] = mk();
    els['fin-cap-preview'] = mk();
    els['fin-proforma-out'] = mk();
    els['fin-val-output'] = mk();
    // The host the editor lives in. If a keystroke handler ever rewrites this, the identity check
    // below fails — which is exactly the reported bug.
    els['fin-capital-assumption'] = mk();
    const ctx = loadBundle(els);
    ctx._userRole = 'admin';
    ctx._finProperty = realProperty();
    ctx.finRenderPropertyIncomeCard(ctx._finProperty, true); // seeds _finValRentRoll

    const field = els['fin-cap-flat'];
    const hostBefore = els['fin-capital-assumption'].innerHTML;
    '12500'.split('').forEach((ch) => {
      field.value += ch;              // the browser appends the character
      ctx.finCapAssumptionChanged();  // then fires oninput
    });
    // The field object was never swapped out, and its value accumulated all five digits.
    expect(els['fin-cap-flat']).toBe(field);
    expect(field.value).toBe('12500');
    // The editor's own container was not rewritten while typing.
    expect(els['fin-capital-assumption'].innerHTML).toBe(hostBefore);
    // ...but the derived readouts and the walk above did update.
    expect(ctx._finProperty.meta.capital.annual_allowance_cents).toBe(1250000);
    expect(els['fin-cap-headline'].innerHTML).toContain('12,500');
    expect(els['fin-proforma-out'].innerHTML).toContain('Cash to the church');
  });

  it('redraws the editor only when the basis changes, so the right inputs appear', () => {
    const els = {};
    const mk = () => ({ value: '', innerHTML: '', textContent: '' });
    els['fin-cap-method'] = { ...mk(), value: 'per_sqft' };
    els['fin-cap-headline'] = mk();
    els['fin-cap-preview'] = mk();
    els['fin-proforma-out'] = mk();
    els['fin-val-output'] = mk();
    els['fin-capital-assumption'] = mk();
    const ctx = loadBundle(els);
    ctx._userRole = 'admin';
    ctx._finProperty = realProperty();
    ctx.finRenderPropertyIncomeCard(ctx._finProperty, true);
    ctx.finCapBasisChanged();
    expect(els['fin-capital-assumption'].innerHTML).toContain('fin-cap-persqft');
    expect(ctx._finProperty.meta.capital.method).toBe('per_sqft');
  });
});

describe('combined flat + $/SF basis', () => {
  function withCapital(capital) {
    const d = realProperty();
    d.meta = { ...d.meta, capital };
    return d;
  }

  it('adds a flat base to a per-SF rate', () => {
    const cap = fin.finComputePropertyCapitalAllowanceCents(
      withCapital({ method: 'flat_plus_sqft', annual_allowance_cents: 200000, per_sqft_cents: 20 }));
    expect(cap.source).toBe('flat_plus_sqft');
    expect(cap.flatCents).toBe(200000);
    expect(cap.byAreaCents).toBe(20 * 13535);
    expect(cap.cents).toBe(200000 + 20 * 13535); // $2,000 + $2,707 = $4,707
    const note = fin.finPropertyCapitalSourceNote(cap);
    expect(note).toContain('flat $2,000.00/yr');
    expect(note).toContain('13,535 SF');
  });

  it('keeps the flat part when there is no square footage, rather than falling back', () => {
    // Unlike the pure per_sqft case: the flat figure is a real entered number, so the assumption
    // stands and the rate simply contributes nothing.
    const d = withCapital({ method: 'flat_plus_sqft', annual_allowance_cents: 200000, per_sqft_cents: 20 });
    d.meta.valuation = { ...REAL_VALUATION, rent_roll: [{ tenant: 'X', sqft: 0, annual_rent_cents: 100000 }] };
    const cap = fin.finComputePropertyCapitalAllowanceCents(d);
    expect(cap.source).toBe('flat_plus_sqft');
    expect(cap.cents).toBe(200000);
    expect(fin.finRenderCapitalAssumptionEditor(cap, true)).toContain('contributing nothing');
  });

  it('reaches the pro forma and the remittable forecast alike', () => {
    const d = withCapital({ method: 'flat_plus_sqft', annual_allowance_cents: 200000, per_sqft_cents: 20 });
    const expected = 200000 + 20 * 13535;
    expect(fin.finComputePropertyProForma(d, { year: 2027 }).capitalCents).toBe(expected);
    expect(fin.finComputeRemittableForecast(d, { years: 1, startYear: 2027 }).capitalAllowanceCents).toBe(expected);
  });

  it('offers the combined basis in the picker and stays tag-balanced', () => {
    const cap = fin.finComputePropertyCapitalAllowanceCents(
      withCapital({ method: 'flat_plus_sqft', annual_allowance_cents: 200000, per_sqft_cents: 20 }));
    const html = fin.finRenderCapitalAssumptionEditor(cap, true);
    expect(html).toContain('Flat $ plus $ per SF');
    expect(html).toContain('fin-cap-flat');
    expect(html).toContain('fin-cap-persqft');
    ['div', 'label', 'select', 'details', 'span', 'p'].forEach((t) => {
      expect((html.match(new RegExp('<' + t + '\\b', 'g')) || []).length)
        .toBe((html.match(new RegExp('</' + t + '>', 'g')) || []).length);
    });
  });
});
