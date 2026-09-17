import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import {
  parseCsvRows, parseMoneyCents,
  parseChurchEntriesCsv, persistChurchEntriesCsvImport,
  parseChurchBalancesCsv, persistChurchBalancesCsvImport,
  parseDaycareEntriesCsv, persistDaycareEntriesCsvImport,
  parsePropertyBudgetMonthlyCsv, persistPropertyBudgetMonthlyCsvImport,
  recordFinanceImport, isCsvImportWritesEnabled,
  runChurchEntriesCsvImport, runChurchBalancesCsvImport, runDaycareEntriesCsvImport, runPropertyBudgetMonthlyCsvImport,
  CSV_IMPORT_WRITES_DISABLED_MESSAGE,
} from '../apps/finance/csv-import-service.js';

// Minimal D1-shaped wrapper around node:sqlite loaded with Finance's REAL migration, same pattern
// as test/finance-church-monthly-import.test.js (legacy) and test/finance-settings-migration.test.js
// (this app) -- exercises the real schema/constraints (UNIQUE keys, ON CONFLICT targets), not a
// hand-trimmed stand-in that could silently drift from migrations/0001_finance_foundation.sql.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const info = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: info.lastInsertRowid, changes: info.changes } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { const info = sqlite.prepare(sql).run(); return { meta: { last_row_id: info.lastInsertRowid, changes: info.changes } }; },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

const CHURCH_CSV = `classification,category_path,account_name,depth,has_children,own_actual,own_budget
Income,Income:Offerings,General Fund Offerings,0,,"9,765.27",9500
Income,Income:Offerings:General,Sunday Offering,1,,500.50,
Expenses,Expenses:Utilities,Utilities,0,1,"1,200.00","1,000.00"`;

describe('parseCsvRows (ported tokenizer)', () => {
  it('keeps a quoted field with an embedded newline as one cell instead of splitting it into extra rows', () => {
    const text = 'category,notes\nUtilities,"line one\nline two"\nSupplies,plain';
    const rows = parseCsvRows(text);
    expect(rows).toEqual([
      ['category', 'notes'],
      ['Utilities', 'line one\nline two'],
      ['Supplies', 'plain'],
    ]);
  });

  it('handles a bare CRLF and a trailing row with no final newline', () => {
    const text = 'a,b\r\n1,2\r\n3,4';
    expect(parseCsvRows(text)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('drops a genuinely blank line but keeps a line that is only a comma (two empty cells)', () => {
    const text = 'a,b\n1,2\n\n,\n3,4';
    expect(parseCsvRows(text)).toEqual([['a', 'b'], ['1', '2'], ['', ''], ['3', '4']]);
  });
});

describe('parseMoneyCents (ported thousands-comma handling)', () => {
  it('strips thousands-separator commas instead of truncating at the first comma', () => {
    expect(parseMoneyCents('9,765.27')).toEqual({ cents: 976527 });
    expect(parseMoneyCents('1,234,567.89')).toEqual({ cents: 123456789 });
  });

  it('accepts a leading dollar sign and negative amounts', () => {
    expect(parseMoneyCents('$500.50')).toEqual({ cents: 50050 });
    expect(parseMoneyCents('-42.00')).toEqual({ cents: -4200 });
  });

  it('never fabricates a number: rejects unparsable text rather than returning 0', () => {
    expect(parseMoneyCents('N/A').error).toMatch(/not a valid amount/);
    expect(parseMoneyCents('12.34.56').error).toMatch(/not a valid amount/);
    expect(parseMoneyCents('').error).toMatch(/required/);
  });

  it('treats a blank optional value as null, not an error or a zero', () => {
    expect(parseMoneyCents('', { optional: true })).toEqual({ cents: null });
  });
});

describe('parseChurchEntriesCsv', () => {
  it('parses a valid annual Budget-vs-Actuals CSV, including embedded-comma amounts', () => {
    const { rows, errors } = parseChurchEntriesCsv(CHURCH_CSV);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { classification: 'Income', category_path: 'Income:Offerings', account_name: 'General Fund Offerings', depth: 0, has_children: false, own_actual_cents: 976527, own_budget_cents: 950000 },
      { classification: 'Income', category_path: 'Income:Offerings:General', account_name: 'Sunday Offering', depth: 1, has_children: false, own_actual_cents: 50050, own_budget_cents: null },
      { classification: 'Expenses', category_path: 'Expenses:Utilities', account_name: 'Utilities', depth: 0, has_children: true, own_actual_cents: 120000, own_budget_cents: 100000 },
    ]);
  });

  it('is case-insensitive on classification but rejects an unrecognized one', () => {
    const { rows, errors } = parseChurchEntriesCsv('classification,category_path,account_name,depth,own_actual\nincome,Income:X,X,0,100');
    expect(errors).toEqual([]);
    expect(rows[0].classification).toBe('Income');
    const bad = parseChurchEntriesCsv('classification,category_path,account_name,depth,own_actual\nRevenue,Income:X,X,0,100');
    expect(bad.errors[0]).toMatch(/must be "Income" or "Expenses"/);
    expect(bad.rows).toEqual([]);
  });

  it('rejects a missing required column with a specific message and no partial rows', () => {
    const { rows, errors } = parseChurchEntriesCsv('classification,category_path,account_name,depth\nIncome,X,Y,0');
    expect(errors).toEqual(['Missing required column "own_actual".']);
    expect(rows).toEqual([]);
  });

  it('rejects a non-numeric own_actual with a row-specific message, never a fabricated 0', () => {
    const { rows, errors } = parseChurchEntriesCsv('classification,category_path,account_name,depth,own_actual\nIncome,X,Y,0,not-a-number');
    expect(errors).toEqual(['Row 2: "own_actual" is not a valid amount ("not-a-number")']);
    expect(rows).toEqual([]);
  });

  it('rejects a non-integer depth', () => {
    const { errors } = parseChurchEntriesCsv('classification,category_path,account_name,depth,own_actual\nIncome,X,Y,1.5,100');
    expect(errors[0]).toMatch(/"depth" must be a whole number/);
  });
});

describe('parseChurchBalancesCsv', () => {
  it('parses a valid Balance Sheet CSV', () => {
    const csv = `classification,category_path,account_name,depth,own_balance
Assets,Assets:Cash,Operating Cash,0,"52,000.00"
Liabilities,Liabilities:AP,Accounts Payable,0,3200
Equity,Equity:Net,Net Assets,0,48800`;
    const { rows, errors } = parseChurchBalancesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { classification: 'Assets', category_path: 'Assets:Cash', account_name: 'Operating Cash', depth: 0, has_children: false, own_balance_cents: 5200000 },
      { classification: 'Liabilities', category_path: 'Liabilities:AP', account_name: 'Accounts Payable', depth: 0, has_children: false, own_balance_cents: 320000 },
      { classification: 'Equity', category_path: 'Equity:Net', account_name: 'Net Assets', depth: 0, has_children: false, own_balance_cents: 4880000 },
    ]);
  });

  it('rejects a classification outside Assets/Liabilities/Equity', () => {
    const { errors } = parseChurchBalancesCsv('classification,category_path,account_name,depth,own_balance\nIncome,X,Y,0,100');
    expect(errors[0]).toMatch(/must be "Assets", "Liabilities", or "Equity"/);
  });
});

