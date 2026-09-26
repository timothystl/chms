// Financial Health, Full detail (1c): every section of Connect's legacy Financial Health tab
// (finRenderHealth in src/frontend/js-finance.js), rendered server-side from
// connect.finance-health.v1. Every figure arrives finished from Connect; this module only lays
// it out. Finance's CSP allows no script, so the charts and the flow diagram are inline SVG or CSS,
// the fund list is a <details>, and the two toggles (Flow/Share, Gap/Gap + reserves) are links.
import { escapeHtml, formatCents } from './render-helpers.js';
import { formatResultCents } from './health-pages.js';

const e = escapeHtml;
const money = (cents) => formatCents(cents);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STREAM_COLORS = { donor: '#2E7EA6', earned: '#C9973A', passive: '#2F7D5B' };
const STREAM_SHORT = { donor: 'Donor', earned: 'Earned', passive: 'Passive' };
const DISPLAY_STREAMS = ['donor', 'earned', 'passive'];

export const HEALTH_APPEAL_SCOPES = Object.freeze(['gapReserves', 'gap']);
export function resolveAppealScope(value) { return value === 'gap' ? 'gap' : 'gapReserves'; }
export function resolveFlowView(value) { return value === 'share' ? 'share' : 'flow'; }

function healthHref({ flow, appeal, councilPreview }, anchor) {
  const params = new URLSearchParams({ section: 'health', view: 'detail' });
  if (flow === 'share') params.set('flow', 'share');
  if (appeal === 'gap') params.set('appeal', 'gap');
  if (councilPreview) params.set('council', '1');
  return `/?${params.toString().replace(/&/g, '&amp;')}#${anchor}`;
}

// Restricted income is drawn inside donor wherever the mix is shown as a whole (displayStreamOf).
function displayStreams(streams) {
  return {
    donor: streams.donor.cents + streams.restricted.cents,
    earned: streams.earned.cents,
    passive: streams.passive.cents,
  };
}

function bar(label, value, pct, color) {
  return `<div class="hp-bar-head"><span>${label}</span><b>${value}</b></div>
    <div class="hp-track"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;background:${color}"></span></div>`;
}

function card(inner, { accent, id, extraClass = '' } = {}) {
  return `<div class="hp-card ${extraClass}"${id ? ` id="${id}"` : ''}${accent ? ` style="border-top:3px solid ${accent}"` : ''}>${inner}</div>`;
}

function chip(text, tone) {
  return `<span class="hp-chip hp-chip-${tone}">${text}</span>`;
}

// ── A. The revenue mix bar, with the band marking how much say the board has over each stream.
function renderRevenueMix(h) {
  const rs = h.revenueStreams;
  if (!rs.totalCents) {
    return card('<h2>The revenue mix</h2><p>No revenue recorded for this year yet — sync or import the church ledger from <a href="/?section=data">Data &amp; Imports</a>.</p>');
  }
  const control = {
    donor: { note: 'We set the ask', color: '#1B2A4A' },
    earned: { note: 'Reported to us', color: '#8A93A5' },
    passive: { note: 'Timing only', color: '#8A611C' },
  };
  const shown = displayStreams(rs.streams);
  const restricted = rs.streams.restricted.cents;
  let segs = '', band = '';
  const narrow = [];
  for (const s of DISPLAY_STREAMS) {
    const cents = shown[s];
    if (!cents) continue;
    const pct = cents / rs.totalCents * 100;
    const wide = pct >= 9;
    if (!wide) narrow.push(`${STREAM_SHORT[s]} ${money(cents)}`);
    segs += `<div class="hp-seg" style="width:${pct.toFixed(1)}%;background:${STREAM_COLORS[s]}"><span class="hp-seg-lbl">${STREAM_SHORT[s]}</span>${wide ? `<span class="hp-seg-val">${money(cents)} · ${Math.round(pct)}%</span>` : ''}</div>`;
    band += `<div style="width:${pct.toFixed(1)}%;border-top:3px solid ${control[s].color};color:${control[s].color}">${control[s].note}</div>`;
  }
  return card(`<div class="hp-split"><div><h2>The revenue mix</h2><p class="hp-sub">One bar, one segment per stream. The band under it marks how much say the board actually has.${restricted ? ` Donor includes ${money(restricted)} of restricted gifts — donor-directed, but still funding the budget.` : ''}</p></div>
    <div class="hp-right"><div class="eyebrow">Total revenue</div><div class="hp-big">${money(rs.totalCents)}</div></div></div>
    <div class="hp-stream-bar" role="img" aria-label="Revenue mix by stream">${segs}</div>
    <div class="hp-band">${band}</div>
    ${narrow.length ? `<p class="hp-note">Too narrow to label above: ${e(narrow.join(' · '))}.</p>` : ''}`);
}

// ── B. One card per stream, each naming the board's authority over it.
function renderStreamCards(h) {
  const rs = h.revenueStreams;
  const total = rs.totalCents;
  const pctOf = (cents) => (total ? Math.round(cents / total * 100) : 0);
  const { donor, earned, passive, restricted } = rs.streams;
  const subBars = (groups, colors) => {
    const max = groups.reduce((m, g) => Math.max(m, g.cents), 1);
    return groups.slice(0, 3).map((g, i) => bar(e(g.label), money(g.cents), g.cents / max * 100, colors[Math.min(i, colors.length - 1)])).join('');
  };
  const donorTotal = donor.cents + restricted.cents;
  const donorMax = Math.max(donor.cents, restricted.cents, 1);
  const households = h.giving.givingHouseholds;
  const donorCard = card(`<div class="hp-split"><span class="eyebrow">Donor income</span>${chip('Full control', 'info')}</div>
    <div class="hp-stream-val">${money(donorTotal)}</div>
    <p class="hp-sub">${pctOf(donorTotal)}% of revenue · ${households} giving household${households === 1 ? '' : 's'}</p>
    <div class="hp-stack">${donorTotal
      ? `${bar('Unrestricted', money(donor.cents), donor.cents / donorMax * 100, '#2E7EA6')}${bar('Restricted', money(restricted.cents), restricted.cents / donorMax * 100, '#9CC6DC')}
        <p class="hp-note">${restricted.cents ? 'Restricted gifts are donor-directed but spent on our own ministry, so they do fund the budget. ' : ''}Designated funds are counted separately below — they never pay a budgeted expense.</p>`
      : '<p class="hp-note">No account group is classified as donor income yet. Set it on <a href="/?section=data">Data &amp; Imports</a>.</p>'}</div>
    <a class="hp-link" href="/?section=giving-analytics">Giving detail →</a>`, { accent: '#2E7EA6' });
  const shown = displayStreams(rs.streams);
  const largest = earned.cents > 0 && DISPLAY_STREAMS.every((k) => earned.cents >= shown[k]);
  const earnedCard = card(`<div class="hp-split"><span class="eyebrow">Earned income</span>${chip('Reported, not managed', 'warn')}</div>
    <div class="hp-stream-val">${money(earned.cents)}</div>
    <p class="hp-sub">${pctOf(earned.cents)}% of revenue${largest ? ' · our largest single stream' : ''}</p>
    <div class="hp-stack">${earned.groups.length ? subBars(earned.groups, ['#C9973A', '#E0BE7C']) : '<p class="hp-note">No account group is classified as earned income yet.</p>'}</div>
    <a class="hp-link" href="/?section=daycare">Daycare Report →</a>`, { accent: '#C9973A' });
  const passiveCard = card(`<div class="hp-split"><span class="eyebrow">Passive income</span>${chip('Timing decision', 'good')}</div>
    <div class="hp-stream-val">${money(passive.cents)}</div>
    <p class="hp-sub">${pctOf(passive.cents)}% of revenue · endowment, investments, property</p>
    <div class="hp-stack">${passive.groups.length ? subBars(passive.groups, ['#2F7D5B', '#A9C6AC']) : '<p class="hp-note">No account group is classified as passive income yet.</p>'}</div>
    <a class="hp-link" href="/?section=property">Commercial Property →</a>`, { accent: '#2F7D5B' });
  return `<div class="hp-grid-3">${donorCard}${earnedCard}${passiveCard}</div>`;
}

