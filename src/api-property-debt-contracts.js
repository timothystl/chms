import { json } from './auth.js';
import { validateFinancePropertyDebtV1 } from '../contracts/validators/finance-property-debt-consumer.js';

const safeCents = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(Math.round(number)) && number >= 0 ? Math.round(number) : null;
};
const safeRate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
};
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const addMonths = (period, months) => {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function projectPropertyDebt({ balanceCents, balanceAsOfDate, interestRatePct, monthlyPaymentCents, monthlyRows }) {
  if (balanceCents === null) return { activity: [], projection: { currentBalanceCents: null, currentBalanceAsOf: balanceAsOfDate, derivedAnnualDebtServiceCents: monthlyPaymentCents === null ? null : monthlyPaymentCents * 12, monthsRemaining: null, payoffPeriod: null, totalInterestRemainingCents: null, status: 'missing_terms' } };
  let balance = balanceCents;
  const anchorPeriod = balanceAsOfDate?.slice(0, 7) || null;
  const activity = (monthlyRows || []).filter((row) => anchorPeriod && row.period > anchorPeriod
    && Number.isSafeInteger(row.loan_payment_cents) && row.loan_payment_cents >= 0
    && Number.isSafeInteger(row.interest_expense_cents) && row.interest_expense_cents >= 0).map((row) => {
    const paymentCents = row.loan_payment_cents;
    const interestCents = row.interest_expense_cents;
    const principalCents = Math.min(balance, Math.max(0, paymentCents - interestCents));
    balance -= principalCents;
    return { period: row.period, paymentCents, interestCents, principalCents, balanceAfterCents: balance };
  });
  const currentBalanceAsOf = activity.at(-1)?.period || balanceAsOfDate;
  const derivedAnnualDebtServiceCents = monthlyPaymentCents === null ? null : monthlyPaymentCents * 12;
  if (balanceAsOfDate === null || interestRatePct === null || !(monthlyPaymentCents > 0)) return { activity, projection: { currentBalanceCents: balance, currentBalanceAsOf, derivedAnnualDebtServiceCents, monthsRemaining: null, payoffPeriod: null, totalInterestRemainingCents: null, status: 'missing_terms' } };
  const monthlyRate = interestRatePct / 12;
  if (monthlyPaymentCents <= Math.round(balance * monthlyRate)) return { activity, projection: { currentBalanceCents: balance, currentBalanceAsOf, derivedAnnualDebtServiceCents, monthsRemaining: null, payoffPeriod: null, totalInterestRemainingCents: null, status: 'payment_too_low' } };
  let projectedBalance = balance;
  let totalInterestRemainingCents = 0;
  let monthsRemaining = 0;
  while (projectedBalance > 0 && monthsRemaining < 1200) {
    const interest = Math.round(projectedBalance * monthlyRate);
    const principal = Math.min(projectedBalance, monthlyPaymentCents - interest);
    if (principal <= 0) break;
    totalInterestRemainingCents += interest;
    projectedBalance -= principal;
    monthsRemaining += 1;
  }
  const startPeriod = (currentBalanceAsOf || new Date().toISOString().slice(0, 7)).slice(0, 7);
  return { activity, projection: { currentBalanceCents: balance, currentBalanceAsOf, derivedAnnualDebtServiceCents, monthsRemaining, payoffPeriod: addMonths(startPeriod, monthsRemaining), totalInterestRemainingCents, status: 'ready' } };
}

export async function buildFinancePropertyDebtV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const [metaRow, monthlyResult] = await Promise.all([
    db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(`finance_property_${propertyKey}_meta`).first(),
    db.prepare('SELECT period, loan_payment_cents, interest_expense_cents FROM finance_property_monthly WHERE property_key=? ORDER BY period').bind(propertyKey).all(),
  ]);
  let meta = {};
  try { meta = metaRow?.value ? JSON.parse(metaRow.value) : {}; } catch { meta = {}; }
  const source = meta?.loan && typeof meta.loan === 'object' ? meta.loan : {};
  const loan = {
    lender: typeof source.lender === 'string' ? source.lender : null,
    balanceCents: safeCents(source.balance_cents),
    balanceAsOfDate: validDate(source.balance_as_of_date) ? source.balance_as_of_date : null,
    interestRatePct: safeRate(source.interest_rate_pct),
    monthlyPaymentCents: safeCents(source.monthly_payment_cents),
    storedAnnualDebtServiceCents: safeCents(source.annual_debt_service_cents),
  };
  const { activity, projection } = projectPropertyDebt({ ...loan, monthlyRows: monthlyResult.results || [] });
  return { contract: 'connect.finance-property-debt.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', propertyKey, generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), loan, activity, projection };
}

export async function respondWithFinancePropertyDebtV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  if (!/^[a-z0-9_-]+$/.test(propertyKey)) return json({ error: 'property_key is invalid' }, 400);
  const payload = await buildFinancePropertyDebtV1(db, { propertyKey });
  const validation = validateFinancePropertyDebtV1(payload);
  if (!validation.ok) return json({ error: 'Internal: assembled property debt failed contract validation', details: validation.errors }, 500);
  return json(payload);
}