describe('parseDaycareEntriesCsv', () => {
  it('parses period/category/entry_type/amount/notes, defaulting entry_type to actual', () => {
    const csv = `period,category,entry_type,amount,notes
2026-01,Tuition Income,,"12,500.00",
2026-01,Program Supplies,budget,-800.00,"Ordered in bulk"
2025,Tuition Income,actual,150000,`;
    const { rows, errors } = parseDaycareEntriesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { period: '2026-01', category: 'Tuition Income', entry_type: 'actual', amount_cents: 1250000, notes: '' },
      { period: '2026-01', category: 'Program Supplies', entry_type: 'budget', amount_cents: -80000, notes: 'Ordered in bulk' },
      { period: '2025', category: 'Tuition Income', entry_type: 'actual', amount_cents: 15000000, notes: '' },
    ]);
  });

  it('rejects a malformed period and an invalid entry_type', () => {
    const { errors } = parseDaycareEntriesCsv('period,category,amount,entry_type\n2026-1,X,100,weird');
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/"period" must be YYYY or YYYY-MM/),
      expect.stringMatching(/"entry_type" must be "actual" or "budget"/),
    ]));
  });
});

describe('parsePropertyBudgetMonthlyCsv', () => {
  it('parses period/revenue/expenses and computes net_income as revenue minus expenses', () => {
    const csv = `period,revenue,expenses
2027-01,"22,000.00","13,000.00"
2027-02,21000,12500`;
    const { rows, errors } = parsePropertyBudgetMonthlyCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { period: '2027-01', revenue_cents: 2200000, expenses_cents: 1300000, net_income_cents: 900000 },
      { period: '2027-02', revenue_cents: 2100000, expenses_cents: 1250000, net_income_cents: 850000 },
    ]);
  });

  it('rejects a period that is not YYYY-MM', () => {
    const { errors } = parsePropertyBudgetMonthlyCsv('period,revenue,expenses\n2027,1000,500');
    expect(errors[0]).toMatch(/"period" must be YYYY-MM/);
  });
});