// ── C. Designated funds, and whether recorded giving ties out to booked donor income.
function renderDesignatedFunds(h) {
  const g = h.designatedFunds;
  if (!g.funds.length) return '';
  const ledgerDonorCents = h.revenueStreams.streams.donor.cents + h.revenueStreams.streams.restricted.cents;
  const diff = g.operatingGivenCents - ledgerDonorCents;
  const hasBal = g.balanceCents != null;
  const dash = '<span class="hp-muted">—</span>';
  const rows = g.funds.map((f) => `<tr><td>${e(f.label)}</td><td class="num">${f.givenCents ? money(f.givenCents) : dash}</td><td class="num">${f.balanceCents == null ? dash : money(f.balanceCents)}</td></tr>`).join('');
  const wide = Math.abs(diff) > Math.max(Math.round(ledgerDonorCents * 0.02), 500000);
  return card(`<div class="hp-split"><div><h2>Designated funds</h2><p class="hp-sub">Held, not operated on. None of this can pay a budgeted expense, so it is counted apart from revenue.</p></div>
    <div class="hp-right"><div class="eyebrow">Given this year</div><div class="hp-big">${money(g.designatedGivenCents)}</div>${hasBal ? `<p class="hp-note">${money(g.balanceCents)} on hand${g.asOfDate ? ` · ${e(g.asOfDate)}` : ''}</p>` : ''}</div></div>
    <details class="hp-details"><summary>Show the ${g.funds.length} fund${g.funds.length === 1 ? '' : 's'}</summary>
      <div class="table-wrap"><table><thead><tr><th>Fund</th><th class="num">Given this year</th><th class="num">Balance on hand</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hp-note">“Given this year” comes from our giving records; “balance on hand” from the imported balance sheet, where these funds sit as liabilities. ${hasBal ? 'A fund can show one without the other — given to but not yet reported on the statement, or holding a balance nobody gave to this year.' : 'No balance sheet is on file, so nothing can be shown on hand yet.'}</p>
    </details>
    <p class="hp-tie"><b>Does this tie out?</b> Recorded giving ${money(h.giving.givingCents)} − designated ${money(g.designatedGivenCents)} = <b>${money(g.operatingGivenCents)}</b> that funds the budget, against ${money(ledgerDonorCents)} of donor income booked in the ledger — a difference of <b>${money(Math.abs(diff))}</b>. ${wide ? 'That is wider than timing alone usually explains; a fund is likely classified differently on one side.' : 'Small differences are normal — a gift recorded in one year and booked in the next.'}</p>`);
}

