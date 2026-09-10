// ── PAYROLL MATH — ported faithfully from Website's admin/payroll.html ──────
// Website's payroll screen computes every gross pay figure client-side (it
// holds no server-side Supabase credentials of its own — see payroll.html's
// own header comment). Finance calls the SAME payroll_* RPCs through the
// contract relay (payroll-proxy-client.js) and must arrive at the exact same
// numbers from the exact same rows, or a bookkeeper reconciling one screen
// against the other finds two different answers for one payroll run.
//
// Kept as pure functions over explicit arguments (never module-level mutable
// state, unlike payroll.html's globals) so every rule here is independently
// testable against a fixed set of rows.
//
// ⚠ WHERE A PAY RATE COMES FROM: church rates are entered and saved here (via
// payroll_save_staff). MDO rates are read from the MDO app and are NEVER
// editable here — see effectiveMdo() and payroll-proxy-client.js. Do not add
// a rate field for an MDO person; it would create a second, silently
// diverging answer to what somebody is paid.

// Every gross is rounded to cents BEFORE it is added to anything. Summing
// unrounded values and rounding the total afterwards makes a printed
// subtotal disagree with the rows above it by a cent (PY-6 in Website's
// payroll history).
export const cents = (n) => Math.round((Number(n) || 0) * 100);
export const fromCents = (c) => c / 100;
export const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const hrs = (n) => (Number(n) || 0).toFixed(2) + ' hrs';

export function calc403b(staff, baseEarningsAmount) {
  if (!staff.retirement_403b_amount) return 0;
  if (staff.retirement_403b_type === 'percent') return baseEarningsAmount * Number(staff.retirement_403b_amount);
  return Number(staff.retirement_403b_amount);
}

// PTO is an hourly idea. A salaried person is paid the same whether or not
// they take the day off, so hours "used" against them cost nothing.
export const takesPto = (payType) => payType !== 'salary';

// The base earnings figure, computed once and used by both the gross and the
// line items, so a person's card always adds up to their own Gross Pay (PY-2).
export function baseEarnings(staff, entry) {
  if (staff.pay_type === 'salary') return Number(staff.base_salary_biweekly) || 0;
  const hours = Number(entry?.hours_worked || 0);
  const ptoUsed = Number(entry?.pto_hours_used || 0);
  return (hours + ptoUsed) * (Number(staff.hourly_rate) || 0);
}

export function calcGross(staff, entry) {
  const base = baseEarnings(staff, entry);
  return fromCents(cents(base)
    + cents(staff.housing_allowance_biweekly) + cents(staff.insurance_opt_out_biweekly)
    + cents(staff.hsa_contribution_biweekly) + cents(staff.mileage_biweekly)
    - cents(calc403b(staff, base)));
}

export function calcMdoGross(staff, mdoHours, mdoPto) {
  if (staff.pay_type === 'salary') return fromCents(cents(staff.salary_biweekly));
  const hours = Number(mdoHours || 0);
  const pto = Number(mdoPto || 0);
  return fromCents(cents((hours + pto) * (Number(staff.hourly_rate) || 0)));
}

// ── RATE FREEZE — a raise must never rewrite a period that already ran ──────
// church_staff / the MDO app's staff table hold only the CURRENT rate, so
// reading it directly would recompute EVERY period at today's number the
// moment somebody typed a new one in. Once a period is approved,
// payroll_save_hours/payroll_approve_period snapshot the rate that was live
// at that moment onto the period's own row; these two read that snapshot
// back instead of the live record, for an approved period only. A period not
// yet approved has nothing to freeze, and correctly keeps reading live.
export function effectiveChurch(staff, entry, periodApproved) {
  if (!periodApproved || !entry || entry.hourly_rate_used === undefined || entry.hourly_rate_used === null) return staff;
  return {
    ...staff,
    pay_type: entry.pay_type_used || staff.pay_type,
    hourly_rate: entry.hourly_rate_used,
    base_salary_biweekly: entry.base_salary_used,
    housing_allowance_biweekly: entry.housing_allowance_used,
    insurance_opt_out_biweekly: entry.insurance_opt_out_used,
    hsa_contribution_biweekly: entry.hsa_contribution_used,
    mileage_biweekly: entry.mileage_used,
    retirement_403b_type: entry.retirement_403b_type_used,
    retirement_403b_amount: entry.retirement_403b_amount_used,
  };
}

export function effectiveMdo(staff, snapshot, periodApproved) {
  if (!periodApproved || !snapshot) return staff;
  return { ...staff, pay_type: snapshot.pay_type, hourly_rate: snapshot.hourly_rate, salary_biweekly: snapshot.salary_biweekly };
}

