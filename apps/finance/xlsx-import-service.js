// ── Finance-owned .xlsx import writes (Church Budget-vs-Actuals, Balance Sheet) ─────────────────
//
// Closes the "Excel (.xlsx) import is not ported" gap the prior session's own final report named:
// legacy Connect (`src/api-finance.js`) has a ~750-line server-side .xlsx grid reader for the
// Church Report ("Budget vs. Actuals") and Balance Sheet ("Statement of Financial Position")
// imports; only the CSV path had been ported into `apps/finance` before this file (see
// `csv-import-service.js`'s own header comment, which named this exact gap). This module ports
// the ZIP/XML reading engine and the two most central grid parsers verbatim (same algorithm, same
// header-detection heuristics, same indentation-based tree walk) — NOT legacy's Monthly P&L,
// multi-year "Statement of Activity"/"Budget by Year", or AHRA Property Budget Detail xlsx
// importers, which remain unported; see apps/finance/README.md for that explicitly disclosed
// remaining gap.
//
// `apps/finance` never imports from the legacy `src/` tree (see csv-import-service.js's header for
// why) — every function below is a fresh port, not an import, of `src/api-finance.js`'s
// `finZipReadEntries`/`finInflateRaw`/`parseXlsxAllSheets`/`parseBudgetVsActualsGrid`/
// `parseBalanceSheetGrid` family (names kept close to legacy's for traceability against that file).
//
// Legacy's own UI flow is a two-step preview-then-commit (upload → server parses and returns rows
// for an on-screen checkbox review → the browser posts back the (possibly edited/filtered) rows to
// commit). `apps/finance` has no such review UI yet, and every existing write route in this app
// (see csv-import-service.js) is already a single-shot parse-validate-persist call with a JSON
// body, not a two-step upload. This port matches THAT established apps/finance convention instead
// of re-introducing legacy's two-step shape: one request carries the whole file (base64-encoded, in
// a JSON body, matching how every other write route in this app is called) and, if the workbook
// parses cleanly, the exact same commit-time behavior legacy's own commit step has (a wholesale
// replace-by-fiscal-year, tagged with this path's own `source` value) happens immediately. This is
// a deliberate, disclosed simplification (no per-row edit/exclude step before writing) — appropriate
// here specifically because, like every other FINANCE_DB writer in this app, it is OFF by default
// and not reachable in production until a later, separately-approved cutover stage.
//
// Money parsing deliberately differs from legacy's own lenient `dollarsToCents` (which silently
// reads anything unparsable as 0) the same way csv-import-service.js's `parseMoneyCents` already
// differs from it: a completely BLANK amount cell is read as 0 (legacy's own well-established
// meaning for "not entered" in these specific reports — a real multi-year Actual-only export always
// leaves every Budget cell blank, and treating that as a hard error would make that whole real
// report family un-importable), but a NON-blank cell that cannot be read as a real number is a hard
// parse failure for the whole import, never a silently-substituted zero — this app's "never
// fabricate a number" discipline (see church-report-service.js, render-helpers.js) applied to a
// genuinely corrupt or unexpected cell rather than a normal blank one.

// ── Generic .xlsx (ZIP of XML) reader — ported from src/api-finance.js's own header comment on
// why this app hand-rolls its own reader rather than a third-party library: XLSX is a ZIP of XML
// files; this reads the ZIP container directly (central directory + local file headers) and
// decompresses DEFLATE payloads with the standard Web Streams DecompressionStream — both available
// in the Cloudflare Workers runtime, no third-party dependency, and directly unit-testable in Node.
function xlsxXmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function xlsxZipReadEntries(bytes) {
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

function xlsxZipLocalFileDataOffset(bytes, localHeaderOffset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error('This Excel file is not in the expected format.');
  const filenameLen = dv.getUint16(localHeaderOffset + 26, true);
  const extraLen = dv.getUint16(localHeaderOffset + 28, true);
  return localHeaderOffset + 30 + filenameLen + extraLen;
}

async function xlsxInflateRaw(chunk) {
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

async function xlsxZipReadEntryBytes(bytes, entries, filename) {
  const entry = entries.find((e) => e.filename === filename);
  if (!entry) return null;
  const dataOffset = xlsxZipLocalFileDataOffset(bytes, entry.localHeaderOffset);
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return xlsxInflateRaw(compressed);
  throw new Error('Unsupported compression in this Excel file.');
}

function xlsxParseSharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const block = m[1];
    let text = '';
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(block))) text += xlsxXmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}

function xlsxColToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

export function xlsxParseSheetGrid(xml, sharedStrings) {
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
      const colIdx = xlsxColToIndex(refM[1]);
      const typeM = /\bt="([a-zA-Z]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : 'n';
      let value = null;
      if (type === 's') {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM) value = sharedStrings[parseInt(vM[1], 10)];
      } else if (type === 'inlineStr') {
        const tM = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inner);
        if (tM) value = xlsxXmlUnescape(tM[1]);
      } else if (type === 'str' || type === 'b') {
        const vM2 = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM2) value = type === 'b' ? (vM2[1] === '1') : xlsxXmlUnescape(vM2[1]);
      } else {
        // Some real QuickBooks exports write a leaf cell's value as a literal number inside the
        // <f> (formula) tag with a stale, never-recalculated <v> cache stuck at 0.0 — see
        // src/api-finance.js's own comment on this exact confirmed export quirk.
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

function xlsxListSheetNames(workbookXml) {
  const out = [];
  const sheetRe = /<sheet\b([^>]*?)\/?>/g;
  let sm;
  while ((sm = sheetRe.exec(workbookXml))) {
    const nameM = /\bname="([^"]*)"/.exec(sm[1]);
    if (nameM) out.push(xlsxXmlUnescape(nameM[1]));
  }
  return out;
}

function xlsxFindSheetPath(workbookXml, relsXml, sheetName) {
  const sheetRe = /<sheet\b([^>]*?)\/?>/g;
  let sm, rId = null;
  while ((sm = sheetRe.exec(workbookXml))) {
    const nameM = /\bname="([^"]*)"/.exec(sm[1]);
    const idM = /\br:id="(rId\d+)"/.exec(sm[1]);
    if (nameM && idM && xlsxXmlUnescape(nameM[1]) === sheetName) { rId = idM[1]; break; }
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
  // A Relationship Target is normally relative to xl/_rels/ (so "worksheets/sheet1.xml" means
  // "xl/worksheets/sheet1.xml"), but some export tools write an absolute path rooted at the zip
  // itself instead — see src/api-finance.js's own comment on the real confirmed export this fixes.
  return target.startsWith('/') ? target.slice(1) : 'xl/' + target;
}

