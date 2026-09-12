// ── PAYROLL REPORT RENDERING — three screen layouts, CSV, and the fixed print
//    table, all built from the ONE shape payroll-calc.js's reportGroups()/
//    exportReport() produce. Ported from Website's admin/payroll.html
//    (renderReport/renderPrintTable) and its browser "Export CSV" button,
//    since Finance's strict CSP forbids any client-side script — this is
//    server-rendered HTML and a server-generated CSV file, not a client-side
//    reimplementation of the same idea. Uses Finance's own CSS (the .pay-*
//    rules in shell.js's shared stylesheet), not Website's unrelated
//    .tlc-pay-* design system, which does not exist in this app.
import { hrs, money, subtotal } from './payroll-calc.js';

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return [...String(value)].map((character) => entities[character] || character).join('');
}

function lineItemHtml(item) {
  return `<div class="pay-li${item.muted ? ' muted' : ''}${item.neg ? ' neg' : ''}${item.total ? ' total' : ''}">`
    + `<span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.value)}</span></div>`;
}

const LAYOUT_NOTES = {
  cards: 'Matches the report you print today — every line item per person.',
  table: 'Compact enough to scan or reconcile against the service.',
  summary: 'Subtotals only — safe to share with council.',
};

export function renderLayoutTabs(currentLayout, periodStart) {
  const tab = (layout, label) => `<a class="pay-tab${layout === currentLayout ? ' is-on' : ''}" href="/?section=payroll&period=${encodeURIComponent(periodStart)}&view=report&layout=${layout}"${layout === currentLayout ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<div class="pay-toolbar">
    ${tab('cards', 'Detail cards')}${tab('table', 'One line each')}${tab('summary', 'Totals only')}
    <span class="pay-note">${escapeHtml(LAYOUT_NOTES[currentLayout] || LAYOUT_NOTES.cards)}</span>
  </div>`;
}

function combinedBarHtml(groups, total, periodLbl) {
  const church = groups.find((g) => g.key === 'church').people.length;
  const mdo = groups.find((g) => g.key === 'mdo').people.length;
  return `<div class="pay-combined"><span><strong>Combined total</strong> · ${escapeHtml(periodLbl)}`
    + `<span class="pay-note">${church} church · ${mdo} MDO · gross, before withholding</span></span>`
    + `<b>${money(total)}</b></div>`;
}

