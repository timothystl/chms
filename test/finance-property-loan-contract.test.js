import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { acceptFinancePropertyLoanV1, validateFinancePropertyLoanV1 } from '../contracts/validators/finance-property-loan-consumer.js';
import { buildFinancePropertyLoanV1 } from '../src/api-property-loan-contracts.js';

function db(meta) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sqlite.exec('CREATE TABLE finance_property_monthly (property_key TEXT, period TEXT, loan_payment_cents INTEGER, interest_expense_cents INTEGER)');
  if (meta) sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_property_ivanhoe_meta',?)").run(JSON.stringify(meta));
  const ins = sqlite.prepare('INSERT INTO finance_property_monthly VALUES (?,?,?,?)');
  ins.run('ivanhoe', '2026-07', 378303, 94203);
  ins.run('ivanhoe', '2026-06', 378303, 95205);
  ins.run('ivanhoe', '2026-05', null, null);
  ins.run('other', '2026-07', 1, 1);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { return sqlite.prepare(sql).get(...args); },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql) };
}

const META = {
  loan: {
    lender: 'LCEF', balance_cents: 27969113, balance_as_of_date: '2026-07-20', interest_rate_pct: 0.06375,
    confirmed_by: 'a person', note: 'free text stays in Connect', monthly_payment_cents: 428303,
    balance_history: [{ balance_cents: 27969113, as_of_date: '2026-07-20', interest_rate_pct: 0.06375 }, { balance_cents: 29733600, as_of_date: '2025-11-20' }],
  },
};

describe('connect.finance-property-loan.v1', () => {
  it('returns the loan record, sorted history and reported payments, without notes', async () => {
    const payload = await buildFinancePropertyLoanV1(db(META), { now: new Date('2026-09-26T00:00:00Z') });
    expect(validateFinancePropertyLoanV1(payload)).toEqual({ ok: true, errors: [] });
    expect(payload.loan).toEqual({ lender: 'LCEF', balanceCents: 27969113, balanceAsOfDate: '2026-07-20', interestRate: 0.06375, monthlyPaymentCents: 428303 });
    expect(payload.balanceHistory.map((h) => h.asOfDate)).toEqual(['2025-11-20', '2026-07-20']);
    expect(payload.balanceHistory[0].interestRate).toBeNull();
    expect(payload.payments).toEqual([
      { period: '2026-06', paymentCents: 378303, interestCents: 95205 },
      { period: '2026-07', paymentCents: 378303, interestCents: 94203 },
    ]);
    expect(JSON.stringify(payload)).not.toContain('free text');
    expect(JSON.stringify(payload)).not.toContain('a person');
  });

  it('serves an empty but valid record when no loan is stored', async () => {
    const payload = await buildFinancePropertyLoanV1(db(null));
    expect(acceptFinancePropertyLoanV1(payload).loan.balanceCents).toBeNull();
  });

  it('requires the contract key and rejects an unsafe property key', async () => {
    const env = { DB: db(META), FINANCE_CONTRACT_API_KEY: 'secret' };
    const path = '/api/contracts/finance-property-loan-v1';
    expect((await handleContractsServiceApi(new Request(`https://connect.test${path}`), env, path)).status).toBe(401);
    const ok = await handleContractsServiceApi(new Request(`https://connect.test${path}?property_key=ivanhoe`, { headers: { 'X-Contract-Key': 'secret' } }), env, path);
    expect(ok.status).toBe(200);
    expect((await ok.json()).contract).toBe('connect.finance-property-loan.v1');
    const bad = await handleContractsServiceApi(new Request(`https://connect.test${path}?property_key=../x`, { headers: { 'X-Contract-Key': 'secret' } }), env, path);
    expect(bad.status).toBe(400);
  });

  it('rejects a payload with extra fields', () => {
    expect(validateFinancePropertyLoanV1({ contract: 'x' }).ok).toBe(false);
  });
});
