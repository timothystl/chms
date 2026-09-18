import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  parseXlsxAllSheets,
  findBudgetVsActualsSheet,
  parseBudgetVsActualsGrid,
  findBalanceSheetSheet,
  parseBalanceSheetGrid,
  normalizeChurchClassification,
  normalizeBalanceClassification,
  detectBalanceSheetBasis,
  xlsxAmountToCents,
  decodeBase64ToBytes,
  isXlsxImportWritesEnabled,
  persistChurchEntriesXlsxImport,
  persistChurchBalancesXlsxImport,
  runChurchXlsxImport,
  runChurchBalancesXlsxImport,
  XLSX_IMPORT_WRITES_DISABLED_MESSAGE,
} from '../apps/finance/xlsx-import-service.js';

// Same minimal D1-shaped wrapper around node:sqlite used elsewhere in this suite (see
// test/finance-property-ledger-write-service.test.js) -- runs against Finance's OWN real schema
// (apps/finance/migrations/0001_finance_foundation.sql), not a hand-rolled mock.
const foundationSql = readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8');

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(foundationSql);
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  return { db, sqlite };
}

// ── Minimal ZIP writer (STORED/uncompressed entries only) — same approach as
// test/finance-property.test.js's own buildTestXlsxZip, duplicated here per this suite's existing
// per-file convention, so the real zip-reading code path (not just the inner grid-parsing
// functions) is exercised.
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildTestXlsxZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const crc = crc32(dataBuf);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, nameBuf, dataBuf);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }
  const centralBuf = Buffer.concat(central);
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  const full = Buffer.concat([...chunks, centralBuf, eocd]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
}

function colLetter(idx) {
  let n = idx + 1, s = '';
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function cellXml(rowNum, colIdx, value) {
  if (value == null) return '';
  const ref = colLetter(colIdx) + rowNum;
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  const esc = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<c r="${ref}" t="inlineStr"><is><t>${esc}</t></is></c>`;
}
function buildSheetXml(rows) {
  const rowsXml = rows.map((cells, i) => {
    const rowNum = i + 1;
    const cellsXml = (cells || []).map((v, c) => cellXml(rowNum, c, v)).join('');
    return `<row r="${rowNum}">${cellsXml}</row>`;
  }).join('');
  return `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
}
const WORKBOOK_XML = `<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>`;
const RELS_XML = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
function buildTestWorkbook(gridRows) {
  return buildTestXlsxZip({
    'xl/workbook.xml': WORKBOOK_XML,
    'xl/_rels/workbook.xml.rels': RELS_XML,
    'xl/worksheets/sheet1.xml': buildSheetXml(gridRows),
  });
}

// A realistic "Budget vs. Actuals" grid: a date-range title, the Actual/Budget header, two
// classifications (using this church's real Revenue/Expenditures wording, per
// normalizeChurchClassification's own synonym table), and a running-subtotal footer line.
const BUDGET_VS_ACTUALS_GRID = [
  ['January - December 2026'],
  ['', 'Actual', 'Budget'],
  ['Revenue'],
  ['   Contributions', 1000.5, 900],
  ['   Other Income', 200, 150],
  ['Total Revenue'],
  ['Expenditures'],
  ['   Payroll', 500, 600],
  ['Total Expenditures'],
  ['Net Operating Revenue'],
];

const BALANCE_SHEET_GRID = [
  ['Statement of Financial Position'],
  ['As of December 31, 2026'],
  ['', 'Total'],
  ['Assets'],
  ['   Cash', 6000],
  ['Total Assets'],
  ['Liabilities and Equity'],
  ['   Liabilities'],
  ['      Accounts Payable', 1000],
  ['Total Liabilities'],
  ['   Equity'],
  ['      Net Assets', 5000],
  ['Total Liabilities and Equity'],
  ['Cash Basis Tuesday, July 28, 2026 03:11 PM GMT-05:00'],
];

describe('xlsx-import-service — Church Budget vs. Actuals grid parsing', () => {
  it('parses a real-shaped workbook end to end: zip -> sheet find -> grid parse', async () => {
    const zip = buildTestWorkbook(BUDGET_VS_ACTUALS_GRID);
    const sheets = await parseXlsxAllSheets(zip);
    const sheet = findBudgetVsActualsSheet(sheets);
    expect(sheet).toBeTruthy();
    const parsed = parseBudgetVsActualsGrid(sheet.grid);
    expect(parsed.fiscalYear).toBe(2026);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.rows.map((r) => r.category_path)).toEqual([
      'Income', 'Income:Contributions', 'Income:Other Income', 'Expenses', 'Expenses:Payroll',
    ]);
    const contributions = parsed.rows.find((r) => r.category_path === 'Income:Contributions');
    expect(contributions).toMatchObject({
      classification: 'Income', account_name: 'Contributions', depth: 1, has_children: 0,
      own_actual_cents: 100050, own_budget_cents: 90000,
    });
    const income = parsed.rows.find((r) => r.category_path === 'Income');
    expect(income).toMatchObject({ has_children: 1, own_actual_cents: 0, own_budget_cents: 0 });
  });

  it('normalizes this church\'s real Revenue/Expenditures wording to the canonical Income/Expenses keys', () => {
    expect(normalizeChurchClassification('Revenue')).toBe('Income');
    expect(normalizeChurchClassification('Expenditures')).toBe('Expenses');
    expect(normalizeChurchClassification('Other Revenue')).toBe('Other Income');
    expect(normalizeChurchClassification('Income')).toBe('Income');
  });

  it('throws a clear error when no Actual/Budget header row exists in any sheet', async () => {
    const zip = buildTestWorkbook([['just a title'], ['nothing here']]);
    const sheets = await parseXlsxAllSheets(zip);
    expect(findBudgetVsActualsSheet(sheets)).toBeNull();
  });

  it('fails closed on a non-blank, unparsable amount cell instead of silently writing a zero', () => {
    const grid = [
      ['January - December 2026'],
      ['', 'Actual', 'Budget'],
      ['Revenue'],
      ['   Contributions', 'N/A', 900],
    ];
    expect(() => parseBudgetVsActualsGrid(grid)).toThrow(/not a valid amount/);
  });

  it('treats a genuinely blank amount cell as 0, not an error (real multi-year exports leave Budget blank)', () => {
    const grid = [
      ['January - December 2026'],
      ['', 'Actual', 'Budget'],
      ['Revenue'],
      ['   Contributions', 1000],
    ];
    const parsed = parseBudgetVsActualsGrid(grid);
    const row = parsed.rows.find((r) => r.account_name === 'Contributions');
    expect(row.own_actual_cents).toBe(100000);
    expect(row.own_budget_cents).toBe(0);
  });
});