function statRowHtml(label, value) {
  return `<div class="pay-li"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

// groups: from payroll-calc.js's reportGroups(). incompleteNote: a warning
// string, or '', shown when the MDO relay failed for this render.
export function renderReportBody(groups, layout, periodLbl, incompleteNote) {
  if (!groups.some((g) => g.people.length)) {
    return '<p>Nobody has pay recorded in this period yet.</p>';
  }
  const incomplete = incompleteNote ? `<p class="pay-warn">${escapeHtml(incompleteNote)}</p>` : '';
  const total = subtotal(groups.flatMap((g) => g.people));

  if (layout === 'table') {
    return incomplete + groups.filter((g) => g.people.length).map((g) => '<div class="table-wrap">'
      + `<table><caption class="pay-card-bar">${escapeHtml(g.name)}</caption><thead><tr><th>Person</th><th>Hours / salary</th><th>PTO used</th><th>Gross</th></tr></thead><tbody>`
      + g.people.map((p) => '<tr>'
        + `<td>${escapeHtml(p.name)}</td>`
        + `<td>${escapeHtml(p.basis)}</td>`
        + `<td>${p.salaried ? 'n/a' : escapeHtml(hrs(p.pto))}</td>`
        + `<td>${money(p.gross)}</td></tr>`).join('')
      + `<tr><td colspan="3"><strong>${escapeHtml(g.name)} subtotal</strong></td><td><strong>${money(subtotal(g.people))}</strong></td></tr>`
      + '</tbody></table></div>'
    ).join('') + combinedBarHtml(groups, total, periodLbl);
  }

  if (layout === 'summary') {
    return incomplete + '<div class="grid">' + groups.map((g) => {
      const salaried = subtotal(g.people.filter((p) => p.salaried));
      const hourly = subtotal(g.people.filter((p) => !p.salaried));
      const hours = g.people.reduce((n, p) => n + p.hours, 0);
      const pto = g.people.reduce((n, p) => n + p.pto, 0);
      return `<div class="card"><small>${escapeHtml(g.name)}</small><strong>${money(subtotal(g.people))}</strong>`
        + `<span>Salaried ${money(salaried)} · Hourly ${money(hourly)}</span>`
        + `<span>${g.people.length} people paid · ${hours.toFixed(2)} hours · ${hrs(pto)} PTO used</span></div>`;
    }).join('') + '</div>' + combinedBarHtml(groups, total, periodLbl);
  }

  // Default: detail cards.
  return incomplete + groups.filter((g) => g.people.length).map((g) =>
    `<div class="pay-group">${escapeHtml(g.name)}</div>`
    + g.people.map((p) => '<div class="pay-card">'
      + `<div class="pay-card-bar">${escapeHtml(p.name)}</div>`
      + p.lines.map(lineItemHtml).join('')
      + lineItemHtml({ label: 'Gross Pay', value: money(p.gross), total: true })
      + '</div>').join('')
    + `<div class="pay-card"><div class="pay-li total"><span>${escapeHtml(g.name)} subtotal</span>`
    + `<span>${money(subtotal(g.people))}</span></div></div>`
  ).join('') + combinedBarHtml(groups, total, periodLbl);
}

// ── THE PRINTED REPORT ──────────────────────────────────────────────────────
// A SEPARATE, print-only rendering, not a print stylesheet over the on-screen
// layouts — the bookkeeper's copy is one fixed compact table per group and
// must not change shape depending on which of the three screen layouts was
// selected. Hidden on screen (#pay-print{display:none}), shown only under
// @media print, in apps/finance/shell.js's stylesheet. There is no "Print"
// button: Finance carries no client-side script to call window.print(), so
// this relies on the browser's own print command, which the print CSS
// already isolates correctly regardless of how it is invoked.
function hoursAtRate(p, rate) {
  const n2 = (v) => (Number(v) || 0).toFixed(2);
  const pto = Number(p.pto) || 0;
  return `${n2(p.hours)}${pto > 0 ? ` + ${n2(pto)} PTO` : ''} hrs @ ${rate}`;
}

export function renderPrintTable(report) {
  if (!report.mdo.rows.length && !report.church.rows.length) return '';
  const amt = (v) => (Number(v) > 0 ? money(v) : '—');
  const n2 = (v) => (Number(v) || 0).toFixed(2);

  const mdoSection = report.mdo.rows.length ? '<div class="pt-section">'
    + '<div class="pt-section-label">MDO Staff</div>'
    + '<table class="pt-table"><thead><tr>'
    + '<th>Name</th><th>Rate</th><th class="pt-num">Hours</th><th class="pt-num">PTO</th><th class="pt-num">Gross Pay</th>'
    + '</tr></thead><tbody>'
    + report.mdo.rows.map((p) => '<tr>'
      + `<td class="pt-name">${escapeHtml(p.name)}</td>`
      + `<td>${p.salaried ? 'Salary' : `${money(p.rate)}/hr`}</td>`
      + `<td class="pt-num">${p.salaried ? '—' : n2(p.hours)}</td>`
      + `<td class="pt-num">${p.pto > 0 ? n2(p.pto) : '—'}</td>`
      + `<td class="pt-num">${money(p.gross)}</td></tr>`).join('')
    + `<tr class="pt-sub"><td colspan="4">MDO Subtotal</td><td class="pt-num">${money(report.mdo.subtotal)}</td></tr>`
    + '</tbody></table></div>' : '';

  const churchSection = report.church.rows.length ? '<div class="pt-section">'
    + '<div class="pt-section-label">Church Staff</div>'
    + '<table class="pt-table"><thead><tr>'
    + '<th>Name</th><th class="pt-num">Base / Earnings</th><th class="pt-num">Housing</th>'
    + '<th class="pt-num">Ins Opt-Out</th><th class="pt-num">HSA</th><th class="pt-num">Mileage</th>'
    + '<th class="pt-num">403(b)</th><th class="pt-num">Gross Pay</th>'
    + '</tr></thead><tbody>'
    + report.church.rows.map((p) => '<tr>'
      + `<td class="pt-name">${escapeHtml(p.name)}</td>`
      + `<td class="pt-num">${p.salaried ? money(p.base) : hoursAtRate(p, money(p.rate))}</td>`
      + `<td class="pt-num">${amt(p.housing)}</td>`
      + `<td class="pt-num">${amt(p.optOut)}</td>`
      + `<td class="pt-num">${amt(p.hsa)}</td>`
      + `<td class="pt-num">${amt(p.mileage)}</td>`
      + `<td class="pt-num">${p.b403 > 0 ? `−${money(p.b403)}` : '—'}</td>`
      + `<td class="pt-num">${money(p.gross)}</td></tr>`).join('')
    + `<tr class="pt-sub"><td colspan="7">Church Subtotal</td><td class="pt-num">${money(report.church.subtotal)}</td></tr>`
    + '</tbody></table></div>' : '';

  return '<div class="pt-header"><h2>Timothy Lutheran — Combined Payroll</h2>'
    + `<div class="pt-period">Pay Period: ${escapeHtml(report.label)}</div></div>`
    + (report.incomplete ? '<p class="pt-warn"><b>Incomplete:</b> the childcare app could not be reached, so no MDO staff are in this report.</p>' : '')
    + mdoSection + churchSection
    + `<div class="pt-total"><span>Total Gross Pay</span><span>${money(report.total)}</span></div>`;
}

// ── CSV ──────────────────────────────────────────────────────────────────
// A cell starting = + - @ is a formula to a spreadsheet, so a name or note
// beginning with one would execute on open. Prefixed with a quote (PY-5).
// That guard is for text somebody TYPED — a staff name — and must not be put
// in front of a number this file formatted itself: the 403(b) column is
// written as a negative, and a blanket guard would turn -118.00 into the
// text '-118.00, breaking the bookkeeper's column sum. csvText() is for
// anything a person typed; csvNum() is for figures already known to be
// digits, a dot and a minus.
//
// Deliberately its own copy, not an import of src/api-utils.js's csvCell — apps/finance is kept
// free of any dependency on src/ so it can be lifted out as its own application later without
// having to untangle imports first (same reasoning as scheduler-html.js's standalone
// schedCsvCell). test/csv-export-escaping.test.js's file walk covers apps/** too, specifically
// so this copy is checked for drift against the canonical quoting/formula-guard rules rather
// than trusted to stay in sync silently.
export function csvText(v) {
  const s = String(v === null || v === undefined ? '' : v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}
export function csvNum(v) {
  return `"${v === null || v === undefined ? '' : String(v)}"`;
}

export function buildPayrollCsv(report) {
  const label = String(report.label || '').slice(0, 80);
  const n2 = (v) => (Number(v) || 0).toFixed(2);
  // An amount that is not there is left blank, not written as 0.00 — a zero
  // reads as "this person has an allowance and it is nothing", a different
  // claim from "this column does not apply".
  const opt = (v) => (Number(v) > 0 ? n2(v) : '');
  const mdoRows = report.mdo?.rows || [];
  const churchRows = report.church?.rows || [];
  const rows = [[csvText(`TLC Payroll — ${label}`)], []];

  if (mdoRows.length) {
    rows.push([csvText('MDO Staff'), csvText('Type'), csvText('Rate'), csvText('Hours'), csvText('PTO Hours'), csvText('Gross Pay')]);
    for (const p of mdoRows) {
      rows.push([
        csvText(p.name), csvText(p.salaried ? 'Salary' : 'Hourly'),
        csvNum(p.salaried ? '' : n2(p.rate)), csvNum(p.salaried ? '' : n2(p.hours)),
        csvNum(opt(p.pto)), csvNum(n2(p.gross)),
      ]);
    }
    rows.push([csvText('MDO Subtotal'), '', '', '', '', csvNum(n2(report.mdo.subtotal))]);
    rows.push([]);
  }

  if (churchRows.length) {
    rows.push([csvText('Church Staff'), csvText('Type'), csvText('Base/Earnings'), csvText('Housing'),
      csvText('Ins Opt-Out'), csvText('HSA'), csvText('Mileage'), csvText('403(b)'), csvText('Gross Pay')]);
    for (const p of churchRows) {
      // Matches Website's own browser "Export CSV" button exactly (admin/payroll.html's
      // exportBtn handler) — no " hrs" unit here, unlike the printed report's hoursAtRate.
      const basis = p.salaried ? n2(p.base) : (() => {
        const pto = Number(p.pto) || 0;
        return `${n2(p.hours)}${pto > 0 ? ` + ${n2(pto)} PTO` : ''} @ ${n2(p.rate)}`;
      })();
      rows.push([
        csvText(p.name), csvText(p.salaried ? 'Salary' : 'Hourly'), csvNum(basis),
        csvNum(opt(p.housing)), csvNum(opt(p.optOut)), csvNum(opt(p.hsa)), csvNum(opt(p.mileage)),
        csvNum(p.b403 > 0 ? `-${n2(p.b403)}` : ''), csvNum(n2(p.gross)),
      ]);
    }
    rows.push([csvText('Church Subtotal'), '', '', '', '', '', '', '', csvNum(n2(report.church.subtotal))]);
    rows.push([]);
  }

  rows.push([csvText('TOTAL GROSS PAY'), '', '', '', '', '', '', '', csvNum(n2(report.total))]);
  if (report.incomplete) rows.push([csvText('WARNING: the childcare app could not be read, so MDO staff are missing from this export.')]);

  return rows.map((r) => r.join(',')).join('\r\n');
}
