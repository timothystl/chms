import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/api-utils.js';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { handleFinanceApi } from '../src/api-finance.js';
import { FINANCE_TABLES } from '../src/finance-storage.js';
import { withLocalContractReads } from '../apps/finance/local-contract-reads.js';
import { fetchDaycareChurchBudgetPreview, fetchFinanceImportStatus } from '../apps/finance/finance-data-imports-client.js';
import {
  validateFinanceBoardPacketV1, validateFinanceDaycareChurchBudgetPreviewV1, validateFinanceImportStatusV1,
} from '../contracts/validators/finance-data-imports-consumer.js';
import { buildAccountBalances, flattenQuickbooksReport, readQuickbooksSnapshot } from '../apps/finance/quickbooks-snapshot-service.js';
import worker from '../apps/finance/shell.js';

// Synthetic accounting tables with the columns the Data & Imports reads touch. No real records.
const SCHEMA = `
CREATE TABLE finance_church_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fiscal_year INTEGER NOT NULL, period_month INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL, category_path TEXT NOT NULL, account_name TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, has_children INTEGER NOT NULL DEFAULT 0,
  own_actual_cents INTEGER NOT NULL DEFAULT 0, own_budget_cents INTEGER, account_qbo_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'qbo_sync', notes TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(fiscal_year, period_month, category_path, source));
CREATE TABLE finance_church_balances (id INTEGER PRIMARY KEY, fiscal_year INTEGER, category_path TEXT, as_of_date TEXT, source TEXT, synced_at TEXT);
CREATE TABLE finance_import_log (importer_key TEXT PRIMARY KEY, last_imported_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE TABLE finance_property_budget_monthly (id INTEGER PRIMARY KEY, source TEXT, updated_at TEXT);
CREATE TABLE finance_property_monthly (id INTEGER PRIMARY KEY, period TEXT, updated_at TEXT);
CREATE TABLE finance_daycare_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT, category TEXT, entry_type TEXT, amount_cents INTEGER, notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE finance_qb_snapshot (key TEXT PRIMARY KEY, value TEXT NOT NULL, synced_at TEXT NOT NULL DEFAULT '');
CREATE TABLE funds (id INTEGER PRIMARY KEY, name TEXT, category TEXT);
CREATE TABLE giving_monthly_fund_totals (month TEXT, fund_id INTEGER, total_cents INTEGER);
`;

function makeDb(seed = '') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  if (seed) sqlite.exec(seed);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql), async batch(items) { return Promise.all(items.map((item) => item.run())); }, _raw: sqlite };
}

const SEED = `
INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, own_actual_cents, own_budget_cents, source, synced_at)
  VALUES (2025, 'Income', 'MDO Income:MDO Tuition', 'MDO Tuition', 1200000, 1100000, 'import', '2026-01-10 08:00:00'),
         (2025, 'Expenses', 'MDO Expenses:MDO Wages', 'MDO Wages', 800000, 850000, 'import', '2026-01-10 08:00:00'),
         (2025, 'Expenses', 'Utilities', 'Utilities', 300000, 320000, 'import', '2026-01-10 08:00:00');
INSERT INTO finance_import_log (importer_key, last_imported_at, note) VALUES ('church_balance', '2026-09-01T12:00:00.000Z', 'FY2026');
INSERT INTO funds (id, name, category) VALUES (1, 'General Fund', 'general');
INSERT INTO giving_monthly_fund_totals (month, fund_id, total_cents) VALUES ('2025-03', 1, 500000), ('2025-04', 1, 250000);
`;

function contract(path, db, key = 'k') {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'k' };
  return handleContractsServiceApi(new Request(`https://connect.example${path}`, { headers: key ? { 'X-Contract-Key': key } : {} }), env, path.split('?')[0]);
}

