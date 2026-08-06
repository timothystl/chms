import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// The health plan is now priced the way Concordia actually publishes it: a MONTHLY rate for each of
// four coverage tiers (Self / Self & Spouse / Self & Child / Family) per plan option, with a worker
// sitting on exactly one tier. Before this it was one annual group figure split evenly, which was
// only ever right because this church happens to have two Family contracts and nothing else — the
// moment one worker sits on Self, an even split charges them a Family share.
//
// The strongest check available is that the tier rates, multiplied by the real enrolment,
// reconstruct the packet's own printed Total Monthly and Total Annual figures exactly. If a rate
// were mistyped that reconciliation breaks, so these numbers are transcription cover as well as
// behaviour cover.

function makeCtx() {
  const store = {};
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
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx.__store = store; ctx.__el = el;
  return ctx;
}

const worker = (name, over) => Object.assign({
  name, position: 'Staff', role: 'other', trackKey: 'secretary', education: 'none',
  yearsExperience: 10, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0,
  selfEmployedFica: false, hasDependents: false, accountCode: '58020', concordia: {},
}, over || {});

let ctx;
beforeEach(() => {
  ctx = makeCtx();
  ctx._userRole = 'admin';
  ctx._finPlanBaseYear = 2026;
  ctx._finPlanTargetYear = 2027;
  ctx._finPlanBaseTree = [{
    label: 'Expenses', path: 'Expenses', classification: 'Expenses', hasBudgetInfo: true,
    totalActualCents: 0, totalBudgetCents: 0,
    children: [{ label: '58020 Office Salaries', path: 'Expenses > 58020 Office Salaries', children: [],
      classification: 'Expenses', hasBudgetInfo: true, totalActualCents: 5000000, totalBudgetCents: 5000000 }],
  }];
  ctx._finSalaryRoster = [
    worker('Family Worker', { healthTier: 'family' }),
    worker('Family Two', { healthTier: 'family' }),
  ];
  ctx._finSalaryReferenceByYear = { 2027: { pensionPct: 0.117, disabilityNoDepsPct: 0.012, ficaPct: 0.0765, healthOptOutCents: 600000 } };
  ctx._finCompMethod = 'none';
  ctx._finCompPerWorkerMethod = {}; ctx._finCompOverrides = {};
  ctx._finHealthPlanSelectedOption = 'renewal'; ctx._finHealthPlanPremiumOverrides = {};
});

describe('the rates reconstruct the packet', () => {
  it('reproduces the Renewal column, Total Monthly and Total Annual, at the real enrolment', () => {
    // Packet, Renewal: Family $2,051.00/mo, 2 contracts -> Total Monthly $4,102.00, annual $49,224.00.
    const c = ctx.finComputeHealthPlanTotalCents('renewal');
    expect(ctx.finHealthTierMonthlyCents('renewal', 'family')).toBe(205100);
    expect(c.monthlyCents).toBe(410200);
    expect(c.medicalCents).toBe(4922400);
    expect(c.totalCents).toBe(5374248); // + dental $3,046.80 + vision $1,471.68
  });

  it('reproduces every other option the same way', () => {
    const monthly = { current: 377472, option1: 477630, option2: 437670, option3: 367772 };
    Object.keys(monthly).forEach(k => {
      expect(ctx.finComputeHealthPlanTotalCents(k).monthlyCents).toBe(monthly[k]);
      expect(ctx.finComputeHealthPlanTotalCents(k).medicalCents).toBe(monthly[k] * 12);
    });
  });

  it('carries all four tiers, not just Family', () => {
    // Every rate off the packet's Enrollment and Rates block, Renewal column.
    expect(ctx.finHealthTierMonthlyCents('renewal', 'self')).toBe(76530);
    expect(ctx.finHealthTierMonthlyCents('renewal', 'selfSpouse')).toBe(153825);
    expect(ctx.finHealthTierMonthlyCents('renewal', 'selfChild')).toBe(127805);
  });
});

describe('a worker is charged their own tier', () => {
  it('prices Self at the Self rate, not a share of the group total', () => {
    ctx.finCompSetHealthTier(1, 'self');
    const [fam, self] = ctx.finCompComputeAll();
    // Dental + vision ($4,518.48) split across the 2 enrolled = $2,259.24 each.
    expect(self.benefits.healthCents).toBe(76530 * 12 + 225924);
    expect(fam.benefits.healthCents).toBe(205100 * 12 + 225924);
    // The whole point: the two are no longer the same figure.
    expect(self.benefits.healthCents).toBeLessThan(fam.benefits.healthCents);
  });

  it('adds up to the group premium at that enrolment', () => {
    ctx.finCompSetHealthTier(1, 'selfChild');
    const counts = ctx.finCompEnrollmentCounts();
    expect(counts).toEqual({ self: 0, selfSpouse: 0, selfChild: 1, family: 1 });
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(totals.healthCents).toBe(ctx.finComputeHealthPlanTotalCents('renewal', null, counts).totalCents);
  });

  it('counts enrolment off the roster, and leaves cash-only workers out of it', () => {
    ctx._finSalaryRoster.push(worker('Nursery', { healthTier: 'family', cashOnly: true, ftePct: 20 }));
    expect(ctx.finCompEnrolledCount()).toBe(2);
    expect(ctx.finCompEnrollmentCounts().family).toBe(2);
    expect(ctx.finCompComputeAll()[2].benefits.healthCents).toBe(0);
  });

  it('pays opt-out cash instead of any tier rate', () => {
    ctx.finCompSetHealthTier(1, 'optout');
    expect(ctx.finCompComputeAll()[1].benefits.healthCents).toBe(600000);
    expect(ctx.finCompEnrolledCount()).toBe(1);
  });
});

