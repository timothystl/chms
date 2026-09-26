import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';
import {
  amortize, byYear, loanProjection, loanStatementMeta, parseReceivablesPaste, reconcile, rollForwardLoan, signedCents, summarizeReceivables,
} from '../apps/finance/property-books-service.js';

const LOAN = {
  contract: 'connect.finance-property-loan.v1', dataClassification: 'aggregate', sourceProduct: 'connect',
  consumerProduct: 'finance', currency: 'USD', propertyKey: 'ivanhoe', generatedAt: '2026-09-26T00:00:00Z',
  loan: { lender: 'LCEF', balanceCents: 27969113, balanceAsOfDate: '2026-07-20', interestRate: 0.06375, monthlyPaymentCents: 428303 },
  balanceHistory: [
    { asOfDate: '2025-11-20', balanceCents: 29733600, interestRate: null },
    { asOfDate: '2026-07-20', balanceCents: 27969113, interestRate: 0.06375 },
  ],
  payments: [
    { period: '2026-06', paymentCents: 378303, interestCents: 95205 },
    { period: '2026-07', paymentCents: 378303, interestCents: 94203 },
    { period: '2026-08', paymentCents: 378303, interestCents: 94000 },
    { period: '2026-09', paymentCents: 378303, interestCents: null },
  ],
};

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
      return out;
    },
  };
}

function makeEnv({ role = 'admin', loan = LOAN } = {}) {
  const db = makeDb();
  const writes = [];
  const env = {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions: { finance: 'edit' }, identity: 'admin@example.org' }));
        if (url.pathname.endsWith('/finance-property-loan-v1')) return loan ? new Response(JSON.stringify(loan)) : new Response('{}', { status: 500 });
        if (url.pathname.endsWith('/finance-property-meta-write-v1')) {
          writes.push(await req.json());
          return role === 'admin' ? new Response(JSON.stringify({ ok: true })) : new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 });
        }
        return new Response('{}', { status: 404 });
      },
    },
  };
  return { env, db, writes };
}
const get = (env, query) => worker.fetch(new Request(`https://finance.test/?section=property${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);
const post = (env, path, fields) => worker.fetch(new Request(`https://finance.test${path}`, {
  method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' }, body: new URLSearchParams(fields),
}), env);

beforeEach(() => resetEnsuredSchemasForTests());

