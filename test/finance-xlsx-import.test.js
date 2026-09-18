import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import {
  parseXlsxAllSheets, findBudgetVsActualsSheet, parseBudgetVsActualsGrid, normalizeChurchClassification,
  findBalanceSheetSheet, parseBalanceSheetGrid, normalizeBalanceClassification, detectBalanceSheetBasis,
  persistChurchEntriesXlsxImport, persistChurchBalancesXlsxImport,
  isXlsxImportWritesEnabled, XLSX_IMPORT_WRITES_DISABLED_MESSAGE,
  runChurchEntriesXlsxImport, runChurchBalancesXlsxImport,
} from '../apps/finance/xlsx-import-service.js';

// ── A minimal, uncompressed (stored) .xlsx-shaped ZIP builder for tests only ─────────────────────
// Real .xlsx files from Excel/QuickBooks use DEFLATE compression, but the ZIP container format
// itself supports storing an entry uncompressed (method 0) -- xlsx-import-service.js's
// finZipReadEntryBytes already handles that method directly, so this avoids needing a DEFLATE
// encoder in test code just to build a byte-exact fixture. Every offset below matches the exact
// PKZIP local-file-header / central-directory-record / EOCD layout finZipReadEntries and
// finZipLocalFileDataOffset read.
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files) {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([filename, content]) => {
    const nameBytes = enc.encode(filename);
    const dataBytes = enc.encode(content);
    return { nameBytes, dataBytes, crc: crc32(dataBytes) };
  });

  const localChunks = [];
  const offsets = [];
  let offset = 0;
  for (const e of entries) {
    offsets.push(offset);
    const header = new ArrayBuffer(30);
    const dv = new DataView(header);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); // compression method: 0 = stored
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.dataBytes.length, true);
    dv.setUint32(22, e.dataBytes.length, true);
    dv.setUint16(26, e.nameBytes.length, true);
    dv.setUint16(28, 0, true);
    const chunk = new Uint8Array(30 + e.nameBytes.length + e.dataBytes.length);
    chunk.set(new Uint8Array(header), 0);
    chunk.set(e.nameBytes, 30);
    chunk.set(e.dataBytes, 30 + e.nameBytes.length);
    localChunks.push(chunk);
    offset += chunk.length;
  }
  const localTotal = offset;

  const centralChunks = entries.map((e, i) => {
    const header = new ArrayBuffer(46);
    const dv = new DataView(header);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.dataBytes.length, true);
    dv.setUint32(24, e.dataBytes.length, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, offsets[i], true);
    const chunk = new Uint8Array(46 + e.nameBytes.length);
    chunk.set(new Uint8Array(header), 0);
    chunk.set(e.nameBytes, 46);
    return chunk;
  });
  const centralTotal = centralChunks.reduce((s, c) => s + c.length, 0);

  const eocdBuf = new ArrayBuffer(22);
  const eocdDv = new DataView(eocdBuf);
  eocdDv.setUint32(0, 0x06054b50, true);
  eocdDv.setUint16(8, entries.length, true);
  eocdDv.setUint16(10, entries.length, true);
  eocdDv.setUint32(12, centralTotal, true);
  eocdDv.setUint32(16, localTotal, true);

  const out = new Uint8Array(localTotal + centralTotal + 22);
  let p = 0;
  for (const c of localChunks) { out.set(c, p); p += c.length; }
  for (const c of centralChunks) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(eocdBuf), p);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function cellStr(ref, text) { return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`; }
function cellNum(ref, n) { return n == null ? '' : `<c r="${ref}"><v>${n}</v></c>`; }
function xmlRow(n, cells) { return `<row r="${n}">${cells.join('')}</row>`; }

const RELS_XML = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://x" Target="worksheets/sheet1.xml"/></Relationships>`;

function buildBudgetVsActualsXlsx({ sheetName = 'Budget vs. Actuals FY26', dateLine = 'January - December 2026' } = {}) {
  const workbookXml = `<?xml version="1.0"?><workbook><sheets><sheet name="${sheetName}" r:id="rId1"/></sheets></workbook>`;
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
${xmlRow(1, [cellStr('A1', 'Statement of Activity')])}
${xmlRow(2, [cellStr('A2', dateLine)])}
${xmlRow(3, [cellStr('B3', 'Actual'), cellStr('C3', 'Budget')])}
${xmlRow(4, [cellStr('A4', 'Income')])}
${xmlRow(5, [cellStr('A5', '   Offerings'), cellNum('B5', 1000), cellNum('C5', 900)])}
${xmlRow(6, [cellStr('A6', 'Total Income')])}
${xmlRow(7, [cellStr('A7', 'Expenses')])}
${xmlRow(8, [cellStr('A8', '   Utilities'), cellNum('B8', 200), cellNum('C8', 150)])}
${xmlRow(9, [cellStr('A9', 'Total Expenses')])}
${xmlRow(10, [cellStr('A10', 'Net Income')])}
</sheetData></worksheet>`;
  return buildStoredZip({
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': RELS_XML,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

function buildBalanceSheetXlsx({ asOfLine = 'As of December 31, 2026', basisLine = 'Cash Basis Tuesday, July 28, 2026 03:11 PM GMT-05:00' } = {}) {
  const workbookXml = `<?xml version="1.0"?><workbook><sheets><sheet name="Balance Sheet" r:id="rId1"/></sheets></workbook>`;
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
${xmlRow(1, [cellStr('A1', 'Statement of Financial Position')])}
${xmlRow(2, [cellStr('A2', asOfLine)])}
${xmlRow(3, [cellStr('B3', 'Total')])}
${xmlRow(4, [cellStr('A4', 'Assets'), cellNum('B4', 5000)])}
${xmlRow(5, [cellStr('A5', '   Cash'), cellNum('B5', 5000)])}
${xmlRow(6, [cellStr('A6', 'Total Assets')])}
${xmlRow(7, [cellStr('A7', 'Liabilities'), cellNum('B7', 1000)])}
${xmlRow(8, [cellStr('A8', '   Accounts Payable'), cellNum('B8', 1000)])}
${xmlRow(9, [cellStr('A9', 'Total Liabilities')])}
${xmlRow(10, [cellStr('A10', 'Equity'), cellNum('B10', 4000)])}
${xmlRow(11, [cellStr('A11', '   Net Assets'), cellNum('B11', 4000)])}
${xmlRow(12, [cellStr('A12', 'Total Equity')])}
${xmlRow(13, [cellStr('A13', 'Liabilities and Equity')])}
${xmlRow(14, [cellStr('A14', basisLine)])}
</sheetData></worksheet>`;
  return buildStoredZip({
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': RELS_XML,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

// Same minimal D1-shaped wrapper around node:sqlite used elsewhere in this suite (see
// test/finance-csv-import.test.js) -- exercises the real schema/constraints, not a hand-trimmed
// stand-in.
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

describe('normalizeChurchClassification / normalizeBalanceClassification (ported wording rules)', () => {
  it('normalizes Revenue/Expenditures wording to Income/Expenses', () => {
    expect(normalizeChurchClassification('Revenue')).toBe('Income');
    expect(normalizeChurchClassification('Expenditures')).toBe('Expenses');
    expect(normalizeChurchClassification('Other Revenue')).toBe('Other Income');
    expect(normalizeChurchClassification('Income')).toBe('Income');
  });

  it('maps Assets/Liabilities/Equity and returns null for anything else (e.g. the grouping wrapper)', () => {
    expect(normalizeBalanceClassification('Assets')).toBe('Assets');
    expect(normalizeBalanceClassification('Liabilities')).toBe('Liabilities');
    expect(normalizeBalanceClassification('Equity')).toBe('Equity');
    expect(normalizeBalanceClassification('Liabilities and Equity')).toBeNull();
  });
});

describe('parseXlsxAllSheets + findBudgetVsActualsSheet + parseBudgetVsActualsGrid', () => {
  it('reads a real (uncompressed) zip container and parses the leading-space depth tree correctly', async () => {
    const zip = buildBudgetVsActualsXlsx();
    const sheets = await parseXlsxAllSheets(zip.buffer);
    expect(sheets.map((s) => s.name)).toEqual(['Budget vs. Actuals FY26']);
    const sheet = findBudgetVsActualsSheet(sheets);
    expect(sheet).toBeTruthy();
    const parsed = parseBudgetVsActualsGrid(sheet.grid);
    expect(parsed.fiscalYear).toBe(2026);
    expect(parsed.skipped).toEqual([]); // "Total Income"/"Total Expenses"/"Net Income" are dropped outright, never even recorded as skipped
    expect(parsed.rows).toEqual([
      { fiscal_year: 2026, period_month: 0, classification: 'Income', category_path: 'Income', account_name: 'Income', depth: 0, has_children: 1, own_actual_cents: 0, own_budget_cents: 0 },
      { fiscal_year: 2026, period_month: 0, classification: 'Income', category_path: 'Income:Offerings', account_name: 'Offerings', depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: 90000 },
      { fiscal_year: 2026, period_month: 0, classification: 'Expenses', category_path: 'Expenses', account_name: 'Expenses', depth: 0, has_children: 1, own_actual_cents: 0, own_budget_cents: 0 },
      { fiscal_year: 2026, period_month: 0, classification: 'Expenses', category_path: 'Expenses:Utilities', account_name: 'Utilities', depth: 1, has_children: 0, own_actual_cents: 20000, own_budget_cents: 15000 },
    ]);
  });

  it('finds the sheet regardless of its literal name, by its Actual/Budget header signature', async () => {
    const zip = buildBudgetVsActualsXlsx({ sheetName: 'Sheet1' });
    const sheets = await parseXlsxAllSheets(zip.buffer);
    expect(findBudgetVsActualsSheet(sheets)).toBeTruthy();
  });

  it('throws a specific error when no Actual/Budget header row exists', () => {
    expect(() => parseBudgetVsActualsGrid([['not a header row']])).toThrow(/Could not find the Actual\/Budget header row/);
  });

  it('returns a null fiscalYear when no 4-digit year appears above the header (caller must reject this)', () => {
    const parsed = parseBudgetVsActualsGrid([['no year on this line'], [null, 'Actual', 'Budget'], ['Income']]);
    expect(parsed.fiscalYear).toBeNull();
  });

  it('treats a blank/unparsable own_actual or own_budget cell as 0, matching legacy xlsx behavior exactly (not csv-import-service.js\'s stricter rule)', () => {
    const grid = [[null, 'Actual', 'Budget'], ['Income'], ['   Offerings', 'not-a-number', undefined]];
    const parsed = parseBudgetVsActualsGrid(grid);
    const offerings = parsed.rows.find((r) => r.account_name === 'Offerings');
    expect(offerings.own_actual_cents).toBe(0);
    expect(offerings.own_budget_cents).toBe(0);
  });
});

describe('parseXlsxAllSheets + findBalanceSheetSheet + parseBalanceSheetGrid', () => {
  it('parses the Assets/Liabilities/Equity classification-reset tree, the as-of date, and the Cash/Accrual basis footer', async () => {
    const zip = buildBalanceSheetXlsx();
    const sheets = await parseXlsxAllSheets(zip.buffer);
    const sheet = findBalanceSheetSheet(sheets);
    expect(sheet).toBeTruthy();
    const parsed = parseBalanceSheetGrid(sheet.grid, sheet.colAIndent);
    expect(parsed.fiscalYear).toBe(2026);
    expect(parsed.asOfDate).toBe('December 31, 2026');
    expect(parsed.basis).toBe('Cash');
    // The grouping wrapper line and the trailing basis footer are both dropped (footer lands in
    // `skipped`, matching legacy's real-export finding; the wrapper is a hard "continue", never
    // even reaching the skipped list).
    expect(parsed.skipped).toEqual(['Cash Basis Tuesday, July 28, 2026 03:11 PM GMT-05:00']);
    expect(parsed.rows).toEqual([
      { fiscal_year: 2026, classification: 'Assets', category_path: 'Assets', account_name: 'Assets', depth: 0, has_children: 1, own_balance_cents: 500000 },
      { fiscal_year: 2026, classification: 'Assets', category_path: 'Assets:Cash', account_name: 'Cash', depth: 1, has_children: 0, own_balance_cents: 500000 },
      { fiscal_year: 2026, classification: 'Liabilities', category_path: 'Liabilities', account_name: 'Liabilities', depth: 0, has_children: 1, own_balance_cents: 100000 },
      { fiscal_year: 2026, classification: 'Liabilities', category_path: 'Liabilities:Accounts Payable', account_name: 'Accounts Payable', depth: 1, has_children: 0, own_balance_cents: 100000 },
      { fiscal_year: 2026, classification: 'Equity', category_path: 'Equity', account_name: 'Equity', depth: 0, has_children: 1, own_balance_cents: 400000 },
      { fiscal_year: 2026, classification: 'Equity', category_path: 'Equity:Net Assets', account_name: 'Net Assets', depth: 1, has_children: 0, own_balance_cents: 400000 },
    ]);
  });

  it('detects an Accrual Basis footer just as well as Cash', () => {
    const grid = [['Accrual Basis Friday, January 2, 2026 09:00 AM GMT-05:00']];
    expect(detectBalanceSheetBasis(grid)).toBe('Accrual');
  });

  it('returns null basis when no footer line is present', () => {
    expect(detectBalanceSheetBasis([['nothing here']])).toBeNull();
  });

  it('throws a specific error when no balance-sheet header row exists', () => {
    expect(() => parseBalanceSheetGrid([['no header here']], [])).toThrow(/Could not find the balance sheet header row/);
  });

  it('never mistakes a Budget-vs-Actuals sheet\'s own decorative "Total" row for a Balance Sheet header', () => {
    // A real Budget vs. Actuals export has an "Actual"/"Budget" header row directly beneath a
    // similarly-shaped "Total"-only row -- parseBalanceSheetGrid's own header scan explicitly
    // rejects that shape rather than misreading it as an actual Balance Sheet header.
    const grid = [
      [null, 'Total'],
      [null, 'Actual', 'Budget'],
      ['Income', 100, 90],
    ];
    expect(findBalanceSheetSheet([{ grid, colAIndent: [] }])).toBeNull();
  });
});

describe('persistChurchEntriesXlsxImport / persistChurchBalancesXlsxImport (own source, wholesale-replace, coexists with CSV import)', () => {
  it('tags rows import_xlsx and never touches an existing import_csv row for the same fiscal year', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, own_actual_cents, source)
      VALUES (2026, 0, 'Income', 'Income:Offerings', 'General Fund', 55555, 'import_csv')`);
    const { rows } = parseBudgetVsActualsGrid((await parseXlsxAllSheets(buildBudgetVsActualsXlsx().buffer)).find((s) => s.grid).grid);
    await persistChurchEntriesXlsxImport(db, rows, 2026, '2026-09-18T00:00:00.000Z');
    const xlsxRows = db._raw.prepare("SELECT * FROM finance_church_entries WHERE source='import_xlsx'").all();
    expect(xlsxRows.length).toBe(4);
    const csvRows = db._raw.prepare("SELECT * FROM finance_church_entries WHERE source='import_csv'").all();
    expect(csvRows).toHaveLength(1);
    expect(csvRows[0].own_actual_cents).toBe(55555); // untouched

    // Re-importing replaces only the prior import_xlsx rows (idempotent re-import).
    await persistChurchEntriesXlsxImport(db, rows.slice(0, 1), 2026, '2026-09-18T01:00:00.000Z');
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='import_xlsx'").get().n).toBe(1);
  });

  it('persistChurchBalancesXlsxImport wholesale-replaces by fiscal year under its own source', async () => {
    const db = makeTestDb();
    const sheets = await parseXlsxAllSheets(buildBalanceSheetXlsx().buffer);
    const parsed = parseBalanceSheetGrid(sheets.find((s) => s.grid).grid, sheets.find((s) => s.grid).colAIndent);
    await persistChurchBalancesXlsxImport(db, parsed.rows, parsed.fiscalYear, parsed.asOfDate, '2026-09-18T00:00:00.000Z');
    const stored = db._raw.prepare("SELECT * FROM finance_church_balances WHERE source='import_xlsx'").all();
    expect(stored).toHaveLength(6);
    expect(stored.every((r) => r.as_of_date === 'December 31, 2026')).toBe(true);
  });
});

describe('isXlsxImportWritesEnabled -- SEPARATE off-by-default gate from CSV import', () => {
  it('is disabled by default (no env var, no finance_settings row, even no db at all)', async () => {
    const db = makeTestDb();
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(false);
    expect(await isXlsxImportWritesEnabled({}, null)).toBe(false);
  });

  it('is enabled by its OWN env var, distinct from FINANCE_CSV_IMPORT_WRITES_ENABLED', async () => {
    expect(await isXlsxImportWritesEnabled({ FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' }, null)).toBe(true);
    // Enabling CSV import must never silently enable xlsx import.
    expect(await isXlsxImportWritesEnabled({ FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' }, null)).toBe(false);
  });

  it('is enabled by its OWN finance_settings key, distinct from finance_csv_import_writes_enabled', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO finance_settings (key,value) VALUES ('finance_csv_import_writes_enabled','1')`);
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(false);
    db._raw.exec(`INSERT INTO finance_settings (key,value) VALUES ('finance_xlsx_import_writes_enabled','1')`);
    expect(await isXlsxImportWritesEnabled({}, db)).toBe(true);
  });

  it('fails closed (disabled) if reading finance_settings throws', async () => {
    const throwingDb = { prepare() { throw new Error('boom'); } };
    expect(await isXlsxImportWritesEnabled({}, throwingDb)).toBe(false);
  });
});

describe('run*XlsxImport orchestration -- gate, decode, parse, and successful write', () => {
  const enabledEnv = { FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' };

  it('refuses with the disabled message and touches nothing when the gate is off', async () => {
    const db = makeTestDb();
    const fileBase64 = bytesToBase64(buildBudgetVsActualsXlsx());
    const result = await runChurchEntriesXlsxImport({}, db, { fileBase64 });
    expect(result).toEqual({ ok: false, status: 403, error: XLSX_IMPORT_WRITES_DISABLED_MESSAGE });
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(0);
  });

  it('writes real rows and a finance_import_log entry once enabled', async () => {
    const db = makeTestDb();
    const fileBase64 = bytesToBase64(buildBudgetVsActualsXlsx());
    const result = await runChurchEntriesXlsxImport(enabledEnv, db, { fileBase64 });
    expect(result).toMatchObject({ ok: true, status: 200, fiscalYear: 2026, imported: 4 });
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='import_xlsx'").get().n).toBe(4);
    expect(db._raw.prepare("SELECT note FROM finance_import_log WHERE importer_key='church_budget_xlsx'").get().note).toBe('FY2026');
  });

  it('rejects a missing fileBase64 with 400, never reaching the gate-passed write path', async () => {
    const db = makeTestDb();
    expect(await runChurchEntriesXlsxImport(enabledEnv, db, {})).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a file that is not a valid zip with a specific 400 message', async () => {
    const db = makeTestDb();
    const result = await runChurchEntriesXlsxImport(enabledEnv, db, { fileBase64: bytesToBase64(new TextEncoder().encode('not a zip')) });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Could not read this file as an Excel workbook/);
  });

  it('rejects a workbook with no Budget vs. Actuals sheet', async () => {
    const db = makeTestDb();
    const zip = buildStoredZip({
      'xl/workbook.xml': '<?xml version="1.0"?><workbook><sheets><sheet name="Empty" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': RELS_XML,
      'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet><sheetData></sheetData></worksheet>',
    });
    const result = await runChurchEntriesXlsxImport(enabledEnv, db, { fileBase64: bytesToBase64(zip) });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Could not find a "Budget vs\. Actuals" sheet/);
  });

  it('rejects a sheet with no determinable fiscal year', async () => {
    const db = makeTestDb();
    const zip = buildBudgetVsActualsXlsx({ dateLine: 'no year on this line' });
    const result = await runChurchEntriesXlsxImport(enabledEnv, db, { fileBase64: bytesToBase64(zip) });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Could not determine the fiscal year/);
  });

  it('runChurchBalancesXlsxImport writes real rows, logs, and reports the detected basis once enabled', async () => {
    const db = makeTestDb();
    const fileBase64 = bytesToBase64(buildBalanceSheetXlsx());
    const result = await runChurchBalancesXlsxImport(enabledEnv, db, { fileBase64 });
    expect(result).toMatchObject({ ok: true, status: 200, fiscalYear: 2026, asOfDate: 'December 31, 2026', basis: 'Cash', imported: 6 });
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_balances WHERE source='import_xlsx'").get().n).toBe(6);
    expect(db._raw.prepare("SELECT note FROM finance_import_log WHERE importer_key='church_balance_xlsx'").get().note).toBe('FY2026');
  });

  it('surfaces a database failure at write time as a 500 with a specific message rather than throwing', async () => {
    const failingDb = {
      prepare(sql) {
        if (/^SELECT value FROM finance_settings/.test(sql)) return { async first() { return { value: '1' }; } };
        return { bind: () => ({ async run() { throw new Error('D1_ERROR: quota exceeded'); } }) };
      },
      async batch(stmts) { for (const s of stmts) await s.run(); },
    };
    const result = await runChurchEntriesXlsxImport({}, failingDb, { fileBase64: bytesToBase64(buildBudgetVsActualsXlsx()) });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/D1_ERROR: quota exceeded/);
  });
});