describe('Data & Imports read contracts (Connect side)', () => {
  it('needs the contract key like every other finance-* read', async () => {
    for (const path of ['/api/contracts/finance-import-status-v1', '/api/contracts/finance-daycare-church-budget-preview-v1?year=2025', '/api/contracts/finance-board-packet-v1?year=2025']) {
      expect((await contract(path, makeDb(), null)).status, path).toBe(401);
      expect((await contract(path, makeDb(), 'wrong')).status, path).toBe(401);
    }
  });

  it('import status lists every importer with its logged, derived or missing date', async () => {
    const res = await contract('/api/contracts/finance-import-status-v1', makeDb(SEED));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateFinanceImportStatusV1(body).ok).toBe(true);
    const byKey = Object.fromEntries(body.importers.map((i) => [i.key, i]));
    expect(body.importers).toHaveLength(10);
    expect(byKey.church_balance).toMatchObject({ lastImportedAt: '2026-09-01T12:00:00.000Z', derived: false, group: 'church' });
    expect(byKey.church_budget).toMatchObject({ lastImportedAt: '2026-01-10 08:00:00', derived: true });
    expect(byKey.daycare_bulk).toMatchObject({ lastImportedAt: '', derived: false, group: 'other' });
  });

  it('agrees with the legacy finance/import-status route it was extracted from', async () => {
    const db = makeDb(SEED);
    const url = new URL('https://connect.example/admin/api/finance/import-status');
    const legacy = await handleFinanceApi(new Request(url), { DB: db }, url, 'GET', 'finance/import-status', db, true, true);
    const legacyBody = await legacy.json();
    const contractBody = await (await contract('/api/contracts/finance-import-status-v1', db)).json();
    expect(contractBody.importers.map((i) => [i.key, i.lastImportedAt])).toEqual(legacyBody.importers.map((i) => [i.key, i.lastImportedAt || '']));

    const previewUrl = new URL('https://connect.example/admin/api/finance/daycare/church-budget-preview?year=2025');
    const legacyPreview = await (await handleFinanceApi(new Request(previewUrl), { DB: db }, previewUrl, 'GET', 'finance/daycare/church-budget-preview', db, true, true)).json();
    expect(legacyPreview).toMatchObject({ year: 2025, found: 4 });
  });

  it('previews the MDO accounts of an imported Church Budget without writing anything', async () => {
    const db = makeDb(SEED);
    const res = await contract('/api/contracts/finance-daycare-church-budget-preview-v1?year=2025', db);
    const body = await res.json();
    expect(validateFinanceDaycareChurchBudgetPreviewV1(body).ok).toBe(true);
    expect(body).toMatchObject({ fiscalYear: 2025, available: true, found: 4 });
    expect(body.byCategory).toEqual([
      { category: 'Payroll', actualCents: 800000, budgetCents: 850000 },
      { category: 'Tuition Income', actualCents: 1200000, budgetCents: 1100000 },
    ]);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_daycare_entries').get().n).toBe(0);
  });

  it('reports a missing Church Budget year honestly and rejects a bad year', async () => {
    const body = await (await contract('/api/contracts/finance-daycare-church-budget-preview-v1?year=2019', makeDb(SEED))).json();
    expect(body).toMatchObject({ available: false, found: 0, entries: [] });
    expect(body.message).toContain('No imported Church Budget found for 2019');
    expect((await contract('/api/contracts/finance-daycare-church-budget-preview-v1?year=abc', makeDb())).status).toBe(400);
    expect((await contract('/api/contracts/finance-board-packet-v1', makeDb())).status).toBe(400);
  });

  it('wraps the legacy board packet, giving fund totals included', async () => {
    const body = await (await contract('/api/contracts/finance-board-packet-v1?year=2025', makeDb(SEED))).json();
    expect(validateFinanceBoardPacketV1(body).ok).toBe(true);
    expect(body.packet.year).toBe(2025);
    expect(body.packet.church.income_statement_this_year.giving_reference_cents).toBe(750000);
    expect(body.packet.church.income_statement_5yr_trend.years).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(Array.isArray(body.packet.daycare.entries)).toBe(true);
  });

  it('validators fail closed on extra or malformed fields', () => {
    expect(validateFinanceImportStatusV1({}).ok).toBe(false);
    const preview = {
      contract: 'connect.finance-daycare-church-budget-preview.v1', dataClassification: 'aggregate', sourceProduct: 'connect',
      consumerProduct: 'finance', generatedAt: '2026-09-01T00:00:00Z', currency: 'USD', fiscalYear: 2025,
      available: true, message: '', found: 2, byCategory: [], entries: [],
    };
    expect(validateFinanceDaycareChurchBudgetPreviewV1(preview).ok).toBe(false);
    expect(validateFinanceDaycareChurchBudgetPreviewV1({ ...preview, found: 0 }).ok).toBe(true);
    expect(validateFinanceDaycareChurchBudgetPreviewV1({ ...preview, found: 0, extra: 1 }).ok).toBe(false);
  });
});

