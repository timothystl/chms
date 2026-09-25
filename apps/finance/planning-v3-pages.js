// Planning, v3 design: Scenarios and Multi-year forecast. Both start from the fiscal year's budget
// plan in Connect (read live through connect.finance-planning-basis.v1). Scenario settings are
// Finance's own (planning-scenarios-service.js); the forecast is a GET form and saves nothing.
import { escapeHtml as e } from './render-helpers.js';
import { ADJUSTMENTS, applyScenario, buildForecast, readGrowth } from './planning-scenarios-service.js';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (cents) => USD.format(Math.round((Number(cents) || 0) / 100));
const signed = (cents) => `${cents < 0 ? '−' : '+'}${money(Math.abs(cents))}`;
const compact = (cents) => {
  const d = Math.abs(cents) / 100;
  const body = d >= 1e6 ? `$${(d / 1e6).toFixed(1)}M` : d >= 1e3 ? `$${Math.round(d / 1e3)}k` : `$${Math.round(d)}`;
  return `${cents < 0 ? '−' : '+'}${body}`;
};
const pctText = (v) => (Number(v) ? `${v > 0 ? '+' : ''}${Number(v)}%` : 'As planned');
export const DEFAULT_INCOME_GROWTH = 2.5;
export const DEFAULT_EXPENSE_GROWTH = 3;

function href(page, params = {}) {
  return `/?${new URLSearchParams({ section: 'planning', page, ...params }).toString().replace(/&/g, '&amp;')}`;
}

function statusBanner(status) {
  return status ? `<p class="status${status.ok ? '' : ' status-error'}">${e(status.message)}</p>` : '';
}

function noPlan(fiscalYear) {
  return `<div class="panel"><h2>No FY${fiscalYear} budget plan yet</h2><p class="muted-line">Scenarios and the forecast start from the budget plan. Build it on the <a href="${href('builder')}">Budget builder</a> page first.</p></div>`;
}

