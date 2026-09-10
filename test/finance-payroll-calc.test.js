import { describe, expect, it } from 'vitest';
import {
  cents, fromCents, money, calc403b, takesPto, baseEarnings, calcGross, calcMdoGross,
  effectiveChurch, effectiveMdo, mergeMdoHours, mdoPtoMapFrom, mdoRateSnapshotMapFrom,
  reportGroups, subtotal, exportReport, missingHours, payablePeople,
} from '../apps/finance/payroll-calc.js';

describe('payroll-calc money basics', () => {
  it('rounds to cents the way Website does', () => {
    expect(cents(19.999)).toBe(2000);
    expect(cents('not a number')).toBe(0);
    expect(fromCents(2000)).toBe(20);
    expect(money(1234.5)).toBe('$1,234.50');
  });

  it('computes 403(b) as a fixed amount or a percentage of base earnings', () => {
    expect(calc403b({ retirement_403b_amount: 0 }, 1000)).toBe(0);
    expect(calc403b({ retirement_403b_type: 'fixed', retirement_403b_amount: 50 }, 1000)).toBe(50);
    expect(calc403b({ retirement_403b_type: 'percent', retirement_403b_amount: 0.05 }, 1000)).toBe(50);
  });

  it('only hourly people take PTO', () => {
    expect(takesPto('salary')).toBe(false);
    expect(takesPto('hourly')).toBe(true);
  });
});

describe('baseEarnings / calcGross — PY-2: line items must add up to the gross', () => {
  it('salaried base earnings is the flat salary, ignoring any hours on file', () => {
    const s = { pay_type: 'salary', base_salary_biweekly: 2000 };
    expect(baseEarnings(s, { hours_worked: 999 })).toBe(2000);
  });

  it('hourly base earnings includes PTO hours at the same rate as worked hours', () => {
    const s = { pay_type: 'hourly', hourly_rate: 20 };
    expect(baseEarnings(s, { hours_worked: 60, pto_hours_used: 5 })).toBe(65 * 20);
  });

  it('gross combines base, four allowances, minus 403(b), all rounded to cents before summing (PY-6)', () => {
    const s = {
      pay_type: 'hourly', hourly_rate: 19.995, // a rate that produces a fractional-cent base
      housing_allowance_biweekly: 100, insurance_opt_out_biweekly: 50,
      hsa_contribution_biweekly: 25, mileage_biweekly: 10,
      retirement_403b_type: 'fixed', retirement_403b_amount: 15,
    };
    const entry = { hours_worked: 10, pto_hours_used: 0 };
    // base = 199.95 -> cents(199.95) = 19995 (never 19994/19996 from float noise)
    const expectedCents = 19995 + 10000 + 5000 + 2500 + 1000 - 1500;
    expect(cents(calcGross(s, entry))).toBe(expectedCents);
  });

  it('a salaried MDO person is paid the flat salary regardless of hours or PTO maps', () => {
    const s = { pay_type: 'salary', salary_biweekly: 1500 };
    expect(calcMdoGross(s, 999, 999)).toBe(1500);
  });

  it('an hourly MDO person is paid (hours + PTO) times the rate', () => {
    const s = { pay_type: 'hourly', hourly_rate: 22 };
    expect(calcMdoGross(s, 40, 8)).toBe(48 * 22);
  });
});

describe('effectiveChurch / effectiveMdo — the rate freeze', () => {
  const staff = { id: 1, pay_type: 'hourly', hourly_rate: 25, base_salary_biweekly: 0 };
  const entryWithFreeze = {
    hourly_rate_used: 20, pay_type_used: 'hourly', base_salary_used: 0,
    housing_allowance_used: 0, insurance_opt_out_used: 0, hsa_contribution_used: 0,
    mileage_used: 0, retirement_403b_type_used: 'fixed', retirement_403b_amount_used: 0,
  };

  it('reads the live rate when the period is not approved, even with a frozen row present', () => {
    expect(effectiveChurch(staff, entryWithFreeze, false).hourly_rate).toBe(25);
  });

  it('reads the frozen rate once the period is approved', () => {
    expect(effectiveChurch(staff, entryWithFreeze, true).hourly_rate).toBe(20);
  });

  it('falls back to the live rate for an approved period with no frozen row (e.g. a newly added salaried person)', () => {
    expect(effectiveChurch(staff, null, true).hourly_rate).toBe(25);
    expect(effectiveChurch(staff, {}, true).hourly_rate).toBe(25);
  });

  it('does the same for MDO, from a rate snapshot instead of a period-entry row', () => {
    const mdoStaff = { id: 2, pay_type: 'hourly', hourly_rate: 30 };
    const snap = { pay_type: 'hourly', hourly_rate: 27, salary_biweekly: null };
    expect(effectiveMdo(mdoStaff, snap, false).hourly_rate).toBe(30);
    expect(effectiveMdo(mdoStaff, snap, true).hourly_rate).toBe(27);
    expect(effectiveMdo(mdoStaff, null, true).hourly_rate).toBe(30);
  });
});

