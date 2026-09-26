// ── Print versions of Finance pages ──────────────────────────────────────────────────────────────
// Andrew, 2026-09-25: print sheets are built by the server, not by page scripts. Any page opened
// with `print=1` renders as a clean letter-size document (church header, title, prepared date,
// forms and buttons hidden, table headers repeated across pages) that staff print or save as PDF
// with the browser's own dialog. The board packet print composes a cover page and any chosen
// reports into one document; each piece is rendered by the normal page route, so it carries that
// page's own permission check and live/synthetic labels. The only script is the toolbar's
// `window.print()` button, which is a convenience, not a builder.
import { escapeHtml } from './render-helpers.js';

export const PRINT_STYLES = `
  body.print-body { background: #eef0ec; margin: 0; color: #172019; font: 11pt/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .print-toolbar { display: flex; gap: .75rem; align-items: center; justify-content: space-between; max-width: 8.5in; margin: 1rem auto 0; padding: 0 .5rem; }
  .print-toolbar button { background: #1f6b45; color: #fff; border: 0; border-radius: .45rem; padding: .6rem 1rem; font-weight: 700; cursor: pointer; }
  .print-toolbar a { color: #1f6b45; }
  .print-doc { background: #fff; max-width: 8.5in; margin: 1rem auto 2rem; padding: .6in .7in; box-shadow: 0 1px 4px rgba(0,0,0,.12); box-sizing: border-box; }
  .print-masthead { display: flex; align-items: center; gap: .8rem; border-bottom: 2px solid #1f6b45; padding-bottom: .6rem; margin-bottom: 1rem; }
  .print-masthead img { width: 40px; height: 40px; }
  .print-masthead .org { font-weight: 700; font-size: 12pt; }
  .print-masthead .meta { font-size: 9pt; color: #555; }
  .print-title { margin: 0 0 .2rem; font-size: 18pt; }
  .print-eyebrow { text-transform: uppercase; letter-spacing: .06em; font-size: 8.5pt; color: #1f6b45; font-weight: 700; }
  .print-section-head { margin: 0 0 .8rem; }
  .print-newpage { break-before: page; page-break-before: always; }
  .print-cover-note { white-space: pre-wrap; border-left: 3px solid #1f6b45; padding: .4rem .8rem; margin: 1rem 0; background: #f4f7f4; }
  .print-foot { margin-top: 1.4rem; padding-top: .5rem; border-top: 1px solid #d9dfda; font-size: 8.5pt; color: #666; }
  .print-doc table { width: 100%; border-collapse: collapse; margin: .6rem 0 1rem; font-size: 9.5pt; }
  .print-doc th, .print-doc td { border-bottom: 1px solid #d9dfda; padding: .3rem .4rem; text-align: left; vertical-align: top; }
  .print-doc thead { display: table-header-group; }
  .print-doc tr, .print-doc .card { break-inside: avoid; page-break-inside: avoid; }
  .print-doc .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  .print-doc .card { border: 1px solid #d9dfda; border-radius: .4rem; padding: .5rem .6rem; }
  .print-doc .card strong { display: block; font-size: 13pt; }
  .print-doc .card small, .print-doc .card span { display: block; font-size: 8.5pt; color: #555; }
  .print-doc .section-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: .8rem; margin: 1rem 0 .4rem; border-bottom: 1px solid #d9dfda; padding-bottom: .25rem; }
  .print-doc .section-heading .eyebrow { text-transform: uppercase; letter-spacing: .05em; font-size: 8pt; color: #555; font-weight: 700; }
  .print-doc .section-heading h2 { margin: .1rem 0 0; font-size: 13pt; }
  .print-doc .badge { font-size: 8pt; border: 1px solid #b9c6bc; border-radius: 999px; padding: .1rem .5rem; color: #33503e; white-space: nowrap; }
  .print-doc .source-tag { margin: .3rem 0; }
  .print-doc .status-error, .print-doc .unavailable .status { color: #8a2b1e; }
  .print-doc td:last-child:empty, .print-doc th:last-child:empty { display: none; }
  .print-doc form, .print-doc button, .print-doc .no-print, .print-doc .notice,
  .print-doc section:has(> form), .print-doc a[href*="edit="] { display: none !important; }
  .print-doc a { color: inherit; text-decoration: none; }
  .print-doc td.num, .print-doc th.num { text-align: right; white-space: nowrap; }
  .print-doc tr.total td { border-top: 1.5px solid #555; font-weight: 600; }
  .print-doc tr.muted td { color: #777; }
  .print-doc .comp-basis { border-left: 3px solid #d9dfda; padding: .1rem .7rem; margin: .8rem 0; font-size: 9.5pt; }
  .print-doc .comp-basis table { width: auto; }
  .print-picker { background: #fff; max-width: 8.5in; margin: 1rem auto; padding: 1.5rem; box-sizing: border-box; }
  .print-picker fieldset { border: 1px solid #d9dfda; border-radius: .5rem; margin: 0 0 1rem; padding: .6rem 1rem; }
  .print-picker label { display: block; padding: .25rem 0; }
  .print-picker textarea { width: 100%; min-height: 6rem; font: inherit; box-sizing: border-box; }
  .print-picker button { background: #1f6b45; color: #fff; border: 0; border-radius: .45rem; padding: .7rem 1.1rem; font-weight: 700; }
  @page { size: letter; margin: .55in .6in; }
  @media print {
    body.print-body { background: #fff; }
    .print-toolbar { display: none; }
    .print-doc { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  }
`;

