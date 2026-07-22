// ── Finance Overview API handlers ──────────────────────────────────────────
// Finance-only feature (gated in api-chms.js, same as Tuition Aid). Unifies:
//  (1) QuickBooks Online — Budget vs Actual + account balances, via a real OAuth connection
//  (2) Daycare — manual entries, since the daycare app has no known export/API yet
// QBO amounts are kept as QBO returns them (decimal dollars) rather than converted to this
// app's integer-cents convention — they're display-only, never combined arithmetically with
// giving_entries/tuition figures.
import { json } from './auth.js';
import { getAuthorizeUrl, exchangeCodeForTokens, refreshTokens, revokeToken, makeQboClient, qboConfigured } from './quickbooks.js';
import { makeDaycareClient, daycareConfigured } from './daycare.js';

const CALLBACK_PATH = '/admin/api/finance/qb/callback';

async function getConnection(db) {
  return await db.prepare('SELECT * FROM finance_qb_connection WHERE id=1').first();
}

// Refreshes the access token if it's expired or about to be (within 2 minutes), persisting
// the new tokens. QBO rotates the refresh token on every use, so the old one must be replaced.
async function ensureFreshAccessToken(env, db, conn) {
  const expiresAtMs = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (expiresAtMs - Date.now() > 2 * 60 * 1000) return conn;
  const refreshed = await refreshTokens(env, conn.refresh_token);
  const now = Date.now();
  const accessExpiresAt = new Date(now + (refreshed.expires_in || 3600) * 1000).toISOString();
  const refreshExpiresAt = new Date(now + (refreshed.x_refresh_token_expires_in || 8640000) * 1000).toISOString();
  await db.prepare(
    `UPDATE finance_qb_connection SET access_token=?, refresh_token=?, access_token_expires_at=?, refresh_token_expires_at=? WHERE id=1`
  ).bind(refreshed.access_token, refreshed.refresh_token, accessExpiresAt, refreshExpiresAt).run();
  return { ...conn, access_token: refreshed.access_token, refresh_token: refreshed.refresh_token,
           access_token_expires_at: accessExpiresAt, refresh_token_expires_at: refreshExpiresAt };
}

// Redirect target uses a query param (not a hash query) so the SPA's hash-based tab router
// (which expects '#finance' exactly, see showTab()) is untouched — the frontend reads the
// oauth result from location.search separately (see finCheckOauthReturn in js-finance.js).
function redirectToApp(url, qsParam, qsValue) {
  return new Response(null, { status: 302, headers: { Location: `${url.origin}/?${qsParam}=${encodeURIComponent(qsValue)}#finance` } });
}

// Merges a single leaf/subtotal row's budget amount in, by exact account-name match against
// the Budget entity. `ctx.budgetIdsByName` tracks how many DISTINCT account IDs share a given
// display name — the same account legitimately appears many times (one BudgetDetail line per
// month), which is NOT a collision, but two genuinely different accounts in different parent
// categories can share a bare name (e.g. an Income sub-account and an unrelated Expense
// sub-account both named "Plants and Soil" — confirmed against a real QuickBooks P&L export).
// Only merge when the name unambiguously maps to one account; otherwise leave it at $0 and flag
// it, rather than silently attributing one account's budget to a different account.
export function mergeLeafCells(cells, ctx) {
  const name = cells[0]?.value || '';
  const actual = Number(cells[cells.length - 1]?.value);
  const actualAmt = Number.isFinite(actual) ? actual : 0;
  const ids = ctx.budgetIdsByName.get(name);
  let budgetAmt = 0;
  if (ids && ids.size > 1) ctx.ambiguousNames.add(name);
  else if (ctx.budgetByName.has(name)) budgetAmt = ctx.budgetByName.get(name);
  return {
    cells: [{ value: name }, { value: actualAmt.toFixed(2) }, { value: budgetAmt.toFixed(2) }, { value: (actualAmt - budgetAmt).toFixed(2) }],
    budget: budgetAmt,
  };
}
// Merges one Section row (recursing into its children first), then derives the section's own
// subtotal (Summary row) as its own direct-posting amount (a parent account can carry postings
// of its own in addition to its sub-accounts, e.g. "Job Expenses" itself plus a nested "Job
// Materials" sub-section) PLUS every descendant's budget, summed bottom-up — this reproduces
// QBO's own "Total for X" math without needing to name-match the subtotal row itself (whose
// label, e.g. "Total for Job Materials", never appears verbatim in the Budget entity).
export function mergeSection(row, ctx) {
  const child = mergeTree(row.Rows?.Row, ctx);
  let ownBudget = 0;
  let newHeaderCells = row.Header?.ColData;
  if (newHeaderCells && newHeaderCells.length >= 2) {
    const m = mergeLeafCells(newHeaderCells, ctx);
    newHeaderCells = m.cells;
    ownBudget = m.budget;
  }
  const sectionBudget = ownBudget + child.budgetSum;
  let newSummaryCells = row.Summary?.ColData;
  if (newSummaryCells && newSummaryCells.length >= 2) {
    const actual = Number(newSummaryCells[newSummaryCells.length - 1]?.value) || 0;
    newSummaryCells = [newSummaryCells[0], { value: actual.toFixed(2) }, { value: sectionBudget.toFixed(2) }, { value: (actual - sectionBudget).toFixed(2) }];
  }
  return {
    row: {
      type: 'Section',
      Header: newHeaderCells ? { ColData: newHeaderCells } : row.Header,
      Rows: { Row: child.rows },
      Summary: newSummaryCells ? { ColData: newSummaryCells } : row.Summary,
    },
    budget: sectionBudget,
  };
}
// Recursively merges budget amounts into an arbitrarily-nested Section/Data row tree.
export function mergeTree(rows, ctx) {
  let budgetSum = 0;
  const out = (rows || []).map(row => {
    if (row.type === 'Section') {
      const { row: newRow, budget } = mergeSection(row, ctx);
      budgetSum += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row; // label-only row with no amount column — leave untouched
    const m = mergeLeafCells(cells, ctx);
    budgetSum += m.budget;
    return { ColData: m.cells };
  });
  return { rows: out, budgetSum };
}
// Top-level P&L rows alternate Sections (Income / Cost of Goods Sold / Expenses / Other Income
// / Other Expenses — QBO's fixed, universal classification names, not custom labels) with flat
// running-subtotal rows (Gross Profit / Net Operating Income / Net Other Income / Net Income).
// "Other Income" starts a second, independent running total that only merges back in at "Net
// Income" — this is standard P&L structure, confirmed against a real exported QuickBooks report.
export function mergeProfitAndLossTree(rows, ctx) {
  let mainBudget = 0, otherBudget = 0, inOtherThread = false;
  return (rows || []).map(row => {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      if (label === 'Other Income') inOtherThread = true;
      const { row: newRow, budget } = mergeSection(row, ctx);
      if (inOtherThread) otherBudget += budget; else mainBudget += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row;
    const label = cells[0]?.value || '';
    const actual = Number(cells[cells.length - 1]?.value) || 0;
    const budgetVal = label === 'Net Income' ? (mainBudget + otherBudget) : (inOtherThread ? otherBudget : mainBudget);
    return { ColData: [{ value: label }, { value: actual.toFixed(2) }, { value: budgetVal.toFixed(2) }, { value: (actual - budgetVal).toFixed(2) }] };
  });
}

// Rows whose label is one of these are QuickBooks' own computed running subtotals (Gross
// Profit, Net Operating Income, etc.) rather than a real account — flattenReportTree() skips
// them, since they're always re-derivable from the classification totals at query time.
const RUNNING_SUBTOTAL_LABELS = new Set(['Gross Profit', 'Net Operating Income', 'Net Other Income', 'Net Income']);

function dollarsToCents(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ── Server-side .xlsx reader for Church Report budget import ────────────────
// XLSX is a ZIP of XML files. Reads the ZIP container directly (central directory + local
// file headers) and decompresses DEFLATE payloads with the standard Web Streams
// DecompressionStream — both available in the Workers runtime, no third-party library (this
// app hand-rolls all its parsing, same reasoning as Tuition Aid's client-side XLSX reader,
// which this ports from — see js-tuition-aid.js). Runs server-side (not in the browser) since
// the endpoint receives the raw uploaded file directly; kept as plain functions over
// ArrayBuffer/Uint8Array with zero DOM dependency, so it is directly unit-testable in Node too.
function finXmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function finZipReadEntries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid Excel (.xlsx) file.');
  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  const entries = [];
  let p = cdOffset;
  for (let e = 0; e < totalEntries; e++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('This Excel file is not in the expected format.');
    const compressionMethod = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const filenameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const filename = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + filenameLen));
    entries.push({ filename, compressionMethod, compressedSize, localHeaderOffset });
    p += 46 + filenameLen + extraLen + commentLen;
  }
  return entries;
}
function finZipLocalFileDataOffset(bytes, localHeaderOffset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error('This Excel file is not in the expected format.');
  const filenameLen = dv.getUint16(localHeaderOffset + 26, true);
  const extraLen = dv.getUint16(localHeaderOffset + 28, true);
  return localHeaderOffset + 30 + filenameLen + extraLen;
}
async function finInflateRaw(chunk) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(chunk);
  writer.close();
  const out = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const res = await reader.read();
    if (res.done) break;
    out.push(res.value);
  }
  const total = out.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const chunkBytes of out) { result.set(chunkBytes, off); off += chunkBytes.length; }
  return result;
}
async function finZipReadEntryBytes(bytes, entries, filename) {
  const entry = entries.find(e => e.filename === filename);
  if (!entry) return null;
  const dataOffset = finZipLocalFileDataOffset(bytes, entry.localHeaderOffset);
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return finInflateRaw(compressed);
  throw new Error('Unsupported compression in this Excel file.');
}
function finXlsxParseSharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const block = m[1];
    let text = '';
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(block))) text += finXmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}
function finXlsxColToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}
export function finXlsxParseSheetGrid(xml, sharedStrings) {
  const grid = [];
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowNum = parseInt(rm[1], 10);
    const rowXml = rm[2];
    if (!grid[rowNum - 1]) grid[rowNum - 1] = [];
    const rowArr = grid[rowNum - 1];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(rowXml))) {
      const attrs = cm[1] != null ? cm[1] : cm[2];
      const inner = cm[3] || '';
      const refM = /\br="([A-Z]+)\d+"/.exec(attrs);
      if (!refM) continue;
      const colIdx = finXlsxColToIndex(refM[1]);
      const typeM = /\bt="([a-zA-Z]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : 'n';
      let value = null;
      if (type === 's') {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM) value = sharedStrings[parseInt(vM[1], 10)];
      } else if (type === 'inlineStr') {
        const tM = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inner);
        if (tM) value = finXmlUnescape(tM[1]);
      } else if (type === 'str' || type === 'b') {
        const vM2 = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM2) value = type === 'b' ? (vM2[1] === '1') : finXmlUnescape(vM2[1]);
      } else {
        // Some real QuickBooks exports write a leaf cell's value as a *literal number* inside
        // the <f> (formula) tag — e.g. <f>115605.47</f><v>0.0</v> — with a stale, never-
        // recalculated <v> cache stuck at 0.0 (confirmed against a real "Balance Sheet without
        // zero acct" export, where every single leaf account read as $0 before this fix). Real
        // subtotal formulas (e.g. <f>(B10)+(B11)</f>) aren't plain numbers and fall through to
        // the normal <v> read below — harmless, since those rows are discarded/re-derived anyway.
        const fM = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inner);
        if (fM && /^-?\d+(\.\d+)?$/.test(fM[1].trim())) {
          value = parseFloat(fM[1].trim());
        } else {
          const vM3 = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (vM3 && vM3[1] !== '') value = parseFloat(vM3[1]);
        }
      }
      rowArr[colIdx] = value;
    }
  }
  const dense = [];
  for (const row of grid) {
    if (!row) { dense.push([]); continue; }
    const denseRow = [];
    for (let c = 0; c < row.length; c++) denseRow.push(row[c] === undefined ? null : row[c]);
    dense.push(denseRow);
  }
  return dense;
}
function finXlsxListSheetNames(workbookXml) {
  const out = [];
  const sheetRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\/>/g;
  let sm;
  while ((sm = sheetRe.exec(workbookXml))) out.push(finXmlUnescape(sm[1]));
  return out;
}
function finXlsxFindSheetPath(workbookXml, relsXml, sheetName) {
  const sheetRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="(rId\d+)"[^>]*\/>/g;
  let sm, rId = null;
  while ((sm = sheetRe.exec(workbookXml))) {
    if (finXmlUnescape(sm[1]) === sheetName) { rId = sm[2]; break; }
  }
  if (!rId) return null;
  const relMap = {};
  const relRe = /<Relationship\b[^>]*\/>/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) {
    const tag = rm[0];
    const idM = /\bId="([^"]*)"/.exec(tag);
    const targetM = /\bTarget="([^"]*)"/.exec(tag);
    if (idM && targetM) relMap[idM[1]] = targetM[1];
  }
  const target = relMap[rId];
  return target ? 'xl/' + target : null;
}
// Reads xl/styles.xml's cellXfs list (in document order, so array index === the style index a
// cell's s="N" attribute references) and returns just each entry's alignment indent (default 0)
// — the "Statement of Financial Position" export style conveys hierarchy via real cell-level
// indent metadata rather than literal leading spaces in the text (confirmed against a real
// export; verified this regex-based extraction reproduces openpyxl's parsed indent values
// exactly, row for row, against that file).
function finXlsxParseCellXfsIndents(stylesXml) {
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!block) return [];
  const xfRe = /<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g;
  const out = [];
  let m;
  while ((m = xfRe.exec(block[1]))) {
    const inner = m[2] || '';
    const alignM = /<alignment\b([^>]*)\/?>/.exec(inner);
    let indent = 0;
    if (alignM) {
      const indentM = /\bindent="(\d+)"/.exec(alignM[1]);
      if (indentM) indent = parseInt(indentM[1], 10);
    }
    out.push(indent);
  }
  return out;
}
// Column-A-only indent-per-row, using the workbook's cellXfs indent table — a parallel array to
// the value grid (colAIndent[i] is the indent for row i+1, i.e. the same 0-indexed row a grid
// value at grid[i] represents). Column A is the only column any parser here reads indentation
// from (it's the account-label column in every report this app reads).
function finXlsxParseColAIndents(sheetXml, cellXfsIndents) {
  const indents = [];
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml))) {
    const rowNum = parseInt(rm[1], 10);
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2]))) {
      const refM = /\br="([A-Z]+)\d+"/.exec(cm[1]);
      if (!refM || refM[1] !== 'A') continue;
      const sM = /\bs="(\d+)"/.exec(cm[1]);
      const styleIdx = sM ? parseInt(sM[1], 10) : 0;
      indents[rowNum - 1] = cellXfsIndents[styleIdx] != null ? cellXfsIndents[styleIdx] : 0;
      break;
    }
  }
  return indents;
}
// Parses every sheet in an uploaded .xlsx into a { name, grid, colAIndent } list — grid is a
// dense 2D array of cell values (row-major, 0-indexed), matching the shape
// parseBudgetVsActualsGrid()/parseBalanceSheetGrid() expect; colAIndent is the parallel
// column-A style-indent array parseBalanceSheetGrid() falls back to when a row has no literal
// leading-space indentation (see finXlsxParseColAIndents() above).
export async function parseXlsxAllSheets(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = finZipReadEntries(bytes);
  const dec = new TextDecoder('utf-8');
  const workbookXml = dec.decode(await finZipReadEntryBytes(bytes, entries, 'xl/workbook.xml'));
  const relsXml = dec.decode(await finZipReadEntryBytes(bytes, entries, 'xl/_rels/workbook.xml.rels'));
  const sharedStringsRaw = await finZipReadEntryBytes(bytes, entries, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsRaw ? finXlsxParseSharedStrings(dec.decode(sharedStringsRaw)) : [];
  const stylesRaw = await finZipReadEntryBytes(bytes, entries, 'xl/styles.xml');
  const cellXfsIndents = stylesRaw ? finXlsxParseCellXfsIndents(dec.decode(stylesRaw)) : [];
  const names = finXlsxListSheetNames(workbookXml);
  const sheets = [];
  for (const name of names) {
    const sheetPath = finXlsxFindSheetPath(workbookXml, relsXml, name);
    const sheetBytes = sheetPath ? await finZipReadEntryBytes(bytes, entries, sheetPath) : null;
    if (!sheetBytes) { sheets.push({ name, grid: null, colAIndent: [] }); continue; }
    const sheetXml = dec.decode(sheetBytes);
    sheets.push({
      name,
      grid: finXlsxParseSheetGrid(sheetXml, sharedStrings),
      colAIndent: finXlsxParseColAIndents(sheetXml, cellXfsIndents),
    });
  }
  return sheets;
}

// extractAmounts(cells) => array of {fiscal_year, own_actual_cents, own_budget_cents} — an array
// (not a single value) so the SAME tree-walk works for both a single-year budget-merged tree
// (1 result per node, cells = [Account,Actual,Budget,OverBudget]) and a multi-year actuals-only
// tree (N results per node, one per year column, cells = [Account,Year1,...,YearN]).
export function makeCurrentYearExtractor(year) {
  return (cells) => [{ fiscal_year: year, own_actual_cents: dollarsToCents(cells[1]?.value), own_budget_cents: dollarsToCents(cells[2]?.value) }];
}
// `colYears[i]` is the fiscal year for cells[i] (cells[0] is always the account name) — pass
// `null` for any column that isn't a real year (e.g. a trailing "Total" column) to skip it.
export function makeMultiYearExtractor(colYears) {
  return (cells) => colYears.map((year, i) => year == null ? null : {
    fiscal_year: year,
    own_actual_cents: dollarsToCents(cells[i + 1]?.value),
    own_budget_cents: null,
  }).filter(Boolean);
}

// QBO's monthly-column ColTitle format is "Jan 2026", "Feb 2026", etc. Returns null for any
// title that doesn't match (e.g. a trailing "Total" column), so callers can skip it the same
// way makeMultiYearExtractor skips non-year columns.
const MONTH_ABBR = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
export function parseMonthColTitle(title) {
  const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec((title || '').trim());
  if (!m) return null;
  const month = MONTH_ABBR[m[1]];
  if (!month) return null;
  return { year: parseInt(m[2], 10), month };
}

// `colPeriods[i]` is the {year, month} for cells[i] (or null to skip, e.g. a trailing "Total"
// column) — only current + prior year are ever requested (see the sync handler), to bound sync
// cost, so this never runs against a full multi-year window.
export function makeMonthlyExtractor(colPeriods) {
  return (cells) => colPeriods.map((p, i) => p == null ? null : {
    fiscal_year: p.year,
    period_month: p.month,
    own_actual_cents: dollarsToCents(cells[i + 1]?.value),
    own_budget_cents: null,
  }).filter(Boolean);
}

// Flattens a merged/plain QuickBooks Columns/Rows report tree into flat rows ready for
// finance_church_entries — one row per (real account node, fiscal year), holding only that
// node's own non-cumulative amount. Never emits a "Total for X" subtotal row (there isn't one in
// the tree to begin with — those live in row.Summary, which this deliberately never reads) or a
// running-subtotal row (Gross Profit et al, filtered via RUNNING_SUBTOTAL_LABELS) — both are
// always re-derivable from the stored per-account rows at query time.
export function flattenReportTree(rows, pathPrefix, classification, extractAmounts, out) {
  out = out || [];
  pathPrefix = pathPrefix || [];
  for (const row of (rows || [])) {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      const newClass = classification || label; // a top-level Section IS the classification
      const newPath = pathPrefix.concat(label);
      const children = row.Rows?.Row || [];
      const headerCells = row.Header?.ColData;
      if (headerCells && headerCells.length >= 2) {
        for (const amt of extractAmounts(headerCells)) out.push(makeFlatRow(newPath, newClass, children.length > 0, amt));
      }
      flattenReportTree(children, newPath, newClass, extractAmounts, out);
    } else {
      const cells = row.ColData;
      if (!cells || cells.length < 2) continue; // bare label row, e.g. an empty "Other Income"
      const label = cells[0]?.value || '';
      if (RUNNING_SUBTOTAL_LABELS.has(label)) continue;
      const newPath = pathPrefix.concat(label);
      for (const amt of extractAmounts(cells)) out.push(makeFlatRow(newPath, classification, false, amt));
    }
  }
  return out;
}
function makeFlatRow(path, classification, hasChildren, amt) {
  return {
    fiscal_year: amt.fiscal_year,
    period_month: amt.period_month || 0, // 0 = annual (see migrations/0018_finance_church_entries.sql)
    classification,
    category_path: path.join(':'),
    account_name: path[path.length - 1],
    depth: path.length - 1,
    has_children: hasChildren ? 1 : 0,
    own_actual_cents: amt.own_actual_cents,
    own_budget_cents: amt.own_budget_cents,
  };
}