describe('Finance shell -- /api/v1/import/church-xlsx and /api/v1/import/church-balances-xlsx routes', () => {
  function req(path, body, { enabledEnvVar } = {}) {
    const env = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_DB: makeTestDb() };
    if (enabledEnvVar) env.FINANCE_XLSX_IMPORT_WRITES_ENABLED = '1';
    return { env, res: worker.fetch(new Request(`https://finance.test${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env) };
  }

  it('rejects GET the same way every other write route does', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/import/church-xlsx'), { ENVIRONMENT: 'staging' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('returns 403 with the disabled message and writes nothing when the gate is off (the default, production-safe state)', async () => {
    const { env, res } = req('/api/v1/import/church-xlsx', { fileBase64: bytesToBase64(buildBudgetVsActualsXlsx()) });
    const response = await res;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe(XLSX_IMPORT_WRITES_DISABLED_MESSAGE);
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(0);
  });

  it('enabling CSV import writes does NOT enable this route (separate gate, end to end through the Worker)', async () => {
    const env = { ENVIRONMENT: 'staging', FINANCE_DB: makeTestDb(), FINANCE_CSV_IMPORT_WRITES_ENABLED: '1' };
    const res = await worker.fetch(new Request('https://finance.test/api/v1/import/church-xlsx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64: bytesToBase64(buildBudgetVsActualsXlsx()) }),
    }), env);
    expect(res.status).toBe(403);
  });

  it('performs a real write end to end through the Worker fetch handler once enabled', async () => {
    const { env, res } = req('/api/v1/import/church-xlsx', { fileBase64: bytesToBase64(buildBudgetVsActualsXlsx()) }, { enabledEnvVar: true });
    const response = await res;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, fiscalYear: 2026, imported: 4 });
    expect(env.FINANCE_DB._raw.prepare("SELECT COUNT(*) AS n FROM finance_church_entries WHERE source='import_xlsx'").get().n).toBe(4);
  });

  it('the Balance Sheet xlsx route is also gated off by default and writes end to end once enabled', async () => {
    const off = req('/api/v1/import/church-balances-xlsx', { fileBase64: bytesToBase64(buildBalanceSheetXlsx()) });
    expect((await off.res).status).toBe(403);

    const on = req('/api/v1/import/church-balances-xlsx', { fileBase64: bytesToBase64(buildBalanceSheetXlsx()) }, { enabledEnvVar: true });
    const onResponse = await on.res;
    expect(onResponse.status).toBe(200);
    const body = await onResponse.json();
    expect(body).toMatchObject({ ok: true, fiscalYear: 2026, imported: 6, basis: 'Cash' });
  });

  it('returns 400 for an invalid JSON body instead of throwing', async () => {
    const env = { ENVIRONMENT: 'staging', FINANCE_DB: makeTestDb(), FINANCE_XLSX_IMPORT_WRITES_ENABLED: '1' };
    const res = await worker.fetch(new Request('https://finance.test/api/v1/import/church-xlsx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json',
    }), env);
    expect(res.status).toBe(400);
  });
});
