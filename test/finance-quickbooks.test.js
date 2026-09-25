import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import {
  handleBudgetSelect, handleCallback, handleConnect, handleDisconnect, handleSync, handleSyncYears, readConnectionSummary,
} from '../apps/finance/quickbooks-oauth-routes.js';
import * as financeSync from '../apps/finance/quickbooks-church-sync.js';
import * as connectFinance from '../src/api-finance.js';
import { financeStorageDb } from '../src/finance-storage.js';

// QuickBooks owned by Finance (Andrew, 2026-09-25): Finance's handlers against a real SQLite
// database built from Finance's own migrations, Intuit mocked; Connect's kill switch and storage
// routing; and the church-entry helpers checked against Connect's originals.

const NOW_MS = Date.parse('2026-09-25T12:00:00Z');
const ENV = { FINANCE_QB_CLIENT_ID: 'client-1', FINANCE_QB_CLIENT_SECRET: 'secret-1', FINANCE_QB_ENVIRONMENT: 'production' };

function financeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../apps/finance/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => sqlite.prepare(sql).run(...args),
  });
  return { raw: sqlite, prepare: (sql) => statement(sql), batch: async (ops) => { for (const op of ops) await op.run(); return []; } };
}

function connect(db, overrides = {}) {
  db.raw.prepare(`INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at)
    VALUES (1, 'realm-9', 'Timothy Lutheran Church', 'AT', 'RT', ?, '2027-01-01T00:00:00.000Z', 'production', '2026-09-25 12:00:00', '')`)
    .run(overrides.accessExpiresAt || new Date(NOW_MS + 3600_000).toISOString());
}

const INTUIT = {
  authorization_endpoint: 'https://mock-appcenter.example/connect/oauth2',
  token_endpoint: 'https://mock-oauth.example/tokens/bearer',
  revocation_endpoint: 'https://mock-oauth.example/tokens/revoke',
};

const row = (label, ...values) => ({ ColData: [{ value: label }, ...values.map((v) => ({ value: String(v) }))] });
const section = (label, rows) => ({ type: 'Section', Header: { ColData: [{ value: label }] }, Rows: { Row: rows } });

// Two prior-year columns plus the current year in the multi-year P&L; monthly columns for two months.
const REPORTS = {
  budgets: { QueryResponse: { Budget: [{ Id: '7', Name: 'FY2026 Budget', StartDate: '2026-01-01', EndDate: '2026-12-31', BudgetEntryType: 'Monthly', Active: true, BudgetDetail: [] }] } },
  multiYear: {
    Columns: { Column: [{ ColTitle: '' }, { ColTitle: '2024' }, { ColTitle: '2025' }, { ColTitle: '2026' }, { ColTitle: 'Total' }] },
    Rows: { Row: [section('Revenue', [row('Offerings', 100, 200, 300, 600)]), section('Expenditures', [row('Utilities', 10, 20, 30, 60)]), row('Net Revenue', 90, 180, 270, 540)] },
  },
  monthly: {
    Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Aug 2026' }, { ColTitle: 'Sep 2026' }, { ColTitle: 'Total' }] },
    Rows: { Row: [section('Revenue', [row('Offerings', 25, 30, 55)])] },
  },
  singleYear: { Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] }, Rows: { Row: [section('Revenue', [row('Offerings', 400)])] } },
};