describe('Property books rules', () => {
  it('reads signed dollar amounts, including parentheses for credits', () => {
    expect(signedCents('$1,200.50', 'x')).toBe(120050);
    expect(signedCents('(75.00)', 'x')).toBe(-7500);
    expect(signedCents('-10', 'x')).toBe(-1000);
    expect(signedCents('', 'x')).toBe(0);
    expect(() => signedCents('abc', 'x')).toThrow('must be a dollar amount');
  });

  it('parses a pasted aging report with a header, quotes, tabs and a total line', () => {
    const rows = parseReceivablesPaste('Tenant,Unit,0-30,31-60,61-90,Over 90,Deposit\n"Tenant A, LLC",Suite 1,"1,200.00",0,0,0,1200\nTenant B\t2\t(50.00)\t\t\t\t950\nTotal,,1150,0,0,0,2150');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ tenant: 'Tenant A, LLC', unit: 'Suite 1', current_cents: 120000, deposit_held_cents: 120000 });
    expect(rows[1]).toMatchObject({ tenant: 'Tenant B', current_cents: -5000, deposit_held_cents: 95000 });
    expect(() => parseReceivablesPaste('Tenant A,1,100\nTenant B,2,x')).toThrow('line 2');
  });

  it('summarizes receivables by age and deposits held', () => {
    const s = summarizeReceivables([
      { current_cents: 100000, days_31_60_cents: 50000, days_61_90_cents: 0, over_90_cents: 20000, deposit_held_cents: 100000 },
      { current_cents: -5000, days_31_60_cents: 0, days_61_90_cents: 0, over_90_cents: 0, deposit_held_cents: 95000 },
    ]);
    expect(s).toMatchObject({ owedCents: 165000, pastDueCents: 70000, depositsCents: 195000, withBalance: 1, lines: 2 });
  });

  it('reconciles the bank statement against the manager’s cash', () => {
    expect(reconcile({ statement_balance_cents: 1000000, deposits_in_transit_cents: 50000, outstanding_checks_cents: 20000, book_balance_cents: 1030000 }))
      .toEqual({ adjustedCents: 1030000, differenceCents: 0, reconciled: true });
    expect(reconcile({ statement_balance_cents: 1000000, deposits_in_transit_cents: 0, outstanding_checks_cents: 0, book_balance_cents: 990000 }).differenceCents).toBe(10000);
  });

  it('rolls the confirmed balance forward only with later months that report their interest', () => {
    const r = rollForwardLoan(LOAN);
    expect(r.applied.map((m) => m.period)).toEqual(['2026-08']);
    expect(r.balanceCents).toBe(27969113 - (378303 - 94000));
    expect(r.missingInterest).toEqual(['2026-09']);
    expect(r.lastReportedPaymentCents).toBe(378303);
  });

  it('amortizes to a zero balance and reports when a payment cannot cover interest', () => {
    const a = amortize({ balanceCents: 1000000, annualRate: 0.06, paymentCents: 100000, startMonth: '2026-11' });
    expect(a.payable).toBe(true);
    expect(a.months.at(-1).balanceCents).toBe(0);
    expect(a.months[1].period).toBe('2026-12');
    expect(a.months[2].period).toBe('2027-01');
    const years = byYear(a.months);
    expect(years.reduce((s, y) => s + y.principalCents, 0)).toBe(1000000);
    expect(amortize({ balanceCents: 1000000, annualRate: 0.24, paymentCents: 10000, startMonth: '2026-11' }).payable).toBe(false);
  });

  it('projects payoff from the rolled balance, and extra principal pays off sooner', () => {
    const p = loanProjection(LOAN, { extraCents: 50000 });
    expect(p.ok).toBe(true);
    expect(p.startMonth).toBe('2026-09');
    expect(p.paymentCents).toBe(378303);
    expect(p.payoffMonth > '2032-01' && p.payoffMonth < '2036-01').toBe(true);
    expect(p.extra.monthsSaved).toBeGreaterThan(0);
    expect(p.extra.interestSavedCents).toBeGreaterThan(0);
  });

  it('builds a loan statement update that joins the history and moves the confirmed balance', () => {
    const form = new URLSearchParams({ statement_date: '2026-09-20', balance: '276,500.00', rate_percent: '6.375', monthly_payment: '3783.03' });
    const { loan } = loanStatementMeta(form, LOAN.balanceHistory);
    expect(loan).toMatchObject({ balance_cents: 27650000, balance_as_of_date: '2026-09-20', interest_rate_pct: 0.06375, monthly_payment_cents: 378303 });
    expect(loan.balance_history.map((h) => h.as_of_date)).toEqual(['2025-11-20', '2026-07-20', '2026-09-20']);
    const older = loanStatementMeta(new URLSearchParams({ statement_date: '2026-01-20', balance: '290000' }), LOAN.balanceHistory).loan;
    expect(older.balance_cents).toBeUndefined();
    expect(older.balance_history).toHaveLength(3);
    expect(loanStatementMeta(new URLSearchParams({ statement_date: '2026-09-20' }), []).error).toContain('principal balance');
  });
});

