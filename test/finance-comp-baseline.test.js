import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Reported from the Compensation strip: "No raise applied to all 7 workers" printed alongside
// +$111,624 (+34.0%) against FY2026. No raise cannot cost a third more, and the reporter's own
// guess was right — the two sides of that subtraction were not the same question.
//
// Two independent errors, both inflating the delta:
//
//   (1) SCOPE. The FY{target} total is salary + pension + disability + health + employer FICA.
//       The FY{base} figure matched only /salar|payroll|compensation|wages/ and
//       /health|medical|dental|vision|disability/ — no pension, no payroll taxes. Those two cost
//       categories were counted on the plan side and never looked for on the base side.
//   (2) PERIOD. totalActualCents for a base year still in progress is year-to-date, and the plan
//       is a whole year. In August that compares roughly eight months against twelve.
//
// These run the real built bundle in a vm, the way the sibling compensation tests do — the
// functions read a dozen module-level globals and a real load is the only honest way to drive them.
function makeCtx() {
  const store = {};
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

const leaf = (label, actual, budget) => ({
  label, path: 'Expenses:' + label, children: [], classification: 'Expenses', depth: 1,
  hasBudgetInfo: budget != null, totalActualCents: actual, totalBudgetCents: budget || 0,
});
const tree = (leaves) => [{
  label: 'Expenses', path: 'Expenses', classification: 'Expenses', depth: 0, hasBudgetInfo: true,
  totalActualCents: 0, totalBudgetCents: 0, children: leaves,
}];

// A complete past year, so nothing is annualized unless a test asks for it.
function seed(ctx, leaves, opts) {
  opts = opts || {};
  ctx._userRole = 'admin';
  ctx._finPlanBaseYear = opts.baseYear || 2024;
  ctx._finPlanTargetYear = (opts.baseYear || 2024) + 1;
  ctx._finPlanBaseTree = tree(leaves);
  ctx._finCompMethod = 'none';
  ctx._finCompPerWorkerMethod = {};
  ctx._finCompOverrides = {};
  ctx._finSalaryRoster = opts.roster || [];
  // This whole file is about the LEDGER basis — reading the base year out of the church accounts.
  // The tab now defaults to computing the base year from the roster instead (like-for-like, so
  // "no raise" reads as no change), so these tests pin the basis they are actually testing.
  ctx._finCompBaseYearBasis = 'ledger';
  return ctx;
}

describe('the FY base-year figure covers the same cost categories as the plan', () => {
  it('counts pension and payroll taxes, which the plan total charges for', () => {
    const ctx = makeCtx();
    seed(ctx, [
      leaf('58001 Pastor Salary', 10000000, 10000000),
      leaf('59030 Concordia Pension', 1170000, 1170000),
      leaf('59040 Payroll Taxes (FICA)', 765000, 765000),
      leaf('59035 Health Insurance', 2900000, 2900000),
    ]);
    const labels = ctx.finCompBaselineDetail().rows.map(r => r.label);
    expect(labels).toContain('59030 Concordia Pension');
    expect(labels).toContain('59040 Payroll Taxes (FICA)');
    expect(ctx.finCompBaselineCents()).toBe(10000000 + 1170000 + 765000 + 2900000);
  });

  it('still refuses "52040 Insurance" — property cover, not staff cost', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000), leaf('52040 Insurance', 4000000, 4000000)]);
    expect(ctx.finCompBaselineDetail().rows.map(r => r.label)).toEqual(['58001 Pastor Salary']);
  });

  it('refuses a benevolence account that merely names Concordia', () => {
    // /concordia/ would have swept "Concordia Children's Services" — money forwarded to a third
    // party — into the church's own staff cost.
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000), leaf("25010 Concordia Children's Services", 600000, 600000)]);
    expect(ctx.finCompBaselineDetail().rows.map(r => r.label)).toEqual(['58001 Pastor Salary']);
  });

  it('never counts an income account, however it is named', () => {
    const ctx = makeCtx();
    const income = { label: '40085 Retirement Distribution', path: 'Income:40085', children: [], classification: 'Income', depth: 1, hasBudgetInfo: false, totalActualCents: 5000000, totalBudgetCents: 0 };
    ctx._userRole = 'admin';
    ctx._finCompBaseYearBasis = 'ledger';
    ctx._finPlanBaseYear = 2024; ctx._finPlanTargetYear = 2025;
    ctx._finPlanBaseTree = [
      { label: 'Revenue', path: 'Income', classification: 'Income', depth: 0, hasBudgetInfo: false, totalActualCents: 5000000, totalBudgetCents: 0, children: [income] },
      ...tree([leaf('58001 Pastor Salary', 10000000, 10000000)]),
    ];
    expect(ctx.finCompBaselineCents()).toBe(10000000);
  });
});