function intuitFetch({ tokenBody } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('openid_configuration')) return new Response(JSON.stringify(INTUIT));
    if (u.includes('tokens/bearer')) return new Response(JSON.stringify(tokenBody || { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, x_refresh_token_expires_in: 8640000 }));
    if (u.includes('tokens/revoke')) return new Response('', { status: 200 });
    if (u.includes('/companyinfo/')) return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Timothy Lutheran Church' } }));
    if (u.includes('SELECT%20*%20FROM%20Budget')) return new Response(JSON.stringify(REPORTS.budgets));
    if (u.includes('/query?')) return new Response(JSON.stringify({ QueryResponse: { Account: [{ Id: '1', Name: 'Checking' }] } }));
    if (u.includes('/reports/ProfitAndLoss')) {
      const params = new URL(u).searchParams;
      if (params.get('summarize_column_by') === 'Year') return new Response(JSON.stringify(REPORTS.multiYear));
      if (params.get('summarize_column_by') === 'Month') return new Response(JSON.stringify(REPORTS.monthly));
      return new Response(JSON.stringify(REPORTS.singleYear));
    }
    if (u.includes('/reports/BudgetVsActuals')) return new Response('{"Fault":{}}', { status: 400 });
    return new Response('{}');
  });
}

const ctx = (extra = {}) => ({ isAdmin: true, now: () => NOW_MS, fetchImpl: intuitFetch(), randomUUID: () => 'state-1', ...extra });
const location = (res) => new URL(res.headers.get('location'), 'https://finance.timothystl.org');
const post = (path, pairs = []) => new Request(`https://finance.timothystl.org${path}`, { method: 'POST', body: new URLSearchParams(pairs) });

describe('connect and callback', () => {
  it('refuses non-admins and unconfigured credentials, back on the QuickBooks page', async () => {
    const url = new URL('https://finance.timothystl.org/api/v1/qb/connect');
    const denied = await handleConnect(null, url, ENV, financeDb(), ctx({ isAdmin: false }));
    expect(location(denied).searchParams.get('qb')).toBe('error');
    const unconfigured = await handleConnect(null, url, {}, financeDb(), ctx());
    expect(location(unconfigured).searchParams.get('message')).toMatch(/FINANCE_QB_CLIENT_ID/);
  });

  it('stores a CSRF state and sends the admin to Intuit with Finance’s own callback', async () => {
    const db = financeDb();
    const res = await handleConnect(null, new URL('https://finance.timothystl.org/api/v1/qb/connect'), ENV, db, ctx());
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.searchParams.get('redirect_uri')).toBe('https://finance.timothystl.org/api/v1/qb/callback');
    expect(to.searchParams.get('state')).toBe('state-1');
    expect(db.raw.prepare('SELECT state FROM finance_qb_oauth_state').all()).toEqual([{ state: 'state-1' }]);
  });

  it('completes the handshake into Finance’s own connection row and consumes the state', async () => {
    const db = financeDb();
    db.raw.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').run('state-1', new Date(NOW_MS + 60_000).toISOString());
    const url = new URL('https://finance.timothystl.org/api/v1/qb/callback?code=c&realmId=realm-9&state=state-1');
    const res = await handleCallback(null, url, ENV, db, ctx({ fetchImpl: intuitFetch({ tokenBody: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, x_refresh_token_expires_in: 8640000 } }) }));
    expect(location(res).searchParams.get('qb')).toBe('connected');
    expect(await readConnectionSummary(db)).toMatchObject({ connected: true, companyName: 'Timothy Lutheran Church', environment: 'production' });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM finance_qb_oauth_state').get().n).toBe(0);
    const replay = await handleCallback(null, url, ENV, db, ctx());
    expect(location(replay).searchParams.get('qb')).toBe('error');
  });

  it('refuses an expired state', async () => {
    const db = financeDb();
    db.raw.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').run('state-1', new Date(NOW_MS - 1).toISOString());
    const res = await handleCallback(null, new URL('https://finance.timothystl.org/api/v1/qb/callback?code=c&realmId=r&state=state-1'), ENV, db, ctx());
    expect(location(res).searchParams.get('message')).toMatch(/expired/);
    expect(await readConnectionSummary(db)).toEqual({ connected: false });
  });

  it('never exposes tokens in the page summary', async () => {
    const db = financeDb();
    connect(db);
    expect(JSON.stringify(await readConnectionSummary(db))).not.toMatch(/"AT"|"RT"/);
  });
});

