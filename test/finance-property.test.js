import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi, computePropertyAnnualSummary, parsePropertyMonthlyCsv, parseXlsxAllSheets, findPropertyBudgetDetailSheet } from '../src/api-finance.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as test/finance-church.test.js and
// test/scheduler-volunteers.test.js — runs against real SQL instead of a hand-rolled mock.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(readFileSync(new URL('../migrations/0022_finance_property.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0023_finance_property_reserves.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0025_finance_property_budget.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0026_finance_property_loan_payments.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE finance_daycare_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period       TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT '',
    entry_type   TEXT    NOT NULL DEFAULT 'actual',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    notes        TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT 'manual',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}

function makeReq(body) {
  return { json: async () => body };
}

describe('computePropertyAnnualSummary', () => {
  it('groups monthly rows by calendar year and sums revenue/expenses/net income', () => {
    const monthly = [
      { period: '2024-05', total_revenue_cents: 100000, total_expenses_cents: 40000, net_income_cents: 60000, occupancy_pct: 0.9 },
      { period: '2024-06', total_revenue_cents: 200000, total_expenses_cents: 50000, net_income_cents: 150000, occupancy_pct: 1.0 },
      { period: '2025-01', total_revenue_cents: 90000, total_expenses_cents: 30000, net_income_cents: 60000, occupancy_pct: 1.0 },
    ];
    const dists = [{ period: '2024-06', amount_cents: 70000 }];
    const notes = { 2024: 'note for 2024' };
    const out = computePropertyAnnualSummary(monthly, dists, notes);
    expect(out).toHaveLength(2);
    const y2024 = out.find(y => y.year === 2024);
    expect(y2024.total_revenue_cents).toBe(300000);
    expect(y2024.total_expenses_cents).toBe(90000);
    expect(y2024.net_income_cents).toBe(210000);
    expect(y2024.avg_occupancy_pct).toBeCloseTo(0.95);
    expect(y2024.confirmed_distributions_cents).toBe(70000);
    expect(y2024.notes).toBe('note for 2024');
    const y2025 = out.find(y => y.year === 2025);
    expect(y2025.confirmed_distributions_cents).toBe(0);
    expect(y2025.notes).toBe('');
  });

  it('ignores null figures instead of treating them as zero', () => {
    const monthly = [{ period: '2026-01', total_revenue_cents: 100000, total_expenses_cents: null, net_income_cents: 50000, occupancy_pct: null }];
    const out = computePropertyAnnualSummary(monthly, [], {});
    expect(out[0].total_expenses_cents).toBe(0); // sum starts at 0, null just isn't added
    expect(out[0].avg_occupancy_pct).toBeNull();
  });
});

describe('handleFinanceApi — commercial property routes', () => {
  it('POST monthly converts dollars to cents and GET returns them back, with the equity computed from meta', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?)`
    ).bind(JSON.stringify({ valuation: { capitalized_value_cents: 68631486 }, loan: { balance_cents: 29733600 } })).run();

    const postReq = makeReq({ period: '2026-06', occupancy_pct: 95, total_revenue: '9000.50', total_expenses: '3000.25', net_income: '6000.25', net_operating_income: '', available_for_distribution: '', reserve_balance: '', source_report: 'test.pdf' });
    const postRes = await handleFinanceApi(postReq, {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly', db, true, true);
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const getBody = await getRes.json();
    expect(getBody.monthly).toHaveLength(1);
    const row = getBody.monthly[0];
    expect(row.total_revenue_cents).toBe(900050);
    expect(row.total_expenses_cents).toBe(300025);
    expect(row.net_income_cents).toBe(600025);
    expect(row.net_operating_income_cents).toBeNull();
    expect(getBody.equity.equity_cents).toBe(68631486 - 29733600);
    expect(getBody.annualSummary).toHaveLength(1);
    expect(getBody.annualSummary[0].year).toBe(2026);
  });

  it('rejects writes from a non-admin finance user', async () => {
    const db = makeTestDb();
    const postReq = makeReq({ period: '2026-06', total_revenue: '100' });
    const res = await handleFinanceApi(postReq, {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly', db, false, true);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed period', async () => {
    const db = makeTestDb();
    const postReq = makeReq({ period: 'not-a-period', total_revenue: '100' });
    const res = await handleFinanceApi(postReq, {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly', db, true, true);
    expect(res.status).toBe(400);
  });

  it('upserts a distribution and deletes it', async () => {
    const db = makeTestDb();
    const addRes = await handleFinanceApi(makeReq({ period: '2026-04', amount: '4000' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/distributions', db, true, true);
    expect(addRes.status).toBe(200);
    let getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    let body = await getRes.json();
    expect(body.distributions).toHaveLength(1);
    expect(body.distributions[0].amount_cents).toBe(400000);

    const delRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/distributions/2026-04', db, true, true);
    expect(delRes.status).toBe(200);
    getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    body = await getRes.json();
    expect(body.distributions).toHaveLength(0);
  });

  it('PATCH meta merges into the existing loan/valuation sections without clobbering other keys', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?)`
    ).bind(JSON.stringify({ loan: { balance_cents: 29733600, lender: 'LCEF' }, property: { name: '3277 Ivanhoe' } })).run();
    const res = await handleFinanceApi(makeReq({ loan: { balance_cents: 29000000 } }), {}, new URL('https://x/'), 'PATCH', 'finance/property/ivanhoe/meta', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.loan.balance_cents).toBe(29000000);
    expect(body.meta.loan.lender).toBe('LCEF'); // untouched sibling field survives the merge
    expect(body.meta.property.name).toBe('3277 Ivanhoe'); // untouched section survives too
  });

  it('denies all property access to a non-finance role', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, false, false);
    expect(res.status).toBe(403);
  });
});