describe('both sides of the comparison are a full year', () => {
  it('prefers an account\'s own full-year budget over its year-to-date actual', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 6000000, 10000000)]);
    const d = ctx.finCompBaselineDetail();
    expect(d.cents).toBe(10000000);
    expect(d.rows[0].basis).toBe('budget');
  });

  it('annualizes an actual with no budget when the base year is still running', () => {
    const ctx = makeCtx();
    const now = new Date();
    seed(ctx, [leaf('58001 Pastor Salary', 5000000, null)], { baseYear: now.getFullYear() });
    const d = ctx.finCompBaselineDetail();
    expect(d.prorated, 'the current year is by definition incomplete').toBe(true);
    expect(d.cents).toBe(Math.round(5000000 * (52 / d.weeks)));
    expect(d.cents).toBeGreaterThan(5000000);
    expect(d.rows[0].basis).toBe('annualized');
  });

  it('leaves a completed past year exactly as reported', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 5000000, null)], { baseYear: 2024 });
    const d = ctx.finCompBaselineDetail();
    expect(d.prorated).toBe(false);
    expect(d.cents).toBe(5000000);
    expect(d.rows[0].basis).toBe('actual');
  });
});

describe('the reported symptom: no raise must not read as a large increase', () => {
  // One worker, paid from one account, with the church's real cost categories all present in the
  // base year. Under "No raise" the plan should land within a rounding step of the base year.
  function oneWorkerCtx() {
    const ctx = makeCtx();
    const salary = 10000000;
    // The base year's benefit accounts are derived from the SAME rate lookups the plan side uses,
    // so this test measures the scope/period fix and never the rate tables.
    seed(ctx, [], { baseYear: 2026 });
    const pension = Math.round(salary * ctx.finCompPensionRate(2027).rate);
    const disability = Math.round(salary * ctx.finCompDisabilityRate(2027, true).rate);
    const fica = Math.round(salary * ctx.finCompFicaRate());
    ctx._finPlanBaseTree = tree([
      leaf('58001 Pastor Salary', salary, salary),
      leaf('59030 Pension', pension, pension),
      leaf('59016 Disability & Accident', disability, disability),
      leaf('59040 Payroll Taxes FICA', fica, fica),
    ]);
    ctx._finSalaryRoster = [{
      name: 'Test Worker', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
      education: 'associates', yearsExperience: 12, accountCode: '58001',
      actualSalaryCents: salary, hasDependents: true, healthMode: 'optout', concordia: {},
    }];
    return ctx;
  }

  it('lands within a percent of the base year rather than a third above it', () => {
    const ctx = oneWorkerCtx();
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    const pct = totals.deltaCents / totals.baselineCents * 100;
    expect(Math.abs(pct), 'no raise, same benefits — the two sides should nearly cancel').toBeLessThan(1);
  });

  it('would have read as a large jump when pension and FICA were missing from the base year', () => {
    // Reproduces the reported arithmetic directly: drop the two categories the old match could not
    // see and the same unchanged plan reads as a double-digit increase.
    const ctx = oneWorkerCtx();
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    const salaryAndHealthOnly = ctx.finCompBaselineDetail().rows
      .filter(r => /salar|health/i.test(r.label)).reduce((s, r) => s + r.cents, 0);
    const oldPct = (totals.totalCents - salaryAndHealthOnly) / salaryAndHealthOnly * 100;
    expect(oldPct).toBeGreaterThan(15);
  });
});

