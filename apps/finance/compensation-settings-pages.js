// ── Compensation Planner settings views ──────────────────────────────────────────────────────
// Server-rendered versions of legacy's Salary Planner editing views (src/frontend/js-finance.js):
// the raise-method grid (step 1), "This year's rates" (district base salary, Concordia rates,
// health plan quote) and the market comparison data (each worker's Concordia ranges). Forms post
// to compensation-plan-write-v1, which applies them with compensation-plan-form.js. Only admin and
// compensation roles are given the forms; everyone else allowed into the section sees the figures.
import { escapeHtml, renderSectionHeading } from './render-helpers.js';
import {
  HEALTH_PLAN_QUOTE_2027, FIN_HEALTH_TIERS, LCMS_MO_BASE_SALARY_BY_YEAR, LCMS_EMPLOYER_FICA_RATE,
  SSA_COLA_REFERENCE_PCT, finConcordiaPensionRateFor, finConcordiaDisabilityRateFor,
} from './compensation-calc.js';
import { COMP_METHOD_KEYS, FIN_COMP_PLAN_KEYS, FIN_CONCORDIA_RANGE_KEYS } from './compensation-projection.js';
import { money, moneySigned } from './compensation-council-report.js';

const e = escapeHtml;
const METHOD_NAMES = { none: 'No raise', worksheet: 'District Scale', scalepct: '% of Scale', cola: 'COLA', custom: 'Custom %' };
// Legacy finFmtPctInput: a stored fraction shown as a percentage without float noise.
function pctInput(fraction) {
  if (fraction == null || fraction === '') return '';
  return String(Math.round(Number(fraction) * 100 * 10000) / 10000);
}
const dollarsInput = (cents) => (cents == null || cents === '' ? '' : String(Number(cents) / 100));
const pctText = (fraction) => `${(Number(fraction || 0) * 100).toFixed(2)}%`;

function statusBanner(entryStatus, entryMessage) {
  if (entryStatus === 'ok') return '<p class="status">Saved in Connect.</p>';
  if (entryStatus === 'error') return `<p class="status status-error">Not saved: ${e(entryMessage || 'unknown error')}</p>`;
  return '';
}
function returnFields(page, { planYear, refYear } = {}) {
  return `<input type="hidden" name="return_page" value="${page}">${planYear ? `<input type="hidden" name="plan_year" value="${e(planYear)}">` : ''}${refYear ? `<input type="hidden" name="ref_year" value="${e(refYear)}">` : ''}`;
}

