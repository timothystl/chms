import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { withLocalContractReads, localContractReadsEnabled } from '../apps/finance/local-contract-reads.js';
import { fetchLiveFinanceChurchReport } from '../apps/finance/finance-church-report-client.js';

// Column-for-column the finance_church_entries table Connect's Church Report contract reads.
function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE finance_church_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fiscal_year INTEGER NOT NULL, period_month INTEGER NOT NULL DEFAULT 0,
    classification TEXT NOT NULL, category_path TEXT NOT NULL, account_name TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0, has_children INTEGER NOT NULL DEFAULT 0,
    own_actual_cents INTEGER NOT NULL DEFAULT 0, own_budget_cents INTEGER, account_qbo_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'qbo_sync', notes TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(fiscal_year, period_month, category_path, source))`);
  sqlite.prepare(`INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, own_actual_cents, own_budget_cents)
    VALUES (2026, 'Income', 'Offerings', 'Offerings', 5000000, 4800000), (2026, 'Expenses', 'Utilities', 'Utilities', 1200000, 1300000)`).run();
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql) };
}

function connectSpy(response = () => new Response('{}', { status: 503 })) {
  const calls = [];
  return { calls, binding: { async fetch(request) { calls.push(new URL(request.url).pathname); return response(request); } } };
}

describe('Finance report reads from its own database', () => {
  it('answers the Church Report from FINANCE_DB without calling Connect', async () => {
    const connect = connectSpy();
    const env = withLocalContractReads({
      FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: makeFinanceDb(),
      CONNECT_SERVICE: connect.binding, FINANCE_CONTRACT_API_KEY: 'key',
    });
    const result = await fetchLiveFinanceChurchReport(env, 2026);
    expect(result.ok).toBe(true);
    expect(result.report.totals.incomeActualCents).toBe(5000000);
    expect(result.report.totals.expenseActualCents).toBe(1200000);
    expect(connect.calls).toEqual([]);
  });

  it('still sends roles, Giving and writes to Connect', async () => {
    const connect = connectSpy(() => new Response('{}', { status: 200 }));
    const env = withLocalContractReads({
      FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: makeFinanceDb(), CONNECT_SERVICE: connect.binding,
    });
    await env.CONNECT_SERVICE.fetch(new Request('https://connect.timothystl.org/api/contracts/staff-role-v1'));
    await env.CONNECT_SERVICE.fetch(new Request('https://connect.timothystl.org/api/contracts/connect-giving-summary-v1'));
    await env.CONNECT_SERVICE.fetch(new Request('https://connect.timothystl.org/api/contracts/finance-church-report-v1?fiscal_year=2026', { method: 'POST', body: '{}' }));
    expect(connect.calls).toEqual([
      '/api/contracts/staff-role-v1', '/api/contracts/connect-giving-summary-v1', '/api/contracts/finance-church-report-v1',
    ]);
  });

  it('falls back to Connect when a local read fails', async () => {
    const connect = connectSpy(() => new Response('{"ok":true}', { status: 200 }));
    const brokenDb = { prepare() { throw new Error('no such table'); } };
    const env = withLocalContractReads({ FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: brokenDb, CONNECT_SERVICE: connect.binding });
    const res = await env.CONNECT_SERVICE.fetch(new Request('https://connect.timothystl.org/api/contracts/finance-balance-sheet-trend-v1'));
    expect(res.status).toBe(200);
    expect(connect.calls).toEqual(['/api/contracts/finance-balance-sheet-trend-v1']);
  });

  it('is off unless the Worker opts in', () => {
    const env = { FINANCE_DB: makeFinanceDb(), CONNECT_SERVICE: connectSpy().binding };
    expect(localContractReadsEnabled(env)).toBe(false);
    expect(withLocalContractReads(env)).toBe(env);
  });
});