describe('the comparison prints its own working', () => {
  function noteCtx() {
    const ctx = makeCtx();
    seed(ctx, [
      leaf('58001 Pastor Salary', 10000000, 10000000),
      leaf('59030 Pension', 1170000, 1170000),
    ], { roster: [{ name: 'Test Worker', position: 'Other Church Worker', accountCode: '58001', actualSalaryCents: 10000000 }] });
    return ctx;
  }

  it('names every account it counted, and on what basis', () => {
    const ctx = noteCtx();
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toContain('58001 Pastor Salary');
    expect(html).toContain('59030 Pension');
    expect(html).toContain('budget');
  });

  it('says what the plan side holds, so the two are comparable on their face', () => {
    const ctx = noteCtx();
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toMatch(/pension, disability, health, employer FICA/);
  });

  it('says plainly when the ledger has no compensation accounts at all', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('52040 Insurance', 4000000, 4000000)]);
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toContain('no compensation accounts were found');
  });
});

describe('"% of scale" growth method', () => {
  function scaleCtx() {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000)], {
      baseYear: 2026,
      roster: [{ name: 'Test Worker', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
                 education: 'associates', yearsExperience: 12, accountCode: '58001',
                 actualSalaryCents: 10000000, healthMode: 'optout', concordia: {} }],
    });
    return ctx;
  }

  it('is offered alongside the other methods', () => {
    const ctx = makeCtx();
    expect(ctx.FIN_COMP_METHODS).toContain('scalepct');
  });

  it('is exactly that share of the district scale figure', () => {
    const ctx = scaleCtx();
    const w = ctx._finSalaryRoster[0];
    const scale = ctx.finCompWorksheetCents(w);
    expect(scale, 'the fixture worker must have a district figure').toBeGreaterThan(0);
    ctx._finCompScalePct = 90;
    expect(ctx.finCompMethodSalaryCents(w, 'scalepct')).toBe(ctx.finRoundSalaryCents(Math.round(scale * 0.9)));
    ctx._finCompScalePct = 100;
    expect(ctx.finCompMethodSalaryCents(w, 'scalepct')).toBe(ctx.finCompMethodSalaryCents(w, 'worksheet'));
  });

  it('is a share of SCALE, not of current pay — that is what Custom already does', () => {
    const ctx = scaleCtx();
    const w = ctx._finSalaryRoster[0];
    ctx._finCompScalePct = 90;
    expect(ctx.finCompMethodSalaryCents(w, 'scalepct')).not.toBe(ctx.finRoundSalaryCents(Math.round(10000000 * 0.9)));
  });

  it('shows nothing rather than $0 for a worker with no district figure', () => {
    // A share of a scale that does not exist is unanswerable, not zero — and a zero here would
    // quietly propose cutting someone's pay to nothing.
    const ctx = scaleCtx();
    ctx._finCompScalePct = 90;
    expect(ctx.finCompMethodSalaryCents({ name: 'No role' }, 'scalepct')).toBe(null);
  });

  it('carries the percentage in its own label', () => {
    const ctx = makeCtx();
    ctx._finCompScalePct = 92;
    expect(ctx.finCompMethodLabel('scalepct')).toBe('92% of Scale');
    expect(ctx.finCompMethodLongLabel('scalepct')).toContain('92% of the District');
  });

  it('selecting the percentage box switches everyone onto the method', () => {
    const ctx = scaleCtx();
    ctx.finCompScalePctChange('88');
    expect(ctx._finCompScalePct).toBe(88);
    expect(ctx._finCompMethod).toBe('scalepct');
  });

  it('is saved with the rest of the planner, so it survives a reload', () => {
    const ctx = scaleCtx();
    ctx._finCompScalePct = 88;
    expect(ctx.finSalaryBuildSaveBody().compScalePct).toBe(88);
  });

  it('renders as its own column without breaking the add-a-worker row span', () => {
    const ctx = scaleCtx();
    const computed = ctx.finCompComputeAll();
    const html = ctx.finCompRenderPlan(computed, ctx.finCompTotals(computed));
    expect(html).toContain('% of Scale');
    const headCount = (html.match(/<th class="fin-comp-th/g) || []).length;
    const span = Number(html.match(/colspan="(\d+)"/)[1]);
    expect(span, 'the add row must span the whole table').toBe(headCount);
  });
});