describe('xlsx-import-service — Balance Sheet grid parsing', () => {
  it('parses Assets/Liabilities/Equity with a mid-file classification reset and a trailing basis footer', async () => {
    const zip = buildTestWorkbook(BALANCE_SHEET_GRID);
    const sheets = await parseXlsxAllSheets(zip);
    const sheet = findBalanceSheetSheet(sheets);
    expect(sheet).toBeTruthy();
    const parsed = parseBalanceSheetGrid(sheet.grid, sheet.colAIndent);
    expect(parsed.fiscalYear).toBe(2026);
    expect(parsed.asOfDate).toBe('December 31, 2026');
    expect(parsed.basis).toBe('Cash');
    expect(parsed.rows.map((r) => r.category_path)).toEqual([
      'Assets', 'Assets:Cash', 'Liabilities', 'Liabilities:Accounts Payable', 'Equity', 'Equity:Net Assets',
    ]);
    const cash = parsed.rows.find((r) => r.category_path === 'Assets:Cash');
    expect(cash).toMatchObject({ classification: 'Assets', own_balance_cents: 600000, has_children: 0 });
    const ap = parsed.rows.find((r) => r.category_path === 'Liabilities:Accounts Payable');
    expect(ap).toMatchObject({ classification: 'Liabilities', own_balance_cents: 100000 });
    // The trailing "Cash Basis ..." timestamp footer and the two grouping/subtotal lines are
    // noise, never real accounts -- only the footer lands in `skipped` (the "Total ..." lines and
    // "Liabilities and Equity" are dropped outright, matching legacy exactly).
    expect(parsed.skipped).toEqual(['Cash Basis Tuesday, July 28, 2026 03:11 PM GMT-05:00']);
  });

  it('normalizes Assets/Liabilities/Equity case-insensitively and rejects anything else', () => {
    expect(normalizeBalanceClassification('assets')).toBe('Assets');
    expect(normalizeBalanceClassification('LIABILITIES')).toBe('Liabilities');
    expect(normalizeBalanceClassification('Liabilities and Equity')).toBeNull();
  });

  it('throws when no balance-sheet-shaped header row exists', async () => {
    const zip = buildTestWorkbook(BUDGET_VS_ACTUALS_GRID); // a real Budget vs. Actuals sheet, not a balance sheet
    const sheets = await parseXlsxAllSheets(zip);
    expect(findBalanceSheetSheet(sheets)).toBeNull();
  });

  it('fails closed on a non-blank, unparsable balance amount', () => {
    const grid = [
      ['As of December 31, 2026'],
      ['', 'Total'],
      ['Assets'],
      ['   Broken Account', 'N/A'],
    ];
    expect(() => parseBalanceSheetGrid(grid, [])).toThrow(/not a valid amount/);
  });

  it('detects an Accrual-basis footer distinctly from Cash', () => {
    expect(detectBalanceSheetBasis([['Accrual Basis Tuesday, July 28, 2026']])).toBe('Accrual');
    expect(detectBalanceSheetBasis([['no basis line here']])).toBeNull();
  });
});