function xlsxParseCellXfsIndents(stylesXml) {
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

function xlsxParseColAIndents(sheetXml, cellXfsIndents) {
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

// Parses every sheet in an uploaded .xlsx into a { name, grid, colAIndent } list — grid is a dense
// 2D array of cell values (row-major, 0-indexed); colAIndent is the parallel column-A style-indent
// array the Balance Sheet parser falls back to when a row has no literal leading-space indentation.
export async function parseXlsxAllSheets(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = xlsxZipReadEntries(bytes);
  const dec = new TextDecoder('utf-8');
  const workbookXml = dec.decode(await xlsxZipReadEntryBytes(bytes, entries, 'xl/workbook.xml'));
  const relsXml = dec.decode(await xlsxZipReadEntryBytes(bytes, entries, 'xl/_rels/workbook.xml.rels'));
  const sharedStringsRaw = await xlsxZipReadEntryBytes(bytes, entries, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsRaw ? xlsxParseSharedStrings(dec.decode(sharedStringsRaw)) : [];
  const stylesRaw = await xlsxZipReadEntryBytes(bytes, entries, 'xl/styles.xml');
  const cellXfsIndents = stylesRaw ? xlsxParseCellXfsIndents(dec.decode(stylesRaw)) : [];
  const names = xlsxListSheetNames(workbookXml);
  const sheets = [];
  for (const name of names) {
    const sheetPath = xlsxFindSheetPath(workbookXml, relsXml, name);
    const sheetBytes = sheetPath ? await xlsxZipReadEntryBytes(bytes, entries, sheetPath) : null;
    if (!sheetBytes) { sheets.push({ name, grid: null, colAIndent: [] }); continue; }
    const sheetXml = dec.decode(sheetBytes);
    sheets.push({
      name,
      grid: xlsxParseSheetGrid(sheetXml, sharedStrings),
      colAIndent: xlsxParseColAIndents(sheetXml, cellXfsIndents),
    });
  }
  return sheets;
}

// ── Money parsing — see this module's header comment for exactly how/why this differs from
// legacy's own lenient dollarsToCents (blank stays 0; a non-blank unparsable cell is a hard error).
export function xlsxAmountToCents(raw) {
  if (raw == null || raw === '') return { cents: 0 };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { cents: Math.round(raw * 100) } : { error: true };
  const cleaned = String(raw).replace(/,/g, '').replace(/^\$/, '').trim();
  if (cleaned === '') return { cents: 0 };
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? { cents: Math.round(n * 100) } : { error: true };
}

function requireAmountCents(raw, rowNumber, colLabel, accountLabel) {
  const r = xlsxAmountToCents(raw);
  if (r.error) throw new Error(`Row ${rowNumber}: "${colLabel}" for "${accountLabel}" is not a valid amount ("${raw}")`);
  return r.cents;
}

// ── Church Report: "Budget vs. Actuals" annual Excel import — ported from
// src/api-finance.js's parseBudgetVsActualsGrid/findBudgetVsActualsSheet/
// normalizeChurchClassification/indentDepthOf/nextNonBlankLabel/makeFlatRow, unchanged algorithm.
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

// QuickBooks' own computed running subtotals (never a real account) under this report's wording
// variants — same alternation as legacy's IMPORT_SKIP_LABEL_RE.
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
function makeFlatRow(path, classification, hasChildren, amt) {
  return {
    fiscal_year: amt.fiscal_year,
    period_month: amt.period_month || 0,
    classification,
    category_path: path.join(':'),
    account_name: path[path.length - 1],
    depth: path.length - 1,
    has_children: hasChildren ? 1 : 0,
    own_actual_cents: amt.own_actual_cents,
    own_budget_cents: amt.own_budget_cents,
  };
}

export function findBudgetVsActualsSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some((r) => r && r[1] === 'Actual' && r[2] === 'Budget')) return s;
  }
  return null;
}

export function parseBudgetVsActualsGrid(grid) {
  const headerIdx = grid.findIndex((r) => r && r[1] === 'Actual' && r[2] === 'Budget');
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
    if (/^Total\s/i.test(label)) continue;
    if (IMPORT_SKIP_LABEL_RE.test(label)) continue;
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
    const rowCells = grid[i] || [];
    rows.push(makeFlatRow(path, classification, hasChildren, {
      fiscal_year: fiscalYear,
      own_actual_cents: requireAmountCents(rowCells[1], i + 1, 'Actual', label),
      own_budget_cents: requireAmountCents(rowCells[2], i + 1, 'Budget', label),
    }));
  }
  return { fiscalYear, rows, skipped };
}