// Reports the board packet print can include. Each entry is rendered through the normal page route
// (`?section=&page=&print=1&fragment=1`), so a viewer only ever gets what that page allows them.
export const BOARD_PACKET_ITEMS = Object.freeze([
  { key: 'health', label: 'Financial Health', section: 'health', pages: ['overview'] },
  { key: 'church', label: 'Church Report (overview, detail, multi-year trend, budget vs actual)', section: 'church', pages: ['overview', 'income-expense', 'trend', 'budget-actual'] },
  { key: 'balance', label: 'Balance Sheet (position and multi-year)', section: 'balance', pages: ['position', 'multi-year'] },
  { key: 'daycare', label: 'Daycare Report (overview and budget comparison)', section: 'daycare', pages: ['overview', 'budget-comparison'] },
  { key: 'property', label: 'Commercial Property (overview, operating results, reserves, capital)', section: 'property', pages: ['overview', 'operating-results', 'reserve-distribution', 'capital'] },
  { key: 'budget', label: 'Budget', section: 'planning', pages: ['builder'] },
  { key: 'council', label: 'Compensation council report', section: 'compensation', pages: ['council'] },
]);

export const BOARD_PACKET_DEFAULT_KEYS = ['health', 'church', 'balance', 'property', 'budget'];
export const COVER_NOTE_MAX = 2000;

// The print link a page head offers: the same page, with print=1.
export function printHref(searchParams) {
  const params = new URLSearchParams(searchParams || '');
  for (const key of ['status', 'reason', 'message', 'edit', 'qb', 'budgets', 'fragment']) params.delete(key);
  params.set('print', '1');
  return `/?${params.toString()}`;
}

function preparedLabel(now) {
  return now.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' });
}

export function renderPrintFragment({ eyebrow, title, bodyHtml }) {
  return `<article class="print-section">
    <header class="print-section-head"><div class="print-eyebrow">${escapeHtml(eyebrow)}</div><h1 class="print-title">${escapeHtml(title)}</h1></header>
    ${bodyHtml}
  </article>`;
}

export function renderPrintDocument({ documentTitle, backHref, contentHtml, release, production, now = new Date() }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(documentTitle)} · Timothy Finance</title>
  <link rel="icon" href="/assets/finance-mark.png">
  <style>${PRINT_STYLES}</style>
</head>
<body class="print-body">
  <div class="print-toolbar"><a href="${escapeHtml(backHref)}">← Back to Finance</a><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
  <main class="print-doc">
    <div class="print-masthead"><img src="/assets/finance-mark.png" alt=""><div><div class="org">Timothy Lutheran Church · Finance</div><div class="meta">Prepared ${escapeHtml(preparedLabel(now))}${production ? '' : ' · staging data'}</div></div></div>
    ${contentHtml}
    <div class="print-foot">Figures labeled live come from Connect's records; anything labeled synthetic or unavailable is not a real balance. Timothy Finance ${escapeHtml(release)}.</div>
  </main>
</body>
</html>`;
}

export function renderBoardPacketPicker({ items, release, production, message = '' }) {
  const boxes = items.map((item) => `<label><input type="checkbox" name="include" value="${item.key}"${BOARD_PACKET_DEFAULT_KEYS.includes(item.key) ? ' checked' : ''}> ${escapeHtml(item.label)}</label>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board packet · Timothy Finance</title><link rel="icon" href="/assets/finance-mark.png"><style>${PRINT_STYLES}</style></head>
<body class="print-body">
  <div class="print-toolbar"><a href="/?section=packet">← Back to Finance</a></div>
  <main class="print-picker">
    <h1 class="print-title">Print the board packet</h1>
    <p>Choose what to include. The packet opens as one document with a cover page, each report starting on a new page; print it or choose “Save as PDF” in the print dialog.</p>
    ${message ? `<p class="status status-error">${escapeHtml(message)}</p>` : ''}
    <form method="GET" action="/print/board-packet">
      <fieldset><legend>Reports</legend>${boxes || '<p>No reports are available to your role.</p>'}</fieldset>
      <fieldset><legend>Cover note (optional, not saved)</legend><textarea name="note" maxlength="${COVER_NOTE_MAX}" placeholder="A short note to the council, printed on the cover page."></textarea></fieldset>
      <button type="submit">Open packet for printing</button>
    </form>
    <p><small>Timothy Finance ${escapeHtml(release)}${production ? '' : ' · staging'}</small></p>
  </main>
</body>
</html>`;
}