// ── MDO HOURS — manual entries plus computed clock-in/out durations ────────
// A staff/date pair with a manual payroll_get_mdo_hours row wins outright;
// clock events for that same pair are never also added, or a manually
// corrected day would double-count. A session under 10 minutes is treated as
// a forgotten clock-out, not real time worked.
export function mergeMdoHours(manualHoursRows, clockEventRows) {
  const map = new Map();
  const manualKeys = new Set((manualHoursRows || []).map((row) => `${row.staff_id}|${row.work_date}`));
  for (const row of manualHoursRows || []) {
    map.set(row.staff_id, (map.get(row.staff_id) || 0) + parseFloat(row.hours_worked));
  }
  const clockHours = (ev) => {
    if (!ev.clock_in || !ev.clock_out) return 0;
    const ms = new Date(ev.clock_out) - new Date(ev.clock_in);
    return ms < 600000 ? 0 : Math.round((ms / 3600000) * 100) / 100;
  };
  for (const ev of clockEventRows || []) {
    if (manualKeys.has(`${ev.staff_id}|${ev.work_date}`)) continue;
    const h = clockHours(ev);
    if (h > 0) map.set(ev.staff_id, (map.get(ev.staff_id) || 0) + h);
  }
  return map;
}

export function mdoPtoMapFrom(mdoPtoRows) {
  const map = new Map();
  for (const row of mdoPtoRows || []) {
    if (Number(row.pto_hours_used) > 0) map.set(row.staff_id, parseFloat(row.pto_hours_used));
  }
  return map;
}

export function mdoRateSnapshotMapFrom(mdoSnapshotRows) {
  const map = new Map();
  for (const row of mdoSnapshotRows || []) map.set(row.staff_id, row);
  return map;
}

// churchStaff: rows from payroll_get_staff. periodEntries: Map staff_id -> row
// from payroll_get_period_entries. mdoStaff: rows from payroll_get_mdo_staff.
// mdoHoursMap/mdoPtoMap: from mergeMdoHours()/mdoPtoMapFrom(). mdoRateSnapshot:
// from mdoRateSnapshotMapFrom(). periodApproved: !!periodApproval.
export function reportGroups({ churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, periodApproved }) {
  const church = churchStaff
    .map((s) => effectiveChurch(s, periodEntries.get(s.id), periodApproved))
    .filter((s) => calcGross(s, periodEntries.get(s.id)) > 0)
    .map((s) => {
      const entry = periodEntries.get(s.id) || {};
      return {
        id: s.id,
        name: s.name,
        basis: s.pay_type === 'salary' ? '—' : `${hrs(entry.hours_worked || 0)} @ ${money(s.hourly_rate)}`,
        pto: takesPto(s.pay_type) ? Number(entry.pto_hours_used || 0) : 0,
        hours: s.pay_type === 'salary' ? 0 : Number(entry.hours_worked || 0),
        salaried: s.pay_type === 'salary',
        gross: calcGross(s, entry),
        lines: churchLineItems(s, entry),
      };
    });
  const mdo = mdoStaff
    .map((s) => effectiveMdo(s, mdoRateSnapshot.get(s.id), periodApproved))
    .filter((s) => calcMdoGross(s, mdoHoursMap.get(s.id), mdoPtoMap.get(s.id)) > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      basis: s.pay_type === 'salary' ? '—' : `${hrs(mdoHoursMap.get(s.id) || 0)} @ ${money(s.hourly_rate)}`,
      pto: takesPto(s.pay_type) ? (mdoPtoMap.get(s.id) || 0) : 0,
      hours: s.pay_type === 'salary' ? 0 : (mdoHoursMap.get(s.id) || 0),
      salaried: s.pay_type === 'salary',
      gross: calcMdoGross(s, mdoHoursMap.get(s.id), mdoPtoMap.get(s.id)),
      lines: mdoLineItems(s, mdoPtoMap.get(s.id)),
    }));
  return [
    { key: 'church', name: 'Church staff', people: church },
    { key: 'mdo', name: 'Timothy MDO', people: mdo },
  ];
}

function lineItem(label, value, opts = {}) {
  return { label, value, muted: !!opts.muted, neg: !!opts.neg, total: !!opts.total };
}