// ── Church Report budget import: "Budget vs. Actuals" Excel export parser ───────────────────
// This report's exported shape is fundamentally different from the live QuickBooks API's
// Columns/Rows JSON tree that flattenReportTree() reads: hierarchy is encoded as literal leading
// spaces in column A (no cell-level indent metadata — confirmed against a real export), subtotal
// rows are labeled "Total <name>" and are never stored (always re-derivable from their children,
// same principle as flattenReportTree), and the exporting company's own report-style names the
// top-level sections rather than QuickBooks' fixed internal names — a real export from this
// exact church uses "Revenue"/"Expenditures", not "Income"/"Expenses" — so those must be
// normalized back to the canonical names computeYearSummary() expects, or every dollar would
// silently vanish from the This Year/Multi-Year rollups (a wrong-but-plausible bug, not a crash).
const CHURCH_CLASSIFICATION_SYNONYMS = {
  revenue: 'Income', income: 'Income',
  expenditures: 'Expenses', expenses: 'Expenses',
  'cost of goods sold': 'Cost of Goods Sold', cogs: 'Cost of Goods Sold',
  'other income': 'Other Income',
  'other expenses': 'Other Expenses', 'other expenditures': 'Other Expenses',
};
export function normalizeChurchClassification(label) {
  const key = (label || '').trim().toLowerCase();
  return CHURCH_CLASSIFICATION_SYNONYMS[key] || (label || '').trim();
}
// Rows matching this are QuickBooks' own computed running subtotals under this report's own
// wording variants (e.g. "Net Operating Revenue" instead of the live-API's "Net Operating
// Income") — never a real account, always skipped (re-derivable at query time, same as
// RUNNING_SUBTOTAL_LABELS above).
const IMPORT_SKIP_LABEL_RE = /^(Gross Profit|Net Operating (Income|Revenue)|Net Other Income|Net (Income|Revenue))$/i;
function indentDepthOf(raw) {
  const stripped = raw.replace(/^ +/, '');
  return Math.round((raw.length - stripped.length) / 3);
}
function nextNonBlankLabel(grid, i) {
  for (let j = i + 1; j < grid.length; j++) {
    const v = grid[j] && grid[j][0];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}
// Parses one sheet's grid (a dense 2D array from parseXlsxAllSheets) into flat rows ready for
// finance_church_entries, plus any depth-0 lines that couldn't be classified (report title,
// date-range line, the trailing "Accrual Basis" timestamp footer) so the caller can show them
// for transparency rather than silently misreading one as a bogus classification. A depth-0 row
// is only ever treated as a real classification opener when a genuinely nested row follows it —
// this report's structure never has a bare top-level leaf account, so anything else at depth 0
// (no children following) is noise, not a account.
export function parseBudgetVsActualsGrid(grid) {
  const headerIdx = grid.findIndex(r => r && r[1] === 'Actual' && r[2] === 'Budget');
  if (headerIdx === -1) throw new Error('Could not find the Actual/Budget header row in this sheet.');
  let fiscalYear = null;
  for (let i = 0; i < headerIdx; i++) {
    const cell = grid[i] && grid[i][0];
    if (typeof cell === 'string') { const m = /(\d{4})/.exec(cell); if (m) fiscalYear = parseInt(m[1], 10); }
  }
  const stack = [];
  let classification = null;
  const rows = [], skipped = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] && grid[i][0];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const label = raw.trim();
    if (/^Total\s/i.test(label)) continue; // closing subtotal, re-derivable
    if (IMPORT_SKIP_LABEL_RE.test(label)) continue; // running subtotal
    const depth = indentDepthOf(raw);
    const nextLabel = nextNonBlankLabel(grid, i);
    const hasChildren = nextLabel != null && indentDepthOf(nextLabel) > depth;
    if (depth === 0 && !hasChildren) { skipped.push(raw); continue; }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    let path;
    if (depth === 0) {
      classification = normalizeChurchClassification(label);
      path = [classification];
    } else {
      const parent = stack.length ? stack[stack.length - 1] : { path: [classification || 'Income'] };
      path = parent.path.concat(label);
    }
    stack.push({ depth, path });
    rows.push(makeFlatRow(path, classification, hasChildren, {
      fiscal_year: fiscalYear,
      own_actual_cents: dollarsToCents((grid[i] || [])[1]),
      own_budget_cents: dollarsToCents((grid[i] || [])[2]),
    }));
  }
  return { fiscalYear, rows, skipped };
}
// Tries every sheet in the workbook until one has the Actual/Budget header signature — sheet
// names vary (e.g. "Budget vs. Actuals FY26") so this doesn't hardcode a name, mirroring how
// Tuition Aid's importers scan for a recognizable layout rather than an exact sheet name.
export function findBudgetVsActualsSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some(r => r && r[1] === 'Actual' && r[2] === 'Budget')) return s;
  }
  return null;
}

// ── Commercial Property: AHRA "Budget Detail" import ─────────────────────────────────────
// A property-management export (one row per account, one column per month, "Account Name" +
// "Jan 2026".."Dec 2026" + "Total" + "Percent" header) — a genuinely different shape from the
// QuickBooks Church Report exports above, but read with the same generic parseXlsxAllSheets().
// Rather than walking the whole account tree (unnecessary for the Overview/Property revenue-vs-
// expense chart, which only needs a monthly total), this reads the export's own two rollup rows
// directly: "Total Budgeted Operating Income" and "Total Budgeted Operating Expense" — both
// present verbatim in every AHRA Budget Detail export, confirmed against a real file.
export function findPropertyBudgetDetailSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some(r => r && String(r[0] || '').trim() === 'Account Name' && parseMonthColTitle(r[1]))) return s;
  }
  return null;
}
export function parsePropertyBudgetDetailGrid(grid) {
  const headerIdx = grid.findIndex(r => r && String(r[0] || '').trim() === 'Account Name' && parseMonthColTitle(r[1]));
  if (headerIdx === -1) return { months: [] };
  const header = grid[headerIdx];
  const monthCols = []; // { col, year, month }
  for (let c = 1; c < header.length; c++) {
    const p = parseMonthColTitle(header[c]);
    if (p) monthCols.push({ col: c, ...p });
  }
  if (!monthCols.length) return { months: [] };
  const findRow = label => grid.find(r => r && String(r[0] || '').trim().toLowerCase() === label.toLowerCase());
  const revenueRow = findRow('Total Budgeted Operating Income');
  const expenseRow = findRow('Total Budgeted Operating Expense');
  if (!revenueRow || !expenseRow) return { months: [] };
  const months = monthCols.map(({ col, year, month }) => {
    const revenueCents = dollarsToCents(revenueRow[col]);
    const expensesCents = dollarsToCents(expenseRow[col]);
    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      revenueCents,
      expensesCents,
      netIncomeCents: revenueCents - expensesCents,
    };
  });
  return { months };
}

