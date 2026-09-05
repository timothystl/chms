// ── Finance Overview API handlers ──────────────────────────────────────────
// Finance-only feature (gated in api-chms.js, same as Tuition Aid). Unifies:
//  (1) QuickBooks Online — Budget vs Actual + account balances, via a real OAuth connection
//  (2) Daycare — manual entries, since the daycare app has no known export/API yet
// QBO amounts are kept as QBO returns them (decimal dollars) rather than converted to this
// app's integer-cents convention — they're display-only, never combined arithmetically with
// giving_entries/tuition figures.
import { json } from './auth.js';
import { resolveGeneralFundIds, resolveGeneralFundBudget } from './api-utils.js';
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
  const acctId = cells[0]?.id;
  const actual = Number(cells[cells.length - 1]?.value);
  const actualAmt = Number.isFinite(actual) ? actual : 0;
  let budgetAmt = 0;
  // Prefer matching by QuickBooks' own account id when the report cell carries one (the
  // Reports API's standard behavior for an account-labeled column) — exact and unambiguous,
  // unlike name matching, which silently fails whenever the P&L report's display label for an
  // account doesn't byte-for-byte match the Budget entity's AccountRef.name (a real, observed
  // QuickBooks quirk — reported 2026-07-28 as "budget lines are always 0" while actual still
  // populated correctly from this same tree, which only made sense as a name-match failure
  // since actual never depends on this lookup at all).
  let matchedById = false;
  if (acctId != null && ctx.budgetByAccountId && ctx.budgetByAccountId.has(acctId)) {
    budgetAmt = ctx.budgetByAccountId.get(acctId);
    matchedById = true;
  } else {
    const ids = ctx.budgetIdsByName.get(name);
    if (ids && ids.size > 1) ctx.ambiguousNames.add(name);
    else if (ctx.budgetByName.has(name)) budgetAmt = ctx.budgetByName.get(name);
  }
  // Diagnostic only (see mergeCurrentYearBudgetAndActual's warning) — a real, non-trivial
  // actual amount with zero matched budget is worth surfacing by name so a genuine residual
  // matching gap (id present but not found in the Budget entity at all, or no id and the name
  // didn't match either) can be told apart from "QuickBooks genuinely has no budget for this
  // line" without guessing which case it is.
  if (ctx.unmatched && budgetAmt === 0 && Math.abs(actualAmt) >= 1 && !matchedById) {
    ctx.unmatched.push({ name, actualAmt, hadId: acctId != null });
  }
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
// This company's live QuickBooks report uses "Revenue"/"Expenditures" wording (see
// normalizeChurchClassification's own comment) — which extends to these bottom-line labels
// too: "Net Revenue" instead of "Net Income", "Other Revenue" instead of "Other Income". Both
// checks below were hardcoded to the English "Income" wording only, confirmed live 2026-07-28
// as a real bug: "Net Operating Revenue"/"Net Revenue" showed $0.00 budget in the Budget vs
// Actual table (the combined-budget special case never matched "Net Revenue"), and the
// Other-Income budget thread never activated (folding its budget into the main thread instead).
const FINAL_NET_LABEL_RE = /^Net (Income|Revenue)$/i;
const OTHER_INCOME_SECTION_RE = /^Other (Income|Revenue)$/i;
export function mergeProfitAndLossTree(rows, ctx) {
  let mainBudget = 0, otherBudget = 0, inOtherThread = false;
  return (rows || []).map(row => {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      if (OTHER_INCOME_SECTION_RE.test(label)) inOtherThread = true;
      const { row: newRow, budget } = mergeSection(row, ctx);
      if (inOtherThread) otherBudget += budget; else mainBudget += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row;
    const label = cells[0]?.value || '';
    const actual = Number(cells[cells.length - 1]?.value) || 0;
    const budgetVal = FINAL_NET_LABEL_RE.test(label) ? (mainBudget + otherBudget) : (inOtherThread ? otherBudget : mainBudget);
    return { ColData: [{ value: label }, { value: actual.toFixed(2) }, { value: budgetVal.toFixed(2) }, { value: (actual - budgetVal).toFixed(2) }] };
  });
}

// Rows whose label matches this are QuickBooks' own computed running subtotals (Gross Profit,
// Net Operating Income/Revenue, etc.) rather than a real account — flattenReportTree() skips
// them, since they're always re-derivable from the classification totals at query time. Covers
// both QuickBooks' internal "Income" wording and this company's real report wording ("Revenue").
const RUNNING_SUBTOTAL_LABEL_RE = /^(Gross Profit|Net Operating (Income|Revenue)|Net Other (Income|Revenue)|Net (Income|Revenue))$/i;

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
// `<sheet .../>` is self-closing in most Excel-generated workbooks, but at least one real AHRA
// export (the "Budget Detail" report) instead writes `<sheet ...></sheet>` — a valid XML variant
// the old `[^>]*\/>` regex never matched, silently returning zero sheet names for that file and
// making its upload always fail with "Could not find a Budget Detail sheet." Matching just the
// opening `<sheet ...>` tag (self-closed or not) and reading its attributes handles both forms,
// and also stops assuming `name` comes before `r:id` in the tag.
function finXlsxListSheetNames(workbookXml) {
  const out = [];
  const sheetRe = /<sheet\b([^>]*?)\/?>/g;
  let sm;
  while ((sm = sheetRe.exec(workbookXml))) {
    const nameM = /\bname="([^"]*)"/.exec(sm[1]);
    if (nameM) out.push(finXmlUnescape(nameM[1]));
  }
  return out;
}
function finXlsxFindSheetPath(workbookXml, relsXml, sheetName) {
  const sheetRe = /<sheet\b([^>]*?)\/?>/g;
  let sm, rId = null;
  while ((sm = sheetRe.exec(workbookXml))) {
    const nameM = /\bname="([^"]*)"/.exec(sm[1]);
    const idM = /\br:id="(rId\d+)"/.exec(sm[1]);
    if (nameM && idM && finXmlUnescape(nameM[1]) === sheetName) { rId = idM[1]; break; }
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
  if (!target) return null;
  // Per the OOXML spec a Relationship Target is normally relative to the .rels file's own folder
  // (xl/_rels/ → so "worksheets/sheet1.xml" means "xl/worksheets/sheet1.xml"), but some export
  // tools instead write an absolute path rooted at the zip itself (e.g. "/xl/worksheets/sheet1.xml"
  // — confirmed against a real uploaded file). Blindly prepending "xl/" to an already-absolute
  // target produced a garbage double-prefixed path that matched no real zip entry, silently
  // failing this file's import (and would fail identically for every other importer in this app,
  // not just the ones added alongside this fix).
  return target.startsWith('/') ? target.slice(1) : 'xl/' + target;
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
// A plain (non-summarized) ProfitAndLoss report requested for exactly one year has only 2
// columns (Account, Amount) — unlike makeCurrentYearExtractor, which expects a 3rd Budget
// column from the Budget-entity-merged tree. Used by the per-fiscal-year "Sync Selected Years"
// route (finance/qb/sync-years), which deliberately never touches Budget data — see that route.
export function makeSingleYearActualExtractor(year) {
  return (cells) => [{ fiscal_year: year, own_actual_cents: dollarsToCents(cells[1]?.value), own_budget_cents: null }];
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
      // A top-level Section IS the classification — but this company's live QuickBooks report
      // labels its sections "Revenue"/"Expenditures" (not QuickBooks' internal "Income"/
      // "Expenses"), the same real-world quirk normalizeChurchClassification() already handles
      // for the Excel-import path (see its own comment above). Without this, live-synced rows'
      // classification never matches FIN_CHURCH_CLASS_ORDER's keys client-side, so the Income
      // group silently sorts to the bottom and the Revenue/Earned-Income/Restricted-Income
      // regrouping (finReorganizeChurchTree) never fires for synced data — reported 2026-07-28
      // right after CHURCH_SOURCE_PRIORITY started preferring qbo_sync over a hand-imported
      // file, which is what made the pre-existing gap in this function visible for the first
      // time (the import path was always normalized; the live-sync path never was).
      const newClass = classification || normalizeChurchClassification(label);
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
      if (RUNNING_SUBTOTAL_LABEL_RE.test(label)) continue;
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
// 'other revenue' was missing until a real multi-year Statement of Activity export surfaced it
// (this church's own top-level label for that section, same "Revenue" wording used everywhere
// else) — without it, normalizeChurchClassification() left "Other Revenue" un-mapped to the
// canonical "Other Income" key computeYearSummary() looks up, so Other Revenue silently dropped
// out of netOtherIncome/netIncome entirely (confirmed against real 2021 data: Net Other Revenue
// read as -$478,540.14, the Other Expenses figure alone, instead of the correct -$123,736.37).
const CHURCH_CLASSIFICATION_SYNONYMS = {
  revenue: 'Income', income: 'Income',
  expenditures: 'Expenses', expenses: 'Expenses',
  'cost of goods sold': 'Cost of Goods Sold', cogs: 'Cost of Goods Sold',
  'other income': 'Other Income', 'other revenue': 'Other Income',
  'other expenses': 'Other Expenses', 'other expenditures': 'Other Expenses',
};
export function normalizeChurchClassification(label) {
  const key = (label || '').trim().toLowerCase();
  return CHURCH_CLASSIFICATION_SYNONYMS[key] || (label || '').trim();
}
// Rows matching this are QuickBooks' own computed running subtotals under this report's own
// wording variants (e.g. "Net Operating Revenue" instead of the live-API's "Net Operating
// Income") — never a real account, always skipped (re-derivable at query time, same as
// RUNNING_SUBTOTAL_LABELS above). Collapsed into one Net (Operating |Other )?(Income|Revenue)
// alternation (was 4 separate alternatives) after a real multi-year Statement of Activity export
// surfaced "Net Other Revenue" — a combination the old regex genuinely didn't cover (it only had
// "Net Other Income" and "Net (Income|Revenue)", never their cross product) — this form covers
// every combination without needing to keep enumerating this church's Revenue/Income wording swap.
const IMPORT_SKIP_LABEL_RE = /^(Gross Profit|Net (Operating |Other )?(Income|Revenue))$/i;
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

// ── Church Report: "Profit and Loss by Month" Excel import ───────────────────────────────────
// A genuinely different QuickBooks export from the annual "Budget vs. Actuals" report above:
// one column per month (Jan/Feb/.../Dec) instead of Actual/Budget, and no Budget figures at all
// (own_budget_cents is always null, same as the live monthly sync's makeMonthlyExtractor — see
// FIN2/CONN6-era notes on why monthly data specifically needs its own source: the Overview tab's
// trend/projection cards need period_month 1-12 rows, which the annual import can never produce).
// Reuses the exact same leading-space-indentation tree walk as parseBudgetVsActualsGrid (same
// report family, same export convention from this church's QuickBooks) — only the header
// detection and per-row amount extraction differ (N month columns instead of 2).
export function findMonthlyPnLSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some(r => r && parseMonthColTitle(r[1]) && parseMonthColTitle(r[2]))) return s;
  }
  return null;
}
// Depth detection uses balanceRowDepth()/nextNonBlankRowIndex() — leading-space first, falling
// back to the workbook's own cell-style indent metadata (colAIndent) — NOT indentDepthOf()/
// nextNonBlankLabel(), which read leading spaces only. Confirmed against a real 2019-2026 export
// from this church: that file carries NO leading-space indentation at all, only style metadata, so
// a leading-space-only depth check read every row as depth 0 with no children and silently
// classified all 178 accounts as "skipped" — a successful-looking import of nothing. Same bug and
// same fix as FIN36 applied to parseActivityMultiYearGrid; the leading-space convention that the
// older single-year exports do use still wins when present, so those files are unaffected.
//
// One file may span MANY years (e.g. Jan 2019 - Jul 2026, 91 month columns). Each emitted row
// carries its own fiscal_year from its own column header, and `years`/`monthsByYear` describe the
// full range so callers never have to infer a single year from the first column.
export function parseMonthlyPnLGrid(grid, colAIndent) {
  colAIndent = colAIndent || [];
  const headerIdx = grid.findIndex(r => r && parseMonthColTitle(r[1]) && parseMonthColTitle(r[2]));
  if (headerIdx === -1) throw new Error('Could not find a month-by-month header row (e.g. "Jan 2026", "Feb 2026", ...) in this sheet.');
  const header = grid[headerIdx];
  const monthCols = [];
  for (let c = 1; c < header.length; c++) {
    const p = parseMonthColTitle(header[c]);
    if (p) monthCols.push({ col: c, year: p.year, month: p.month });
  }
  if (!monthCols.length) throw new Error('No month columns found in the header row.');
  const stack = [];
  let classification = null;
  const rows = [], skipped = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] && grid[i][0];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const label = raw.trim();
    if (NOTES_SECTION_RE.test(label)) break;
    if (/^Total\s/i.test(label)) continue;
    if (IMPORT_SKIP_LABEL_RE.test(label)) continue;
    const depth = balanceRowDepth(raw, colAIndent[i]);
    const nextIdx = nextNonBlankRowIndex(grid, i);
    const hasChildren = nextIdx !== -1 && balanceRowDepth(grid[nextIdx][0], colAIndent[nextIdx]) > depth;
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
    const row = grid[i] || [];
    for (const { col, year, month } of monthCols) {
      rows.push(makeFlatRow(path, classification, hasChildren, {
        fiscal_year: year, period_month: month,
        own_actual_cents: dollarsToCents(row[col]), own_budget_cents: null,
      }));
    }
  }
  const monthsByYear = {};
  for (const m of monthCols) {
    if (!monthsByYear[m.year]) monthsByYear[m.year] = [];
    if (!monthsByYear[m.year].includes(m.month)) monthsByYear[m.year].push(m.month);
  }
  const years = Object.keys(monthsByYear).map(Number).sort((a, b) => a - b);
  return { years, monthsByYear, rows, skipped };
}
// Wholesale-replaces source='monthly_import' rows for every fiscal year present in `rows` —
// same re-import-is-idempotent pattern as persistChurchEntriesImport, scoped to period_month
// 1-12 only so it can never touch that function's own annual (period_month=0) rows even though
// they share a fiscal_year.
//
// Each row is stored under ITS OWN r.fiscal_year. This used to bind one caller-supplied
// fiscalYear to every row, which was correct only for a single-year file: a multi-year export
// (Jan 2019 - Jul 2026 is a real one) filed all 91 months under 2019, and since the unique key is
// (fiscal_year, period_month, category_path, source), each successive year's January overwrote the
// last through the ON CONFLICT branch — silently collapsing eight years into one.
//
// Statements are flushed in chunks rather than one giant batch: a full multi-year file is ~17,000
// inserts, far past what a single D1 batch should carry. Deletes go first, as their own batch, so
// a year is always cleared before any of its replacement rows land.
const MONTHLY_IMPORT_BATCH_SIZE = 500;
export async function persistChurchEntriesMonthlyImport(db, rows, importedAt) {
  if (!rows.length) return;
  const years = [...new Set(rows.map(r => r.fiscal_year))];
  await db.batch(years.map(y =>
    db.prepare(`DELETE FROM finance_church_entries WHERE source='monthly_import' AND fiscal_year=? AND period_month BETWEEN 1 AND 12`).bind(y)));
  const ops = rows.map(r => db.prepare(
    `INSERT INTO finance_church_entries
       (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,'monthly_import',?)
     ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
       classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
       has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
       own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
  ).bind(r.fiscal_year, r.period_month, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_actual_cents, r.own_budget_cents, importedAt));
  for (let i = 0; i < ops.length; i += MONTHLY_IMPORT_BATCH_SIZE) {
    await db.batch(ops.slice(i, i + MONTHLY_IMPORT_BATCH_SIZE));
  }
}
// ── Church Report: "Statement of Activity" multi-year Excel import ──────────────────────────
// A nonprofit-terminology export (QuickBooks' "Statement of Activity" = a regular Profit and
// Loss report under a different name — same as the "Statement of Financial Position" wording
// already handled for Balance Sheet imports below) with one column per YEAR instead of the
// annual import's Actual/Budget pair or the monthly import's one-column-per-month — e.g. "2019",
// "2020", ... "2026" spanning many years in a single file, plus an optional trailing partial
// year-to-date column (e.g. "Jan 1 - Jul 28 2026") and a Total column. Depth detection uses
// balanceRowDepth() — the same leading-space-first, cell-style-indent-metadata-fallback
// convention parseBalanceSheetGrid() already established — NOT indentDepthOf()/
// nextNonBlankLabel() (leading-space only): confirmed against real exports from this exact
// church that this report carries NO leading-space indentation at all, only cell-indent style
// metadata, so a leading-space-only depth check reads every row as depth 0 and silently
// classifies the entire sheet as "skipped".
export function parseYearColTitle(title) {
  const t = (title == null ? '' : String(title)).trim();
  const m = /^(19|20)\d{2}$/.exec(t);
  if (m) return parseInt(m[0], 10);
  // A partial year-to-date RANGE column (e.g. "Jan 1 - Jul 28 2026") — requires a date-range
  // dash before the trailing year, specifically so this never collides with a Monthly P&L
  // import's own column titles ("Jan 2026", parsed by parseMonthColTitle instead) — those have
  // no dash, so "Jan 2026" alone still correctly returns null here (see the dedicated test).
  const partial = /[-–].*\b((19|20)\d{2})\s*$/.exec(t);
  return partial ? parseInt(partial[1], 10) : null;
}
function findYearMultiColSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some(r => r && [1, 2].filter(c => parseYearColTitle(r[c]) != null).length >= 2)) return s;
  }
  return null;
}
export function findActivityMultiYearSheet(sheets) { return findYearMultiColSheet(sheets); }
// The user's real multi-year exports carry a substantial trailing free-text notes/commentary
// section (dozens of lines documenting reclassification decisions) below the real data, headed
// by a line starting "NOTES" (e.g. "NOTES ON THIS RESTRUCTURING", "NOTES ON THIS BUDGET
// DOCUMENT") — confirmed against real files, both examples seen. Those lines are indented like
// real accounts (not depth 0), so the ordinary "depth 0 with no children = noise" skip rule can't
// catch them; parsing stops outright the moment this sentinel is seen; whatever data was already
// found survives.
const NOTES_SECTION_RE = /^NOTES\b/i;
// Shared tree walk for the two multi-year Income Statement imports (Statement of Activity =
// actual only; Budget by Year = budget only) — same report family/export convention as each
// other, confirmed against real files to use QuickBooks' cell-style indent metadata (not literal
// leading spaces the way the single-file Budget vs. Actuals/Monthly P&L exports do), so this
// reuses balanceRowDepth/nextNonBlankRowIndex (built for the Balance Sheet import) rather than
// indentDepthOf/nextNonBlankLabel. `field` is 'actual' or 'budget' — only that one field is
// populated per row; the other importer supplies the rest when both files are uploaded (see
// persistChurchEntriesActivityImport's field-preserving upsert, which is why these two importers
// don't need to be combined into one file).
function parseIncomeStatementMultiYearGrid(grid, colAIndent, field) {
  colAIndent = colAIndent || [];
  const headerIdx = grid.findIndex(r => r && [1, 2].filter(c => parseYearColTitle(r[c]) != null).length >= 2);
  if (headerIdx === -1) throw new Error('Could not find a year-by-year header row (e.g. "2019", "2020", ...) in this sheet.');
  const header = grid[headerIdx];
  const yearCols = [];
  for (let c = 1; c < header.length; c++) {
    const y = parseYearColTitle(header[c]);
    if (y != null) yearCols.push({ col: c, year: y });
  }
  if (!yearCols.length) throw new Error('No year columns found in the header row.');
  const stack = [];
  let classification = null;
  const rows = [], skipped = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] && grid[i][0];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const label = raw.trim();
    if (NOTES_SECTION_RE.test(label)) break;
    if (/^Total\s/i.test(label)) continue;
    if (IMPORT_SKIP_LABEL_RE.test(label)) continue;
    const depth = balanceRowDepth(raw, colAIndent[i]);
    const nextIdx = nextNonBlankRowIndex(grid, i);
    const hasChildren = nextIdx !== -1 && balanceRowDepth(grid[nextIdx][0], colAIndent[nextIdx]) > depth;
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
    const row = grid[i] || [];
    for (const { col, year } of yearCols) {
      const cents = dollarsToCents(row[col]);
      rows.push(makeFlatRow(path, classification, hasChildren, {
        fiscal_year: year,
        own_actual_cents: field === 'actual' ? cents : null,
        own_budget_cents: field === 'budget' ? cents : null,
      }));
    }
  }
  return { years: [...new Set(yearCols.map(y => y.year))], rows, skipped };
}
export function parseActivityMultiYearGrid(grid, colAIndent) {
  return parseIncomeStatementMultiYearGrid(grid, colAIndent, 'actual');
}
export function findBudgetMultiYearSheet(sheets) { return findYearMultiColSheet(sheets); }
export function parseBudgetMultiYearGrid(grid, colAIndent) {
  return parseIncomeStatementMultiYearGrid(grid, colAIndent, 'budget');
}
// Wholesale-replaces source='import_activity' rows for exactly the set of fiscal years present —
// same re-import-is-idempotent pattern as the other Church Report importers, but keyed by an
// explicit years array (not one fiscal_year, and not a contiguous month range) since one file
// spans many non-contiguous years.
// Deliberately NOT a delete-then-insert like the other Church Report importers — the user's real
// files split Actual and Budget into two SEPARATE multi-year exports ("Statement of Activity" and
// "Budget by Year"), each carrying only one of the two fields (own_actual_cents XOR
// own_budget_cents, the other always null on every row this function receives). Both share the
// 'import_activity' source, and a field-preserving upsert (COALESCE against the existing stored
// value) is what lets uploading Activity then Budget — in either order, or just one of the two —
// correctly combine into complete rows instead of one file wiping out the other's contribution,
// which a wholesale per-year DELETE-first would do. Trade-off, stated plainly: an account removed
// from a re-uploaded file (rather than corrected) keeps its last known value here rather than
// being deleted, since there's no reliable way to tell "removed on purpose" apart from "the field
// this file doesn't carry" from a single file's contents alone.
export async function persistChurchEntriesActivityImport(db, rows, years, importedAt) {
  if (!years.length || !rows.length) return;
  // own_actual_cents is NOT NULL in the schema (own_budget_cents is nullable — NULL there already
  // means "no budget known," so COALESCE works directly for it) — a budget-only row's null actual
  // has to be coerced to 0 to satisfy that constraint on a fresh insert. That makes 0 ambiguous
  // between "really zero" and "this import doesn't know," so an explicit hasActual flag (not the
  // value itself) is what the ON CONFLICT branch below uses to decide whether to touch the
  // existing stored value at all.
  const ops = rows.map(r => {
    const hasActual = r.own_actual_cents != null ? 1 : 0;
    return db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,0,?,?,?,?,?,?,?,'import_activity',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children,
         own_actual_cents=CASE WHEN ?=1 THEN excluded.own_actual_cents ELSE finance_church_entries.own_actual_cents END,
         own_budget_cents=COALESCE(excluded.own_budget_cents, finance_church_entries.own_budget_cents),
         synced_at=excluded.synced_at`
    ).bind(r.fiscal_year, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0,
      hasActual ? r.own_actual_cents : 0, r.own_budget_cents, importedAt, hasActual);
  });
  await db.batch(ops);
}
// Same function, different name for the Budget-by-Year import route — makes each call site read
// clearly without duplicating the (identical) merge logic above.
export const persistChurchEntriesBudgetMultiYearImport = persistChurchEntriesActivityImport;