// ── D. "How the money moves": the legacy four-column Sankey (finFlowLayout/finRenderSankey), with
// the same collision-free label layout, and the two-donut Share view behind a link toggle.
const FLOW = {
  colors: {
    donor: '#2E7EA6', earned: '#C9973A', passive: '#6B8F71', total: '#1E2D4A',
    sourceTint: { donor: ['#2E7EA6', '#4E97BC', '#7FB4CC', '#A9CCDD'], earned: ['#C9973A', '#E0BE7C', '#EFD9A8'], passive: ['#6B8F71', '#A9C6AC'] },
    expense: ['#1E2D4A', '#3E5379', '#6B7FA3', '#9FAEC7', '#C9D3E2'],
  },
  note: { donor: 'the only stream we set', earned: 'reported to us, not set by us', passive: 'timing decision only' },
  label: { donor: 'Donor revenue', earned: 'Earned income', passive: 'Passive income' },
  cols: {
    sources: { barX: 6, barW: 10, labelX: 24, anchor: 'start', ribbonOut: 16, maxLabelW: 298 },
    streams: { barX: 330, barW: 10, labelX: 348, anchor: 'start', ribbonIn: 330, ribbonOut: 340, maxLabelW: 254 },
    total: { barX: 610, barW: 10, labelX: 628, anchor: 'start', ribbonIn: 610, ribbonOut: 620, maxLabelW: 110 },
    expenses: { barX: 1064, barW: 10, labelX: 1056, anchor: 'end', ribbonIn: 1064, maxLabelW: 300 },
  },
  box: { two: { top: -13, bottom: 20 }, twoNote: { top: -13, bottom: 36 }, one: { top: -9, bottom: 9 } },
  width: 1080,
  refHeight: 626,
};
const charW = (fontSize) => fontSize * 0.62;
function truncate(text, maxPx, pxPerChar) {
  const max = Math.max(4, Math.floor(maxPx / pxPerChar));
  const s = String(text == null ? '' : text);
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/[\s,;:.-]+$/, '')}…`;
}
function flowScale(totalRevenueCents) {
  const thousands = (totalRevenueCents || 0) / 100 / 1000;
  if (!thousands) return 0.4;
  const REF = 1165;
  if (Math.abs(thousands - REF) / REF <= 0.15) return 0.4;
  return Math.max(0.28, Math.min(0.55, 540 / thousands));
}
function stackColumn(nodes, startY, scale, gaps, uniformGap, twoLineMinH, hasNote) {
  const out = [];
  let y = startY;
  const modeOf = (h, n) => (h >= twoLineMinH ? (hasNote && n.note ? 'twoNote' : 'two') : 'one');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const h = Math.max(2, (n.cents / 100 / 1000) * scale);
    const mode = modeOf(h, n);
    const box = FLOW.box[mode];
    const node = { ref: n, h, y, cy: y + h / 2, labelMode: mode, labelTop: y + h / 2 + box.top, labelBottom: y + h / 2 + box.bottom };
    if (i === 0 && node.labelTop < 20) {
      const push = 20 - node.labelTop;
      node.y += push; node.cy += push; node.labelTop += push; node.labelBottom += push;
    }
    out.push(node);
    const authored = gaps && gaps[i] != null ? gaps[i] : (uniformGap != null ? uniformGap : Math.max(10, 22 - h));
    const byGap = node.y + node.h + authored;
    const next = nodes[i + 1];
    let byLabel = -Infinity;
    if (next) {
      const nh = Math.max(2, (next.cents / 100 / 1000) * scale);
      byLabel = node.labelBottom + 2 - FLOW.box[modeOf(nh, next)].top - nh / 2;
    }
    y = Math.max(byGap, byLabel);
  }
  return out;
}
export function layoutFlow(diagram) {
  const scale = flowScale(diagram.totalRevenueCents);
  const streamNodes = diagram.streams.map((s) => ({ id: s.id, label: FLOW.label[s.id] || s.id, cents: s.cents, note: FLOW.note[s.id] }));
  const sources = stackColumn(diagram.sources, 22, scale, [10, 18, 14, 18, 18, 16], null, 20, false);
  const streams = stackColumn(streamNodes, 44, scale, null, 14, 20, true);
  const expenses = stackColumn(diagram.expenses, 30, scale, null, 14, 40, true);
  const revenueH = Math.max(2, (diagram.totalRevenueCents / 100 / 1000) * scale);
  const total = { ref: { label: 'Total revenue', cents: diagram.totalRevenueCents }, h: revenueH, y: 60, cy: 60 + revenueH / 2, labelMode: 'two', labelTop: 60 + revenueH / 2 - 13, labelBottom: 60 + revenueH / 2 + 20 };
  const deepest = [sources, streams, expenses, [total]].reduce((m, col) => col.reduce((mm, n) => Math.max(mm, n.y + n.h, n.labelBottom), m), 0);
  const canvasH = Math.max(FLOW.refHeight, Math.ceil(deepest + 34));
  return { scale, canvasH, footerRuleY: canvasH - 28, footerTextY: canvasH - 10, sources, streams, total, expenses };
}
function ribbon(x0, x1, a, b, c, d, fill, opacity) {
  const xm = x0 + (x1 - x0) / 2;
  return `<path d="M${x0},${a.toFixed(1)} C${xm},${a.toFixed(1)} ${xm},${c.toFixed(1)} ${x1},${c.toFixed(1)} L${x1},${d.toFixed(1)} C${xm},${d.toFixed(1)} ${xm},${b.toFixed(1)} ${x0},${b.toFixed(1)} Z" fill="${fill}" opacity="${opacity}"></path>`;
}
function renderSankey(diagram, layout) {
  const C = FLOW.cols;
  const tintIdx = { donor: 0, earned: 0, passive: 0 };
  for (const n of layout.sources) {
    const ramp = FLOW.colors.sourceTint[n.ref.stream] || [FLOW.colors.total];
    n.color = ramp[Math.min(tintIdx[n.ref.stream]++, ramp.length - 1)];
  }
  layout.expenses.forEach((n, i) => { n.color = FLOW.colors.expense[Math.min(i, FLOW.colors.expense.length - 1)]; });
  layout.streams.forEach((n) => { n.color = FLOW.colors[n.ref.id] || FLOW.colors.total; });
  const streamById = Object.fromEntries(layout.streams.map((n) => [n.ref.id, n]));
  let ribbons = '';
  const streamCursor = Object.fromEntries(layout.streams.map((n) => [n.ref.id, n.y]));
  for (const n of layout.sources) {
    const target = streamById[n.ref.stream];
    if (!target) continue;
    const c = streamCursor[n.ref.stream];
    const siblings = layout.sources.filter((x) => x.ref.stream === n.ref.stream).reduce((s, x) => s + x.h, 0);
    const h = n.h * (target.h / Math.max(1e-6, siblings));
    ribbons += ribbon(C.sources.ribbonOut, C.streams.ribbonIn, n.y, n.y + n.h, c, c + h, n.color, 0.42);
    streamCursor[n.ref.stream] = c + h;
  }
  let totalCursor = layout.total.y;
  const streamSum = layout.streams.reduce((s, n) => s + n.h, 0) || 1;
  for (const n of layout.streams) {
    const h = n.h * (layout.total.h / streamSum);
    ribbons += ribbon(C.streams.ribbonOut, C.total.ribbonIn, n.y, n.y + n.h, totalCursor, totalCursor + h, n.color, 0.5);
    totalCursor += h;
  }
  const expenseSum = layout.expenses.reduce((s, n) => s + n.h, 0) || 1;
  const k = layout.total.h / expenseSum;
  let outCursor = layout.total.y;
  for (const n of layout.expenses) {
    const lh = n.h * k;
    ribbons += ribbon(C.total.ribbonOut, C.expenses.ribbonIn, outCursor, outCursor + lh, n.y, n.y + n.h, n.color, 0.34);
    outCursor += lh;
  }
  const rect = (n, col) => `<rect x="${col.barX}" y="${n.y.toFixed(1)}" width="${col.barW}" height="${n.h.toFixed(1)}" rx="2" fill="${n.color}"></rect>`;
  const label = (n, col, amountColor) => {
    const a = col.anchor === 'end' ? ' text-anchor="end"' : '';
    const amount = money(n.ref.cents);
    if (n.labelMode === 'one') {
      const w = charW(11);
      const text = truncate(n.ref.label, col.maxLabelW - (amount.length + 1) * w, w);
      return `<text x="${col.labelX}" y="${(n.cy + 4).toFixed(1)}"${a} font-size="11" font-weight="700" fill="#5C4B2E">${e(text)} <tspan font-weight="800" fill="#1A1A2A">${amount}</tspan></text>`;
    }
    let out = `<text x="${col.labelX}" y="${(n.cy - 3).toFixed(1)}"${a} font-size="12.5" font-weight="800" fill="#1A1A2A">${e(truncate(n.ref.label, col.maxLabelW, charW(12.5)))}</text>`
      + `<text x="${col.labelX}" y="${(n.cy + 14).toFixed(1)}"${a} font-size="14.5" font-weight="800" fill="${amountColor}">${amount}</text>`;
    if (n.labelMode === 'twoNote' && n.ref.note) out += `<text x="${col.labelX}" y="${(n.cy + 30).toFixed(1)}"${a} font-size="10.5" fill="#8A8377">${e(truncate(n.ref.note, col.maxLabelW, charW(10.5)))}</text>`;
    return out;
  };
  const nodes = layout.sources.map((n) => rect(n, C.sources) + label(n, C.sources, n.color)).join('')
    + layout.streams.map((n) => rect(n, C.streams) + label(n, C.streams, n.color)).join('')
    + `<rect x="${C.total.barX}" y="${layout.total.y.toFixed(1)}" width="${C.total.barW}" height="${layout.total.h.toFixed(1)}" rx="2" fill="${FLOW.colors.total}"></rect>`
    + `<text x="${C.total.labelX}" y="${(layout.total.cy - 3).toFixed(1)}" font-size="12.5" font-weight="800" fill="#1A1A2A">Total revenue</text>`
    + `<text x="${C.total.labelX}" y="${(layout.total.cy + 14).toFixed(1)}" font-size="14.5" font-weight="800" fill="${FLOW.colors.total}">${money(diagram.totalRevenueCents)}</text>`
    + layout.expenses.map((n) => rect(n, C.expenses) + label(n, C.expenses, FLOW.colors.total)).join('');
  const headers = `<g font-size="10" font-weight="700" fill="#A99A7E" letter-spacing="1"><text x="${C.sources.labelX}" y="12">SOURCES</text><text x="${C.streams.labelX}" y="12">STREAMS</text><text x="${C.total.labelX}" y="12">ALL REVENUE</text><text x="${C.expenses.labelX}" y="12" text-anchor="end">WHERE IT GOES</text></g>`;
  const net = diagram.netCents;
  const footer = net < 0
    ? `${money(diagram.totalExpenseCents)} goes out against ${money(diagram.totalRevenueCents)} in — a ${money(-net)} gap, before any one bad month.`
    : `${money(diagram.totalRevenueCents)} comes in against ${money(diagram.totalExpenseCents)} out — ${money(net)} to the good.`;
  const biggestSource = [...layout.sources].sort((a, b) => b.ref.cents - a.ref.cents)[0];
  const biggestExpense = [...layout.expenses].sort((a, b) => b.ref.cents - a.ref.cents)[0];
  const aria = `Money flow for the year. ${money(diagram.totalRevenueCents)} of revenue${biggestSource ? `, the largest source being ${biggestSource.ref.label} at ${money(biggestSource.ref.cents)}` : ''}, against ${money(diagram.totalExpenseCents)} of expenses${biggestExpense ? `, the largest being ${biggestExpense.ref.label} at ${money(biggestExpense.ref.cents)}` : ''}. ${footer}`;
  return `<svg class="hp-sankey" viewBox="0 0 ${FLOW.width} ${layout.canvasH}" width="100%" role="img" aria-label="${e(aria)}">${ribbons}${nodes}${headers}`
    + `<line x1="6" y1="${layout.footerRuleY}" x2="1074" y2="${layout.footerRuleY}" stroke="#EFE6D4"></line>`
    + `<text x="6" y="${layout.footerTextY}" font-size="11.5" font-weight="700" fill="${net < 0 ? '#B4412F' : '#2F7D5B'}">${e(footer)}</text></svg>`;
}
function renderDonut(title, slices, totalCents, caption) {
  const C = 414.69, r = 66;
  let cum = 0;
  const total = totalCents || slices.reduce((s, x) => s + x.cents, 0) || 1;
  const segs = slices.map((sl) => {
    const len = sl.cents / total * C;
    const seg = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${sl.color}" stroke-width="30" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-cum).toFixed(2)}" transform="rotate(-90 90 90)"></circle>`;
    cum += len;
    return seg;
  }).join('');
  const abbrev = Math.abs(total) >= 100000000 ? `$${(total / 100 / 1000000).toFixed(3)}M` : money(total);
  const rows = slices.map((sl) => `<li><span class="swatch" style="background:${sl.color}"></span><span class="legend-label">${e(sl.label)}</span><b>${money(sl.cents)}</b><span class="legend-pct">${Math.round(sl.cents / total * 100)}%</span></li>`).join('');
  return `<div class="hp-donut"><div class="eyebrow">${e(title)}</div><div class="hp-donut-body">
    <svg viewBox="0 0 180 180" width="164" height="164" role="img" aria-label="${e(`${title}: ${slices.map((sl) => `${sl.label} ${money(sl.cents)}`).join(', ')}`)}">${segs}
      <text x="90" y="86" text-anchor="middle" font-size="20" font-weight="800" fill="#1A1A2A">${abbrev}</text>
      <text x="90" y="104" text-anchor="middle" font-size="10.5" font-weight="700" fill="#8A8377" letter-spacing=".5">${e(caption)}</text></svg>
    <ul class="legend-list">${rows}</ul></div></div>`;
}
function renderFlow(h, state) {
  const d = h.flowDiagram;
  if (!d.totalRevenueCents) return '';
  const view = state.flow;
  const toggle = `<div class="segmented segmented-card" aria-label="Chart view">${[['flow', 'Flow'], ['share', 'Share']].map(([id, text]) => (id === view
    ? `<span class="is-on" aria-current="true">${text}</span>`
    : `<a href="${healthHref({ ...state, flow: id }, 'hp-flow')}">${text}</a>`)).join('')}</div>`;
  const body = view === 'share'
    ? `<div class="hp-donuts">${renderDonut('Money in', d.streams.map((s) => ({ label: FLOW.label[s.id] || s.id, cents: s.cents, color: FLOW.colors[s.id] || FLOW.colors.total })), d.totalRevenueCents, 'TOTAL REVENUE')}${renderDonut('Money out', d.expenses.map((x, i) => ({ label: x.label, cents: x.cents, color: FLOW.colors.expense[Math.min(i, FLOW.colors.expense.length - 1)] })), d.totalExpenseCents, 'TOTAL EXPENSES')}</div>`
    : `<div class="hp-sankey-wrap">${renderSankey(d, layoutFlow(d))}</div>`;
  const table = `<details class="hp-details"><summary>The figures behind the chart</summary><div class="table-wrap"><table><thead><tr><th>Item</th><th>Group</th><th class="num">Amount</th></tr></thead><tbody>${
    d.sources.map((s) => `<tr><td>${e(s.label)}</td><td>${e(FLOW.label[s.stream] || s.stream)}</td><td class="num">${money(s.cents)}</td></tr>`).join('')
    + d.expenses.map((x) => `<tr><td>${e(x.label)}</td><td>Expenses</td><td class="num">${money(x.cents)}</td></tr>`).join('')}</tbody></table></div></details>`;
  return card(`<div class="hp-split"><div><h2>How the money moves</h2><p class="hp-sub">${money(d.totalRevenueCents)} in · ${money(d.totalExpenseCents)} out · net ${formatResultCents(d.netCents)} across all three entities.</p></div>${toggle}</div>${body}${table}`, { id: 'hp-flow' });
}