describe('sync', () => {
  it('writes the snapshot and Church Report entries exactly as legacy Connect does', async () => {
    const db = financeDb();
    connect(db);
    db.raw.prepare("INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, source) VALUES (2025, 0, 'Income', 'Revenue:Stale', 'Stale', 'qbo_sync')").run();
    db.raw.prepare("INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, source) VALUES (2025, 0, 'Income', 'Revenue:Imported', 'Imported', 'import')").run();
    const res = await handleSync(post('/api/v1/qb/sync'), null, ENV, db, ctx());
    expect(location(res).searchParams.get('qb')).toBe('synced');

    const entries = db.raw.prepare("SELECT fiscal_year, period_month, classification, category_path, own_actual_cents FROM finance_church_entries WHERE source='qbo_sync' ORDER BY fiscal_year, period_month, category_path").all();
    // Prior years from the multi-year report (never the current year from it), normalized
    // classifications, no running-subtotal rows, and monthly rows for the current year.
    expect(entries.filter((e) => e.period_month === 0 && e.fiscal_year === 2024).map((e) => [e.classification, e.category_path, e.own_actual_cents])).toEqual([
      ['Expenses', 'Expenditures:Utilities', 1000], ['Income', 'Revenue:Offerings', 10000],
    ]);
    expect(entries.some((e) => e.category_path === 'Revenue:Stale')).toBe(false);
    expect(entries.filter((e) => e.period_month > 0).map((e) => [e.period_month, e.own_actual_cents])).toEqual([[8, 2500], [9, 3000]]);
    expect(entries.some((e) => /Net Revenue/.test(e.category_path))).toBe(false);
    // Other sources are never touched.
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='import'").get().n).toBe(1);

    expect(db.raw.prepare("SELECT key FROM finance_qb_snapshot ORDER BY key").all().map((r) => r.key)).toContain('accounts');
    expect((await readConnectionSummary(db)).lastSyncedAt).toBe(new Date(NOW_MS).toISOString());
  });

  it('refreshes an expiring token first and stores the rotated pair', async () => {
    const db = financeDb();
    connect(db, { accessExpiresAt: new Date(NOW_MS + 30_000).toISOString() });
    await handleSync(post('/api/v1/qb/sync'), null, ENV, db, ctx());
    expect(db.raw.prepare('SELECT access_token, refresh_token FROM finance_qb_connection').get()).toEqual({ access_token: 'AT2', refresh_token: 'RT2' });
  });

  it('syncs actuals for chosen years only', async () => {
    const db = financeDb();
    connect(db);
    const res = await handleSyncYears(post('/api/v1/qb/sync-years', [['fiscal_year', '2019']]), null, ENV, db, ctx());
    expect(location(res).searchParams.get('rows')).toBe('1');
    expect(db.raw.prepare("SELECT DISTINCT fiscal_year FROM finance_church_entries WHERE source='qbo_sync'").all()).toEqual([{ fiscal_year: 2019 }]);
    const bad = await handleSyncYears(post('/api/v1/qb/sync-years', [['fiscal_year', '1850']]), null, ENV, db, ctx());
    expect(location(bad).searchParams.get('qb')).toBe('error');
  });

  it('asks for a connection before syncing', async () => {
    const res = await handleSync(post('/api/v1/qb/sync'), null, ENV, financeDb(), ctx());
    expect(location(res).searchParams.get('message')).toMatch(/not connected/);
  });
});

