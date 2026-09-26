import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildFinancePropertyDebtV1, projectPropertyDebt } from '../src/api-property-debt-contracts.js';
import { acceptFinancePropertyDebtV1, validateFinancePropertyDebtV1 } from '../contracts/validators/finance-property-debt-consumer.js';

function db(meta) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE finance_property_monthly (property_key TEXT, period TEXT, loan_payment_cents INTEGER, interest_expense_cents INTEGER)');
  if (meta) sqlite.prepare("INSERT INTO finance_settings VALUES ('finance_property_ivanhoe_meta', ?)").run(JSON.stringify(meta));
  const statement = (sql, args = []) => ({ bind: (...next) => statement(sql, next), async first() { return sqlite.prepare(sql).get(...args); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } });
  return { prepare: (sql) => statement(sql), raw: sqlite };
}

describe('connect.finance-property-debt.v1', () => {
  it('rolls the confirmed balance through real principal rows and projects payoff', async () => {
    const database = db({ loan: { lender: 'LCEF', balance_cents: 27969113, balance_as_of_date: '2026-07-20', interest_rate_pct: 0.06375, monthly_payment_cents: 428303, annual_debt_service_cents: 4539636 } });
    database.raw.prepare("INSERT INTO finance_property_monthly VALUES ('ivanhoe','2026-06',378303,95205),('ivanhoe','2026-08',428303,94203)").run();
    const payload = await buildFinancePropertyDebtV1(database, { now: new Date('2026-09-26T00:00:00Z') });
    expect(payload.activity).toEqual([{ period: '2026-08', paymentCents: 428303, interestCents: 94203, principalCents: 334100, balanceAfterCents: 27635013 }]);
    expect(payload.projection).toMatchObject({ currentBalanceCents: 27635013, currentBalanceAsOf: '2026-08', status: 'ready' });
    expect(payload.projection.monthsRemaining).toBeGreaterThan(0);
    expect(payload.projection.payoffPeriod).toMatch(/^20\d\d-\d\d$/);
    expect(validateFinancePropertyDebtV1(payload)).toEqual({ ok: true, errors: [] });
    const accepted = acceptFinancePropertyDebtV1(payload); accepted.loan.balanceCents = 0;
    expect(payload.loan.balanceCents).toBe(27969113);
  });

  it('fails closed to missing terms or a payment that cannot cover interest', () => {
    expect(projectPropertyDebt({ balanceCents: 10000000, balanceAsOfDate: null, interestRatePct: null, monthlyPaymentCents: null, monthlyRows: [] }).projection.status).toBe('missing_terms');
    expect(projectPropertyDebt({ balanceCents: 10000000, balanceAsOfDate: '2026-01-01', interestRatePct: 0.12, monthlyPaymentCents: 50000, monthlyRows: [] }).projection.status).toBe('payment_too_low');
    expect(projectPropertyDebt({ balanceCents: 100000, balanceAsOfDate: '2026-01-01', interestRatePct: 0, monthlyPaymentCents: 10000, monthlyRows: [] }).projection).toMatchObject({ status: 'ready', monthsRemaining: 10, totalInterestRemainingCents: 0 });
  });
});