// ── Church Report: Balance Sheet / Statement of Financial Position import — ported from
// src/api-finance.js's parseBalanceSheetGrid/normalizeBalanceClassification/balanceRowDepth/
// nextNonBlankRowIndex/detectBalanceSheetBasis/makeBalanceRow, unchanged algorithm.
const BALANCE_CLASSIFICATION_MAP = { assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity' };
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
export function detectBalanceSheetBasis(grid) {
  for (const row of grid) {
    const cell = row && row[0];
    if (typeof cell !== 'string') continue;
    const m = /^(Cash|Accrual)\s+Basis\b/i.exec(cell.trim());
    if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return null;
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
    if (/^Total\s/i.test(label)) continue;
    if (/^Liabilities and Equity$/i.test(label)) continue;
    const depth = balanceRowDepth(raw, colAIndent[i]);
    const nextIdx = nextNonBlankRowIndex(grid, i);
    const hasChildren = nextIdx !== -1 && balanceRowDepth(grid[nextIdx][0], colAIndent[nextIdx]) > depth;
    const norm = normalizeBalanceClassification(label);
    const balanceCents = requireAmountCents((grid[i] || [])[1], i + 1, 'Total', label);
    if (norm) {
      classification = norm;
      stack.length = 0;
      stack.push({ depth, path: [classification] });
      rows.push(makeBalanceRow([classification], classification, hasChildren, fiscalYear, balanceCents));
      continue;
    }
    if (depth === 0 && !hasChildren) { skipped.push(raw); continue; }
    if (!classification) { skipped.push(raw); continue; }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : { path: [classification] };
    const path = parent.path.concat(label);
    stack.push({ depth, path });
    rows.push(makeBalanceRow(path, classification, hasChildren, fiscalYear, balanceCents));
  }
  return { fiscalYear, asOfDate, rows, skipped, basis: detectBalanceSheetBasis(grid) };
}

// ── Base64 decode — every write route in this app takes a JSON body (see this module's header
// comment on why); a binary .xlsx file is carried as a base64 string in that same JSON body.
// `atob` is a standard global in both the Cloudflare Workers runtime and Node 22 (this repo's
// required Node version — see AGENTS.md), so this needs no environment-specific branch.
export function decodeBase64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const MAX_XLSX_BASE64_LENGTH = 21 * 1024 * 1024; // ~15 MB decoded, matching legacy's own 15 MB file cap

// ── Persistence — same wholesale-replace-by-fiscal-year pattern as csv-import-service.js's
// persistChurchEntriesCsvImport/persistChurchBalancesCsvImport, and as legacy's own
// persistChurchEntriesImport/persistChurchBalancesImport, but tagged with this path's OWN
// `import_xlsx` source (distinct from CSV's `import_csv`, legacy's own `import`, and the live
// `qbo_sync`/`monthly_import`/`import_activity` sources) so none of those provenances can ever
// collide or silently overwrite one another.
export async function persistChurchEntriesXlsxImport(db, rows, fiscalYear, importedAt) {
  const ops = [db.prepare(`DELETE FROM finance_church_entries WHERE source='import_xlsx' AND fiscal_year=?`).bind(fiscalYear)];
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,0,?,?,?,?,?,?,?,'import_xlsx',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
         own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
    ).bind(fiscalYear, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_actual_cents, r.own_budget_cents, importedAt));
  }
  await db.batch(ops);
}