// ── E. The three engines: what the board decides differs for each, and each card says so.
function planBar(label, actual, budget, color) {
  const pct = budget > 0 ? actual / budget * 100 : 0;
  return bar(label, budget > 0 ? `${Math.round(pct)}% of ${money(budget)}` : 'no plan set', pct, color);
}
function renderEngines(h) {
  const c = h.church;
  const churchCard = card(`<div class="hp-split"><span class="eyebrow">Church operating</span>${c.netActualCents < 0 ? chip('Needs action', 'bad') : chip('In surplus', 'good')}</div>
    <div class="hp-engine-val">${formatResultCents(c.netActualCents)}</div>
    <p class="hp-sub">Revenue ${money(c.incomeActualCents)} · Expenses ${money(c.expenseActualCents)}</p>
    <div class="hp-stack">${planBar('Revenue vs. plan', c.incomeActualCents, c.incomeBudgetCents, '#2E7EA6')}${planBar('Expenses vs. plan', c.expenseActualCents, c.expenseBudgetCents, '#C9973A')}</div>
    <p class="hp-notebox">Board owns this budget.${c.projection.available ? ` Projected year-end <b>${formatResultCents(c.projection.projectedNetCents)}</b>.` : ' A year-end projection needs monthly-granularity data for this year and last.'}</p>`,
  { accent: c.netActualCents < 0 ? '#B4412F' : '#2F7D5B' });
  const dc = h.daycare;
  let daycareBody;
  if (!dc) daycareBody = '<p class="status status-pending">The daycare figures could not be read for this request — not a zero.</p>';
  else if (!dc.available) daycareBody = `<p class="hp-sub">No ${dc.year} daycare figures imported yet.</p>`;
  else {
    daycareBody = `<div class="hp-engine-val">${formatResultCents(dc.netActualCents)}</div>
      <p class="hp-sub">Tuition ${money(dc.incomeActualCents)} · Costs ${money(dc.expenseActualCents)}</p>
      ${dc.allocatedSharedCostsCents ? `<div class="hp-stack">${bar('Covers its allocated share', `${money(dc.allocatedSharedCostsCents)} of utilities &amp; insurance`, 100, '#2F7D5B')}</div>` : ''}`;
  }
  const dcGood = dc && dc.available && dc.netActualCents >= 0;
  const daycareCard = card(`<div class="hp-split"><span class="eyebrow">Daycare (MDO)</span>${dcGood ? chip('Self-sufficient', 'good') : chip('Not covering itself', 'warn')}</div>
    ${daycareBody}<p class="hp-notebox">Report only — the board receives, does not manage.</p>`, { accent: dcGood ? '#2F7D5B' : '#B4412F' });
  const p = h.property;
  const propertyBody = p
    ? `<div class="eyebrow">Distributable right now</div>
      <div class="hp-engine-val">${p.distributableCents != null ? money(p.distributableCents) : '—'}</div>
      <p class="hp-sub">${p.distributableCents != null ? `Cash minus reserves · AHRA, ${e(p.distributablePeriod)}` : 'No AHRA report recorded yet'}</p>
      <div class="hp-stack">${bar('Reserves on-hand', money(p.reservesOnHandCents), 100, '#2E7EA6')}<p class="hp-note">Occupancy ${p.occupancyPct != null ? `${p.occupancyPct}%` : '—'}, trailing 12 months.</p></div>`
    : '<p class="status status-pending">The Ivanhoe figures could not be read for this request — not a zero.</p>';
  const propertyCard = card(`<div class="hp-split"><span class="eyebrow">3277 Ivanhoe</span>${chip('Funds itself', 'info')}</div>${propertyBody}
    <p class="hp-notebox">One decision: <b>whether and when to take a distribution.</b></p>`, { accent: '#2E7EA6' });
  return `<div class="section-heading trend-heading"><div><div class="eyebrow">Entities</div><h2>The three engines</h2></div></div>
    <p class="lede">What the board decides for each one is different — the label on each card says so.</p>
    <div class="hp-grid-3">${churchCard}${daycareCard}${propertyCard}</div>`;
}

