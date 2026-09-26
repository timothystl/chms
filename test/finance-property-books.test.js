import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';
import {
  amortize, byYear, parseReceivablesPaste, reconcile, signedCents, summarizeReceivables,
} from '../apps/finance/property-books-service.js';

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

function makeEnv({ role = 'admin' } = {}) {
  const db = makeDb();
  const env = {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions: { finance: 'edit' }, identity: 'admin@example.org' }));
        return new Response('{}', { status: 404 });
      },
    },
  };
  return { env, db };
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

});
