// ── Council compensation report and raise projection views ───────────────────────────────────
// The server-rendered version of legacy's Council report (finCompCouncilReportHtml and the
// base-year notes in src/frontend/js-finance.js), built from compensation-projection.js. The
// wording, sections and figures follow legacy; the interactive pieces (basis picker, "leave these
// out" link, window.print) are left out, because Finance prints through print=1 and the basis is a
// saved plan setting.
import { escapeHtml, renderKpiCards, renderSectionHeading } from './render-helpers.js';
import { FIN_HEALTH_TIERS, FIN_SALARY_PAY_PERIODS } from './compensation-calc.js';
import { FIN_COMP_PLAN_KEYS, healthTierLabel } from './compensation-projection.js';

// Legacy finCompMoney / finCompMoneyCents / finCompMoneySigned / finCompPctFmt.
export function money(cents) {
  return '$' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-US');
}
function moneyCents(cents) {
  return '$' + ((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function moneySigned(cents) {
  const r = Math.round((Number(cents) || 0) / 100);
  return (r >= 0 ? '+' : '&minus;') + '$' + Math.abs(r).toLocaleString('en-US');
}
function pctFmt(fraction, places) {
  return ((Number(fraction) || 0) * 100).toFixed(places == null ? 2 : places) + '%';
}
const TONE_COLORS = { good: '#1f6b45', warn: '#9a6412', bad: '#8a2b1e', none: '#666' };
const tone = (t, html) => `<span style="color:${TONE_COLORS[t] || TONE_COLORS.none}">${html}</span>`;
const n = (html, extra = '') => `<td class="num"${extra}>${html}</td>`;

function vsScaleText(v) {
  if (v.pct == null) return '&mdash;';
  return v.atScale ? 'at scale' : `${moneySigned(v.diffCents)} (${v.pct}% of scale)`;
}
function verdictText(v) {
  switch (v.kind) {
    case 'below-all': return 'Below every published range';
    case 'below-lcms': return 'Below the LCMS range';
    case 'at-mid': return 'At the LCMS midpoint';
    case 'above-mid': return `${moneySigned(v.vsMidCents)} above the LCMS midpoint`;
    case 'below-mid': return `${moneySigned(v.vsMidCents)} vs the LCMS midpoint`;
    default: return 'No published range';
  }
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function renderRosterBaselineNote(model, totals) {
  const r = totals.baseline;
  const ledger = model.ledgerBaselineDetail();
  const counted = model.countedEntries().length;
  const planLabel = (model.healthPlanTotal(r.planOption) || {}).label || r.planOption;
  const salDelta = totals.salaryCents - r.salaryCents;
  const benDelta = totals.benefitsCents - r.benefitCents;
  const row = (label, base, plan) => {
    const d = plan - base;
    return `<tr><td>${label}</td>${n(money(base))}${n(money(plan))}${n(`<b>${d === 0 ? 'no change' : moneySigned(d)}</b>`)}</tr>`;
  };
  const ledgerLine = ledger.available
    ? `For reference, the FY${model.baseYear} <b>ledger</b> spent ${money(ledger.cents)} across every account named like payroll or health &mdash; ${money(Math.abs(ledger.cents - r.cents))}${ledger.cents > r.cents ? ' more' : ' less'} than these ${counted} worker(s) cost. That is a different population (daycare and MDO staff, supply preachers, nursery wages sit in the same accounts), which is why it is not what the plan is measured against.`
    : `The FY${model.baseYear} church ledger could not be read, so the ledger comparison is not shown.`;
  return `<div class="comp-basis">
    <p><b>FY${model.baseYear} is the same ${counted} worker(s), costed at FY${model.baseYear} rates.</b> Same model as FY${model.targetYear} &mdash; each worker&rsquo;s current pay, pension at ${pctFmt(model.pensionRate(model.baseYear).rate)}, disability, employer FICA, and the health plan in force then (${escapeHtml(planLabel)}). So &ldquo;No raise&rdquo; lands at nothing changed, and anything left is a real rate or premium move.</p>
    <table><thead><tr><th></th><th class="num">FY${model.baseYear}</th><th class="num">FY${model.targetYear}</th><th class="num">Change</th></tr></thead><tbody>
      ${row('Cash salaries', r.salaryCents, totals.salaryCents)}${row('Benefits &amp; taxes', r.benefitCents, totals.benefitsCents)}
    </tbody></table>
    <p><small>${salDelta === 0 ? 'Salaries are unchanged, as expected under this method. ' : ''}${benDelta !== 0 ? `Benefits move ${moneySigned(benDelta)} on rates alone &mdash; pension ${pctFmt(model.pensionRate(model.baseYear).rate)} &rarr; ${pctFmt(model.pensionRate(model.targetYear).rate)}, plus the premium renewal.` : ''}</small></p>
    <p><small>${ledgerLine}</small></p>
  </div>`;
}

function renderLedgerBaselineNote(model, totals) {
  const b = totals.baseline;
  const counted = model.countedEntries().length;
  const planParts = `cash salaries ${money(totals.salaryCents)} + benefits &amp; taxes ${money(totals.benefitsCents)} (pension, disability, health, employer FICA)`;
  if (!b.rows.length) {
    return `<div class="comp-basis"><p><b>vs FY${model.baseYear}:</b> ${b.available ? `no compensation accounts were found in the FY${model.baseYear} church ledger` : `the FY${model.baseYear} church ledger could not be read`}, so there is nothing to compare against. FY${model.targetYear} is ${planParts}.</p></div>`;
  }
  const list = (rows) => `<ul>${rows.map((r) => `<li>${escapeHtml(r.label)} &middot; ${money(r.cents)} <small>(${r.basis}${r.rosterNames.length ? ' &middot; ' + escapeHtml(r.rosterNames.join(', ')) : ''})</small></li>`).join('')}</ul>`;
  const matchedSalary = b.rows.filter((r) => r.kind === 'salary' && r.rosterNames.length);
  const pooled = b.rows.filter((r) => r.kind === 'benefit');
  const salDelta = totals.salaryCents - b.salaryCents;
  const benDelta = totals.benefitsCents - b.benefitCents;
  const cmpRow = (label, planCents, baseCents, delta) => `<tr><td>${label}</td>${n(money(baseCents))}${n(money(planCents))}${n(`<b>${moneySigned(delta)}</b>`)}</tr>`;
  let out = `<div class="comp-basis">
    <p><b>How the FY${model.baseYear} comparison is figured.</b> FY${model.targetYear} is ${planParts}, for the ${counted} worker(s) counted above. FY${model.baseYear} is the same cost categories from the church ledger.</p>
    <table><thead><tr><th>Where the difference is</th><th class="num">FY${model.baseYear} ledger</th><th class="num">FY${model.targetYear} plan</th><th class="num">Difference</th></tr></thead><tbody>
      ${cmpRow('Salaries', totals.salaryCents, b.salaryCents, salDelta)}${cmpRow('Benefits &amp; taxes', totals.benefitsCents, b.benefitCents, benDelta)}
    </tbody></table>
    <p><small>${Math.abs(benDelta) > Math.abs(salDelta)
      ? `Most of the gap is on the <b>benefits</b> side: the FY${model.baseYear} ledger carries ${money(Math.abs(benDelta))} ${benDelta < 0 ? 'more' : 'less'} in pension, health and employer taxes than this plan computes. That usually means the ledger accounts cover people or coverage the roster does not model.`
      : `Most of the gap is on the <b>salary</b> side: the FY${model.baseYear} ledger carries ${money(Math.abs(salDelta))} ${salDelta < 0 ? 'more' : 'less'} in wages than this plan. That usually means a salary account nobody on this roster is paid from &mdash; see the unmatched accounts below.`}</small></p>`;
  if (matchedSalary.length) out += `<p><b>Salaries for people on this roster</b></p>${list(matchedSalary)}`;
  if (pooled.length) out += `<p><b>Pooled benefits &amp; taxes</b> (charged for the whole staff on one line, so they cannot be split per person)</p>${list(pooled)}`;
  if (b.unmatchedRows.length) {
    out += `<p><b>Salaries for people NOT on this roster &mdash; ${money(b.unmatchedCents)}${b.rosterOnly ? ' (not counted)' : ' (counted)'}</b></p>
      <p>No worker counted above is paid from ${b.unmatchedRows.length === 1 ? 'this account' : 'these accounts'}. That is a departed or vacant post, a worker missing from the roster, or someone excluded as paid from another budget${b.rosterOnly ? '' : ' &mdash; and while it is counted, the base year covers more people than the plan does, so the plan reads cheaper than it is'}.</p>${list(b.unmatchedRows)}`;
  } else {
    out += '<p>Every salary account found is one a worker counted above is paid from, so both sides cover the same people.</p>';
  }
  out += `<p><small>${b.prorated
    ? `FY${model.baseYear} is still in progress (${b.weeks.toFixed(0)} weeks in), so an account with no budget on file is annualized from its actual &mdash; the same 52/weeks the Budget tab uses. Both sides are a full year. `
    : `FY${model.baseYear} is complete, so these are its own full-year figures. `}<b>What this still cannot see:</b> an account the church names in some other way is not counted at all, and a pooled benefit line covers everyone the church paid that year, including anyone listed above as not on this roster.</small></p></div>`;
  return out;
}

export function renderBaselineNote(model, totals) {
  return totals.baseline.basis === 'roster' ? renderRosterBaselineNote(model, totals) : renderLedgerBaselineNote(model, totals);
}

const BREAKDOWN_LABELS = {
  pension: (r) => ['Pension &mdash; Concordia Retirement Plan', `${pctFmt(r.rate)} of cash salary`],
  health: () => ['Health plan', 'group premium, opt-out cash and hand-entered employee-only premiums combined'],
  disability: (r) => ['Disability &amp; survivor', `${pctFmt(r.rate)} of cash salary, ${pctFmt(r.rateWithDependents)} with dependents`],
  fica: (r) => ['Employer FICA', `${pctFmt(r.rate)} of cash salary; a minister pays their own SECA instead`],
};

function renderSalaryRows(model, computed) {
  return model.roster.map((w, i) => {
    const c = computed[i];
    const name = escapeHtml(w.name || '(unnamed)');
    if (model.isExternallyFunded(w)) {
      return `<tr class="muted"><td><b>${name}</b><br><small>${escapeHtml(w.position || '')} &middot; paid from another budget</small></td>${n(money(c.currentCents))}${n(money(c.salaryCents))}${n('&mdash;')}${n('&mdash;')}${n('&mdash;')}${n('&mdash;')}${n('not in this budget')}</tr>`;
    }
    const ratio = c.worksheetCents ? Math.round(c.salaryCents / c.worksheetCents * 100) : null;
    const ratioTone = c.worksheetCents ? model.vsScale(c.salaryCents, c.worksheetCents).tone : 'none';
    return `<tr><td><b>${name}</b><br><small>${escapeHtml(w.position || '')} &middot; ${Number(w.yearsExperience) || 0} yrs${w.accountCode ? ' &middot; acct ' + escapeHtml(w.accountCode) : ''} &middot; ${escapeHtml(c.overridden ? 'typed figure' : model.methodLabel(c.methodKey))}</small></td>`
      + n(money(c.currentCents))
      + n(`<b>${money(c.salaryCents)}</b>`)
      + n(c.salaryCents === c.currentCents ? 'no change' : moneySigned(c.salaryCents - c.currentCents))
      + n(money(c.salaryCents / FIN_SALARY_PAY_PERIODS))
      + n(c.worksheetCents == null ? '&mdash;' : money(c.worksheetCents))
      + n(ratio == null ? '&mdash;' : tone(ratioTone, `<b>${ratio}%</b>`))
      + n(`<b>${money(c.churchCostCents)}</b>`) + '</tr>';
  }).join('');
}

function salaryTable(model, computed, totals) {
  const scaleRatio = totals.worksheetCents ? Math.round(totals.salaryCents / totals.worksheetCents * 100) : null;
  return `<div class="table-wrap"><table><thead><tr><th style="min-width:11rem">Worker</th><th class="num">FY${model.baseYear}</th><th class="num">FY${model.targetYear}</th><th class="num">Change</th><th class="num">Per paycheck</th><th class="num">District scale</th><th class="num">% of scale</th><th class="num">Church cost</th></tr></thead>
    <tbody>${renderSalaryRows(model, computed)}
    <tr class="total"><td><b>Total</b></td>${n(money(totals.currentCents))}${n(money(totals.salaryCents))}${n(moneySigned(totals.salaryCents - totals.currentCents))}${n('&mdash;')}${n(money(totals.worksheetCents))}${n(scaleRatio == null ? '&mdash;' : scaleRatio + '%')}${n(money(totals.totalCents))}</tr></tbody></table></div>`;
}

function headlineCards(model, totals) {
  const pct = totals.baselineCents ? (totals.deltaCents / totals.baselineCents * 100) : 0;
  return renderKpiCards([
    { label: 'Cash salaries', value: money(totals.salaryCents) },
    { label: 'Benefits & taxes', value: money(totals.benefitsCents) },
    { label: `FY${model.targetYear} total`, value: money(totals.totalCents) },
    { label: `vs FY${model.baseYear} ${money(totals.baselineCents)}`, value: totals.baselineCents ? `${moneySigned(totals.deltaCents)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '&mdash;' },
  ]);
}

function ledgerWarning(model) {
  return model.hasBaseLedger ? '' : `<p class="status status-pending">The FY${model.baseYear} church ledger could not be read, so any worker whose current pay comes from a linked account shows $0 current pay. Figures for workers with a typed current pay are unaffected.</p>`;
}

// Plan page: the projection behind the draft or roster being edited, without the full report.
export function renderProjectionSummary({ model, computed, totals }, { heading = 'Projected salaries', badge = 'Computed from the saved plan', note = '' } = {}) {
  return `<section class="report" aria-label="Raise projection">
    ${renderSectionHeading({ eyebrow: `FY${model.targetYear} projection`, heading: escapeHtml(heading), badge: escapeHtml(badge) })}
    ${ledgerWarning(model)}
    ${headlineCards(model, totals)}
    ${salaryTable(model, computed, totals)}
    ${note ? `<p><small>${note}</small></p>` : ''}
  </section>`;
}

// Council page and its print: legacy's full Council report.
export function renderCouncilReport({ model, computed, totals }) {
  if (!model.roster.length) {
    return `<section class="report" aria-label="Council compensation report">${renderSectionHeading({ eyebrow: 'Church Council · Compensation', heading: `Fiscal Year ${model.targetYear} Compensation Plan`, badge: 'No roster' })}<p>No compensation roster has been saved yet.</p></section>`;
  }
  const counted = model.countedEntries().length;
  const pct = totals.baselineCents ? (totals.deltaCents / totals.baselineCents * 100) : 0;
  const gap = model.fullScaleGap(computed);
  const med = model.medianTotal(computed);
  const planCalc = model.healthPlanTotal(model.plan.healthPlanOption);
  const scaleRatio = totals.worksheetCents ? Math.round(totals.salaryCents / totals.worksheetCents * 100) : null;
  const salaryShare = totals.totalCents ? Math.round(totals.salaryCents / totals.totalCents * 100) : 0;
  const altTotalCents = totals.totalCents + gap.totalCents;
  const altPct = totals.baselineCents ? (altTotalCents - totals.baselineCents) / totals.baselineCents * 100 : 0;
  const pensionPct = pctFmt(model.pensionRate(model.targetYear).rate);
  const methodLong = model.methodLongLabel(model.plan.method);
  const excluded = model.externallyFundedWorkers();
  const bd = model.benefitBreakdown(computed);

  const cover = `<section class="report" aria-label="Council compensation report">
    ${renderSectionHeading({ eyebrow: 'Church Council · Compensation', heading: `Fiscal Year ${model.targetYear} Compensation Plan`, badge: 'Prepared for Church Council' })}
    <p>${plural(counted, 'called and employed worker')} &middot; salaries set by ${methodLong} &middot; pension ${pensionPct} &middot; health plan: ${escapeHtml(planCalc ? planCalc.label : 'none selected')}</p>
    ${ledgerWarning(model)}
    ${headlineCards(model, totals)}
    <div class="card"><small>Recommended motion</small><p>That the Church Council approve FY${model.targetYear} compensation of <b>${money(totals.totalCents)}</b> for ${plural(counted, 'worker')}${totals.baselineCents ? ` &mdash; a ${pct.toFixed(1)}% ${totals.deltaCents >= 0 ? 'increase over' : 'decrease from'} FY${model.baseYear} compensation of ${money(totals.baselineCents)}${totals.baseline.prorated ? ', annualized' : ''}` : ''} &mdash; applying ${methodLong} to each worker&#39;s salary, continuing the Concordia Retirement Plan at ${pensionPct}, and ${planCalc ? `setting the group health plan to ${escapeHtml(planCalc.label)} at ${money(planCalc.totalCents)}` : 'making no change to the group health plan'}.</p></div>
    ${renderBaselineNote(model, totals)}
    ${renderSectionHeading({ eyebrow: 'Decision', heading: 'What Council is being asked to weigh' })}
    <p>Three separate questions sit behind the single number above. <b>How much of a raise</b> &mdash; a COLA keeps existing salaries level with inflation, while the district&#39;s own published scale is a benchmark. <b>Whether our pay is fair</b> &mdash; measured against the LCMS Missouri District scale and against Concordia Plans&#39; published pay ranges for each role. <b>What it costs</b> &mdash; salary is ${salaryShare}% of the total; pension, health, disability and employer taxes are the rest.</p>
    <p>The plan below pays <b>${scaleRatio == null ? 'an unknown share of' : scaleRatio + '% of'} the district scale</b> in total${med.count ? `, and sits <b>${med.pct}% of median, ${plural(med.count, 'with report')}</b> for the ${plural(med.count, 'worker')} with a Concordia Plans report on file` : ''}. ${gap.totalCents
      ? `Bringing every worker to full district scale would cost an additional <b>${money(gap.salaryGapCents)}</b> in salary and <b>${money(gap.benefitsGapCents)}</b> in the benefits that follow it &mdash; pension, disability and, for non-ministers, employer FICA; health premiums do not move with salary &mdash; for a total of <b>${money(gap.totalCents)}</b> on top of what is proposed here. That is an alternative, not the plan: it would take FY${model.targetYear} compensation from the recommended <b>${money(totals.totalCents)}</b> (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) to <b>${money(altTotalCents)}</b> (${altPct >= 0 ? '+' : ''}${altPct.toFixed(1)}%).`
      : 'Every worker is already at or above the district scale, so there is no cost-to-full-scale alternative to weigh.'}</p>
    ${renderSectionHeading({ eyebrow: 'Salaries', heading: 'Salary plan by worker' })}
    ${salaryTable(model, computed, totals)}
    ${renderSectionHeading({ eyebrow: 'Benefits', heading: `What makes up ${money(totals.benefitsCents)} of benefits &amp; taxes` })}
    <div class="table-wrap"><table><thead><tr><th>Cost</th><th class="num">Workers</th><th class="num">FY${model.targetYear}</th><th class="num">Share</th></tr></thead><tbody>
      ${bd.rows.map((r) => { const [label, note] = BREAKDOWN_LABELS[r.key](r); return `<tr><td>${label}<br><small>${note}</small></td>${n(`${r.people} of ${bd.countedCount}`)}${n(`<b>${money(r.cents)}</b>`)}${n(`${bd.totalCents ? Math.round(r.cents / bd.totalCents * 100) : 0}%`)}</tr>`; }).join('')}
      <tr class="total"><td><b>Total benefits &amp; taxes</b></td><td></td>${n(money(bd.totalCents))}${n('100%')}</tr>
    </tbody></table></div>
    ${excluded.length ? `<p><small>Not counted in any figure above: ${excluded.map((w) => escapeHtml(w.name || '(unnamed)') + (w.position ? ` (${escapeHtml(w.position)})` : '')).join(', ')} &mdash; paid from another budget, and costed in that section.</small></p>` : ''}
  </section>`;

  const workerPages = model.roster.map((w, i) => {
    if (model.isExternallyFunded(w)) return '';
    const c = computed[i], b = c.benefits;
    const name = escapeHtml(w.name || '(unnamed)');
    const usable = model.usableRanges(w);
    const v = model.verdict(w, c.salaryCents);
    const scaleV = model.vsScale(c.salaryCents, c.worksheetCents);
    const worksheetText = c.worksheetCents == null ? 'an unavailable figure' : money(c.worksheetCents);
    const rangeTable = usable.length
      ? `<div class="table-wrap"><table><thead><tr><th>Range</th><th class="num">Lower</th><th class="num">Midpoint</th><th class="num">Higher</th><th class="num">This plan vs. midpoint</th></tr></thead><tbody>${usable.map((r) => {
        const vs = r.midCents ? c.salaryCents - r.midCents : null;
        const lcms = /LCMS/i.test(r.label);
        return `<tr><td>${lcms ? '<b>' : ''}${escapeHtml(r.label)}${lcms ? '</b>' : ''}</td>${n(money(r.lowCents))}${n(r.midCents ? money(r.midCents) : '&mdash;')}${n(money(r.highCents))}${n(vs == null ? '&mdash;' : moneySigned(vs))}</tr>`;
      }).join('')}</tbody></table></div>`
      : '<p><small>No Concordia Plans report on file for this position &mdash; compared against the District Compensation Worksheet figure only.</small></p>';
    const read = usable.length
      ? `${escapeHtml(w.name || 'This worker')} is ${tone(v.tone, verdictText(v).toLowerCase())}, and ${vsScaleText(scaleV).replace(/^at scale$/, 'sits at the district scale')} against the district worksheet figure of ${worksheetText}.`
      : `${escapeHtml(w.name || 'This worker')} has no market report on file; against the district worksheet figure of ${worksheetText} this plan is ${vsScaleText(scaleV)}.`;
    const rows = [`<tr><td>Cash salary</td>${n(`<b>${money(c.salaryCents)}</b>`)}</tr>`];
    if (b.cashOnly) {
      rows.push(`<tr><td colspan="2"><small>Cash salary only at ${model.ftePct(w)}% of full time &mdash; below the hours floor for the Concordia pension, disability and health plans. Employer FICA still applies.</small></td></tr>`);
    } else {
      rows.push(`<tr><td>Pension ${pensionPct}</td>${n(money(b.pensionCents))}</tr>`);
      rows.push(`<tr><td>Health &mdash; ${escapeHtml(healthTierLabel(model.healthTier(w)).toLowerCase())}</td>${n(money(b.healthCents))}</tr>`);
      rows.push(`<tr><td>Disability &amp; survivor${w.hasDependents ? ' (with dependents)' : ''}</td>${n(money(b.disabilityCents))}</tr>`);
    }
    rows.push(`<tr><td>Employer FICA${w.selfEmployedFica ? ' &mdash; none; a minister pays their own SECA' : ''}</td>${n(money(b.ficaCents))}</tr>`);
    rows.push(`<tr class="total"><td><b>Total church cost</b></td>${n(`<b>${money(c.churchCostCents)}</b>`)}</tr>`);
    return `<section class="report print-newpage" aria-label="${name}">
      ${renderSectionHeading({ eyebrow: escapeHtml(w.position || 'Worker'), heading: name, badge: escapeHtml(verdictText(v)) })}
      <div class="table-wrap"><table><tbody>${rows.join('')}</tbody></table></div>
      ${w.selfEmployedFica ? `<p><small>As a minister for Social Security purposes, ${escapeHtml(w.name || 'this worker')} pays the employer half of FICA themselves &mdash; ${money(b.secaSelfCents)} at this salary. That is not a church cost and is in no total above.</small></p>` : ''}
      ${rangeTable}
      <p>${read}</p>
    </section>`;
  }).join('');

  const healthPage = renderHealthPlanSection({ model, computed, totals });
  const refPage = renderReferenceSection({ model });

  return cover + workerPages + healthPage + refPage;
}

export function renderHealthPlanSection({ model, computed, totals }) {
  const planCalc = model.healthPlanTotal(model.plan.healthPlanOption);
  const selected = model.plan.healthPlanOption;
  const planRows = FIN_COMP_PLAN_KEYS.map((key) => {
    const calc = model.healthPlanTotal(key);
    if (!calc) return '';
    const label = key === selected ? `<b>${escapeHtml(calc.label)}</b> (selected)` : escapeHtml(calc.label);
    return `<tr><td>${label}</td>${FIN_HEALTH_TIERS.map((t) => n(moneyCents(model.tierMonthlyCents(key, t.key) || 0))).join('')}${n(money(calc.dentalCents))}${n(money(calc.visionCents))}${n(money(model.planQuoteField(key, 'deductibleFamilyCents')))}${n(money(model.planQuoteField(key, 'oopMaxFamilyCents')))}${n(`<b>${money(calc.totalCents)}</b>`)}${n(key === 'renewal' ? '&mdash;' : moneySigned(model.perHouseholdDiffCents('renewal', key)) + '/worker')}</tr>`;
  }).join('');
  const tierRows = model.roster.map((w, i) => {
    if (model.isExternallyFunded(w)) return '';
    const tier = model.healthTier(w);
    const rate = model.tierMonthlyCents(selected, tier);
    const basis = model.isCashOnly(w) ? 'Below the hours floor for the group plan'
      : tier === 'optout' ? 'Opt-out cash from this year&#39;s rates'
        : w.employeeOnlyPremiumCents != null ? 'Hand-entered premium'
          : `${moneyCents(rate || 0)}/mo &times; 12, plus a share of dental and vision`;
    return `<tr><td>${escapeHtml(w.name || '(unnamed)')}</td><td>${model.isCashOnly(w) ? `Not eligible &mdash; ${model.ftePct(w)}% time` : escapeHtml(healthTierLabel(tier))}</td>${n(money(computed[i].benefits.healthCents))}<td><small>${basis}</small></td></tr>`;
  }).join('');
  return `<section class="report print-newpage" aria-label="Group health plan">
    ${renderSectionHeading({ eyebrow: 'Benefits', heading: 'Group health plan' })}
    <div class="table-wrap"><table><thead><tr><th style="min-width:14rem">Option</th>${FIN_HEALTH_TIERS.map((t) => `<th class="num">${escapeHtml(t.label)} / mo</th>`).join('')}<th class="num">Dental</th><th class="num">Vision</th><th class="num">Family deductible</th><th class="num">Out-of-pocket max</th><th class="num">Total premium</th><th class="num">vs Renewal</th></tr></thead><tbody>${planRows}</tbody></table></div>
    <p>The church covers ${escapeHtml(planCalc ? planCalc.label : 'the selected plan')} in full. A worker who chooses another option pays the premium difference themselves &mdash; the last column above, per worker per year.</p>
    <div class="table-wrap"><table><thead><tr><th>Worker</th><th>Coverage</th><th class="num">Church cost</th><th>Basis</th></tr></thead><tbody>${tierRows}
      <tr class="total"><td colspan="2"><b>Total health cost</b></td>${n(money(totals.healthCents))}<td></td></tr></tbody></table></div>
  </section>`;

}

export function renderReferenceSection({ model }) {
  const planCalc = model.healthPlanTotal(model.plan.healthPlanOption);
  const pensionPct = pctFmt(model.pensionRate(model.targetYear).rate);
  const t = model.targetYear;
  const baseNow = model.baseSalary(t), basePrior = model.baseSalary(t - 1);
  const enrolled = model.enrolledCount();
  const refRows = [
    [`District base salary, FY${t}`, '$' + Number(baseNow.dollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), model.sourceDoc('districtSource'), basePrior.dollars ? `${moneySigned(Math.round((baseNow.dollars - basePrior.dollars) * 100))} from FY${t - 1}` : '&mdash;'],
    ['Concordia pension (Traditional)', pensionPct, model.sourceDoc('concordiaSource'), `${pctFmt(model.pensionRate(model.baseYear).rate)} in FY${model.baseYear}`],
    ['Disability &amp; survivor &mdash; with dependents', pctFmt(model.disabilityRate(t, true).rate), model.sourceDoc('concordiaSource'), ''],
    ['Disability &amp; survivor &mdash; without', pctFmt(model.disabilityRate(t, false).rate), model.sourceDoc('concordiaSource'), ''],
    ['Employer FICA', pctFmt(model.ficaRate()), 'IRS employer OASDI 6.20% + Medicare 1.45%', ''],
    ['Social Security COLA', pctFmt(model.ssaRate()), 'Social Security Administration, announced each October', ''],
    ['Health opt-out cash', money(model.optOutCents()), 'Set by the congregation', ''],
    ['Group health quote', `${money(planCalc ? planCalc.totalCents : 0)} over ${plural(enrolled, 'contract')}`, model.sourceDoc('quoteSource'), ''],
  ].map((r) => `<tr><td>${r[0]}</td>${n(`<b>${r[1]}</b>`)}<td><small>${escapeHtml(r[2])}</small></td><td><small>${r[3]}</small></td></tr>`).join('');
  const withReports = model.roster.filter((w) => model.usableRanges(w).length).length;
  return `<section class="report print-newpage" aria-label="Reference figures used">
    ${renderSectionHeading({ eyebrow: 'Sources', heading: 'Reference figures used' })}
    <div class="table-wrap"><table><thead><tr><th>Figure</th><th class="num">Value</th><th>Source document</th><th>Change</th></tr></thead><tbody>${refRows}</tbody></table></div>
    <p><small>${withReports} of ${model.roster.length} roster worker${model.roster.length === 1 ? ' has' : 's have'} a Concordia Plans Compensation Decision Support report on file. Where a worker has none, this plan is measured against the District Compensation Worksheet alone.</small></p>
    <p><small>Built from ${escapeHtml(model.sourceDoc('districtSource'))}, ${escapeHtml(model.sourceDoc('concordiaSource'))}, and ${escapeHtml(model.sourceDoc('quoteSource'))}.</small></p>
  </section>`;

}

function benefitBreakdownTable(model, computed) {
  const bd = model.benefitBreakdown(computed);
  return `<div class="table-wrap"><table><thead><tr><th>Cost</th><th class="num">Workers</th><th class="num">FY${model.targetYear}</th><th class="num">Share</th></tr></thead><tbody>
      ${bd.rows.map((r) => { const [label, note] = BREAKDOWN_LABELS[r.key](r); return `<tr><td>${label}<br><small>${note}</small></td>${n(`${r.people} of ${bd.countedCount}`)}${n(`<b>${money(r.cents)}</b>`)}${n(`${bd.totalCents ? Math.round(r.cents / bd.totalCents * 100) : 0}%`)}</tr>`; }).join('')}
      <tr class="total"><td><b>Total benefits &amp; taxes</b></td><td></td>${n(money(bd.totalCents))}${n('100%')}</tr>
    </tbody></table></div>`;
}

// Compensation → Benefits & taxes: the same figures as the Council report's benefits, health-plan
// and reference pages, per worker, from the saved plan and the LCMS/Concordia reference figures.
export function renderBenefitsTaxesPage({ model, computed, totals }) {
  if (!model.roster.length) return '<p>No compensation roster has been saved yet.</p>';
  const bd = model.benefitBreakdown(computed);
  const rows = model.roster.map((w, i) => {
    if (model.isExternallyFunded(w)) return '';
    const c = computed[i], b = c.benefits;
    return `<tr><td><b>${escapeHtml(w.name || '(unnamed)')}</b><br><small>${escapeHtml(w.position || '')}${b.cashOnly ? ` &middot; cash only, ${model.ftePct(w)}% time` : ''}</small></td>${n(money(c.salaryCents))}${n(money(b.pensionCents))}${n(money(b.healthCents))}${n(money(b.disabilityCents))}${n(money(b.ficaCents))}${n(`<b>${money(b.totalCents)}</b>`)}${n(money(c.churchCostCents))}</tr>`;
  }).join('');
  const sum = (key) => model.countedEntries().reduce((t, e) => t + computed[e.i].benefits[key], 0);
  const secaNote = bd.secaSelfCents ? `<p><small>Ministers pay the employer half of FICA themselves as SECA (${money(bd.secaSelfCents)} in total at these salaries). That is not a church cost and is in no total here.</small></p>` : '';
  return `<section class="report" aria-label="Benefits and taxes">
    ${renderSectionHeading({ eyebrow: `FY${model.targetYear} · from the saved plan`, heading: 'Benefits &amp; taxes by worker', badge: 'LCMS Missouri District · Concordia Plans' })}
    ${ledgerWarning(model)}
    ${renderKpiCards([
      { label: 'Benefits & taxes', value: money(totals.benefitsCents), hint: `${totals.totalCents ? Math.round(totals.benefitsCents / totals.totalCents * 100) : 0}% of total compensation` },
      { label: 'Concordia pension', value: pctFmt(model.pensionRate(model.targetYear).rate), hint: 'Retirement Plan, Traditional option' },
      { label: 'Health plan', value: money(totals.healthCents), hint: escapeHtml((model.healthPlanTotal(model.plan.healthPlanOption) || {}).label || 'No option selected') },
    ])}
    ${benefitBreakdownTable(model, computed)}
    <div class="table-wrap"><table><thead><tr><th style="min-width:11rem">Worker</th><th class="num">Cash salary</th><th class="num">Pension</th><th class="num">Health</th><th class="num">Disability</th><th class="num">Employer FICA</th><th class="num">Benefits &amp; taxes</th><th class="num">Church cost</th></tr></thead><tbody>${rows}
      <tr class="total"><td><b>Total</b></td>${n(money(totals.salaryCents))}${n(money(sum('pensionCents')))}${n(money(sum('healthCents')))}${n(money(sum('disabilityCents')))}${n(money(sum('ficaCents')))}${n(money(totals.benefitsCents))}${n(money(totals.totalCents))}</tr></tbody></table></div>
    ${secaNote}
  </section>
  ${renderHealthPlanSection({ model, computed, totals })}
  ${renderReferenceSection({ model })}`;
}

// Compensation → Benchmarks: each worker's proposed salary against the LCMS Missouri District
// worksheet figure and their Concordia Plans Compensation Decision Support ranges.
export function renderBenchmarksPage({ model, computed, totals }) {
  if (!model.roster.length) return '<p>No compensation roster has been saved yet.</p>';
  const med = model.medianTotal(computed);
  const gap = model.fullScaleGap(computed);
  const scaleRatio = totals.worksheetCents ? Math.round(totals.salaryCents / totals.worksheetCents * 100) : null;
  const rows = model.roster.map((w, i) => {
    if (model.isExternallyFunded(w)) return '';
    const c = computed[i];
    const scale = model.vsScale(c.salaryCents, c.worksheetCents);
    const v = model.verdict(w, c.salaryCents);
    const lcms = model.lcmsRange(w);
    return `<tr><td><b>${escapeHtml(w.name || '(unnamed)')}</b><br><small>${escapeHtml(w.position || '')} &middot; ${Number(w.yearsExperience) || 0} yrs</small></td>${n(`<b>${money(c.salaryCents)}</b>`)}${n(c.worksheetCents == null ? '&mdash;' : money(c.worksheetCents))}${n(scale.pct == null ? '&mdash;' : tone(scale.tone, `<b>${scale.pct}%</b>`))}${n(lcms ? `${money(lcms.lowCents)} &ndash; ${money(lcms.highCents)}` : '&mdash;')}${n(lcms && lcms.midCents ? money(lcms.midCents) : '&mdash;')}<td>${tone(v.tone, verdictText(v))}</td></tr>`;
  }).join('');
  const detail = model.roster.map((w, i) => {
    if (model.isExternallyFunded(w)) return '';
    const usable = model.usableRanges(w);
    if (!usable.length) return '';
    const c = computed[i];
    const asOf = (w.concordia && w.concordia.asOfDate) ? ` &middot; report run ${escapeHtml(w.concordia.asOfDate)}` : '';
    return `<details class="panel panel-spaced"><summary>${escapeHtml(w.name || '(unnamed)')} &mdash; Concordia Plans ranges${asOf}</summary>
      <div class="table-wrap"><table><thead><tr><th>Range</th><th class="num">Lower</th><th class="num">Midpoint</th><th class="num">Higher</th><th class="num">This plan vs. midpoint</th></tr></thead><tbody>${usable.map((r) => {
        const vs = r.midCents ? c.salaryCents - r.midCents : null;
        return `<tr><td>${escapeHtml(r.label)}</td>${n(money(r.lowCents))}${n(r.midCents ? money(r.midCents) : '&mdash;')}${n(money(r.highCents))}${n(vs == null ? '&mdash;' : moneySigned(vs))}</tr>`;
      }).join('')}</tbody></table></div></details>`;
  }).join('');
  const withReports = model.roster.filter((w) => !model.isExternallyFunded(w) && model.usableRanges(w).length).length;
  return `<section class="report" aria-label="Compensation benchmarks">
    ${renderSectionHeading({ eyebrow: `FY${model.targetYear} · from the saved plan`, heading: 'Salaries against the district scale and Concordia ranges', badge: 'LCMS Missouri District · Concordia Plans' })}
    ${ledgerWarning(model)}
    ${renderKpiCards([
      { label: 'Share of district scale', value: scaleRatio == null ? '&mdash;' : `${scaleRatio}%`, hint: `${money(totals.salaryCents)} of ${money(totals.worksheetCents)} on the district worksheet` },
      { label: 'Share of LCMS midpoints', value: med.pct == null ? '&mdash;' : `${med.pct}%`, hint: med.count ? `${plural(med.count, 'worker')} with a Concordia report` : 'No Concordia reports on file' },
      { label: 'Cost to reach full scale', value: money(gap.totalCents), hint: gap.totalCents ? `${money(gap.salaryGapCents)} salary + ${money(gap.benefitsGapCents)} benefits` : 'Everyone is at or above scale' },
    ])}
    <div class="table-wrap"><table><thead><tr><th style="min-width:11rem">Worker</th><th class="num">FY${model.targetYear} salary</th><th class="num">District worksheet</th><th class="num">% of scale</th><th class="num">Concordia LCMS range</th><th class="num">LCMS midpoint</th><th>Reading</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p><small>The district worksheet figure is the LCMS Missouri District Compensation Guidelines base salary for FY${model.targetYear} times each worker's role, education and experience multiplier. ${withReports} of ${model.countedEntries().length} workers have a Concordia Plans Compensation Decision Support report on file; when a report is re-run, update its figures in Connect's Compensation planner.</small></p>
  </section>
  ${detail}`;
}