// ── F. General Fund giving, cumulative, against a straight-line budget.
function paceEndLabels(actualY, budgetY) {
  let aY = actualY + 4;
  if (budgetY == null) return `<text x="574" y="${aY.toFixed(1)}" fill="#2E7EA6">Actual</text>`;
  let bY = budgetY - 10;
  const gap = Math.abs(aY - bY);
  if (gap < 13) {
    const push = (13 - gap) / 2;
    if (actualY <= budgetY) { aY -= push; bY += push; } else { aY += push; bY -= push; }
  }
  return `<text x="574" y="${aY.toFixed(1)}" fill="#2E7EA6">Actual</text><text x="574" y="${bY.toFixed(1)}" fill="#8A611C">Budget</text>`;
}
function noBudgetNote(pace, scoped) {
  if (!scoped) return 'No donor-revenue budget is set for this year, so there is no pace line to compare against.';
  if (!pace.budgetCode) return 'No pace line: the General Fund has no leading account code to look up a budget by. Set one under <b>Data &amp; Imports → Classification &amp; policy</b> (General Fund budget account code).';
  return `No pace line: no budget is on file this year for church ledger accounts starting <b>${e(pace.budgetCode)}</b>${pace.budgetCodePinned ? ' (pinned under Classification &amp; policy).' : '.'} If the budget is uploaded under a different code, pin that code under <b>Data &amp; Imports → Classification &amp; policy</b>.`;
}
function renderGivingPace(h) {
  const pace = h.givingPace;
  const scoped = pace.scope === 'general_fund';
  const budget = pace.budgetCents != null ? pace.budgetCents : 0;
  const through = pace.throughMonth;
  const byMonth = new Map(pace.monthly.map((m) => [m.month, m.cents]));
  const cum = [];
  let run = 0;
  for (let m = 1; m <= through; m++) { run += byMonth.get(m) || 0; cum.push(run); }
  const title = scoped ? 'General Fund giving against budget pace' : 'Giving against budget pace';
  const max = Math.max(...cum, budget || 1);
  const x0 = 46, x1 = 557, yTop = 26, yBot = 176;
  const px = (i) => (cum.length > 1 ? x0 + (x1 - x0) * (i / (cum.length - 1)) : x0);
  const py = (c) => yBot - (c / max) * (yBot - yTop);
  const actualPts = cum.map((c, i) => `${px(i).toFixed(1)},${py(c).toFixed(1)}`).join(' ');
  const budgetPts = cum.map((_, i) => `${px(i).toFixed(1)},${py(budget * (i + 1) / 12).toFixed(1)}`).join(' ');
  const behind = budget ? (budget * through / 12) - cum[cum.length - 1] : 0;
  const what = scoped ? 'General Fund offerings' : 'All offerings';
  let sub = budget
    ? `${what} to date vs. the straight-line budget line. ${behind > 0 ? `Running ${money(behind)} behind.` : `Running ${money(-behind)} ahead.`}`
    : `${what} to date. ${noBudgetNote(pace, scoped)}`;
  if (budget && pace.budgetAccounts.length) sub += ` Budget from ${pace.budgetAccounts.slice(0, 3).map(e).join(', ')}${pace.budgetAccounts.length > 3 ? ` and ${pace.budgetAccounts.length - 3} more` : ''}.`;
  if (scoped && pace.excludedCents) sub += ` ${money(pace.excludedCents)} given to designated and pass-through funds is not counted here.`;
  else if (!scoped) sub += ' Every fund is counted — no fund is categorized as the General Fund yet (Connect Settings → Fund categories).';
  const svg = `<svg viewBox="0 0 640 220" width="100%" role="img" aria-label="Cumulative giving versus budget pace, ${behind > 0 ? `running behind by ${money(behind)}` : 'running at or ahead of pace'}">
    <g stroke="#EEF0F4" stroke-width="1">${[44, 88, 132, 176].map((y) => `<line x1="${x0}" y1="${y}" x2="628" y2="${y}"></line>`).join('')}</g>
    <g font-size="10" fill="#8A611C">${[0, 1, 2, 3].map((i) => `<text x="8" y="${48 + i * 44}">${money(max * (1 - i / 3.4))}</text>`).join('')}</g>
    <polygon points="${actualPts} ${px(cum.length - 1).toFixed(1)},${yBot} ${x0},${yBot}" fill="#DCEBF3"></polygon>
    ${budget ? `<polyline points="${budgetPts}" fill="none" stroke="#C9973A" stroke-width="2.5" stroke-dasharray="6 5"></polyline>` : ''}
    <polyline points="${actualPts}" fill="none" stroke="#2E7EA6" stroke-width="3"></polyline>
    <circle cx="${px(cum.length - 1).toFixed(1)}" cy="${py(cum[cum.length - 1]).toFixed(1)}" r="4.5" fill="#2E7EA6"></circle>
    <g font-size="10.5" fill="#8A611C" text-anchor="middle">${cum.map((_, i) => `<text x="${px(i).toFixed(1)}" y="196">${MONTHS[i]}</text>`).join('')}</g>
    <g font-size="11" font-weight="700">${paceEndLabels(py(cum[cum.length - 1]), budget ? py(budget * through / 12) : null)}</g></svg>`;
  return card(`<h2>${e(title)}</h2><p class="hp-sub">${sub}</p>${svg}`);
}

