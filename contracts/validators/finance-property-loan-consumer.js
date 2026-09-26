// connect.finance-property-loan.v1: the Commercial Property's loan record (the last balance the
// lender confirmed, the rate and the payment) and each month's reported loan payment and interest,
// so Finance can roll the confirmed balance forward and project the payoff. Aggregate only; the
// record's free-text notes and who confirmed it stay in Connect.
const CONTRACT = 'connect.finance-property-loan.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'propertyKey', 'generatedAt', 'loan', 'balanceHistory', 'payments'];
const LOAN_KEYS = ['lender', 'balanceCents', 'balanceAsOfDate', 'interestRate', 'monthlyPaymentCents'];
const HISTORY_KEYS = ['asOfDate', 'balanceCents', 'interestRate'];
const PAYMENT_KEYS = ['period', 'paymentCents', 'interestCents'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

const nullableCents = (v) => v === null || (Number.isInteger(v) && v >= 0);
const nullableRate = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1);

export function validateFinancePropertyLoanV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) return { ok: false, errors: ['root must contain exactly the property loan fields'] };
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (typeof value.propertyKey !== 'string' || !/^[a-z0-9_-]+$/.test(value.propertyKey)) errors.push('propertyKey must be a safe non-empty key');
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) errors.push('generatedAt must be a timestamp');
  if (!hasExactKeys(value.loan, LOAN_KEYS)) errors.push('loan must contain exactly the loan fields');
  else {
    if (typeof value.loan.lender !== 'string') errors.push('loan.lender must be a string');
    if (!nullableCents(value.loan.balanceCents)) errors.push('loan.balanceCents must be null or nonnegative integer cents');
    if (value.loan.balanceAsOfDate !== null && !DAY.test(String(value.loan.balanceAsOfDate))) errors.push('loan.balanceAsOfDate must be null or YYYY-MM-DD');
    if (!nullableRate(value.loan.interestRate)) errors.push('loan.interestRate must be null or a fraction');
    if (!nullableCents(value.loan.monthlyPaymentCents)) errors.push('loan.monthlyPaymentCents must be null or nonnegative integer cents');
  }
  if (!Array.isArray(value.balanceHistory)) errors.push('balanceHistory must be an array');
  else value.balanceHistory.forEach((h, i) => {
    if (!hasExactKeys(h, HISTORY_KEYS) || !DAY.test(String(h.asOfDate)) || !Number.isInteger(h.balanceCents) || h.balanceCents < 0 || !nullableRate(h.interestRate)) errors.push(`balanceHistory[${i}] is invalid`);
  });
  if (!Array.isArray(value.payments)) errors.push('payments must be an array');
  else value.payments.forEach((p, i) => {
    if (!hasExactKeys(p, PAYMENT_KEYS) || !MONTH.test(String(p.period)) || !Number.isInteger(p.paymentCents) || p.paymentCents < 0 || !nullableCents(p.interestCents)) errors.push(`payments[${i}] is invalid`);
  });
  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyLoanV1(value) {
  const validation = validateFinancePropertyLoanV1(value);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return structuredClone(value);
}
