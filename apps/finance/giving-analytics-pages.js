// Giving, v3 design: Trends, Year over year, Household bands, Pledges, Giving what-if, Giving
// statements and Giving nudges. Every figure comes live from Connect (giving-analytics-v1 for
// totals, giving-analytics-people-v1 for the named pages); Finance keeps no copy. The totals pages
// name nobody, so council may read them. Statements and nudges name households, so Connect only
// returns them for Giving view access, and council preview here shows the same refusal.
import { escapeHtml as e } from './render-helpers.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CONNECT_GIVING = 'https://connect.timothystl.org/';
const LETTER_LABELS = { year_end: 'Year-end statement', midyear: 'Mid-year update', quarterly: 'Quarterly statement' };
export const WHAT_IF_FIELDS = Object.freeze(['households', 'average', 'retention', 'new_households']);

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function money(cents) {
  return USD.format(Math.round((Number(cents) || 0) / 100));
}

function compact(cents) {
  const dollars = (Number(cents) || 0) / 100;
  if (Math.abs(dollars) >= 1e6) return `$${(dollars / 1e6).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1e3) return `$${(dollars / 1e3).toFixed(Math.abs(dollars) >= 1e4 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

function signedMoney(cents) {
  return `${cents < 0 ? '−' : '+'}${money(Math.abs(cents))}`;
}

function pct(value, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

function change(now, before) {
  return before ? (now - before) / before : null;
}

function shortDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y ? `${MONTHS[m - 1]} ${d}` : '—';
}

function href(page, params = {}, section = 'giving-analytics') {
  const search = new URLSearchParams({ section, page, ...params });
  if (search.get('fund') === 'all') search.delete('fund');
  return `/?${search.toString().replace(/&/g, '&amp;')}`;
}

// ── Fund scope ────────────────────────────────────────────────────────────────────────────────
// Connect answers every totals page for one slice of giving: all funds, the General Fund family,
// or one fund. The choice rides on ?fund= so it survives moving between pages.

function fundOf(data) {
  return data?.fund || { key: 'all', label: 'All funds', fund_count: 0 };
}

function fundKey(data) {
  return fundOf(data).key;
}

function scopeSentence(data) {
  const f = fundOf(data);
  if (f.key === 'all') return 'Every gift entered in Connect counts, including loose plate cash.';
  if (f.key === 'general') return `General Fund gifts only (${f.fund_count} fund${f.fund_count === 1 ? '' : 's'} Connect counts as the General Fund), including loose plate cash given there.`;
  return `Gifts to ${f.label} only.`;
}

// A short "which funds" clause for pages about households, where plate cash never appears.
function scopeShort(data) {
  const f = fundOf(data);
  if (f.key === 'all') return '';
  return f.key === 'general' ? 'General Fund gifts only. ' : `Gifts to ${f.label} only. `;
}

// All funds and General Fund are one click; a specific fund is picked from the funds given to in
// the years compared. A plain GET form, because Finance's CSP allows no script.
export function fundPicker(data, { section = 'giving-analytics', page, hidden = {} } = {}) {
  const current = fundKey(data);
  const options = data?.fund_options || [];
  const specific = options.filter((o) => o.key !== 'all' && o.key !== 'general');
  const tab = (key, label) => `<a href="${href(page, { ...hidden, fund: key }, section)}"${current === key ? ' class="is-on" aria-current="true"' : ''}>${e(label)}</a>`;
  const isSpecific = current !== 'all' && current !== 'general';
  return `<div class="ga-fund" role="group" aria-label="Which giving to show">
      <span class="ga-fund-label">Showing</span>
      <div class="ga-fund-tabs">${tab('all', 'All funds')}${tab('general', 'General Fund')}</div>
      ${specific.length ? `<form method="GET" action="/" class="ga-fund-form${isSpecific ? ' is-on' : ''}">
        <input type="hidden" name="section" value="${e(section)}"><input type="hidden" name="page" value="${e(page)}">
        ${Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('')}
        <label><span class="sr-only">Specific fund</span><select name="fund">
          <option value=""${isSpecific ? '' : ' selected'} disabled>Specific fund…</option>
          ${specific.map((o) => `<option value="${e(o.key)}"${o.key === current ? ' selected' : ''}>${e(o.label)}</option>`).join('')}
        </select></label>
        <button type="submit" class="button-outline">Show</button>
      </form>` : ''}
    </div>`;
}

function kpis(items) {
  return `<div class="grid">${items.map(([label, value, note, tone]) => `<div class="card"><small>${e(label)}</small><strong>${value}</strong>${note ? `<span class="${tone ? `tone-${tone}` : ''}">${note}</span>` : ''}</div>`).join('')}</div>`;
}

function unavailable(what, message) {
  return `<p class="status status-error">${e(what)} could not be read from Connect: ${e(message)} Nothing here is a real $0.</p>`;
}

function statusBanner(status) {
  return status ? `<p class="status${status.ok ? '' : ' status-error'}">${e(status.message)}</p>` : '';
}

function asOfLine(data) {
  const [, m, d] = data.as_of.split('-').map(Number);
  return `Calendar ${data.year} through ${MONTH_NAMES[m - 1]} ${d}. ${scopeSentence(data)}`;
}

function changeNote(now, before, label) {
  const c = change(now, before);
  if (c === null) return { text: `No gifts in ${label} to compare`, tone: '' };
  return { text: `${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(1)}% vs. ${label}`, tone: c >= 0 ? 'good' : 'warn' };
}

// ── Trends ────────────────────────────────────────────────────────────────────────────────────

export function renderTrendsPage({ result, keep = {} }) {
  if (!result.ok) return unavailable('Giving trends', result.message);
  const a = result.data;
  const t = a.totals;
  const monthLabel = MONTH_NAMES[Number(a.as_of.slice(5, 7)) - 1];
  const ytd = changeNote(t.ytd_cents, t.prior_ytd_cents, `${a.year - 1} to date`);
  const mtd = changeNote(t.mtd_cents, t.prior_mtd_cents, `${monthLabel} ${a.year - 1}`);
  const share = t.ytd_cents ? t.ytd_online_cents / t.ytd_cents : 0;
  const priorShare = t.prior_ytd_cents ? t.prior_ytd_online_cents / t.prior_ytd_cents : null;
  const top = kpis([
    ['Giving year to date', money(t.ytd_cents), ytd.text, ytd.tone],
    [`${monthLabel} so far`, money(t.mtd_cents), mtd.text, mtd.tone],
    ['Giving households', String(a.households.ytd_households), `${t.first_time_givers} first-time giver${t.first_time_givers === 1 ? '' : 's'} this year`],
    ['Online share', pct(share), priorShare === null ? 'Online, card and bank transfer' : `${share >= priorShare ? 'Up' : 'Down'} from ${pct(priorShare)} last year`, priorShare !== null && share >= priorShare ? 'good' : ''],
  ]);
  const max = Math.max(1, ...a.weeks.map((w) => w.cents));
  const avg = a.weeks.reduce((s, w) => s + w.cents, 0) / (a.weeks.length || 1);
  const weekBars = `<div class="ga-weeks" aria-label="Giving by week, last 13 weeks">
      <div class="ga-avg" style="bottom:${(avg / max * 100).toFixed(1)}%"></div>
      ${a.weeks.map((w) => `<div class="ga-week${w.cents >= avg ? ' is-high' : ''}" style="height:${Math.max(1, w.cents / max * 100).toFixed(1)}%" title="Week ending ${e(shortDate(w.week_ending))}: ${money(w.cents)}"><span class="sr-only">Week ending ${e(shortDate(w.week_ending))}: ${money(w.cents)}</span></div>`).join('')}
    </div>
    <div class="ga-axis"><span>${e(shortDate(a.weeks[0]?.week_ending))}</span><span>Line: 13-week average, ${money(avg)} a week</span><span>${e(shortDate(a.weeks.at(-1)?.week_ending))}</span></div>`;
  const fundMax = Math.max(1, ...a.funds.map((f) => f.cents));
  const current = fundKey(a);
  const fundName = (f) => (f.fund_id === undefined ? e(f.fund_name)
    : `<a href="${href('trends', { ...keep, fund: String(f.fund_id) })}"${String(f.fund_id) === current ? ' aria-current="true" class="is-on"' : ''}>${e(f.fund_name)}</a>`);
  const funds = a.funds.length
    ? `<ul class="ga-meters">${a.funds.slice(0, 8).map((f) => `<li><span>${fundName(f)}</span><span class="ga-meter"><span style="width:${Math.max(1, f.cents / fundMax * 100).toFixed(1)}%"></span></span><b>${compact(f.cents)}</b></li>`).join('')}</ul>`
    : '<div class="empty-note">No gifts recorded this year.</div>';
  return `${fundPicker(a, { page: 'trends', hidden: keep })}
    <p class="lede">${e(asOfLine(a))}</p>
    ${top}
    <div class="ga-two">
      <div class="panel"><h2>${e(fundOf(a).label)}, last 13 weeks</h2><p class="muted-line">Each bar is a week ending on Sunday.</p>${weekBars}</div>
      <div class="panel"><h2>By fund, year to date</h2><p class="muted-line">Every fund, whichever is shown above. Choose a fund to see it alone.</p>${funds}</div>
    </div>`;
}

// ── Year over year ────────────────────────────────────────────────────────────────────────────

export function renderYearOverYearPage({ result, keep = {} }) {
  if (!result.ok) return unavailable('Year-over-year giving', result.message);
  const a = result.data;
  const t = a.totals;
  const h = a.households;
  const byMonth = new Map(a.months.map((m) => [m.month, m.cents]));
  const throughMonth = Number(a.as_of.slice(5, 7));
  const rows = [];
  for (let m = 1; m <= throughMonth; m += 1) {
    const key = String(m).padStart(2, '0');
    rows.push({ label: MONTHS[m - 1], now: byMonth.get(`${a.year}-${key}`) || 0, before: byMonth.get(`${a.year - 1}-${key}`) || 0, partial: m === throughMonth });
  }
  const complete = rows.filter((r) => !r.partial);
  const best = complete.reduce((b, r) => (r.now > (b?.now ?? -1) ? r : b), null);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.now, r.before)));
  const ytd = changeNote(t.ytd_cents, t.prior_ytd_cents, String(a.year - 1));
  const retention = h.last_year_households ? h.both_years_households / h.last_year_households : null;
  const top = kpis([
    [`${a.year} to date`, money(t.ytd_cents), ytd.text, ytd.tone],
    [`Same period ${a.year - 1}`, money(t.prior_ytd_cents), `Through ${shortDate(`${a.year - 1}${a.as_of.slice(4)}`)}, ${a.year - 1}`],
    ['Households giving both years', String(h.both_years_households), retention === null ? 'No gifts last year to compare' : `${pct(retention)} of ${h.last_year_households} households from ${a.year - 1} have given again`],
  ]);
  const chart = `<div class="ga-months">${rows.map((r) => `<div class="ga-month"><div class="ga-pair">
      <div class="ga-bar is-prior" style="height:${Math.max(1, r.before / max * 100).toFixed(1)}%" title="${r.label} ${a.year - 1}: ${money(r.before)}"></div>
      <div class="ga-bar${best && r === best ? ' is-best' : ''}${r.partial ? ' is-partial' : ''}" style="height:${Math.max(1, r.now / max * 100).toFixed(1)}%" title="${r.label} ${a.year}: ${money(r.now)}"></div>
    </div><span>${r.label}</span><small>${compact(r.now)}</small></div>`).join('')}</div>
    <p class="ga-legend"><span class="key is-prior"></span>${a.year - 1} <span class="key"></span>${a.year} <span class="key is-best"></span>Best full month${rows.at(-1)?.partial ? ` · ${rows.at(-1).label} is month to date` : ''}</p>`;
  const full = rows.filter((r) => !r.partial);
  const sumNow = full.reduce((s, r) => s + r.now, 0);
  const sumBefore = full.reduce((s, r) => s + r.before, 0);
  const line = (label, now, before, { total = false, partial = false } = {}) => {
    const diff = now - before;
    const c = change(now, before);
    const tone = diff >= 0 ? 'tone-good' : 'tone-bad';
    if (partial) return `<tr class="is-partial"><td>${label}</td><td>${money(before)}</td><td>${money(now)}</td><td class="tone-muted">—</td><td class="tone-muted">—</td></tr>`;
    return `<tr${total ? ' class="total-row"' : ''}><td>${label}</td><td>${money(before)}</td><td>${money(now)}</td><td class="${tone}">${signedMoney(diff)}</td><td class="${tone}">${c === null ? '—' : `${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(1)}%`}</td></tr>`;
  };
  const partialRow = rows.find((r) => r.partial);
  const scopeTitle = fundKey(a) === 'all' ? 'Giving' : `${fundOf(a).label} giving`;
  return `${fundPicker(a, { page: 'year-over-year', hidden: keep })}
    <p class="lede">${e(asOfLine(a))}</p>
    ${top}
    <div class="panel panel-spaced"><h2>${e(scopeTitle)} by month, ${a.year - 1} and ${a.year}</h2>${chart}</div>
    <div class="panel panel-spaced list-panel"><h2>Month by month${fundKey(a) === 'all' ? '' : ` · ${e(fundOf(a).label)}`}</h2><div class="table-scroll"><table class="pm-table ga-num"><thead><tr><th>Month</th><th>${a.year - 1}</th><th>${a.year}</th><th>Change</th><th>%</th></tr></thead>
      <tbody>${full.map((r) => line(r.label, r.now, r.before)).join('')}${full.length ? line(full.length === 1 ? full[0].label : `${full[0].label}–${full.at(-1).label}`, sumNow, sumBefore, { total: true }) : ''}${partialRow ? line(`${partialRow.label} (${a.year} to date; all of ${a.year - 1})`, partialRow.now, partialRow.before, { partial: true }) : ''}</tbody></table></div>
      <p class="muted-line">Whole months are compared; the current month is left out of the total because it is not over. The cards above compare the same days of each year.</p></div>`;
}