// ── G. Months of operating cash against the congregation's own policy floor.
function cashSourceNote(r) {
  if (r.cashSource === 'balance_sheet') return ` · cash from ${e(r.accountName || 'the balance sheet')}${r.asOfDate && !/^FY/.test(r.asOfDate) ? ` as of ${e(r.asOfDate)}` : ''}`;
  if (r.cashSource === 'quickbooks') return ' · cash from QuickBooks checking/savings';
  if (r.cashSource === 'manual') return ' · cash entered by hand';
  return '';
}
export function renderCashRunwayCard(runway) {
  if (!runway) return card('<h2>Operating cash runway</h2><p class="status status-pending">Operating cash runway could not be read for this request. Nothing shown here is a real $0.</p>');
  // The synthetic staging fixture carries no policy floor, so it keeps its plain coverage cards.
  if (runway.policyFloorMonths == null) {
    return `<div class="grid"><div class="card"><small>Operating cash</small><strong>${money(runway.operatingCashCents)}</strong><span>${e(runway.accountName)} · synthetic fixture</span></div><div class="card"><small>Average monthly expense</small><strong>${money(runway.monthlyExpenseCents)}</strong><span>FY${runway.fiscalYear} annualized expense ${money(runway.annualExpenseCents)} · synthetic fixture</span></div><div class="card"><small>Expense coverage</small><strong>${runway.runwayMonths.toFixed(1)} months</strong><span>Cash divided by average monthly expense · read-only</span></div></div>`;
  }
  const months = runway.runwayMonths;
  const below = months < runway.policyFloorMonths;
  const fill = Math.min(100, months / 12 * 100);
  const marker = Math.min(100, runway.policyFloorMonths / 12 * 100);
  const color = below ? '#B4412F' : '#2F7D5B';
  return card(`<h2>Operating cash runway</h2>
    <p class="hp-sub">${money(runway.operatingCashCents)} on hand · ${money(runway.monthlyExpenseCents)} average month of <b>church operations</b>${cashSourceNote(runway)}${runway.daycareExcludedCents ? ` · ${money(runway.daycareExcludedCents)} of daycare expense left out (it stops when the tuition does)` : ''}</p>
    <div class="hp-engine-val" style="color:${color}">${months.toFixed(1)} <small>months</small></div>
    <div class="hp-runway"><span style="width:${fill.toFixed(1)}%;background:${color}"></span><i style="left:${marker.toFixed(1)}%"></i></div>
    <div class="hp-runway-scale"><span>0</span><b>${runway.policyFloorMonths}-month policy floor</b><span>12</span></div>
    <p class="hp-notebox">${runway.gapToFloorCents > 0
      ? `Reaching the ${runway.policyFloorMonths}-month floor takes <b>${money(runway.gapToFloorCents)}</b> more in reserves — the second half of any appeal target.`
      : `Reserves are above the ${runway.policyFloorMonths}-month floor, by ${money(runway.operatingCashCents - runway.floorCents)}.`}</p>`);
}

// The legacy card's own copy when the runway cannot be computed yet (no cash figure or no church
// expense actuals), as distinct from a runway that could not be read at all.
export function renderCashRunwayNotYetAvailable() {
  return card('<h2>Operating cash runway</h2><p class="hp-sub">Not yet available — this needs a cash-on-hand figure and at least some <b>church</b> expense actuals for the year (daycare expenses are excluded from the burn rate). Cash comes from the imported balance sheet\'s operating account (name the account code under <b>Classification &amp; policy</b>), or from a QuickBooks sync, or typed by hand.</p>');
}

// ── H. Five years of the mix, stacked by stream. The story is the mix, not the total.
function renderFiveYearMix(h) {
  const years = h.fiveYearMix;
  if (!years || years.length < 2) return '';
  const max = Math.max(...years.map((y) => y.totalCents), 1);
  const base = 164, plotH = 134, left = 74, barW = 64;
  const slot = (562 - left) / Math.max(1, years.length);
  const bars = years.map((t, i) => {
    const x = left + slot * i + (slot - barW) / 2;
    let y = base, out = '';
    for (const s of DISPLAY_STREAMS) {
      const hgt = t[`${s}Cents`] / max * plotH;
      if (hgt <= 0) continue;
      y -= hgt;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${hgt.toFixed(1)}" rx="2" fill="${STREAM_COLORS[s]}"></rect>`;
    }
    return `${out}<text x="${(x + barW / 2).toFixed(1)}" y="180" font-size="10.5" fill="#8A611C" text-anchor="middle">${t.year}</text>`;
  }).join('');
  const first = years[0], last = years[years.length - 1];
  const donorDelta = last.donorCents - first.donorCents;
  const earnedDelta = last.earnedCents - first.earnedCents;
  const story = Math.abs(donorDelta) < Math.abs(earnedDelta)
    ? `Donor revenue roughly flat while earned income moved ${formatResultCents(earnedDelta)}. The mix, not the total, is the story.`
    : `Donor revenue moved ${formatResultCents(donorDelta)} and earned income ${formatResultCents(earnedDelta)} across the window.`;
  return card(`<h2>Five years of the mix</h2><p class="hp-sub">${story}</p>
    <svg viewBox="0 0 620 210" width="100%" role="img" aria-label="${e(`Stacked revenue mix by year, ${first.year} to ${last.year}. ${story}`)}">
      <g stroke="#EEF0F4" stroke-width="1">${[0, 1, 2, 3].map((i) => `<line x1="52" y1="${(base - plotH * i / 3).toFixed(1)}" x2="612" y2="${(base - plotH * i / 3).toFixed(1)}"></line>`).join('')}</g>
      <g font-size="10" fill="#8A611C">${[0, 1, 2, 3].map((i) => `<text x="6" y="${(base - plotH * i / 3 + 4).toFixed(1)}">${money(max * i / 3)}</text>`).join('')}</g>
      ${bars}
      <g font-size="10.5" font-weight="700"><text x="52" y="202" fill="${STREAM_COLORS.donor}">■ Donor</text><text x="132" y="202" fill="${STREAM_COLORS.earned}">■ Earned</text><text x="216" y="202" fill="${STREAM_COLORS.passive}">■ Passive</text></g>
    </svg>`);
}

// ── I. What the picture points to.
function renderFundraisingCallout(h) {
  const t = h.targets;
  const row = (label, value, color) => `<div class="hp-navy-row"><span>${label}</span><b style="color:${color}">${value}</b></div>`;
  return `<div class="hp-navy">
    <div><div class="hp-navy-label">What this points to</div><div class="hp-navy-title">Donor revenue has to grow, because it’s the only stream we can grow.</div></div>
    <div>${row('Close the operating gap', t.gapCents ? money(t.gapCents) : 'none', t.gapCents ? '#F2A99B' : '#A9D8BE')}
      ${row('Reserves to the policy floor', t.reserveGapCents ? money(t.reserveGapCents) : 'at floor', t.reserveGapCents ? '#EBD3A4' : '#A9D8BE')}
      ${row('Room to serve waiting families', h.waitingFamilies ? `${h.waitingFamilies} waiting` : 'needs the daycare API', '#A9D8BE')}</div>
    <a class="hp-navy-link" href="/?section=giving-analytics">Build a fundraising plan →</a>
  </div>`;
}

