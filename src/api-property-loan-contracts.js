// connect.finance-property-loan.v1 -- the Commercial Property's loan record from the property meta
// blob (finance_settings `finance_property_<key>_meta`, section `loan`) plus each month's reported
// loan payment and interest from finance_property_monthly. Finance rolls the last confirmed balance
// forward with these payments (the same rule as Connect's own finComputeMortgageRemainingCents) and
// projects the payoff. Loan statements are recorded through the existing meta-write relay.
import { json } from './auth.js';
import { validateFinancePropertyLoanV1 } from '../contracts/validators/finance-property-loan-consumer.js';

const cents = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const rate = (value) => {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n) || n < 0) return null;
  // Stored as a fraction (0.06375); tolerate a percentage typed by hand.
  const fraction = n >= 1 ? n / 100 : n;
  return fraction < 1 ? fraction : null;
};
const day = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : null);

export async function buildFinancePropertyLoanV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(`finance_property_${propertyKey}_meta`).first();
  let meta = {};
  try { meta = row?.value ? JSON.parse(row.value) : {}; } catch { meta = {}; }
  const loan = meta?.loan && typeof meta.loan === 'object' ? meta.loan : {};
  const monthly = await db.prepare(
    'SELECT period, loan_payment_cents, interest_expense_cents FROM finance_property_monthly WHERE property_key=? AND loan_payment_cents IS NOT NULL ORDER BY period'
  ).bind(propertyKey).all();
  const history = (Array.isArray(loan.balance_history) ? loan.balance_history : [])
    .map((h) => ({ asOfDate: day(h?.as_of_date), balanceCents: cents(h?.balance_cents), interestRate: rate(h?.interest_rate_pct) }))
    .filter((h) => h.asOfDate && h.balanceCents !== null)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  return {
    contract: 'connect.finance-property-loan.v1', dataClassification: 'aggregate',
    sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', propertyKey,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    loan: {
      lender: typeof loan.lender === 'string' ? loan.lender.slice(0, 80) : '',
      balanceCents: cents(loan.balance_cents),
      balanceAsOfDate: day(loan.balance_as_of_date),
      interestRate: rate(loan.interest_rate_pct),
      monthlyPaymentCents: cents(loan.monthly_payment_cents),
    },
    balanceHistory: history,
    payments: (monthly?.results || [])
      .filter((r) => /^\d{4}-\d{2}$/.test(String(r.period)) && cents(r.loan_payment_cents) !== null)
      .map((r) => ({ period: r.period, paymentCents: cents(r.loan_payment_cents), interestCents: cents(r.interest_expense_cents) })),
  };
}

export async function respondWithFinancePropertyLoanV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  if (!/^[a-z0-9_-]+$/.test(propertyKey)) return json({ error: 'property_key is invalid' }, 400);
  const payload = await buildFinancePropertyLoanV1(db, { propertyKey });
  const validation = validateFinancePropertyLoanV1(payload);
  if (!validation.ok) return json({ error: 'Internal: assembled property loan failed contract validation', details: validation.errors }, 500);
  return json(payload);
}