describe('Property books pages', () => {
  it('imports a month of receivables, shows it, and replaces it when pasted again', async () => {
    const { env, db } = makeEnv();
    let res = await post(env, '/api/v1/property/receivable-import', { report_month: '2026-08', lines: 'Tenant A,1,1200,300,0,0,1200\nTenant B,2,0,0,0,450,950' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('status=ok');
    expect(res.headers.get('Location')).toContain('month=2026-08');
    let html = await (await get(env, '&page=receivables')).text();
    expect(html).toContain('Aged receivables · August 2026');
    expect(html).toContain('$1,950');
    expect(html).toContain('Security deposits held');
    expect(html).not.toContain('Not yet available');
    res = await post(env, '/api/v1/property/receivable-import', { report_month: '2026-08', lines: 'Tenant A,1,100,0,0,0,1200' });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_property_receivables WHERE report_month='2026-08'").get().n).toBe(1);
    const id = db.sqlite.prepare('SELECT id FROM finance_property_receivables').get().id;
    await post(env, '/api/v1/property/receivable-remove', { id: String(id) });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_property_receivables').get().n).toBe(0);
    html = await (await get(env, '&page=receivables')).text();
    expect(html).toContain('No receivables recorded yet');
  });

  it('refuses property book edits from anyone but an admin', async () => {
    const { env, db } = makeEnv({ role: 'finance' });
    const res = await post(env, '/api/v1/property/bank-rec-save', { statement_month: '2026-08', statement_balance: '1000', book_balance: '1000' });
    expect(res.headers.get('Location')).toContain('access_denied');
    const html = await (await get(env, '&page=bank-rec')).text();
    expect(html).not.toContain('action="/api/v1/property/bank-rec-save"');
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='finance_property_bank_recs'").get()).toBeTruthy();
  });

  it('records a bank reconciliation and shows the property position', async () => {
    const { env } = makeEnv();
    await post(env, '/api/v1/property/receivable-import', { report_month: '2026-08', lines: 'Tenant A,1,500,0,0,0,1200' });
    const bad = await post(env, '/api/v1/property/bank-rec-save', { statement_month: '2026-08', statement_balance: '', book_balance: '100' });
    expect(bad.headers.get('Location')).toContain('reason=invalid');
    await post(env, '/api/v1/property/bank-rec-save', { statement_month: '2026-08', statement_balance: '12,000', deposits_in_transit: '500', outstanding_checks: '250', book_balance: '12250' });
    await post(env, '/api/v1/property/bank-rec-save', { statement_month: '2026-07', statement_balance: '11,000', book_balance: '10900', note: 'Bank fee not yet booked' });
    const html = await (await get(env, '&page=bank-rec')).text();
    expect(html).toContain('Property position');
    expect(html).toContain('Balanced');
    expect(html).toContain('Security deposits owed back to tenants');
    expect(html).toContain('Bank fee not yet booked');
    expect(html).toContain('$100');
    const edit = await (await get(env, '&page=bank-rec&edit=2026-07')).text();
    expect(edit).toContain('Edit July 2026');
    expect(edit).toContain('value="11000.00"');
  });

  it('renders the debt payoff from Connect’s loan record and flags a payment mismatch', async () => {
    const { env } = makeEnv();
    const html = await (await get(env, '&page=debt&extra=500')).text();
    expect(html).toContain('How the balance got here');
    expect(html).toContain('Payoff by year');
    expect(html).toContain('LCEF confirmed $279,691');
    expect(html).toContain('The loan record lists a $4,283 monthly payment');
    expect(html).toContain('months sooner');
    expect(html).toContain('Record a loan statement');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  it('says so when the loan record cannot be read', async () => {
    const { env } = makeEnv({ loan: null });
    const html = await (await get(env, '&page=debt')).text();
    expect(html).toContain('The loan record could not be read from Connect');
  });

  it('relays a loan statement into Connect’s loan record', async () => {
    const { env, writes } = makeEnv();
    const res = await post(env, '/api/v1/connect-property-meta-write', { loan_statement_form: '1', statement_date: '2026-09-20', balance: '276500', rate_percent: '6.375', monthly_payment: '3783.03' });
    expect(res.headers.get('Location')).toBe('/?section=property&page=debt&status=ok');
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0])).toEqual(['loan']);
    expect(writes[0].loan).toMatchObject({ balance_cents: 27650000, balance_as_of_date: '2026-09-20', monthly_payment_cents: 378303 });
    expect(writes[0].loan.balance_history).toHaveLength(3);
    const bad = await post(env, '/api/v1/connect-property-meta-write', { loan_statement_form: '1', statement_date: '', balance: '1' });
    expect(bad.headers.get('Location')).toContain('reason=invalid');
    const denied = makeEnv({ role: 'finance' });
    const refused = await post(denied.env, '/api/v1/connect-property-meta-write', { loan_statement_form: '1', statement_date: '2026-09-20', balance: '276500' });
    expect(refused.headers.get('Location')).toContain('access_denied');
  });
});
