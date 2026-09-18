// ── Finance-owned .xlsx import writes (Church Budget-vs-Actuals, Balance Sheet) ─────────────────
//
// A further port of legacy Connect's real Excel import paths (`src/api-finance.js`'s
// `finance/church/import`/`finance/church/import-preview` and
// `finance/church/balances/import`/`finance/church/balances/import-preview`), alongside
// `csv-import-service.js`'s CSV port -- see that file's own header comment for the shared "port,
// never import from legacy `src/`" boundary and the "never fabricate a number" discipline this
// file follows too. Scoped to exactly the two report types legacy's own `.xlsx` grid reader
// covers that this app did NOT already have a CSV path replicate exactly (and that the CSV port's
// own header comment called out of scope): the annual "Budget vs. Actuals" Church Report import
// and the single-snapshot "Statement of Financial Position" Balance Sheet import. Legacy's OTHER
// `.xlsx` importers (Monthly P&L, Statement of Activity/Budget-by-Year multi-year, multi-year
// Statement of Financial Position, the AHRA Commercial Property "Budget Detail" grid) are
// deliberately NOT ported here -- see this module's own comment at the bottom of the file for why
// each is out of scope.
//
// GATED OFF BY DEFAULT BEHIND ITS OWN FLAG, SEPARATE FROM CSV IMPORT: `isXlsxImportWritesEnabled`
// below is an entirely distinct check from `csv-import-service.js`'s `isCsvImportWritesEnabled` --
// enabling CSV import must never silently enable this Excel path (and vice versa), since the two
// use genuinely different parsers with different edge-case behavior (leading-space/style-indent
// tree-walk vs. a flat header-columns CSV) even though they land in the very same tables.
//
// ── The ZIP/XML reader (ported, not imported) ───────────────────────────────────────────────────
// XLSX is a ZIP of XML files. This reads the ZIP container directly (central directory + local
// file headers) and decompresses DEFLATE payloads with the standard Web Streams
// DecompressionStream -- both available in the Workers runtime, no third-party library, exactly
// like legacy's `finZipReadEntries`/`finInflateRaw`/`parseXlsxAllSheets` (`src/api-finance.js`,
// itself ported from Tuition Aid's client-side XLSX reader). Ported byte-for-byte algorithm (not a
// weaker rewrite) rather than imported, for the same reason `csv-import-service.js` ports its CSV
// tokenizer instead of importing from legacy `src/` -- this app never imports from that tree.
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
  const entry = entries.find((e) => e.filename === filename);
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
        // Some real QuickBooks exports write a leaf cell's value as a *literal number* inside the
        // <f> (formula) tag with a stale, never-recalculated <v> cache -- see api-finance.js's own
        // comment on this exact confirmed-real quirk. Real subtotal formulas aren't plain numbers
        // and fall through to the normal <v> read below, harmless since those rows are
        // discarded/re-derived anyway.
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
// export instead writes `<sheet ...></sheet>` -- matching just the opening `<sheet ...>` tag
// (self-closed or not) handles both forms, same fix as legacy's own comment on this.
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
  // A Relationship Target is normally relative to the .rels file's own folder, but some export
  // tools write an absolute path rooted at the zip itself -- see api-finance.js's own comment on
  // this confirmed-real quirk.
  return target.startsWith('/') ? target.slice(1) : 'xl/' + target;
}
// Reads xl/styles.xml's cellXfs list (document order === a cell's s="N" style index) and returns
// just each entry's alignment indent (default 0) -- the Statement of Financial Position export
// style conveys hierarchy via real cell-level indent metadata rather than literal leading spaces.
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
// Column-A-only indent-per-row, parallel to the value grid -- Column A is the only column either
// parser below reads indentation from (the account-label column in both report types).
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
// Parses every sheet in an uploaded .xlsx into a { name, grid, colAIndent } list -- same shape as
// legacy's `parseXlsxAllSheets`.
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