describe('handleFinanceApi — reserve schedules (property tax, capital, ...)', () => {
  it('auto-computes reserve_before from the prior month and carries the running balance forward', async () => {
    const db = makeTestDb();
    const jan = await handleFinanceApi(makeReq({ report_month: '2026-01', tax_year: 2026, target_estimate: '11400', contribution: '950' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    expect(jan.status).toBe(200);
    const janBody = await jan.json();
    expect(janBody.reserve_before_cents).toBe(0);
    expect(janBody.reserve_after_cents).toBe(95000);

    const feb = await handleFinanceApi(makeReq({ report_month: '2026-02', tax_year: 2026, target_estimate: '11400', contribution: '950' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    const febBody = await feb.json();
    expect(febBody.reserve_before_cents).toBe(95000); // carried from January's reserve_after
    expect(febBody.reserve_after_cents).toBe(190000);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const body = await getRes.json();
    expect(body.reserves.property_tax).toHaveLength(2);
  });

  it('a zero-contribution "paid" month can be recorded, and a disbursement logged separately', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ report_month: '2025-10', contribution: '674.20' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    const paidRes = await handleFinanceApi(makeReq({ report_month: '2025-11', tax_year: 2025, target_estimate: '0', contribution: '0', reserve_before: '0', note: 'tax paid, reserve zeroed' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    expect((await paidRes.json()).reserve_after_cents).toBe(0);

    const disRes = await handleFinanceApi(makeReq({ period_key: '2025', amount: '11349.64', paid_via_report_month: '2025-11', note: 'annual tax bill' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/disbursements', db, true, true);
    expect(disRes.status).toBe(200);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const body = await getRes.json();
    expect(body.reserveDisbursements.property_tax[0].amount_cents).toBe(1134964);
  });

  it('deletes a reserve month and a disbursement', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ report_month: '2026-01', contribution: '950' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/monthly', db, true, true);
    await handleFinanceApi(makeReq({ period_key: '2025', amount: '100' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/reserves/property_tax/disbursements', db, true, true);

    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/reserves/property_tax/monthly/2026-01', db, true, true);
    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/reserves/property_tax/disbursements/2025', db, true, true);

    const body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.reserves.property_tax).toBeUndefined();
    expect(body.reserveDisbursements.property_tax).toBeUndefined();
  });
});

describe('handleFinanceApi — capital improvements ledger', () => {
  it('adds ledger entries, assigns increasing sort_order, and totals them', async () => {
    const db = makeTestDb();
    const r1 = await handleFinanceApi(makeReq({ entry_date: '2024-10-07', amount: '5400', payee: 'Vail Contracting LLC', description: 'renovation', project: 'Apartment renovation' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/capital-ledger', db, true, true);
    expect(r1.status).toBe(200);
    await handleFinanceApi(makeReq({ entry_date: '2024-10-19', amount: '2302.25', payee: 'SS Stone', description: 'countertop', project: 'Apartment renovation' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/capital-ledger', db, true, true);

    const body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.capitalLedger).toHaveLength(2);
    expect(body.capitalLedger[0].sort_order).toBe(0);
    expect(body.capitalLedger[1].sort_order).toBe(1);
    expect(body.capitalLedgerTotalCents).toBe(540000 + 230225);
  });

  it('deletes a ledger entry by id', async () => {
    const db = makeTestDb();
    const addRes = await handleFinanceApi(makeReq({ entry_date: '2024-10-07', amount: '5400' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/capital-ledger', db, true, true);
    const { id } = await addRes.json();
    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/capital-ledger/' + id, db, true, true);
    const body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.capitalLedger).toHaveLength(0);
  });
});

describe('handleFinanceApi — repairs & maintenance log', () => {
  it('adds and deletes a repair entry, tolerating a null amount', async () => {
    const db = makeTestDb();
    const addRes = await handleFinanceApi(makeReq({ entry_date: '2026-05', category: 'HVAC', description: 'AC repair' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/repairs', db, true, true);
    expect(addRes.status).toBe(200);
    const { id } = await addRes.json();

    let body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.repairs).toHaveLength(1);
    expect(body.repairs[0].amount_cents).toBeNull();

    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/property/ivanhoe/repairs/' + id, db, true, true);
    body = await (await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true)).json();
    expect(body.repairs).toHaveLength(0);
  });

  it('rejects writes from a non-admin', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ category: 'HVAC' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/repairs', db, false, true);
    expect(res.status).toBe(403);
  });
});

describe('handleFinanceApi — daycare bulk past-year import', () => {
  it('imports multiple rows in one call', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ rows: [
      { period: '2023', category: 'Tuition Income', entry_type: 'actual', amount_cents: 28500000 },
      { period: '2023', category: 'Payroll', entry_type: 'actual', amount_cents: 19000000 },
    ] }), {}, new URL('https://x/'), 'POST', 'finance/daycare/bulk', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    const rows = db._raw.prepare('SELECT * FROM finance_daycare_entries').all();
    expect(rows).toHaveLength(2);
  });

  it('rejects the whole batch if one row is malformed', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ rows: [
      { period: '2023', category: 'Tuition Income', amount_cents: 100 },
      { period: 'not-a-period', category: 'Payroll', amount_cents: 100 },
    ] }), {}, new URL('https://x/'), 'POST', 'finance/daycare/bulk', db, true, true);
    expect(res.status).toBe(400);
    const rows = db._raw.prepare('SELECT * FROM finance_daycare_entries').all();
    expect(rows).toHaveLength(0); // nothing committed from the bad batch
  });
});

// Minimal ZIP writer (STORED/uncompressed entries only — finZipReadEntryBytes already handles
// method 0 as a plain passthrough) so the real regression this locks in — some real-world xlsx
// exporters (confirmed: an AHRA "Budget Detail" export) write `<sheet ...></sheet>` instead of
// the usual self-closing `<sheet .../>` — can be exercised through the actual zip-reading code
// path, not just the inner XML-parsing functions.
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
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression = stored
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18); // compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    chunks.push(localHeader, nameBuf, dataBuf);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset
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

describe('parseXlsxAllSheets — non-self-closing <sheet> tag regression (real AHRA export bug)', () => {
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="str"><v>Account Name</v></c><c r="B1" t="str"><v>Jan 2026</v></c></row></sheetData></worksheet>`;
  const relsXml = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  it('finds the sheet when workbook.xml uses a self-closing <sheet/> tag', async () => {
    const workbookXml = `<?xml version="1.0"?><workbook><sheets><sheet sheetId="1" name="Sheet1" r:id="rId1"/></sheets></workbook>`;
    const zip = buildTestXlsxZip({ 'xl/workbook.xml': workbookXml, 'xl/_rels/workbook.xml.rels': relsXml, 'xl/worksheets/sheet1.xml': sheetXml });
    const sheets = await parseXlsxAllSheets(zip);
    expect(sheets.map(s => s.name)).toEqual(['Sheet1']);
    expect(findPropertyBudgetDetailSheet(sheets)).toBeTruthy();
  });

  it('also finds the sheet when workbook.xml uses an explicit open/close <sheet></sheet> tag (the real AHRA Budget Detail export shape)', async () => {
    const workbookXml = `<?xml version="1.0"?><workbook><sheets><sheet sheetId="1" name="Sheet1" r:id="rId1"></sheet></sheets></workbook>`;
    const zip = buildTestXlsxZip({ 'xl/workbook.xml': workbookXml, 'xl/_rels/workbook.xml.rels': relsXml, 'xl/worksheets/sheet1.xml': sheetXml });
    const sheets = await parseXlsxAllSheets(zip);
    expect(sheets.map(s => s.name)).toEqual(['Sheet1']);
    expect(findPropertyBudgetDetailSheet(sheets)).toBeTruthy();
  });
});

describe('parsePropertyMonthlyCsv', () => {
  it('parses the real AHRA "monthly financials" CSV row shape (June 2026 export)', () => {
    const csv = 'period,occupancy_pct,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income,total_revenue_ytd,operating_expenses_ytd,net_operating_income_ytd,non_operating_expenses_ytd,net_income_ytd,management_fee_expense,accounts_receivable,distribution_amount,total_property_reserve\n'
      + '2026-06,100,9765.27,-3505.43,6259.84,-957.05,5302.79,60633.28,-20916.20,39717.08,-5881.53,33835.55,556.24,1040.96,9321.77,10358.33\n';
    const { rows, error } = parsePropertyMonthlyCsv(csv);
    expect(error).toBeUndefined();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.period).toBe('2026-06');
    expect(r.occupancy_pct).toBe(1);
    expect(r.total_revenue_cents).toBe(976527);
    expect(r.total_expenses_cents).toBe(446248); // |operating| + |non-operating|, matches the real seeded June row
    expect(r.net_operating_income_cents).toBe(625984);
    expect(r.net_income_cents).toBe(530279);
    expect(r.available_for_distribution_cents).toBe(932177);
    expect(r.reserve_balance_cents).toBe(1035833);
  });

  it('supports multiple rows in one paste', () => {
    const csv = 'period,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income\n'
      + '2026-05,9000,-3000,6000,-500,5500\n'
      + '2026-06,9765.27,-3505.43,6259.84,-957.05,5302.79\n';
    const { rows, error } = parsePropertyMonthlyCsv(csv);
    expect(error).toBeUndefined();
    expect(rows.map(r => r.period)).toEqual(['2026-05', '2026-06']);
  });

  it('rejects a CSV missing required columns', () => {
    const { rows, error } = parsePropertyMonthlyCsv('period,total_revenue\n2026-06,9765.27\n');
    expect(rows).toHaveLength(0);
    expect(error).toMatch(/Missing required column/);
  });

  it('rejects a row with a malformed period', () => {
    const csv = 'period,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income\n'
      + 'June 2026,9000,-3000,6000,-500,5500\n';
    const { rows, error } = parsePropertyMonthlyCsv(csv);
    expect(rows).toHaveLength(0);
    expect(error).toMatch(/period.*must be YYYY-MM/);
  });

  it('rejects an empty paste', () => {
    const { rows, error } = parsePropertyMonthlyCsv('');
    expect(rows).toHaveLength(0);
    expect(error).toMatch(/Empty/);
  });
});

describe('handleFinanceApi — monthly CSV bulk import endpoint', () => {
  it('imports a pasted CSV row and it is retrievable via GET', async () => {
    const db = makeTestDb();
    const csv = 'period,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income\n'
      + '2026-06,9765.27,-3505.43,6259.84,-957.05,5302.79\n';
    const res = await handleFinanceApi(makeReq({ csv }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly-import-csv', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.periods).toEqual(['2026-06']);

    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const getBody = await getRes.json();
    expect(getBody.monthly).toHaveLength(1);
    expect(getBody.monthly[0].total_revenue_cents).toBe(976527);
    expect(getBody.monthly[0].total_expenses_cents).toBe(446248);
  });

  it('rejects from a non-admin', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ csv: 'period,total_revenue\n2026-06,100\n' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly-import-csv', db, false, true);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed CSV with a 400 and no partial commit', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ csv: 'period,total_revenue\n2026-06,100\n' }), {}, new URL('https://x/'), 'POST', 'finance/property/ivanhoe/monthly-import-csv', db, true, true);
    expect(res.status).toBe(400);
    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/property/ivanhoe', db, true, true);
    const getBody = await getRes.json();
    expect(getBody.monthly).toHaveLength(0);
  });
});