// A second report, in the opposite direction: with the scope and period fixed, the strip read
// −$28,752 (−6.1%) — no raise, rising benefit rates, and the plan somehow CHEAPER than the base
// year. Same root cause class as the first report, one level down: not the cost categories this
// time but the POPULATION. The plan covers exactly the counted roster; the base year covers
// whoever the church actually paid, which includes departed or vacant posts and anyone excluded
// as paid from another budget. Left in, the base is inflated and a flat plan reads as a saving.
describe('the base year must cover the same people as the plan', () => {
  function ctxWithStranger() {
    const ctx = makeCtx();
    seed(ctx, [
      leaf('58001 Pastor Salary', 10000000, 10000000),
      leaf('58004 MDO Wages', 4094478, 4094478),     // nobody on the roster is paid from this
      leaf('59030 Pension', 1170000, 1170000),
    ], {
      roster: [{ name: 'Test Worker', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
                 education: 'associates', yearsExperience: 12, accountCode: '58001',
                 actualSalaryCents: 10000000, healthMode: 'optout', concordia: {} }],
    });
    return ctx;
  }

  it('names the salary account nobody on the roster is paid from', () => {
    const ctx = ctxWithStranger();
    const d = ctx.finCompBaselineDetail();
    expect(d.unmatchedRows.map(r => r.label)).toEqual(['58004 MDO Wages']);
    expect(d.unmatchedCents).toBe(4094478);
  });

  it('attributes a salary account to the worker paid from it', () => {
    const ctx = ctxWithStranger();
    const pastor = ctx.finCompBaselineDetail().rows.find(r => r.label === '58001 Pastor Salary');
    expect(pastor.rosterNames).toEqual(['Test Worker']);
    expect(pastor.kind).toBe('salary');
  });

  it('never attributes a pooled benefit line to one person', () => {
    // Pension, health and employer taxes are charged for the whole staff on one line; claiming
    // one worker owns that line would be a made-up split.
    const ctx = ctxWithStranger();
    const pension = ctx.finCompBaselineDetail().rows.find(r => r.label === '59030 Pension');
    expect(pension.kind).toBe('benefit');
    expect(pension.rosterNames).toEqual([]);
  });

  it('reads "59040 Payroll Taxes" as a pooled tax, not as somebody\'s wages', () => {
    // It matches /payroll/ in the account filter and must not therefore look like a salary line.
    const ctx = makeCtx();
    seed(ctx, [leaf('59040 Payroll Taxes (FICA)', 765000, 765000)]);
    expect(ctx.finCompBaselineDetail().rows[0].kind).toBe('benefit');
  });

  it('drops the stranger from the total once asked to compare like for like', () => {
    const ctx = ctxWithStranger();
    const all = ctx.finCompBaselineDetail().cents;
    ctx._finCompBaselineRosterOnly = true;
    const likeForLike = ctx.finCompBaselineDetail().cents;
    expect(all - likeForLike).toBe(4094478);
    // Pooled benefits stay: they cannot be split, which the note says in as many words.
    expect(likeForLike).toBe(10000000 + 1170000);
  });

  it('turns a flat plan from a spurious saving into a real increase', () => {
    const ctx = ctxWithStranger();
    const before = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(before.deltaCents, 'the stranger makes the base look bigger than the plan').toBeLessThan(0);
    ctx._finCompBaselineRosterOnly = true;
    const after = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(after.deltaCents, 'like for like, benefits rising means the plan costs more').toBeGreaterThan(0);
  });

  it('refuses the restriction when NO salary account is attributed', () => {
    // An unlinked roster would match nothing, and applying it would delete the whole salary side
    // of the base year — a worse number than the one it set out to fix.
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000)], {
      roster: [{ name: 'Unlinked', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
                 education: 'associates', yearsExperience: 12, accountCode: '', actualSalaryCents: 10000000,
                 healthMode: 'optout', concordia: {} }],
    });
    ctx._finCompBaselineRosterOnly = true;
    const d = ctx.finCompBaselineDetail();
    expect(d.canRosterOnly).toBe(false);
    expect(d.rosterOnly).toBe(false);
    expect(d.cents).toBe(10000000);
  });

  it('says nothing about strangers when every salary account is attributed', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000)], {
      roster: [{ name: 'Test Worker', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
                 education: 'associates', yearsExperience: 12, accountCode: '58001',
                 actualSalaryCents: 10000000, healthMode: 'optout', concordia: {} }],
    });
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toContain('both sides cover the same people');
    expect(html).not.toContain('NOT on this roster');
  });

  it('calls the mismatch out by name, figure and consequence', () => {
    const ctx = ctxWithStranger();
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toContain('NOT on this roster');
    expect(html).toContain('58004 MDO Wages');
    expect(html).toContain('$40,945');
    expect(html, 'the reader must be told which way it biases the answer').toContain('reads cheaper than it is');
    expect(html).toContain('finCompToggleBaselineRosterOnly');
  });

  it('the toggle flips the reading and is saved with the planner', () => {
    const ctx = ctxWithStranger();
    ctx.finCompToggleBaselineRosterOnly();
    expect(ctx._finCompBaselineRosterOnly).toBe(true);
    expect(ctx.finSalaryBuildSaveBody().compBaselineRosterOnly).toBe(true);
    ctx.finCompToggleBaselineRosterOnly();
    expect(ctx._finCompBaselineRosterOnly).toBe(false);
  });
});