// Ported from `src/api-finance.js`'s local `dollarsToCents` -- unlike `csv-import-service.js`'s
// stricter `parseMoneyCents` (which fails closed on an unparsable amount), this one matches
// legacy's EXACT behavior for the xlsx grid-reader path specifically: an unparsable/blank cell
// reads as 0, never an error. This is deliberate, not an oversight -- a subtotal/header row's own
// Actual/Budget cell is frequently blank in a real export (see the test fixtures), and legacy's
// grid walk has always tolerated that silently for this path. `csv-import-service.js`'s stricter
// "never fabricate a number" discipline is about a fresh, human-typed CSV row with no possible
// blank-subtotal-row convention to account for; this port intentionally preserves legacy's actual,
// already-relied-upon xlsx behavior instead.
function dollarsToCents(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function makeFlatRow(path, classification, hasChildren, amt) {
  return {
    fiscal_year: amt.fiscal_year,
    period_month: 0, // annual -- Budget vs. Actuals import is always a single fiscal-year snapshot
    classification,
    category_path: path.join(':'),
    account_name: path[path.length - 1],
    depth: path.length - 1,
    has_children: hasChildren ? 1 : 0,
    own_actual_cents: amt.own_actual_cents,
    own_budget_cents: amt.own_budget_cents,
  };
}

// ── Church Report: "Budget vs. Actuals" Excel import (annual) ───────────────────────────────────
// Ported verbatim from `src/api-finance.js`'s `normalizeChurchClassification`/
// `parseBudgetVsActualsGrid`/`findBudgetVsActualsSheet` -- same leading-space depth tree-walk,
// same Revenue/Expenditures -> Income/Expenses wording normalization, same running-subtotal skip
// rules. See that file's own comments for the real-export findings behind each rule (this
// comment does not repeat them).
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
    rows.push(makeFlatRow(path, classification, hasChildren, {
      fiscal_year: fiscalYear,
      own_actual_cents: dollarsToCents((grid[i] || [])[1]),
      own_budget_cents: dollarsToCents((grid[i] || [])[2]),
    }));
  }
  return { fiscalYear, rows, skipped };
}
export function findBudgetVsActualsSheet(sheets) {
  for (const s of sheets) {
    if (!s.grid) continue;
    if (s.grid.some((r) => r && r[1] === 'Actual' && r[2] === 'Budget')) return s;
  }
  return null;
}

// ── Church Report: Balance Sheet / "Statement of Financial Position" Excel import ───────────────
// Ported verbatim from `src/api-finance.js`'s `normalizeBalanceClassification`/`balanceRowDepth`/
// `parseBalanceSheetGrid`/`findBalanceSheetSheet`/`detectBalanceSheetBasis` -- Assets/Liabilities/
// Equity classification reset (each fully clears the path stack, since real exports' indentation
// isn't guaranteed consistent across classifications) and Cash/Accrual basis footer detection.
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
    if (norm) {
      classification = norm;
      stack.length = 0;
      stack.push({ depth, path: [classification] });
      rows.push(makeBalanceRow([classification], classification, hasChildren, fiscalYear, dollarsToCents((grid[i] || [])[1])));
      continue;
    }
    if (depth === 0 && !hasChildren) { skipped.push(raw); continue; }
    if (!classification) { skipped.push(raw); continue; }
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

// ── Persistence: same tables as csv-import-service.js, tagged with their OWN source ─────────────
// Writes to the exact same `finance_church_entries`/`finance_church_balances` tables the CSV
// import path uses, but tagged `source='import_xlsx'` (never `'import_csv'`) -- a distinct source
// per (fiscal_year, period_month, category_path, source) unique key means an xlsx import and a CSV
// import for the same fiscal year can coexist without either silently overwriting the other. The
// live report readers' own source-precedence rules (see church-report-service.js) decide which
// source wins when more than one is present for the same year; this file's job is only to write
// its own rows correctly, the same scope csv-import-service.js's own persist functions have.
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

async function recordFinanceImport(db, importerKey, note, importedAt) {
  try {
    await db.prepare(
      `INSERT INTO finance_import_log (importer_key,last_imported_at,note) VALUES (?,?,?)
       ON CONFLICT(importer_key) DO UPDATE SET last_imported_at=excluded.last_imported_at, note=excluded.note`
    ).bind(importerKey, importedAt, note || '').run();
  } catch { /* the import itself succeeded; staleness bookkeeping must never fail it */ }
}

// ── Off-by-default production gate, SEPARATE from CSV import's own flag ─────────────────────────
// Deliberately its own env var and its own `finance_settings` key -- see this module's header
// comment for why enabling CSV import must never silently enable this path. Same fail-closed
// shape as `isCsvImportWritesEnabled`: both checks default to disabled, and any error reading
// `finance_settings` (including no `FINANCE_DB` binding at all) also means disabled.
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

const MAX_XLSX_BYTES = 15 * 1024 * 1024; // same 15 MB cap legacy's own upload routes enforce

// Base64-decodes the uploaded file. Unlike legacy's multipart `req.formData()` upload (this app's
// other FINANCE_DB write routes all take a plain JSON body -- see csv-import-service.js's own
// `run*CsvImport` functions and compensation-plan-write-service.js's `applyCompensationWorkerPlanWrite`
// -- so this stays consistent with every sibling FINANCE_DB write route in this app rather than
// being the one route that needs multipart parsing). This is a deliberate simplification from
// legacy's separate preview-then-commit multipart upload flow -- see this module's own note in
// apps/finance/README.md's changelog for what that gives up (no server-rendered row-by-row
// preview/checkbox step before commit).
function decodeBase64Xlsx(fileBase64) {
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) return { error: 'fileBase64 is required' };
  let binary;
  try {
    binary = atob(fileBase64);
  } catch {
    return { error: 'fileBase64 is not valid base64' };
  }
  if (binary.length > MAX_XLSX_BYTES) return { error: 'File too large (max 15 MB)' };
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes };
}

function badRequest(error, details) {
  return details ? { ok: false, status: 400, error, details } : { ok: false, status: 400, error };
}