describe('Data & Imports reads in Finance', () => {
  it('answers import status and the preview from FINANCE_DB, and sends the board packet to Connect', async () => {
    const calls = [];
    const env = withLocalContractReads({
      FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: makeDb(SEED), FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: { async fetch(req) { calls.push(new URL(req.url).pathname); return new Response('{}', { status: 503 }); } },
    });
    const status = await fetchFinanceImportStatus(env);
    expect(status.ok).toBe(true);
    const preview = await fetchDaycareChurchBudgetPreview(env, 2025);
    expect(preview.ok && preview.preview.found).toBe(4);
    expect(calls).toEqual([]);
    await env.CONNECT_SERVICE.fetch(new Request('https://connect.timothystl.org/api/contracts/finance-board-packet-v1?year=2025'));
    expect(calls).toEqual(['/api/contracts/finance-board-packet-v1']);
  });

  it('every table the local reads touch is Finance-owned', () => {
    for (const table of ['finance_import_log', 'finance_church_entries', 'finance_church_balances', 'finance_property_budget_monthly', 'finance_property_monthly', 'finance_daycare_entries']) {
      expect(FINANCE_TABLES.has(table), table).toBe(true);
    }
  });

  it('reads and flattens the cached QuickBooks reports without touching tokens', async () => {
    const db = makeDb(`INSERT INTO finance_qb_snapshot (key, value, synced_at) VALUES
      ('budget_vs_actual', '${JSON.stringify({ Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }] }, Rows: { Row: [{ type: 'Section', Header: { ColData: [{ value: 'Income' }] }, Rows: { Row: [{ ColData: [{ value: 'Offerings' }, { value: '1234.5' }] }] }, Summary: { ColData: [{ value: 'Total Income' }, { value: '1234.5' }] } }] }, _synthesized: true })}', '2026-09-20T10:00:00Z'),
      ('accounts', '${JSON.stringify({ QueryResponse: { Account: [{ Name: 'Operating Checking', AccountType: 'Bank', CurrentBalance: 100.25 }] } })}', '2026-09-20T10:00:00Z'),
      ('daycare_accounts', '${JSON.stringify([{ name: 'MDO Operating', balance_cents: 5000 }])}', '2026-09-19T10:00:00Z')`);
    const snapshot = await readQuickbooksSnapshot(db);
    const report = flattenQuickbooksReport(snapshot.budgetVsActual);
    expect(report.columns).toEqual(['Account', 'Actual']);
    expect(report.rows).toEqual([
      { cells: ['Income'], depth: 0, total: false },
      { cells: ['Offerings', '1234.5'], depth: 1, total: false },
      { cells: ['Total Income', '1234.5'], depth: 0, total: true },
    ]);
    expect(report.synthesized).toBe(true);
    const balances = buildAccountBalances(snapshot);
    expect(balances.accounts.map((a) => [a.source, a.name, a.balanceCents])).toEqual([['Daycare app', 'MDO Operating', 5000], ['QuickBooks', 'Operating Checking', 10025]]);
    expect(balances.totalCents).toBe(15025);
  });
});

function financeEnv(role, { db = makeDb(SEED), qb = '1', onContract } = {}) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_CONTRACT_API_KEY: 'k', FINANCE_DB: db, FINANCE_QB_ENABLED: qb,
    FINANCE_LOCAL_CONTRACT_READS: '1',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/api/contracts/staff-role-v1') {
          return role ? new Response(JSON.stringify({ role, permissions: DEFAULT_ROLE_PERMISSIONS[role], identity: 'staff@example.test' })) : new Response('{}', { status: 403 });
        }
        if (onContract) { const answer = await onContract(url, req); if (answer) return answer; }
        return new Response('{}', { status: 503 });
      },
    },
  };
}

async function page(path, env) {
  const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), env);
  return { status: res.status, html: await res.text() };
}