// ── The base year computed from the ROSTER ────────────────────────────────────────────────────
//
// Reported repeatedly: under "No raise" FY{target} kept coming out BELOW FY{base}. The cause was
// never arithmetic — the ledger basis measures every payroll-ish ACCOUNT, which at this church also
// carries daycare/MDO staff, supply preachers and nursery wages, while the plan measures seven
// named people. Pooled benefit accounts can never be split per person, so no account-level rule
// fixes it. This basis runs the same model over the same roster at the base year's own rates.
describe('the base year computed from the roster', () => {
  function rosterCtx(opts) {
    const ctx = makeCtx();
    seed(ctx, [
      leaf('58001 Pastor Salary', 9880000, 9880000),
      leaf('58010 Music Salary', 7451600, 7451600),
      leaf('58050 MDO Payroll', 4094478, 4094478),        // another section's staff
      leaf('59035 Health Insurance', 6800000, 6800000),   // covers the daycare too
    ], {
      baseYear: 2026,
      roster: [
        { name: 'Andrew', role: 'pastor', trackKey: '', yearsExperience: 20, accountCode: '58001',
          selfEmployedFica: true, hasDependents: true, healthMode: 'family', concordia: {} },
        { name: 'Jinah', role: 'other', trackKey: 'business_manager_music', yearsExperience: 20,
          accountCode: '58010', selfEmployedFica: false, hasDependents: true, healthMode: 'family', concordia: {} },
      ],
    });
    ctx._finCompBaseYearBasis = 'roster';
    ctx._finHealthPlanSelectedOption = 'renewal';
    ctx._finCompBasePlanOption = 'current';
    ctx._finHealthPlanPremiumOverrides = {};
    ctx._finSalaryReferenceByYear = {};
    Object.assign(ctx, opts || {});
    return ctx;
  }

  it('lands at no change under "No raise" — the whole point', () => {
    const ctx = rosterCtx();
    // Same plan both years removes the premium renewal, isolating "no raise means no change".
    ctx._finCompBasePlanOption = 'renewal';
    ctx._finSalaryReferenceByYear = { 2026: { pensionPct: 0.117 }, 2027: { pensionPct: 0.117 } };
    const t = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(t.deltaCents).toBe(0);
    expect(t.baselineCents).toBe(t.totalCents);
  });

  it('shows a real increase when only the rates move', () => {
    const ctx = rosterCtx();
    // Pension 10.70% -> 11.70% and the premium renewal, with salaries flat.
    const t = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(t.salaryCents).toBe(ctx.finCompRosterBaselineDetail().salaryCents);
    expect(t.deltaCents).toBeGreaterThan(0);
  });

  it('never lets another section\'s payroll into either side', () => {
    const ctx = rosterCtx();
    const r = ctx.finCompRosterBaselineDetail();
    // 58050 MDO Payroll is in the ledger figure and must not be in this one.
    expect(r.salaryCents).toBe(9880000 + 7451600);
    ctx._finCompBaseYearBasis = 'ledger';
    expect(ctx.finCompBaselineCents()).toBeGreaterThan(r.cents);
  });

  it('prices base-year health on the plan in force then, at the church\'s own figure', () => {
    const ctx = rosterCtx();
    // Current plan, family tier: $1,887.36 + $120.61 dental + $61.32 vision a month.
    expect(ctx.finCompWorkerHealthCents(ctx._finSalaryRoster[0], 'current', 2026)).toBe(2483148);
    // Renewal, the target year: $2,051.00 + $126.95 + $61.32.
    expect(ctx.finCompWorkerHealthCents(ctx._finSalaryRoster[0], 'renewal', 2027)).toBe(2687124);
  });

  it('uses the base year\'s own pension rate, not the target year\'s', () => {
    const ctx = rosterCtx();
    const r = ctx.finCompRosterBaselineDetail();
    const called = 9880000 + 7451600;
    expect(r.pensionCents).toBe(Math.round(called * 0.107));   // 2026
    const plan = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(plan.benefitsCents).toBeGreaterThan(r.benefitCents); // 11.70% in 2027
  });

  it('takes the base year opt-out figure from the base year, not a per-worker planning override', () => {
    const ctx = rosterCtx();
    ctx._finSalaryRoster[1].healthMode = 'optout';
    ctx._finSalaryRoster[1].healthOptOutOverrideCents = 999900; // a FY2027 planning figure
    ctx._finSalaryReferenceByYear = { 2026: { healthOptOutCents: 492856 } };
    expect(ctx.finCompWorkerHealthCents(ctx._finSalaryRoster[1], 'current', 2026)).toBe(492856);
    // The target year still honours the per-worker override.
    expect(ctx.finCompWorkerHealthCents(ctx._finSalaryRoster[1], 'renewal', 2027)).toBe(999900);
  });

  it('is what the tab uses by default, with the ledger still reachable', () => {
    const ctx = rosterCtx();
    expect(ctx._finCompBaseYearBasis).toBe('roster');
    expect(ctx.finCompActiveBaseline().basis).toBe('roster');
    ctx.finCompSetBaseYearBasis('ledger');
    expect(ctx.finCompActiveBaseline().basis).toBeUndefined(); // the ledger detail shape
    expect(ctx.finCompBaselineCents()).toBeGreaterThan(0);
  });
});