export async function persistChurchBalancesXlsxImport(db, rows, fiscalYear, asOfDate, importedAt) {
  const ops = [db.prepare(`DELETE FROM finance_church_balances WHERE source='import_xlsx' AND fiscal_year=?`).bind(fiscalYear)];
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_balances
         (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,'import_xlsx',?)
       ON CONFLICT(fiscal_year, category_path, source) DO UPDATE SET
         as_of_date=excluded.as_of_date, classification=excluded.classification, account_name=excluded.account_name,
         depth=excluded.depth, has_children=excluded.has_children, own_balance_cents=excluded.own_balance_cents,
         synced_at=excluded.synced_at`
    ).bind(fiscalYear, asOfDate, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_balance_cents, importedAt));
  }
  await db.batch(ops);
}

// ── Off-by-default production gate — its own flag, separate from isCsvImportWritesEnabled, so
// turning CSV import on never silently turns this (a distinct, separately-reviewed capability) on
// too. Same fail-closed shape as every other gate in this app (csv-import-service.js's
// isCsvImportWritesEnabled, compensation-plan-write-service.js's isCompensationPlanWriteEnabled):
// an env var OR a finance_settings row, either defaulting to disabled, and any read error also
// means disabled.
export async function isXlsxImportWritesEnabled(env, db) {
  if (env && (env.FINANCE_XLSX_IMPORT_WRITES_ENABLED === '1' || env.FINANCE_XLSX_IMPORT_WRITES_ENABLED === 'true')) return true;
  if (!db) return false;
  try {
    const row = await db.prepare("SELECT value FROM finance_settings WHERE key='finance_xlsx_import_writes_enabled'").first();
    return !!row && row.value === '1';
  } catch {
    return false;
  }
}

export const XLSX_IMPORT_WRITES_DISABLED_MESSAGE =
  'Excel (.xlsx) import writes are not yet enabled. This capability is code-complete and tested ' +
  'but intentionally gated off pending a later, separately-approved production cutover stage.';

function badRequest(error, details) {
  return details ? { ok: false, status: 400, error, details } : { ok: false, status: 400, error };
}

async function recordFinanceImport(db, importerKey, note, importedAt) {
  try {
    await db.prepare(
      `INSERT INTO finance_import_log (importer_key,last_imported_at,note) VALUES (?,?,?)
       ON CONFLICT(importer_key) DO UPDATE SET last_imported_at=excluded.last_imported_at, note=excluded.note`
    ).bind(importerKey, importedAt, note || '').run();
  } catch { /* the import itself succeeded; staleness bookkeeping must never fail it */ }
}

// ── Request-level orchestration — same shape as csv-import-service.js's run*CsvImport functions:
// pure with respect to HTTP, returns a plain `{ ok, status, ... }` result object for shell.js to
// turn into a Response. `body.file_base64` carries the whole uploaded .xlsx workbook.
export async function runChurchXlsxImport(env, db, body) {
  if (!(await isXlsxImportWritesEnabled(env, db))) return { ok: false, status: 403, error: XLSX_IMPORT_WRITES_DISABLED_MESSAGE };
  const fileBase64 = body && body.file_base64;
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) return badRequest('file_base64 is required');
  if (fileBase64.length > MAX_XLSX_BASE64_LENGTH) return badRequest('File too large (max 15 MB)');
  let bytes;
  try { bytes = decodeBase64ToBytes(fileBase64); } catch { return badRequest('file_base64 could not be decoded'); }
  let sheets;
  try { sheets = await parseXlsxAllSheets(bytes.buffer); }
  catch (e) { return badRequest('Could not read this file as an Excel workbook: ' + (e && e.message ? e.message : String(e))); }
  const sheet = findBudgetVsActualsSheet(sheets);
  if (!sheet) return badRequest('Could not find a "Budget vs. Actuals" sheet (a sheet with Actual/Budget columns) in this file.');
  let parsed;
  try { parsed = parseBudgetVsActualsGrid(sheet.grid); }
  catch (e) { return badRequest(e && e.message ? e.message : String(e)); }
  if (!parsed.fiscalYear) return badRequest('Could not determine the fiscal year from this sheet — expected a date-range line like "January - December 2026" above the header row.');
  if (!parsed.rows.length) return badRequest('No data rows found in this sheet.');
  const importedAt = new Date().toISOString();
  try {
    await persistChurchEntriesXlsxImport(db, parsed.rows, parsed.fiscalYear, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${parsed.rows.length} row(s) for FY${parsed.fiscalYear}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'church_budget_xlsx', `FY${parsed.fiscalYear}`, importedAt);
  return { ok: true, status: 200, sheetName: sheet.name, fiscalYear: parsed.fiscalYear, imported: parsed.rows.length, skipped: parsed.skipped };
}

export async function runChurchBalancesXlsxImport(env, db, body) {
  if (!(await isXlsxImportWritesEnabled(env, db))) return { ok: false, status: 403, error: XLSX_IMPORT_WRITES_DISABLED_MESSAGE };
  const fileBase64 = body && body.file_base64;
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) return badRequest('file_base64 is required');
  if (fileBase64.length > MAX_XLSX_BASE64_LENGTH) return badRequest('File too large (max 15 MB)');
  let bytes;
  try { bytes = decodeBase64ToBytes(fileBase64); } catch { return badRequest('file_base64 could not be decoded'); }
  let sheets;
  try { sheets = await parseXlsxAllSheets(bytes.buffer); }
  catch (e) { return badRequest('Could not read this file as an Excel workbook: ' + (e && e.message ? e.message : String(e))); }
  const sheet = findBalanceSheetSheet(sheets);
  if (!sheet) return badRequest('Could not find a Balance Sheet / Statement of Financial Position sheet in this file.');
  let parsed;
  try { parsed = parseBalanceSheetGrid(sheet.grid, sheet.colAIndent); }
  catch (e) { return badRequest(e && e.message ? e.message : String(e)); }
  if (!parsed.fiscalYear) return badRequest('Could not determine the fiscal year from this sheet — expected an "As of ..." date line above the header row.');
  if (!parsed.rows.length) return badRequest('No data rows found in this sheet.');
  const importedAt = new Date().toISOString();
  try {
    await persistChurchBalancesXlsxImport(db, parsed.rows, parsed.fiscalYear, parsed.asOfDate, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${parsed.rows.length} balance row(s) for FY${parsed.fiscalYear}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'church_balance_xlsx', `FY${parsed.fiscalYear}`, importedAt);
  return { ok: true, status: 200, sheetName: sheet.name, fiscalYear: parsed.fiscalYear, asOfDate: parsed.asOfDate, basis: parsed.basis, imported: parsed.rows.length, skipped: parsed.skipped };
}
