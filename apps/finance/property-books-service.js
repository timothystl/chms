// Commercial Property books (v3 design): tenant receivables and security deposits entered from the
// property manager's monthly reports, the monthly reconciliation of the property's own bank
// account (Finance's tables, migration 0014), and the loan payoff worked out from Connect's loan
// record (connect.finance-property-loan.v1). Editing is admin-only, like every other property write.
import { FormValidationError, month, text } from './form-fields.js';
import { runBudgetedReadBatch } from './query-budget.js';

export const PROPERTY_KEY = 'ivanhoe';

const READ_SQL = [
  `SELECT id, report_month, tenant, unit, current_cents, days_31_60_cents, days_61_90_cents, over_90_cents, deposit_held_cents, note
     FROM finance_property_receivables WHERE property_key='${PROPERTY_KEY}' ORDER BY report_month DESC, tenant, id`,
  `SELECT statement_month, statement_balance_cents, deposits_in_transit_cents, outstanding_checks_cents, book_balance_cents, note, updated_at, updated_by
     FROM finance_property_bank_recs WHERE property_key='${PROPERTY_KEY}' ORDER BY statement_month DESC`,
];

export async function readPropertyBooks(db) {
  const { results } = await runBudgetedReadBatch(db, 'propertyBooks', READ_SQL);
  return { receivables: results[0]?.results || [], bankRecs: results[1]?.results || [] };
}

export const AGING = Object.freeze([
  { key: 'current_cents', label: '0–30 days' },
  { key: 'days_31_60_cents', label: '31–60' },
  { key: 'days_61_90_cents', label: '61–90' },
  { key: 'over_90_cents', label: 'Over 90' },
]);

export const rowBalance = (r) => AGING.reduce((sum, a) => sum + (Number(r[a.key]) || 0), 0);

// One report month's receivables: totals by age, the amount past 30 days, and deposits held.
export function summarizeReceivables(rows) {
  const totals = Object.fromEntries(AGING.map((a) => [a.key, 0]));
  let deposits = 0;
  let withBalance = 0;
  for (const r of rows) {
    for (const a of AGING) totals[a.key] += Number(r[a.key]) || 0;
    deposits += Number(r.deposit_held_cents) || 0;
    if (rowBalance(r) > 0) withBalance += 1;
  }
  const owed = AGING.reduce((sum, a) => sum + totals[a.key], 0);
  return { totals, owedCents: owed, pastDueCents: owed - totals.current_cents, depositsCents: deposits, withBalance, lines: rows.length };
}

export function receivableMonths(rows) {
  return [...new Set(rows.map((r) => r.report_month))].sort().reverse();
}

// Adjusted bank balance = statement + deposits in transit − outstanding checks. It should equal the
// cash the manager's report shows; the difference is what is left to explain.
export function reconcile(rec) {
  const adjusted = rec.statement_balance_cents + rec.deposits_in_transit_cents - rec.outstanding_checks_cents;
  return { adjustedCents: adjusted, differenceCents: adjusted - rec.book_balance_cents, reconciled: adjusted === rec.book_balance_cents };
}

// ── Form fields ───────────────────────────────────────────────────────────────────────────────

// Signed dollars: a tenant credit (prepaid rent) shows as a negative balance on the manager's aging.
export function signedCents(value, label) {
  let v = String(value ?? '').trim().replace(/[$,\s]/g, '');
  if (v === '' || v === '-') return 0;
  let negative = false;
  if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1); }
  if (v.startsWith('-')) { negative = !negative; v = v.slice(1); }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new FormValidationError(`${label} must be a dollar amount.`);
  const cents = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) throw new FormValidationError(`${label} is too large.`);
  return negative ? -cents : cents;
}

function unsignedCents(value, label) {
  const c = signedCents(value, label);
  if (c < 0) throw new FormValidationError(`${label} cannot be negative.`);
  return c;
}