// ── J. What an appeal would have to look like, read against the real annual giving bands.
const LADDER_COLORS = ['#1B2A4A', '#2E7EA6', '#C9973A', '#2F7D5B'];
function renderAppeal(h, state) {
  const scope = state.appeal;
  const t = h.targets;
  const ladder = scope === 'gap' ? h.appeal.gap : h.appeal.gapReserves;
  const pills = `<div class="segmented segmented-card" aria-label="Appeal target">${[['gapReserves', 'Gap + reserves'], ['gap', 'Gap only']].map(([id, text]) => (id === scope
    ? `<span class="is-on" aria-current="true">${text}</span>`
    : `<a href="${healthHref({ ...state, appeal: id }, 'hp-appeal')}">${text}</a>`)).join('')}</div>`;
  if (!ladder.targetCents) {
    return card(`<div class="hp-split"><div><h2>What an appeal would have to look like</h2><p class="hp-sub">Nothing to close right now — the year is projected to end in surplus and reserves are at or above the policy floor.</p></div>${pills}</div>`, { id: 'hp-appeal' });
  }
  const maxHh = ladder.tiers.reduce((m, x) => Math.max(m, x.households), 1);
  const rows = ladder.tiers.map((tier, i) => `<div class="hp-ladder-row"><span class="hp-ask">${money(tier.askCents)}</span>
    <span class="hp-ladder-bar"><span style="width:${(tier.households / maxHh * 88).toFixed(1)}%;background:${LADDER_COLORS[i % LADDER_COLORS.length]}"></span><em>${tier.households} household${tier.households === 1 ? '' : 's'}</em></span>
    <span class="num">${money(tier.raisesCents)}</span></div>`).join('');
  const hh = h.giving.givingHouseholds;
  const share = hh ? Math.round(ladder.totalHouseholds / hh * 100) : null;
  const bands = h.giving.donorBands;
  const maxBand = bands.reduce((m, b) => Math.max(m, b.households), 1);
  const bandHtml = bands.map((b, i) => bar(e(b.label), `${b.households} hh`, b.households / maxBand * 100, LADDER_COLORS[i % 3])).join('');
  const sub = scope === 'gap'
    ? `Target <b>${money(ladder.totalCents)}</b> — the projected operating gap alone.`
    : `Target <b>${money(ladder.totalCents)}</b> — close the ${money(t.gapCents)} operating gap <i>and</i> rebuild reserves to the policy floor.`;
  return card(`<div class="hp-split"><div><h2>What an appeal would have to look like</h2><p class="hp-sub">${sub}${hh ? ` ${hh} giving households.` : ''}</p></div>${pills}</div>
    <div class="hp-appeal-grid">
      <div class="hp-ladder">
        <div class="hp-ladder-row hp-ladder-head"><span>Ask level</span><span>Households needed</span><span class="num">Raises</span></div>
        ${rows}
        <div class="hp-ladder-row hp-ladder-total"><b>${ladder.totalHouseholds} households</b><span>${share != null ? `${share}% of everyone who gave this year` : 'no giving records to compare against'}</span><b class="num">${money(ladder.totalCents)}</b></div>
      </div>
      <div class="hp-bands">
        <div class="eyebrow">Read against real giving bands</div>
        ${bands[0] ? `<p class="hp-sub">${bands[0].households} households already give above $2,000 a year — the top tier asks ${ladder.tiers[0].households} of them for one extra gift, not a new habit.</p>` : ''}
        <div class="hp-stack">${bandHtml}</div>
        <a class="hp-link" href="/?section=giving-analytics&amp;page=household-bands">Open giving bands →</a>
      </div>
    </div>`, { id: 'hp-appeal' });
}

// ── K. The three levers, in the order a council would pull them.
function renderLevers(h, state) {
  const t = h.targets;
  const target = state.appeal === 'gap' ? t.gapCents : t.gapCents + t.reserveGapCents;
  const residual = state.appeal === 'gap' ? h.levers.residualGapCents : h.levers.residualGapReservesCents;
  const over = h.overPace;
  const { cutCents, distributionCents } = h.levers;
  const lever = (eyebrow, headline, body, amount, color) => card(`<div class="eyebrow">${eyebrow}</div><h3 class="hp-lever-head">${headline}</h3><p class="hp-sub">${body}</p><div class="hp-lever-amt" style="color:${color}">${amount}</div>`);
  return `<div class="hp-grid-3">
    ${lever('Lever 1 · Cut', over.length ? `Trim the ${over.length === 1 ? 'one over-pace category' : `${over.length} over-pace categories`}` : 'Nothing is running over pace',
    over.length
      ? `${over.slice(0, 2).map((x) => e(x.label)).join(' and ')} ${over.length > 1 ? 'are' : 'is'} ${money(cutCents)} ahead of the calendar. Holding to budget recovers that much.`
      : 'Every expense category with a budget is at or under the calendar. There is nothing here to cut back toward plan.',
    cutCents ? `−${money(cutCents)}` : '$0', '#8A611C')}
    ${lever('Lever 2 · Distribute', 'Take an Ivanhoe distribution',
    distributionCents ? `${money(distributionCents)} is distributable today without dipping into reserves or deferring capital work.` : 'No AHRA distribution figure has been recorded yet, so there is nothing to draw on with confidence.',
    distributionCents ? `−${money(distributionCents)}` : '—', '#2E7EA6')}
    ${lever('Lever 3 · Ask', residual > 0 ? 'An appeal for the rest' : 'An appeal is not needed to close the gap',
    residual > 0
      ? `After the two levers above, ${money(residual)} of the ${money(target)} target is left for an appeal to carry.`
      : 'The two levers above cover the whole target. An appeal’s real job would be reserves and the space MDO needs, not the operating gap.',
    money(residual), '#2F7D5B')}
  </div>`;
}

// ── L. So what do we decide? Three decisions, each stated with this year's own figures.
function renderDecisions(h) {
  const t = h.targets;
  const target = t.gapCents + t.reserveGapCents;
  const over = h.overPace;
  const p = h.property;
  const decision = (eyebrow, color, headline, body, href, linkText) => `<div class="decision"><small style="color:${color}">${eyebrow}</small><b>${headline}</b><span>${body}</span><a class="hp-link" href="${href}">${linkText}</a></div>`;
  const ivanhoe = !p
    ? decision('Ivanhoe distribution', '#2F7D5B', 'The Ivanhoe figures could not be read for this request.', 'Nothing here is a real $0.', '/?section=property', 'Open Commercial Property →')
    : decision('Ivanhoe distribution', '#2F7D5B',
      p.distributableCents != null ? `${money(p.distributableCents)} is distributable without touching reserves.` : 'No current distribution figure on record.',
      p.distributableCents != null
        ? `We have taken ${money(p.distributedThisYear.cents)} so far in ${p.distributedThisYear.year}${t.gapCents && p.distributableCents - p.distributedThisYear.cents >= t.gapCents ? ` — another ${money(t.gapCents)} would cover the operating gap outright.` : '.'}`
        : 'Record the latest AHRA monthly report to see what is available.',
      '/?section=property', 'Open Commercial Property →');
  return card(`<h2>So what do we decide?</h2><p class="hp-sub">Three decisions this picture puts in front of the council this month.</p>
    <div class="decision-grid">
      ${decision('Fundraising', '#2E7EA6',
    target ? `Size an appeal at ${money(t.gapCents)} — or ${money(target)} with reserves.` : 'No appeal is needed to balance the year.',
    target ? 'Closes the projected operating gap and rebuilds reserves to the policy floor.' : 'The year is projected to end in surplus with reserves at or above the floor.',
    '/?section=giving-analytics', 'Open giving →')}
      ${decision('Mid-year adjustment', '#8A611C',
    over.length ? (over.length === 1 ? 'One category is running ahead of the calendar.' : `${over.length} categories are running ahead of the calendar.`) : 'Spending is tracking the calendar.',
    over.length ? over.slice(0, 3).map((x) => `${e(x.label)} <b>${formatResultCents(x.overCents)}</b> over pace`).join('<br>') : 'No expense category with a budget is materially ahead of where the calendar says it should be.',
    '/?section=church', 'Open Church Report →')}
      ${ivanhoe}
    </div>`);
}