describe('budget choice and disconnect', () => {
  it('stores or clears the chosen budget id', async () => {
    const db = financeDb();
    await handleBudgetSelect(post('/api/v1/qb/budget-select', [['budget_id', '7']]), null, ENV, db, ctx());
    expect(db.raw.prepare("SELECT value FROM finance_settings WHERE key='finance_qb_selected_budget_id'").get().value).toBe('7');
    await handleBudgetSelect(post('/api/v1/qb/budget-select', [['budget_id', '']]), null, ENV, db, ctx());
    expect(db.raw.prepare("SELECT value FROM finance_settings WHERE key='finance_qb_selected_budget_id'").get()).toBeUndefined();
    const bad = await handleBudgetSelect(post('/api/v1/qb/budget-select', [['budget_id', "7' OR 1"]]), null, ENV, db, ctx());
    expect(location(bad).searchParams.get('qb')).toBe('error');
  });

  it('revokes the token and clears the connection and cache', async () => {
    const db = financeDb();
    connect(db);
    db.raw.prepare("INSERT INTO finance_qb_snapshot (key, value, synced_at) VALUES ('accounts', '{}', 'x')").run();
    const fetchImpl = intuitFetch();
    const res = await handleDisconnect(post('/api/v1/qb/disconnect'), null, ENV, db, ctx({ fetchImpl }));
    expect(location(res).searchParams.get('qb')).toBe('disconnected');
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('tokens/revoke'))).toBe(true);
    expect(await readConnectionSummary(db)).toEqual({ connected: false });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM finance_qb_snapshot').get().n).toBe(0);
  });
});

describe('Finance shell wiring', () => {
  const role = (r) => ({
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k', FINANCE_DB: financeDb(), ...ENV,
    CONNECT_SERVICE: { fetch: async (req) => (new URL(req.url).pathname === '/api/contracts/staff-role-v1'
      ? new Response(JSON.stringify({ role: r, permissions: { finance: 'edit' } })) : new Response('nf', { status: 404 })) },
  });

  it('answers "not enabled" while FINANCE_QB_ENABLED is off, without touching QuickBooks', async () => {
    const env = role('admin');
    const res = await worker.fetch(new Request('https://finance.test/api/v1/qb/connect', { headers: { 'Cf-Access-Jwt-Assertion': 'j' } }), env);
    expect(res.status).toBe(303);
    expect(location(res).searchParams.get('message')).toMatch(/not enabled/);
    expect(env.FINANCE_DB.raw.prepare('SELECT COUNT(*) AS n FROM finance_qb_oauth_state').get().n).toBe(0);
  });

  it('when enabled, shows admins the Connect button and others only the status', async () => {
    const page = async (r) => (await worker.fetch(new Request('https://finance.test/?section=quickbooks&page=sync-status', { headers: { 'Cf-Access-Jwt-Assertion': 'j' } }), { ...role(r), FINANCE_QB_ENABLED: '1' })).text();
    const admin = await page('admin');
    expect(admin).toContain('href="/api/v1/qb/connect"');
    expect(admin).toContain('Not connected');
    const finance = await page('finance');
    expect(finance).toContain('Not connected');
    expect(finance).not.toContain('/api/v1/qb/connect');
  });

  it('when enabled, refuses a non-admin sync', async () => {
    const env = { ...role('finance'), FINANCE_QB_ENABLED: '1' };
    const res = await worker.fetch(new Request('https://finance.test/api/v1/qb/sync', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'j' } }), env);
    expect(location(res).searchParams.get('message')).toMatch(/Only admins/);
  });
});