function receivableFromValues(values, label = '') {
  const [tenant, unit, current, d60, d90, over90, deposit, note] = values;
  const at = label ? ` (${label})` : '';
  return {
    tenant: text(tenant, 80, `Tenant${at}`, { required: true }),
    unit: text(unit, 40, `Unit${at}`),
    current_cents: signedCents(current, `0–30 days${at}`),
    days_31_60_cents: signedCents(d60, `31–60 days${at}`),
    days_61_90_cents: signedCents(d90, `61–90 days${at}`),
    over_90_cents: signedCents(over90, `Over 90 days${at}`),
    deposit_held_cents: unsignedCents(deposit, `Deposit held${at}`),
    note: text(note, 200, `Note${at}`),
  };
}

const INSERT_RECEIVABLE = `INSERT INTO finance_property_receivables
  (property_key, report_month, tenant, unit, current_cents, days_31_60_cents, days_61_90_cents, over_90_cents, deposit_held_cents, note, created_by)
  VALUES ('${PROPERTY_KEY}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const bindReceivable = (db, reportMonth, r, actor) => db.prepare(INSERT_RECEIVABLE).bind(
  reportMonth, r.tenant, r.unit, r.current_cents, r.days_31_60_cents, r.days_61_90_cents, r.over_90_cents, r.deposit_held_cents, r.note, String(actor || ''),
);

// One quoted-CSV or tab-separated line (a paste from the report's spreadsheet export).
export function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cell.trim()); cell = ''; } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

const MAX_IMPORT_LINES = 200;

export function parseReceivablesPaste(textValue) {
  const lines = String(textValue ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new FormValidationError('Paste at least one line from the report.');
  if (lines.length > MAX_IMPORT_LINES + 1) throw new FormValidationError(`Paste ${MAX_IMPORT_LINES} lines at most.`);
  const rows = [];
  lines.forEach((line, index) => {
    const cells = splitLine(line);
    // A header line: none of the amount columns reads as an amount.
    if (index === 0 && !cells.slice(2, 7).some((c) => /^\(?-?\$?[\d,]+(\.\d+)?\)?$/.test(c))) return;
    if (/^total/i.test(cells[0] || '')) return;
    rows.push(receivableFromValues(cells, `line ${index + 1}`));
  });
  if (!rows.length) throw new FormValidationError('No tenant lines found in the paste.');
  return rows;
}

// ── Writers ───────────────────────────────────────────────────────────────────────────────────

async function saveReceivable(db, form, actor) {
  const reportMonth = month(form.report_month, 'Report month');
  const r = receivableFromValues([form.tenant, form.unit, form.current, form.days_31_60, form.days_61_90, form.over_90, form.deposit_held, form.note]);
  await bindReceivable(db, reportMonth, r, actor).run();
  return { params: { month: reportMonth } };
}

// Importing a month replaces that month's lines, so a corrected report can be pasted again.
async function importReceivables(db, form, actor) {
  const reportMonth = month(form.report_month, 'Report month');
  const rows = parseReceivablesPaste(form.lines);
  await db.batch([
    db.prepare(`DELETE FROM finance_property_receivables WHERE property_key='${PROPERTY_KEY}' AND report_month = ?`).bind(reportMonth),
    ...rows.map((r) => bindReceivable(db, reportMonth, r, actor)),
  ]);
  return { params: { month: reportMonth } };
}

async function removeReceivable(db, form) {
  const id = String(form.id ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) throw new FormValidationError('Unknown receivable line.');
  const row = await db.prepare(`SELECT report_month FROM finance_property_receivables WHERE property_key='${PROPERTY_KEY}' AND id = ?`).bind(Number(id)).first();
  if (!row) throw new FormValidationError('That line was already removed.');
  await db.prepare(`DELETE FROM finance_property_receivables WHERE property_key='${PROPERTY_KEY}' AND id = ?`).bind(Number(id)).run();
  return { params: { month: row.report_month } };
}

async function saveBankRec(db, form, actor) {
  const statementMonth = month(form.statement_month, 'Statement month');
  const values = [
    signedCents(form.statement_balance, 'Bank statement balance'),
    unsignedCents(form.deposits_in_transit, 'Deposits in transit'),
    unsignedCents(form.outstanding_checks, 'Outstanding checks'),
    signedCents(form.book_balance, 'Cash per the manager’s report'),
  ];
  if (String(form.statement_balance ?? '').trim() === '' || String(form.book_balance ?? '').trim() === '') {
    throw new FormValidationError('Enter both the bank statement balance and the cash on the manager’s report.');
  }
  const note = text(form.note, 200, 'Note');
  await db.prepare(
    `INSERT INTO finance_property_bank_recs (property_key, statement_month, statement_balance_cents, deposits_in_transit_cents, outstanding_checks_cents, book_balance_cents, note, updated_by)
     VALUES ('${PROPERTY_KEY}', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(property_key, statement_month) DO UPDATE SET statement_balance_cents=excluded.statement_balance_cents,
       deposits_in_transit_cents=excluded.deposits_in_transit_cents, outstanding_checks_cents=excluded.outstanding_checks_cents,
       book_balance_cents=excluded.book_balance_cents, note=excluded.note, updated_by=excluded.updated_by, updated_at=datetime('now')`
  ).bind(statementMonth, ...values, note, String(actor || '')).run();
  return {};
}

async function removeBankRec(db, form) {
  const statementMonth = month(form.statement_month, 'Statement month');
  await db.prepare(`DELETE FROM finance_property_bank_recs WHERE property_key='${PROPERTY_KEY}' AND statement_month = ?`).bind(statementMonth).run();
  return {};
}

export const PROPERTY_BOOKS_WRITERS = Object.freeze({
  'property-receivable-save-v1': { run: saveReceivable, page: 'receivables' },
  'property-receivable-import-v1': { run: importReceivables, page: 'receivables' },
  'property-receivable-remove-v1': { run: removeReceivable, page: 'receivables' },
  'property-bank-rec-save-v1': { run: saveBankRec, page: 'bank-rec' },
  'property-bank-rec-remove-v1': { run: removeBankRec, page: 'bank-rec' },
});

export function canEditPropertyBooks(roleResult) {
  return Boolean(roleResult?.ok && roleResult.role === 'admin');
}

// ── Loan ──────────────────────────────────────────────────────────────────────────────────────

const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// Rolls the lender-confirmed balance forward with each later month's principal (payment less
// interest), the same rule as Connect's finComputeMortgageRemainingCents: only months after the
// confirmed month, and only months that report both the payment and its interest.
export function rollForwardLoan(loanContract) {
  const { loan, payments } = loanContract;
  if (loan.balanceCents === null) return null;
  const asOfMonth = loan.balanceAsOfDate ? loan.balanceAsOfDate.slice(0, 7) : null;
  const later = asOfMonth ? payments.filter((p) => p.period > asOfMonth) : [];
  const applied = [];
  const missingInterest = [];
  let balance = loan.balanceCents;
  for (const p of later) {
    if (p.interestCents === null) { missingInterest.push(p.period); continue; }
    const principal = p.paymentCents - p.interestCents;
    balance -= principal;
    applied.push({ period: p.period, paymentCents: p.paymentCents, interestCents: p.interestCents, principalCents: principal, balanceCents: balance });
  }
  const lastReported = payments.at(-1) || null;
  return {
    balanceCents: balance,
    throughMonth: applied.at(-1)?.period || asOfMonth,
    applied, missingInterest,
    lastReportedPaymentCents: lastReported?.paymentCents ?? null,
    lastReportedPeriod: lastReported?.period ?? null,
  };
}

// Month-by-month payoff from a balance. `extraCents` is added principal each month.
export function amortize({ balanceCents, annualRate, paymentCents, startMonth, extraCents = 0, maxMonths = 600 }) {
  const m = annualRate / 12;
  const pay = paymentCents + extraCents;
  if (!(balanceCents > 0) || !(pay > 0)) return { months: [], payable: balanceCents <= 0 };
  if (pay <= Math.round(balanceCents * m)) return { months: [], payable: false };
  const months = [];
  let balance = balanceCents;
  let period = startMonth;
  while (balance > 0 && months.length < maxMonths) {
    const interest = Math.round(balance * m);
    const principal = Math.min(balance, pay - interest);
    balance -= principal;
    months.push({ period, paymentCents: interest + principal, interestCents: interest, principalCents: principal, balanceCents: balance });
    period = nextMonth(period);
  }
  return { months, payable: balance === 0 };
}

export function byYear(months) {
  const years = new Map();
  for (const mo of months) {
    const y = mo.period.slice(0, 4);
    const row = years.get(y) || { year: y, paymentCents: 0, interestCents: 0, principalCents: 0, balanceCents: 0, count: 0 };
    row.paymentCents += mo.paymentCents; row.interestCents += mo.interestCents; row.principalCents += mo.principalCents;
    row.balanceCents = mo.balanceCents; row.count += 1;
    years.set(y, row);
  }
  return [...years.values()];
}

export function loanProjection(loanContract, { extraCents = 0, today = new Date() } = {}) {
  const rolled = rollForwardLoan(loanContract);
  const rate = loanContract.loan.interestRate;
  if (!rolled || rate === null) return { rolled, ok: false };
  const paymentCents = rolled.lastReportedPaymentCents ?? loanContract.loan.monthlyPaymentCents;
  if (!paymentCents) return { rolled, ok: false };
  const thisMonth = today.toISOString().slice(0, 7);
  const start = rolled.throughMonth ? nextMonth(rolled.throughMonth) : thisMonth;
  const base = amortize({ balanceCents: rolled.balanceCents, annualRate: rate, paymentCents, startMonth: start });
  const withExtra = extraCents > 0 ? amortize({ balanceCents: rolled.balanceCents, annualRate: rate, paymentCents, startMonth: start, extraCents }) : null;
  const interest = (a) => a.months.reduce((s, mo) => s + mo.interestCents, 0);
  return {
    ok: true, rolled, rate, paymentCents, startMonth: start, base, withExtra,
    payoffMonth: base.payable ? base.months.at(-1)?.period : null,
    interestRemainingCents: interest(base),
    extra: withExtra ? {
      payoffMonth: withExtra.payable ? withExtra.months.at(-1)?.period : null,
      monthsSaved: base.months.length - withExtra.months.length,
      interestSavedCents: interest(base) - interest(withExtra),
    } : null,
  };
}

// The loan record update a statement makes, merged into Connect's property meta `loan` section.
// The statement joins the balance history (replacing any earlier entry for the same date).
export function loanStatementMeta(form, existingHistory = []) {
  const date = String(form.get('statement_date') || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: 'Enter the statement date.' };
  const dollars = (name) => {
    const raw = String(form.get(name) ?? '').replace(/[$,\s]/g, '');
    if (raw === '') return null;
    return /^\d+(\.\d{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : NaN;
  };
  const balance = dollars('balance');
  const payment = dollars('monthly_payment');
  const rateRaw = String(form.get('rate_percent') ?? '').replace(/[%\s]/g, '');
  const rate = rateRaw === '' ? null : Number(rateRaw);
  if (balance === null || Number.isNaN(balance)) return { error: 'Enter the principal balance from the statement.' };
  if (Number.isNaN(payment)) return { error: 'The monthly payment must be a dollar amount.' };
  if (rate !== null && !(Number.isFinite(rate) && rate > 0 && rate < 30)) return { error: 'The interest rate must be a percentage, like 6.375.' };
  const entry = { balance_cents: balance, as_of_date: date, ...(rate !== null ? { interest_rate_pct: rate / 100 } : {}) };
  const history = existingHistory
    .filter((h) => h.asOfDate !== date)
    .map((h) => ({ balance_cents: h.balanceCents, as_of_date: h.asOfDate, ...(h.interestRate !== null ? { interest_rate_pct: h.interestRate } : {}) }));
  history.push(entry);
  history.sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
  const latest = history.at(-1);
  const loan = { balance_history: history };
  // Only the newest statement moves the confirmed balance; an older one just joins the history.
  if (latest.as_of_date === date) {
    loan.balance_cents = balance;
    loan.balance_as_of_date = date;
    loan.confirmed_by = `Loan statement dated ${date}, entered in Finance`;
    if (rate !== null) loan.interest_rate_pct = rate / 100;
    if (payment !== null) loan.monthly_payment_cents = payment;
  }
  return { loan };
}
