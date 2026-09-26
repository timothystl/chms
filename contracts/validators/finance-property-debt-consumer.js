const CONTRACT = 'connect.finance-property-debt.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'propertyKey', 'generatedAt', 'loan', 'activity', 'projection'];
const LOAN_KEYS = ['lender', 'balanceCents', 'balanceAsOfDate', 'interestRatePct', 'monthlyPaymentCents', 'storedAnnualDebtServiceCents'];
const ACTIVITY_KEYS = ['period', 'paymentCents', 'interestCents', 'principalCents', 'balanceAfterCents'];
const PROJECTION_KEYS = ['currentBalanceCents', 'currentBalanceAsOf', 'derivedAnnualDebtServiceCents', 'monthsRemaining', 'payoffPeriod', 'totalInterestRemainingCents', 'status'];
const STATUSES = new Set(['ready', 'missing_terms', 'payment_too_low']);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function nullableString(value) { return value === null || typeof value === 'string'; }
function nullableCents(value) { return value === null || (Number.isSafeInteger(value) && value >= 0); }
function nullableNumber(value) { return value === null || (Number.isFinite(value) && value >= 0); }
function date(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function period(value) { return value === null || (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)); }

export function validateFinancePropertyDebtV1(value) {
  const errors = [];
  if (!exact(value, ROOT_KEYS)) return { ok: false, errors: ['root must contain exactly the property debt fields'] };
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect' || value.consumerProduct !== 'finance') errors.push('product ownership is invalid');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (typeof value.propertyKey !== 'string' || !/^[a-z0-9_-]+$/.test(value.propertyKey)) errors.push('propertyKey must be a safe key');
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) errors.push('generatedAt must be a timestamp');
  if (!exact(value.loan, LOAN_KEYS)) errors.push('loan must contain exactly the loan fields');
  else {
    if (!nullableString(value.loan.lender)) errors.push('loan.lender must be a string or null');
    if (!nullableCents(value.loan.balanceCents)) errors.push('loan.balanceCents must be null or nonnegative safe integer cents');
    if (!date(value.loan.balanceAsOfDate)) errors.push('loan.balanceAsOfDate must be null or YYYY-MM-DD');
    if (!nullableNumber(value.loan.interestRatePct) || value.loan.interestRatePct > 1) errors.push('loan.interestRatePct must be null or a decimal rate from 0 to 1');
    if (!nullableCents(value.loan.monthlyPaymentCents)) errors.push('loan.monthlyPaymentCents must be null or nonnegative safe integer cents');
    if (!nullableCents(value.loan.storedAnnualDebtServiceCents)) errors.push('loan.storedAnnualDebtServiceCents must be null or nonnegative safe integer cents');
  }
  if (!Array.isArray(value.activity)) errors.push('activity must be an array');
  else value.activity.forEach((row, index) => {
    if (!exact(row, ACTIVITY_KEYS)) { errors.push(`activity[${index}] must contain exactly the activity fields`); return; }
    if (!period(row.period) || row.period === null) errors.push(`activity[${index}].period must be YYYY-MM`);
    for (const key of ['paymentCents', 'interestCents', 'principalCents', 'balanceAfterCents']) if (!nullableCents(row[key]) || row[key] === null) errors.push(`activity[${index}].${key} must be nonnegative safe integer cents`);
  });
  if (!exact(value.projection, PROJECTION_KEYS)) errors.push('projection must contain exactly the projection fields');
  else {
    if (!nullableCents(value.projection.currentBalanceCents)) errors.push('projection.currentBalanceCents must be null or nonnegative safe integer cents');
    if (!(date(value.projection.currentBalanceAsOf) || period(value.projection.currentBalanceAsOf))) errors.push('projection.currentBalanceAsOf must be null, YYYY-MM, or YYYY-MM-DD');
    if (!nullableCents(value.projection.derivedAnnualDebtServiceCents)) errors.push('projection.derivedAnnualDebtServiceCents must be null or nonnegative safe integer cents');
    if (!(value.projection.monthsRemaining === null || (Number.isSafeInteger(value.projection.monthsRemaining) && value.projection.monthsRemaining >= 0))) errors.push('projection.monthsRemaining must be null or a nonnegative safe integer');
    if (!period(value.projection.payoffPeriod)) errors.push('projection.payoffPeriod must be null or YYYY-MM');
    if (!nullableCents(value.projection.totalInterestRemainingCents)) errors.push('projection.totalInterestRemainingCents must be null or nonnegative safe integer cents');
    if (!STATUSES.has(value.projection.status)) errors.push('projection.status is invalid');
    if (value.projection.status === 'ready' && (value.projection.currentBalanceCents === null || value.projection.monthsRemaining === null || value.projection.payoffPeriod === null || value.projection.totalInterestRemainingCents === null)) errors.push('a ready projection must contain balance, duration, payoff, and interest');
    if (value.projection.status !== 'ready' && (value.projection.monthsRemaining !== null || value.projection.payoffPeriod !== null || value.projection.totalInterestRemainingCents !== null)) errors.push('an unavailable projection must not contain projected payoff values');
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyDebtV1(value) {
  const result = validateFinancePropertyDebtV1(value);
  if (!result.ok) throw new TypeError(`Rejected ${CONTRACT}: ${result.errors.join('; ')}`);
  return structuredClone(value);
}