function unavailable(message) {
  return `<p class="status status-error">The FY budget plan could not be read from Connect: ${e(message)} Nothing here is a real $0.</p>`;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────────────────────

export function renderScenariosPage({ basis, planning, canEdit, status }) {
  if (!basis.ok) return `${statusBanner(status)}${unavailable(basis.message)}`;
  const { fiscalYear, lines } = basis.data;
  if (!lines.length) return `${statusBanner(status)}${noPlan(fiscalYear)}`;
  const results = planning.scenarios.map((s) => ({ s, r: applyScenario(lines, s) }));
  const cards = results.map(({ s, r }) => {
    const isBasis = planning.basisSlot === s.slot;
    const action = isBasis
      ? '<span class="pl-basis-tag">Basis for council</span>'
      : canEdit ? `<form method="POST" action="/api/v1/planning/scenario-basis"><input type="hidden" name="fiscal_year" value="${fiscalYear}"><input type="hidden" name="slot" value="${s.slot}"><button type="submit" class="button-outline pl-use">Use this scenario</button></form>` : '';
    return `<div class="pl-card${isBasis ? ' is-basis' : ''}">
      <div class="pl-card-head"><h2>${e(s.name)}</h2><span>${e(s.note || '')}</span></div>
      <dl class="pl-adjust">${ADJUSTMENTS.map((a) => `<div><dt>${a.label}</dt><dd>${s.slot === 'plan' ? 'As planned' : pctText(s[a.key])}</dd></div>`).join('')}</dl>
      <dl class="pl-totals"><div><dt>Income</dt><dd>${money(r.incomeCents)}</dd></div><div><dt>Expenses</dt><dd>${money(r.expenseCents)}</dd></div>
        <div><dt>Result</dt><dd class="${r.resultCents < 0 ? 'tone-bad' : 'tone-good'}">${signed(r.resultCents)}</dd></div></dl>
      ${action}
    </div>`;
  }).join('');
  const groupRows = ADJUSTMENTS.map((a) => {
    const members = lines.filter((l) => l.classification === a.side && a.groups.includes(l.group));
    return `<tr><td>${a.label}${a.hint ? `<small>${a.hint}</small>` : ''}</td><td>${members.length}</td>${results.map(({ r }) => `<td>${money(r.byAdjustment[a.key].scenarioCents)}</td>`).join('')}</tr>`;
  }).join('');
  const editors = canEdit ? planning.scenarios.filter((s) => s.slot !== 'plan').map((s) => `<details class="panel panel-spaced edit-panel"><summary>Adjust ${e(s.name)}</summary>
      <form method="POST" action="/api/v1/planning/scenario-save" class="form-grid">
        <input type="hidden" name="fiscal_year" value="${fiscalYear}"><input type="hidden" name="slot" value="${s.slot}">
        <label class="field"><span>Name</span><input name="name" maxlength="40" value="${e(s.name)}" required></label>
        <label class="field"><span>Note</span><input name="note" maxlength="80" value="${e(s.note || '')}"></label>
        ${ADJUSTMENTS.map((a) => `<label class="field"><span>${a.label} (% vs. plan)</span><input name="${a.key}" inputmode="decimal" value="${Number(s[a.key]) || 0}"></label>`).join('')}
        <div class="form-actions"><button type="submit">Save ${e(s.name)}</button></div>
      </form></details>`).join('') : '';
  const chosen = planning.basisChosen;
  return `${statusBanner(status)}
    <p class="lede">Three versions of FY${fiscalYear}, each built from the budget plan saved in Connect. A scenario raises or lowers groups of plan lines by a percentage; the Budget plan column is the saved plan itself. The one you pick becomes the basis the council sees and the starting point for the Multi-year forecast.</p>
    <div class="pl-cards">${cards}</div>
    ${chosen ? `<p class="muted-line">Basis chosen ${e(String(chosen.chosen_at || '').slice(0, 10))}${chosen.chosen_by ? ` by ${e(chosen.chosen_by)}` : ''}.</p>` : ''}
    <div class="panel panel-spaced list-panel"><h2>By group</h2><div class="table-scroll"><table class="pm-table pl-num"><thead><tr><th>Group</th><th>Plan lines</th>${results.map(({ s }) => `<th>${e(s.name)}</th>`).join('')}</tr></thead><tbody>${groupRows}</tbody></table></div>
      <details class="pl-lines"><summary>Which plan lines are in each group</summary><ul>${ADJUSTMENTS.map((a) => `<li><b>${a.label}:</b> ${e(lines.filter((l) => l.classification === a.side && a.groups.includes(l.group)).map((l) => l.category).join(', ') || 'none')}</li>`).join('')}</ul>
      <p class="muted-line">Lines are grouped the way Connect classifies them for the Health page (revenue streams and expense categories, including any mapping saved under Accounts &amp; Data).</p></details></div>
    ${editors}`;
}

// ── Multi-year forecast ───────────────────────────────────────────────────────────────────────

export function renderForecastPage({ basis, planning, runway, params }) {
  if (!basis.ok) return unavailable(basis.message);
  const { fiscalYear, lines } = basis.data;
  if (!lines.length) return noPlan(fiscalYear);
  const requested = params?.get('scenario');
  const scenario = planning.scenarios.find((s) => s.slot === requested) || planning.scenarios.find((s) => s.slot === planning.basisSlot) || planning.scenarios[1];
  const incomeGrowth = readGrowth(params, 'income_growth', DEFAULT_INCOME_GROWTH);
  const expenseGrowth = readGrowth(params, 'expense_growth', DEFAULT_EXPENSE_GROWTH);
  const startCash = runway ? runway.operatingCashCents : null;
  const rows = buildForecast({ firstYear: fiscalYear, first: applyScenario(lines, scenario), incomeGrowthPct: incomeGrowth, expenseGrowthPct: expenseGrowth, startCashCents: startCash });
  const last = rows.at(-1);
  const target = runway?.policyFloorMonths ?? null;
  const fy = (y) => `FY${String(y).slice(2)}`;
  const kpis = `<div class="grid">
      <div class="card"><small>FY${last.fiscalYear} result</small><strong class="${last.resultCents < 0 ? 'tone-bad' : ''}">${signed(last.resultCents)}</strong><span>If these growth rates hold</span></div>
      <div class="card"><small>Operating cash, end FY${last.fiscalYear}</small><strong>${last.cashCents === null ? '—' : money(last.cashCents)}</strong><span>${startCash === null ? 'Operating cash is not available from Connect' : `Starting from ${money(startCash)} today`}</span></div>
      <div class="card"><small>Months of reserve, FY${last.fiscalYear}</small><strong>${last.reserveMonths === null ? '—' : last.reserveMonths.toFixed(1)}</strong><span class="${target !== null && last.reserveMonths !== null ? (last.reserveMonths >= target ? 'tone-good' : 'tone-warn') : ''}">${target === null ? 'No council target set' : `Council target: ${target} months`}</span></div>
    </div>`;
  const chips = planning.scenarios.map((s) => (s.slot === scenario.slot
    ? `<span class="chip is-on">${e(s.name)}${s.slot === planning.basisSlot ? ' · basis' : ''}</span>`
    : `<a class="chip" href="${href('multi-year', { scenario: s.slot, income_growth: String(incomeGrowth), expense_growth: String(expenseGrowth) })}">${e(s.name)}${s.slot === planning.basisSlot ? ' · basis' : ''}</a>`)).join('');
  const form = `<form method="GET" action="/" class="panel panel-spaced pl-rates">
      <input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="multi-year"><input type="hidden" name="scenario" value="${scenario.slot}">
      <label>Income growth / yr <span><input type="number" name="income_growth" value="${incomeGrowth}" step="0.1" min="-15" max="15">%</span></label>
      <label>Expense growth / yr <span><input type="number" name="expense_growth" value="${expenseGrowth}" step="0.1" min="-15" max="15">%</span></label>
      <button type="submit">Recalculate</button><a class="pl-reset" href="${href('multi-year', { scenario: scenario.slot })}">Reset</a>
    </form>`;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.resultCents)));
  const chart = `<div class="pl-bars">${rows.map((r) => `<div class="pl-bar-col"><span class="pl-bar-value">${compact(r.resultCents)}</span><div class="pl-bar${r.resultCents < 0 ? ' is-deficit' : ''}" style="height:${Math.max(2, Math.abs(r.resultCents) / max * 150).toFixed(0)}px"></div><span class="pl-bar-label">${fy(r.fiscalYear)}</span></div>`).join('')}</div>`;
  const cell = (fn) => rows.map((r) => `<td>${fn(r)}</td>`).join('');
  const table = `<div class="table-scroll"><table class="pm-table pl-num"><thead><tr><th>Line</th>${rows.map((r) => `<th>${fy(r.fiscalYear)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Income</td>${cell((r) => money(r.incomeCents))}</tr>
      <tr><td>Expenses</td>${cell((r) => money(r.expenseCents))}</tr>
      <tr class="total-row"><td>Result</td>${rows.map((r) => `<td class="${r.resultCents < 0 ? 'tone-bad' : 'tone-good'}">${signed(r.resultCents)}</td>`).join('')}</tr>
      <tr><td>Operating cash, year end</td>${cell((r) => (r.cashCents === null ? '—' : money(r.cashCents)))}</tr>
      <tr><td>Months of reserve</td>${cell((r) => (r.reserveMonths === null ? '—' : r.reserveMonths.toFixed(1)))}</tr>
    </tbody></table></div>`;
  return `<p class="lede">Five fiscal years from the FY${fiscalYear} plan. The first year is the ${e(scenario.name)} scenario; each later year grows income and expenses by the rates below. Year-end cash adds each year’s result to today’s operating cash, so the rest of this year is not counted.</p>
    ${kpis}
    <div class="chip-row">${chips}</div>
    ${form}
    <div class="panel panel-spaced"><div class="panel-head"><h2>Planned result by year</h2><span class="muted">Red = deficit</span></div>${chart}</div>
    <div class="panel panel-spaced list-panel"><div class="panel-head"><h2>Five-year forecast</h2><span class="muted">FY${fiscalYear} = ${e(scenario.name)}</span></div>${table}</div>`;
}

export const PLANNING_V3_STYLES = `
    .pl-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; margin-top:16px; }
    .pl-card { background:#fff; border:1px solid #E3E7EE; border-radius:10px; padding:20px 22px; display:flex; flex-direction:column; gap:12px; }
    .pl-card.is-basis { border:2px solid var(--navy); }
    .pl-card-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap; }
    .pl-card-head h2 { margin:0; }
    .pl-card-head span { color:#9A6B12; font-size:12px; font-weight:600; }
    .pl-card dl { margin:0; }
    .pl-card dl div { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #EEF0F4; font-size:14px; }
    .pl-card dt { color:#4B5563; }
    .pl-card dd { margin:0; }
    .pl-totals { background:#F4F6F9; border-radius:8px; padding:8px 14px; }
    .pl-totals div { border-bottom:none !important; }
    .pl-totals dd { font-weight:700; }
    .pl-basis-tag { display:block; text-align:center; padding:9px 16px; border-radius:8px; background:var(--navy); color:#fff; font-weight:600; font-size:14px; }
    .pl-card form button, .pl-use { width:100%; margin-top:0; }
    .pl-num td, .pl-num th:not(:first-child) { text-align:right; }
    .pl-num td:first-child { text-align:left; }
    .pl-num td small { display:block; color:#6B7280; font-size:12px; }
    .total-row td { font-weight:700; border-top:2px solid var(--navy); }
    .pl-lines { margin-top:14px; font-size:14px; }
    .pl-lines ul { margin:8px 0; padding-left:18px; }
    .pl-rates { display:flex; flex-wrap:wrap; gap:18px; align-items:center; flex-direction:row; }
    .pl-rates label { display:flex; align-items:center; gap:10px; font-weight:600; }
    .pl-rates label span { display:flex; align-items:center; gap:4px; font-weight:400; }
    .pl-rates input { width:84px; text-align:right; }
    .pl-rates button { margin-top:0; }
    .pl-reset { font-size:14px; }
    .pl-bars { display:flex; align-items:flex-end; gap:24px; height:200px; padding:10px 20px 0; border-bottom:1px solid #D5DAE3; margin-bottom:34px; }
    .pl-bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; position:relative; }
    .pl-bar { width:min(44px,60%); background:var(--navy); border-radius:3px 3px 0 0; }
    .pl-bar.is-deficit { background:#B5412F; }
    .pl-bar-value { font-size:12px; color:#4B5563; margin-bottom:4px; }
    .pl-bar-label { position:absolute; bottom:-24px; font-size:12px; color:#4B5563; }
`;