// ── Request-level orchestration (decode -> parse -> validate -> persist -> log) ─────────────────
// Mirrors csv-import-service.js's `run*CsvImport` shape: pure with respect to HTTP, returns a
// plain `{ ok, status, ... }` result object for shell.js to turn into a Response. Unlike legacy's
// two-step preview/commit, and unlike the CSV path's own request-supplied `fiscal_year`, the
// fiscal year (and, for Balance, the as-of date) come from the WORKBOOK ITSELF, exactly as legacy
// determines them -- there is no separate fiscal-year form field to get out of sync with the file.
export async function runChurchEntriesXlsxImport(env, db, body) {
  if (!(await isXlsxImportWritesEnabled(env, db))) return { ok: false, status: 403, error: XLSX_IMPORT_WRITES_DISABLED_MESSAGE };
  const decoded = decodeBase64Xlsx(body && body.fileBase64);
  if (decoded.error) return badRequest(decoded.error);
  let sheets;
  try {
    sheets = await parseXlsxAllSheets(decoded.bytes.buffer);
  } catch (e) {
    return badRequest('Could not read this file as an Excel workbook: ' + (e && e.message ? e.message : String(e)));
  }
  const sheet = findBudgetVsActualsSheet(sheets);
  if (!sheet) return badRequest('Could not find a "Budget vs. Actuals" sheet (a sheet with Actual/Budget columns) in this file.');
  let parsed;
  try {
    parsed = parseBudgetVsActualsGrid(sheet.grid);
  } catch (e) {
    return badRequest(e && e.message ? e.message : String(e));
  }
  if (!parsed.fiscalYear) return badRequest('Could not determine the fiscal year from this sheet -- expected a date-range line like "January - December 2026" above the header row.');
  if (!parsed.rows.length) return badRequest('No importable account rows found in this sheet.');
  const importedAt = new Date().toISOString();
  try {
    await persistChurchEntriesXlsxImport(db, parsed.rows, parsed.fiscalYear, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${parsed.rows.length} row(s) for FY${parsed.fiscalYear}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'church_budget_xlsx', `FY${parsed.fiscalYear}`, importedAt);
  return { ok: true, status: 200, fiscalYear: parsed.fiscalYear, imported: parsed.rows.length, skipped: parsed.skipped };
}

export async function runChurchBalancesXlsxImport(env, db, body) {
  if (!(await isXlsxImportWritesEnabled(env, db))) return { ok: false, status: 403, error: XLSX_IMPORT_WRITES_DISABLED_MESSAGE };
  const decoded = decodeBase64Xlsx(body && body.fileBase64);
  if (decoded.error) return badRequest(decoded.error);
  let sheets;
  try {
    sheets = await parseXlsxAllSheets(decoded.bytes.buffer);
  } catch (e) {
    return badRequest('Could not read this file as an Excel workbook: ' + (e && e.message ? e.message : String(e)));
  }
  const sheet = findBalanceSheetSheet(sheets);
  if (!sheet) return badRequest('Could not find a Balance Sheet / Statement of Financial Position sheet in this file.');
  let parsed;
  try {
    parsed = parseBalanceSheetGrid(sheet.grid, sheet.colAIndent);
  } catch (e) {
    return badRequest(e && e.message ? e.message : String(e));
  }
  if (!parsed.fiscalYear) return badRequest('Could not determine the fiscal year from this sheet -- expected an "As of ..." date line above the header row.');
  if (!parsed.rows.length) return badRequest('No importable account rows found in this sheet.');
  const importedAt = new Date().toISOString();
  try {
    await persistChurchBalancesXlsxImport(db, parsed.rows, parsed.fiscalYear, parsed.asOfDate, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${parsed.rows.length} balance row(s) for FY${parsed.fiscalYear}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'church_balance_xlsx', `FY${parsed.fiscalYear}`, importedAt);
  return { ok: true, status: 200, fiscalYear: parsed.fiscalYear, asOfDate: parsed.asOfDate, basis: parsed.basis, imported: parsed.rows.length, skipped: parsed.skipped };
}

// ── Deliberately out of scope (legacy .xlsx importers NOT ported here) ──────────────────────────
// - Monthly P&L import (`parseMonthlyPnLGrid`/`persistChurchEntriesMonthlyImport`): a genuinely
//   different report family (one column per month, feeds period_month 1-12 rows for
//   trend/projection cards), not requested by this pass's scope.
// - Statement of Activity / Budget-by-Year multi-year imports (`parseActivityMultiYearGrid`/
//   `parseBudgetMultiYearGrid`): multi-year, field-preserving-merge persistence, a different
//   persistence shape from the single-year wholesale-replace this file's two importers use.
// - Statement of Financial Position MULTI-YEAR import (`parseFinancialPositionMultiYearGrid`):
//   same reasoning -- this file only covers the single-snapshot Balance Sheet import.
// - The AHRA Commercial Property "Budget Detail" grid (`parsePropertyBudgetDetailGrid`): a
//   different table (`finance_property_budget_monthly`) already has its own CSV import path in
//   csv-import-service.js; this pass's scope was explicitly the two Church/Balance report types.
// Porting any of these is a real follow-up, not something this change silently forecloses.
