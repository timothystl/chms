// Financial Health, v3 design: a Summary (1a) and a By-entity (1b) view over the same resolved
// data the Full detail view (1c, rendered in shell.js) already shows. Nothing here reads data or
// computes a new figure beyond shares and ratios of values already on the page; a missing input
// renders an honest "unavailable" card, never a $0.
import { escapeHtml, formatCents, formatSignedCents } from './render-helpers.js';

export const HEALTH_VIEWS = Object.freeze([
  Object.freeze({ id: 'summary', tag: '1a', label: 'Summary' }),
  Object.freeze({ id: 'entity', tag: '1b', label: 'By entity' }),
  Object.freeze({ id: 'detail', tag: '1c', label: 'Full detail' }),
]);

export function resolveHealthView(value) {
  return HEALTH_VIEWS.find((view) => view.id === value)?.id || 'summary';
}

export function renderHealthViewToggle(activeView, { councilPreview } = {}) {
  const suffix = councilPreview ? '&amp;council=1' : '';
  return `<div class="segmented segmented-card" aria-label="Financial Health layout">${HEALTH_VIEWS.map((view) => view.id === activeView
    ? `<span class="is-on" aria-current="true"><i>${view.tag}</i>${view.label}</span>`
    : `<a href="/?section=health&amp;view=${view.id}${suffix}"><i>${view.tag}</i>${view.label}</a>`).join('')}</div>`;
}

// Results read as gains or shortfalls, so a surplus carries an explicit plus sign (+$25,460).
export function formatResultCents(cents) {
  return cents > 0 ? `+${formatCents(cents)}` : formatSignedCents(cents);
}

// Compact dollars for composition lists: $612k, $5.38M.
export function formatCompactCents(cents) {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (dollars >= 1e6) return `${sign}$${(dollars / 1e6).toFixed(2)}M`;
  if (dollars >= 1e3) return `${sign}$${Math.round(dollars / 1e3)}k`;
  return `${sign}$${Math.round(dollars)}`;
}

const MIX_COLORS = ['#1B2A4A', '#2E7EA6', '#C9973A', '#8FA3C0', '#D9C7A0'];

// Top four lines plus "Everything else", so the bar stays readable with a long chart of accounts.
export function compositionSegments(items) {
  const sorted = [...items].sort((a, b) => b.amountCents - a.amountCents);
  const total = sorted.reduce((sum, item) => sum + item.amountCents, 0);
  if (total <= 0) return [];
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4);
  const segments = top.map((item) => ({ label: item.accountName, amountCents: item.amountCents }));
  if (rest.length) segments.push({ label: 'Everything else', amountCents: rest.reduce((sum, item) => sum + item.amountCents, 0) });
  return segments.map((segment, index) => ({ ...segment, color: MIX_COLORS[index], sharePct: segment.amountCents / total * 100 }));
}

function renderComposition(title, side) {
  const segments = compositionSegments(side.items);
  return `<div class="panel">
    <h2>${escapeHtml(title)}</h2>
    <div class="stack-bar" role="img" aria-label="${escapeHtml(title)}">${segments.map((s) => `<span style="flex:${s.sharePct.toFixed(2)};background:${s.color}"></span>`).join('')}</div>
    <ul class="legend-list">${segments.map((s) => `<li><span class="swatch" style="background:${s.color}"></span><span class="legend-label">${escapeHtml(s.label)}</span><span class="legend-pct">${Math.round(s.sharePct)}%</span><b>${formatCompactCents(s.amountCents)}</b></li>`).join('')}</ul>
  </div>`;
}

function kpi(label, value, note, tone) {
  return `<div class="card kpi-hero"><small>${escapeHtml(label)}</small><strong>${value}</strong><span class="${tone ? `tone-${tone}` : ''}">${note}</span></div>`;
}

function unavailableKpi(label) {
  return `<div class="card kpi-hero"><small>${escapeHtml(label)}</small><strong class="muted-value">Unavailable</strong><span>Could not be read for this request — not a zero.</span></div>`;
}

function sourceWord(source) {
  return source === 'live' ? 'live from Connect' : 'synthetic fixture';
}