function churchLineItems(staff, entry) {
  const isSalary = staff.pay_type === 'salary';
  const ptoUsed = Number(entry?.pto_hours_used || 0);
  const base = baseEarnings(staff, entry);
  const out = [];
  if (isSalary) {
    out.push(lineItem('Base Salary', money(staff.base_salary_biweekly)));
  } else {
    out.push(lineItem('Pay Rate', `${money(staff.hourly_rate)}/hr`));
    out.push(lineItem('Hours Worked', hrs(entry?.hours_worked || 0)));
  }
  if (Number(staff.housing_allowance_biweekly) > 0) out.push(lineItem('Housing Allowance', money(staff.housing_allowance_biweekly)));
  if (Number(staff.insurance_opt_out_biweekly) > 0) out.push(lineItem('Insurance Opt-Out', money(staff.insurance_opt_out_biweekly)));
  if (Number(staff.hsa_contribution_biweekly) > 0) out.push(lineItem('HSA Contribution', money(staff.hsa_contribution_biweekly)));
  if (Number(staff.mileage_biweekly) > 0) out.push(lineItem('Mileage', money(staff.mileage_biweekly)));
  const b403 = calc403b(staff, base);
  if (b403 > 0) {
    const label = staff.retirement_403b_type === 'percent'
      ? `403(b) Deduction (${(staff.retirement_403b_amount * 100).toFixed(2).replace(/\.?0+$/, '')}%)`
      : '403(b) Deduction';
    out.push(lineItem(label, `−${money(b403)}`, { neg: true }));
  }
  if (!isSalary) out.push(lineItem('PTO used', hrs(ptoUsed), { muted: ptoUsed === 0 }));
  return out;
}

function mdoLineItems(staff, mdoHoursForStaff) {
  const isSalary = staff.pay_type === 'salary';
  const out = [];
  if (isSalary) out.push(lineItem('Base Salary', money(staff.salary_biweekly)));
  else {
    out.push(lineItem('Pay Rate', `${money(staff.hourly_rate)}/hr`));
    out.push(lineItem('Hours Worked', hrs(mdoHoursForStaff || 0)));
  }
  return out;
}

export function subtotal(people) {
  return fromCents(people.reduce((n, p) => n + cents(p.gross), 0));
}

// The printed report, CSV and (eventually) emailed report are all built from
// this ONE shape, matching Website's exportReport() exactly — MDO first,
// Church second (the order the office has always sent out; deliberately NOT
// the same order as reportGroups(), which drives the on-screen layouts).
export function exportReport({ periodStart, periodEnd, periodLabel, churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, periodApproved, incomplete }) {
  const num = (v) => Number(v) || 0;

  const mdoRows = mdoStaff
    .map((s) => effectiveMdo(s, mdoRateSnapshot.get(s.id), periodApproved))
    .filter((s) => calcMdoGross(s, mdoHoursMap.get(s.id), mdoPtoMap.get(s.id)) > 0)
    .map((s) => ({
      name: s.name,
      salaried: s.pay_type === 'salary',
      rate: num(s.hourly_rate),
      hours: mdoHoursMap.get(s.id) || 0,
      pto: takesPto(s.pay_type) ? (mdoPtoMap.get(s.id) || 0) : 0,
      gross: calcMdoGross(s, mdoHoursMap.get(s.id), mdoPtoMap.get(s.id)),
    }));

  const churchRows = churchStaff
    .map((s) => effectiveChurch(s, periodEntries.get(s.id), periodApproved))
    .filter((s) => calcGross(s, periodEntries.get(s.id)) > 0)
    .map((s) => {
      const entry = periodEntries.get(s.id) || {};
      return {
        name: s.name,
        salaried: s.pay_type === 'salary',
        rate: num(s.hourly_rate),
        hours: num(entry.hours_worked),
        pto: takesPto(s.pay_type) ? num(entry.pto_hours_used) : 0,
        base: baseEarnings(s, entry),
        housing: num(s.housing_allowance_biweekly),
        optOut: num(s.insurance_opt_out_biweekly),
        hsa: num(s.hsa_contribution_biweekly),
        mileage: num(s.mileage_biweekly),
        b403: calc403b(s, baseEarnings(s, entry)),
        gross: calcGross(s, entry),
      };
    });

  const mdoSub = fromCents(mdoRows.reduce((n, p) => n + cents(p.gross), 0));
  const churchSub = fromCents(churchRows.reduce((n, p) => n + cents(p.gross), 0));
  return {
    periodStart, periodEnd, label: periodLabel,
    mdo: { rows: mdoRows, subtotal: mdoSub },
    church: { rows: churchRows, subtotal: churchSub },
    total: fromCents(cents(mdoSub) + cents(churchSub)),
    incomplete: !!incomplete,
  };
}

export function missingHours(churchStaff, periodEntries) {
  return churchStaff.filter((s) => s.pay_type === 'hourly' && !(Number(periodEntries.get(s.id)?.hours_worked) > 0));
}

// How many rows this period has. Approving an empty period would be a
// signature on nothing.
export function payablePeople(churchStaff, mdoStaff, mdoHoursMap, mdoPtoMap) {
  let n = churchStaff.length;
  for (const s of mdoStaff) {
    const h = mdoHoursMap.get(s.id) || 0;
    const pto = mdoPtoMap.get(s.id) || 0;
    if (s.pay_type === 'salary' || h > 0 || pto > 0) n++;
  }
  return n;
}