// The whole legacy page, top to bottom. `runway` is Finance's own cash-runway view (the same
// connect.finance-cash-runway.v1 figures), so the runway card still renders if this contract fails.
export function renderHealthParity(health, { runway, runwayCard, isAdmin = false, appeal = 'gapReserves', flow = 'flow', councilPreview = false } = {}) {
  const state = { appeal: resolveAppealScope(appeal), flow: resolveFlowView(flow), councilPreview };
  if (!health.hasLedger) {
    return `<section class="hp" aria-label="Where the money comes from">${card(`<h2>Financial Health</h2><p>No church ledger data for ${health.fiscalYear} yet. Connect QuickBooks or run an import from <a href="/?section=data">Data &amp; Imports</a>, and this page fills in.</p>`)}</section>`;
  }
  const rs = health.revenueStreams;
  const unmapped = rs.unmapped.length && isAdmin
    ? `<p class="notice">${rs.unmapped.length} account group${rs.unmapped.length === 1 ? ' was' : 's were'} classified by name and never confirmed (${rs.unmapped.slice(0, 3).map((u) => e(u.label)).join(', ')}${rs.unmapped.length > 3 ? ', …' : ''}). This page is only as honest as that mapping — <a href="/?section=data">review it on Data &amp; Imports</a>.</p>`
    : '';
  return `<section class="hp" aria-label="Where the money comes from">
    <div class="section-heading trend-heading"><div><div class="eyebrow">Where the money comes from</div><h2>FY${health.fiscalYear} run rate · ${money(rs.totalCents)} total revenue · all three entities</h2></div><span class="badge">Live from Connect</span></div>
    ${unmapped}
    ${renderRevenueMix(health)}
    ${renderStreamCards(health)}
    ${renderDesignatedFunds(health)}
    ${renderFlow(health, state)}
    ${renderEngines(health)}
    <div class="hp-grid-2">${renderGivingPace(health)}${runwayCard ?? renderCashRunwayCard(runway)}</div>
    <div class="hp-grid-2">${renderFiveYearMix(health) || card('<h2>Five years of the mix</h2><p class="hp-sub">Needs at least two years of church ledger data.</p>')}${renderFundraisingCallout(health)}</div>
    ${renderAppeal(health, state)}
    ${renderLevers(health, state)}
    ${renderDecisions(health)}
  </section>`;
}

export const HEALTH_PARITY_STYLES = `
    .hp { display:flex; flex-direction:column; gap:14px; }
    .hp > .section-heading { margin-top:28px; }
    .hp-card { display:flex; flex-direction:column; gap:12px; padding:20px 22px; border:1px solid var(--line); border-radius:10px; background:#fff; min-width:0; }
    .hp-card h2 { margin:0; }
    .hp-split { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; }
    .hp-right { text-align:right; }
    .hp-big { font-family:"Outfit",sans-serif; font-size:26px; font-weight:600; color:var(--navy); line-height:1; }
    .hp-sub { margin:4px 0 0; font-size:13px; color:var(--muted); line-height:1.5; }
    .hp-note { margin:0; font-size:12px; color:var(--muted); line-height:1.5; }
    .hp-muted { color:var(--faint); }
    .hp-stream-bar { display:flex; gap:4px; height:46px; }
    .hp-seg { display:flex; flex-direction:column; justify-content:center; padding:0 10px; border-radius:6px; color:#fff; overflow:hidden; white-space:nowrap; }
    .hp-seg-lbl { font-size:12px; font-weight:700; }
    .hp-seg-val { font-size:11.5px; opacity:.9; }
    .hp-band { display:flex; gap:4px; }
    .hp-band div { padding-top:6px; font-size:11.5px; font-weight:700; }
    .hp-grid-3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); gap:14px; align-items:start; }
    .hp-grid-2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr)); gap:14px; align-items:start; }
    .hp-chip { padding:3px 9px; border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap; }
    .hp-chip-info { background:#EAF3F8; color:var(--teal); }
    .hp-chip-warn { background:#FBF1DC; color:var(--gold-ink); }
    .hp-chip-good { background:#E6F2EC; color:var(--green); }
    .hp-chip-bad { background:#FBEFEC; color:var(--red); }
    .hp-stream-val, .hp-engine-val { font-family:"Outfit",sans-serif; font-size:30px; font-weight:500; color:var(--navy); line-height:1.1; }
    .hp-engine-val small { font-size:14px; color:var(--muted); }
    .hp-stack { display:flex; flex-direction:column; gap:7px; }
    .hp-bar-head { display:flex; justify-content:space-between; gap:10px; font-size:12.5px; color:var(--muted); }
    .hp-bar-head b { color:var(--ink); font-weight:600; }
    .hp-track { height:9px; border-radius:6px; background:var(--line-soft); overflow:hidden; }
    .hp-track span { display:block; height:100%; border-radius:6px; }
    .hp-link { font-size:13.5px; font-weight:600; }
    .hp-notebox { margin:0; padding:10px 12px; border-radius:8px; background:#F7F8FA; font-size:12.5px; color:var(--muted); }
    .hp-details summary { cursor:pointer; font-size:12.5px; font-weight:600; color:var(--teal); }
    .hp-tie { margin:0; padding-top:10px; border-top:1px solid var(--line-soft); font-size:12.5px; color:var(--muted); }
    .hp-sankey-wrap { overflow-x:auto; }
    .hp-sankey { min-width:720px; height:auto; }
    .hp-donuts { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr)); gap:14px; }
    .hp-donut-body { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
    .hp-donut-body .legend-list { flex:1; min-width:180px; }
    .hp-runway { position:relative; height:14px; border-radius:8px; background:var(--line-soft); overflow:hidden; }
    .hp-runway span { position:absolute; left:0; top:0; bottom:0; }
    .hp-runway i { position:absolute; top:0; bottom:0; width:2px; background:var(--navy); }
    .hp-runway-scale { display:flex; justify-content:space-between; font-size:11px; color:var(--gold-ink); }
    .hp-runway-scale b { color:var(--navy); }
    .hp-navy { display:flex; flex-direction:column; gap:14px; padding:22px 24px; border-radius:10px; background:var(--navy); color:#fff; }
    .hp-navy-label { font-size:11.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:#EBD3A4; }
    .hp-navy-title { font-family:"Hero","Outfit",sans-serif; font-size:21px; line-height:1.2; margin-top:4px; }
    .hp-navy-row { display:flex; justify-content:space-between; align-items:baseline; gap:10px; padding-top:10px; margin-top:10px; border-top:1px solid rgba(255,255,255,.22); font-size:12.5px; color:rgba(255,255,255,.8); }
    .hp-navy-row b { font-size:17px; font-family:"Outfit",sans-serif; }
    .hp-navy-link { color:#fff; font-weight:600; font-size:13.5px; }
    .hp-navy-link:hover { color:#EBD3A4; }
    .hp-appeal-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:18px; }
    .hp-ladder { display:flex; flex-direction:column; gap:10px; }
    .hp-ladder-row { display:grid; grid-template-columns:5rem 1fr 6rem; align-items:center; gap:10px; font-size:13px; }
    .hp-ladder-row .num { text-align:right; font-variant-numeric:tabular-nums; }
    .hp-ladder-head { font-size:11.5px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
    .hp-ladder-total { padding-top:10px; border-top:1px solid var(--line); color:var(--navy); }
    .hp-ladder-total span { color:var(--muted); font-size:12.5px; }
    .hp-ask { font-weight:700; }
    .hp-ladder-bar { display:flex; align-items:center; gap:9px; }
    .hp-ladder-bar span { height:11px; border-radius:6px; }
    .hp-ladder-bar em { font-style:normal; font-size:12.5px; color:var(--muted); white-space:nowrap; }
    .hp-bands { display:flex; flex-direction:column; gap:10px; padding:16px 18px; border-radius:10px; background:#F7F8FA; }
    .hp-lever-head { margin:0; font-size:15.5px; }
    .hp-lever-amt { font-family:"Outfit",sans-serif; font-size:22px; font-weight:600; }
    .hp .decision a { display:inline-block; margin-top:10px; }
`;