describe('a roster saved before tiers existed', () => {
  it('reads the old two-way mode, with "employee only" meaning Self', () => {
    expect(ctx.finCompHealthTier({ healthMode: 'family' })).toBe('family');
    expect(ctx.finCompHealthTier({ healthMode: 'employee' })).toBe('self');
    expect(ctx.finCompHealthTier({ healthMode: 'optout' })).toBe('optout');
    expect(ctx.finCompHealthTier({ healthEnrolled: true, hasDependents: true })).toBe('family');
  });

  it('keeps the old flags in step when a tier is chosen', () => {
    ctx.finCompSetHealthTier(0, 'selfSpouse');
    expect(ctx._finSalaryRoster[0].healthTier).toBe('selfSpouse');
    expect(ctx._finSalaryRoster[0].healthEnrolled).toBe(true);
    ctx.finCompSetHealthTier(0, 'optout');
    expect(ctx._finSalaryRoster[0].healthEnrolled).toBe(false);
  });

  it('no longer lets the dependents flag move anyone between tiers', () => {
    // With two tiers a dependents flag implied the tier. With four it does not — Self & Spouse and
    // Self & Child are both "has dependents" and are priced differently — so inferring one would
    // silently overwrite the admin's choice.
    ctx.finCompSetHealthTier(0, 'selfChild');
    ctx.finCompDependentsToggle(0, false);
    expect(ctx.finCompHealthTier(ctx._finSalaryRoster[0])).toBe('selfChild');
    ctx.finCompDependentsToggle(0, true);
    expect(ctx.finCompHealthTier(ctx._finSalaryRoster[0])).toBe('selfChild');
  });
});

describe('typing new rates in', () => {
  it('overrides one tier of one option and leaves the rest quoted', () => {
    ctx.finCompTierRateChange('renewal', 'family', '2200');
    expect(ctx.finHealthTierMonthlyCents('renewal', 'family')).toBe(220000);
    expect(ctx.finHealthTierMonthlyCents('renewal', 'self')).toBe(76530);
    expect(ctx.finHealthTierMonthlyCents('option1', 'family')).toBe(238815);
    expect(ctx.finComputeHealthPlanTotalCents('renewal').monthlyCents).toBe(440000);
  });

  it('clears back to the quoted rate on an emptied box', () => {
    ctx.finCompTierRateChange('renewal', 'family', '2200');
    ctx.finCompTierRateChange('renewal', 'family', '');
    expect(ctx.finHealthTierMonthlyCents('renewal', 'family')).toBe(205100);
  });

  it('drops a stored annual medical override, which would otherwise silently keep winning', () => {
    // The pre-tier save shape kept one annual figure for the whole group. Left in place it beats
    // every tier rate, so typing a rate would appear to do nothing.
    ctx._finHealthPlanPremiumOverrides = { renewal: { medicalCents: 9999900 } };
    expect(ctx.finComputeHealthPlanTotalCents('renewal').medicalCents).toBe(9999900);
    ctx.finCompTierRateChange('renewal', 'family', '2200');
    expect(ctx.finComputeHealthPlanTotalCents('renewal').medicalCents).toBe(220000 * 2 * 12);
  });
});

describe('what the worker pays for a richer plan', () => {
  it('is the tier rate difference, which is what the breakeven turns on', () => {
    // Renewal Family $2,051.00 -> Option 1 $2,388.15 is $337.15/mo = $4,045.80/yr, the figure the
    // "is it worth it?" analysis has always quoted. Dental and vision are identical across the
    // renewal options and cancel.
    expect(ctx.finCompPerHouseholdDiffCents('renewal', 'option1')).toBe(404580);
    expect(ctx.finCompPerHouseholdDiffCents('renewal', 'option3')).toBe(-254568);
  });

  it('is answered per tier, so a Self worker is not quoted a Family difference', () => {
    expect(ctx.finCompPerHouseholdDiffCents('renewal', 'option1', 'self')).toBe((89110 - 76530) * 12);
  });
});

describe('how the rates page reads', () => {
  function render(view) {
    ctx.__store['fin-comp-root'] = ctx.__el();
    ctx._finCompView = view;
    ctx.finRenderCompensation();
    return ctx.__store['fin-comp-root'].innerHTML;
  }

  it('offers a monthly box for every tier of every option', () => {
    const html = render('rates');
    ['renewal', 'option1', 'option2', 'option3'].forEach(k => {
      ['self', 'selfSpouse', 'selfChild', 'family'].forEach(t => {
        expect(html).toContain('fin-comp-tier-' + k + '-' + t);
      });
    });
    expect(html).toContain('Self &amp; Spouse / mo');
  });

  it('shows the live enrolment rather than asking for it twice', () => {
    ctx.finCompSetHealthTier(1, 'self');
    const html = render('rates');
    expect(html).toContain('Enrolled now');
    expect(html).toContain('Counted from the roster');
    expect(html).not.toContain('fin-comp-contracts');
  });

  it('names each worker tier and its rate on the health view', () => {
    ctx.finCompSetHealthTier(1, 'selfSpouse');
    const html = render('health');
    expect(html).toContain('Self &amp; Spouse');
    expect(html).toContain('$1,538.25/mo');
  });
});