describe('Connect once Finance owns QuickBooks (QBO_MANAGED_BY_FINANCE="1")', () => {
  const connectDb = new Proxy({}, { get() { throw new Error('Connect must not touch its database here'); } });
  const call = (seg, method, env) => {
    const url = new URL(`https://connect.test/admin/api/${seg}`);
    return connectFinance.handleFinanceApi(new Request(url, { method, body: method === 'GET' ? undefined : '{}' }), env, url, method, seg, connectDb, true, true, 'admin');
  };

  it.each([['finance/qb/connect', 'GET'], ['finance/qb/callback', 'GET'], ['finance/qb/disconnect', 'POST'], ['finance/qb/sync', 'POST'],
    ['finance/qb/sync-years', 'POST'], ['finance/qb/budgets', 'GET'], ['finance/qb/budgets', 'PATCH'], ['finance/qb/transactions', 'GET']])(
    'refuses %s %s and points to Finance', async (seg, method) => {
      const res = await call(seg, method, { QBO_MANAGED_BY_FINANCE: '1' });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/managed in Finance/);
    });

  it('routes the QuickBooks connection and cache to Finance’s database only when switched', () => {
    const tag = (name) => ({ prepare: (sql) => ({ bind: () => ({ first: async () => ({ db: name, sql }) }) }) });
    const DB = tag('connect'); const FINANCE_DB = tag('finance');
    const before = financeStorageDb({ DB, FINANCE_DB, FINANCE_STORAGE_MODE: 'finance' });
    const after = financeStorageDb({ DB, FINANCE_DB, FINANCE_STORAGE_MODE: 'finance', QBO_MANAGED_BY_FINANCE: '1' });
    expect(before.prepare('SELECT * FROM finance_qb_connection WHERE id=1')).not.toBe(after.prepare('SELECT * FROM finance_qb_connection WHERE id=1'));
    return Promise.all([
      before.prepare('SELECT * FROM finance_qb_connection WHERE id=1').bind().first().then((r) => expect(r.db).toBe('connect')),
      after.prepare('SELECT * FROM finance_qb_connection WHERE id=1').bind().first().then((r) => expect(r.db).toBe('finance')),
      after.prepare("SELECT value FROM finance_qb_snapshot WHERE key='accounts'").bind().first().then((r) => expect(r.db).toBe('finance')),
      after.prepare('SELECT username FROM app_users WHERE id=?').bind().first().then((r) => expect(r.db).toBe('connect')),
    ]);
  });
});

describe('church-entry helpers match Connect’s originals', () => {
  it.each(['dollarsToCents'])('%s', () => {
    for (const v of ['9,765.27', '-12.5', '', null, 'abc', 3]) expect(financeSync.dollarsToCents(v)).toBe(financeSync.dollarsToCents(String(v ?? '')));
  });
  it('normalizes classifications and parses month columns identically', () => {
    for (const label of ['Revenue', 'Expenditures', 'Other Revenue', 'COGS', 'Custom']) {
      expect(financeSync.normalizeChurchClassification(label)).toBe(connectFinance.normalizeChurchClassification(label));
    }
    for (const t of ['Jan 2026', 'Sept 2025', 'Total', '']) expect(financeSync.parseMonthColTitle(t)).toEqual(connectFinance.parseMonthColTitle(t));
  });
  it('flattens every report shape identically', () => {
    const cases = [
      [REPORTS.multiYear.Rows.Row, (m) => m.makeMultiYearExtractor([2024, 2025, null, null])],
      [REPORTS.monthly.Rows.Row, (m) => m.makeMonthlyExtractor([{ year: 2026, month: 8 }, { year: 2026, month: 9 }, null])],
      [REPORTS.singleYear.Rows.Row, (m) => m.makeSingleYearActualExtractor(2019)],
      [[section('Revenue', [row('Offerings', 5, 6, -1)])], (m) => m.makeCurrentYearExtractor(2026)],
    ];
    for (const [rows, extractor] of cases) {
      expect(financeSync.flattenReportTree(rows, [], null, extractor(financeSync))).toEqual(connectFinance.flattenReportTree(rows, [], null, extractor(connectFinance)));
    }
  });
  it('persists with the same statements', async () => {
    const record = () => { const calls = []; return { calls, prepare: (sql) => ({ bind: (...a) => { calls.push([sql, a]); return {}; } }), batch: async () => [] }; };
    const rows = financeSync.flattenReportTree(REPORTS.multiYear.Rows.Row, [], null, financeSync.makeMultiYearExtractor([2024, 2025, null, null]));
    const a = record(); const b = record();
    await financeSync.persistChurchEntries(a, rows, 'now');
    await connectFinance.persistChurchEntries(b, rows, 'now');
    expect(a.calls).toEqual(b.calls);
  });
});