// Legacy step 1: pick a raise method for everyone or per worker, or type a figure by hand. Each
// method's resulting salary is shown beside the choice, as legacy's method columns did.
export function renderRaiseMethodsEditor(plan, projection, { planYear } = {}) {
  const roster = Array.isArray(plan && plan.roster) ? plan.roster : [];
  const perWorker = (plan && plan.compPerWorkerMethod) || {};
  const overrides = (plan && plan.compOverrides) || {};
  const planMethod = COMP_METHOD_KEYS.includes(plan && plan.compMethod) ? plan.compMethod : 'cola';
  const model = projection && projection.ok ? projection.model : null;
  const computed = projection && projection.ok ? projection.computed : null;
  const label = (key) => (model ? model.methodLabel(key) : METHOD_NAMES[key]);
  const option = (value, text, selected) => `<option value="${value}"${selected ? ' selected' : ''}>${e(text)}</option>`;
  const methodHead = COMP_METHOD_KEYS.map((k) => `<th class="num">${e(label(k))}</th>`).join('');
  const rows = roster.map((w, i) => {
    const name = (w && (w.name || w.position)) || `Staff member ${i + 1}`;
    const figures = COMP_METHOD_KEYS.map((k) => {
      const cents = model ? model.methodSalaryCents(w, k) : null;
      const active = (perWorker[i] || planMethod) === k;
      return `<td class="num">${cents == null ? '&mdash;' : (active ? `<b>${money(cents)}</b>` : money(cents))}</td>`;
    }).join('');
    const current = computed && computed[i] ? money(computed[i].currentCents) : '&mdash;';
    const result = computed && computed[i] ? `<b>${money(computed[i].salaryCents)}</b>` : '&mdash;';
    const flags = [w && w.externallyFunded ? 'externally funded' : '', w && w.cashOnly ? 'cash only' : '', w && w.hideFromCouncil ? 'hidden from council' : ''].filter(Boolean);
    return `<tr><td><b>${e(name)}</b>${flags.length ? `<br><small>${e(flags.join(' · '))}</small>` : ''}</td><td class="num">${current}</td>${figures}
      <td><select name="worker_method_${i}" aria-label="Raise method for ${e(name)}">${option('default', `Plan-wide (${label(planMethod)})`, !perWorker[i])}${COMP_METHOD_KEYS.map((k) => option(k, label(k), perWorker[i] === k)).join('')}</select></td>
      <td><input type="number" name="worker_override_${i}" min="0" step="1" value="${e(overrides[i] == null ? '' : String(overrides[i]).replace(/[^0-9.]/g, ''))}" placeholder="—" aria-label="Hand-set FY salary for ${e(name)}" style="width:7.5rem"></td>
      <td class="num">${result}</td></tr>`;
  }).join('');
  const num = (v) => (v === undefined || v === null || v === '' ? '' : e(String(v)));
  return `<section aria-label="Raise methods">
    ${renderSectionHeading({ eyebrow: 'Compensation Plan', heading: 'Raise methods', badge: 'Shared plan · relayed live to Connect' })}
    <form method="POST" action="/api/v1/connect-compensation-plan-write">
      <input type="hidden" name="action" value="methods">${returnFields('plan', { planYear })}
      <div class="grid form-grid">
        <div class="field"><label for="rm-method">Plan-wide raise method</label><select id="rm-method" name="comp_method">${COMP_METHOD_KEYS.map((k) => option(k, METHOD_NAMES[k], k === planMethod)).join('')}</select></div>
        <div class="field"><label for="rm-custom">Custom raise (%)</label><input id="rm-custom" type="number" name="comp_custom_pct" min="0" max="100" step="0.1" value="${num(plan && plan.compCustomPct)}" placeholder="3.5"></div>
        <div class="field"><label for="rm-scale">Share of District Scale (%)</label><input id="rm-scale" type="number" name="comp_scale_pct" min="0" max="200" step="1" value="${num(plan && plan.compScalePct)}" placeholder="95"></div>
        <div class="field"><label for="rm-basis">Compare the plan against</label><select id="rm-basis" name="comp_base_year_basis">
          ${option('roster', 'The same roster at last year’s rates', (plan && plan.compBaseYearBasis) !== 'ledger')}
          ${option('ledger', 'Last year’s ledger accounts', (plan && plan.compBaseYearBasis) === 'ledger')}
        </select></div>
      </div>
      <div class="field"><label><input type="checkbox" name="comp_baseline_roster_only" value="1"${plan && plan.compBaselineRosterOnly ? ' checked' : ''}> Ledger comparison: leave out salary accounts no roster worker is linked to</label></div>
      ${roster.length ? `<div class="table-wrap"><table><thead><tr><th>Worker</th><th class="num">Current pay</th>${methodHead}<th>Method for this worker</th><th>Hand-set salary ($)</th><th class="num">FY${model ? model.targetYear : ''} salary</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>No workers on this plan yet.</p>'}
      <div class="field"><label><input type="checkbox" name="apply_to_all" value="1"> Apply the plan-wide method to everyone (clears every per-worker choice and hand-set salary)</label></div>
      <button type="submit">Save raise methods</button>
    </form>
    <p><small>A hand-set salary wins over the worker’s method; leave it blank to use the method. COLA uses the Social Security COLA entered on Rates &amp; ranges for the plan year.</small></p>
  </section>`;
}

function rateField(label, name, value, { suffix = '%', placeholder = '' } = {}) {
  const unit = suffix === '$' ? ' ($)' : ' (%)';
  return `<div class="field"><label for="ref-${name}">${label}${unit}</label><input id="ref-${name}" type="number" name="${name}" step="any" value="${e(value)}" placeholder="${e(placeholder)}"></div>`;
}

function renderReferenceEditor(plan, model, { refYear, planYear, canEdit }) {
  const ref = (plan && plan.referenceByYear) || {};
  const row = ref[refYear] || {};
  const baseInfo = model.baseSalary(refYear);
  const prevBase = model.baseSalary(refYear - 1);
  const years = [...new Set(Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).map(Number).concat(Object.keys(ref).map(Number)))].filter(Number.isFinite).sort((a, b) => a - b);
  const history = years.map((y) => { const v = model.baseSalary(y); return `<span class="badge"${y === refYear ? ' style="font-weight:700"' : ''}>${y} · ${v.dollars ? money(Math.round(v.dollars * 100)) : 'not set'}</span>`; }).join(' ');
  const change = prevBase.dollars ? `${moneySigned(Math.round((baseInfo.dollars - prevBase.dollars) * 100))} (${((baseInfo.dollars - prevBase.dollars) / prevBase.dollars * 100).toFixed(2)}%)` : '&mdash;';
  const note = row.baseSalaryCents != null ? ''
    : baseInfo.exact ? `<p><small>Nothing entered for FY${refYear}; using the published district figure on file, ${money(Math.round(baseInfo.dollars * 100))}. Type this year’s figure to override it.</small></p>`
      : `<p class="status status-pending">No figure entered for FY${refYear} yet; carrying ${money(Math.round(baseInfo.dollars * 100))} forward from FY${baseInfo.sourceYear}. Enter the real number when the district paper arrives.</p>`;
  const defaults = `pension ${pctText(finConcordiaPensionRateFor(refYear).rate)}, FICA ${pctText(LCMS_EMPLOYER_FICA_RATE)}, disability ${pctText(finConcordiaDisabilityRateFor(refYear, true).rate)}/${pctText(finConcordiaDisabilityRateFor(refYear, false).rate)}, COLA ${pctText(SSA_COLA_REFERENCE_PCT)}`;
  const dis = canEdit ? '' : ' disabled';
  const body = `<div class="grid form-grid">
      ${rateField(`District base salary, FY${refYear}`, 'baseSalaryCents', dollarsInput(row.baseSalaryCents), { suffix: '$', placeholder: baseInfo.dollars ? String(Math.round(baseInfo.dollars * 100) / 100) : '' })}
      <div class="field"><label>Change from last year</label><p><b>${change}</b></p></div>
      ${rateField('Pension (Traditional)', 'pensionPct', pctInput(row.pensionPct), { placeholder: pctInput(model.pensionRate(refYear).rate) })}
      ${rateField('Employer FICA', 'ficaPct', pctInput(row.ficaPct), { placeholder: pctInput(model.ficaRate(refYear)) })}
      ${rateField('Disability — with dependents', 'disabilityDepsPct', pctInput(row.disabilityDepsPct), { placeholder: pctInput(model.disabilityRate(refYear, true).rate) })}
      ${rateField('Disability — without', 'disabilityNoDepsPct', pctInput(row.disabilityNoDepsPct), { placeholder: pctInput(model.disabilityRate(refYear, false).rate) })}
      ${rateField('Social Security COLA', 'ssaColaPct', pctInput(row.ssaColaPct), { placeholder: pctInput(model.ssaRate(refYear)) })}
      ${rateField('Health opt-out cash', 'healthOptOutCents', dollarsInput(row.healthOptOutCents), { suffix: '$', placeholder: dollarsInput(model.optOutCents(refYear)) })}
    </div>
    <div class="grid form-grid">
      <div class="field"><label for="ref-district">District source document</label><input id="ref-district" type="text" name="districtSource" value="${e(row.districtSource || '')}" placeholder="${e(model.sourceDoc('districtSource'))}"${dis}></div>
      <div class="field"><label for="ref-concordia">Concordia source document</label><input id="ref-concordia" type="text" name="concordiaSource" value="${e(row.concordiaSource || '')}" placeholder="${e(model.sourceDoc('concordiaSource'))}"${dis}></div>
    </div>`;
  return `<section aria-label="Reference figures">
    ${renderSectionHeading({ eyebrow: `FY${refYear} reference figures`, heading: 'District guidelines and Concordia Plans rates', badge: canEdit ? 'Shared plan · relayed live to Connect' : 'Read-only' })}
    ${note}
    <p><small>Base salary history: ${history}</small></p>
    ${canEdit ? `<form method="POST" action="/api/v1/connect-compensation-plan-write"><input type="hidden" name="action" value="reference">${returnFields('rates', { planYear, refYear })}${body}<button type="submit">Save FY${refYear} figures</button></form>` : body.replace(/<input /g, '<input disabled ')}
    <p><small>Announced each autumn for the following year: the Social Security COLA in October, the Concordia Plans rates with the renewal packet. A blank box uses the latest earlier year you entered, then ${defaults}. Percentages are of salary; the role, education and experience multipliers stay fixed.</small></p>
  </section>`;
}

function renderHealthQuoteEditor(plan, model, { refYear, planYear, canEdit }) {
  const overrides = (plan && plan.healthPlanPremiumOverrides) || {};
  const counts = model.enrollmentCounts();
  const box = (name, cents, quoted) => `<input type="number" name="${name}" step="0.01" min="0" value="${e(dollarsInput(cents))}" placeholder="${quoted == null ? '' : (quoted / 100).toFixed(2)}" style="width:6.5rem"${canEdit ? '' : ' disabled'}>`;
  const rows = FIN_COMP_PLAN_KEYS.map((key) => {
    const opt = HEALTH_PLAN_QUOTE_2027.options[key];
    const ov = overrides[key] || {};
    const total = model.healthPlanTotal(key);
    const tiers = FIN_HEALTH_TIERS.map((t) => `<td class="num">${box(`tier_${key}_${t.key}`, (ov.tiersMonthlyCents || {})[t.key], (opt.tiersMonthlyCents || {})[t.key])}</td>`).join('');
    const fields = ['dentalCents', 'visionCents', 'deductibleIndividualCents', 'deductibleFamilyCents', 'oopMaxIndividualCents', 'oopMaxFamilyCents']
      .map((f) => `<td class="num">${box(`quote_${key}_${f}`, ov[f], opt[f])}</td>`).join('');
    const active = key === model.plan.healthPlanOption;
    return `<tr${active ? ' style="background:#FBF5E6"' : ''}><td><b>${e(opt.label)}</b><br><small>${opt.embedded ? 'Embedded' : 'Non-embedded'}${active ? ' · church covers this plan' : ''}</small></td>${tiers}${fields}<td class="num"><b>${money(total ? total.totalCents : 0)}</b></td></tr>`;
  }).join('');
  const enrolled = FIN_HEALTH_TIERS.map((t) => `<td class="num"><b>${counts[t.key]}</b></td>`).join('');
  const option = (value, text, selected) => `<option value="${value}"${selected ? ' selected' : ''}>${e(text)}</option>`;
  const family = Number(plan && plan.healthFamilySize) || 2;
  const refRow = ((plan && plan.referenceByYear) || {})[refYear] || {};
  const table = `<div class="table-wrap"><table><thead><tr><th style="min-width:14rem">Plan option</th>${FIN_HEALTH_TIERS.map((t) => `<th class="num">${e(t.label)} / mo</th>`).join('')}<th class="num">Dental / yr</th><th class="num">Vision / yr</th><th class="num">Deductible single</th><th class="num">Deductible family</th><th class="num">Out-of-pocket single</th><th class="num">Out-of-pocket family</th><th class="num">Total annual</th></tr></thead>
      <tbody>${rows}<tr><td>Enrolled now (from the roster)</td>${enrolled}<td colspan="6"><small>Change a worker’s coverage tier on the Plan page. Cash-only and externally funded workers are not contracts.</small></td><td class="num">${model.enrolledCount()}</td></tr></tbody></table></div>
    <div class="grid form-grid">
      <div class="field"><label for="hq-option">Plan the church covers in full</label><select id="hq-option" name="health_plan_option"${canEdit ? '' : ' disabled'}>${FIN_COMP_PLAN_KEYS.map((k) => { const c = model.healthPlanTotal(k); return option(k, `${HEALTH_PLAN_QUOTE_2027.options[k].label} · ${money(c ? c.totalCents : 0)}`, k === model.plan.healthPlanOption); }).join('')}</select></div>
      <div class="field"><label for="hq-family">Family members assumed</label><select id="hq-family" name="health_family_size"${canEdit ? '' : ' disabled'}>${[1, 2, 3, 4, 5, 6].map((n) => option(n, String(n), n === family)).join('')}</select></div>
      <div class="field"><label for="hq-source">Quote reference (FY${refYear})</label><input id="hq-source" type="text" name="quoteSource" value="${e(refRow.quoteSource || '')}" placeholder="${e(model.sourceDoc('quoteSource'))}"${canEdit ? '' : ' disabled'}></div>
    </div>`;
  return `<section aria-label="Health plan quote">
    ${renderSectionHeading({ eyebrow: 'Health plan quote', heading: 'Monthly rates per coverage tier', badge: canEdit ? 'Shared plan · relayed live to Connect' : 'Read-only' })}
    <p><small>Type the renewal packet’s Enrollment and Rates block: one monthly rate per tier, per option. Dental and vision are annual group figures shared across whoever is enrolled. A blank box uses the quote on file.</small></p>
    ${canEdit ? `<form method="POST" action="/api/v1/connect-compensation-plan-write"><input type="hidden" name="action" value="quote">${returnFields('rates', { planYear, refYear })}${table}<button type="submit">Save health plan quote</button></form>` : table}
  </section>`;
}

// Legacy "Market comparison data": each worker's Concordia Plans Compensation Decision Support
// report, typed in once a year. Everything the Benchmarks page measures against comes from here.
export function renderConcordiaRangesEditor(plan, model, { planYear, canEdit, returnPage = 'rates' }) {
  const roster = Array.isArray(plan && plan.roster) ? plan.roster : [];
  if (!roster.length) return '';
  const blocks = roster.map((w, i) => {
    const c = (w && w.concordia) || {};
    const onFile = model ? model.usableRanges(w).length : 0;
    const box = (field) => `<input type="text" inputmode="decimal" name="${field}" value="${e(c[field] == null ? '' : c[field])}" placeholder="—" style="width:7rem;text-align:right"${canEdit ? '' : ' disabled'}>`;
    const rangeRows = FIN_CONCORDIA_RANGE_KEYS.map((r) => `<tr${/LCMS/i.test(r.label) ? ' style="background:#F4F6F9"' : ''}><td>${e(r.label)}</td><td class="num">${box(`${r.key}Low`)}</td><td class="num">${box(`${r.key}Mid`)}</td><td class="num">${box(`${r.key}High`)}</td></tr>`).join('');
    const inner = `<div class="grid form-grid">
        <div class="field"><label>Position on the report<input type="text" name="position" value="${e(c.position || '')}"${canEdit ? '' : ' disabled'}></label></div>
        <div class="field"><label>Report date<input type="text" name="asOfDate" value="${e(c.asOfDate || '')}" placeholder="mm/dd/yyyy"${canEdit ? '' : ' disabled'}></label></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Range</th><th class="num">Lower pay</th><th class="num">Midpoint pay</th><th class="num">Higher pay</th></tr></thead><tbody>${rangeRows}</tbody></table></div>`;
    return `<details class="panel panel-spaced"><summary><b>${e((w && w.name) || '(unnamed)')}</b> &mdash; ${onFile ? `${onFile} of 4 ranges on file` : 'no report on file (compared to the District worksheet only)'}</summary>
      ${canEdit ? `<form method="POST" action="/api/v1/connect-compensation-plan-write"><input type="hidden" name="action" value="ranges"><input type="hidden" name="index" value="${i}">${returnFields(returnPage, { planYear })}${inner}<button type="submit">Save ${e((w && w.name) || 'worker')}’s ranges</button></form>` : inner}
    </details>`;
  }).join('');
  return `<section aria-label="Market comparison data">
    ${renderSectionHeading({ eyebrow: 'Benchmarks', heading: 'Market comparison data', badge: canEdit ? 'Shared plan · relayed live to Connect' : 'Read-only' })}
    <p><small>Run Concordia Plans’ <a href="https://tc.cbiz.com/CompToolCPS/Login" target="_blank" rel="noopener">Compensation Decision Support Tool</a> once a year per worker and type the four ranges in. The LCMS row (shaded) is the one the Benchmarks readings measure against. The District pair only prints on a pastor report; leave it blank otherwise. Clearing a box removes that figure.</small></p>
    ${blocks}
  </section>`;
}

function renderRefYearPicker(model, refYear, planYear) {
  const years = [...new Set([model.baseYear, model.targetYear, model.targetYear + 1])];
  return `<form method="GET" action="/" class="inline-form" aria-label="Reference year">
    <input type="hidden" name="section" value="compensation"><input type="hidden" name="page" value="rates">
    ${planYear ? `<input type="hidden" name="plan_year" value="${e(planYear)}">` : ''}
    <label for="ref-year">Figures for</label>
    <select id="ref-year" name="ref_year">${years.map((y) => { const known = model.baseSalary(y); return `<option value="${y}"${y === refYear ? ' selected' : ''}>FY${y}${known.exact ? '' : ' (not yet published)'}</option>`; }).join('')}</select>
    <button type="submit">Show</button>
  </form>`;
}

export function renderRatesPage(projection, plan, { canEdit, refYear, planYear, entryStatus, entryMessage }) {
  const model = projection.model;
  const year = Number.isInteger(refYear) ? refYear : model.targetYear;
  return `${statusBanner(entryStatus, entryMessage)}${renderRefYearPicker(model, year, planYear)}
    ${renderReferenceEditor(plan, model, { refYear: year, planYear, canEdit })}
    ${renderHealthQuoteEditor(plan, model, { refYear: year, planYear, canEdit })}
    ${renderConcordiaRangesEditor(plan, model, { planYear, canEdit })}`;
}