describe('persistence — wholesale-replace-by-key idempotency and real schema constraints', () => {
  it('persistChurchEntriesCsvImport replaces only source=import_csv rows for the given fiscal year, never touching other sources', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, own_actual_cents, source)
      VALUES (2026, 0, 'Income', 'Income:Offerings', 'General Fund', 100000, 'synthetic_fixture')`);
    const { rows } = parseChurchEntriesCsv(CHURCH_CSV);
    await persistChurchEntriesCsvImport(db, rows, 2026, '2026-09-17T00:00:00.000Z');
    const imported = db._raw.prepare("SELECT * FROM finance_church_entries WHERE source='import_csv' ORDER BY category_path").all();
    expect(imported.length).toBe(3);
    const offerings = imported.find((r) => r.category_path === 'Income:Offerings');
    expect(offerings.own_actual_cents).toBe(976527);
    // Untouched synthetic row survives.
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='synthetic_fixture'").get().n).toBe(1);

    // Re-importing a corrected, smaller file replaces rather than appends (idempotent re-import).
    const smaller = 'classification,category_path,account_name,depth,own_actual\nIncome,Income:Offerings,General Fund Offerings,0,999.99';
    const { rows: rows2 } = parseChurchEntriesCsv(smaller);
    await persistChurchEntriesCsvImport(db, rows2, 2026, '2026-09-17T01:00:00.000Z');
    const after = db._raw.prepare("SELECT * FROM finance_church_entries WHERE source='import_csv'").all();
    expect(after.length).toBe(1);
    expect(after[0].own_actual_cents).toBe(99999);
  });

  it('persistChurchBalancesCsvImport wholesale-replaces by fiscal year', async () => {
    const db = makeTestDb();
    const { rows } = parseChurchBalancesCsv('classification,category_path,account_name,depth,own_balance\nAssets,Assets:Cash,Cash,0,100000');
    await persistChurchBalancesCsvImport(db, rows, 2026, '2026-12-31', '2026-09-17T00:00:00.000Z');
    let stored = db._raw.prepare("SELECT * FROM finance_church_balances WHERE source='import_csv'").all();
    expect(stored).toHaveLength(1);
    expect(stored[0].as_of_date).toBe('2026-12-31');

    const { rows: rows2 } = parseChurchBalancesCsv('classification,category_path,account_name,depth,own_balance\nAssets,Assets:Cash,Cash,0,105000\nLiabilities,Liabilities:AP,AP,0,2000');
    await persistChurchBalancesCsvImport(db, rows2, 2026, '2027-01-31', '2026-09-17T01:00:00.000Z');
    stored = db._raw.prepare("SELECT * FROM finance_church_balances WHERE source='import_csv' ORDER BY category_path").all();
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => r.as_of_date === '2027-01-31')).toBe(true);
  });

  it('persistDaycareEntriesCsvImport replaces per period (fixing the legacy bulk-paste duplicate-on-rerun gap)', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO finance_daycare_entries (period, category, entry_type, amount_cents, source) VALUES ('2026-01','Manual entry','actual',1,'manual')`);
    const { rows } = parseDaycareEntriesCsv('period,category,amount\n2026-01,Tuition Income,10000\n2026-02,Tuition Income,11000');
    await persistDaycareEntriesCsvImport(db, rows, '2026-09-17T00:00:00.000Z');
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_daycare_entries WHERE source='import_csv'").get().n).toBe(2);
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_daycare_entries WHERE source='manual'").get().n).toBe(1);

    // Re-import of just 2026-01 replaces that period only; 2026-02 from the prior import survives.
    const { rows: rows2 } = parseDaycareEntriesCsv('period,category,amount\n2026-01,Tuition Income,12000');
    await persistDaycareEntriesCsvImport(db, rows2, '2026-09-17T01:00:00.000Z');
    const jan = db._raw.prepare("SELECT * FROM finance_daycare_entries WHERE source='import_csv' AND period='2026-01'").all();
    expect(jan).toHaveLength(1);
    expect(jan[0].amount_cents).toBe(1200000);
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_daycare_entries WHERE source='import_csv' AND period='2026-02'").get().n).toBe(1);
  });

  it('persistPropertyBudgetMonthlyCsvImport upserts per (property_key, period)', async () => {
    const db = makeTestDb();
    const { rows } = parsePropertyBudgetMonthlyCsv('period,revenue,expenses\n2027-01,22000,13000');
    await persistPropertyBudgetMonthlyCsvImport(db, rows, 'ivanhoe', '2026-09-17T00:00:00.000Z');
    let stored = db._raw.prepare("SELECT * FROM finance_property_budget_monthly WHERE property_key='ivanhoe' AND period='2027-01'").get();
    expect(stored.revenue_cents).toBe(2200000);
    expect(stored.net_income_cents).toBe(900000);
    expect(stored.source).toBe('import_csv');

    const { rows: rows2 } = parsePropertyBudgetMonthlyCsv('period,revenue,expenses\n2027-01,21000,12000');
    await persistPropertyBudgetMonthlyCsvImport(db, rows2, 'ivanhoe', '2026-09-17T01:00:00.000Z');
    stored = db._raw.prepare("SELECT COUNT(*) AS n FROM finance_property_budget_monthly WHERE property_key='ivanhoe' AND period='2027-01'").get();
    expect(stored.n).toBe(1); // upsert, not a duplicate row
  });

  it('recordFinanceImport upserts one row per importer key and never throws even if finance_import_log is missing', async () => {
    const db = makeTestDb();
    await recordFinanceImport(db, 'church_budget_csv', 'FY2026', '2026-09-17T00:00:00.000Z');
    expect(db._raw.prepare("SELECT * FROM finance_import_log WHERE importer_key='church_budget_csv'").get().note).toBe('FY2026');
    await recordFinanceImport(db, 'church_budget_csv', 'FY2026 (re-run)', '2026-09-17T01:00:00.000Z');
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_import_log WHERE importer_key='church_budget_csv'").get().n).toBe(1);

    const brokenDb = { prepare() { throw new Error('no such table'); } };
    await expect(recordFinanceImport(brokenDb, 'x', 'y', 'z')).resolves.toBeUndefined();
  });
});