describe('Accounts & Data -> Data page', () => {
  it('organizes connections, importers with status, adjustments, removals and raw QuickBooks output', async () => {
    const db = makeDb(SEED);
    db._raw.exec(`INSERT INTO finance_qb_snapshot (key, value, synced_at) VALUES ('accounts', '${JSON.stringify({ QueryResponse: { Account: [{ Name: 'Operating Checking', AccountType: 'Bank', CurrentBalance: 100.25 }] } })}', '2026-09-20T10:00:00Z')`);
    const { status, html } = await page('/?section=data', financeEnv('admin', { db }));
    expect(status).toBe(200);
    expect(html).toContain('aria-label="Connections"');
    expect(html).toContain('action="/api/v1/board-packet-export"');
    expect(html).toContain('Feeds Church Report');
    expect(html).toContain('href="/?section=balance&amp;page=account-detail"');
    expect(html).toContain('Daycare bulk paste (past years)</td><td><strong class="status-error">never</strong>');
    expect(html).toContain('(from the data)');
    expect(html).toContain('aria-label="Hand-entered adjustments"');
    expect(html).toContain('aria-label="Destructive controls"');
    expect(html).toContain('name="dc_cb_year"');
    expect(html).toContain('<summary>Account balances</summary>');
    expect(html).toContain('Operating Checking');
    expect(html).toContain('$100.25');
    expect(html).not.toContain('<script');
  });

  it('shows the Church Budget preview and offers the import only to admins', async () => {
    const admin = await page('/?section=data&dc_cb_year=2025', financeEnv('admin'));
    expect(admin.html).toContain('Found 4 daycare entries for FY2025');
    expect(admin.html).toContain('<input type="hidden" name="return_to" value="data">');
    const finance = await page('/?section=data&dc_cb_year=2025', financeEnv('finance'));
    expect(finance.html).toContain('Found 4 daycare entries for FY2025');
    expect(finance.html).not.toContain('action="/api/v1/connect-daycare-church-budget-import-write"');
    expect(finance.html).toContain('Only admins can run imports.');
  });

  it('says so when Finance\'s QuickBooks connection is not enabled', async () => {
    const { html } = await page('/?section=data', financeEnv('admin', { qb: '0' }));
    expect(html).toContain('QuickBooks connection is not enabled in this environment');
  });

  it('returns a committed Data-page import to the Data page', async () => {
    const env = financeEnv('admin', { onContract: (url) => (url.pathname === '/api/contracts/finance-daycare-church-budget-import-write-v1' ? new Response(JSON.stringify({ ok: true, imported: 4 })) : null) });
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-daycare-church-budget-import-write', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      body: new URLSearchParams({ year: '2025', return_to: 'data' }),
    }), env);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(Object.fromEntries(location.searchParams)).toEqual({ section: 'data', op: 'daycare-church-budget', status: 'ok' });
    const shown = await page(`${location.pathname}${location.search}`, financeEnv('admin'));
    expect(shown.html).toContain('Imported from the Church Budget in Connect.');
  });
});

describe('Board packet JSON export', () => {
  const packetContract = (url) => {
    if (url.pathname !== '/api/contracts/finance-board-packet-v1') return null;
    return (async () => {
      const db = makeDb(SEED);
      return handleContractsServiceApi(new Request(`https://connect.example${url.pathname}${url.search}`, { headers: { 'X-Contract-Key': 'k' } }), { DB: db, FINANCE_CONTRACT_API_KEY: 'k' }, url.pathname);
    })();
  };

  it('downloads the packet for a Finance viewer', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/board-packet-export?year=2025', { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), financeEnv('finance', { onContract: packetContract }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="board-packet-2025.json"');
    const body = JSON.parse(await res.text());
    expect(Object.keys(body)).toEqual(['generated_at', 'year', 'church', 'daycare']);
    expect(body.church.income_statement_this_year.giving_by_fund).toEqual([{ fundName: 'General Fund', cents: 750000 }]);
  });

  it('refuses an unverified viewer, a bad year, and reports an unavailable packet', async () => {
    const denied = await worker.fetch(new Request('https://finance.test/api/v1/board-packet-export?year=2025', { headers: { 'Cf-Access-Jwt-Assertion': 'x' } }), financeEnv(null));
    expect(denied.status).toBe(403);
    const bad = await worker.fetch(new Request('https://finance.test/api/v1/board-packet-export?year=20', { headers: { 'Cf-Access-Jwt-Assertion': 'x' } }), financeEnv('admin'));
    expect(bad.status).toBe(400);
    const down = await worker.fetch(new Request('https://finance.test/api/v1/board-packet-export?year=2025', { headers: { 'Cf-Access-Jwt-Assertion': 'x' } }), financeEnv('admin'));
    expect(down.status).toBe(502);
    const post = await worker.fetch(new Request('https://finance.test/api/v1/board-packet-export', { method: 'POST' }), financeEnv('admin'));
    expect(post.status).toBe(405);
  });
});
