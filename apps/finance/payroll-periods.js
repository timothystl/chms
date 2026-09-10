// ── PAY PERIODS — ported from Website's admin/payroll.html buildPeriodDropdown() ──
// Biweekly periods anchored on the same date Website's picker uses, so the two
// screens always offer the exact same list of periods for the exact same dates.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAYROLL_ANCHOR_END = '2026-03-01';

// Dates are formatted from local components throughout. Parsing "2026-07-16"
// as local midnight and then formatting it through toISOString() would shift
// it a day for anybody west of UTC (PY-11 in Website's payroll history).
export function periodLabel(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  return `${MONTH_NAMES[sm - 1]} ${sd} – ${MONTH_NAMES[em - 1]} ${ed}, ${sy}`;
}

export function paysOnLabel(end) {
  const [y, m, d] = end.split('-').map(Number);
  const pay = new Date(y, m - 1, d + 4);
  return `Pays ${MONTH_NAMES[pay.getMonth()]} ${pay.getDate()}`;
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function buildPayrollPeriods(now = new Date()) {
  const anchor = new Date(`${PAYROLL_ANCHOR_END}T00:00:00`);
  const earliest = new Date('2026-01-01T00:00:00');
  const latest = new Date(now);
  latest.setFullYear(latest.getFullYear() + 2);

  let endDate = new Date(anchor);
  while (endDate > earliest) endDate.setDate(endDate.getDate() - 14);
  endDate.setDate(endDate.getDate() + 14);

  const periods = [];
  while (endDate <= latest) {
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 13);
    periods.push({ start: fmt(startDate), end: fmt(endDate) });
    endDate.setDate(endDate.getDate() + 14);
  }
  return periods;
}

export function defaultPeriodStart(periods, now = new Date()) {
  const todayStr = fmt(now);
  let defaultStart = periods[0]?.start || '';
  for (const p of periods) {
    if (p.end <= todayStr) defaultStart = p.start;
  }
  return defaultStart;
}

export function findPeriod(periods, periodStart) {
  return periods.find((p) => p.start === periodStart) || null;
}