// ── Church Report: Balance Sheet / Statement of Financial Position import ───────────────────
// A structurally different report from Budget vs. Actuals — point-in-time account balances
// (Assets/Liabilities/Equity), one "Total" column, no Actual/Budget split. Two real exports from
// this exact church were used to build this parser and turned out to use two genuinely different
// export conventions (confirmed, not assumed): one carries real cell-level indent metadata (no
// leading spaces in the label text at all) and closes subtotals as "Total for X"; the other uses
// literal leading spaces (same convention as the Budget vs. Actuals export) and closes subtotals
// as "Total X" (no "for"). balanceRowDepth() tries the leading-space convention first, falling
// back to the workbook's own style-indent metadata (colAIndent, from finXlsxParseColAIndents())
// when a row has no leading spaces — so either convention (or a mix) is read correctly.
const BALANCE_CLASSIFICATION_MAP = { assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity' };
// Returns null for "Liabilities and Equity" (and unrecognized labels) — that combined heading is
// a non-storable grouping wrapper in both real exports, not a real account. Its two real
// children, "Liabilities" and "Equity", are what actually anchor those two classifications —
// they sit one level deeper than "Assets" in the source file's own indentation, which is why the
// parser below fully resets its path stack on every classification match rather than trusting
// each report's literal indent number to stay consistent across classifications.
export function normalizeBalanceClassification(label) {
  const key = (label || '').trim().toLowerCase();
  return BALANCE_CLASSIFICATION_MAP[key] || null;
}
function balanceRowDepth(raw, styleIndent) {
  const stripped = raw.replace(/^ +/, '');
  const spaceIndent = raw.length - stripped.length;
  if (spaceIndent > 0) return Math.round(spaceIndent / 3);
  return styleIndent != null ? styleIndent : 0;
}
function nextNonBlankRowIndex(grid, i) {
  for (let j = i + 1; j < grid.length; j++) {
    const v = grid[j] && grid[j][0];
    if (typeof v === 'string' && v.trim()) return j;
  }
  return -1;
}
function makeBalanceRow(path, classification, hasChildren, fiscalYear, ownBalanceCents) {
  return {
    fiscal_year: fiscalYear,
    classification,
    category_path: path.join(':'),
    account_name: path[path.length - 1],
    depth: path.length - 1,
    has_children: hasChildren ? 1 : 0,
    own_balance_cents: ownBalanceCents,
  };
}
// Header row is blank-label / "Total" in column B (both real exports use this, with no
// Actual/Budget columns at all) — explicitly rejects a match immediately followed by a real
// Actual/Budget header row, which would mean this is actually a Budget vs. Actuals sheet (that
// report has its own "Total"-only decorative row one line above its real header).
export function parseBalanceSheetGrid(grid, colAIndent) {
  colAIndent = colAIndent || [];
  let headerIdx = -1;
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i];
    if (r && r[1] === 'Total' && (r[0] == null || r[0] === '')) {
      const next = grid[i + 1];
      if (next && next[1] === 'Actual' && next[2] === 'Budget') continue;
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find the balance sheet header row in this sheet.');
  let fiscalYear = null, asOfDate = '';
  for (let i = 0; i < headerIdx; i++) {
    const cell = grid[i] && grid[i][0];
    if (typeof cell === 'string') {
      const asOfM = /as of\s+(.+)/i.exec(cell);
      if (asOfM) asOfDate = asOfM[1].trim();
      const yearM = /(\d{4})/.exec(cell);
      if (yearM) fiscalYear = parseInt(yearM[1], 10);
    }
  }
  const stack = [];
  let classification = null;
  const rows = [], skipped = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] && grid[i][0];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const label = raw.trim();
    if (/^Total\s/i.test(label)) continue; // closing subtotal, re-derivable
    if (/^Liabilities and Equity$/i.test(label)) continue; // grouping wrapper, not a real account
    const depth = balanceRowDepth(raw, colAIndent[i]);
    const nextIdx = nextNonBlankRowIndex(grid, i);
    const hasChildren = nextIdx !== -1 && balanceRowDepth(grid[nextIdx][0], colAIndent[nextIdx]) > depth;
    const norm = normalizeBalanceClassification(label);
    if (norm) {
      classification = norm;
      stack.length = 0;
      stack.push({ depth, path: [classification] });
      rows.push(makeBalanceRow([classification], classification, hasChildren, fiscalYear, dollarsToCents((grid[i] || [])[1])));
      continue;
    }
    // A depth-0 line with no children following isn't a real account in this report's structure
    // (Assets/Liabilities/Equity always have children) — it's noise: a stray title line before
    // Assets is ever seen, or the trailing "Accrual Basis ..." timestamp footer confirmed present
    // in the real export (which, unlike the Budget report's footer, sits right after the LAST
    // real account row — so `classification` is already set and this must be checked before the
    // generic nested-row logic below, or it silently gets misfiled as a bogus account under
    // whatever classification happened to be open last).
    if (depth === 0 && !hasChildren) { skipped.push(raw); continue; }
    if (!classification) { skipped.push(raw); continue; } // stray line before Assets is ever seen
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : { path: [classification] };
    const path = parent.path.concat(label);
    stack.push({ depth, path });
    rows.push(makeBalanceRow(path, classification, hasChildren, fiscalYear, dollarsToCents((grid[i] || [])[1])));
  }
  return { fiscalYear, asOfDate, rows, skipped };
}
export function findBalanceSheetSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    const hasHeader = s.grid.some((r, i) => {
      if (!r || r[1] !== 'Total' || (r[0] != null && r[0] !== '')) return false;
      const next = s.grid[i + 1];
      return !(next && next[1] === 'Actual' && next[2] === 'Budget');
    });
    if (hasHeader) return s;
  }
  return null;
}
// Wholesale-replaces source='import' rows for exactly one fiscal year (a Balance Sheet export is
// always a single as-of-date snapshot) — same pattern as persistChurchEntriesImport.
export async function persistChurchBalancesImport(db, rows, fiscalYear, asOfDate, importedAt) {
  const ops = [db.prepare(`DELETE FROM finance_church_balances WHERE source='import' AND fiscal_year=?`).bind(fiscalYear)];
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_balances
         (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,'import',?)
       ON CONFLICT(fiscal_year, category_path, source) DO UPDATE SET
         as_of_date=excluded.as_of_date, classification=excluded.classification, account_name=excluded.account_name,
         depth=excluded.depth, has_children=excluded.has_children, own_balance_cents=excluded.own_balance_cents,
         synced_at=excluded.synced_at`
    ).bind(fiscalYear, asOfDate, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_balance_cents, importedAt));
  }
  await db.batch(ops);
}
// Rolls a set of (already fiscal-year-filtered) balance rows into per-classification totals —
// mirrors computeYearSummary()'s shape for the Income Statement side, so the frontend can reuse
// the same summary-card rendering pattern. Assets should equal Liabilities + Equity in a correct
// export; this is exposed so the UI can show that check rather than silently trusting the import.
export function computeBalanceSummary(rows) {
  const byClass = {};
  for (const r of rows) {
    if (!byClass[r.classification]) byClass[r.classification] = 0;
    byClass[r.classification] += r.own_balance_cents;
  }
  const assets = byClass.Assets || 0, liabilities = byClass.Liabilities || 0, equity = byClass.Equity || 0;
  return { classificationTotals: byClass, assetsCents: assets, liabilitiesCents: liabilities, equityCents: equity,
    liabilitiesPlusEquityCents: liabilities + equity, balancedCents: assets - (liabilities + equity) };
}

// ── Daycare data from an already-imported Church Budget year ────────────────────────────────
// The church's own chart of accounts already carries the daycare's (MDO — Mother's Day Out)
// income and expenses inside whichever year's Budget vs. Actuals has been imported (confirmed
// against a real export: "47 Mother's Day Out"/"47020 MDO Tuition" under Income, "57 MDO
// Expenses" with several "57160"/"57161"/etc. children under Expenses — the exact numeric codes
// aren't stable year to year, so matching is done by the "MDO"/"Mother's Day Out" text itself,
// not a hardcoded account number). This reads already-persisted finance_church_entries rows
// (no re-parsing of the original Excel file needed) and reshapes them into finance_daycare_entries
// rows using the Daycare Report's own existing category taxonomy (FIN_KNOWN_CATEGORY_ORDER in
// js-finance.js), so a past year's daycare figures — which the daycare app itself may have no
// record of — can be backfilled straight from the church's own budget.
const MDO_MATCH_RE = /mdo|mother'?s day out/i;
const MDO_CATEGORY_RULES = [
  { re: /tuition/i, category: 'Tuition Income' },
  { re: /payroll tax/i, category: 'Payroll Taxes' },
  { re: /workers?\s*comp/i, category: 'Workers Comp' },
  { re: /payroll processing/i, category: 'Other Payroll Expenses' },
  { re: /wage/i, category: 'Payroll' },
];
// Anything MDO-tagged that isn't wages/payroll-taxes/workers-comp/payroll-processing/tuition
// (e.g. "MDO Supplies") falls to 'Other Expenses' — matches the Daycare Report's own catch-all.
export function classifyMdoAccountCategory(accountName) {
  for (const rule of MDO_CATEGORY_RULES) if (rule.re.test(accountName)) return rule.category;
  return 'Other Expenses';
}
// `entries` should already be precedence-resolved (resolveChurchYearPrecedence) for the target
// year. Each matching account can produce up to 2 daycare entries (actual + budget) — zero/null
// amounts are skipped rather than written as $0 clutter. No has_children filtering: every stored
// finance_church_entries row already holds only its own non-cumulative amount (never a rolled-up
// "Total for X"), so a grouping header like "57 MDO Expenses" contributes nothing extra unless it
// genuinely has its own direct posting, which can't double-count against its children.
export function extractMdoDaycareEntries(entries, year) {
  const out = [];
  for (const r of entries) {
    if (!MDO_MATCH_RE.test(r.category_path) && !MDO_MATCH_RE.test(r.account_name)) continue;
    const category = classifyMdoAccountCategory(r.account_name);
    const notes = `Imported from Budget vs Actuals FY${year} (${r.account_name})`;
    if (r.own_actual_cents) out.push({ period: String(year), category, entry_type: 'actual', amount_cents: r.own_actual_cents, notes, source: 'church_budget_import' });
    if (r.own_budget_cents) out.push({ period: String(year), category, entry_type: 'budget', amount_cents: r.own_budget_cents, notes, source: 'church_budget_import' });
  }
  return out;
}
// Wholesale-replaces source='church_budget_import' rows for exactly one year — re-running the
// import (e.g. after correcting the underlying Budget import) replaces rather than duplicates;
// manual entries and any real 'daycare_api' sync rows for that same year are untouched.
export async function persistDaycareEntriesFromChurchBudget(db, entries, year) {
  const ops = [db.prepare(`DELETE FROM finance_daycare_entries WHERE source='church_budget_import' AND period=?`).bind(String(year))];
  for (const e of entries) {
    ops.push(db.prepare(
      `INSERT INTO finance_daycare_entries (period, category, entry_type, amount_cents, notes, source) VALUES (?,?,?,?,?,?)`
    ).bind(e.period, e.category, e.entry_type, e.amount_cents, e.notes, e.source));
  }
  await db.batch(ops);
}

// Wholesale-replaces source='qbo_sync' rows for exactly the fiscal years present in `rows`
// (mirrors the finance_daycare_entries sync's per-period delete+insert pattern), scoped to only
// the years actually being rewritten so a partial sync failure never wipes years an earlier,
// separate flatten pass already wrote correctly. `rows` should already be in the desired
// write-order — when two rows share a (fiscal_year, category_path) key (e.g. a multi-year
// actuals-only row and a richer current-year budget-merge row for the same year), the one
// inserted LATER in the array wins via ON CONFLICT DO UPDATE.
export async function persistChurchEntries(db, rows, syncedAt) {
  if (!rows.length) return;
  const years = [...new Set(rows.map(r => r.fiscal_year))];
  const ops = years.map(y => db.prepare(`DELETE FROM finance_church_entries WHERE source='qbo_sync' AND fiscal_year=?`).bind(y));
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,'qbo_sync',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
         own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
    ).bind(r.fiscal_year, r.period_month || 0, r.classification, r.category_path, r.account_name, r.depth, r.has_children, r.own_actual_cents, r.own_budget_cents, syncedAt));
  }
  await db.batch(ops);
}

// Wholesale-replaces source='import' rows for exactly one fiscal year (an import is always a
// single-year Budget-vs-Actuals sheet, unlike the sync's multi-year sweep) — same delete-then-
// insert pattern as persistChurchEntries, scoped to 'import' so it can never touch qbo_sync rows
// (source precedence is resolved at read time in resolveChurchYearPrecedence(), not by deleting
// the other source — removing an import later silently falls back to live-synced data again).
export async function persistChurchEntriesImport(db, rows, fiscalYear, importedAt) {
  const ops = [db.prepare(`DELETE FROM finance_church_entries WHERE source='import' AND fiscal_year=?`).bind(fiscalYear)];
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,'import',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
         own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
    ).bind(fiscalYear, r.period_month || 0, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_actual_cents, r.own_budget_cents, importedAt));
  }
  await db.batch(ops);
}

// Fetches the Budget entity + a single current-year ProfitAndLoss report and merges them into
// one tree, via the same collision-safe mergeProfitAndLossTree() used everywhere else in this
// file. This is the one trusted place that produces a current-year Budget+Actual merged tree —
// used both by buildBudgetVsActualFallback() (when QuickBooks' own BudgetVsActual REPORT
// endpoint fails) and by the finance/qb/sync handler to populate finance_church_entries
// (always, regardless of whether the real report succeeded — its own column shape isn't
// guaranteed to match what this function's known 4-column Account/Actual/Budget/OverBudget
// shape assumes, so persistence never flattens it directly).
// ⚠ The exact Budget entity field names (BudgetDetail/AccountRef/Amount) are based on Intuit's
// published schema but could not be confirmed against a live response while building this (docs
// site blocked automated fetches) — if this returns no usable data, check the real shape of a
// `SELECT * FROM Budget` response against what's read below and adjust field names accordingly.
async function mergeCurrentYearBudgetAndActual(client, year, warnings) {
  const budgetsData = await fetchQboJson('Budget entity', client.budgets(), warnings);
  if (!budgetsData) return null;
  const budgetList = budgetsData?.QueryResponse?.Budget || [];
  const budget = budgetList.find(b => (b.StartDate || '').startsWith(String(year))) || budgetList[0];
  if (!budget) { warnings.push(`Budget entity: no Budget found for ${year}`); return null; }

  const plData = await fetchQboJson(
    'Profit and Loss (current year)',
    client.profitAndLoss({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
    warnings
  );
  if (!plData || !plData.Rows) return null;

  // Sum by name (a single account legitimately has one BudgetDetail line per month), but also
  // track distinct account IDs per name so a genuine name collision across different accounts
  // can be told apart from ordinary multi-month lines for the same account.
  const budgetByName = new Map();
  const budgetIdsByName = new Map();
  for (const line of (budget.BudgetDetail || [])) {
    const name = line?.AccountRef?.name;
    const id = line?.AccountRef?.value;
    const amt = Number(line?.Amount);
    if (!name || !Number.isFinite(amt)) continue;
    budgetByName.set(name, (budgetByName.get(name) || 0) + amt);
    if (!budgetIdsByName.has(name)) budgetIdsByName.set(name, new Set());
    if (id != null) budgetIdsByName.get(name).add(id);
  }
  if (!budgetByName.size) { warnings.push('Budget entity: found a Budget but no usable BudgetDetail line items'); return null; }

  const ambiguousNames = new Set();
  const rows = mergeProfitAndLossTree(plData.Rows.Row, { budgetByName, budgetIdsByName, ambiguousNames });
  if (ambiguousNames.size) {
    warnings.push(
      `Budget vs Actual: ${ambiguousNames.size} account name(s) appear on more than one account in different categories (e.g. sub-accounts sharing a name across Income and Expenses) — shown as $0 budget rather than guessed which one: ${[...ambiguousNames].slice(0, 5).join(', ')}${ambiguousNames.size > 5 ? '…' : ''}`
    );
  }
  return { rows };
}

// Fallback for when the BudgetVsActual REPORT endpoint itself is blocked (hit a persistent
// "5020 Permission Denied" error during live testing even with a verified Budget and Company
// Admin access) but entity-level/other-report access still works. Wraps
// mergeCurrentYearBudgetAndActual()'s merged tree in the same Columns/Rows report shape the
// frontend already renders generically, so no frontend changes are needed to display it.
async function buildBudgetVsActualFallback(client, year, warnings) {
  const merged = await mergeCurrentYearBudgetAndActual(client, year, warnings);
  if (!merged) return null;
  return {
    Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
    Rows: { Row: merged.rows },
    _synthesized: true,
  };
}

// Wraps a QuickBooks Accounting API call with the error-handling Intuit's own developer
// questionnaire asks about: captures the `intuit_tid` response header (Intuit's recommended
// field for support tickets), parses the structured Fault.Error[] body QBO returns on failure
// instead of just surfacing a bare HTTP status, and logs the full detail server-side (visible
// via `wrangler tail`/the Cloudflare dashboard) so a failure can be diagnosed without needing
// to reproduce it live.
async function fetchQboJson(label, resPromise, warnings, hint) {
  let r;
  try { r = await resPromise; }
  catch (e) {
    console.error(`[QuickBooks sync] ${label} request failed:`, e);
    warnings.push(`${label}: ${e.message}`);
    return null;
  }
  const tid = r.headers.get('intuit_tid') || '';
  if (r.ok) return await r.json();
  const fault = await r.json().catch(() => null);
  const faultError = fault?.Fault?.Error?.[0];
  const detail = [faultError?.Message, faultError?.Detail].filter(Boolean).join(' — ');
  console.error(`[QuickBooks sync] ${label} failed:`, { status: r.status, intuit_tid: tid, code: faultError?.code, message: faultError?.Message, detail: faultError?.Detail });
  warnings.push(
    `${label} (HTTP ${r.status}${tid ? `, intuit_tid ${tid}` : ''}${faultError?.code ? `, error code ${faultError.code}` : ''})`
    + (detail ? `: ${detail}` : '')
    + (hint ? ` — ${hint}` : '')
  );
  return null;
}

// Given all finance_church_entries rows for a set of years (any source), resolves per-year
// source precedence: a year with any 'import' or 'manual' row uses ONLY those rows (an import is
// always a deliberate override/backfill — see migrations/0018_finance_church_entries.sql); a
// year with only 'qbo_sync' rows uses those. One bulk query + JS grouping, not a correlated
// subquery per year, matching this app's existing performance conventions.
// Highest to lowest priority. 'import' (a hand-uploaded Excel export) always wins over a live
// QBO sync, same as before this list existed. 'plan_committed' (a forward Budget Planning
// projection committed to a future year — see FIN12) is deliberately LOWEST priority: it's a
// placeholder for a year with no real data yet, and must get out of the way the moment either a
// live sync or a real import exists for that year, rather than permanently overriding them.
const CHURCH_SOURCE_PRIORITY = ['import', 'qbo_sync', 'plan_committed'];
export function resolveChurchYearPrecedence(rows) {
  const byYear = new Map();
  for (const r of rows) {
    if (!byYear.has(r.fiscal_year)) byYear.set(r.fiscal_year, []);
    byYear.get(r.fiscal_year).push(r);
  }
  const out = [];
  for (const yearRows of byYear.values()) {
    for (const src of CHURCH_SOURCE_PRIORITY) {
      const matching = yearRows.filter(r => r.source === src);
      if (matching.length) { out.push(...matching); break; }
    }
  }
  return out;
}

// Rolls a year's precedence-resolved flat rows up into per-classification actual/budget totals
// plus the derived running-subtotal figures (Gross Profit, Net Operating Income, Net Other
// Income, Net Income) — the same arithmetic mergeProfitAndLossTree() computes over a live tree,
// now computed over persisted rows instead. own_budget_cents is null when no budget is known for
// an account (as opposed to a real $0) — hasBudgetData is true only if at least one row in the
// year has a non-null budget, so the caller can show "no budget data" honestly instead of $0.
export function computeYearSummary(rows) {
  const byClass = {};
  let hasBudgetData = false;
  for (const r of rows) {
    if (!byClass[r.classification]) byClass[r.classification] = { actualCents: 0, budgetCents: 0 };
    byClass[r.classification].actualCents += r.own_actual_cents;
    if (r.own_budget_cents != null) { byClass[r.classification].budgetCents += r.own_budget_cents; hasBudgetData = true; }
  }
  const get = c => byClass[c] || { actualCents: 0, budgetCents: 0 };
  const income = get('Income'), cogs = get('Cost of Goods Sold'), expenses = get('Expenses'),
        otherIncome = get('Other Income'), otherExpenses = get('Other Expenses');
  const grossProfit = { actualCents: income.actualCents - cogs.actualCents, budgetCents: income.budgetCents - cogs.budgetCents };
  const netOperatingIncome = { actualCents: grossProfit.actualCents - expenses.actualCents, budgetCents: grossProfit.budgetCents - expenses.budgetCents };
  const netOtherIncome = { actualCents: otherIncome.actualCents - otherExpenses.actualCents, budgetCents: otherIncome.budgetCents - otherExpenses.budgetCents };
  const netIncome = { actualCents: netOperatingIncome.actualCents + netOtherIncome.actualCents, budgetCents: netOperatingIncome.budgetCents + netOtherIncome.budgetCents };
  return { classificationTotals: byClass, grossProfit, netOperatingIncome, netOtherIncome, netIncome, hasBudgetData };
}

// This-year-vs-last-year-to-date comparison + a year-end projection, computed purely from
// already-fetched rows (no DB access) so it's independently unit-testable. `currentMonthlyRows`/
// `priorMonthlyRows` must already be filtered to period_month <= throughMonth by the caller;
// `priorAnnualRows` is the FULL prior year (any source, precedence-resolved here) since the
// projection ratio needs the prior year's whole-year total, not just its YTD slice.
// Returns { available: false } when either year has no monthly data yet — deliberately never
// fabricates a comparison from annual-only rows (see migrations/0018_finance_church_entries.sql).
export function computeYtdComparison(currentMonthlyRows, priorMonthlyRows, priorAnnualRows, throughMonth) {
  if (!currentMonthlyRows.length || !priorMonthlyRows.length) return { available: false };
  const curYtd = computeYearSummary(currentMonthlyRows);
  const priorYtd = computeYearSummary(priorMonthlyRows);
  const priorAnnual = computeYearSummary(resolveChurchYearPrecedence(priorAnnualRows));

  // Prior-year-ratio projection (captures seasonality a straight-line extrapolation would miss);
  // falls back to straight-line only when the prior year's YTD-at-this-point was exactly zero
  // (so the ratio is undefined) — e.g. a fund with no activity yet this time last year.
  function series(curCents, priorYtdCents, priorFullCents) {
    let projectedCents, method;
    if (priorYtdCents !== 0) {
      projectedCents = Math.round(curCents * (priorFullCents / priorYtdCents));
      method = 'prior-year-ratio';
    } else {
      projectedCents = Math.round(curCents * (12 / throughMonth));
      method = 'straight-line';
    }
    return { currentYtdCents: curCents, priorYtdCents, priorFullYearCents: priorFullCents, projectedFullYearCents: projectedCents, method };
  }
  const get = (s, c) => (s.classificationTotals[c] || { actualCents: 0 }).actualCents;
  return {
    available: true,
    throughMonth,
    income: series(get(curYtd, 'Income'), get(priorYtd, 'Income'), get(priorAnnual, 'Income')),
    expenses: series(get(curYtd, 'Expenses'), get(priorYtd, 'Expenses'), get(priorAnnual, 'Expenses')),
    net: series(curYtd.netIncome.actualCents, priorYtd.netIncome.actualCents, priorAnnual.netIncome.actualCents),
  };
}

// Any account whose name contains "Supplies" (matches both a real MDO-tagged QuickBooks
// account like "50160 MDO Supplies" — see classifyMdoAccountCategory's comment above, which
// deliberately lumps these into the generic Other Expenses catch-all for the Daycare Report —
// and any non-MDO church supplies account) is pulled out of the monthly rows as its own
// month-by-month breakdown, so it can be charted on its own instead of staying buried.
// `currentMonthlyRows`/`priorMonthlyRows` are the same period_month 1-12 qbo_sync rows already
// fetched for computeYtdComparison; pure/no DB access, independently unit-testable.
const SUPPLIES_MATCH_RE = /supplies/i;
export function computeSuppliesMonthlyBreakdown(currentMonthlyRows, priorMonthlyRows) {
  const curByMonth = {}, priorByMonth = {};
  let curYtdCents = 0, priorYtdCents = 0;
  for (const r of currentMonthlyRows) {
    if (!SUPPLIES_MATCH_RE.test(r.account_name)) continue;
    curByMonth[r.period_month] = (curByMonth[r.period_month] || 0) + (r.own_actual_cents || 0);
    curYtdCents += r.own_actual_cents || 0;
  }
  for (const r of priorMonthlyRows) {
    if (!SUPPLIES_MATCH_RE.test(r.account_name)) continue;
    priorByMonth[r.period_month] = (priorByMonth[r.period_month] || 0) + (r.own_actual_cents || 0);
    priorYtdCents += r.own_actual_cents || 0;
  }
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return {
    monthly: months.map(m => ({ month: m, currentCents: curByMonth[m] || 0, priorCents: priorByMonth[m] || 0 })),
    currentYtdCents: curYtdCents,
    priorYtdCents: priorYtdCents,
  };
}

// Overview tab's "Income vs. Expenses" trend card: 12 months, actual through the current month
// (from synced monthly rows) then a flat monthly projection for the remaining months, spreading
// whatever's left of the year's budget evenly across them — a simple, honest placeholder (the
// mockup's own model) rather than a smarter seasonal projection, since it's a glance-level chart,
// not the YTD projection figure itself (that's computeYtdComparison's prior-year-ratio, used for
// the KPI cards). `curYearMonthlyRows` must already be filtered to one fiscal year; pure/no DB
// access, independently unit-testable.
export function computeIncomeExpenseMonthlyTrend(curYearMonthlyRows, throughMonth, summary) {
  if (!curYearMonthlyRows.length) return { available: false, months: [] };
  const byMonth = {};
  for (let m = 1; m <= 12; m++) byMonth[m] = { incomeCents: 0, expenseCents: 0 };
  for (const r of curYearMonthlyRows) {
    if (r.period_month < 1 || r.period_month > 12) continue;
    if (r.classification === 'Income') byMonth[r.period_month].incomeCents += (r.own_actual_cents || 0);
    else if (r.classification === 'Expenses') byMonth[r.period_month].expenseCents += (r.own_actual_cents || 0);
  }
  let incomeSoFarCents = 0, expenseSoFarCents = 0;
  for (let m = 1; m <= throughMonth; m++) { incomeSoFarCents += byMonth[m].incomeCents; expenseSoFarCents += byMonth[m].expenseCents; }
  const remainingMonths = 12 - throughMonth;
  const incomeBudgetCents = summary.classificationTotals?.Income?.budgetCents || 0;
  const expenseBudgetCents = summary.classificationTotals?.Expenses?.budgetCents || 0;
  const projIncomePerMonth = remainingMonths > 0 ? Math.max(0, incomeBudgetCents - incomeSoFarCents) / remainingMonths : 0;
  const projExpensePerMonth = remainingMonths > 0 ? Math.max(0, expenseBudgetCents - expenseSoFarCents) / remainingMonths : 0;
  const months = [];
  for (let m = 1; m <= 12; m++) {
    if (m <= throughMonth) months.push({ month: m, incomeCents: byMonth[m].incomeCents, expenseCents: byMonth[m].expenseCents, projected: false });
    else months.push({ month: m, incomeCents: Math.round(projIncomePerMonth), expenseCents: Math.round(projExpensePerMonth), projected: true });
  }
  return { available: true, throughMonth, months };
}

// ── Commercial Property (Finance tab) ────────────────────────────────────────────────────
// Groups a property's monthly rows + distributions by calendar year (the "period" field is
// always 'YYYY-MM') into the same annual shape the 2026-07-20 data export used, plus each
// year's hand-written note — kept as the single source of truth so the numbers can never drift
// from what's on screen in the monthly table.
export function computePropertyAnnualSummary(monthlyRows, distributionRows, annualNotes) {
  const byYear = {};
  for (const r of monthlyRows) {
    const year = parseInt(String(r.period || '').slice(0, 4), 10);
    if (!Number.isFinite(year)) continue;
    if (!byYear[year]) byYear[year] = { year, total_revenue_cents: 0, total_expenses_cents: 0, net_income_cents: 0, occ_sum: 0, occ_count: 0, confirmed_distributions_cents: 0, notes: annualNotes?.[year] || '' };
    const y = byYear[year];
    if (Number.isFinite(r.total_revenue_cents)) y.total_revenue_cents += r.total_revenue_cents;
    if (Number.isFinite(r.total_expenses_cents)) y.total_expenses_cents += r.total_expenses_cents;
    if (Number.isFinite(r.net_income_cents)) y.net_income_cents += r.net_income_cents;
    if (Number.isFinite(r.occupancy_pct)) { y.occ_sum += r.occupancy_pct; y.occ_count++; }
  }
  for (const d of distributionRows) {
    const year = parseInt(String(d.period || '').slice(0, 4), 10);
    if (byYear[year]) byYear[year].confirmed_distributions_cents += d.amount_cents;
  }
  return Object.values(byYear)
    .map(y => ({
      year: y.year,
      total_revenue_cents: y.total_revenue_cents,
      total_expenses_cents: y.total_expenses_cents,
      net_income_cents: y.net_income_cents,
      avg_occupancy_pct: y.occ_count ? y.occ_sum / y.occ_count : null,
      confirmed_distributions_cents: y.confirmed_distributions_cents,
      notes: y.notes,
    }))
    .sort((a, b) => a.year - b.year);
}

async function handlePropertyApi(req, url, method, seg, db, isAdmin, propertyKey) {
  if (seg === `finance/property/${propertyKey}` && method === 'GET') {
    const monthly = (await db.prepare('SELECT * FROM finance_property_monthly WHERE property_key=? ORDER BY period ASC').bind(propertyKey).all()).results || [];
    const distributions = (await db.prepare('SELECT period, amount_cents FROM finance_property_distributions WHERE property_key=? ORDER BY period ASC').bind(propertyKey).all()).results || [];
    const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key=?").bind(`finance_property_${propertyKey}_meta`).first();
    let meta = null;
    if (metaRow) { try { meta = JSON.parse(metaRow.value); } catch { meta = null; } }
    const annualSummary = computePropertyAnnualSummary(monthly, distributions, meta?.annual_notes);
    let equity = null;
    if (meta?.valuation?.capitalized_value_cents != null && meta?.loan?.balance_cents != null) {
      const value = meta.valuation.capitalized_value_cents;
      const balance = meta.loan.balance_cents;
      equity = { market_value_cents: value, mortgage_balance_cents: balance, equity_cents: value - balance, loan_to_value_pct: value ? balance / value : null };
    }
    const reserveRows = (await db.prepare('SELECT * FROM finance_property_reserves WHERE property_key=? ORDER BY reserve_key ASC, report_month ASC').bind(propertyKey).all()).results || [];
    const reserves = {};
    for (const r of reserveRows) { (reserves[r.reserve_key] || (reserves[r.reserve_key] = [])).push(r); }
    const disbursementRows = (await db.prepare('SELECT * FROM finance_property_reserve_disbursements WHERE property_key=? ORDER BY reserve_key ASC, period_key ASC').bind(propertyKey).all()).results || [];
    const reserveDisbursements = {};
    for (const d of disbursementRows) { (reserveDisbursements[d.reserve_key] || (reserveDisbursements[d.reserve_key] = [])).push(d); }
    const capitalLedger = (await db.prepare('SELECT * FROM finance_property_capital_ledger WHERE property_key=? ORDER BY sort_order ASC, entry_date ASC, id ASC').bind(propertyKey).all()).results || [];
    const capitalLedgerTotalCents = capitalLedger.reduce((sum, r) => sum + (r.amount_cents || 0), 0);
    const repairs = (await db.prepare('SELECT * FROM finance_property_repairs WHERE property_key=? ORDER BY entry_date ASC, id ASC').bind(propertyKey).all()).results || [];
    const budgetMonthly = (await db.prepare('SELECT * FROM finance_property_budget_monthly WHERE property_key=? ORDER BY period ASC').bind(propertyKey).all()).results || [];

    return json({ propertyKey, meta, monthly, budgetMonthly, distributions, annualSummary, equity, reserves, reserveDisbursements, capitalLedger, capitalLedgerTotalCents, repairs });
  }

  // Imports a property manager's "Budget Detail" export (AHRA) — see
  // parsePropertyBudgetDetailGrid() above. Parses and commits in one step (unlike the Church
  // Report imports' preview-then-commit flow): this export's shape is fixed and the two rollup
  // rows it reads are unambiguous, so there's little for a human review step to catch; the
  // response still echoes back exactly what was written so the admin can see it took.
  if (seg === `finance/property/${propertyKey}/budget-import` && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    const sheet = findPropertyBudgetDetailSheet(sheets);
    if (!sheet) return json({ error: 'Could not find a "Budget Detail" sheet in this file (expected an "Account Name" / "Jan YYYY" header row).' }, 400);
    const { months } = parsePropertyBudgetDetailGrid(sheet.grid);
    if (!months.length) return json({ error: 'Could not find "Total Budgeted Operating Income"/"Total Budgeted Operating Expense" rows in this sheet.' }, 400);
    const ops = months.map(m => db.prepare(
      `INSERT INTO finance_property_budget_monthly (property_key, period, revenue_cents, expenses_cents, net_income_cents, source, updated_at)
       VALUES (?,?,?,?,?,'ahra_import',datetime('now'))
       ON CONFLICT(property_key, period) DO UPDATE SET revenue_cents=excluded.revenue_cents, expenses_cents=excluded.expenses_cents, net_income_cents=excluded.net_income_cents, source=excluded.source, updated_at=excluded.updated_at`
    ).bind(propertyKey, m.period, m.revenueCents, m.expensesCents, m.netIncomeCents));
    await db.batch(ops);
    return json({ ok: true, imported: months.length, months });
  }

  if (seg === `finance/property/${propertyKey}/monthly` && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    if (!b.period || !/^\d{4}-\d{2}$/.test(b.period)) return json({ error: 'period must be YYYY-MM' }, 400);
    const toCents = v => (v === '' || v === null || v === undefined) ? null : Math.round(Number(v) * 100);
    const occ = (b.occupancy_pct === '' || b.occupancy_pct === null || b.occupancy_pct === undefined) ? null : Number(b.occupancy_pct);
    if (occ !== null && !Number.isFinite(occ)) return json({ error: 'Invalid occupancy_pct' }, 400);
    const cents = {
      total_revenue_cents: toCents(b.total_revenue),
      total_expenses_cents: toCents(b.total_expenses),
      net_income_cents: toCents(b.net_income),
      net_operating_income_cents: toCents(b.net_operating_income),
      available_for_distribution_cents: toCents(b.available_for_distribution),
      reserve_balance_cents: toCents(b.reserve_balance),
    };
    for (const [k, v] of Object.entries(cents)) { if (v !== null && !Number.isFinite(v)) return json({ error: `Invalid ${k}` }, 400); }
    await db.prepare(
      `INSERT INTO finance_property_monthly
         (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,source_report,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(property_key,period) DO UPDATE SET
         occupancy_pct=excluded.occupancy_pct, total_revenue_cents=excluded.total_revenue_cents, total_expenses_cents=excluded.total_expenses_cents,
         net_income_cents=excluded.net_income_cents, net_operating_income_cents=excluded.net_operating_income_cents,
         available_for_distribution_cents=excluded.available_for_distribution_cents, reserve_balance_cents=excluded.reserve_balance_cents,
         source_report=excluded.source_report, updated_at=excluded.updated_at`
    ).bind(propertyKey, b.period, occ, cents.total_revenue_cents, cents.total_expenses_cents, cents.net_income_cents, cents.net_operating_income_cents, cents.available_for_distribution_cents, cents.reserve_balance_cents, b.source_report || '').run();
    return json({ ok: true });
  }

  const monthMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/monthly/(\\d{4}-\\d{2})$`));
  if (monthMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_property_monthly WHERE property_key=? AND period=?').bind(propertyKey, monthMatch[1]).run();
    return json({ ok: true });
  }

  if (seg === `finance/property/${propertyKey}/distributions` && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    if (!b.period || !/^\d{4}-\d{2}$/.test(b.period)) return json({ error: 'period must be YYYY-MM' }, 400);
    const amountCents = Math.round(Number(b.amount) * 100);
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    await db.prepare(
      `INSERT INTO finance_property_distributions (property_key,period,amount_cents) VALUES (?,?,?)
       ON CONFLICT(property_key,period) DO UPDATE SET amount_cents=excluded.amount_cents`
    ).bind(propertyKey, b.period, amountCents).run();
    return json({ ok: true });
  }

  const distMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/distributions/(\\d{4}-\\d{2})$`));
  if (distMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_property_distributions WHERE property_key=? AND period=?').bind(propertyKey, distMatch[1]).run();
    return json({ ok: true });
  }

  if (seg === `finance/property/${propertyKey}/meta` && method === 'PATCH') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key=?").bind(`finance_property_${propertyKey}_meta`).first();
    let meta = {};
    if (metaRow) { try { meta = JSON.parse(metaRow.value) || {}; } catch { meta = {}; } }
    for (const section of ['property', 'valuation', 'loan']) {
      if (b[section] && typeof b[section] === 'object') meta[section] = { ...(meta[section] || {}), ...b[section] };
    }
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(`finance_property_${propertyKey}_meta`, JSON.stringify(meta)).run();
    return json({ ok: true, meta });
  }

  // ── Named reserve schedules (property tax, capital paint/asphalt/concrete, ...) ────────────
  const reserveMonthlyMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/reserves/([a-z_]+)/monthly$`));
  if (reserveMonthlyMatch && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const reserveKey = reserveMonthlyMatch[1];
    const b = await req.json().catch(() => ({}));
    if (!b.report_month || !/^\d{4}-\d{2}$/.test(b.report_month)) return json({ error: 'report_month must be YYYY-MM' }, 400);
    const toCents = v => (v === '' || v === null || v === undefined) ? null : Math.round(Number(v) * 100);
    const targetEstimateCents = toCents(b.target_estimate);
    const contributionCents = toCents(b.contribution) ?? 0;
    if (targetEstimateCents !== null && !Number.isFinite(targetEstimateCents)) return json({ error: 'Invalid target_estimate' }, 400);
    if (!Number.isFinite(contributionCents)) return json({ error: 'Invalid contribution' }, 400);
    const taxYear = (b.tax_year === '' || b.tax_year === null || b.tax_year === undefined) ? null : parseInt(b.tax_year, 10);
    // reserve_before defaults to the latest prior month's reserve_after for this bucket (0 if
    // none exists yet) — matches how AHRA's own monthly schedule carries a running balance.
    let reserveBeforeCents = toCents(b.reserve_before);
    if (reserveBeforeCents === null) {
      const prior = await db.prepare(
        `SELECT reserve_after_cents FROM finance_property_reserves WHERE property_key=? AND reserve_key=? AND report_month<? ORDER BY report_month DESC LIMIT 1`
      ).bind(propertyKey, reserveKey, b.report_month).first();
      reserveBeforeCents = prior?.reserve_after_cents ?? 0;
    }
    const reserveAfterCents = reserveBeforeCents + contributionCents;
    await db.prepare(
      `INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(property_key,reserve_key,report_month) DO UPDATE SET
         tax_year=excluded.tax_year, target_estimate_cents=excluded.target_estimate_cents, reserve_before_cents=excluded.reserve_before_cents,
         contribution_cents=excluded.contribution_cents, reserve_after_cents=excluded.reserve_after_cents, note=excluded.note`
    ).bind(propertyKey, reserveKey, b.report_month, taxYear, targetEstimateCents, reserveBeforeCents, contributionCents, reserveAfterCents, b.note || '').run();
    return json({ ok: true, reserve_before_cents: reserveBeforeCents, reserve_after_cents: reserveAfterCents });
  }

  const reserveMonthDeleteMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/reserves/([a-z_]+)/monthly/(\\d{4}-\\d{2})$`));
  if (reserveMonthDeleteMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_property_reserves WHERE property_key=? AND reserve_key=? AND report_month=?')
      .bind(propertyKey, reserveMonthDeleteMatch[1], reserveMonthDeleteMatch[2]).run();
    return json({ ok: true });
  }

  const reserveDisbursementMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/reserves/([a-z_]+)/disbursements$`));
  if (reserveDisbursementMatch && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const reserveKey = reserveDisbursementMatch[1];
    const b = await req.json().catch(() => ({}));
    if (!b.period_key || !String(b.period_key).trim()) return json({ error: 'period_key is required' }, 400);
    const amountCents = (b.amount === '' || b.amount === null || b.amount === undefined) ? null : Math.round(Number(b.amount) * 100);
    if (amountCents !== null && !Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    await db.prepare(
      `INSERT INTO finance_property_reserve_disbursements (property_key,reserve_key,period_key,amount_cents,paid_via_report_month,note)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(property_key,reserve_key,period_key) DO UPDATE SET amount_cents=excluded.amount_cents, paid_via_report_month=excluded.paid_via_report_month, note=excluded.note`
    ).bind(propertyKey, reserveKey, String(b.period_key).trim(), amountCents, b.paid_via_report_month || '', b.note || '').run();
    return json({ ok: true });
  }

  const reserveDisbursementDeleteMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/reserves/([a-z_]+)/disbursements/(.+)$`));
  if (reserveDisbursementDeleteMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_property_reserve_disbursements WHERE property_key=? AND reserve_key=? AND period_key=?')
      .bind(propertyKey, reserveDisbursementDeleteMatch[1], decodeURIComponent(reserveDisbursementDeleteMatch[2])).run();
    return json({ ok: true });
  }

  // ── Capital improvements ledger ────────────────────────────────────────────────────────────
  if (seg === `finance/property/${propertyKey}/capital-ledger` && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const amountCents = Math.round(Number(b.amount) * 100);
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    if (b.entry_date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(b.entry_date)) return json({ error: 'entry_date must be YYYY, YYYY-MM, or YYYY-MM-DD' }, 400);
    const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order),-1) as m FROM finance_property_capital_ledger WHERE property_key=?').bind(propertyKey).first();
    const r = await db.prepare(
      `INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,payee,description,check_ref,project,sort_order) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(propertyKey, b.entry_date || '', amountCents, b.payee || '', b.description || '', b.check_ref || '', b.project || '', (maxSort?.m ?? -1) + 1).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  const capitalLedgerDeleteMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/capital-ledger/(\\d+)$`));
  if (capitalLedgerDeleteMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_property_capital_ledger WHERE property_key=? AND id=?').bind(propertyKey, parseInt(capitalLedgerDeleteMatch[1], 10)).run();
    return json({ ok: true });
  }

  // ── Repairs & maintenance log ──────────────────────────────────────────────────────────────
  if (seg === `finance/property/${propertyKey}/repairs` && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const amountCents = (b.amount === '' || b.amount === null || b.amount === undefined) ? null : Math.round(Number(b.amount) * 100);
    if (amountCents !== null && !Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    const r = await db.prepare(
      `INSERT INTO finance_property_repairs (property_key,entry_date,category,description,amount_cents,payee,capitalized) VALUES (?,?,?,?,?,?,?)`
    ).bind(propertyKey, b.entry_date || '', b.category || '', b.description || '', amountCents, b.payee || '', b.capitalized ? 1 : 0).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  const repairsDeleteMatch = seg.match(new RegExp(`^finance/property/${propertyKey}/repairs/(\\d+)$`));
  if (repairsDeleteMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_property_repairs WHERE property_key=? AND id=?').bind(propertyKey, parseInt(repairsDeleteMatch[1], 10)).run();
    return json({ ok: true });
  }

  return undefined;
}

export async function handleFinanceApi(req, env, url, method, seg, db, isAdmin, isFinance) {
  if (!isFinance) return json({ error: 'Access denied: finance data requires finance access' }, 403);

  // ── Commercial Property (only 'ivanhoe' exists today; propertyKey is threaded through so a
  // second property could be added later without a route/schema change) ──────────────────
  if (seg.startsWith('finance/property/ivanhoe')) {
    const propRes = await handlePropertyApi(req, url, method, seg, db, isAdmin, 'ivanhoe');
    if (propRes !== undefined) return propRes;
  }

  // ── QuickBooks connection status ─────────────────────────────────────
  if (seg === 'finance/status' && method === 'GET') {
    const conn = await getConnection(db);
    const daycareSyncRow = await db.prepare("SELECT value FROM chms_config WHERE key='daycare_last_synced_at'").first();
    return json({
      configured: qboConfigured(env),
      connected: !!(conn && conn.realm_id),
      companyName: conn?.company_name || '',
      environment: conn?.environment || 'production',
      connectedAt: conn?.connected_at || '',
      lastSyncedAt: conn?.last_synced_at || '',
      daycareConfigured: daycareConfigured(env),
      daycareLastSyncedAt: daycareSyncRow?.value || '',
    });
  }

  // ── Begin OAuth: redirect the admin's browser to Intuit's consent screen ──
  if (seg === 'finance/qb/connect' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied: connecting QuickBooks requires admin access' }, 403);
    if (!qboConfigured(env)) return json({ error: 'QuickBooks is not configured. An admin must add QB_CLIENT_ID and QB_CLIENT_SECRET (see SECRETS.md).' }, 503);
    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();
    const state = crypto.randomUUID();
    if (env.RSVP_STORE) await env.RSVP_STORE.put(`qb_oauth_state:${state}`, '1', { expirationTtl: 600 });
    return new Response(null, { status: 302, headers: { Location: await getAuthorizeUrl(env, redirectUri, state) } });
  }

  // ── OAuth callback: Intuit redirects here with ?code&realmId&state ────
  if (seg === 'finance/qb/callback' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const code = url.searchParams.get('code');
    const realmId = url.searchParams.get('realmId');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return redirectToApp(url, 'qb_error', oauthError);
    if (!code || !realmId || !state) return redirectToApp(url, 'qb_error', 'missing_params');
    if (env.RSVP_STORE) {
      const stateOk = await env.RSVP_STORE.get(`qb_oauth_state:${state}`);
      if (!stateOk) return redirectToApp(url, 'qb_error', 'invalid_or_expired_state');
      await env.RSVP_STORE.delete(`qb_oauth_state:${state}`);
    }
    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();
    let tokens;
    try { tokens = await exchangeCodeForTokens(env, code, redirectUri); }
    catch (e) { return redirectToApp(url, 'qb_error', e.message); }
    const environment = env.QB_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
    const now = Date.now();
    const accessExpiresAt = new Date(now + (tokens.expires_in || 3600) * 1000).toISOString();
    const refreshExpiresAt = new Date(now + (tokens.x_refresh_token_expires_in || 8640000) * 1000).toISOString();
    let companyName = '';
    try {
      const client = makeQboClient(env, { realm_id: realmId, access_token: tokens.access_token, environment });
      const ciRes = await client.companyInfo();
      if (ciRes.ok) { const ci = await ciRes.json(); companyName = ci?.CompanyInfo?.CompanyName || ''; }
    } catch { /* non-fatal — connection still succeeds without a display name */ }
    await db.prepare(
      `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '')
       ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id, company_name=excluded.company_name,
         access_token=excluded.access_token, refresh_token=excluded.refresh_token,
         access_token_expires_at=excluded.access_token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
         environment=excluded.environment, connected_at=datetime('now')`
    ).bind(realmId, companyName, tokens.access_token, tokens.refresh_token, accessExpiresAt, refreshExpiresAt, environment).run();
    return redirectToApp(url, 'qb_connected', '1');
  }

  // ── Disconnect ──────────────────────────────────────────────────────
  if (seg === 'finance/qb/disconnect' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: disconnecting QuickBooks requires admin access' }, 403);
    const conn = await getConnection(db);
    if (conn?.refresh_token) await revokeToken(env, conn.refresh_token);
    await db.prepare('DELETE FROM finance_qb_connection WHERE id=1').run();
    await db.prepare("DELETE FROM finance_qb_snapshot").run();
    return json({ ok: true });
  }

  // ── Sync: pull Budget vs Actual + account balances, cache them ────────
  if (seg === 'finance/qb/sync' && method === 'POST') {
    const conn = await getConnection(db);
    if (!conn || !conn.realm_id) return json({ error: 'QuickBooks is not connected yet.' }, 400);
    let fresh;
    try { fresh = await ensureFreshAccessToken(env, db, conn); }
    catch (e) { return json({ error: 'QuickBooks re-authentication failed — try disconnecting and reconnecting. (' + e.message + ')' }, 502); }
    const client = makeQboClient(env, fresh);
    const year = new Date().getFullYear();
    const warnings = [];

    // Built once via our own trusted merge pipeline (known, tested Columns shape) — used both
    // to persist finance_church_entries below (always) and as the Overview tab's fallback
    // display when QuickBooks' own BudgetVsActual report call fails. Never flatten the real
    // budgetVsActual report itself into finance_church_entries: its exact column layout isn't
    // guaranteed to match this function's known 4-column shape.
    const currentYearMerge = await mergeCurrentYearBudgetAndActual(client, year, warnings);

    let budgetVsActual = await fetchQboJson(
      'Budget vs Actual',
      client.budgetVsActual({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
      warnings,
      `make sure a Budget for ${year} exists in QuickBooks under Settings > Budgeting`
    );
    if (!budgetVsActual && currentYearMerge) {
      budgetVsActual = {
        Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
        Rows: { Row: currentYearMerge.rows },
        _synthesized: true,
      };
      warnings.push('Budget vs Actual: showing data reconstructed from the raw Budget entity + Profit and Loss report instead, since the standard report endpoint failed above.');
    }
    const accounts = await fetchQboJson('Account balances', client.accounts(), warnings);
    // Board-level "Church Report": one P&L column per calendar year over a 5-year trailing
    // window (matches the app's existing 5-year convention, e.g. AT6's multi-year attendance
    // comparison). No Budget setup required — P&L is actuals-only.
    const PNL_YEARS_BACK = 4;
    const profitAndLoss = await fetchQboJson(
      'Profit & Loss (multi-year)',
      client.profitAndLoss({ start_date: `${year - PNL_YEARS_BACK}-01-01`, end_date: `${year}-12-31`, summarize_column_by: 'Year' }),
      warnings
    );
    // Monthly granularity, current + prior year ONLY (not the full 5-year window, to bound sync/
    // storage cost) — this is what makes the This Year view's YoY-to-date comparison and
    // year-end projection possible; annual-only rows can't support a same-period comparison.
    const profitAndLossMonthly = await fetchQboJson(
      'Profit & Loss (monthly, current + prior year)',
      client.profitAndLoss({ start_date: `${year - 1}-01-01`, end_date: `${year}-12-31`, summarize_column_by: 'Month' }),
      warnings
    );
    const syncedAt = new Date().toISOString();
    const ops = [];
    if (budgetVsActual) ops.push(db.prepare(
      `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('budget_vs_actual',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
    ).bind(JSON.stringify(budgetVsActual), syncedAt));
    if (accounts) ops.push(db.prepare(
      `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('accounts',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
    ).bind(JSON.stringify(accounts), syncedAt));
    if (ops.length) await db.batch(ops);

    // ── Persist into finance_church_entries ────────────────────────────
    // Order matters: multi-year (actuals-only) rows are flattened FIRST, then the current-year
    // budget-merge rows SECOND, so the richer current-year row's ON CONFLICT DO UPDATE
    // overwrites whatever the multi-year pass just wrote for that same year — see
    // migrations/0018_finance_church_entries.sql for the full design rationale.
    const churchRows = [];
    if (profitAndLoss && profitAndLoss.Rows) {
      const cols = (profitAndLoss.Columns && profitAndLoss.Columns.Column) || [];
      const colYears = cols.map(c => { const m = /(\d{4})/.exec(c.ColTitle || ''); return m ? parseInt(m[1], 10) : null; });
      flattenReportTree(profitAndLoss.Rows.Row, [], null, makeMultiYearExtractor(colYears), churchRows);
    }
    if (currentYearMerge) {
      flattenReportTree(currentYearMerge.rows, [], null, makeCurrentYearExtractor(year), churchRows);
    }
    // Monthly rows use period_month 1-12 (vs. 0 for the annual rows above), so they don't
    // collide in the UNIQUE(fiscal_year, period_month, category_path, source) constraint —
    // order relative to the annual flattens above doesn't matter for that reason.
    if (profitAndLossMonthly && profitAndLossMonthly.Rows) {
      const monthCols = (profitAndLossMonthly.Columns && profitAndLossMonthly.Columns.Column) || [];
      const colPeriods = monthCols.map(c => parseMonthColTitle(c.ColTitle || ''));
      flattenReportTree(profitAndLossMonthly.Rows.Row, [], null, makeMonthlyExtractor(colPeriods), churchRows);
    }
    await persistChurchEntries(db, churchRows, syncedAt);

    await db.prepare('UPDATE finance_qb_connection SET last_synced_at=? WHERE id=1').bind(syncedAt).run();
    return json({ ok: true, syncedAt, warnings, fetched: { budgetVsActual: !!budgetVsActual, accounts: !!accounts, profitAndLoss: !!profitAndLoss, profitAndLossMonthly: !!profitAndLossMonthly }, churchEntriesSynced: churchRows.length });
  }

  // ── Overview: cached QBO data + daycare summary, for the Finance tab ──
  if (seg === 'finance/overview' && method === 'GET') {
    const conn = await getConnection(db);
    const snapRows = (await db.prepare('SELECT key,value,synced_at FROM finance_qb_snapshot').all()).results || [];
    const snaps = {};
    for (const s of snapRows) { try { snaps[s.key] = { data: JSON.parse(s.value), syncedAt: s.synced_at }; } catch { /* skip corrupt cache row */ } }
    return json({
      connected: !!(conn && conn.realm_id),
      companyName: conn?.company_name || '',
      lastSyncedAt: conn?.last_synced_at || '',
      budgetVsActual: snaps.budget_vs_actual?.data || null,
      budgetSyncedAt: snaps.budget_vs_actual?.syncedAt || '',
      accounts: snaps.accounts?.data || null,
      accountsSyncedAt: snaps.accounts?.syncedAt || '',
      daycareAccounts: snaps.daycare_accounts?.data || null,
      daycareAccountsSyncedAt: snaps.daycare_accounts?.syncedAt || '',
    });
  }

  // ── Daycare — pull from the daycare app's finance API, if configured ──
  // Wholesale-replaces only source='daycare_api' rows for the periods present in the
  // response, leaving any hand-entered ('manual') rows untouched — see SECRETS.md for the
  // response contract the daycare app's /api/finance/summary endpoint must implement.
  if (seg === 'finance/daycare/sync' && method === 'POST') {
    const client = makeDaycareClient(env);
    if (!client) return json({ error: 'The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).' }, 503);
    let res;
    try { res = await client.summary(); }
    catch (e) { return json({ error: 'Could not reach the daycare app: ' + e.message }, 502); }
    if (!res.ok) return json({ error: `Daycare app returned HTTP ${res.status}` }, 502);
    let data; try { data = await res.json(); } catch { return json({ error: 'Daycare app returned invalid JSON' }, 502); }
    const rows = Array.isArray(data.budget) ? data.budget : [];
    const periods = [...new Set(rows.map(r => r.period).filter(p => /^\d{4}-\d{2}$/.test(p)))];
    const ops = [];
    if (periods.length) {
      const placeholders = periods.map(() => '?').join(',');
      ops.push(db.prepare(`DELETE FROM finance_daycare_entries WHERE source='daycare_api' AND period IN (${placeholders})`).bind(...periods));
    }
    let imported = 0;
    for (const r of rows) {
      if (!/^\d{4}-\d{2}$/.test(r.period) || !r.category || (r.type !== 'actual' && r.type !== 'budget')) continue;
      const cents = Math.round(Number(r.amount_cents));
      if (!Number.isFinite(cents)) continue;
      ops.push(db.prepare(
        `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,source) VALUES (?,?,?,?,'daycare_api')`
      ).bind(r.period, String(r.category).trim(), r.type, cents));
      imported++;
    }
    if (ops.length) await db.batch(ops);
    const syncedAt = new Date().toISOString();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('daycare_last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(syncedAt).run();
    // Cache accounts too, alongside the QBO ones, so the balances table can show both.
    if (Array.isArray(data.accounts)) {
      await db.prepare(
        `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('daycare_accounts',?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
      ).bind(JSON.stringify(data.accounts), syncedAt).run();
    }
    return json({ ok: true, syncedAt, imported, periods });
  }

  // ── Daycare — manual entries (no known API/export yet) ────────────────
  if (seg === 'finance/daycare' && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM finance_daycare_entries ORDER BY period DESC, category ASC, id DESC').all()).results || [];
    return json({ entries: rows });
  }

  // ── Daycare from an already-imported Church Budget year ──────────────────────────────────
  // Preview step: no DB write. Reads finance_church_entries for the requested year (source-
  // precedence resolved, same as the Church Report views), extracts MDO-tagged accounts, and
  // returns the per-category actual/budget totals for review before commit.
  if (seg === 'finance/daycare/church-budget-preview' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10);
    if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
    const rows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=?').bind(year).all()).results || [];
    if (!rows.length) return json({ error: `No imported Church Budget found for ${year} — import that year's Budget vs. Actuals first (Church Report → Import Budget).` }, 400);
    const resolved = resolveChurchYearPrecedence(rows);
    const entries = extractMdoDaycareEntries(resolved, year);
    if (!entries.length) return json({ year, found: 0, by_category: {}, entries: [] });
    const byCategory = {};
    for (const e of entries) {
      if (!byCategory[e.category]) byCategory[e.category] = { actual_cents: 0, budget_cents: 0 };
      byCategory[e.category][e.entry_type === 'actual' ? 'actual_cents' : 'budget_cents'] += e.amount_cents;
    }
    return json({ year, found: entries.length, by_category: byCategory, entries });
  }

  // Commit step: same extraction, then wholesale-replace this year's church_budget_import rows.
  if (seg === 'finance/daycare/church-budget-import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const year = parseInt(b.year, 10);
    if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
    const rows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=?').bind(year).all()).results || [];
    if (!rows.length) return json({ error: `No imported Church Budget found for ${year}.` }, 400);
    const resolved = resolveChurchYearPrecedence(rows);
    const entries = extractMdoDaycareEntries(resolved, year);
    if (!entries.length) return json({ error: `No MDO-tagged accounts found in the imported budget for ${year}.` }, 400);
    await persistDaycareEntriesFromChurchBudget(db, entries, year);
    return json({ ok: true, year, imported: entries.length });
  }

  if (seg === 'finance/daycare' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.period || !/^\d{4}(-\d{2})?$/.test(b.period)) return json({ error: 'Period must be YYYY or YYYY-MM' }, 400);
    if (!b.category || !String(b.category).trim()) return json({ error: 'Category is required' }, 400);
    const amountCents = Math.round(Number(b.amount_cents));
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    const entryType = b.entry_type === 'budget' ? 'budget' : 'actual';
    const r = await db.prepare(
      `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes) VALUES (?,?,?,?,?)`
    ).bind(b.period, String(b.category).trim(), entryType, amountCents, b.notes || '').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  // Bulk-enter past years — a paste-in alternative to the one-row-at-a-time form above, since
  // the daycare app has no historical API (see FIN3) and past years must be hand-entered.
  if (seg === 'finance/daycare/bulk' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const ops = [];
    for (const r of rows) {
      if (!r.period || !/^\d{4}(-\d{2})?$/.test(r.period)) return json({ error: `Invalid period: ${r.period}` }, 400);
      if (!r.category || !String(r.category).trim()) return json({ error: 'Category is required for every row' }, 400);
      const amountCents = Math.round(Number(r.amount_cents));
      if (!Number.isFinite(amountCents)) return json({ error: `Invalid amount for ${r.period} / ${r.category}` }, 400);
      const entryType = r.entry_type === 'budget' ? 'budget' : 'actual';
      ops.push(db.prepare(
        `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes) VALUES (?,?,?,?,?)`
      ).bind(r.period, String(r.category).trim(), entryType, amountCents, r.notes || ''));
    }
    await db.batch(ops);
    return json({ ok: true, imported: ops.length });
  }

  const dcMatch = seg.match(/^finance\/daycare\/(\d+)$/);
  if (dcMatch && method === 'PUT') {
    const id = parseInt(dcMatch[1], 10);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const existing = await db.prepare('SELECT * FROM finance_daycare_entries WHERE id=?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    if (b.period !== undefined && !/^\d{4}(-\d{2})?$/.test(b.period)) return json({ error: 'Period must be YYYY or YYYY-MM' }, 400);
    const amountCents = b.amount_cents !== undefined ? Math.round(Number(b.amount_cents)) : existing.amount_cents;
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    await db.prepare(
      `UPDATE finance_daycare_entries SET period=?, category=?, entry_type=?, amount_cents=?, notes=? WHERE id=?`
    ).bind(
      b.period ?? existing.period,
      b.category !== undefined ? String(b.category).trim() : existing.category,
      b.entry_type === 'budget' ? 'budget' : (b.entry_type === 'actual' ? 'actual' : existing.entry_type),
      amountCents, b.notes ?? existing.notes, id
    ).run();
    return json({ ok: true });
  }
  if (dcMatch && method === 'DELETE') {
    await db.prepare('DELETE FROM finance_daycare_entries WHERE id=?').bind(parseInt(dcMatch[1], 10)).run();
    return json({ ok: true });
  }

  // ── Church Report v2: This Year — persisted-table read, no live QuickBooks call ────────
  if (seg === 'finance/church/this-year' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const allRows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
    const entries = resolveChurchYearPrecedence(allRows);
    const summary = computeYearSummary(entries);
    const givingByFundRows = (await db.prepare(
      `SELECT f.name AS fund_name, COALESCE(SUM(ge.amount),0) AS total
       FROM giving_entries ge JOIN funds f ON f.id = ge.fund_id
       WHERE ge.contribution_date BETWEEN ? AND ?
       GROUP BY ge.fund_id ORDER BY total DESC`
    ).bind(`${year}-01-01`, `${year}-12-31`).all()).results || [];
    const givingByFund = givingByFundRows.map(r => ({ fundName: r.fund_name, cents: r.total || 0 }));
    const givingCents = givingByFund.reduce((sum, r) => sum + r.cents, 0);

    // YoY-to-date + year-end projection — only meaningful for the current year (a past year's
    // "as of today" comparison doesn't mean anything); needs monthly-granularity rows, which the
    // sync only populates for current + prior year (see the sync handler below).
    const now = new Date();
    let yoy = { available: false };
    let supplies = { monthly: [], currentYtdCents: 0, priorYtdCents: 0 };
    let monthlyTrend = { available: false, months: [] };
    if (year === now.getFullYear()) {
      const throughMonth = now.getMonth() + 1;
      const monthlyRows = (await db.prepare(
        `SELECT * FROM finance_church_entries WHERE source='qbo_sync' AND period_month BETWEEN 1 AND 12 AND fiscal_year IN (?,?)`
      ).bind(year, year - 1).all()).results || [];
      const curMonthly = monthlyRows.filter(r => r.fiscal_year === year && r.period_month <= throughMonth);
      const priorMonthly = monthlyRows.filter(r => r.fiscal_year === year - 1 && r.period_month <= throughMonth);
      const priorAnnualRows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=?').bind(year - 1).all()).results || [];
      yoy = computeYtdComparison(curMonthly, priorMonthly, priorAnnualRows, throughMonth);
      // Uses the full (uncapped) monthly rows, not the throughMonth-filtered slices above —
      // a month-by-month supplies chart is more useful showing all synced months than being
      // clipped to "so far this year" like the YTD projection needs to be.
      supplies = computeSuppliesMonthlyBreakdown(
        monthlyRows.filter(r => r.fiscal_year === year),
        monthlyRows.filter(r => r.fiscal_year === year - 1)
      );
      monthlyTrend = computeIncomeExpenseMonthlyTrend(monthlyRows.filter(r => r.fiscal_year === year), throughMonth, summary);
    }

    return json({
      year,
      entries,
      ...summary,
      givingCents,
      givingByFund,
      monthlyTrend,
      yoy,
      supplies,
    });
  }

  // ── Church Report v2: Multi-Year — persisted-table read, one bulk query + JS grouping ──
  if (seg === 'finance/church/multi-year' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    const currentYear = new Date().getFullYear();
    const years = yearsParam
      ? yearsParam.split(',').map(y => parseInt(y, 10)).filter(Number.isFinite)
      : [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
    if (!years.length) return json({ error: 'No valid years requested' }, 400);
    const placeholders = years.map(() => '?').join(',');
    const allRows = (await db.prepare(`SELECT * FROM finance_church_entries WHERE fiscal_year IN (${placeholders}) AND period_month=0`).bind(...years).all()).results || [];
    const resolved = resolveChurchYearPrecedence(allRows);
    const byYear = {};
    years.forEach(y => { byYear[y] = computeYearSummary(resolved.filter(r => r.fiscal_year === y)); });
    return json({ years, byYear });
  }

  // ── Church Report v2: Budget import (backfill/resilience path when live QuickBooks sync
  // isn't available — see FIN2 — or to correct a bad sync) ─────────────────────────────────
  // Preview step: parse the uploaded "Budget vs. Actuals" .xlsx server-side and return the flat
  // rows for review — no DB write yet. The file never needs to round-trip through the browser
  // beyond the initial upload; the frontend renders a checkbox-per-row preview (same
  // pattern as Tuition Aid's TAP10 import) and only the checked rows get sent to the commit
  // step below.
  if (seg === 'finance/church/import-preview' && method === 'POST') {
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    const sheet = findBudgetVsActualsSheet(sheets);
    if (!sheet) return json({ error: 'Could not find a "Budget vs. Actuals" sheet (a sheet with Actual/Budget columns) in this file.' }, 400);
    let parsed;
    try { parsed = parseBudgetVsActualsGrid(sheet.grid); }
    catch (e) { return json({ error: e.message }, 400); }
    if (!parsed.fiscalYear) return json({ error: 'Could not determine the fiscal year from this sheet — expected a date-range line like "January - December 2026" above the header row.' }, 400);
    return json({ sheetName: sheet.name, fiscalYear: parsed.fiscalYear, rows: parsed.rows, skipped: parsed.skipped });
  }

  // Commit step: persist the (possibly-filtered, per the preview's checkboxes) rows for one
  // fiscal year — wholesale-replaces any existing source='import' rows for that year only.
  if (seg === 'finance/church/import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const fiscalYear = parseInt(b.fiscal_year, 10);
    if (!Number.isFinite(fiscalYear)) return json({ error: 'fiscal_year is required' }, 400);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number'
      || !Number.isFinite(r.own_actual_cents) || !Number.isFinite(r.own_budget_cents));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    await persistChurchEntriesImport(db, rows, fiscalYear, new Date().toISOString());
    return json({ ok: true, fiscalYear, imported: rows.length });
  }

  // ── Church Report: Balance Sheet / Statement of Financial Position import ───────────────────
  // Same preview-then-commit shape as the Budget import above; a separate parser/table since a
  // balance sheet is a fundamentally different report (point-in-time Assets/Liabilities/Equity,
  // no actual-vs-budget split) — see migrations/0019_finance_church_balances.sql.
  if (seg === 'finance/church/balances/import-preview' && method === 'POST') {
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    const sheet = findBalanceSheetSheet(sheets);
    if (!sheet) return json({ error: 'Could not find a Balance Sheet / Statement of Financial Position sheet in this file.' }, 400);
    let parsed;
    try { parsed = parseBalanceSheetGrid(sheet.grid, sheet.colAIndent); }
    catch (e) { return json({ error: e.message }, 400); }
    if (!parsed.fiscalYear) return json({ error: 'Could not determine the fiscal year from this sheet — expected an "As of ..." date line above the header row.' }, 400);
    return json({ sheetName: sheet.name, fiscalYear: parsed.fiscalYear, asOfDate: parsed.asOfDate, rows: parsed.rows, skipped: parsed.skipped });
  }

  if (seg === 'finance/church/balances/import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const fiscalYear = parseInt(b.fiscal_year, 10);
    if (!Number.isFinite(fiscalYear)) return json({ error: 'fiscal_year is required' }, 400);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number' || !Number.isFinite(r.own_balance_cents));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    await persistChurchBalancesImport(db, rows, fiscalYear, String(b.as_of_date || ''), new Date().toISOString());
    return json({ ok: true, fiscalYear, imported: rows.length });
  }

  // Read: the latest imported balance sheet for a given year (defaults to current year) — a
  // fresh import for the same year wholesale-replaces the prior one, so there's only ever one.
  if (seg === 'finance/church/balances' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const rows = (await db.prepare('SELECT * FROM finance_church_balances WHERE fiscal_year=? ORDER BY category_path').bind(year).all()).results || [];
    if (!rows.length) return json({ year, rows: [], summary: null, asOfDate: '' });
    return json({ year, rows, summary: computeBalanceSummary(rows), asOfDate: rows[0].as_of_date || '' });
  }

  // Multi-year trend: one bulk query + JS grouping (matches this app's existing performance
  // conventions, same pattern as finance/church/multi-year for the Income Statement side).
  if (seg === 'finance/church/balances/multi-year' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    const currentYear = new Date().getFullYear();
    const years = yearsParam
      ? yearsParam.split(',').map(y => parseInt(y, 10)).filter(Number.isFinite)
      : [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
    if (!years.length) return json({ error: 'No valid years requested' }, 400);
    const placeholders = years.map(() => '?').join(',');
    const allRows = (await db.prepare(`SELECT * FROM finance_church_balances WHERE fiscal_year IN (${placeholders})`).bind(...years).all()).results || [];
    const byYear = {};
    years.forEach(y => { byYear[y] = computeBalanceSummary(allRows.filter(r => r.fiscal_year === y)); });
    return json({ years, byYear });
  }

  // ── Church Budget Planning — forward multi-year what-if planning (Property Expenses,
  // Salaries & Benefits, Utilities, Insurance, or any freeform category), independent of any
  // QuickBooks import/sync. A plan can be "committed" into a future fiscal year's real budget
  // (finance_church_entries, source='plan_committed') — resolveChurchYearPrecedence() ranks that
  // source lowest, so it's a placeholder only until real synced/imported data exists. ──────────
  if (seg === 'finance/planning/church' && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM finance_budget_plan ORDER BY category ASC, fiscal_year ASC').all()).results || [];
    return json({ rows });
  }

  // Generates a plan row for EVERY real account line in a base year's resolved Church Budget
  // (same rows Church Report itself shows — category_path is used as the plan's category key,
  // so the planner always mirrors the real chart of accounts instead of a hand-typed list).
  // base amount = that account's own actual for the base year, falling back to its own budget
  // if there's no actual yet (e.g. a mid-year base year); accounts with neither are skipped —
  // there's nothing real to grow from. A single flat growth rate applies to every line; use
  // override-bulk afterward to hand-correct individual lines (e.g. Salary & Benefits).
  if (seg === 'finance/planning/church/generate-all' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const baseYear = parseInt(b.base_year, 10);
    const targetYear = parseInt(b.target_year, 10);
    const growthPct = Number(b.growth_pct);
    if (!Number.isFinite(baseYear) || !Number.isFinite(targetYear)) return json({ error: 'base_year and target_year are required' }, 400);
    if (!Number.isFinite(growthPct)) return json({ error: 'Invalid growth_pct' }, 400);
    // period_month=0 = the annual row (see migrations/0018_finance_church_entries.sql) — must
    // filter it explicitly, since monthly rows (period_month 1-12) share the same source and
    // fiscal_year, and would otherwise let a single month's figure silently clobber the true
    // annual total for that category via the ON CONFLICT upsert below.
    const baseRows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(baseYear).all()).results || [];
    if (!baseRows.length) return json({ error: `No Church Budget data found for ${baseYear} — sync or import that year first.` }, 400);
    const resolved = resolveChurchYearPrecedence(baseRows);
    // If the base year is still in progress (its own actual is really a year-to-date figure, not
    // a completed year), annualize it before applying the growth rate — otherwise a mid-year
    // actual would be projected forward as if it were the whole year's total. A past, complete
    // base year (or one with no actual at all, only a budget) is used as-is. through_month is an
    // optional explicit override (real caller never sends it — only tests, for determinism);
    // production always falls back to the real current month for the real current year.
    const now = new Date();
    const explicitThroughMonth = parseInt(b.through_month, 10);
    const throughMonth = Number.isFinite(explicitThroughMonth) ? explicitThroughMonth
      : (baseYear === now.getFullYear()) ? (now.getMonth() + 1) : 12;
    const prorated = throughMonth < 12;
    const ops = [];
    let generated = 0;
    for (const r of resolved) {
      const baseAmountCents = (r.own_actual_cents && prorated)
        ? Math.round(r.own_actual_cents * (12 / throughMonth))
        : (r.own_actual_cents || r.own_budget_cents || 0);
      if (!baseAmountCents) continue;
      const plannedCents = Math.round(baseAmountCents * (1 + growthPct));
      ops.push(db.prepare(
        `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,growth_pct,base_amount_cents,notes,updated_at)
         VALUES (?,?,?,?,'grown',?,?,?,datetime('now'))
         ON CONFLICT(category,fiscal_year) DO UPDATE SET
           classification=excluded.classification, planned_amount_cents=excluded.planned_amount_cents, basis='grown',
           growth_pct=excluded.growth_pct, base_amount_cents=excluded.base_amount_cents, notes=excluded.notes, updated_at=excluded.updated_at`
      ).bind(r.category_path, r.classification, targetYear, plannedCents, growthPct, baseAmountCents, r.account_name));
      generated++;
    }
    if (!ops.length) return json({ error: `No account had an actual or budget figure in ${baseYear} to grow from.` }, 400);
    await db.batch(ops);
    return json({ ok: true, generated, baseYear, targetYear, throughMonth, prorated });
  }

  // Bulk manual save — commits a whole edited table of Projected values in one round trip
  // (each row keeps its own fiscal_year, e.g. all rows for the same target year), rather than
  // one request per edited line.
  if (seg === 'finance/planning/church/override-bulk' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to save' }, 400);
    const ops = [];
    for (const r of rows) {
      const category = String(r.category || '').trim();
      const fiscalYear = parseInt(r.fiscal_year, 10);
      if (!category || !Number.isFinite(fiscalYear)) return json({ error: 'Every row needs a category and fiscal_year' }, 400);
      const amountCents = Math.round(Number(r.planned_amount) * 100);
      if (!Number.isFinite(amountCents)) return json({ error: `Invalid amount for ${category}` }, 400);
      ops.push(db.prepare(
        `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,notes,updated_at)
         VALUES (?,?,?,?,'manual',?,datetime('now'))
         ON CONFLICT(category,fiscal_year) DO UPDATE SET
           classification=excluded.classification, planned_amount_cents=excluded.planned_amount_cents, basis='manual',
           growth_pct=NULL, base_amount_cents=NULL, notes=excluded.notes, updated_at=excluded.updated_at`
      ).bind(category, r.classification || 'Expenses', fiscalYear, amountCents, r.notes || ''));
    }
    await db.batch(ops);
    return json({ ok: true, saved: ops.length });
  }

  // Salary & Benefits Calculator + Health Insurance card state (worker roster, COLA/pension
  // settings, benefits figure, selected health plan option) — persisted as one JSON blob in the
  // generic chms_config key/value table, same pattern as the Commercial Property meta and other
  // small nested-settings blobs elsewhere in this file. Not fiscal-year-scoped (the roster is a
  // standing list of current staff, not a per-year plan), so it's read once and reused across
  // whatever base/target year the admin is currently viewing.
  if (seg === 'finance/planning/salary' && method === 'GET') {
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_salary_planner'").first();
    let data = null;
    if (row) { try { data = JSON.parse(row.value); } catch { data = null; } }
    return json({ data });
  }
  if (seg === 'finance/planning/salary' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing the salary planner requires admin access' }, 403);
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'Invalid payload' }, 400);
    if (b.roster !== undefined && !Array.isArray(b.roster)) return json({ error: 'roster must be an array' }, 400);
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_salary_planner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify(b)).run();
    return json({ ok: true });
  }

  // Generates a compounding multi-year projection from a base dollar amount + a flat growth
  // rate, upserting one row per target year (basis='grown'). A later manual override on any of
  // those years replaces just that year's row (basis='manual') without touching the others.
  if (seg === 'finance/planning/church/generate' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const category = String(b.category || '').trim();
    if (!category) return json({ error: 'category is required' }, 400);
    const classification = b.classification || 'Expenses';
    const baseAmountCents = Math.round(Number(b.base_amount) * 100);
    if (!Number.isFinite(baseAmountCents)) return json({ error: 'Invalid base_amount' }, 400);
    const growthPct = Number(b.growth_pct);
    if (!Number.isFinite(growthPct)) return json({ error: 'Invalid growth_pct' }, 400);
    const targetYears = Array.isArray(b.target_years) ? b.target_years.map(y => parseInt(y, 10)).filter(Number.isFinite) : [];
    if (!targetYears.length) return json({ error: 'target_years is required' }, 400);
    const ops = targetYears.map((year, i) => {
      const cents = Math.round(baseAmountCents * Math.pow(1 + growthPct, i + 1));
      return db.prepare(
        `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,growth_pct,base_amount_cents,notes,updated_at)
         VALUES (?,?,?,?,'grown',?,?,?,datetime('now'))
         ON CONFLICT(category,fiscal_year) DO UPDATE SET
           classification=excluded.classification, planned_amount_cents=excluded.planned_amount_cents, basis=excluded.basis,
           growth_pct=excluded.growth_pct, base_amount_cents=excluded.base_amount_cents, notes=excluded.notes, updated_at=excluded.updated_at`
      ).bind(category, classification, year, cents, growthPct, baseAmountCents, b.notes || '');
    });
    await db.batch(ops);
    return json({ ok: true, years: targetYears });
  }

  // Manual override for a single category/year — always wins over whatever finance/planning/
  // church/generate previously computed for that one year.
  if (seg === 'finance/planning/church/override' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const category = String(b.category || '').trim();
    const fiscalYear = parseInt(b.fiscal_year, 10);
    if (!category || !Number.isFinite(fiscalYear)) return json({ error: 'category and fiscal_year are required' }, 400);
    const amountCents = Math.round(Number(b.planned_amount) * 100);
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid planned_amount' }, 400);
    await db.prepare(
      `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,notes,updated_at)
       VALUES (?,?,?,?,'manual',?,datetime('now'))
       ON CONFLICT(category,fiscal_year) DO UPDATE SET
         classification=excluded.classification, planned_amount_cents=excluded.planned_amount_cents, basis='manual',
         growth_pct=NULL, base_amount_cents=NULL, notes=excluded.notes, updated_at=excluded.updated_at`
    ).bind(category, b.classification || 'Expenses', fiscalYear, amountCents, b.notes || '').run();
    return json({ ok: true });
  }

  const planDeleteMatch = seg.match(/^finance\/planning\/church\/([^/]+)\/(\d{4})$/);
  if (planDeleteMatch && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);
    await db.prepare('DELETE FROM finance_budget_plan WHERE category=? AND fiscal_year=?')
      .bind(decodeURIComponent(planDeleteMatch[1]), parseInt(planDeleteMatch[2], 10)).run();
    return json({ ok: true });
  }

  // Commits every planned category for one fiscal year into finance_church_entries as a
  // placeholder budget (source='plan_committed', own_actual_cents=0 — there's no actual yet,
  // that's the whole point). Wholesale-replaces prior plan_committed rows for that year only, so
  // re-committing after editing the plan doesn't leave stale categories behind.
  if (seg === 'finance/planning/church/commit' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: committing a budget plan requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const fiscalYear = parseInt(b.fiscal_year, 10);
    if (!Number.isFinite(fiscalYear)) return json({ error: 'fiscal_year is required' }, 400);
    const planRows = (await db.prepare('SELECT * FROM finance_budget_plan WHERE fiscal_year=?').bind(fiscalYear).all()).results || [];
    if (!planRows.length) return json({ error: `No plan rows exist for ${fiscalYear}` }, 400);
    const syncedAt = new Date().toISOString();
    const ops = [db.prepare(`DELETE FROM finance_church_entries WHERE source='plan_committed' AND fiscal_year=?`).bind(fiscalYear)];
    for (const r of planRows) {
      ops.push(db.prepare(
        `INSERT INTO finance_church_entries
           (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
         VALUES (?,0,?,?,?,0,0,0,?,'plan_committed',?)`
      ).bind(fiscalYear, r.classification, r.category, r.category, r.planned_amount_cents, syncedAt));
    }
    await db.batch(ops);
    return json({ ok: true, fiscalYear, committed: planRows.length });
  }

  // ── Board Packet export — a single clean JSON snapshot of the numbers a board would need for
  // a monthly finance summary, meant to be handed to a separate Claude session (or any other
  // analyst) to write the actual narrative: this endpoint deliberately does no anomaly detection
  // or commentary itself, just bundles already-computed figures (reusing the exact same pure
  // functions the This Year/Multi-Year/Balance Sheet views render from, so the packet can never
  // disagree with what's on screen) plus 5 years of trend context and the full raw daycare
  // ledger, so nothing needs a second export to answer a follow-up question.
  if (seg === 'finance/board-packet' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const trendYears = [year - 4, year - 3, year - 2, year - 1, year];
    const trendPlaceholders = trendYears.map(() => '?').join(',');

    const thisYearEntriesRaw = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
    const thisYearEntries = resolveChurchYearPrecedence(thisYearEntriesRaw);
    const thisYearSummary = computeYearSummary(thisYearEntries);
    const givingByFundRows = (await db.prepare(
      `SELECT f.name AS fund_name, COALESCE(SUM(ge.amount),0) AS total
       FROM giving_entries ge JOIN funds f ON f.id = ge.fund_id
       WHERE ge.contribution_date BETWEEN ? AND ?
       GROUP BY ge.fund_id ORDER BY total DESC`
    ).bind(`${year}-01-01`, `${year}-12-31`).all()).results || [];
    const givingByFund = givingByFundRows.map(r => ({ fundName: r.fund_name, cents: r.total || 0 }));
    const givingCents = givingByFund.reduce((sum, r) => sum + r.cents, 0);

    const trendIncomeRows = (await db.prepare(`SELECT * FROM finance_church_entries WHERE fiscal_year IN (${trendPlaceholders}) AND period_month=0`).bind(...trendYears).all()).results || [];
    const trendIncomeResolved = resolveChurchYearPrecedence(trendIncomeRows);
    const incomeStatementByYear = {};
    trendYears.forEach(y => { incomeStatementByYear[y] = computeYearSummary(trendIncomeResolved.filter(r => r.fiscal_year === y)); });

    const balanceRows = (await db.prepare('SELECT * FROM finance_church_balances WHERE fiscal_year=? ORDER BY category_path').bind(year).all()).results || [];
    const balanceSheet = balanceRows.length
      ? { asOfDate: balanceRows[0].as_of_date || '', rows: balanceRows, summary: computeBalanceSummary(balanceRows) }
      : { asOfDate: '', rows: [], summary: null };

    const trendBalanceRows = (await db.prepare(`SELECT * FROM finance_church_balances WHERE fiscal_year IN (${trendPlaceholders})`).bind(...trendYears).all()).results || [];
    const balanceSheetByYear = {};
    trendYears.forEach(y => {
      const rowsY = trendBalanceRows.filter(r => r.fiscal_year === y);
      balanceSheetByYear[y] = rowsY.length ? computeBalanceSummary(rowsY) : null;
    });

    const daycareEntries = (await db.prepare(
      'SELECT period, category, entry_type, amount_cents, notes, source FROM finance_daycare_entries ORDER BY period ASC, category ASC'
    ).all()).results || [];

    return json({
      generated_at: new Date().toISOString(),
      year,
      church: {
        income_statement_this_year: { year, ...thisYearSummary, giving_reference_cents: givingCents, giving_by_fund: givingByFund, accounts: thisYearEntries },
        income_statement_5yr_trend: { years: trendYears, by_year: incomeStatementByYear },
        balance_sheet_this_year: { year, ...balanceSheet },
        balance_sheet_5yr_trend: { years: trendYears, by_year: balanceSheetByYear },
      },
      daycare: { entries: daycareEntries },
    });
  }

  return null;
}