describe('isCsvImportWritesEnabled — off-by-default gate', () => {
  it('is disabled by default (no env var, no finance_settings row, even no db at all)', async () => {
    const db = makeTestDb();
    expect(await isCsvImportWritesEnabled({}, db)).toBe(false);
    expect(await isCsvImportWritesEnabled({}, null)).toBe(false);
  });

  it('is enabled by the env var', async () => {
    expect(await isCsvImportWritesEnabled({ FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' }, null)).toBe(true);
  });

  it('is enabled by a finance_settings row set to exactly "1", not any truthy-looking string', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO finance_settings (key,value) VALUES ('finance_csv_import_writes_enabled','yes')`);
    expect(await isCsvImportWritesEnabled({}, db)).toBe(false);
    db._raw.exec(`UPDATE finance_settings SET value='1' WHERE key='finance_csv_import_writes_enabled'`);
    expect(await isCsvImportWritesEnabled({}, db)).toBe(true);
  });

  it('fails closed (disabled) if reading finance_settings throws', async () => {
    const throwingDb = { prepare() { throw new Error('boom'); } };
    expect(await isCsvImportWritesEnabled({}, throwingDb)).toBe(false);
  });
});

describe('run*CsvImport orchestration — gate, validation, and successful write', () => {
  const churchBody = (overrides) => ({ fiscal_year: '2026', csv: CHURCH_CSV, ...overrides });

  it('refuses with the disabled message and does not touch the database when the gate is off', async () => {
    const db = makeTestDb();
    const result = await runChurchEntriesCsvImport({}, db, churchBody());
    expect(result).toEqual({ ok: false, status: 403, error: CSV_IMPORT_WRITES_DISABLED_MESSAGE });
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(0);
  });

  it('writes real rows and a finance_import_log entry once the gate is enabled', async () => {
    const db = makeTestDb();
    const result = await runChurchEntriesCsvImport({ FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' }, db, churchBody());
    expect(result).toMatchObject({ ok: true, status: 200, fiscalYear: 2026, imported: 3 });
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='import_csv'").get().n).toBe(3);
    expect(db._raw.prepare("SELECT note FROM finance_import_log WHERE importer_key='church_budget_csv'").get().note).toBe('FY2026');
  });

  it('validates fiscal_year and csv presence before ever checking the gate result matters (400, not a write)', async () => {
    const db = makeTestDb();
    const enabledEnv = { FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' };
    expect(await runChurchEntriesCsvImport(enabledEnv, db, { csv: CHURCH_CSV })).toMatchObject({ ok: false, status: 400 });
    expect(await runChurchEntriesCsvImport(enabledEnv, db, { fiscal_year: '2026' })).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 with per-row details and writes nothing when the CSV has validation errors', async () => {
    const db = makeTestDb();
    const enabledEnv = { FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' };
    const result = await runChurchEntriesCsvImport(enabledEnv, db, churchBody({ csv: 'classification,category_path,account_name,depth,own_actual\nRevenue,X,Y,0,100' }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.details[0]).toMatch(/must be "Income" or "Expenses"/);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(0);
  });

  it('runChurchBalancesCsvImport requires a well-formed as_of_date and writes when enabled', async () => {
    const db = makeTestDb();
    const enabledEnv = { FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' };
    const csv = 'classification,category_path,account_name,depth,own_balance\nAssets,Assets:Cash,Cash,0,100000';
    expect(await runChurchBalancesCsvImport(enabledEnv, db, { fiscal_year: '2026', as_of_date: 'not-a-date', csv })).toMatchObject({ ok: false, status: 400 });
    const result = await runChurchBalancesCsvImport(enabledEnv, db, { fiscal_year: '2026', as_of_date: '2026-12-31', csv });
    expect(result).toMatchObject({ ok: true, status: 200, fiscalYear: 2026, asOfDate: '2026-12-31', imported: 1 });
  });

  it('runDaycareEntriesCsvImport writes and logs a period range across multiple periods', async () => {
    const db = makeTestDb();
    const result = await runDaycareEntriesCsvImport({ FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' }, db, {
      csv: 'period,category,amount\n2026-01,Tuition Income,10000\n2026-02,Tuition Income,11000',
    });
    expect(result).toMatchObject({ ok: true, status: 200, imported: 2, periods: ['2026-01', '2026-02'] });
    expect(db._raw.prepare("SELECT note FROM finance_import_log WHERE importer_key='daycare_bulk_csv'").get().note).toBe('2026-01–2026-02');
  });

  it('runPropertyBudgetMonthlyCsvImport defaults property_key to ivanhoe and writes when enabled', async () => {
    const db = makeTestDb();
    const result = await runPropertyBudgetMonthlyCsvImport({ FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' }, db, {
      csv: 'period,revenue,expenses\n2027-01,22000,13000',
    });
    expect(result).toMatchObject({ ok: true, status: 200, propertyKey: 'ivanhoe', imported: 1 });
    expect(db._raw.prepare("SELECT * FROM finance_property_budget_monthly WHERE property_key='ivanhoe'").get().net_income_cents).toBe(900000);
  });

  it('surfaces a database failure at write time as a 500 with a specific message rather than throwing', async () => {
    const failingDb = {
      prepare(sql) {
        if (/^SELECT value FROM finance_settings/.test(sql)) return { async first() { return { value: '1' }; } };
        return { bind: () => ({ async run() { throw new Error('D1_ERROR: quota exceeded'); } }) };
      },
      async batch(stmts) { for (const s of stmts) await s.run(); },
    };
    const result = await runChurchEntriesCsvImport({}, failingDb, churchBody());
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/D1_ERROR: quota exceeded/);
  });
});

describe('Finance shell — /api/v1/import/* routes end to end', () => {
  function req(path, body, { enabledEnvVar } = {}) {
    const env = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_DB: makeTestDb() };
    if (enabledEnvVar) env.FINANCE_CSV_IMPORT_WRITES_ENABLED = '1';
    return { env, res: worker.fetch(new Request(`https://finance.test${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env) };
  }

  it('rejects GET on an import route the same way every other write route does', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/import/church'), { ENVIRONMENT: 'staging' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('returns 403 with the disabled message and writes nothing when the gate is off (the default, production-safe state)', async () => {
    const { env, res } = req('/api/v1/import/church', { fiscal_year: '2026', csv: CHURCH_CSV });
    const response = await res;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe(CSV_IMPORT_WRITES_DISABLED_MESSAGE);
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(0);
  });

  it('performs a real write end to end through the Worker fetch handler once enabled', async () => {
    const { env, res } = req('/api/v1/import/church', { fiscal_year: '2026', csv: CHURCH_CSV }, { enabledEnvVar: true });
    const response = await res;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, fiscalYear: 2026, imported: 3 });
    expect(env.FINANCE_DB._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='import_csv'").get().n).toBe(3);
  });

  it('returns 400 for an invalid JSON body instead of throwing', async () => {
    const env = { ENVIRONMENT: 'staging', FINANCE_DB: makeTestDb() };
    const res = await worker.fetch(new Request('https://finance.test/api/v1/import/daycare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json',
    }), env);
    expect(res.status).toBe(400);
  });

  it('the other three import routes are also gated off by default', async () => {
    for (const path of ['/api/v1/import/church-balances', '/api/v1/import/daycare', '/api/v1/import/property-budget']) {
      const { res } = req(path, { csv: 'a,b\n1,2' });
      const response = await res;
      expect(response.status).toBe(403);
    }
  });
});