describe('xlsx-import-service — amount parsing and base64 decoding', () => {
  it('reads a blank cell as 0 and a thousands-comma dollar string correctly, but errors on garbage', () => {
    expect(xlsxAmountToCents(null)).toEqual({ cents: 0 });
    expect(xlsxAmountToCents('')).toEqual({ cents: 0 });
    expect(xlsxAmountToCents(1234.5)).toEqual({ cents: 123450 });
    expect(xlsxAmountToCents('9,765.27')).toEqual({ cents: 976527 });
    expect(xlsxAmountToCents('$1,000.00')).toEqual({ cents: 100000 });
    expect(xlsxAmountToCents('not a number')).toEqual({ error: true });
    expect(xlsxAmountToCents(NaN)).toEqual({ error: true });
  });

  it('round-trips a base64-encoded buffer back to the same bytes', () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const b64 = Buffer.from(original).toString('base64');
    expect(Array.from(decodeBase64ToBytes(b64))).toEqual(Array.from(original));
  });
});

describe('isXlsxImportWritesEnabled — off-by-default gate, separate from CSV import\'s own flag', () => {
  it('is disabled with no db and no env override', async () => {
    expect(await isXlsxImportWritesEnabled({}, null)).toBe(false);
  });

  it('is disabled on a freshly migrated database with no flag row set', async () => {
    const { db } = makeTestDb();
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(false);
  });

  it('is enabled via the env var override', async () => {
    expect(await isXlsxImportWritesEnabled({ FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' }, null)).toBe(true);
  });

  it('is enabled once finance_settings.finance_xlsx_import_writes_enabled is exactly "1"', async () => {
    const { db, sqlite } = makeTestDb();
    sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_xlsx_import_writes_enabled','1')").run();
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(true);
  });

  it('stays disabled for any value other than the exact string "1"', async () => {
    const { db, sqlite } = makeTestDb();
    sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_xlsx_import_writes_enabled','true')").run();
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(false);
  });

  it('turning CSV import on does not also turn xlsx import on (separate flags)', async () => {
    const { db, sqlite } = makeTestDb();
    sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_csv_import_writes_enabled','1')").run();
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(false);
  });
});

describe('persistChurchEntriesXlsxImport / persistChurchBalancesXlsxImport — real SQL writes', () => {
  it('wholesale-replaces only its own import_xlsx source for the given fiscal year, leaving other sources alone', async () => {
    const { db, sqlite } = makeTestDb();
    sqlite.prepare(`INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at) VALUES (2026,0,'Income','Income:Old','Old',0,0,111,0,'import_xlsx','2020-01-01')`).run();
    sqlite.prepare(`INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at) VALUES (2026,0,'Income','Income:Contributions','Contributions',1,0,999,0,'qbo_sync','2020-01-01')`).run();
    await persistChurchEntriesXlsxImport(db, [
      { classification: 'Income', category_path: 'Income:Contributions', account_name: 'Contributions', depth: 1, has_children: 0, own_actual_cents: 100050, own_budget_cents: 90000 },
    ], 2026, '2026-09-18T00:00:00.000Z');
    const rows = sqlite.prepare('SELECT * FROM finance_church_entries ORDER BY source').all();
    expect(rows).toHaveLength(2);
    const xlsxRow = rows.find((r) => r.source === 'import_xlsx');
    expect(xlsxRow).toMatchObject({ category_path: 'Income:Contributions', own_actual_cents: 100050 });
    expect(rows.find((r) => r.source === 'qbo_sync')).toMatchObject({ own_actual_cents: 999 }); // untouched
  });

  it('persists balance rows with the as-of date and its own import_xlsx source', async () => {
    const { db, sqlite } = makeTestDb();
    await persistChurchBalancesXlsxImport(db, [
      { classification: 'Assets', category_path: 'Assets:Cash', account_name: 'Cash', depth: 1, has_children: 0, own_balance_cents: 600000 },
    ], 2026, 'December 31, 2026', '2026-09-18T00:00:00.000Z');
    const rows = sqlite.prepare('SELECT * FROM finance_church_balances').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'import_xlsx', as_of_date: 'December 31, 2026', own_balance_cents: 600000 });
  });
});

describe('runChurchXlsxImport / runChurchBalancesXlsxImport — end-to-end orchestration', () => {
  it('answers 403 with the disabled message when the flag is off (the real default everywhere today)', async () => {
    const { db } = makeTestDb();
    const zip = buildTestWorkbook(BUDGET_VS_ACTUALS_GRID);
    const result = await runChurchXlsxImport({}, db, { file_base64: Buffer.from(zip).toString('base64') });
    expect(result).toEqual({ ok: false, status: 403, error: XLSX_IMPORT_WRITES_DISABLED_MESSAGE });
  });

  it('parses and persists a real workbook end to end once enabled', async () => {
    const { db, sqlite } = makeTestDb();
    const zip = buildTestWorkbook(BUDGET_VS_ACTUALS_GRID);
    const result = await runChurchXlsxImport({ FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' }, db, { file_base64: Buffer.from(zip).toString('base64') });
    expect(result.ok).toBe(true);
    expect(result.fiscalYear).toBe(2026);
    expect(result.imported).toBe(5);
    const rows = sqlite.prepare(`SELECT * FROM finance_church_entries WHERE source='import_xlsx'`).all();
    expect(rows).toHaveLength(5);
    const log = sqlite.prepare(`SELECT * FROM finance_import_log WHERE importer_key='church_budget_xlsx'`).get();
    expect(log.note).toBe('FY2026');
  });

  it('parses and persists a Balance Sheet workbook end to end once enabled', async () => {
    const { db, sqlite } = makeTestDb();
    const zip = buildTestWorkbook(BALANCE_SHEET_GRID);
    const result = await runChurchBalancesXlsxImport({ FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' }, db, { file_base64: Buffer.from(zip).toString('base64') });
    expect(result.ok).toBe(true);
    expect(result.fiscalYear).toBe(2026);
    expect(result.asOfDate).toBe('December 31, 2026');
    expect(result.basis).toBe('Cash');
    expect(result.imported).toBe(6);
    const rows = sqlite.prepare(`SELECT * FROM finance_church_balances WHERE source='import_xlsx'`).all();
    expect(rows).toHaveLength(6);
  });

  it('returns a clear 400, not a crash, when the uploaded file has no recognizable Budget vs. Actuals sheet', async () => {
    const { db } = makeTestDb();
    const zip = buildTestWorkbook([['nothing recognizable here']]);
    const result = await runChurchXlsxImport({ FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' }, db, { file_base64: Buffer.from(zip).toString('base64') });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Could not find a "Budget vs\. Actuals" sheet/);
  });

  it('rejects a missing file_base64 with 400 even when enabled', async () => {
    const { db } = makeTestDb();
    const result = await runChurchXlsxImport({ FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' }, db, {});
    expect(result).toEqual({ ok: false, status: 400, error: 'file_base64 is required' });
  });
});