describe('mergeMdoHours — manual entries win, clock events fill the rest, <10min sessions are dropped', () => {
  it('sums manual hours across multiple days for the same staff member', () => {
    const map = mergeMdoHours([
      { staff_id: 'a', work_date: '2026-06-01', hours_worked: '4' },
      { staff_id: 'a', work_date: '2026-06-02', hours_worked: '3.5' },
    ], []);
    expect(map.get('a')).toBe(7.5);
  });

  it('adds clock-event hours for a day that has no manual override', () => {
    const map = mergeMdoHours([], [
      { staff_id: 'b', work_date: '2026-06-01', clock_in: '2026-06-01T08:00:00Z', clock_out: '2026-06-01T12:00:00Z' },
    ]);
    expect(map.get('b')).toBe(4);
  });

  it('never double-counts a day that already has a manual entry, even if a clock event also exists for it', () => {
    const map = mergeMdoHours(
      [{ staff_id: 'c', work_date: '2026-06-01', hours_worked: '5' }],
      [{ staff_id: 'c', work_date: '2026-06-01', clock_in: '2026-06-01T08:00:00Z', clock_out: '2026-06-01T16:00:00Z' }],
    );
    expect(map.get('c')).toBe(5);
  });

  it('treats a session under 10 minutes as a forgotten clock-out, not real time worked', () => {
    const map = mergeMdoHours([], [
      { staff_id: 'd', work_date: '2026-06-01', clock_in: '2026-06-01T08:00:00Z', clock_out: '2026-06-01T08:05:00Z' },
    ]);
    expect(map.has('d')).toBe(false);
  });

  it('ignores a clock event missing either timestamp', () => {
    const map = mergeMdoHours([], [{ staff_id: 'e', work_date: '2026-06-01', clock_in: null, clock_out: '2026-06-01T09:00:00Z' }]);
    expect(map.has('e')).toBe(false);
  });
});

describe('mdoPtoMapFrom / mdoRateSnapshotMapFrom', () => {
  it('only keeps positive PTO amounts', () => {
    const map = mdoPtoMapFrom([{ staff_id: 'a', pto_hours_used: 4 }, { staff_id: 'b', pto_hours_used: 0 }]);
    expect(map.get('a')).toBe(4);
    expect(map.has('b')).toBe(false);
  });

  it('keys the rate snapshot by staff_id', () => {
    const map = mdoRateSnapshotMapFrom([{ staff_id: 'a', hourly_rate: 21 }]);
    expect(map.get('a').hourly_rate).toBe(21);
  });
});

describe('reportGroups / subtotal — a person with no pay is left out (PY behavior)', () => {
  const churchStaff = [
    { id: 1, name: 'Salaried Pastor', pay_type: 'salary', base_salary_biweekly: 2000, housing_allowance_biweekly: 0, insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0, retirement_403b_amount: 0 },
    { id: 2, name: 'Hourly No Hours', pay_type: 'hourly', hourly_rate: 20, housing_allowance_biweekly: 0, insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0, retirement_403b_amount: 0 },
    { id: 3, name: 'Hourly Worked', pay_type: 'hourly', hourly_rate: 20, housing_allowance_biweekly: 0, insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0, retirement_403b_amount: 0 },
  ];
  const periodEntries = new Map([[3, { hours_worked: 10, pto_hours_used: 0 }]]);
  const mdoStaff = [];
  const mdoHoursMap = new Map();
  const mdoPtoMap = new Map();
  const mdoRateSnapshot = new Map();

  it('excludes zero-gross people rather than showing a $0.00 row', () => {
    const groups = reportGroups({ churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, periodApproved: false });
    const names = groups.find((g) => g.key === 'church').people.map((p) => p.name);
    expect(names).toContain('Salaried Pastor');
    expect(names).toContain('Hourly Worked');
    expect(names).not.toContain('Hourly No Hours');
  });

  it('subtotal sums cents-rounded gross, never drifting from the visible line items', () => {
    const groups = reportGroups({ churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, periodApproved: false });
    const church = groups.find((g) => g.key === 'church');
    expect(subtotal(church.people)).toBe(2000 + 200);
  });

  it('missingHours flags only hourly people with no hours entered', () => {
    const missing = missingHours(churchStaff, periodEntries);
    expect(missing.map((s) => s.name)).toEqual(['Hourly No Hours']);
  });

  it('payablePeople counts every church row plus any MDO row with pay or PTO', () => {
    expect(payablePeople(churchStaff, [], new Map(), new Map())).toBe(3);
    const mdo = [{ id: 'm1', pay_type: 'salary' }, { id: 'm2', pay_type: 'hourly' }];
    expect(payablePeople(churchStaff, mdo, new Map([['m2', 5]]), new Map())).toBe(5);
  });
});

describe('exportReport — MDO first, then Church (deliberately not reportGroups() order)', () => {
  it('builds both row sets with subtotals and a combined total', () => {
    const churchStaff = [{ id: 1, name: 'Pastor', pay_type: 'salary', base_salary_biweekly: 1000, housing_allowance_biweekly: 0, insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0, retirement_403b_amount: 0 }];
    const mdoStaff = [{ id: 'm1', name: 'Teacher', pay_type: 'hourly', hourly_rate: 15 }];
    const periodEntries = new Map();
    const mdoHoursMap = new Map([['m1', 20]]);
    const mdoPtoMap = new Map();
    const mdoRateSnapshot = new Map();
    const report = exportReport({
      periodStart: '2026-06-01', periodEnd: '2026-06-14', periodLabel: 'Jun 1 – Jun 14, 2026',
      churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot,
      periodApproved: false, incomplete: false,
    });
    expect(report.mdo.rows).toHaveLength(1);
    expect(report.mdo.rows[0].gross).toBe(300);
    expect(report.church.rows).toHaveLength(1);
    expect(report.church.rows[0].gross).toBe(1000);
    expect(report.total).toBe(1300);
    expect(report.incomplete).toBe(false);
  });
});