// ── Household bands ───────────────────────────────────────────────────────────────────────────

export function renderHouseholdBandsPage({ result, keep = {} }) {
  if (!result.ok) return unavailable('Household bands', result.message);
  const a = result.data;
  const h = a.households;
  const total = h.t12_cents || 0;
  const rows = h.bands.map((b) => `<tr><td>${e(b.label)}</td><td>${b.households}</td><td>${h.t12_households ? pct(b.households / h.t12_households) : '—'}</td><td>${money(b.cents)}</td><td>${total ? pct(b.cents / total) : '—'}</td></tr>`).join('');
  const top = h.bands.filter((b) => b.cents > 0);
  const topTwo = [...h.bands].reverse().slice(0, 2);
  const topShare = total ? topTwo.reduce((s, b) => s + b.cents, 0) / total : 0;
  const topHouseholds = topTwo.reduce((s, b) => s + b.households, 0);
  return `${fundPicker(a, { page: 'household-bands', hidden: keep })}
    <p class="lede">Households grouped by what they gave in the last 12 months. ${e(scopeShort(a))}No names are shown on this page. Gifts from organizations and anonymous plate cash are not part of any household.</p>
    ${kpis([
      ['Giving households', String(h.t12_households), 'Gave at least once in the last 12 months'],
      ['Household giving', money(total), h.t12_households ? `${money(total / h.t12_households)} average per household` : ''],
      ['From $5,000-and-up households', total ? pct(topShare) : '—', `${topHouseholds} household${topHouseholds === 1 ? '' : 's'}`],
    ])}
    <div class="panel panel-spaced list-panel"><h2>Household giving bands</h2>${top.length ? `<div class="table-scroll"><table class="pm-table ga-num"><thead><tr><th>Band</th><th>Households</th><th>Share</th><th>Giving</th><th>Share of giving</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td>All households</td><td>${h.t12_households}</td><td>100%</td><td>${money(total)}</td><td>100%</td></tr></tbody></table></div>` : '<div class="empty-note">No household gifts in the last 12 months.</div>'}</div>`;
}