function renderAttention(attentionItems) {
  if (!attentionItems.length) return '';
  return `<ul class="attention-list">${attentionItems.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

const ENTITY_LINKS = Object.freeze({ church: '/?section=church', daycare: '/?section=daycare', property: '/?section=property' });
const RESULT_LABELS = Object.freeze({ church: 'Surplus', daycare: 'Surplus', property: 'Net operating income' });

function resultWord(entity) {
  const word = RESULT_LABELS[entity.id] || 'Result';
  return entity.resultCents < 0 && word === 'Surplus' ? 'Deficit' : word;
}

export function renderHealthSummary({ health, runway, mix, entities, incomeVsBudget, attentionItems }) {
  const operating = health.operating
    ? kpi('Church surplus, year to date', formatResultCents(health.operating.actualNetCents),
      `${formatCents(Math.abs(health.operating.varianceCents))} ${health.operating.varianceCents >= 0 ? 'better' : 'worse'} than budget · ${sourceWord(health.operating.source)}`,
      health.operating.varianceCents >= 0 ? 'good' : 'bad')
    : unavailableKpi('Church surplus, year to date');
  const cash = runway
    ? kpi('Operating cash runway', `${runway.runwayMonths.toFixed(1)} mo`, `${formatCents(runway.operatingCashCents)} covers ~${Math.round(runway.runwayMonths)} months of expenses · ${sourceWord(runway.source)}`)
    : unavailableKpi('Operating cash runway');
  const income = incomeVsBudget
    ? kpi('Income vs. budget', `${Math.round(incomeVsBudget.actualCents / incomeVsBudget.budgetCents * 100)}%`,
      `${formatCents(Math.abs(incomeVsBudget.actualCents - incomeVsBudget.budgetCents))} ${incomeVsBudget.actualCents >= incomeVsBudget.budgetCents ? 'ahead of' : 'behind'} budget`,
      incomeVsBudget.actualCents >= incomeVsBudget.budgetCents ? 'good' : 'warn')
    : unavailableKpi('Income vs. budget');
  const position = health.position
    ? kpi('Net assets', formatCompactCents(health.position.netAssetsCents), `Assets ${formatCompactCents(health.position.assetsCents)} · liabilities ${formatCompactCents(health.position.liabilitiesCents)}`)
    : unavailableKpi('Net assets');
  const composition = mix
    ? `<div class="panel-grid">${renderComposition('Where church income comes from', mix.income)}${renderComposition('Where church money goes', mix.expenses)}</div>`
    : '<p class="status status-pending">The revenue and expense mix could not be read for this request. Nothing shown here is a real $0 — see Data &amp; Imports.</p>';
  const strip = entities
    ? `<div class="entity-strip">${entities.entities.map((entity) => `<a class="entity-mini" href="${ENTITY_LINKS[entity.id]}"><div><b>${escapeHtml(entity.label)}</b><small>${escapeHtml(entity.periodLabel)} · ${sourceWord(entity.source)}</small></div><div class="entity-mini-value"><strong class="${entity.resultCents >= 0 ? 'tone-good' : 'tone-bad'}">${formatResultCents(entity.resultCents)}</strong><small>${resultWord(entity)}</small></div></a>`).join('')}</div>`
    : '';
  return `<section aria-label="Financial health summary">
    ${renderAttention(attentionItems)}
    <div class="grid kpi-grid">${operating}${cash}${income}${position}</div>
    ${composition}
    ${strip}
  </section>`;
}

export function renderHealthByEntity({ health, runway, entities }) {
  const cards = entities
    ? `<div class="entity-grid">${entities.entities.map((entity) => `<div class="entity-card">
        <div class="entity-band"><h2>${escapeHtml(entity.label)}</h2><span>${escapeHtml(entity.periodLabel)} · ${sourceWord(entity.source)}</span></div>
        <div class="entity-body">
          <small>${resultWord(entity)}</small>
          <strong class="${entity.resultCents >= 0 ? 'tone-good' : 'tone-bad'}">${formatResultCents(entity.resultCents)}</strong>
          <div class="meter" aria-hidden="true"><span style="width:${entity.incomeCents > 0 ? Math.min(100, entity.expenseCents / entity.incomeCents * 100).toFixed(1) : 100}%"></span></div>
          <p class="meter-note">Expenses are ${entity.incomeCents > 0 ? `${Math.round(entity.expenseCents / entity.incomeCents * 100)}%` : 'all'} of income</p>
          <ul class="line-list">
            <li><span>Income</span><b>${formatCents(entity.incomeCents)}</b></li>
            <li><span>Expenses</span><b>${formatCents(entity.expenseCents)}</b></li>
          </ul>
          <a href="${ENTITY_LINKS[entity.id]}">Open ${escapeHtml(entity.label)} overview</a>
        </div>
      </div>`).join('')}</div>`
    : '<p class="status status-pending">The entity overview could not be read for this request. Nothing shown here is a real $0 — see Data &amp; Imports.</p>';
  const cell = (label, value, note) => `<div><small>${label}</small><strong>${value}</strong><span>${note}</span></div>`;
  const position = `<div class="position-strip">
    ${runway ? cell('Operating cash', formatCents(runway.operatingCashCents), `${escapeHtml(runway.accountName)} · ${sourceWord(runway.source)}`) : cell('Operating cash', 'Unavailable', 'Not a zero')}
    ${health.position ? cell('Total assets', formatCents(health.position.assetsCents), sourceWord(health.position.source)) : cell('Total assets', 'Unavailable', 'Not a zero')}
    ${health.position ? cell('Total liabilities', formatCents(health.position.liabilitiesCents), sourceWord(health.position.source)) : cell('Total liabilities', 'Unavailable', 'Not a zero')}
    ${health.position ? cell('Net assets', formatCents(health.position.netAssetsCents), 'Assets minus liabilities') : cell('Net assets', 'Unavailable', 'Not a zero')}
  </div>`;
  return `<section aria-label="Financial health by entity">
    <p class="lede">Each ministry reports on its own period, so they sit side by side instead of being added together.</p>
    ${cards}
    ${position}
  </section>`;
}

export const HEALTH_STYLES = `
    .segmented-card { background:#fff; border:1px solid var(--line); }
    .segmented i { font-style:normal; font-size:11px; font-weight:600; opacity:.75; margin-right:6px; }
    .kpi-grid { grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); }
    .kpi-hero { padding:20px 22px; gap:8px; }
    .kpi-hero strong { font-size:36px; line-height:1; }
    .muted-value { color:var(--faint) !important; font-size:26px !important; }
    .tone-good { color:var(--green) !important; }
    .tone-bad { color:var(--red) !important; }
    .tone-warn { color:var(--gold-ink) !important; }
    .panel-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr)); gap:14px; margin-top:14px; }
    .panel { display:flex; flex-direction:column; gap:16px; padding:22px 24px; border:1px solid var(--line); border-radius:10px; background:#fff; }
    .panel h2 { margin:0; }
    .stack-bar { display:flex; height:14px; gap:2px; border-radius:7px; overflow:hidden; }
    .legend-list { list-style:none; margin:0; padding:0; }
    .legend-list li { display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--line-soft); font-size:14px; }
    .swatch { width:10px; height:10px; border-radius:2px; flex:0 0 auto; }
    .legend-label { flex:1; min-width:0; }
    .legend-pct { color:var(--muted); width:3.2rem; text-align:right; }
    .legend-list b { font-weight:500; width:4.5rem; text-align:right; }
    .entity-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px; margin-top:14px; }
    .entity-mini { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:18px 22px; border:1px solid var(--line); border-radius:10px; background:#fff; text-decoration:none; color:var(--ink); }
    .entity-mini:hover { border-color:#C9D0DC; color:var(--ink); }
    .entity-mini b { display:block; font-family:"Outfit",sans-serif; font-weight:500; font-size:16px; color:var(--navy); }
    .entity-mini small { color:var(--muted); font-size:12px; }
    .entity-mini-value { text-align:right; }
    .entity-mini-value strong { display:block; font-family:"Outfit",sans-serif; font-weight:500; font-size:24px; }
    .lede { margin:14px 0 0; font-size:14px; }
    .entity-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr)); gap:14px; margin-top:14px; }
    .entity-card { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff; display:flex; flex-direction:column; }
    .entity-band { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:16px 20px; background:var(--navy); }
    .entity-band h2 { margin:0; color:#fff; font-size:20px; }
    .entity-band span { color:#D9DEE8; font-size:12px; }
    .entity-body { display:flex; flex-direction:column; gap:4px; padding:20px; flex:1; }
    .entity-body small { color:var(--muted); font-size:13px; }
    .entity-body strong { font-family:"Outfit",sans-serif; font-weight:500; font-size:34px; line-height:1.1; }
    .meter { height:8px; margin-top:14px; border-radius:4px; background:var(--line-soft); overflow:hidden; }
    .meter span { display:block; height:100%; background:var(--gold); border-radius:4px; }
    .meter-note { margin:6px 0 0; font-size:12.5px; }
    .line-list { list-style:none; margin:10px 0 14px; padding:0; }
    .line-list li { display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--line-soft); font-size:14px; color:var(--muted); }
    .line-list b { color:var(--ink); font-weight:500; }
    .entity-body > a { margin-top:auto; font-size:14px; }
    .position-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin-top:14px; padding:18px 22px; border:1px solid var(--line); border-radius:10px; background:#fff; }
    .position-strip small { display:block; color:var(--muted); font-size:13px; }
    .position-strip strong { display:block; margin-top:4px; font-family:"Outfit",sans-serif; font-weight:500; font-size:24px; color:var(--navy); }
    .position-strip span { display:block; margin-top:2px; color:var(--muted); font-size:12px; }
`;