// Monthly rows can come from two sources (the live sync's 'qbo_sync' or this manual
// 'monthly_import') — resolved per fiscal year, live sync wins whenever it has data for that
// year (it's the fresher, always-current source once connected), falling back to the manual
// import only for a year the live sync has never covered. Mirrors resolveChurchYearPrecedence's
// per-year (not per-row) resolution, just with the opposite priority order for the reason above.
const CHURCH_MONTHLY_SOURCE_PRIORITY = ['qbo_sync', 'monthly_import'];
export function resolveChurchMonthlyYearPrecedence(rows) {
  const byYear = new Map();
  for (const r of rows) {
    if (!byYear.has(r.fiscal_year)) byYear.set(r.fiscal_year, []);
    byYear.get(r.fiscal_year).push(r);
  }
  const out = [];
  for (const yearRows of byYear.values()) {
    for (const src of CHURCH_MONTHLY_SOURCE_PRIORITY) {
      const matching = yearRows.filter(r => r.source === src);
      if (matching.length) { out.push(...matching); break; }
    }
  }
  return out;
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

// ── Commercial Property: monthly-financials CSV import ──────────────────────────────────────
// Each new AHRA property management report comes with its own single-row CSV export in this
// exact header shape (confirmed against the real June 2026 export used to seed this table —
// see seedIvanhoePropertyJune2026 in db.js) — this lets an admin paste/upload that CSV directly
// instead of retyping every field into the "+ Add Month" modal by hand each time a new report
// arrives. `management_fee_expense`/`accounts_receivable` aren't tracked by this table (no column
// for them) and are intentionally ignored, same as `total_revenue_ytd` etc. — this app derives
// YTD figures itself from the stored monthly rows rather than storing a redundant snapshot.
const PROPERTY_MONTHLY_CSV_REQUIRED_COLS = ['period', 'total_revenue', 'operating_expenses', 'net_operating_income', 'non_operating_expenses', 'net_income'];
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
export function parsePropertyMonthlyCsv(text) {
  const lines = (text || '').split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length);
  if (!lines.length) return { rows: [], error: 'Empty file.' };
  const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  for (const col of PROPERTY_MONTHLY_CSV_REQUIRED_COLS) {
    if (!(col in idx)) return { rows: [], error: `Missing required column "${col}".` };
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = col => (idx[col] != null ? cells[idx[col]] : undefined);
    const period = (get('period') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(period)) return { rows: [], error: `Row ${i + 1}: "period" must be YYYY-MM (got "${period}").` };
    const occRaw = get('occupancy_pct');
    const occ = (occRaw === undefined || occRaw === '') ? null : Number(occRaw) / 100;
    const operatingExpCents = Math.abs(dollarsToCents(get('operating_expenses')));
    const nonOperatingExpCents = Math.abs(dollarsToCents(get('non_operating_expenses')));
    rows.push({
      period,
      occupancy_pct: occ,
      total_revenue_cents: dollarsToCents(get('total_revenue')),
      total_expenses_cents: operatingExpCents + nonOperatingExpCents,
      net_operating_income_cents: dollarsToCents(get('net_operating_income')),
      net_income_cents: dollarsToCents(get('net_income')),
      available_for_distribution_cents: get('distribution_amount') !== undefined ? dollarsToCents(get('distribution_amount')) : null,
      reserve_balance_cents: get('total_property_reserve') !== undefined ? dollarsToCents(get('total_property_reserve')) : null,
    });
  }
  return { rows };
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
  return { fiscalYear, asOfDate, rows, skipped, basis: detectBalanceSheetBasis(grid) };
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
// ── Church Report: "Statement of Financial Position" multi-year Excel import ────────────────
// Nonprofit-terminology multi-year Balance Sheet — one column per YEAR (e.g. "2019", "2020", ...)
// instead of the single-file Balance Sheet import's one as-of-date snapshot. Reuses the same
// classification-reset/stack-clear tree walk as parseBalanceSheetGrid (Assets/Liabilities/Equity
// each restart the path stack, since a real export's indentation isn't guaranteed consistent
// across classifications — see that function's own comment) — only the header detection and
// per-row amount extraction differ (year columns instead of a single "Total" balance column).
// Uses the same generic bare-year-column header detection as findActivityMultiYearSheet
// (parseYearColTitle) rather than the single-file importer's "Total" convention, since this
// report's real header shape wasn't observed firsthand — if it turns out not to match, the
// "could not find a header row" error below will say so plainly rather than misimporting.
export function findFinancialPositionMultiYearSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some(r => r && [1, 2].filter(c => parseYearColTitle(r[c]) != null).length >= 2)) return s;
  }
  return null;
}
export function parseFinancialPositionMultiYearGrid(grid, colAIndent) {
  colAIndent = colAIndent || [];
  const headerIdx = grid.findIndex(r => r && [1, 2].filter(c => parseYearColTitle(r[c]) != null).length >= 2);
  if (headerIdx === -1) throw new Error('Could not find a year-by-year "Statement of Financial Position" header row (e.g. "2019", "2020", ...) in this sheet.');
  const header = grid[headerIdx];
  const yearCols = [];
  for (let c = 1; c < header.length; c++) {
    const y = parseYearColTitle(header[c]);
    if (y != null) yearCols.push({ col: c, year: y });
  }
  if (!yearCols.length) throw new Error('No year columns found in the header row.');
  const stack = [];
  let classification = null;
  const rows = [], skipped = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] && grid[i][0];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const label = raw.trim();
    if (NOTES_SECTION_RE.test(label)) break; // see its definition above — a trailing notes/commentary section, not real data
    if (/^Total\s/i.test(label)) continue;
    if (/^Liabilities and Equity$/i.test(label)) continue;
    const depth = balanceRowDepth(raw, colAIndent[i]);
    const nextIdx = nextNonBlankRowIndex(grid, i);
    const hasChildren = nextIdx !== -1 && balanceRowDepth(grid[nextIdx][0], colAIndent[nextIdx]) > depth;
    const norm = normalizeBalanceClassification(label);
    const row = grid[i] || [];
    if (norm) {
      classification = norm;
      stack.length = 0;
      stack.push({ depth, path: [classification] });
      for (const { col, year } of yearCols) rows.push(makeBalanceRow([classification], classification, hasChildren, year, dollarsToCents(row[col])));
      continue;
    }
    if (depth === 0 && !hasChildren) { skipped.push(raw); continue; }
    if (!classification) { skipped.push(raw); continue; }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : { path: [classification] };
    const path = parent.path.concat(label);
    stack.push({ depth, path });
    for (const { col, year } of yearCols) rows.push(makeBalanceRow(path, classification, hasChildren, year, dollarsToCents(row[col])));
  }
  return { years: yearCols.map(y => y.year), rows, skipped, basis: detectBalanceSheetBasis(grid) };
}
// Wholesale-replaces source='import' rows for exactly the set of fiscal years present — same
// source tag as the single-file Balance Sheet import (there's no precedence system for balance
// snapshots the way Church Report actual-vs-budget has one; a balance is just "the balance as of
// that year," so both importers sharing 'import' is correct, not a collision).
export async function persistChurchBalancesMultiYearImport(db, rows, years, importedAt) {
  if (!years.length) return;
  const ops = years.map(y => db.prepare(`DELETE FROM finance_church_balances WHERE source='import' AND fiscal_year=?`).bind(y));
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_balances
         (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,'import',?)
       ON CONFLICT(fiscal_year, category_path, source) DO UPDATE SET
         as_of_date=excluded.as_of_date, classification=excluded.classification, account_name=excluded.account_name,
         depth=excluded.depth, has_children=excluded.has_children, own_balance_cents=excluded.own_balance_cents,
         synced_at=excluded.synced_at`
    ).bind(r.fiscal_year, `FY${r.fiscal_year}`, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_balance_cents, importedAt));
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

// ── Balance sheet ↔ P&L tie-out ─────────────────────────────────────────────────────────────
// A balance sheet and an income statement for the same year are two views of one set of books:
// the year's change in total equity (net assets) should equal that year's net income, because
// every other equity movement — a transfer between funds, a reclassification — nets to zero
// within total equity. This is the check that says an imported past year actually belongs to the
// same books as its P&L, which is exactly what an admin uploading several years of history needs
// to see. A difference is NOT automatically an error and is never reported as one: a cash-basis
// balance sheet sitting next to an accrual P&L (this church has at least one such year on file —
// see the basis flag on the import), a prior-period adjustment booked straight to equity, or an
// owner-equity-style contribution will all land here legitimately. It is reported as a difference
// to explain, not a failure.
//
// A year can only be checked when its IMMEDIATE predecessor also has a balance sheet — without
// opening equity there is no change to compare against. Those years are still listed, with the
// reason, so "which year do I still need to upload?" is answerable from the same table.
export const BALANCE_PNL_TOLERANCE_CENTS = 100; // $1 — absorbs rounding, nothing more.
export function computeBalanceVsPnlReconciliation(years, balanceByYear, netIncomeByYear) {
  const sorted = [...new Set((years || []).filter(Number.isFinite))].sort((a, b) => a - b);
  const summaryFor = y => (balanceByYear || {})[y] || null;
  // A year with no imported rows still gets a zeroed summary from computeBalanceSummary(), which
  // is indistinguishable from a real $0 equity unless the classification map is consulted.
  const hasBalance = y => {
    const s = summaryFor(y);
    return !!(s && s.classificationTotals && Object.keys(s.classificationTotals).length);
  };
  const rows = [];
  for (const year of sorted) {
    if (!hasBalance(year)) continue;
    const priorYear = year - 1;
    const priorKnown = hasBalance(priorYear);
    const equityCents = summaryFor(year).equityCents;
    const priorEquityCents = priorKnown ? summaryFor(priorYear).equityCents : null;
    const changeCents = priorKnown ? equityCents - priorEquityCents : null;
    const ni = (netIncomeByYear || {})[year];
    const netIncomeCents = ni == null ? null : ni;
    let differenceCents = null;
    let status;
    if (!priorKnown) status = 'no_prior_balance';
    else if (netIncomeCents == null) status = 'no_pnl';
    else {
      differenceCents = changeCents - netIncomeCents;
      status = Math.abs(differenceCents) <= BALANCE_PNL_TOLERANCE_CENTS ? 'ok' : 'off';
    }
    rows.push({ year, prior_year: priorYear, equity_cents: equityCents, prior_equity_cents: priorEquityCents,
      change_cents: changeCents, net_income_cents: netIncomeCents, difference_cents: differenceCents, status });
  }
  return {
    rows,
    checked: rows.filter(r => r.status === 'ok' || r.status === 'off').length,
    matched: rows.filter(r => r.status === 'ok').length,
    unexplained: rows.filter(r => r.status === 'off').length,
  };
}

// ── Equity reclassification: Donor-Restricted vs. Without Donor Restrictions ────────────────
// Per Timothy_Equity_Reclassification_Spec.md — replaces QuickBooks' four-way equity split
// (Unrestricted / Board Restricted / Temp. Restricted / Perm. Restricted) with the real
// post-ASU-2016-14 nonprofit two-bucket model. The four legacy equity lines have drifted from
// reality (32000 Perm. Restricted has been frozen at exactly $223,828.47 every year since 2019
// despite the underlying endowments moving with the market every year) and are NEVER used as
// inputs — this is computed bottom-up from real account balances instead, wherever in the
// report they happen to sit (several of the accounts below are under Assets — endowment/
// investment sub-accounts — not Equity; the "25000 Funds" designated-fund list sits under
// Liabilities in this church's chart of accounts). Account codes below matched against the real
// combined multi-year workbook and reconcile exactly (2026 designated-funds total: $119,049.51,
// matching "Total for 25000 Funds" in the source file to the penny).
//
// Every code below is Donor-Restricted; there is no board-designated bucket in this fund list
// (Board Restricted folds into Unrestricted going forward — see EQUITY_RECLASS_IGNORE_CODES).
//
// Confirmed with Pastor Dinger 2026-07-29 (revises the original spec's 3b bucket): the restricted
// accounts are exactly the endowment six below plus the "25000 Funds" designated list — 12019
// (Thrivent-Bequests), 12020 (Edward Jones), and 12021 (Reserve for Caring Ministry), originally
// listed in the spec's Section 3b as "Purpose/Time Restricted," are NOT donor-restricted after
// all. They're moved to EQUITY_RECLASS_IGNORE_CODES (confirmed-not-restricted, not "needs
// review") below, alongside three sibling 12000-Investment-Accounts-group accounts (12016/17/18)
// that were already excluded pending review — the whole "purpose_time" bucket is now empty.
export const EQUITY_RECLASS_ACCOUNTS = {
  // 3a — Perpetual endowments (principal never spent) — the six Thrivent sub-accounts (the
  // "8632/8633" pair and the "3285" pair)
  '12010': 'perpetual', '12011': 'perpetual', '12012': 'perpetual', '12013': 'perpetual', '12014': 'perpetual', '12015': 'perpetual',
  // 3c — Designated ministry/purpose funds (the "25000 Funds" list)
  '25001': 'designated', '25004': 'designated', '25005': 'designated', '25006': 'designated',
  '25007': 'designated', '25008': 'designated', '25009': 'designated', '25010': 'designated',
  '25011': 'designated', '25015': 'designated', '25016': 'designated', '25017': 'designated',
  '25018': 'designated', '25019': 'designated', '25019a': 'designated', '25020': 'designated',
  '25022': 'designated', '25023': 'designated', '25023x': 'designated', '25024': 'designated',
  '25025': 'designated', '25026': 'designated', '25027': 'designated', '25028': 'designated',
  '25029': 'designated', '25030': 'designated', '25031': 'designated', '25031a': 'designated',
  '25032': 'designated', '25033': 'designated', '25034': 'designated', '25035': 'designated',
  '25036': 'designated', '25037': 'designated', '25038': 'designated', '25039': 'designated',
  '25040': 'designated', '25041': 'designated', '25042': 'designated', '25043': 'designated',
  '25044': 'designated', '25099': 'designated',
};
const EQUITY_RECLASS_BUCKET_LABELS = {
  perpetual: 'Perpetual endowments', purpose_time: 'Purpose/time restricted', designated: 'Designated ministry/purpose funds',
};
// Two different reasons an account is ignored, same practical treatment (excluded from
// DonorRestricted, never flagged as needing review): (1) legacy QuickBooks equity plug lines —
// always ignored as calculation inputs (see the module comment above). '30000 Opening Balance
// Equity' is always $0 in every period on file; 'Net Revenue' is a current-period plug folded
// into Unrestricted via the residual formula below, not summed directly. (2) the three other
// accounts under the real "12000 Investment Accounts" group (12016 Ameritrade, 12017/12018 —
// Thrivent 5244304/5244305, numeric siblings of the now-ignored 12019 Thrivent-Bequests) —
// confirmed 2026-07-29 as not donor-restricted, same review that moved 12019/12020/12021 out of
// EQUITY_RECLASS_ACCOUNTS above.
export const EQUITY_RECLASS_IGNORE_CODES = new Set([
  '30000', '31000', '31500', '32000', '33000',
  '12016', '12017', '12018', '12019', '12020', '12021',
]);
const EQUITY_RECLASS_IGNORE_LABELS = new Set(['net revenue']);
// Account labels in this report are "<code> <description>" — the code is the stable key (a
// description can drift — "(deleted)", "reclass to X" suffixes seen in the real export — the
// leading code does not). Codes are typically 4-6 digits, occasionally with one trailing letter
// (e.g. "25019a", "25023x").
export function extractAccountCode(accountName) {
  const m = /^(\d{4,6}[a-z]{0,2})\b/i.exec((accountName || '').trim());
  return m ? m[1].toLowerCase() : null;
}
// Restricted to the account "neighborhoods" the classification table actually covers — a generic
// sweep of every leaf account in the report (bank accounts, AP, prepaid expense, etc.) would
// produce false-positive noise unrelated to donor restrictions. Verified against the real
// combined multi-year workbook: a bare 120xx code prefix is too broad (matches unrelated
// operational accounts like "12001 Undeposited Funds"/"12200 Employee Loan"/"12400 Prepaid
// Expense", which sit under "Other Current Assets"/"Other Assets", not investments) — narrowed to
// only leaves nested under the real "12000 Investment Accounts" group, which is exactly where
// every already-classified 3a/3b account sits. This did surface 4 real gaps in the classification
// table itself when checked against that workbook (12012/12015/12017/12018 — clearly investment/
// endowment sub-accounts under the same "12000 Investment Accounts" group as the accounts already
// in Section 3a/3b, just never reviewed with Pastor Dinger) — flagged for manual review rather
// than silently added, per Section 5.4 of the spec. A leaf under the "25000 Funds" group that
// isn't in the table is a plausible new designated fund (e.g. "25044 Kaleo Coffee" first appeared
// in a recent year); any other Equity-classified leaf that isn't in the ignore set is a plausible
// new/renamed legacy-style equity line. None of these are silently defaulted to a bucket — see the
// "unclassified" list in computeEquityReclassification below.
function isEquityReclassCandidate(row, code) {
  if (!code) return false;
  const pathWithSep = (row.category_path || '') + ':';
  if (/(^|:)12000[^:]*:/.test(pathWithSep)) return true;
  if (/(^|:)25000[^:]*:/.test(pathWithSep)) return true;
  if (row.classification === 'Equity') return true;
  return false;
}
// Computes {DonorRestricted, Unrestricted} for one fiscal year's set of already-parsed/persisted
// balance rows (leaf rows with own_balance_cents; classification-header and "has_children" group
// rows are safe to include too — they carry a $0 own value in every real export observed, per
// computeBalanceSummary's own long-standing $0.00-diff reconciliation). TotalEquity is derived by
// summing every row classified 'Equity' (computeBalanceSummary's equityCents) rather than reading
// a literal printed "Total for Equity" cell — mathematically identical given that reconciliation
// guarantee, and avoids needing the raw Total-row text captured by a parser rewrite. Per the
// spec, Unrestricted is always the RESIDUAL against TotalEquity, never a direct sum of the legacy
// lines — this is what keeps the two buckets exactly summing to real total equity regardless of
// any drift in QuickBooks' own internal sub-accounts.
export function computeEquityReclassification(rows) {
  const breakdown = { perpetual: 0, purpose_time: 0, designated: 0 };
  const unclassified = [];
  const seenCodes = new Set();
  for (const r of rows) {
    if (r.has_children) continue; // leaf-only, to avoid double-counting a group's own subtotal row
    const code = extractAccountCode(r.account_name);
    const label = (r.account_name || '').trim().toLowerCase();
    if (code && EQUITY_RECLASS_ACCOUNTS[code]) {
      breakdown[EQUITY_RECLASS_ACCOUNTS[code]] += r.own_balance_cents;
      seenCodes.add(code);
      continue;
    }
    if ((code && EQUITY_RECLASS_IGNORE_CODES.has(code)) || EQUITY_RECLASS_IGNORE_LABELS.has(label)) continue;
    if (isEquityReclassCandidate(r, code)) {
      unclassified.push({ account_name: r.account_name, category_path: r.category_path, own_balance_cents: r.own_balance_cents });
    }
  }
  const donorRestrictedCents = breakdown.perpetual + breakdown.purpose_time + breakdown.designated;
  const totalEquityCents = computeBalanceSummary(rows).equityCents;
  const unrestrictedCents = totalEquityCents - donorRestrictedCents;
  return {
    donorRestrictedCents, unrestrictedCents, totalEquityCents,
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, { label: EQUITY_RECLASS_BUCKET_LABELS[k], cents: v }])),
    unclassified,
  };
}
// The real export's trailing footer line names its accounting basis (e.g. "Cash Basis Tuesday,
// July 28, 2026 03:11 PM GMT-05:00") — 2025's export was run on Accrual while every other year on
// file is Cash, so this is surfaced rather than silently assumed, per the spec.
export function detectBalanceSheetBasis(grid) {
  for (const row of grid) {
    const cell = row && row[0];
    if (typeof cell !== 'string') continue;
    const m = /^(Cash|Accrual)\s+Basis\b/i.exec(cell.trim());
    if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return null;
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

// ── Daycare (MDO) Utilities/Insurance cost-share ──────────────────────────────────────────
// MDO has no Utilities or Insurance accounts of its own — it shares the building with the
// church — so per the user's explicit choice, these two Daycare Report lines are a live
// percentage of the CHURCH side's actual Utilities/Insurance expense for the same year,
// recalculated every time (never a stored dollar figure that can go stale). Matches on
// category_path (not just account_name) since the church's chart of accounts only tags the
// grouping label itself (e.g. "34 Utilities") — real postings live on child leaf accounts
// (Electric/Gas/Water/etc.) that don't contain the word "Utilities" in their own name at all;
// category_path carries the full colon-joined ancestor chain, matching either the parent or a
// child correctly without double-counting (own_actual_cents is always non-cumulative — see
// resolveChurchYearPrecedence's callers elsewhere in this file for the same guarantee).
const MDO_ALLOCATION_MATCH = { utilities: /utilit/i, insurance: /insuranc/i };
export function computeChurchCategoryActualCents(resolvedRows, matchRe) {
  let cents = 0;
  for (const r of resolvedRows) {
    if (matchRe.test(r.category_path) || matchRe.test(r.account_name)) cents += (r.own_actual_cents || 0);
  }
  return cents;
}
// `rowsByYear` = { year: resolvedRows[] } (already precedence-resolved per year, period_month=0
// only). Returns { [year]: { utilityActualCents, insuranceActualCents, mdoUtilityCents, mdoInsuranceCents } }.
export function computeMdoUtilityInsuranceAllocation(rowsByYear, utilityPct, insurancePct) {
  const out = {};
  for (const year of Object.keys(rowsByYear)) {
    const utilityActualCents = computeChurchCategoryActualCents(rowsByYear[year], MDO_ALLOCATION_MATCH.utilities);
    const insuranceActualCents = computeChurchCategoryActualCents(rowsByYear[year], MDO_ALLOCATION_MATCH.insurance);
    out[year] = {
      utilityActualCents,
      insuranceActualCents,
      mdoUtilityCents: Math.round(utilityActualCents * utilityPct),
      mdoInsuranceCents: Math.round(insuranceActualCents * insurancePct),
    };
  }
  return out;
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
async function mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId) {
  const budgetsData = await fetchQboJson('Budget entity', client.budgets(), warnings);
  if (!budgetsData) return null;
  const budgetList = budgetsData?.QueryResponse?.Budget || [];
  // A company can have more than one Budget object (e.g. a leftover test budget alongside the
  // real one) — an admin-selected preferredBudgetId always wins; otherwise fall back to the
  // best year-match guess, then the first budget found. See GET/PATCH finance/qb/budgets below
  // for the picker UI this threads through from.
  const budget = (preferredBudgetId && budgetList.find(b => b.Id === preferredBudgetId))
    || budgetList.find(b => (b.StartDate || '').startsWith(String(year))) || budgetList[0];
  if (!budget) { warnings.push(`Budget entity: no Budget found for ${year}`); return null; }

  const plData = await fetchQboJson(
    'Profit and Loss (current year)',
    client.profitAndLoss({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
    warnings
  );
  if (!plData || !plData.Rows) return null;

  // Sum by account id (the robust, unambiguous key — see mergeLeafCells) AND by name (a
  // same-name-different-account collision can't happen when matching by id, so budgetIdsByName
  // is only ever consulted as the name-matching fallback path's own disambiguation check).
  const budgetByName = new Map();
  const budgetIdsByName = new Map();
  const budgetByAccountId = new Map();
  for (const line of (budget.BudgetDetail || [])) {
    const name = line?.AccountRef?.name;
    const id = line?.AccountRef?.value;
    const amt = Number(line?.Amount);
    if (!Number.isFinite(amt)) continue;
    if (id != null) budgetByAccountId.set(id, (budgetByAccountId.get(id) || 0) + amt);
    if (!name) continue;
    budgetByName.set(name, (budgetByName.get(name) || 0) + amt);
    if (!budgetIdsByName.has(name)) budgetIdsByName.set(name, new Set());
    if (id != null) budgetIdsByName.get(name).add(id);
  }
  if (!budgetByName.size && !budgetByAccountId.size) { warnings.push('Budget entity: found a Budget but no usable BudgetDetail line items'); return null; }

  const ambiguousNames = new Set();
  const unmatched = [];
  const rows = mergeProfitAndLossTree(plData.Rows.Row, { budgetByName, budgetIdsByName, budgetByAccountId, ambiguousNames, unmatched });
  if (ambiguousNames.size) {
    warnings.push(
      `Budget vs Actual: ${ambiguousNames.size} account name(s) appear on more than one account in different categories (e.g. sub-accounts sharing a name across Income and Expenses) — shown as $0 budget rather than guessed which one: ${[...ambiguousNames].slice(0, 5).join(', ')}${ambiguousNames.size > 5 ? '…' : ''}`
    );
  }
  if (unmatched.length) {
    const withId = unmatched.filter(u => u.hadId).length;
    const noId = unmatched.length - withId;
    const sample = unmatched.slice(0, 8).map(u => `${u.name} ($${(u.actualAmt).toFixed(2)}${u.hadId ? '' : ', no account id on this cell'})`).join('; ');
    warnings.push(
      `Budget vs Actual: ${unmatched.length} account(s) with real activity had no matching Budget line (${withId} had an account id that just wasn't in this Budget's BudgetDetail, ${noId} had no account id at all so only name-matching was possible) — showing $0 budget for these rather than guessing: ${sample}${unmatched.length > 8 ? '…' : ''}`
    );
  }
  return { rows };
}

// Fallback for when the BudgetVsActual REPORT endpoint itself is blocked (hit a persistent
// "5020 Permission Denied" error during live testing even with a verified Budget and Company
// Admin access) but entity-level/other-report access still works. Wraps
// mergeCurrentYearBudgetAndActual()'s merged tree in the same Columns/Rows report shape the
// frontend already renders generically, so no frontend changes are needed to display it.
async function buildBudgetVsActualFallback(client, year, warnings, preferredBudgetId) {
  const merged = await mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId);
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
// source precedence: a year with any 'qbo_sync' row uses ONLY those rows — once the live
// QuickBooks connection works, it's the authority (per user decision 2026-07-28: sync should
// supersede a file import, not be permanently shadowed by one, since a mid-year import used as
// a stopgap shouldn't outlive the live connection it was covering for). A year with no sync
// rows falls back to 'import' (a hand-uploaded Excel export) — useful for years QuickBooks
// wasn't connected for yet, or before this app tracked live data at all. Rows for a superseded
// source are never deleted (still visible via the Import UI / audit trail), just deprioritized
// at read time — an import is never silently lost, only shadowed. One bulk query + JS grouping,
// not a correlated subquery per year, matching this app's existing performance conventions.
// 'import_activity' (the multi-year "Statement of Activity" import — actual only, no budget)
// sits between 'import' and 'plan_committed': a full Budget-vs-Actuals import always wins for a
// year it covers (it has real budget data the Activity-only import can never provide), but
// Activity data is still a genuine historical record, so it outranks the Planning placeholder.
// Highest to lowest priority. 'plan_committed' (a forward Budget Planning projection committed
// to a future year — see FIN12) is deliberately LOWEST priority: it's a placeholder for a year
// with no real data yet, and must get out of the way the moment either a live sync or a real
// import exists for that year, rather than permanently overriding them.
const CHURCH_SOURCE_PRIORITY = ['qbo_sync', 'import', 'import_activity', 'plan_committed'];
// A one-line, hand-typed correction to a single account's Actual for a single year — see the
// `finance/church/actual-override` endpoint below (PATTERN: same as `manual_budget_override` on
// finance_daycare_entries — a same-shaped row, applied afterward as a REPLACEMENT, never summed
// in). Deliberately NOT a fifth entry in CHURCH_SOURCE_PRIORITY: that list picks ONE source's
// rows wholesale for a whole year, so a same-shaped priority tier holding just the one edited
// line would become the ONLY row surviving for that year — silently deleting every other
// account's actual. Applied per-category-path over whichever source actually won the year
// instead, so a correction takes effect everywhere Actual is read (Church Report, Financial
// Health, Planning) without needing to re-upload or re-sync the whole file for one line.
const CHURCH_ACTUAL_OVERRIDE_SOURCE = 'manual_actual_override';
export function resolveChurchYearPrecedence(rows) {
  const byYear = new Map();
  for (const r of rows) {
    if (!byYear.has(r.fiscal_year)) byYear.set(r.fiscal_year, []);
    byYear.get(r.fiscal_year).push(r);
  }
  const out = [];
  for (const yearRows of byYear.values()) {
    let base = [];
    for (const src of CHURCH_SOURCE_PRIORITY) {
      const matching = yearRows.filter(r => r.source === src);
      if (matching.length) { base = matching; break; }
    }
    const overrides = yearRows.filter(r => r.source === CHURCH_ACTUAL_OVERRIDE_SOURCE);
    if (!overrides.length) { out.push(...base); continue; }
    const overrideByPath = new Map(overrides.map(r => [r.category_path, r]));
    const coveredPaths = new Set();
    for (const r of base) {
      const ov = overrideByPath.get(r.category_path);
      // Keep every other field from the winning source's own row (classification, depth,
      // has_children, own_budget_cents) — only the actual figure and its source label change.
      out.push(ov ? { ...r, own_actual_cents: ov.own_actual_cents, source: CHURCH_ACTUAL_OVERRIDE_SOURCE } : r);
      coveredPaths.add(r.category_path);
    }
    // An override for an account with no row at all in the winning source (no sync/import ever
    // covered it for this year) still has to surface — use the override row's own stored fields.
    for (const ov of overrides) if (!coveredPaths.has(ov.category_path)) out.push(ov);
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

// Elapsed weeks since Jan 1 of `now`'s year, capped at 52 — used by Church Budget Planning's
// base-year annualization (see the generate-all handler below) instead of calendar months, since
// a partial month is ambiguous (is day 5 of month 8 "1 month elapsed" or "0"?) in a way a count of
// full days ÷ 7 is not. Inclusive of today (Jan 1 itself = 1 day elapsed = week 0.14, not 0).
export function weeksElapsedInYear(now) {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const daysElapsed = Math.floor((now - yearStart) / 86400000) + 1;
  return Math.min(52, Math.max(1, daysElapsed / 7));
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
    seasonal: true,
    throughMonth,
    income: series(get(curYtd, 'Income'), get(priorYtd, 'Income'), get(priorAnnual, 'Income')),
    expenses: series(get(curYtd, 'Expenses'), get(priorYtd, 'Expenses'), get(priorAnnual, 'Expenses')),
    net: series(curYtd.netIncome.actualCents, priorYtd.netIncome.actualCents, priorAnnual.netIncome.actualCents),
  };
}

// Fallback for computeYtdComparison when no monthly-granularity rows exist for this year and
// last year (the common case now — see FIN36 — since this church settled on annual-only Excel
// imports rather than chasing live QuickBooks sync). Projects a straight-line estimate off the
// annual actual-to-date total instead of leaving the KPI permanently blank: less accurate than
// the seasonal prior-year-ratio (no month-shape awareness), but still a real number for the
// board to look at. `summary` is the already-computed computeYearSummary() for the current
// year's annual (period_month=0) rows.
export function fallbackAnnualProjection(summary, throughMonth) {
  const tm = Math.min(12, Math.max(1, Math.round(throughMonth || 12)));
  const series = (curCents) => ({
    currentYtdCents: curCents, priorYtdCents: 0, priorFullYearCents: 0,
    projectedFullYearCents: Math.round(curCents * (12 / tm)),
    method: 'straight-line-annual',
  });
  const get = (c) => (summary.classificationTotals[c] || { actualCents: 0 }).actualCents;
  return {
    available: true,
    seasonal: false,
    throughMonth: tm,
    income: series(get('Income')),
    expenses: series(get('Expenses')),
    net: series(summary.netIncome.actualCents),
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

// ── Revenue streams: donor / earned / passive ───────────────────────────────────────────────
// The Financial Health page reads the money a second way — not by account group but by WHO
// controls it: donor revenue is the only stream the board can actually move, earned income is
// reported to the board rather than managed by it, and passive income is a timing decision.
//
// The mapping is per income GROUP (a top-level child of the Income/Other Income classification,
// e.g. "40 Offerings & Contributions"), keyed by that group's exact label, and is stored in
// chms_config so an admin can correct it without a deploy — the classification of a church's own
// chart of accounts is a judgment call this code cannot make for every church. The regex rules
// below are only the DEFAULT applied to a group nobody has mapped yet; every group resolved that
// way is also returned in `unmapped` so the Data & Imports tab can show what still needs a human
// decision rather than silently asserting a guess.
//
// Unmatched groups default to `earned` deliberately: overstating donor revenue would overstate
// how much of the budget the board can actually influence, which is the one claim this whole page
// is built to make honestly.
// Rule order is precedence order, most specific first. `\brestricted\b` deliberately carries word
// boundaries so it cannot match "Unrestricted"; "altar guild" and "designated" were moved off the
// donor rule when restricted became its own stream, since a designated gift is money the board
// cannot redirect even though a donor gave it.
const REVENUE_STREAM_RULES = [
  { stream: 'restricted', re: /\brestricted\b|altar guild|designated/i },
  { stream: 'passive', re: /passive|endowment|investment|interest|dividend|ivanhoe|bequest|trust/i },
  { stream: 'earned', re: /mdo|mother'?s day out|daycare|tuition|rental|rent\b|lease|fundrais|facility|program fee|earned/i },
  { stream: 'donor', re: /offering|contribution|donor|donation|gift|pledge|tithe|memorial/i },
];
export const REVENUE_STREAMS = ['donor', 'earned', 'passive', 'restricted'];
// Restricted income is a HALF OF DONOR INCOME, not a peer of earned and passive: it is a gift,
// given by the same people, and — unlike a 25xxx designated fund — it does pay budgeted expenses,
// just ones the donor named (Comfort Dog, Tuition Aid). So the four streams are how the money is
// CLASSIFIED, and these three are how it is DISPLAYED wherever the mix is drawn as a whole: the
// revenue mix bar, the flow diagram, the five-year chart. Drawing restricted beside donor implies
// the board has one more independent lever than it really has, and makes donor income read
// smaller than the giving that produced it. The donor card already reports the two together;
// these keep every other view telling the same story.
export const DISPLAY_STREAMS = ['donor', 'earned', 'passive'];
export function displayStreamOf(stream) { return stream === 'restricted' ? 'donor' : stream; }
export function classifyRevenueStream(label, overrides, accountNames) {
  const mapped = overrides && overrides[label];
  if (mapped && REVENUE_STREAMS.includes(mapped)) return { stream: mapped, mapped: true };
  for (const rule of REVENUE_STREAM_RULES) if (rule.re.test(label || '')) return { stream: rule.stream, mapped: false };
  // The group name said nothing, so read the accounts inside it before falling back to `earned`.
  // A generic bucket ("48 Other Income") can hold an account the rules DO name: this church's
  // Altar Guild is the reason the restricted rule spells out "altar guild" at all, and it sits one
  // level BELOW the only label the rules ever got to see — so the rule could never once fire.
  //
  // Adopted only when every money-carrying account in the group agrees. A mixed bucket has no one
  // right answer, and guessing one would move real money between streams on the Health page.
  const found = new Set();
  for (const name of accountNames || []) {
    const rule = REVENUE_STREAM_RULES.find(r => r.re.test(name || ''));
    if (!rule) { found.clear(); break; }
    found.add(rule.stream);
  }
  if (found.size === 1) return { stream: [...found][0], mapped: false };
  return { stream: 'earned', mapped: false };
}
// The account group a revenue row belongs to. Every parser in this file puts the CLASSIFICATION in
// segment 0 of category_path (`path = [classification]` at depth 0 — see parseBudgetVsActualsGrid,
// parseIncomeStatementMultiYearGrid and flattenReportTree), so the group a human can actually
// classify is segment 1, not segment 0. Reading segment 0 collapsed every revenue account in the
// chart into one group literally named "Income", which matched no rule and so defaulted the whole
// budget to earned — reported live 2026-08-07 as a 100%-earned revenue mix with $0 donor revenue
// sitting next to a count of 129 giving households.
const CLASSIFICATION_PATH_HEADS = new Set(['income', 'other income', 'revenue', 'other revenue']);
export function revenueGroupLabel(categoryPath, accountName) {
  const segs = String(categoryPath || accountName || '').split(':').map(s => s.trim()).filter(Boolean);
  if (segs.length > 1 && CLASSIFICATION_PATH_HEADS.has(segs[0].toLowerCase())) return segs[1];
  return segs[0] || '';
}
// `entries` = a year's precedence-resolved period_month=0 rows. Groups revenue by the top-level
// segment of each row's category_path (the chart-of-accounts group), because that is the level a
// human can meaningfully classify — an individual leaf account is too granular to map by hand and
// too volatile to keep mapped. Amounts are own_actual_cents, which is always non-cumulative, so
// summing every row of a group can never double-count a "Total for X" subtotal.
export function computeRevenueStreams(entries, overrides) {
  const groups = new Map();
  for (const r of entries || []) {
    if (r.classification !== 'Income' && r.classification !== 'Other Income') continue;
    const label = revenueGroupLabel(r.category_path, r.account_name);
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, { cents: 0, budgetCents: 0, accounts: [] });
    const g = groups.get(label);
    g.cents += (r.own_actual_cents || 0);
    if (r.own_budget_cents != null) g.budgetCents += r.own_budget_cents;
    // Only accounts actually carrying money inform the guess below — a $0 line names nothing the
    // classification should turn on, and the group's own header row holds no own amount at all.
    if (r.own_actual_cents || r.own_budget_cents) g.accounts.push(r.account_name || '');
  }
  const streams = {};
  for (const s of REVENUE_STREAMS) streams[s] = { cents: 0, budgetCents: 0, groups: [] };
  const unmapped = [], map = {};
  for (const [label, g] of groups) {
    const { stream, mapped } = classifyRevenueStream(label, overrides, g.accounts);
    map[label] = stream;
    streams[stream].cents += g.cents;
    streams[stream].budgetCents += g.budgetCents;
    streams[stream].groups.push({ label, cents: g.cents, budgetCents: g.budgetCents });
    // A group carrying no money needs no human decision, so it is not surfaced as something the
    // page had to guess at. The section-header row (category_path === the classification alone,
    // which by construction holds no own amount) lands here, and would otherwise permanently read
    // as one unconfirmed group named "Income" — the exact noise this fix exists to remove.
    if (!mapped && (g.cents || g.budgetCents)) unmapped.push({ label, cents: g.cents, defaultedTo: stream });
  }
  for (const s of REVENUE_STREAMS) streams[s].groups.sort((a, b) => b.cents - a.cents);
  unmapped.sort((a, b) => b.cents - a.cents);
  let totalCents = 0, totalBudgetCents = 0;
  for (const s of REVENUE_STREAMS) { totalCents += streams[s].cents; totalBudgetCents += streams[s].budgetCents; }
  // `map` is every income group's resolved stream (override or guess). The Church Report groups
  // its own account tree from this same map, so one saved classification drives both pages.
  return { streams, totalCents, totalBudgetCents, unmapped, map };
}
// ── Designated funds (the 25xxx family) ─────────────────────────────────────────────────────
// Money the church holds but does not operate on. Confirmed with Pastor Dinger 2026-08-12: every
// 25xxx fund is outside the budget, whatever the reason it leaves — forwarded to a third party
// (Concordia Children's Services, PNG Mission Society), benevolence (Christ Care, Food Pantry),
// capital (Building Fund, Extending His Gates, LCEF), or held at pastoral discretion (Memorial,
// Mission, Music). They differ in WHY the money leaves and not at all in the way that matters to
// a revenue figure: none of it can pay a budgeted expense.
//
// ⚠ This is why a designated gift must never be added to operating revenue. The church's own
// accounting already says so — 25xxx lives under LIABILITIES ("Liabilities:25000 Funds:25004
// Building Fund"), never as an income line, so it appears in the Breeze giving import and never
// in budget-vs-actuals. That asymmetry is the whole reason the Health page's donor card used to
// disagree with itself: it put a ledger income figure above a giving-records figure that included
// every one of these funds, so the parts came out larger than the whole they sat under.
//
// The rule is the ACCOUNT NUMBER, deliberately, not a name match or a per-fund flag: the
// bookkeeper's numbering is the one place this judgment is already recorded, a new fund she adds
// is classified correctly the day it appears, and nobody has to maintain a second list that can
// drift out of agreement with hers. EQUITY_RECLASS_ACCOUNTS' hand-transcribed 25xxx codes all
// satisfy this prefix, so the balance sheet and this page cannot disagree about what is
// designated. '25000 Funds' itself is the group header — a rollup carrying no own balance, and
// counting it would double every figure below it.
const DESIGNATED_FUND_CODE_RE = /^(25\d{3}[a-z]?)\b/i;
export function designatedFundCode(name) {
  const m = String(name || '').trim().match(DESIGNATED_FUND_CODE_RE);
  if (!m) return null;
  const code = m[1].toLowerCase();
  return code === '25000' ? null : code;
}
// Splits a year's ChMS giving into the part that funds the budget and the part that does not, and
// pairs each designated fund with its balance-sheet balance where one exists. Two independent
// sources by necessity — what was GIVEN this year can only come from ChMS (there is no income
// line), and what is ON HAND can only come from the imported balance sheet — so a fund may appear
// with one and not the other: a fund given to this year with no balance row, or a fund holding a
// balance nobody gave to this year. Both are real and both are kept, rather than inner-joining
// one of them away.
//
// balanceCents is null (not 0) when no balance sheet has been imported at all, so "no statement on
// file" can be said in those words instead of being drawn as a church holding nothing.
export function computeDesignatedFunds(givingByFund, balanceRows) {
  const byCode = new Map();
  const ensure = (code, label) => {
    if (!byCode.has(code)) byCode.set(code, { code, label, givenCents: 0, balanceCents: null });
    return byCode.get(code);
  };
  let designatedGivenCents = 0, operatingGivenCents = 0;
  for (const g of givingByFund || []) {
    const cents = g.cents || 0;
    const code = designatedFundCode(g.fundName);
    if (!code) { operatingGivenCents += cents; continue; }
    designatedGivenCents += cents;
    ensure(code, g.fundName).givenCents += cents;
  }
  let balanceCents = null, asOfDate = '';
  for (const r of balanceRows || []) {
    // has_children rows are rollups; their own balance is $0 in every real export, but skipping
    // them explicitly keeps that a stated invariant rather than a lucky one.
    if (r.has_children) continue;
    const code = designatedFundCode(r.account_name);
    if (!code) continue;
    const cents = r.own_balance_cents || 0;
    balanceCents = (balanceCents || 0) + cents;
    if (!asOfDate && r.as_of_date) asOfDate = r.as_of_date;
    const f = ensure(code, r.account_name);
    f.balanceCents = (f.balanceCents || 0) + cents;
  }
  const funds = [...byCode.values()].sort((a, b) =>
    (b.givenCents - a.givenCents) || ((b.balanceCents || 0) - (a.balanceCents || 0)) || a.code.localeCompare(b.code));
  return { funds, designatedGivenCents, operatingGivenCents, balanceCents, asOfDate };
}

// ── Flow diagram data contract ("How the money moves") ──────────────────────────────────────
// Expense rows carry their classification as segment 0 of category_path exactly as revenue rows
// do (see revenueGroupLabel and the live regression it documents), so the group a human can
// actually classify is segment 1. Same rule, different heads.
const EXPENSE_PATH_HEADS = new Set(['expenses', 'other expenses', 'cost of goods sold', 'expenditures', 'other expenditures']);
export function expenseGroupLabel(categoryPath, accountName) {
  const segs = String(categoryPath || accountName || '').split(':').map(x => x.trim()).filter(Boolean);
  if (segs.length > 1 && EXPENSE_PATH_HEADS.has(segs[0].toLowerCase())) return segs[1];
  return segs[0] || '';
}
// The board's five expense categories are its own vocabulary, not the chart of accounts, so the
// GL-account → category mapping is config-driven and admin-maintainable (chms_config key
// finance_flow_expense_map), exactly like the revenue-stream mapping above. The regexes below are
// only the DEFAULT for an account nobody has mapped yet, and every account resolved that way is
// returned in `unmapped` so the validation report the handoff asks for has something to show.
//
// `programs` is the fallback rather than a null bucket: an unmapped account still has to appear
// somewhere or the outflow total stops matching total expenses, and a silently-dropped account is
// far worse than a visibly-miscategorized one.
export const FLOW_EXPENSE_CATEGORIES = [
  { key: 'mdo', label: 'MDO', note: 'staffing & operations' },
  { key: 'salaries', label: 'Salaries & Benefits', note: 'church staff' },
  { key: 'property', label: 'Property & Operations', note: '' },
  { key: 'education', label: 'Lutheran Education', note: '' },
  { key: 'programs', label: 'Programs', note: '' },
];
export const FLOW_EXPENSE_KEYS = FLOW_EXPENSE_CATEGORIES.map(c => c.key);
const FLOW_EXPENSE_RULES = [
  { key: 'mdo', re: MDO_MATCH_RE },
  { key: 'salaries', re: /salar|payroll|wage|benefit|compensation|pension|fica|health insurance|disability/i },
  { key: 'education', re: /educat|school|lutheran high|scholarship|tuition aid|seminar/i },
  { key: 'property', re: /propert|facilit|utilit|maintenance|building|grounds|janitor|custodial|repair|mortgage|insuranc/i },
  { key: 'programs', re: /program|worship|music|youth|children|mission|outreach|fellowship|evangel/i },
];
export function classifyFlowExpense(label, overrides) {
  const mapped = overrides && overrides[label];
  if (mapped && FLOW_EXPENSE_KEYS.includes(mapped)) return { key: mapped, mapped: true };
  for (const rule of FLOW_EXPENSE_RULES) if (rule.re.test(label || '')) return { key: rule.key, mapped: false };
  return { key: 'programs', mapped: false };
}
// Builds the Sankey's node lists from a year's precedence-resolved rows. Amounts only — never
// geometry; the layout is computed client-side (see finFlowLayout in js-finance.js).
//
// Sources are the real top-level GL groups, one node each, tagged with the stream they belong to,
// so both halves of the diagram use the same classification the mix bar above it does — including
// restricted income, which is its own stream rather than a slice carved back out of donor giving.
export function computeFlowDiagram(entries, opts = {}) {
  const { streamOverrides = {}, expenseOverrides = {} } = opts;
  const { streams } = computeRevenueStreams(entries, streamOverrides);

  // Each restricted group keeps its own source node — the diagram still shows Comfort Dog and
  // Tuition Aid arriving separately — but the ribbon runs into the DONOR stream node rather than a
  // fourth one of its own (displayStreamOf). This is what the handoff's own reference figures do:
  // "Restricted giving" is a donor-stream source there, and its middle column has three nodes.
  const sources = [];
  for (const s of REVENUE_STREAMS) {
    for (const g of streams[s].groups) {
      if (g.cents <= 0) continue;
      sources.push({ id: `${s}:${g.label}`, label: g.label, stream: displayStreamOf(s), cents: g.cents });
    }
  }
  // NOTE: donor revenue is deliberately NOT re-split here by the ChMS restricted ratio. The
  // restricted dollars already arrive as their own source nodes above, so splitting the donor node
  // again by a giving-records ratio would draw them twice and inflate total revenue. That is the
  // bug the donor card shipped with until 2026-08-12; do not reintroduce it here.

  const byCategory = new Map();
  const unmappedExpenses = [];
  for (const r of entries || []) {
    if (r.classification !== 'Expenses' && r.classification !== 'Other Expenses' && r.classification !== 'Cost of Goods Sold') continue;
    const cents = r.own_actual_cents || 0;
    if (!cents) continue;
    const label = expenseGroupLabel(r.category_path, r.account_name);
    const { key, mapped } = classifyFlowExpense(`${label} ${r.account_name || ''}`, expenseOverrides);
    byCategory.set(key, (byCategory.get(key) || 0) + cents);
    if (!mapped && label) {
      const seen = unmappedExpenses.find(u => u.label === label);
      if (seen) seen.cents += cents;
      else unmappedExpenses.push({ label, cents, defaultedTo: key });
    }
  }
  const expenses = FLOW_EXPENSE_CATEGORIES
    .map(c => ({ id: c.key, label: c.label, note: c.note, cents: byCategory.get(c.key) || 0 }))
    .filter(c => c.cents > 0);
  unmappedExpenses.sort((a, b) => b.cents - a.cents);

  // Summed over the DISPLAY streams, so the donor node is exactly as tall as the ribbons feeding
  // it. Built from `sources` rather than from `streams` directly — the two can only agree if the
  // node total and the ribbons it receives are derived from the same list.
  const streamTotals = DISPLAY_STREAMS
    .map(s => ({ id: s, cents: sources.filter(x => x.stream === s).reduce((sum, x) => sum + x.cents, 0) }))
    .filter(s => s.cents > 0);
  const totalRevenueCents = sources.reduce((sum, s) => sum + s.cents, 0);
  const totalExpenseCents = expenses.reduce((sum, e) => sum + e.cents, 0);
  return {
    sources, streams: streamTotals, expenses,
    totalRevenueCents, totalExpenseCents,
    netCents: totalRevenueCents - totalExpenseCents,
    unmappedExpenses,
  };
}

// Where the money goes, split the same way the revenue side is: MDO accounts vs. everything else.
// Uses the same MDO_MATCH_RE the daycare importer already keys on, so the two halves are exactly
// the same set of accounts the Daycare Report is built from — and because every expense row lands
// in exactly one half, the two outflows always sum to total expenses with nothing unaccounted for.
export function computeMoneyFlow(entries) {
  let mdoOutCents = 0, churchOutCents = 0;
  for (const r of entries || []) {
    if (r.classification !== 'Expenses' && r.classification !== 'Other Expenses' && r.classification !== 'Cost of Goods Sold') continue;
    const cents = r.own_actual_cents || 0;
    if (MDO_MATCH_RE.test(r.category_path) || MDO_MATCH_RE.test(r.account_name)) mdoOutCents += cents;
    else churchOutCents += cents;
  }
  return { mdoOutCents, churchOutCents, totalOutCents: mdoOutCents + churchOutCents };
}
// ── Operating cash runway ────────────────────────────────────────────────────────────────────
// Months of operating cash on hand against an admin-set policy floor. avgMonthlyExpenseCents is
// this year's expense actuals divided by the months elapsed rather than a trailing-12 figure,
// because a church that has only imported the current year still gets an honest answer; a year
// with no expenses at all returns available:false rather than dividing by zero and reporting an
// infinite runway, which would read as reassuring when it means "we have no data."
// Operating expenses split into what the congregation must keep paying and what the daycare pays
// for itself. The runway question is "how long can the church keep the lights on and the staff
// paid if giving stops?", and daycare wages are not part of that answer: if the tuition stops the
// wages stop with it, so charging them to the church's burn rate shortens the runway by a cost the
// church would never have to carry alone.
//
// Same MDO_MATCH_RE the daycare importer and computeMoneyFlow already key on, so "daycare" means
// exactly the same set of accounts the Daycare Report is built from — and every Expenses row lands
// in exactly one half, so the two always sum back to total expenses.
export function computeOperatingExpenseSplit(entries) {
  let churchCents = 0, daycareCents = 0;
  for (const r of entries || []) {
    if (r.classification !== 'Expenses') continue;
    const cents = r.own_actual_cents || 0;
    if (MDO_MATCH_RE.test(r.category_path || '') || MDO_MATCH_RE.test(r.account_name || '')) daycareCents += cents;
    else churchCents += cents;
  }
  return { churchCents, daycareCents, totalCents: churchCents + daycareCents };
}
export function computeCashRunway({ onHandCents, expensesYtdCents, monthsElapsed, policyFloorMonths }) {
  const months = Math.max(1, monthsElapsed || 0);
  const avgMonthlyExpenseCents = Math.round((expensesYtdCents || 0) / months);
  if (!avgMonthlyExpenseCents || onHandCents == null) {
    return { available: false, onHandCents: onHandCents == null ? null : onHandCents, avgMonthlyExpenseCents, policyFloorMonths };
  }
  const monthsOfCash = onHandCents / avgMonthlyExpenseCents;
  const floorCents = Math.round(avgMonthlyExpenseCents * policyFloorMonths);
  return {
    available: true,
    onHandCents,
    avgMonthlyExpenseCents,
    policyFloorMonths,
    monthsOfCash,
    floorCents,
    gapToFloorCents: Math.max(0, floorCents - onHandCents),
  };
}
// Best-effort operating cash from the stored QuickBooks account snapshot — the same name-matching
// heuristic the retired Overview "Balances" row used, now server-side so the Health page and any
// future consumer read one figure. An admin can override it outright (finance_cash_policy config)
// when the heuristic picks up the wrong accounts, which is why the source is reported alongside.
// Operating cash straight off the imported balance sheet — the church's own confirmed figure,
// which is what a treasurer would read if asked "how much cash do we have?". This church's
// operating account is "11027 Lindell Checking xx9105"; `accountCode` (Data & Imports →
// Classification & policy) pins it exactly, and with nothing pinned the fallback is a name match
// on "checking".
//
// Two things this deliberately does NOT do. It doesn't sweep in savings/reserve accounts the way
// the QuickBooks heuristic does — restricted reserves are not operating cash, and a runway built
// on money the congregation has already promised elsewhere overstates how long the lights stay
// on. And it doesn't silently sum whatever it finds: the matched account names come back with the
// figure so the card can name them, because an unpinned name match could just as easily pick up a
// daycare checking account. Rollup rows (has_children) are skipped so a parent and its children
// are never both counted.
// ⚠ A row with children is skipped ONLY when it carries $0.00 of its own. Every balance-sheet
// parser in
// this file stores each account's OWN, non-cumulative balance — never a "Total for X" subtotal
// (FIN6's founding rule) — which is exactly why computeBalanceSummary() can sum every row,
// parents included, and still reconcile Assets = Liabilities + Equity to the cent. So a parent's
// own_balance_cents is that account's own money, not a rollup of the rows beneath it, and
// skipping parents silently deletes real cash: this church's real operating account, "11027
// Lindell Checking xx9105", has one $0.00 child ("11030 Cash on hand") nested under it in the
// multi-year Financial Position export, which made it a parent and dropped $116,693.30 of 2026
// operating cash — the whole balance read as ~$0 on the Cash & Bank Accounts trend. A pure
// grouping header (11000 Cash and Equivalents, 11002 Cash and Equiv - TLC) carries $0.00 of its
// own, so dropping those costs no money and keeps them out of the "accounts swept in" list the
// card prints — a header named there reads as an account that exists, which it is not.
const isEmptyGroupRow = r => !!r.has_children && !(r.own_balance_cents || 0);
export function operatingCashFromBalanceSheet(rows, accountCode) {
  const code = String(accountCode || '').trim();
  const matches = (rows || []).filter(r => {
    if (r.classification !== 'Assets') return false;
    if (isEmptyGroupRow(r)) return false;
    const name = String(r.account_name || '').trim();
    return code ? name.startsWith(code) : /checking/i.test(name);
  });
  if (!matches.length) return null;
  return {
    cents: matches.reduce((s, r) => s + (r.own_balance_cents || 0), 0),
    accounts: matches.map(r => String(r.account_name || '').trim()),
    asOfDate: String(matches[0].as_of_date || ''),
  };
}
// The Balance Sheet & Financial Position tab's "Cash & Bank Accounts Over Time" trend, one call
// per year in the multi-year window. Reuses operatingCashFromBalanceSheet() rather than a second
// name-matching heuristic for the single pinned operating account — the two must never quote
// different operating-cash figures for the same year, since the Financial Health cash-runway card
// reads the same function. "All Cash & Bank Accounts" is a broader, separate figure: every
// non-rollup Assets account whose name reads as a bank account (checking/savings/money market/
// petty cash), which on a church with more than one bank account (e.g. a daycare's own checking)
// is deliberately wider than the one pinned operating account — the trend line is allowed to name
// which accounts it swept in, same reasoning as the operating-cash figure already does.
const ALL_CASH_ACCOUNT_MATCH_RE = /checking|saving|money\s*market|petty\s*cash|cash\s*on\s*hand|^cash\b|cash\s*-\s*/i;
export function computeYearCashSummary(rows, accountCode) {
  const operating = operatingCashFromBalanceSheet(rows, accountCode);
  const matches = (rows || []).filter(r => {
    if (r.classification !== 'Assets') return false;
    // A parent holding real money is counted, for the reason given above
    // operatingCashFromBalanceSheet(); only an empty grouping header is dropped.
    if (isEmptyGroupRow(r)) return false;
    return ALL_CASH_ACCOUNT_MATCH_RE.test(String(r.account_name || '').trim());
  });
  return {
    operatingCents: operating ? operating.cents : null,
    operatingAccounts: operating ? operating.accounts : [],
    allCashCents: matches.length ? matches.reduce((s, r) => s + (r.own_balance_cents || 0), 0) : null,
    allCashAccounts: matches.map(r => String(r.account_name || '').trim()),
  };
}
export function operatingCashFromAccounts(accountsPayload) {
  const list = accountsPayload?.QueryResponse?.Account || [];
  let cents = 0, matched = 0;
  for (const a of list) {
    if (!/checking|saving|reserve/i.test(a.Name || '')) continue;
    cents += Math.round((Number(a.CurrentBalance) || 0) * 100);
    matched++;
  }
  return matched ? { cents, matched } : null;
}
// ── Appeal ask ladder ────────────────────────────────────────────────────────────────────────
// Distributes an appeal target across four fixed ask levels. Households per tier is a whole
// number (you cannot ask 8.4 households for $2,500), so the ladder's total is recomputed from the
// rounded rows rather than restated from the raw target — the header figure and the ladder total
// are the same number by construction, never two figures that nearly agree. Rounding is upward so
// the ladder always covers at least the target it was built for.
export const APPEAL_TIERS = [
  { askCents: 250000, weight: 0.28 },
  { askCents: 100000, weight: 0.28 },
  { askCents: 50000, weight: 0.28 },
  { askCents: 20000, weight: 0.16 },
];
export function computeAppealLadder(targetCents) {
  if (!targetCents || targetCents <= 0) return { tiers: [], totalCents: 0, totalHouseholds: 0 };
  const tiers = APPEAL_TIERS.map(t => {
    const households = Math.max(1, Math.ceil((targetCents * t.weight) / t.askCents));
    return { askCents: t.askCents, households, raisesCents: households * t.askCents };
  });
  return {
    tiers,
    totalCents: tiers.reduce((s, t) => s + t.raisesCents, 0),
    totalHouseholds: tiers.reduce((s, t) => s + t.households, 0),
  };
}
// ── Daycare room occupancy ───────────────────────────────────────────────────────────────────
// The three figures the Daycare Report's occupancy footnote states have to reconcile with the
// per-room badges above them, so they are all derived here from one pass. Seasonal rooms (Summer
// Camp) are excluded from the seat totals and counted separately — mixing a seasonal room into a
// year-round capacity basis is exactly the "we are full" distortion this screen exists to avoid.
export function computeRoomOccupancy(rooms) {
  let filledSeats = 0, totalSeats = 0, waiting = 0, openSeatsUnderfilled = 0;
  const seasonal = [];
  for (const r of rooms || []) {
    waiting += r.waitlist_families || 0;
    if (r.seasonal) { seasonal.push(r.room_name); continue; }
    const cap = r.capacity_per_day || 0;
    const enrolled = r.avg_daily_enrolled || 0;
    totalSeats += cap;
    filledSeats += enrolled;
    if (cap > 0 && enrolled / cap < 0.65) openSeatsUnderfilled += Math.max(0, cap - enrolled);
  }
  return {
    filledSeats: Math.round(filledSeats),
    totalSeats: Math.round(totalSeats),
    overallPct: totalSeats > 0 ? filledSeats / totalSeats : null,
    waitingFamilies: waiting,
    openSeatsUnderfilled: Math.round(openSeatsUnderfilled),
    seasonalRooms: seasonal,
  };
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
    if (!byYear[year]) byYear[year] = { year, total_revenue_cents: 0, total_expenses_cents: 0, net_income_cents: 0, occ_sum: 0, occ_count: 0, confirmed_distributions_cents: 0, expense_months_derived: 0, notes: annualNotes?.[year] || '' };
    const y = byYear[year];
    if (Number.isFinite(r.total_revenue_cents)) y.total_revenue_cents += r.total_revenue_cents;
    // Several months (every 2026 row in the MRI report format bar two) report net income WITHOUT
    // breaking out an expenses line. Accumulating each column behind its own guard let revenue and
    // net income count all those months while expenses counted none — so a card printing
    // "revenue - expenses - reserves" could not reach its own net-income-derived total, and
    // silently understated expenses by $16,568.60 for 2026. Derive the missing months instead:
    // this dataset's own convention is revenue - expenses = net income, so the subtraction is
    // exact, not an estimate, and revenue - expenses now reconciles to net income identically.
    if (Number.isFinite(r.total_expenses_cents)) {
      y.total_expenses_cents += r.total_expenses_cents;
    } else if (Number.isFinite(r.total_revenue_cents) && Number.isFinite(r.net_income_cents)) {
      y.total_expenses_cents += (r.total_revenue_cents - r.net_income_cents);
      y.expense_months_derived++;
    }
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
      // How many months' expenses were reconstructed above, so the UI can say so rather than
      // present a derived figure as one the property manager actually reported.
      expense_months_derived: y.expense_months_derived,
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
    await recordImport(db, 'property_budget_xlsx', `${months.length} month(s)`);
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
      // Real per-month loan payment + interest expense (bank rec + income statement) — lets the
      // confirmed mortgage balance roll forward automatically instead of needing a fresh lender
      // confirmation every time (see finComputeMortgageRemainingCents).
      loan_payment_cents: toCents(b.loan_payment),
      interest_expense_cents: toCents(b.interest_expense),
    };
    for (const [k, v] of Object.entries(cents)) { if (v !== null && !Number.isFinite(v)) return json({ error: `Invalid ${k}` }, 400); }
    await db.prepare(
      `INSERT INTO finance_property_monthly
         (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,loan_payment_cents,interest_expense_cents,source_report,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(property_key,period) DO UPDATE SET
         occupancy_pct=excluded.occupancy_pct, total_revenue_cents=excluded.total_revenue_cents, total_expenses_cents=excluded.total_expenses_cents,
         net_income_cents=excluded.net_income_cents, net_operating_income_cents=excluded.net_operating_income_cents,
         available_for_distribution_cents=excluded.available_for_distribution_cents, reserve_balance_cents=excluded.reserve_balance_cents,
         loan_payment_cents=excluded.loan_payment_cents, interest_expense_cents=excluded.interest_expense_cents,
         source_report=excluded.source_report, updated_at=excluded.updated_at`
    ).bind(propertyKey, b.period, occ, cents.total_revenue_cents, cents.total_expenses_cents, cents.net_income_cents, cents.net_operating_income_cents, cents.available_for_distribution_cents, cents.reserve_balance_cents, cents.loan_payment_cents, cents.interest_expense_cents, b.source_report || '').run();
    return json({ ok: true });
  }

  // Bulk import of one or more months from the AHRA report's own monthly-financials CSV row
  // format (see parsePropertyMonthlyCsv) — an alternative to filling out the "+ Add Month" modal
  // by hand for each new report. loan_payment_cents/interest_expense_cents aren't in this CSV
  // shape, so they're left untouched on a re-imported month (upsert only sets the columns this
  // CSV actually carries) rather than being wiped back to null.
  if (seg === `finance/property/${propertyKey}/monthly-import-csv` && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing property financials requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const { rows, error } = parsePropertyMonthlyCsv(b.csv || '');
    if (error) return json({ error }, 400);
    if (!rows.length) return json({ error: 'No data rows found in this CSV.' }, 400);
    const ops = rows.map(r => db.prepare(
      `INSERT INTO finance_property_monthly
         (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,source_report,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(property_key,period) DO UPDATE SET
         occupancy_pct=excluded.occupancy_pct, total_revenue_cents=excluded.total_revenue_cents, total_expenses_cents=excluded.total_expenses_cents,
         net_income_cents=excluded.net_income_cents, net_operating_income_cents=excluded.net_operating_income_cents,
         available_for_distribution_cents=excluded.available_for_distribution_cents, reserve_balance_cents=excluded.reserve_balance_cents,
         source_report=excluded.source_report, updated_at=excluded.updated_at`
    ).bind(propertyKey, r.period, r.occupancy_pct, r.total_revenue_cents, r.total_expenses_cents, r.net_income_cents, r.net_operating_income_cents, r.available_for_distribution_cents, r.reserve_balance_cents, b.source_report || 'csv_import'));
    await db.batch(ops);
    await recordImport(db, 'property_monthly_csv', rows.map(r => r.period).join(', '));
    return json({ ok: true, imported: rows.length, periods: rows.map(r => r.period) });
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
    for (const section of ['property', 'valuation', 'loan', 'reserves', 'capital']) {
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

// ── Finance Workspace redesign: shared config readers + the import-staleness log ─────────────
// Both settings live in chms_config as JSON blobs, the same pattern as the property meta and the
// salary planner — no migration needed to add a key, and a corrupt/absent row falls back to the
// documented default rather than throwing a 500 on a read path the whole tab depends on.
async function readRevenueStreamOverrides(db) {
  const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_revenue_streams'").first();
  try { return row ? (JSON.parse(row.value).map || {}) : {}; } catch { return {}; }
}
// The latest imported_at across a year's rows — what "as of" actually means for these figures.
function finChurchAsOfIso(entries) {
  let latest = '';
  for (const r of entries || []) if (r.imported_at && r.imported_at > latest) latest = r.imported_at;
  return latest;
}
async function readFlowExpenseOverrides(db) {
  const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_flow_expense_map'").first();
  try { return row ? (JSON.parse(row.value).map || {}) : {}; } catch { return {}; }
}
// ── Chart of Accounts: per-account board-category assignment + renameable category headings,
// read by both that page and Planning's "Board view" toggle. A NEW, independent config
// (finance_planning_board_categories) — deliberately NOT layered onto finance_revenue_streams/
// finance_flow_expense_map above. Those two classify at GROUP granularity (one decision for a
// whole QuickBooks group, e.g. "48 Other Income") and drive Financial Health's revenue mix and
// the money-flow Sankey — both heavily tested, board-facing figures this session has no live
// browser to re-verify. Chart of Accounts assigns per ACCOUNT (so "48001 Altar Guild" can read
// differently than a sibling in the same QuickBooks group), which those two aggregations were
// never built to honor. Keyed by each leaf's own category_path, not its account name — an
// account name alone isn't unique across the chart of accounts, category_path is.
//
// The Board Category system's own expense taxonomy — its own allowlist (BOARD_EXPENSE_KEYS,
// below), deliberately SEPARATE from FLOW_EXPENSE_KEYS above. It started out holding the same
// five keys as FLOW_EXPENSE_KEYS by coincidence, not by design, and diverged 2026-09-04 when the
// user asked for Worship & Music and District & Synod Support as their own peer categories on the
// Budget tab — reusing FLOW_EXPENSE_KEYS for that would have silently grown the money-flow
// Sankey diagram from five categories to seven too, which nobody asked for and this session has
// no live browser to re-verify. Mirrored in FIN_BOARD_EXP_ORDER/FIN_BOARD_EXP_DEFAULT_LABEL in
// js-finance.js — the two lists must be kept in exact sync by hand, since there is no shared
// module between this backend file and that String.raw-served frontend bundle.
export const BOARD_EXPENSE_CATEGORIES = [
  { key: 'mdo', label: 'MDO' },
  { key: 'salaries', label: 'Salaries & Benefits' },
  { key: 'worship', label: 'Worship & Music' },
  { key: 'property', label: 'Property & Operations' },
  { key: 'education', label: 'Lutheran Education' },
  { key: 'district_synod', label: 'District & Synod Support' },
  { key: 'programs', label: 'Programs' },
];
export const BOARD_EXPENSE_KEYS = BOARD_EXPENSE_CATEGORIES.map(c => c.key);
async function readPlanningBoardCategories(db) {
  const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_planning_board_categories'").first();
  const empty = { revenue: {}, expense: {}, revenueLabels: {}, expenseLabels: {}, donorWrapperLabel: '' };
  if (!row) return empty;
  try {
    const v = JSON.parse(row.value) || {};
    return {
      revenue: v.revenue && typeof v.revenue === 'object' ? v.revenue : {},
      expense: v.expense && typeof v.expense === 'object' ? v.expense : {},
      revenueLabels: v.revenueLabels && typeof v.revenueLabels === 'object' ? v.revenueLabels : {},
      expenseLabels: v.expenseLabels && typeof v.expenseLabels === 'object' ? v.expenseLabels : {},
      // The "Donor Income" wrapper that nests Unrestricted + Restricted together on the Budget
      // tab's Board view (see finBuildBoardTree in js-finance.js) — not one of the four revenue
      // category keys REVENUE_STREAMS validates below, so it gets its own plain-string field
      // rather than trying to squeeze it into revenueLabels' key allowlist.
      donorWrapperLabel: typeof v.donorWrapperLabel === 'string' ? v.donorWrapperLabel : '',
    };
  } catch { return empty; }
}
const DEFAULT_CASH_POLICY = { policy_floor_months: 3, cash_on_hand_cents: null, cash_account_code: '', general_fund_budget_code: '' };
async function readCashPolicy(db) {
  const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_cash_policy'").first();
  if (!row) return { ...DEFAULT_CASH_POLICY };
  try {
    const v = JSON.parse(row.value) || {};
    return {
      policy_floor_months: Number.isFinite(v.policy_floor_months) ? v.policy_floor_months : DEFAULT_CASH_POLICY.policy_floor_months,
      cash_on_hand_cents: Number.isFinite(v.cash_on_hand_cents) ? v.cash_on_hand_cents : null,
      // The balance-sheet account that IS operating cash, by its leading code ("11027"). Blank
      // falls back to a name match on "checking".
      cash_account_code: typeof v.cash_account_code === 'string' ? v.cash_account_code.trim() : '',
      // The ledger account family that carries the General Fund's budget ("40085"). Blank falls
      // back to the leading code of the funds categorized as the General Fund, which is right
      // whenever Giving and the ledger use the same code — this pins it when they don't.
      general_fund_budget_code: typeof v.general_fund_budget_code === 'string' ? v.general_fund_budget_code.trim() : '',
    };
  } catch { return { ...DEFAULT_CASH_POLICY }; }
}
// Every importer stamps its key here on a successful commit, so the Data & Imports tab can show
// what has gone stale without opening the report it feeds. Best-effort by design: an import that
// succeeded must not be reported as failed because its bookkeeping row could not be written.
export const FINANCE_IMPORTERS = [
  { key: 'church_budget', label: 'Budget (single year)', group: 'church' },
  { key: 'church_monthly_pnl', label: 'Monthly P&L', group: 'church' },
  { key: 'church_activity_multi', label: 'Statement of Activity (multi-year)', group: 'church' },
  { key: 'church_budget_multi', label: 'Budget by Year (multi-year)', group: 'church' },
  { key: 'church_balance', label: 'Balance Sheet', group: 'church' },
  { key: 'church_balance_multi', label: 'Financial Position (multi-year)', group: 'church' },
  { key: 'property_monthly_csv', label: 'AHRA monthly financials (CSV)', group: 'other' },
  { key: 'property_budget_xlsx', label: 'AHRA budget detail (xlsx)', group: 'other' },
  { key: 'daycare_church_budget', label: 'MDO accounts from church budget', group: 'other' },
  { key: 'daycare_bulk', label: 'Daycare bulk paste (past years)', group: 'other' },
];
// finance_import_log only started existing with the Data & Imports tab, and nothing backfills it,
// so every importer that last ran before that shipped reads "never" even though its data is still
// in the database and still driving reports. These queries derive a best-effort date from the
// timestamp the imported rows themselves carry, used ONLY for an importer with no real log row —
// the moment one actually runs, its recorded date takes over permanently.
//
// Two pairs genuinely cannot be told apart and say so rather than implying separate runs:
// Statement of Activity and Budget by Year both write source='import_activity' (they merge on
// purpose — see persistChurchEntriesActivityImport), and both Balance Sheet importers write
// source='import' to finance_church_balances. `daycare_bulk` is deliberately absent: it inserts
// with the default source='manual', identical to a row typed into the one-at-a-time form, so
// there is no signal that separates an import from hand entry and a date here would be a guess.
const DERIVED_IMPORT_SOURCES = [
  { keys: ['church_budget'], sql: `SELECT MAX(synced_at) AS t FROM finance_church_entries WHERE source='import' AND synced_at != ''`, note: '' },
  { keys: ['church_monthly_pnl'], sql: `SELECT MAX(synced_at) AS t FROM finance_church_entries WHERE source='monthly_import' AND synced_at != ''`, note: '' },
  { keys: ['church_activity_multi', 'church_budget_multi'], sql: `SELECT MAX(synced_at) AS t FROM finance_church_entries WHERE source='import_activity' AND synced_at != ''`, note: 'shared with the other multi-year income-statement import' },
  { keys: ['church_balance', 'church_balance_multi'], sql: `SELECT MAX(synced_at) AS t FROM finance_church_balances WHERE source='import' AND synced_at != ''`, note: 'shared with the other balance-sheet import' },
  { keys: ['property_budget_xlsx'], sql: `SELECT MAX(updated_at) AS t FROM finance_property_budget_monthly WHERE source='ahra_import'`, note: '' },
  { keys: ['property_monthly_csv'], sql: `SELECT MAX(updated_at) AS t FROM finance_property_monthly`, note: 'may reflect a month edited by hand rather than imported' },
  { keys: ['daycare_church_budget'], sql: `SELECT MAX(created_at) AS t FROM finance_daycare_entries WHERE source='church_budget_import'`, note: '' },
];
async function deriveImportDates(db, missingKeys) {
  const out = {};
  for (const d of DERIVED_IMPORT_SOURCES) {
    if (!d.keys.some(k => missingKeys.has(k))) continue;
    let t = null;
    try { t = (await db.prepare(d.sql).first())?.t || null; } catch { t = null; }
    if (!t) continue;
    for (const k of d.keys) if (missingKeys.has(k)) out[k] = { lastImportedAt: t, note: d.note, derived: true };
  }
  return out;
}
async function recordImport(db, importerKey, note) {
  try {
    await db.prepare(
      `INSERT INTO finance_import_log (importer_key,last_imported_at,note) VALUES (?,?,?)
       ON CONFLICT(importer_key) DO UPDATE SET last_imported_at=excluded.last_imported_at, note=excluded.note`
    ).bind(importerKey, new Date().toISOString(), note || '').run();
  } catch { /* the import itself succeeded; staleness bookkeeping must never fail it */ }
}

// Concurrent identical reads share one computation. The map holds only genuinely IN-FLIGHT
// promises — each entry is deleted the moment its computation settles — so this is request
// coalescing, never a cache: a read that starts after a write has finished always recomputes.
// A Worker isolate serves many requests at once, and the Finance tab fires three requests for
// the same year within milliseconds of each other, which is exactly the window this closes.
const _churchYearInflight = new Map();
function coalesceChurchYear(year, compute) {
  const key = String(year);
  const running = _churchYearInflight.get(key);
  if (running) return running;
  const p = compute().finally(() => { _churchYearInflight.delete(key); });
  // A rejection is delivered to every awaiting caller; this keeps a second caller never arriving
  // from turning it into an unhandled rejection that takes down the isolate.
  p.catch(() => {});
  _churchYearInflight.set(key, p);
  return p;
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
    // P22-E: fail CLOSED, not open, when the KV binding backing CSRF-state validation is
    // missing — a state param that's minted but never checked on the way back is no
    // protection at all, so refuse to start the flow rather than silently skip the check.
    if (!env.RSVP_STORE) return json({ error: 'QuickBooks connect is temporarily unavailable (state store not configured)' }, 503);
    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();
    const state = crypto.randomUUID();
    await env.RSVP_STORE.put(`qb_oauth_state:${state}`, '1', { expirationTtl: 600 });
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
    if (!env.RSVP_STORE) return redirectToApp(url, 'qb_error', 'state_store_unavailable');
    {
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

  // ── List every Budget object in the connected company, so an admin can pick which one to
  // use instead of the sync silently guessing (relevant when a company has more than one — e.g.
  // a leftover test budget alongside the real one). Also returns the currently-selected id.
  if (seg === 'finance/qb/budgets' && method === 'GET') {
    const conn = await getConnection(db);
    if (!conn || !conn.realm_id) return json({ error: 'QuickBooks is not connected yet.' }, 400);
    let fresh;
    try { fresh = await ensureFreshAccessToken(env, db, conn); }
    catch (e) { return json({ error: 'QuickBooks re-authentication failed — try disconnecting and reconnecting. (' + e.message + ')' }, 502); }
    const client = makeQboClient(env, fresh);
    const warnings = [];
    const budgetsData = await fetchQboJson('Budget entity', client.budgets(), warnings);
    const budgetList = (budgetsData?.QueryResponse?.Budget || []).map(b => ({
      id: b.Id, name: b.Name || '(unnamed budget)', startDate: b.StartDate, endDate: b.EndDate,
      entryType: b.BudgetEntryType, active: !!b.Active,
    }));
    const selectedRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_qb_selected_budget_id'").first();
    return json({ budgets: budgetList, selectedBudgetId: selectedRow?.value || null, warnings });
  }
  if (seg === 'finance/qb/budgets' && method === 'PATCH') {
    if (!isAdmin) return json({ error: 'Access denied: selecting the QuickBooks budget requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const id = (b.budget_id == null || b.budget_id === '') ? null : String(b.budget_id);
    if (id === null) await db.prepare("DELETE FROM chms_config WHERE key='finance_qb_selected_budget_id'").run();
    else await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_qb_selected_budget_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(id).run();
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
    const preferredBudgetRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_qb_selected_budget_id'").first();
    const preferredBudgetId = preferredBudgetRow?.value || null;

    // Built once via our own trusted merge pipeline (known, tested Columns shape) — used both
    // to persist finance_church_entries below (always) and as the Overview tab's fallback
    // display when QuickBooks' own BudgetVsActual report call fails. Never flatten the real
    // budgetVsActual report itself into finance_church_entries: its exact column layout isn't
    // guaranteed to match this function's known 4-column shape.
    const currentYearMerge = await mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId);

    // The native BudgetVsActuals report is a confirmed-undocumented, Intuit-unsupported
    // endpoint (see FIN2 in CLAUDE.md) — it spent months returning a "5020 Permission Denied"
    // error, and once the endpoint-name bug was fixed (2026-07-28) it started responding but
    // with numbers that don't hold up (e.g. an "Actual" many times larger than its own "Budget"
    // for the same account, consistent with the report not honoring start_date/end_date and
    // instead summing since the QuickBooks company's inception rather than just this fiscal
    // year). Still called here — a genuine failure is worth surfacing as a warning — but its
    // Rows/Columns are deliberately never shown to the user; the always-trusted reconstruction
    // below (Budget entity + a date-scoped ProfitAndLoss report, both confirmed to respect
    // start_date/end_date correctly) is the only thing ever rendered.
    const nativeBudgetVsActual = await fetchQboJson(
      'Budget vs Actual (native report)',
      client.budgetVsActual({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
      warnings,
      `make sure a Budget for ${year} exists in QuickBooks under Settings > Budgeting`
    );
    if (nativeBudgetVsActual) warnings.push('Budget vs Actual: QuickBooks\' native report responded, but its figures are not used — see the reconstructed report below instead (the native report is unsupported by Intuit and has returned unreliable totals).');
    let budgetVsActual = null;
    if (currentYearMerge) {
      budgetVsActual = {
        Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
        Rows: { Row: currentYearMerge.rows },
        _synthesized: true,
      };
    } else if (!nativeBudgetVsActual) {
      warnings.push('Budget vs Actual: could not build any Budget vs Actual data this sync — both the native report and the Budget-entity reconstruction failed.');
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
    // The multi-year (actuals-only) pass is EXCLUDED from writing the current year at all —
    // reported live 2026-07-28: the Overview KPI cards (read from finance_church_entries via
    // computeYearSummary) showed roughly double the correct total (~$1.18M expenses) compared
    // to the fresh, verified-correct Budget vs Actual reconstruction (~$605K) for the identical
    // sync. The original design relied on "current-year rows are written second, so their ON
    // CONFLICT DO UPDATE overwrites the multi-year pass's row for that year" — but that only
    // self-heals when both passes produce byte-identical category_path strings for the same
    // account; QuickBooks' multi-year summarized report (summarize_column_by:'Year') doesn't
    // reliably match the single-year report's account tree shape, so a mismatched path becomes
    // a second, un-overwritten row instead of a correction — silently doubling the total. Since
    // currentYearMerge already covers the current year (with real budget data, unlike this
    // actuals-only pass), the multi-year pass now only contributes PRIOR years, where there's no
    // second pass to conflict or duplicate with.
    const churchRows = [];
    if (profitAndLoss && profitAndLoss.Rows) {
      const cols = (profitAndLoss.Columns && profitAndLoss.Columns.Column) || [];
      const colYears = cols.map(c => { const m = /(\d{4})/.exec(c.ColTitle || ''); const y = m ? parseInt(m[1], 10) : null; return (y === year) ? null : y; });
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

  // ── Sync: actuals only, for specific admin-picked fiscal years (Statement of Activity /
  // Profit & Loss) ────────────────────────────────────────────────────────────────────────────
  // A deliberately narrower sibling of finance/qb/sync above: no Budget entity, no native
  // BudgetVsActuals report call, no finance_qb_snapshot writes — this never touches budget data
  // at all, sidestepping that whole unsupported-endpoint saga (see FIN2) entirely. One
  // profitAndLoss() call per requested year (not a single summarize_column_by:'Year' call, so
  // non-contiguous years — e.g. 2019 and 2026 with nothing in between — work the same as a
  // contiguous range), persisted under the SAME 'qbo_sync' source as the main sync so precedence
  // against 'activity_import'/'import' for those specific years resolves exactly like a full
  // sync would (see CHURCH_SOURCE_PRIORITY) — persistChurchEntries() only deletes/rewrites the
  // years actually present in `rows`, so every year not selected here is left completely alone.
  if (seg === 'finance/qb/sync-years' && method === 'POST') {
    const conn = await getConnection(db);
    if (!conn || !conn.realm_id) return json({ error: 'QuickBooks is not connected yet.' }, 400);
    const b = await req.json().catch(() => ({}));
    const years = Array.isArray(b.fiscal_years) ? [...new Set(b.fiscal_years.map(y => parseInt(y, 10)))].filter(Number.isFinite) : [];
    if (!years.length) return json({ error: 'fiscal_years is required (a non-empty array of years)' }, 400);
    const thisYear = new Date().getFullYear();
    if (years.some(y => y < 2000 || y > thisYear + 1)) return json({ error: 'fiscal_years contains an implausible year' }, 400);
    let fresh;
    try { fresh = await ensureFreshAccessToken(env, db, conn); }
    catch (e) { return json({ error: 'QuickBooks re-authentication failed — try disconnecting and reconnecting. (' + e.message + ')' }, 502); }
    const client = makeQboClient(env, fresh);
    const warnings = [];
    const churchRows = [];
    for (const year of years.sort((a, c) => a - c)) {
      const pnl = await fetchQboJson(
        `Profit & Loss (${year})`,
        client.profitAndLoss({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
        warnings
      );
      if (pnl && pnl.Rows) flattenReportTree(pnl.Rows.Row, [], null, makeSingleYearActualExtractor(year), churchRows);
    }
    const syncedAt = new Date().toISOString();
    await persistChurchEntries(db, churchRows, syncedAt);
    return json({ ok: true, syncedAt, warnings, years, churchEntriesSynced: churchRows.length });
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
    // makeDaycareClient can now also be built from the rooms URL alone, so check for the method
    // this handler actually calls rather than for a truthy client.
    if (!client || !client.summary) return json({ error: 'The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).' }, 503);
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
    await recordImport(db, 'daycare_church_budget', `FY${year}`);
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
    await recordImport(db, 'daycare_bulk', `${ops.length} row(s)`);
    return json({ ok: true, imported: ops.length });
  }

  // ── Daycare: room-level monthly aggregates (Daycare Report, Screen 3) ────────────────────
  // Four figures per room per month plus a waitlist count — capacity, average daily enrolled,
  // billed revenue, labor cost — and deliberately nothing else. Returns available:false rather
  // than an error when no period has been synced, so the report degrades to the existing
  // category-by-year table instead of blanking: the daycare app's own endpoint for this does not
  // exist yet (see DAYCARE_API.md in the design handoff), and this half has to ship without it.
  if (seg === 'finance/daycare/rooms' && method === 'GET') {
    const requested = url.searchParams.get('period');
    const latest = requested
      ? { period: requested }
      : await db.prepare('SELECT period FROM finance_daycare_rooms ORDER BY period DESC LIMIT 1').first();
    if (!latest?.period) return json({ available: false, period: null, rooms: [], occupancy: computeRoomOccupancy([]) });
    const rooms = (await db.prepare(
      'SELECT * FROM finance_daycare_rooms WHERE period=? ORDER BY room_name'
    ).bind(latest.period).all()).results || [];
    if (!rooms.length) return json({ available: false, period: latest.period, rooms: [], occupancy: computeRoomOccupancy([]) });
    const periodsRow = (await db.prepare('SELECT DISTINCT period FROM finance_daycare_rooms ORDER BY period').all()).results || [];
    return json({
      available: true,
      period: latest.period,
      periods: periodsRow.map(p => p.period),
      rooms,
      occupancy: computeRoomOccupancy(rooms),
      syncedAt: rooms[0].synced_at || '',
    });
  }

  // Wholesale-replaces one period's rooms, the same pattern finance/daycare/sync uses for the
  // money rows — a room that disappears from the daycare app's response for a period is meant to
  // disappear here too, not linger as a stale row nobody can delete.
  if (seg === 'finance/daycare/rooms/sync' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: syncing daycare room data requires admin access' }, 403);
    const client = makeDaycareClient(env);
    if (!client || !client.rooms) return json({ error: 'Daycare app room API is not configured (DAYCARE_ROOMS_API_URL)' }, 400);
    let payload;
    try {
      const res = await client.rooms();
      if (!res.ok) return json({ error: `Daycare app returned ${res.status}` }, 502);
      payload = await res.json();
    } catch (e) {
      return json({ error: `Could not reach the daycare app: ${e.message}` }, 502);
    }
    const period = String(payload?.period || '');
    if (!/^\d{4}-\d{2}$/.test(period)) return json({ error: 'Daycare app response is missing a valid "period" (YYYY-MM)' }, 502);
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    const syncedAt = new Date().toISOString();
    const ops = [db.prepare('DELETE FROM finance_daycare_rooms WHERE period=?').bind(period)];
    for (const r of rooms) {
      if (!r || !r.name) continue;
      ops.push(db.prepare(
        `INSERT INTO finance_daycare_rooms
           (period,room_name,capacity_per_day,avg_daily_enrolled,billed_cents,labor_cost_cents,waitlist_families,seasonal,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(
        period, String(r.name),
        Number.isFinite(r.capacity_per_day) ? r.capacity_per_day : null,
        Number.isFinite(r.avg_daily_enrolled) ? r.avg_daily_enrolled : null,
        Number.isFinite(r.billed_cents) ? Math.round(r.billed_cents) : null,
        Number.isFinite(r.labor_cost_cents) ? Math.round(r.labor_cost_cents) : null,
        Number.isFinite(r.waitlist_families) ? Math.round(r.waitlist_families) : 0,
        r.seasonal ? 1 : 0,
        syncedAt
      ));
    }
    await db.batch(ops);
    return json({ ok: true, period, rooms: ops.length - 1, syncedAt });
  }

  // ── Revenue-stream classification (Financial Health page) ────────────────────────────────
  // GET returns the stored per-group overrides alongside whatever the current year's data
  // actually resolves to, so the editor lists the real groups this church has rather than asking
  // an admin to type account names from memory.
  if (seg === 'finance/revenue-streams' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const overrides = await readRevenueStreamOverrides(db);
    const rows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
    const resolved = computeRevenueStreams(resolveChurchYearPrecedence(rows), overrides);
    return json({ year, overrides, ...resolved });
  }
  if (seg === 'finance/revenue-streams' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing revenue-stream classification requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const map = {};
    for (const [label, stream] of Object.entries(b.map || {})) {
      if (!REVENUE_STREAMS.includes(stream)) return json({ error: `Invalid stream "${stream}" for "${label}"` }, 400);
      map[String(label)] = stream;
    }
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_revenue_streams',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify({ map })).run();
    return json({ ok: true, map });
  }

  // ── Flow diagram ("How the money moves") ─────────────────────────────────────────────────
  // The contract the design handoff names. Amounts only, never geometry — the layout is computed
  // client-side. The Health page reads the same figures off church/this-year rather than calling
  // this, so the two can never disagree: both come from computeFlowDiagram().
  if (seg === 'finance/flow' && method === 'GET') {
    const year = parseInt(url.searchParams.get('fy'), 10) || new Date().getFullYear();
    const rows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
    const entries = resolveChurchYearPrecedence(rows);
    const diagram = computeFlowDiagram(entries, {
      streamOverrides: await readRevenueStreamOverrides(db),
      expenseOverrides: await readFlowExpenseOverrides(db),
    });
    return json({ fiscal_year: year, as_of: finChurchAsOfIso(entries), ...diagram });
  }

  // Expense-category mapping — the validation report the handoff asks for, plus the editor that
  // resolves it. Same shape and same guarantees as the revenue-stream mapping above.
  if (seg === 'finance/flow-expense-map' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const overrides = await readFlowExpenseOverrides(db);
    const rows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
    const entries = resolveChurchYearPrecedence(rows);
    const groups = new Map();
    for (const r of entries) {
      if (r.classification !== 'Expenses' && r.classification !== 'Other Expenses' && r.classification !== 'Cost of Goods Sold') continue;
      const label = expenseGroupLabel(r.category_path, r.account_name);
      if (!label) continue;
      if (!groups.has(label)) groups.set(label, { label, cents: 0, ...classifyFlowExpense(label, overrides) });
      groups.get(label).cents += (r.own_actual_cents || 0);
    }
    return json({
      year, overrides, categories: FLOW_EXPENSE_CATEGORIES,
      groups: [...groups.values()].sort((a, b) => b.cents - a.cents),
    });
  }
  if (seg === 'finance/flow-expense-map' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing the expense-category mapping requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const map = {};
    for (const [label, key] of Object.entries(b.map || {})) {
      if (!FLOW_EXPENSE_KEYS.includes(key)) return json({ error: `Invalid category "${key}" for "${label}"` }, 400);
      map[String(label)] = key;
    }
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_flow_expense_map',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify({ map })).run();
    return json({ ok: true, map });
  }

  // ── Cash policy (runway card) ────────────────────────────────────────────────────────────
  if (seg === 'finance/cash-policy' && method === 'GET') return json(await readCashPolicy(db));
  if (seg === 'finance/cash-policy' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing the cash policy requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const months = Number(b.policy_floor_months);
    if (!Number.isFinite(months) || months < 0 || months > 60) return json({ error: 'policy_floor_months must be between 0 and 60' }, 400);
    let cents = null;
    if (b.cash_on_hand_cents != null && b.cash_on_hand_cents !== '') {
      cents = Math.round(Number(b.cash_on_hand_cents));
      if (!Number.isFinite(cents)) return json({ error: 'Invalid cash_on_hand_cents' }, 400);
    }
    const accountCode = String(b.cash_account_code || '').trim();
    if (accountCode && !/^[\w.-]{1,32}$/.test(accountCode)) return json({ error: 'cash_account_code should be an account code like 11027' }, 400);
    const budgetCode = String(b.general_fund_budget_code || '').trim();
    if (budgetCode && !/^[\w.-]{1,32}$/.test(budgetCode)) return json({ error: 'general_fund_budget_code should be an account code like 40085' }, 400);
    const value = { policy_floor_months: months, cash_on_hand_cents: cents, cash_account_code: accountCode, general_fund_budget_code: budgetCode };
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_cash_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify(value)).run();
    return json({ ok: true, ...value });
  }

  // ── Import staleness (Data & Imports tab) ────────────────────────────────────────────────
  if (seg === 'finance/import-status' && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM finance_import_log').all()).results || [];
    const byKey = {};
    for (const r of rows) byKey[r.importer_key] = { lastImportedAt: r.last_imported_at, note: r.note || '', derived: false };
    const missing = new Set(FINANCE_IMPORTERS.map(i => i.key).filter(k => !byKey[k]));
    Object.assign(byKey, await deriveImportDates(db, missing));
    return json({ importers: FINANCE_IMPORTERS.map(i => ({ ...i, ...(byKey[i.key] || { lastImportedAt: '', note: '', derived: false }) })) });
  }

  // ── Daycare: per-cell Budget override (editable directly in the Daycare Report table) ────
  // Actual always comes from the church's own Budget/Actuals import ("Import from Church Budget
  // (MDO accounts)", source='church_budget_import') — never hand-typed here, per the user's
  // explicit correction: "Actual should come from the budget from the church." This endpoint
  // only ever touches the Budget side of one (year, category) cell, tagged
  // source='manual_budget_override', so a typed-in historical budget figure can coexist with —
  // and take precedence over, see finAggregateDaycareByYear's override pass — whatever budget
  // figure the church import may also have brought in for that same cell, without the two
  // silently summing together. Deleting any existing override first makes re-saving (or clearing
  // by omitting `budget`) idempotent rather than additive.
  if (seg === 'finance/daycare/budget-override' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: editing daycare budget data requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const year = parseInt(b.year, 10);
    if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
    if (!b.category || !String(b.category).trim()) return json({ error: 'category is required' }, 400);
    const period = String(year);
    const category = String(b.category).trim();
    const ops = [db.prepare(`DELETE FROM finance_daycare_entries WHERE period=? AND category=? AND entry_type='budget' AND source='manual_budget_override'`).bind(period, category)];
    let cents = null;
    if (b.budget !== '' && b.budget != null) {
      cents = Math.round(Number(b.budget) * 100);
      if (!Number.isFinite(cents)) return json({ error: 'Invalid budget amount' }, 400);
      ops.push(db.prepare(`INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,source) VALUES (?,?,'budget',?,'manual_budget_override')`).bind(period, category, cents));
    }
    await db.batch(ops);
    return json({ ok: true, year, category, budgetCents: cents });
  }

  // ── Daycare: Utilities/Insurance cost-share config + live computation ────────────────────
  if (seg === 'finance/daycare/allocation-config' && method === 'GET') {
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_daycare_allocation_config'").first();
    let cfg = { utilityPct: 0.5, insurancePct: 0.5 };
    if (row) { try { cfg = { ...cfg, ...JSON.parse(row.value) }; } catch { /* keep default */ } }
    return json(cfg);
  }
  if (seg === 'finance/daycare/allocation-config' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing the daycare cost-share requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const utilityPct = Number(b.utilityPct);
    const insurancePct = Number(b.insurancePct);
    if (!Number.isFinite(utilityPct) || !Number.isFinite(insurancePct)) return json({ error: 'utilityPct and insurancePct must be numbers (e.g. 0.5 for 50%)' }, 400);
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_daycare_allocation_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify({ utilityPct, insurancePct })).run();
    return json({ ok: true });
  }
  if (seg === 'finance/daycare/allocation' && method === 'GET') {
    const yearsParam = url.searchParams.get('years') || '';
    const years = yearsParam.split(',').map(y => parseInt(y, 10)).filter(Number.isFinite);
    if (!years.length) return json({ error: 'years is required (comma-separated)' }, 400);
    const cfgRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_daycare_allocation_config'").first();
    let cfg = { utilityPct: 0.5, insurancePct: 0.5 };
    if (cfgRow) { try { cfg = { ...cfg, ...JSON.parse(cfgRow.value) }; } catch { /* keep default */ } }
    const placeholders = years.map(() => '?').join(',');
    const allRows = (await db.prepare(`SELECT * FROM finance_church_entries WHERE fiscal_year IN (${placeholders}) AND period_month=0`).bind(...years).all()).results || [];
    const rowsByYear = {};
    for (const year of years) rowsByYear[year] = resolveChurchYearPrecedence(allRows.filter(r => r.fiscal_year === year));
    const allocation = computeMdoUtilityInsuranceAllocation(rowsByYear, cfg.utilityPct, cfg.insurancePct);
    return json({ years, utilityPct: cfg.utilityPct, insurancePct: cfg.insurancePct, allocation });
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
    return json(await coalesceChurchYear(year, () => buildChurchThisYear(db, year)));
  }

  // ── Church Report v2: Multi-Year — persisted-table read, one bulk query + JS grouping ──
  if (seg === 'finance/church/multi-year' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    const currentYear = new Date().getFullYear();
    // Default is EVERY year that has real reported figures, not a rolling five-year window — the
    // same fix made for the Balance Sheet trend, and this table is the one that actually had the
    // hidden history: this church's income statement runs back to 2019 while the default started
    // at currentYear-4, so 2019-2021 were on file and invisible until someone widened From/To.
    //
    // ⚠ `plan_committed` is EXCLUDED from what sets the default, deliberately. That source is a
    // future year's committed budget plan (see the Planning tab's commit action), and this view is
    // a historical actuals-and-budget trend — letting a forecast year in by default would put a
    // projection on the chart beside real years with nothing saying which is which. It still
    // resolves normally when a range explicitly names it, and `resolveChurchYearPrecedence` is
    // untouched. `manual_actual_override` is NOT excluded: it is a correction to a real actual.
    let years;
    if (yearsParam) {
      years = yearsParam.split(',').map(y => parseInt(y, 10)).filter(Number.isFinite);
    } else {
      const yearRows = (await db.prepare(
        `SELECT DISTINCT fiscal_year FROM finance_church_entries
          WHERE period_month=0 AND source != 'plan_committed' ORDER BY fiscal_year`
      ).all()).results || [];
      years = yearRows.map(r => Number(r.fiscal_year)).filter(Number.isFinite);
      // Nothing imported or synced yet: fall back to the rolling window, so the From/To picker
      // rendered above the empty state still shows a sensible pair rather than a blank or NaN.
      if (!years.length) years = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
    }
    if (!years.length) return json({ error: 'No valid years requested' }, 400);
    const placeholders = years.map(() => '?').join(',');
    const allRows = (await db.prepare(`SELECT * FROM finance_church_entries WHERE fiscal_year IN (${placeholders}) AND period_month=0`).bind(...years).all()).results || [];
    const resolved = resolveChurchYearPrecedence(allRows);
    const byYear = {};
    const streamsByYear = {};
    const streamOverridesMulti = await readRevenueStreamOverrides(db);
    years.forEach(y => {
      const yearRows = resolved.filter(r => r.fiscal_year === y);
      byYear[y] = computeYearSummary(yearRows);
      // Donor/earned/passive per year, so the Health page's five-year mix chart reads the same
      // classification the current-year mix bar does rather than a second, parallel rule.
      streamsByYear[y] = computeRevenueStreams(yearRows, streamOverridesMulti);
    });
    return json({ years, byYear, streamsByYear });
  }

  // ── Clear stored Church budget/actuals data (user decision 2026-07-28: after repeated
  // QuickBooks live-sync issues, starting fresh from re-downloaded QuickBooks exports imported
  // month-by-month via the existing CSV import tools). Deliberately narrow, per the user's
  // explicit correction mid-session — only the church budget/actuals themselves, NOT Daycare
  // Report, Balance Sheet, or Budget Planning data (all of which stay untouched), and never
  // Commercial Property or any giving data. finance_qb_snapshot is included alongside
  // finance_church_entries because it's the same data under a different cache — the Overview
  // tab's "Budget vs. Actual" card reads directly from this snapshot, not from
  // finance_church_entries, so leaving it out would let stale numbers linger there after a
  // clear. Same confirm-count safety pattern as giving/force-remove-orphans: preview returns
  // exact row counts, the clear call must echo them back exactly, so a stale page (data changed
  // between preview and click) is refused rather than blindly wiping.
  const CLEAR_TABLES = ['finance_church_entries', 'finance_qb_snapshot'];
  if (seg === 'finance/church/clear-all-preview' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied: clearing financial report data requires admin access' }, 403);
    const counts = {};
    for (const t of CLEAR_TABLES) {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      counts[t] = r?.n || 0;
    }
    return json({ counts });
  }
  if (seg === 'finance/church/clear-all' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: clearing financial report data requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const confirmCounts = b.confirm_counts || {};
    const actualCounts = {};
    for (const t of CLEAR_TABLES) {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      actualCounts[t] = r?.n || 0;
    }
    const mismatch = CLEAR_TABLES.some(t => confirmCounts[t] !== actualCounts[t]);
    if (mismatch) {
      return json({ error: 'Confirmation mismatch — data has changed since the preview ran. Re-load and try again.', expected: confirmCounts, actual: actualCounts }, 409);
    }
    const ops = CLEAR_TABLES.map(t => db.prepare(`DELETE FROM ${t}`));
    await db.batch(ops);
    try {
      await db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
      ).bind('clear_finance_report_data', 'finance', null, '', CLEAR_TABLES.join(','), '', JSON.stringify(actualCounts)).run();
    } catch { /* audit log is best-effort, never block the clear on it */ }
    return json({ ok: true, cleared: actualCounts });
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
    await recordImport(db, 'church_budget', `FY${fiscalYear}`);
    return json({ ok: true, fiscalYear, imported: rows.length });
  }

  // ── Church Report: Monthly P&L import (unblocks YoY/Supplies/Trend cards without live
  // QuickBooks sync — see FIN2). A "Profit and Loss by Month" export has one column per month
  // instead of one Actual/Budget pair, so it needs its own sheet-finder/parser, but reuses the
  // same preview-then-commit shape and the same xlsx-reading infrastructure. ─────────────────
  if (seg === 'finance/church/monthly-import-preview' && method === 'POST') {
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    // Outer catch so an unexpected throw anywhere below reports what actually happened instead of
    // reaching the worker's top-level handler, which returns a deliberately opaque
    // "Internal server error. Please try again." — undiagnosable from a bug report. Every
    // *expected* failure below still returns its own specific 4xx.
    try {
      const sheet = findMonthlyPnLSheet(sheets);
      if (!sheet) return json({ error: 'Could not find a month-by-month "Profit and Loss by Month" sheet (a sheet with columns like "Jan 2026", "Feb 2026", ...) in this file.' }, 400);
      let parsed;
      try { parsed = parseMonthlyPnLGrid(sheet.grid, sheet.colAIndent); }
      catch (e) { return json({ error: e.message }, 400); }
      if (!parsed.rows.length) return json({ error: 'Found ' + parsed.skipped.length + ' row(s) in this sheet but could not read any of them as accounts — no indentation was detected, so the account hierarchy could not be determined. Check that the export preserves the row indenting QuickBooks applies to sub-accounts.' }, 400);
      return json({ sheetName: sheet.name, years: parsed.years, monthsByYear: parsed.monthsByYear, rows: parsed.rows, skipped: parsed.skipped });
    } catch (e) {
      return json({ error: 'Could not read this Monthly P&L sheet: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  }

  // Commit step: wholesale-replaces any existing source='monthly_import' rows for every fiscal
  // year present in the payload — the same replace-per-year pattern as the annual import, but
  // driven by each row's own fiscal_year so one multi-year file can be committed in whatever
  // slices the caller chooses (the UI sends one year at a time, for progress and payload size).
  if (seg === 'finance/church/monthly-import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number'
      || !Number.isInteger(r.fiscal_year) || r.fiscal_year < 1900 || r.fiscal_year > 2200
      || !Number.isInteger(r.period_month) || r.period_month < 1 || r.period_month > 12
      || !Number.isFinite(r.own_actual_cents));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    const years = [...new Set(rows.map(r => r.fiscal_year))].sort((a, b2) => a - b2);
    // The write is the one step here that can fail for reasons only the database knows (a quota,
    // a batch limit, a constraint). Unguarded it reached the worker's top-level handler, which
    // deliberately hides internals and returns a bare "Internal server error. Please try again." —
    // true but undiagnosable, and this route is already finance-gated, so the real message is
    // safe to show and is the difference between a fixable report and a guess. Same reasoning as
    // the column-count error in api-import.js.
    try {
      await persistChurchEntriesMonthlyImport(db, rows, new Date().toISOString());
    } catch (e) {
      return json({ error: 'Could not save ' + rows.length + ' rows for '
        + (years.length === 1 ? 'FY' + years[0] : 'FY' + years[0] + '-FY' + years[years.length - 1])
        + ': ' + (e && e.message ? e.message : String(e)) }, 500);
    }
    // The note describes everything now stored, not just this request's slice — the UI commits a
    // multi-year file one year per request, so a per-request note would leave the Data & Imports
    // card claiming only the last year was ever imported.
    let lo = years[0], hi = years[years.length - 1];
    // try/catch, not .catch() — a synchronous throw here would escape a promise-tail handler and
    // take down the whole route AFTER the rows were already written, leaving the data imported but
    // the log row missing. The note is a nicety; the import it describes has already succeeded.
    // (Parameterless queries call .first() straight off .prepare() everywhere else in this file.)
    try {
      const stored = await db.prepare(
        `SELECT MIN(fiscal_year) AS lo, MAX(fiscal_year) AS hi FROM finance_church_entries WHERE source='monthly_import' AND period_month BETWEEN 1 AND 12`
      ).first();
      if (stored && stored.lo != null) { lo = stored.lo; hi = stored.hi; }
    } catch { /* fall back to this request's own year range */ }
    await recordImport(db, 'church_monthly_pnl', lo === hi ? `FY${lo}` : `FY${lo}-FY${hi}`);
    return json({ ok: true, years, imported: rows.length });
  }

  // ── Church Report: "Statement of Activity" multi-year import (nonprofit-wording P&L, one
  // column per year, Actual only — see parseActivityMultiYearGrid's own comment above). One
  // file spans many fiscal years, unlike the annual/monthly imports above, so the commit step
  // takes a `years` array and persists all of them in a single call. ─────────────────────────
  if (seg === 'finance/church/activity-import-preview' && method === 'POST') {
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    const sheet = findActivityMultiYearSheet(sheets);
    if (!sheet) return json({ error: 'Could not find a year-by-year "Statement of Activity" sheet (a sheet with columns like "2019", "2020", ...) in this file.' }, 400);
    let parsed;
    try { parsed = parseActivityMultiYearGrid(sheet.grid, sheet.colAIndent); }
    catch (e) { return json({ error: e.message }, 400); }
    return json({ sheetName: sheet.name, years: parsed.years, rows: parsed.rows, skipped: parsed.skipped });
  }

  // Commit step: field-preserving upsert (see persistChurchEntriesActivityImport's own comment) —
  // a row only ever carries own_actual_cents OR own_budget_cents, never both, since Activity and
  // Budget by Year are two separate files each supplying one field.
  if (seg === 'finance/church/activity-import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const years = Array.isArray(b.years) ? b.years.map(y => parseInt(y, 10)).filter(Number.isFinite) : [];
    if (!years.length) return json({ error: 'years is required' }, 400);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number'
      || !Number.isInteger(r.fiscal_year) || !(Number.isFinite(r.own_actual_cents) || Number.isFinite(r.own_budget_cents)));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    await persistChurchEntriesActivityImport(db, rows, years, new Date().toISOString());
    await recordImport(db, 'church_activity_multi', years.join(', '));
    return json({ ok: true, years, imported: rows.length });
  }

  // ── Church Report: "Budget by Year" multi-year import — same shape as the Statement of
  // Activity import above (one file, one column per year), but budget-only instead of
  // actual-only. Shares the 'import_activity' source and the same field-preserving merge, so
  // uploading this and the Activity file (in either order) combines into complete rows.
  if (seg === 'finance/church/budget-multi-year-import-preview' && method === 'POST') {
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    const sheet = findBudgetMultiYearSheet(sheets);
    if (!sheet) return json({ error: 'Could not find a year-by-year "Budget by Year" sheet (a sheet with columns like "2019", "2020", ...) in this file.' }, 400);
    let parsed;
    try { parsed = parseBudgetMultiYearGrid(sheet.grid, sheet.colAIndent); }
    catch (e) { return json({ error: e.message }, 400); }
    return json({ sheetName: sheet.name, years: parsed.years, rows: parsed.rows, skipped: parsed.skipped });
  }
  if (seg === 'finance/church/budget-multi-year-import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const years = Array.isArray(b.years) ? b.years.map(y => parseInt(y, 10)).filter(Number.isFinite) : [];
    if (!years.length) return json({ error: 'years is required' }, 400);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number'
      || !Number.isInteger(r.fiscal_year) || !(Number.isFinite(r.own_actual_cents) || Number.isFinite(r.own_budget_cents)));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    await persistChurchEntriesBudgetMultiYearImport(db, rows, years, new Date().toISOString());
    await recordImport(db, 'church_budget_multi', years.join(', '));
    return json({ ok: true, years, imported: rows.length });
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
    return json({
      sheetName: sheet.name, fiscalYear: parsed.fiscalYear, asOfDate: parsed.asOfDate, rows: parsed.rows, skipped: parsed.skipped,
      basis: parsed.basis, equityReclass: computeEquityReclassification(parsed.rows),
    });
  }

  if (seg === 'finance/church/balances/import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const fiscalYear = parseInt(b.fiscal_year, 10);
    if (!Number.isFinite(fiscalYear)) return json({ error: 'fiscal_year is required' }, 400);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number' || !Number.isFinite(r.own_balance_cents));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    // See the Monthly P&L commit route: unguarded, a database failure here reaches the worker's
    // top-level handler and becomes an opaque "Internal server error", which cannot be diagnosed
    // from a bug report. This route is finance-gated, so the real message is safe to return.
    try {
      await persistChurchBalancesImport(db, rows, fiscalYear, String(b.as_of_date || ''), new Date().toISOString());
    } catch (e) {
      return json({ error: 'Could not save ' + rows.length + ' balance rows for FY' + fiscalYear
        + ': ' + (e && e.message ? e.message : String(e)) }, 500);
    }
    await recordImport(db, 'church_balance', `FY${fiscalYear}`);
    return json({ ok: true, fiscalYear, imported: rows.length });
  }

  // ── Church Report: "Statement of Financial Position" multi-year import (one file spans many
  // fiscal years, like the Statement of Activity import above) ───────────────────────────────
  if (seg === 'finance/church/balances/multi-year-import-preview' && method === 'POST') {
    const form = await req.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file uploaded' }, 400);
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413);
    let sheets;
    try { sheets = await parseXlsxAllSheets(await file.arrayBuffer()); }
    catch (e) { return json({ error: 'Could not read this file as an Excel workbook: ' + e.message }, 400); }
    const sheet = findFinancialPositionMultiYearSheet(sheets);
    if (!sheet) return json({ error: 'Could not find a year-by-year "Statement of Financial Position" sheet (a sheet with columns like "2019", "2020", ...) in this file.' }, 400);
    let parsed;
    try { parsed = parseFinancialPositionMultiYearGrid(sheet.grid, sheet.colAIndent); }
    catch (e) { return json({ error: e.message }, 400); }
    const equityReclassByYear = {};
    for (const y of parsed.years) equityReclassByYear[y] = computeEquityReclassification(parsed.rows.filter(r => r.fiscal_year === y));
    return json({ sheetName: sheet.name, years: parsed.years, rows: parsed.rows, skipped: parsed.skipped, basis: parsed.basis, equityReclassByYear });
  }

  if (seg === 'finance/church/balances/multi-year-import' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const years = Array.isArray(b.years) ? b.years.map(y => parseInt(y, 10)).filter(Number.isFinite) : [];
    if (!years.length) return json({ error: 'years is required' }, 400);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json({ error: 'No rows to import' }, 400);
    const bad = rows.find(r => !r.category_path || !r.classification || !r.account_name || typeof r.depth !== 'number'
      || !Number.isInteger(r.fiscal_year) || !Number.isFinite(r.own_balance_cents));
    if (bad) return json({ error: 'Malformed row in import payload' }, 400);
    try {
      await persistChurchBalancesMultiYearImport(db, rows, years, new Date().toISOString());
    } catch (e) {
      return json({ error: 'Could not save ' + rows.length + ' balance rows for FY' + years[0]
        + (years.length > 1 ? '-FY' + years[years.length - 1] : '')
        + ': ' + (e && e.message ? e.message : String(e)) }, 500);
    }
    await recordImport(db, 'church_balance_multi', years.join(', '));
    return json({ ok: true, years, imported: rows.length });
  }

  // Read: the latest imported balance sheet for a given year (defaults to current year) — a
  // fresh import for the same year wholesale-replaces the prior one, so there's only ever one.
  if (seg === 'finance/church/balances' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const rows = (await db.prepare('SELECT * FROM finance_church_balances WHERE fiscal_year=? ORDER BY category_path').bind(year).all()).results || [];
    if (!rows.length) return json({ year, rows: [], summary: null, asOfDate: '', equityReclass: null });
    return json({ year, rows, summary: computeBalanceSummary(rows), asOfDate: rows[0].as_of_date || '', equityReclass: computeEquityReclassification(rows) });
  }

  // Multi-year trend: one bulk query + JS grouping (matches this app's existing performance
  // conventions, same pattern as finance/church/multi-year for the Income Statement side).
  if (seg === 'finance/church/balances/multi-year' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    const currentYear = new Date().getFullYear();
    // Default is EVERY year that actually has a balance sheet, not a rolling five-year window.
    // That window silently hid real history: this church's income statement runs back to 2019
    // while the default trend started at currentYear-4, so an imported 2019 balance sheet would
    // never appear until someone widened the range by hand. Deliberately the distinct years
    // PRESENT rather than the contiguous span between earliest and latest — a year with no rows
    // still gets a zeroed summary from computeBalanceSummary(), which draws as a real $0
    // Assets/Liabilities/Equity bar and reads as "the church had nothing" rather than "nothing was
    // uploaded". The tie-out loses nothing by their absence: computeBalanceVsPnlReconciliation
    // already skips a year with no rows outright (its own `if (!hasBalance(year)) continue`), so a
    // gap year never produced a row either way. An explicit ?years= range still requests exactly
    // what it names, gaps included — which is how you go looking for what is missing.
    let years;
    if (yearsParam) {
      years = yearsParam.split(',').map(y => parseInt(y, 10)).filter(Number.isFinite);
    } else {
      const yearRows = (await db.prepare(
        'SELECT DISTINCT fiscal_year FROM finance_church_balances ORDER BY fiscal_year'
      ).all()).results || [];
      years = yearRows.map(r => Number(r.fiscal_year)).filter(Number.isFinite);
      // Nothing imported at all: fall back to the rolling window, so the range picker rendered
      // above the empty state still shows a sensible From/To rather than a blank or NaN pair.
      if (!years.length) years = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
    }
    if (!years.length) return json({ error: 'No valid years requested' }, 400);
    // One year BEFORE the requested window is fetched too: the tie-out below needs the opening
    // equity of the earliest requested year, and without it that year would always report "no
    // prior balance sheet" purely because of where the range picker happens to start.
    const openingYear = Math.min(...years) - 1;
    const balanceYears = years.includes(openingYear) ? years : [...years, openingYear];
    const placeholders = balanceYears.map(() => '?').join(',');
    const allRows = (await db.prepare(`SELECT * FROM finance_church_balances WHERE fiscal_year IN (${placeholders})`).bind(...balanceYears).all()).results || [];
    const cashPolicy = await readCashPolicy(db);
    const byYear = {};
    const equityReclassByYear = {};
    const cashByYear = {};
    balanceYears.forEach(y => {
      const yearRows = allRows.filter(r => r.fiscal_year === y);
      byYear[y] = computeBalanceSummary(yearRows);
      if (years.includes(y)) {
        equityReclassByYear[y] = yearRows.length ? computeEquityReclassification(yearRows) : null;
        cashByYear[y] = yearRows.length ? computeYearCashSummary(yearRows, cashPolicy.cash_account_code) : null;
      }
    });
    // Net income for the same years, from the income-statement table — same precedence resolution
    // and same period_month=0 filter the Multi-Year income view uses, so the figure quoted in the
    // tie-out is the identical number that view shows and the two can never disagree.
    const pnlRows = (await db.prepare(
      `SELECT * FROM finance_church_entries WHERE fiscal_year IN (${years.map(() => '?').join(',')}) AND period_month=0`
    ).bind(...years).all()).results || [];
    const resolvedPnl = resolveChurchYearPrecedence(pnlRows);
    const netIncomeByYear = {};
    years.forEach(y => {
      const yearRows = resolvedPnl.filter(r => r.fiscal_year === y);
      netIncomeByYear[y] = yearRows.length ? computeYearSummary(yearRows).netIncome.actualCents : null;
    });
    return json({ years, byYear, equityReclassByYear, cashByYear, cashAccountCode: cashPolicy.cash_account_code || '', netIncomeByYear,
      reconciliation: computeBalanceVsPnlReconciliation(years, byYear, netIncomeByYear) });
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
    // base year (or one with no actual at all, only a budget) is used as-is. Elapsed time is
    // measured in WEEKS, not calendar months — a calendar month is ambiguous the moment you're
    // partway through it (is the 5th of August "1 month" or "0 months" elapsed? both answers are
    // defensible and give meaningfully different projections), where "days since Jan 1, divided
    // by 7" has no such ambiguity and tracks this church's actual giving rhythm (weekly Sunday
    // offerings) more closely than a monthly bucket does. through_week is an optional explicit
    // override (real caller never sends it — only tests, for determinism); production always
    // falls back to the real elapsed weeks for the real current year.
    const now = new Date();
    const explicitThroughWeek = Number(b.through_week);
    const throughWeek = Number.isFinite(explicitThroughWeek) && b.through_week !== undefined && b.through_week !== null && b.through_week !== ''
      ? explicitThroughWeek
      : (baseYear === now.getFullYear()) ? weeksElapsedInYear(now) : 52;
    const prorated = throughWeek < 52;
    const ops = [];
    let generated = 0;
    for (const r of resolved) {
      const baseAmountCents = (r.own_actual_cents && prorated)
        ? Math.round(r.own_actual_cents * (52 / throughWeek))
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
    return json({ ok: true, generated, baseYear, targetYear, throughWeek, prorated });
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
      // Whole dollars only (see finPlanSanitizeWholeDollarInput on the frontend) — round to the
      // nearest dollar before converting to cents rather than trusting a fractional client value.
      const amountCents = Math.round(Number(r.planned_amount)) * 100;
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

  // Manual overrides for the "FY{base} Projected" column on the Planning table — a per-account
  // hand-typed correction to the automatic actual-to-date annualization (e.g. a bookkeeper who
  // knows a big year-end gift is coming that the weeks-elapsed math can't see). Same generic
  // chms_config JSON-blob pattern as the salary planner above, keyed by base fiscal year so a
  // saved override only ever applies to the year it was entered against: {"2026":{"Expenses:Utilities":123400}}
  // (cents). Not part of finance_budget_plan — that table's semantics are "the plan for a future
  // year," not "a correction to this year's own projected actual," and reusing it would make a
  // base year look like it had its own committed plan row.
  if (seg === 'finance/planning/base-projection' && method === 'GET') {
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_base_proj_overrides'").first();
    let overrides = {};
    if (row) { try { overrides = JSON.parse(row.value) || {}; } catch { overrides = {}; } }
    return json({ overrides });
  }
  if (seg === 'finance/planning/base-projection' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing the budget plan requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const year = parseInt(b.year, 10);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_base_proj_overrides'").first();
    let overrides = {};
    if (row) { try { overrides = JSON.parse(row.value) || {}; } catch { overrides = {}; } }
    const yearOverrides = Object.assign({}, overrides[String(year)]);
    for (const r of rows) {
      const category = String(r.category || '').trim();
      if (!category) continue;
      if (r.amount === '' || r.amount === null || r.amount === undefined) { delete yearOverrides[category]; continue; }
      // Whole dollars only (see finPlanSanitizeWholeDollarInput on the frontend).
      const amountCents = Math.round(Number(r.amount)) * 100;
      if (!Number.isFinite(amountCents)) return json({ error: `Invalid amount for ${category}` }, 400);
      yearOverrides[category] = amountCents;
    }
    overrides[String(year)] = yearOverrides;
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_base_proj_overrides',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify(overrides)).run();
    return json({ ok: true, year, saved: rows.length });
  }

  // Corrects one account's Actual figure for one year directly, without re-uploading or
  // re-syncing the whole file — the ask behind this endpoint. Stored as its own
  // finance_church_entries row (source='manual_actual_override'; see
  // CHURCH_ACTUAL_OVERRIDE_SOURCE/resolveChurchYearPrecedence above for how it's merged in), so
  // the correction is picked up by every reader of that resolver — Church Report, Financial
  // Health, Planning — not just the screen it was typed on. A future re-sync/re-import of the
  // same year doesn't erase it: the override still wins for that one category_path.
  // Whole-dollars-and-cents (unlike the whole-dollar-only Plan/Projected overrides above) — this
  // is a correction to a real posted amount, not a planning figure.
  if (seg === 'finance/church/actual-override' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: correcting an actual figure requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const year = parseInt(b.year, 10);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!Number.isFinite(year)) return json({ error: 'year is required' }, 400);
    if (!rows.length) return json({ error: 'No rows to save' }, 400);
    const ops = [];
    let saved = 0;
    for (const r of rows) {
      const category = String(r.category || '').trim();
      if (!category) return json({ error: 'Every row needs a category' }, 400);
      // period_month=0 = the annual row (see migrations/0018_finance_church_entries.sql) — this
      // never touches a monthly (1-12) row, same scoping every other church-entries writer here
      // uses.
      if (r.amount === '' || r.amount === null || r.amount === undefined) {
        ops.push(db.prepare(
          `DELETE FROM finance_church_entries WHERE fiscal_year=? AND period_month=0 AND category_path=? AND source=?`
        ).bind(year, category, CHURCH_ACTUAL_OVERRIDE_SOURCE));
        saved++;
        continue;
      }
      const amountCents = Math.round(Number(r.amount) * 100);
      if (!Number.isFinite(amountCents)) return json({ error: `Invalid amount for ${category}` }, 400);
      const classification = String(r.classification || 'Expenses');
      const accountName = String(r.account_name || category.split(':').pop() || category);
      const depth = Math.max(0, category.split(':').length - 1);
      ops.push(db.prepare(
        `INSERT INTO finance_church_entries
           (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, notes, synced_at)
         VALUES (?,0,?,?,?,?,0,?,NULL,?,'Manually corrected',datetime('now'))
         ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
           own_actual_cents=excluded.own_actual_cents, classification=excluded.classification,
           account_name=excluded.account_name, depth=excluded.depth, synced_at=excluded.synced_at`
      ).bind(year, classification, category, accountName, depth, amountCents, CHURCH_ACTUAL_OVERRIDE_SOURCE));
      saved++;
    }
    await db.batch(ops);
    return json({ ok: true, year, saved });
  }

  // Chart of Accounts — which board category a fund reads under on Planning's "Board view", and
  // what each category is called. Display only: nothing here touches finance_church_entries, so
  // the next QuickBooks sync/import lands in exactly the same accounts regardless of what's
  // assigned here. GET is read-only for any finance-gated caller; PUT (admin-only, matching every
  // other Planning-adjacent write) MERGES the rows/labels sent into whatever is already saved —
  // a category assignment/rename made from Planning's own inline picker and a bulk move made from
  // Chart of Accounts both land in the same store without one clobbering the other's unrelated
  // entries. An empty-string value clears that one entry back to the computed default.
  if (seg === 'finance/planning/board-categories' && method === 'GET') {
    return json(await readPlanningBoardCategories(db));
  }
  if (seg === 'finance/planning/board-categories' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing the chart of accounts requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const current = await readPlanningBoardCategories(db);
    const merged = {
      revenue: { ...current.revenue }, expense: { ...current.expense },
      revenueLabels: { ...current.revenueLabels }, expenseLabels: { ...current.expenseLabels },
      donorWrapperLabel: current.donorWrapperLabel,
    };
    if (b.revenue && typeof b.revenue === 'object') {
      for (const [path, key] of Object.entries(b.revenue)) {
        if (!path) continue;
        if (key === '' || key == null) { delete merged.revenue[path]; continue; }
        if (!REVENUE_STREAMS.includes(key)) return json({ error: `Invalid revenue category "${key}"` }, 400);
        merged.revenue[path] = key;
      }
    }
    if (b.expense && typeof b.expense === 'object') {
      for (const [path, key] of Object.entries(b.expense)) {
        if (!path) continue;
        if (key === '' || key == null) { delete merged.expense[path]; continue; }
        if (!BOARD_EXPENSE_KEYS.includes(key)) return json({ error: `Invalid expense category "${key}"` }, 400);
        merged.expense[path] = key;
      }
    }
    if (b.revenueLabels && typeof b.revenueLabels === 'object') {
      for (const [key, label] of Object.entries(b.revenueLabels)) {
        if (!REVENUE_STREAMS.includes(key)) continue;
        const clean = String(label || '').trim();
        if (clean) merged.revenueLabels[key] = clean; else delete merged.revenueLabels[key];
      }
    }
    if (b.expenseLabels && typeof b.expenseLabels === 'object') {
      for (const [key, label] of Object.entries(b.expenseLabels)) {
        if (!BOARD_EXPENSE_KEYS.includes(key)) continue;
        const clean = String(label || '').trim();
        if (clean) merged.expenseLabels[key] = clean; else delete merged.expenseLabels[key];
      }
    }
    if (typeof b.donorWrapperLabel === 'string') {
      merged.donorWrapperLabel = b.donorWrapperLabel.trim();
    }
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_planning_board_categories',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify(merged)).run();
    return json({ ok: true, ...merged });
  }

  // Purpose tags — a SECOND, independent axis over the same accounts and Compensation Planner
  // workers the Board Category system above already classifies, so one line can carry a board
  // category ("Salaries & Benefits") AND a free-form purpose ("Youth") at once. Its own
  // chms_config key, deliberately not layered onto finance_planning_board_categories — that
  // store's category set is a fixed 7-key allowlist (BOARD_EXPENSE_KEYS); purpose tags are
  // admin-defined and open-ended (add/rename/delete at will), which needs a different shape
  // entirely (a managed list, not a fixed enum). Only `categories` (keyed by Chart of Accounts
  // leaf category_path — a path is unique across the whole chart of accounts regardless of
  // revenue/expense, so one flat map covers both) is stored server-side. A Compensation Planner
  // worker's own tag is deliberately NOT a second server-side map keyed by accountCode — a worker
  // can be entered with no budget line at all (a real, supported state, see finCompRenderDrawer),
  // and keying by accountCode would either leave such a worker untaggable or silently tag every
  // other blank-accountCode worker identically. It lives instead as a plain `purposeTag` field on
  // the roster row itself (js-finance.js, saved through the existing salary-planner blob, same as
  // every other per-worker field), read here only to know which tag ids are still valid. v1 is
  // single-tag-only per line (scoped and confirmed with the user 2026-09-05) — a percentage split
  // for a worker whose role spans two purposes was raised and deliberately deferred, not built.
  async function readPurposeTags(db) {
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='finance_planning_purpose_tags'").first();
    const empty = { tags: [], categories: {} };
    if (!row) return empty;
    try {
      const v = JSON.parse(row.value) || {};
      return {
        tags: Array.isArray(v.tags) ? v.tags.filter(t => t && typeof t.id === 'string' && t.id && typeof t.label === 'string') : [],
        categories: v.categories && typeof v.categories === 'object' ? v.categories : {},
      };
    } catch { return empty; }
  }
  function finSlugifyPurposeTag(label, taken) {
    const base = String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tag';
    let id = base, n = 2;
    while (taken.has(id)) { id = base + '_' + n; n++; }
    taken.add(id);
    return id;
  }
  if (seg === 'finance/planning/purpose-tags' && method === 'GET') {
    return json(await readPurposeTags(db));
  }
  if (seg === 'finance/planning/purpose-tags' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Access denied: editing purpose tags requires admin access' }, 403);
    const b = await req.json().catch(() => ({}));
    const current = await readPurposeTags(db);
    let tags = current.tags;
    // A full replace, not a merge — this is what makes delete work by omission: rename keeps a
    // sent row's own id, add is a row with no id (a fresh slug is minted), and a tag left off the
    // array entirely is gone. `categories` below still merges, the same reasoning as the board
    // categories store: it comes from many different per-leaf pickers, none of which should be
    // able to wipe every other leaf's assignment just by saving its own one change.
    if (Array.isArray(b.tags)) {
      const takenIds = new Set();
      const existingById = new Map(current.tags.map(t => [t.id, t]));
      tags = [];
      for (const t of b.tags) {
        const label = String((t && t.label) || '').trim();
        if (!label) return json({ error: 'Every tag needs a label' }, 400);
        let id = t && typeof t.id === 'string' ? t.id.trim() : '';
        if (id && existingById.has(id) && !takenIds.has(id)) {
          takenIds.add(id);
        } else {
          id = finSlugifyPurposeTag(label, takenIds);
        }
        tags.push({ id, label });
      }
    }
    const finalIds = new Set(tags.map(t => t.id));
    const categories = { ...current.categories };
    if (b.categories && typeof b.categories === 'object') {
      for (const [path, tagId] of Object.entries(b.categories)) {
        if (!path) continue;
        if (tagId === '' || tagId == null) { delete categories[path]; continue; }
        if (!finalIds.has(tagId)) return json({ error: `Unknown purpose tag "${tagId}"` }, 400);
        categories[path] = tagId;
      }
    }
    // A deleted tag (omitted from b.tags) can leave a stale category assignment pointing at an id
    // that no longer exists — drop those rather than let a "ghost" tag keep showing up in the
    // by-purpose report with no way to see or clear it from the UI. (A worker's own purposeTag
    // field lives in the salary-planner blob, not here, and is cleaned up client-side — see
    // finPurposeTagsSaveList in js-finance.js.)
    for (const path of Object.keys(categories)) if (!finalIds.has(categories[path])) delete categories[path];
    const merged = { tags, categories };
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_planning_purpose_tags',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(JSON.stringify(merged)).run();
    return json({ ok: true, ...merged });
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


// ── Church Report "This Year": the payload builder, extracted from its route ───────────────
// This one payload feeds THREE screens (Financial Health, Church Report, Budget/Planning), so
// it is the most-requested computation in the app and the only one that scans giving_entries.
// Two things follow from that and are load-bearing:
//
//   1. It is a plain function of (db, year) — no req/env/url — so it can be memoized. Concurrent
//      callers asking for the same year share ONE computation via _churchYearInflight below,
//      rather than each running the giving scans again.
//   2. It reads giving_entries exactly TWICE, not four times. The per-fund annual totals are
//      summed in JS from the month-by-fund rows, and the giving-household COUNT is the row count
//      of the same per-household aggregate the donor bands are bucketed from. Four separate
//      aggregates over one year of giving were roughly 6.2M D1 row reads in a single trailing
//      window on 2026-09-04 and took the account past the free-tier ceiling, which then broke
//      unrelated church APIs. Adding a third scan here is not a local cost.
async function buildChurchThisYear(db, year) {
  const allRows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
  const entries = resolveChurchYearPrecedence(allRows);
  const summary = computeYearSummary(entries);
  // ── Giving scan 1 of 2: month by fund ──────────────────────────────────────
  // Every per-fund figure in this payload comes from these rows. The annual total per fund used
  // to be its own `GROUP BY fund_id` scan over the same year of the same table; it is now summed
  // in JS from the rows already read here. Skipping a fund_id with no row in `funds` preserves
  // the INNER JOIN the separate query did, so an entry pointing at a deleted fund stays out of
  // the fund list and out of givingCents exactly as it did before.
  const fundRows = (await db.prepare('SELECT id, name, category FROM funds').all()).results || [];
  const fundNameById = new Map(fundRows.map(f => [f.id, f.name]));
  const givingMonthlyRows = (await db.prepare(
    `SELECT CAST(substr(ge.contribution_date,6,2) AS INTEGER) AS m, ge.fund_id AS fund_id,
            COALESCE(SUM(ge.amount),0) AS cents
     FROM giving_entries ge
     WHERE ge.contribution_date BETWEEN ? AND ?
     GROUP BY m, ge.fund_id ORDER BY m`
  ).bind(`${year}-01-01`, `${year}-12-31`).all()).results || [];
  const fundTotals = new Map();
  for (const r of givingMonthlyRows) {
    if (!fundNameById.has(r.fund_id)) continue;
    fundTotals.set(r.fund_id, (fundTotals.get(r.fund_id) || 0) + (r.cents || 0));
  }
  const givingByFund = [...fundTotals.entries()]
    .map(([id, cents]) => ({ fundName: fundNameById.get(id), cents }))
    .sort((a, b) => b.cents - a.cents);
  const givingCents = givingByFund.reduce((sum, r) => sum + r.cents, 0);

  // Designated funds (25xxx) and the giving-household count, both for the Health page.
  //
  // ⚠ This deliberately no longer reads funds.category. That column is the Giving tab's own
  // lens and an admin sets it by hand, which made the donor card's restricted figure whatever
  // somebody had last ticked — reported live 2026-08-12 as $80,308 against a real restricted
  // income of roughly $8,000, because every pass-through fund was sitting in that category. The
  // account number is the church's own recorded judgment and needs no second maintenance.
  //
  // Balances come from the most recent balance sheet at or before this year, matching the cash
  // card's rule below: a designated fund's money is a liability, so its balance only ever
  // exists there. Households: a giver with no household counts as their own, matching how
  // reports/giving-bands scopes a household giver.
  const desigBalYearRow = await db.prepare(
    'SELECT MAX(fiscal_year) AS y FROM finance_church_balances WHERE fiscal_year <= ?'
  ).bind(year).first();
  const desigBalRows = desigBalYearRow?.y == null ? [] : ((await db.prepare(
    'SELECT account_name, own_balance_cents, has_children, as_of_date FROM finance_church_balances WHERE fiscal_year=?'
  ).bind(desigBalYearRow.y).all()).results || []);
  const designatedFunds = computeDesignatedFunds(givingByFund, desigBalRows);
  // ── Giving scan 2 of 2: per-household annual totals ─────────────────────────────
  // The giving-household count and the appeal card's donor bands are the same aggregate read two
  // ways — the count is how many households gave, the bands are those same households bucketed —
  // so they are one scan, counted and bucketed in JS. They were two separate scans of a full
  // year of giving_entries, which is a query D1 bills twice for one answer.
  //
  // Bands are deliberately ANNUAL totals rather than reused from reports/giving-bands, which
  // buckets by weekly/monthly pace — translating a per-week band into "$2,000+ a year" would be
  // an approximation sitting next to an exact ask ladder. The card's "Open giving bands →" link
  // still goes to that report for the full analysis.
  //
  // A giver with no household counts as their own, matching how reports/giving-bands scopes a
  // household giver. One row per distinct household key, so the row count IS the distinct count.
  const householdTotalRows = (await db.prepare(
    `SELECT SUM(ge.amount) AS t
     FROM giving_entries ge JOIN people p ON p.id = ge.person_id
     WHERE ge.contribution_date BETWEEN ? AND ? AND ge.person_id IS NOT NULL
       AND LOWER(COALESCE(p.member_type,'')) != 'organization'
     GROUP BY CASE WHEN p.household_id IS NOT NULL AND p.household_id != 0
                   THEN 'h:' || p.household_id ELSE 'p:' || p.id END`
  ).bind(`${year}-01-01`, `${year}-12-31`).all()).results || [];
  const givingHouseholds = householdTotalRows.length;
  let bandHigh = 0, bandMid = 0, bandLow = 0;
  for (const r of householdTotalRows) {
    const t = r.t || 0;
    if (t >= 200000) bandHigh++;
    else if (t >= 50000) bandMid++;
    else if (t > 0) bandLow++;
  }
  const donorBands = [
    { label: '$2,000+ / yr', households: bandHigh },
    { label: '$500–$2,000', households: bandMid },
    { label: 'Under $500', households: bandLow },
  ];

  // Revenue read by who controls it rather than by account group, plus where it flows back out.
  // Both are pure functions over the rows already fetched above — no extra queries.
  const streamOverrides = await readRevenueStreamOverrides(db);
  const revenueStreams = computeRevenueStreams(entries, streamOverrides);
  const flow = computeMoneyFlow(entries);
  // The Sankey's own node lists. Returned here as well as from GET finance/flow so the Health
  // page, which already fetches this payload, needs no second round trip for the same figures.
  const flowDiagram = computeFlowDiagram(entries, {
    streamOverrides,
    expenseOverrides: await readFlowExpenseOverrides(db),
  });

  // Month-by-month giving from ChMS's own records, for the Health page's "giving against budget
  // pace" chart. Deliberately ChMS giving rather than the church ledger's monthly Income, which
  // also carries MDO tuition and rentals — the chart is about the offering plate, and labeling
  // a mixed figure "giving" would be the kind of near-enough number this page exists to avoid.
  //
  // Scoped to the GENERAL FUND family only (the 40085 group). The rest of what comes through the
  // plate is designated — Concordia Children's Services and the like are pass-through: the money
  // arrives and leaves, and counting it here would show the operating budget being met by money
  // that was never available to meet it. Same General-Fund rule as the board report
  // (resolveGeneralFundIds), not a second one. Grouped by fund and summed in JS rather than an
  // IN-list, so the query can't run into D1's parameter limit as the fund list grows.
  // fundRows / givingMonthlyRows were already read at the top of this function — the pace chart
  // reads the same rows rather than scanning giving_entries a second time for them.
  const { prefix: genFundPrefix, ids: genFundIdsForPace } = resolveGeneralFundIds(fundRows);
  // With no General Fund identifiable at all (no categorized fund, no fund named "General
  // Fund"), fall back to every fund rather than charting a flat $0 — and say so on the card,
  // since an all-funds line under a General-Fund heading would be the wrong number stated
  // confidently.
  const paceScoped = genFundIdsForPace.size > 0;
  const givingByMonth = new Array(12).fill(0);
  let givingExcludedCents = 0;
  for (const r of givingMonthlyRows) {
    const cents = r.cents || 0;
    if (paceScoped && !genFundIdsForPace.has(r.fund_id)) { givingExcludedCents += cents; continue; }
    if (r.m >= 1 && r.m <= 12) givingByMonth[r.m - 1] += cents;
  }
  const givingMonthly = givingByMonth.map((cents, i) => ({ month: i + 1, cents }));
  // The pace line has to be the General Fund's OWN budget, or the chart compares one fund's
  // giving against every donor account's budget and reads as a permanent shortfall. Same source
  // the board report's General Fund card uses: the church ledger accounts sharing the fund
  // family's leading numeric code (e.g. "40085 Sunday Offering"). null, never 0, when nothing
  // has been imported for that account yet — the card then draws no pace line at all.
  const cashPolicyForPace = await readCashPolicy(db);
  const gfBudget = resolveGeneralFundBudget(entries, {
    prefix: paceScoped ? genFundPrefix : null,
    overrideCode: cashPolicyForPace.general_fund_budget_code,
  });
  const givingPace = {
    scope: paceScoped ? 'general_fund' : 'all_funds',
    budgetCents: gfBudget.cents,
    // What was searched for and what it found, always — not only on success. "No budget is on
    // file" against a budget that IS uploaded, under a code this rule didn't look for, is not
    // something a reader can act on unless the card says which code it searched.
    budgetCode: gfBudget.code,
    budgetAccounts: gfBudget.accounts,
    budgetCodePinned: !!cashPolicyForPace.general_fund_budget_code,
    budgetSource: gfBudget.cents != null ? `church ledger accounts starting ${gfBudget.code}` : '',
    excludedCents: givingExcludedCents,
  };

  // Operating cash runway. Cash on hand prefers an explicit admin figure and falls back to the
  // stored QuickBooks account snapshot; `cash.source` names which one produced the number, so a
  // runway built on a name-matching heuristic never masquerades as a confirmed balance.
  const cashPolicy = cashPolicyForPace;
  let onHandCents = cashPolicy.cash_on_hand_cents, cashSource = 'manual';
  let cashAccounts = [], cashAsOf = '';
  if (onHandCents == null) {
    // The imported balance sheet outranks the QuickBooks account snapshot: it is the church's
    // own confirmed statement of position, where the snapshot is a name-matching heuristic over
    // whatever accounts happen to be connected. Uses the most recent balance sheet at or before
    // the year being viewed — its as-of date rides along, so a figure from an older statement is
    // never read as today's bank balance.
    const balYearRow = await db.prepare(
      'SELECT MAX(fiscal_year) AS y FROM finance_church_balances WHERE fiscal_year <= ?'
    ).bind(year).first();
    const balYear = balYearRow?.y;
    if (balYear != null) {
      const balRows = (await db.prepare('SELECT * FROM finance_church_balances WHERE fiscal_year=?').bind(balYear).all()).results || [];
      const fromSheet = operatingCashFromBalanceSheet(balRows, cashPolicy.cash_account_code);
      if (fromSheet) {
        onHandCents = fromSheet.cents;
        cashSource = 'balance_sheet';
        cashAccounts = fromSheet.accounts;
        cashAsOf = fromSheet.asOfDate || `FY${balYear}`;
      }
    }
  }
  if (onHandCents == null) {
    const snapRow = await db.prepare("SELECT value FROM finance_qb_snapshot WHERE key='accounts'").first();
    let accounts = null;
    try { accounts = snapRow?.value ? JSON.parse(snapRow.value) : null; } catch { accounts = null; }
    const derived = accounts ? operatingCashFromAccounts(accounts) : null;
    if (derived) { onHandCents = derived.cents; cashSource = 'quickbooks'; }
    else cashSource = 'none';
  }
  const nowForCash = new Date();
  const expenseSplit = computeOperatingExpenseSplit(entries);
  const cash = {
    ...computeCashRunway({
      onHandCents,
      expensesYtdCents: expenseSplit.churchCents,
      monthsElapsed: year === nowForCash.getFullYear() ? nowForCash.getMonth() + 1 : 12,
      policyFloorMonths: cashPolicy.policy_floor_months,
    }),
    source: cashSource,
    accounts: cashAccounts,
    asOfDate: cashAsOf,
    daycareExcludedCents: expenseSplit.daycareCents,
    allExpensesYtdCents: expenseSplit.totalCents,
  };

  // YoY-to-date + year-end projection — only meaningful for the current year (a past year's
  // "as of today" comparison doesn't mean anything); needs monthly-granularity rows, which the
  // sync only populates for current + prior year (see the sync handler below).
  const now = new Date();
  let yoy = { available: false };
  let supplies = { monthly: [], currentYtdCents: 0, priorYtdCents: 0 };
  let monthlyTrend = { available: false, months: [] };
  if (year === now.getFullYear()) {
    const throughMonth = now.getMonth() + 1;
    const monthlyRowsAll = (await db.prepare(
      `SELECT * FROM finance_church_entries WHERE source IN ('qbo_sync','monthly_import') AND period_month BETWEEN 1 AND 12 AND fiscal_year IN (?,?)`
    ).bind(year, year - 1).all()).results || [];
    const monthlyRows = resolveChurchMonthlyYearPrecedence(monthlyRowsAll);
    const curMonthly = monthlyRows.filter(r => r.fiscal_year === year && r.period_month <= throughMonth);
    const priorMonthly = monthlyRows.filter(r => r.fiscal_year === year - 1 && r.period_month <= throughMonth);
    const priorAnnualRows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=?').bind(year - 1).all()).results || [];
    yoy = computeYtdComparison(curMonthly, priorMonthly, priorAnnualRows, throughMonth);
    // No monthly rows for this year/last year yet — fall back to a straight-line estimate off
    // the annual actual-to-date total rather than showing "Not yet available" forever.
    if (!yoy.available && (summary.classificationTotals.Income || summary.classificationTotals.Expenses)) {
      yoy = fallbackAnnualProjection(summary, throughMonth);
    }
    // Uses the full (uncapped) monthly rows, not the throughMonth-filtered slices above —
    // a month-by-month supplies chart is more useful showing all synced months than being
    // clipped to "so far this year" like the YTD projection needs to be.
    supplies = computeSuppliesMonthlyBreakdown(
      monthlyRows.filter(r => r.fiscal_year === year),
      monthlyRows.filter(r => r.fiscal_year === year - 1)
    );
    monthlyTrend = computeIncomeExpenseMonthlyTrend(monthlyRows.filter(r => r.fiscal_year === year), throughMonth, summary);
  }

  return {
    year,
    entries,
    ...summary,
    givingCents,
    givingByFund,
    designatedFunds,
    givingHouseholds,
    donorBands,
    givingMonthly,
    givingPace,
    revenueStreams,
    flow,
    flowDiagram,
    cash,
    monthlyTrend,
    yoy,
    supplies,
  };
}