// ── Giving concentration (Charts) ─────────────────────────────────────────────────────────────

export function renderConcentrationPage({ result, keep = {} }) {
  if (!result.ok) return unavailable('Giving concentration', result.message);
  const c = result.data.households.concentration;
  const picker = fundPicker(result.data, { section: 'charts', page: 'concentration', hidden: keep });
  const scope = fundKey(result.data) === 'all' ? '' : ` Showing ${fundOf(result.data).label} only.`;
  if (!c || c.households < 10) {
    return `${picker}<p class="lede">How much of the church’s giving depends on a few households. Totals only.${e(scope)}</p>
      <div class="panel"><h2>Not enough households yet</h2><p class="muted-line">Concentration needs at least ten giving households in the last 12 months.</p></div>`;
  }
  const lastYear = result.data.year - 1;
  const change = c.top_ten_share_last_year === null ? null : c.top_ten_share - c.top_ten_share_last_year;
  const top = c.deciles[0];
  const max = Math.max(...c.deciles.map((d) => d.share), 0.0001);
  const labels = ['Top 10%', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  const bars = `<div class="ga-deciles">${c.deciles.map((d, i) => `<div class="ga-decile"><span class="ga-decile-value">${pct(d.share)}</span><div class="ga-decile-bar${i === 0 ? ' is-top' : ''}" style="height:${Math.max(1, d.share / max * 100).toFixed(1)}%" title="${labels[i]} of households (${d.households}): ${pct(d.share, 1)} of giving"></div><span class="ga-decile-label">${labels[i]}</span></div>`).join('')}</div>`;
  const cumulative = c.deciles.reduce((acc, d) => { acc.push((acc.at(-1) || 0) + d.share); return acc; }, []);
  return `${picker}<p class="lede">How much of the church’s giving depends on a few households, over the last 12 months.${e(scope)} Totals only: no household is named, and gifts from organizations and anonymous plate cash are left out.</p>
    ${kpis([
      ['Top 10 households', `${pct(c.top_ten_share)} of giving`, change === null ? `No ${lastYear} gifts to compare` : `${change <= 0 ? 'Down' : 'Up'} from ${pct(c.top_ten_share_last_year)} in ${lastYear}`, change === null ? '' : change <= 0 ? 'good' : 'warn'],
      ['Households giving $1,000+', String(c.households_1000_plus), `${pct(c.households_1000_plus / c.households)} of ${c.households} giving households`],
      ['Median household gift', money(c.median_cents), 'Last 12 months'],
    ])}
    <div class="panel panel-spaced"><div class="panel-head"><h2>Share of giving by household tenth</h2><span class="muted">Largest givers first · the top ${top.households} households give ${pct(top.share)}</span></div>${bars}</div>
    <div class="panel panel-spaced list-panel"><h2>Cumulative share</h2><div class="table-scroll"><table class="pm-table ga-num"><thead><tr><th>Households, largest first</th><th>Households</th><th>Share of giving</th></tr></thead><tbody>
      ${[0, 1, 4].map((i) => `<tr><td>Top ${(i + 1) * 10}%</td><td>${c.deciles.slice(0, i + 1).reduce((s, d) => s + d.households, 0)}</td><td>${pct(cumulative[i])}</td></tr>`).join('')}
      <tr><td>Bottom half</td><td>${c.deciles.slice(5).reduce((s, d) => s + d.households, 0)}</td><td>${pct(1 - cumulative[4])}</td></tr>
    </tbody></table></div></div>`;
}

// ── Pledges ───────────────────────────────────────────────────────────────────────────────────

export function renderPledgesPage({ result, keep = {} }) {
  if (!result.ok) return unavailable('Pledges', result.message);
  const a = result.data;
  const p = a.pledges;
  const picker = fundPicker(a, { page: 'pledges', hidden: keep });
  if (!p.pledgers) {
    return `${picker}<p class="lede">Pledges are recorded on each person’s Giving record in Connect, one annual amount per year.</p>
      <div class="panel"><h2>No ${a.year} pledges yet</h2><p class="muted-line">When pledges for ${a.year} are entered in Connect, progress against them appears here.</p></div>`;
  }
  const share = p.pledged_cents ? p.received_cents / p.pledged_cents : 0;
  const onTrack = share >= a.year_elapsed * 0.9;
  const rows = [
    ['Fulfilled', p.fulfilled, 'Given the full pledge already', 'good'],
    ['On pace', p.on_pace, 'Within 10% of where the calendar says they would be', 'good'],
    ['Behind', p.behind, 'Giving, but more than 10% behind pace', 'warn'],
    ['Not started', p.not_started, `No gift yet in ${a.year}`, 'warn'],
  ];
  const receivedFrom = fundKey(a) === 'all' ? `${a.year} gifts to any fund` : `${a.year} gifts to ${fundOf(a).label} only`;
  return `${picker}<p class="lede">Pledges are recorded on each person’s Giving record in Connect as one annual amount, not by fund. Received counts each pledger’s ${e(receivedFrom)}, up to their pledge.</p>
    ${kpis([
      [`${a.year} pledges`, money(p.pledged_cents), `${p.pledgers} pledger${p.pledgers === 1 ? '' : 's'}`],
      ['Received toward pledges', money(p.received_cents), `${pct(share)} · ${pct(a.year_elapsed)} of the year gone`, onTrack ? 'good' : 'warn'],
      ['Given by pledgers', money(p.given_cents), p.given_cents > p.received_cents ? `${money(p.given_cents - p.received_cents)} beyond their pledges` : 'All of it counts toward pledges'],
    ])}
    <div class="panel panel-spaced"><h2>Pledge progress</h2>
      <div class="ga-progress"><span style="width:${Math.min(100, share * 100).toFixed(1)}%"></span><i style="left:${(a.year_elapsed * 100).toFixed(1)}%" title="Share of the year gone"></i></div>
      <p class="muted-line">The marker shows how much of the year has gone by.</p>
      <div class="table-scroll"><table class="pm-table ga-num"><thead><tr><th>Status</th><th>Pledgers</th><th>What it means</th></tr></thead>
        <tbody>${rows.map(([label, n, note, tone]) => `<tr><td class="${n ? `tone-${tone}` : ''}">${label}</td><td>${n}</td><td class="ga-note">${e(note)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted-line">Individual pledges, and who is behind, are on the <a href="${href('nudges', { kind: 'pledge_behind' })}">Giving nudges</a> page for people with Giving view access.</p></div>`;
}

// ── Giving what-if ────────────────────────────────────────────────────────────────────────────

export function whatIfBaseline(h) {
  const households = h.t12_households || 0;
  return {
    households,
    average: households ? Math.round(h.t12_cents / households / 100) : 0,
    retention: h.two_years_ago_households ? Math.round(h.retained_households / h.two_years_ago_households * 100) : 90,
    new_households: h.new_last_year_households || 0,
    newRatio: h.last_year_avg_cents ? Math.min(1.5, h.new_last_year_avg_cents / h.last_year_avg_cents) : 0.45,
  };
}

function readAssumption(params, key, fallback, { min, max }) {
  const raw = params?.get(key);
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(String(raw).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function projectWhatIf(base, params) {
  const inputs = {
    households: readAssumption(params, 'households', base.households, { min: 0, max: 100000 }),
    average: readAssumption(params, 'average', base.average, { min: 0, max: 10000000 }),
    retention: readAssumption(params, 'retention', base.retention, { min: 0, max: 100 }),
    new_households: readAssumption(params, 'new_households', base.new_households, { min: 0, max: 100000 }),
  };
  const returning = Math.round(inputs.households * inputs.retention / 100);
  const returningCents = returning * inputs.average * 100;
  const newCents = Math.round(inputs.new_households * inputs.average * base.newRatio) * 100;
  return { inputs, returning, returningCents, newCents, totalCents: returningCents + newCents };
}

export function renderWhatIfPage({ result, params, keep = {} }) {
  if (!result.ok) return unavailable('Giving what-if baselines', result.message);
  const a = result.data;
  const base = whatIfBaseline(a.households);
  const p = projectWhatIf(base, params);
  const nextYear = a.year + 1;
  const vsLast = p.totalCents - a.households.t12_cents;
  const fund = fundKey(a);
  const scope = fund === 'all' ? '' : ` for ${fundOf(a).label}`;
  const field = (key, label, note, suffix = '') => `<label class="ga-assume"><span><b>${label}</b><small>${note}</small></span>
      <span class="ga-input">${suffix === '$' ? '<i>$</i>' : ''}<input type="number" name="${key}" value="${p.inputs[key]}" min="0"${key === 'retention' ? ' max="100"' : ''} step="1" inputmode="numeric">${suffix === '%' ? '<i>%</i>' : ''}</span></label>`;
  return `${fundPicker(a, { page: 'what-if', hidden: keep })}
    <p class="lede">Change the assumptions to see what ${nextYear} household giving${e(scope)} could look like. Nothing here changes the budget; the starting values come from Connect’s giving records. Organizations and anonymous plate cash are left out.</p>
    <div class="ga-two">
      <form method="GET" action="/" class="panel ga-assumptions">
        <input type="hidden" name="section" value="giving-analytics"><input type="hidden" name="page" value="what-if">${fund === 'all' ? '' : `<input type="hidden" name="fund" value="${e(fund)}">`}${keep.council ? '<input type="hidden" name="council" value="1">' : ''}
        <h2>Assumptions for ${nextYear}</h2>
        ${field('households', 'Giving households', `${base.households} gave in the last 12 months`)}
        ${field('average', 'Average annual gift', `${money(base.average * 100)} per household in the last 12 months`, '$')}
        ${field('retention', 'Households who keep giving', `${base.retention}% of ${a.year - 2}’s households gave again in ${a.year - 1}`, '%')}
        ${field('new_households', 'New giving households', `${base.new_households} in ${a.year - 1}; a new household gives about ${pct(base.newRatio)} of the average in its first year`)}
        <div class="form-actions"><button type="submit">Recalculate</button><a class="ga-link-button is-outline" href="${href('what-if', { ...keep, fund })}">Reset to actual</a></div>
      </form>
      <div class="ga-projection">
        <small>Projected ${nextYear} household giving${e(scope)}</small>
        <strong>${money(p.totalCents)}</strong>
        <p>${signedMoney(vsLast)} vs. the last 12 months (${money(a.households.t12_cents)})</p>
        <dl>
          <div><dt>Returning households</dt><dd>${p.returning}</dd></div>
          <div><dt>Giving from returning households</dt><dd>${money(p.returningCents)}</dd></div>
          <div><dt>Giving from new households</dt><dd>${money(p.newCents)}</dd></div>
          <div><dt>Change vs. last 12 months</dt><dd>${a.households.t12_cents ? `${vsLast >= 0 ? '+' : '−'}${Math.abs(vsLast / a.households.t12_cents * 100).toFixed(1)}%` : '—'}</dd></div>
        </dl>
      </div>
    </div>`;
}

// ── Giving statements ─────────────────────────────────────────────────────────────────────────

function namedRefusal(what) {
  return `<div class="panel"><h2>${e(what)} name each household</h2><p class="muted-line">They are available to people with Giving view access. Council access to Giving is totals only, so the Trends, Year over year, Household bands, Pledges and What-if pages are the council’s view of giving.</p></div>`;
}

export function renderStatementsPage({ result, councilPreview }) {
  if (councilPreview) return namedRefusal('Giving statements');
  if (!result.ok) return unavailable('Giving statements', result.message);
  const { statements, year } = result.data;
  const rows = statements.runs.map((r) => `<tr><td>${e(shortDate(r.last_sent))}, ${e(String(r.last_sent).slice(0, 4))}</td><td>${e(LETTER_LABELS[r.letter_type] || r.letter_type)} · ${r.year}</td><td>${r.email + r.print}</td><td>Email ${r.email} · print ${r.print}</td></tr>`).join('');
  return `<p class="lede">Statements list each household’s gifts by fund for the period, with the IRS acknowledgement language. They are prepared and sent from Connect’s Giving tab, which keeps track of who has received one.</p>
    ${kpis([
      [`Households giving in ${year}`, String(statements.giving_households_ytd), 'Each will receive a year-end statement'],
      ['Last statement run', statements.runs[0] ? e(shortDate(statements.runs[0].last_sent)) : '—', statements.runs[0] ? e(`${LETTER_LABELS[statements.runs[0].letter_type] || ''} · ${statements.runs[0].year}`) : 'None recorded yet'],
    ])}
    <div class="panel panel-spaced ga-cta"><div><h2>Prepare statements</h2><p class="muted-line">Choose the year, email the households with an address, and print the rest. Emailing a statement sends a real message.</p></div>
      <a class="ga-link-button" href="${CONNECT_GIVING}?pane=letters#giving">Open statements in Connect</a></div>
    <div class="panel panel-spaced list-panel"><h2>Recent runs</h2>${rows ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Last sent</th><th>Statement</th><th>Households</th><th>Delivery</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-note">No statements have been recorded as sent yet.</div>'}</div>`;
}

// ── Giving nudges ─────────────────────────────────────────────────────────────────────────────

const NUDGE_HINTS = {
  first_time: 'Thank within two weeks of a first gift',
  stopped: 'Gave in four or more months of the prior year; nothing in the last 90 days',
  giving_down: 'The last six months are under half of the six before',
  pledge_behind: 'Received is under three-quarters of where the pledge would be by now',
  stepped_up: 'The last six months are at least half again the six before',
};

export function renderNudgesPage({ result, totals, params, canEdit, councilPreview, status }) {
  if (councilPreview) return namedRefusal('Giving nudges');
  if (!result.ok) return `${statusBanner(status)}${unavailable('Giving nudges', result.message)}`;
  const { nudges, staff } = result.data;
  const kinds = nudges.kinds;
  const requested = params?.get('kind');
  const current = kinds.find((k) => k.key === requested) || kinds.find((k) => k.open_count) || kinds[0];
  const openTotal = kinds.reduce((s, k) => s + k.open_count, 0);
  const firstTime = totals?.ok ? totals.data.totals.first_time_givers : null;
  const staffOptions = (selected) => `<option value="">Unassigned</option>${staff.map((s) => `<option value="${e(s.username)}"${s.username === selected ? ' selected' : ''}>${e(s.name)}</option>`).join('')}`;
  const hidden = (n) => `<input type="hidden" name="kind" value="${e(current.key)}"><input type="hidden" name="subject_key" value="${e(n.subject_key)}"><input type="hidden" name="episode" value="${e(n.episode)}">`;
  const items = current.items.map((n) => {
    const assigned = staff.find((s) => s.username === n.assigned_to)?.name || n.assigned_to;
    const actions = canEdit
      ? `<form method="POST" action="/api/v1/giving-followup-write" class="inline-form">${hidden(n)}<input type="hidden" name="op" value="assign"><select name="assigned_to" aria-label="Who will follow up">${staffOptions(n.assigned_to)}</select><button type="submit" class="button-outline">Assign</button></form>
         <form method="POST" action="/api/v1/giving-followup-write" class="inline-form">${hidden(n)}<input type="hidden" name="op" value="done"><button type="submit" class="button-outline">Mark done</button></form>`
      : (assigned ? `<span class="muted">With ${e(assigned)}</span>` : '');
    const thank = current.key === 'first_time' ? `<a class="ga-link-button" href="${CONNECT_GIVING}?pane=receipts#giving">Thank in Connect</a>` : '';
    return `<li><div><b>${e(n.name)}</b><small>${e(n.detail)}</small></div><div class="ga-amount">${money(n.cents)}</div><div class="right ga-actions">${thank}${actions}</div></li>`;
  }).join('');
  return `${statusBanner(status)}
    <p class="lede">Households worth a personal touch, found from giving patterns. Nothing is sent automatically; each nudge is a prompt for a pastor or staff member.</p>
    ${kpis([
      ['Open nudges', String(openTotal), `Across ${kinds.filter((k) => k.open_count).length} kind${kinds.filter((k) => k.open_count).length === 1 ? '' : 's'}`],
      ['Done this month', String(nudges.done_this_month), 'Thank-yous, calls and notes', nudges.done_this_month ? 'good' : ''],
      [`First-time givers, ${result.data.year}`, firstTime === null ? '—' : String(firstTime), 'Every one thanked within two weeks is the goal'],
    ])}
    <div class="ga-tabs" role="navigation" aria-label="Kinds of nudge">${kinds.map((k) => `<a href="${href('nudges', { kind: k.key })}"${k.key === current.key ? ' class="is-on" aria-current="page"' : ''}><b>${e(k.label)}</b><small>${k.open_count} open</small></a>`).join('')}</div>
    <div class="panel panel-spaced"><div class="panel-head"><div><h2>${e(current.label)}</h2><span class="muted">${e(NUDGE_HINTS[current.key] || '')}</span></div><span class="muted">${current.items.length < current.open_count ? `${current.items.length} of ${current.open_count} open` : `${current.open_count} open`}</span></div>
      ${items ? `<ul class="row-list ga-nudges">${items}</ul>` : '<div class="empty-note">Nothing open here.</div>'}
      ${current.key === 'first_time' ? '<p class="muted-line">A thank-you sent from Connect’s receipt queue marks the gift done here too.</p>' : ''}</div>`;
}

export const GIVING_ANALYTICS_STYLES = `
    .ga-two { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; margin-top:16px; align-items:start; }
    .ga-weeks { position:relative; display:flex; align-items:flex-end; gap:6px; height:170px; margin-top:14px; border-bottom:1px solid #D5DAE3; }
    .ga-week { flex:1; background:#8FA3C2; border-radius:3px 3px 0 0; min-height:2px; }
    .ga-week.is-high { background:var(--navy); }
    .ga-avg { position:absolute; left:0; right:0; border-top:1px dashed #C9962E; pointer-events:none; }
    .ga-axis { display:flex; justify-content:space-between; gap:8px; margin-top:8px; font-size:12px; color:#6B7280; }
    .ga-meters { list-style:none; margin:10px 0 0; padding:0; }
    .ga-meters li { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(60px,1fr) auto; gap:12px; align-items:center; padding:9px 0; border-bottom:1px solid #EEF0F4; font-size:14px; }
    .ga-meter { height:7px; border-radius:4px; background:#EEF0F4; overflow:hidden; }
    .ga-meter span { display:block; height:100%; background:#2E7AA0; border-radius:4px; }
    .ga-months { display:flex; align-items:flex-end; gap:10px; height:220px; margin-top:16px; border-bottom:1px solid #D5DAE3; }
    .ga-month { flex:1; display:flex; flex-direction:column; align-items:center; height:100%; }
    .ga-month > span { font-size:12px; color:#4B5563; margin-top:6px; }
    .ga-month > small { font-size:11px; color:#6B7280; }
    .ga-pair { flex:1; width:100%; display:flex; align-items:flex-end; justify-content:center; gap:3px; }
    .ga-bar { width:min(22px,42%); background:var(--navy); border-radius:3px 3px 0 0; min-height:2px; }
    .ga-bar.is-prior { background:#C3CDDD; }
    .ga-bar.is-best { background:#C9962E; }
    .ga-bar.is-partial { opacity:.55; }
    .ga-months + .ga-legend { margin-top:44px; }
    .ga-legend { font-size:12px; color:#6B7280; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .ga-legend .key { display:inline-block; width:10px; height:10px; border-radius:2px; background:var(--navy); margin-left:8px; }
    .ga-legend .key.is-prior { background:#C3CDDD; margin-left:0; }
    .ga-legend .key.is-best { background:#C9962E; }
    .ga-num td, .ga-num th:not(:first-child) { text-align:right; }
    .ga-num td:first-child, .ga-num td.ga-note { text-align:left; }
    .total-row td { font-weight:700; border-top:2px solid var(--navy); }
    tr.is-partial td { color:#6B7280; }
    .ga-progress { position:relative; height:12px; border-radius:6px; background:#EEF0F4; margin:14px 0 6px; }
    .ga-progress span { display:block; height:100%; border-radius:6px; background:#2E7AA0; }
    .ga-progress i { position:absolute; top:-4px; width:2px; height:20px; background:#C9962E; }
    .ga-assumptions h2 { margin-bottom:6px; }
    .ga-assume { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:12px 0; border-bottom:1px solid #EEF0F4; }
    .ga-assume small { display:block; color:#6B7280; font-size:12px; font-weight:400; }
    .ga-input { display:flex; align-items:center; gap:4px; }
    .ga-input input { width:110px; text-align:right; }
    .ga-input i { font-style:normal; color:#6B7280; }
    .ga-assumptions .form-actions { display:flex; gap:10px; margin-top:14px; }
    .ga-projection { background:var(--navy); color:#fff; border-radius:10px; padding:22px 24px; }
    .ga-projection small { color:#C9D2E2; font-size:13px; }
    .ga-projection strong { display:block; font-size:40px; margin:6px 0; font-family:Outfit, sans-serif; }
    .ga-projection p { color:#C9D2E2; margin:0 0 14px; }
    .ga-projection dl { margin:0; border-top:1px solid rgba(255,255,255,.18); }
    .ga-projection dl div { display:flex; justify-content:space-between; padding:8px 0; }
    .ga-projection dt { color:#DCE3EE; }
    .ga-projection dd { margin:0; font-weight:600; }
    .ga-link-button { display:inline-block; padding:9px 16px; border-radius:8px; background:var(--navy); color:#fff; font-size:14px; font-weight:600; text-decoration:none; white-space:nowrap; }
    .ga-link-button.is-outline { background:#fff; color:var(--navy); border:1px solid var(--navy); }
    .ga-assumptions .form-actions { align-items:center; }
    .ga-assumptions .form-actions button { margin-top:0; }
    .ga-cta { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; flex-direction:row; }
    .ga-tabs { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
    .ga-tabs a { display:flex; flex-direction:column; min-width:150px; padding:10px 14px; border:1px solid #D5DAE3; border-radius:8px; background:#fff; color:var(--navy); text-decoration:none; }
    .ga-tabs a small { color:#6B7280; font-size:12px; }
    .ga-tabs a.is-on { background:var(--navy); color:#fff; border-color:var(--navy); }
    .ga-tabs a.is-on small { color:#C9D2E2; }
    .ga-nudges li { display:grid; grid-template-columns:minmax(0,1.6fr) auto minmax(0,2fr); gap:14px; align-items:center; }
    .ga-amount { font-weight:600; white-space:nowrap; }
    .ga-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
    .ga-deciles { display:flex; align-items:flex-end; gap:12px; height:220px; margin-top:16px; border-bottom:1px solid #D5DAE3; padding-bottom:0; }
    .ga-decile { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; position:relative; }
    .ga-decile-bar { width:min(44px,70%); background:var(--navy); border-radius:3px 3px 0 0; min-height:2px; }
    .ga-decile-bar.is-top { background:#C9962E; }
    .ga-decile-value { font-size:12px; color:#4B5563; margin-bottom:4px; }
    .ga-decile-label { position:absolute; bottom:-22px; font-size:12px; color:#4B5563; white-space:nowrap; }
    .ga-deciles { margin-bottom:30px; }
    .ga-fund { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:0 0 14px; }
    .ga-fund-label { font-size:13px; color:#6B7280; }
    .ga-fund-tabs { display:inline-flex; border:1px solid #D5DAE3; border-radius:8px; overflow:hidden; background:#fff; }
    .ga-fund-tabs a { padding:7px 14px; font-size:14px; color:var(--navy); text-decoration:none; }
    .ga-fund-tabs a + a { border-left:1px solid #D5DAE3; }
    .ga-fund-tabs a.is-on { background:var(--navy); color:#fff; }
    .ga-fund-form { display:inline-flex; align-items:center; gap:6px; margin:0; }
    .ga-fund-form select { max-width:260px; }
    .ga-fund-form.is-on select { border-color:var(--navy); font-weight:600; }
    .ga-fund-form button { margin-top:0; }
    @media print { .ga-fund { display:none; } }
    .ga-meters a { color:inherit; }
    .ga-meters a.is-on { font-weight:700; color:var(--navy); }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:720px) { .ga-nudges li { grid-template-columns:1fr; } .ga-actions { justify-content:flex-start; } .ga-months { gap:4px; } }
`;
