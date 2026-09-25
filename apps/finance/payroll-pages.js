// Payroll, v3 design: five pages over the same live workspace payroll-section.js loads through
// Website's payroll relay -- Run payroll, Staff entry, Import from MDO, Email / print, History.
// Rendering only: every read and write is still the existing payroll_* relay (Finance stores no
// payroll data), and every form posts to the existing payroll routes.
import {
  calcGross, calcMdoGross, effectiveChurch, effectiveMdo, exportReport, fromCents, cents, money, hrs, takesPto,
  missingHours as computeMissingHours, payablePeople, reportGroups, subtotal,
} from './payroll-calc.js';
import { periodLabel, paysOnLabel } from './payroll-periods.js';
import { renderLayoutTabs, renderReportBody, renderPrintTable } from './payroll-report-render.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function e(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return [...String(value ?? '')].map((c) => entities[c] || c).join('');
}

export function payrollHref(page, params = {}) {
  const search = new URLSearchParams({ section: 'payroll', page, ...params });
  return `/?${search.toString().replace(/&/g, '&amp;')}`;
}

const LEGACY_VIEW_PAGES = { entry: 'run', report: 'report', 'staff-form': 'staff' };

// Older links (and bookmarks) used ?view=entry|report|staff-form with no page.
export function legacyPayrollPage(view) {
  return LEGACY_VIEW_PAGES[view] || null;
}

function dayLabel(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return y ? `${MONTHS[m - 1]} ${d}, ${y}` : '—';
}

function totalsFor(workspace) {
  const approved = !!workspace.periodApproval;
  const groups = reportGroups({ ...workspace, periodApproved: approved });
  const church = subtotal(groups[0].people);
  const mdo = subtotal(groups[1].people);
  return { approved, groups, church, mdo, total: fromCents(cents(church) + cents(mdo)) };
}

function mdoState(workspace) {
  if (workspace.mdoError) return { label: 'Unavailable', tone: 'bad', detail: 'The MDO app could not be reached' };
  if (workspace.mdoPeriodApproval) return { label: 'Approved', tone: 'good', detail: `Approved in myMDO by ${workspace.mdoPeriodApproval.approved_by}` };
  return { label: 'Read live', tone: 'warn', detail: 'Not yet approved in myMDO' };
}

function periodPicker(periods, period, page, extra = {}) {
  const options = periods.map((p) => `<option value="${e(p.start)}"${p.start === period.start ? ' selected' : ''}>${e(periodLabel(p.start, p.end))}</option>`).join('');
  return `<form method="GET" action="/" class="pay-period-form">
    <input type="hidden" name="section" value="payroll"><input type="hidden" name="page" value="${e(page)}">
    ${Object.entries(extra).map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('')}
    <label for="pay-period">Pay period</label>
    <span class="pay-period-row"><select id="pay-period" name="period">${options}</select><button type="submit">Go</button></span>
  </form>`;
}

function hero(bundle, page, totals) {
  const { periods, period, workspace } = bundle;
  const mdo = mdoState(workspace);
  return `<div class="pay-hero">
    ${periodPicker(periods, period, page)}
    <div><small>Pay date</small><b>${e(paysOnLabel(period.end).replace('Pays ', ''))}</b></div>
    <div><small>MDO</small><b>${workspace.mdoError ? 'Unavailable' : money(totals.mdo)}</b></div>
    <div><small>Church</small><b>${money(totals.church)}</b></div>
    <div><small>Total gross</small><b>${money(totals.total)}</b></div>
    <span class="pay-hero-pill ${totals.approved ? 'is-approved' : ''}">${totals.approved ? 'Approved' : 'Draft'}</span>
  </div>
  ${workspace.mdoError ? `<p class="status status-error">${e(mdo.detail)}, so no childcare pay is included — this period is incomplete until it can be read.</p>` : ''}`;
}

function banners(bundle) {
  const { statusMsg, workspace } = bundle;
  return `${statusMsg ? `<p class="status${/did not save/.test(statusMsg) ? ' status-error' : ''}">${e(statusMsg)}</p>` : ''}
    ${workspace.staffError ? `<p class="status status-error">Church staff could not be read: ${e(workspace.staffError)}</p>` : ''}`;
}

// ── Run payroll ───────────────────────────────────────────────────────────────────────────────

function steps(bundle, totals) {
  const { workspace } = bundle;
  const missing = computeMissingHours(workspace.churchStaff, workspace.periodEntries);
  const mdo = mdoState(workspace);
  const list = [
    ['Staff entry', `${workspace.churchStaff.length} church staff on file`, workspace.churchStaff.length > 0, 'staff'],
    ['Import from MDO', `${mdo.label}${workspace.mdoError ? '' : ` · ${workspace.mdoStaff.length} staff`}`, !workspace.mdoError && !!workspace.mdoPeriodApproval, 'mdo'],
    ['Hours & PTO', workspace.staffError ? 'Church staff could not be read' : missing.length ? `${missing.length} hourly staff missing hours` : 'All hourly hours entered', !workspace.staffError && missing.length === 0, 'run'],
    ['Approve period', totals.approved ? 'Approved' : 'Not approved', totals.approved, 'run'],
    ['Email / print', totals.approved ? 'Ready to send' : 'After approval', false, 'report'],
  ];
  return `<ol class="pay-steps">${list.map(([title, note, done, page], i) => `<li class="${done ? 'is-done' : ''}"><a href="${payrollHref(page, { period: bundle.period.start })}"><span class="pay-step-num">${done ? '✓' : i + 1}</span><span><b>${e(title)}</b><small>${e(note)}</small></span></a></li>`).join('')}</ol>`;
}

function salariedSummary(s) {
  const parts = [`Base ${money(s.base_salary_biweekly)}`];
  if (Number(s.housing_allowance_biweekly) > 0) parts.push(`housing ${money(s.housing_allowance_biweekly)}`);
  if (Number(s.insurance_opt_out_biweekly) > 0) parts.push(`opt-out ${money(s.insurance_opt_out_biweekly)}`);
  if (Number(s.hsa_contribution_biweekly) > 0) parts.push(`HSA ${money(s.hsa_contribution_biweekly)}`);
  if (Number(s.mileage_biweekly) > 0) parts.push(`mileage ${money(s.mileage_biweekly)}`);
  if (Number(s.retirement_403b_amount) > 0) parts.push(`403(b) ${s.retirement_403b_type === 'percent' ? `${(s.retirement_403b_amount * 100).toFixed(2).replace(/\.?0+$/, '')}%` : money(s.retirement_403b_amount)}`);
  return parts.join(' · ');
}

function renderRun(bundle) {
  const { period, workspace, needsConfirm } = bundle;
  const totals = totalsFor(workspace);
  const { approved } = totals;
  const lock = approved ? ' readonly title="Approved — take back the approval to change hours"' : '';
  const hourly = workspace.churchStaff.filter((s) => s.pay_type !== 'salary');
  const salaried = workspace.churchStaff.filter((s) => s.pay_type === 'salary');
  const missing = computeMissingHours(workspace.churchStaff, workspace.periodEntries);
  const people = payablePeople(workspace.churchStaff, workspace.mdoStaff, workspace.mdoHoursMap, workspace.mdoPtoMap);

  const hourlyRows = hourly.map((s) => {
    const entry = workspace.periodEntries.get(s.id) || {};
    const eff = effectiveChurch(s, entry, approved);
    const noHours = !(Number(entry.hours_worked) > 0);
    return `<tr class="${noHours ? 'row-alert' : ''}">
      <td><b>${e(s.name)}</b>${noHours ? '<small class="tone-bad">No hours entered · won’t be paid</small>' : `<small>${e(s.role || 'Church staff')}</small>`}</td>
      <td>${money(eff.hourly_rate)}/hr</td>
      <td><input class="pay-in" type="number" min="0" step="0.25" name="hours_${e(s.id)}" value="${e(entry.hours_worked ?? '')}"${lock} aria-label="Hours worked by ${e(s.name)}"></td>
      <td>${takesPto(s.pay_type) ? `<input class="pay-in" type="number" min="0" step="0.25" name="pto_${e(s.id)}" value="${e(entry.pto_hours_used ?? '')}"${lock} aria-label="PTO used by ${e(s.name)}">` : '—'}</td>
      <td><b>${money(calcGross(eff, entry))}</b></td>
    </tr>`;
  }).join('');

  const salariedRows = salaried.map((s) => {
    const entry = workspace.periodEntries.get(s.id) || {};
    const eff = effectiveChurch(s, entry, approved);
    return `<li><div><b>${e(s.name)}</b><small>${e(salariedSummary(eff))}</small></div><b>${money(calcGross(eff, entry))}</b></li>`;
  }).join('');

  const confirmBanner = needsConfirm && missing.length && !approved ? `<div class="pay-warn">
      <p>${missing.length} ${missing.length === 1 ? 'person has' : 'people have'} no hours entered — ${e(missing.map((m) => m.name).join(', '))}.</p>
      <form method="POST" action="/api/v1/payroll-period-approve"><input type="hidden" name="period" value="${e(period.start)}"><input type="hidden" name="action" value="approve"><input type="hidden" name="confirm_missing" value="1"><button type="submit">Approve the period anyway</button></form>
    </div>` : '';

  const notes = [];
  if (workspace.mdoError) notes.push('<span class="tone-bad">Childcare hours could not be read — the period is incomplete.</span>');
  else if (!workspace.mdoPeriodApproval) notes.push('<span class="tone-warn">MDO hours are not yet approved in myMDO.</span>');
  if (missing.length) notes.push(`${e(missing.map((m) => m.name).join(', '))} ${missing.length === 1 ? 'has' : 'have'} no hours for this period and won’t be paid.`);
  const approvedLine = approved && workspace.periodApproval ? `Approved${workspace.periodApproval.approved_by ? ` by ${e(workspace.periodApproval.approved_by)}` : ''}${workspace.periodApproval.approved_at ? ` on ${e(dayLabel(workspace.periodApproval.approved_at))}` : ''}.` : '';

  return `${hero(bundle, 'run', totals)}
    ${steps(bundle, totals)}
    ${banners(bundle)}
    <div class="panel-grid pay-run-grid">
      <div class="panel">
        <div class="panel-head"><h2>Hours &amp; PTO · hourly church staff</h2><span class="muted">Biweekly · ${e(periodLabel(period.start, period.end))}</span></div>
        ${hourly.length ? `<form method="POST" action="/api/v1/payroll-hours-save">
          <input type="hidden" name="period" value="${e(period.start)}">
          <div class="table-scroll"><table class="pm-table pay-table"><thead><tr><th>Staff</th><th>Rate</th><th>Hours</th><th>PTO hrs</th><th>Gross</th></tr></thead><tbody>${hourlyRows}</tbody></table></div>
          ${approved ? '' : '<button type="submit">Save hours</button>'}
        </form>` : '<p class="muted-line">No hourly church staff.</p>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Salaried church staff</h2><a href="${payrollHref('staff')}">Staff entry</a></div>
        ${salaried.length ? `<ul class="pay-salaried">${salariedRows}</ul>` : '<p class="muted-line">No salaried church staff.</p>'}
        <p class="muted-line">Salaried staff are paid their standing amounts; nothing to enter unless something changed.</p>
      </div>
    </div>
    <div class="panel panel-spaced pay-approve-card">
      <div><h2>${approved ? 'Period approved' : 'Approve this period'}</h2>
        ${approved ? `<p class="muted-line">${approvedLine} Hours are locked; the report is ready on Email / print.</p>` : notes.map((n) => `<p class="muted-line">${n}</p>`).join('') || '<p class="muted-line">Everything is entered. Approving freezes rates and totals for this period.</p>'}
      </div>
      <form method="POST" action="/api/v1/payroll-period-approve">
        <input type="hidden" name="period" value="${e(period.start)}"><input type="hidden" name="action" value="${approved ? 'unapprove' : 'approve'}">
        ${approved ? '<label class="check"><input type="checkbox" name="confirm_unapprove" value="1" required> I understand this reopens hours entry for this period</label>' : ''}
        <button type="submit" class="pay-approve${approved ? ' is-done' : ''}"${!people ? ' disabled' : ''}>${approved ? 'Take back approval' : 'Approve period'}</button>
      </form>
    </div>
    ${confirmBanner}`;
}

// ── Staff entry ───────────────────────────────────────────────────────────────────────────────

function renderStaff(bundle, renderStaffForm) {
  const { workspace, view, staffFormId, staffFormError } = bundle;
  if (view === 'staff-form') {
    return `<p class="crumb"><a href="${payrollHref('staff')}">Church staff</a></p><div class="panel">${renderStaffForm({ id: staffFormId, churchStaff: workspace.churchStaff, formError: staffFormError })}</div>`;
  }
  const dash = (v) => (Number(v) > 0 ? money(v) : '—');
  const rows = workspace.churchStaff.map((s) => `<tr>
    <td><a href="${payrollHref('staff', { view: 'staff-form', id: String(s.id) })}">${e(s.name)}</a>${s.role ? `<small>${e(s.role)}</small>` : ''}</td>
    <td>${s.pay_type === 'salary' ? 'Salary' : 'Hourly'}</td>
    <td>${s.pay_type === 'salary' ? money(s.base_salary_biweekly) : `${money(s.hourly_rate)}/hr`}</td>
    <td>${dash(s.housing_allowance_biweekly)}</td><td>${dash(s.insurance_opt_out_biweekly)}</td><td>${dash(s.hsa_contribution_biweekly)}</td><td>${dash(s.mileage_biweekly)}</td>
    <td>${Number(s.retirement_403b_amount) > 0 ? (s.retirement_403b_type === 'percent' ? `${(s.retirement_403b_amount * 100).toFixed(2).replace(/\.?0+$/, '')}%` : money(s.retirement_403b_amount)) : '—'}</td>
  </tr>`).join('');
  return `${banners(bundle)}
    <div class="panel">
      <div class="panel-head"><h2>Church staff</h2><a class="button-outline pay-add" href="${payrollHref('staff', { view: 'staff-form', id: 'new' })}">Add staff</a></div>
      ${workspace.churchStaff.length ? `<div class="table-scroll"><table class="pm-table pay-table"><thead><tr><th>Staff</th><th>Pay type</th><th>Rate / salary</th><th>Housing</th><th>Opt-out</th><th>HSA</th><th>Mileage</th><th>403(b)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted-line">No church staff on file yet.</p>'}
      <p class="muted-line">Biweekly amounts. MDO staff and their rates are managed in the MDO app and read each period; they can’t be edited here.</p>
    </div>`;
}

// ── Import from MDO ───────────────────────────────────────────────────────────────────────────

function renderMdo(bundle) {
  const { period, workspace } = bundle;
  const totals = totalsFor(workspace);
  const mdo = mdoState(workspace);
  const rows = workspace.mdoStaff.map((s) => {
    const eff = effectiveMdo(s, workspace.mdoRateSnapshot.get(s.id), totals.approved);
    const salary = eff.pay_type === 'salary';
    const h = workspace.mdoHoursMap.get(s.id) || 0;
    const pto = workspace.mdoPtoMap.get(s.id) || 0;
    return `<tr><td><b>${e(s.name)}</b>${s.role ? `<small>${e(s.role)}</small>` : ''}</td><td>${salary ? 'Salary' : 'Hourly'}</td>
      <td>${salary ? money(eff.salary_biweekly) : `${money(eff.hourly_rate)}/hr`}</td><td>${salary ? '—' : e(hrs(h))}</td><td>${salary ? '—' : e(hrs(pto))}</td>
      <td><b>${money(calcMdoGross(eff, h, pto))}</b></td></tr>`;
  }).join('');
  return `${hero(bundle, 'mdo', totals)}
    ${banners(bundle)}
    <div class="panel pay-approve-card">
      <div><h2>Timothy MDO app · clock-ins, manual hours and PTO</h2>
      <p class="muted-line">Read live from myMDO every time this page opens for ${e(periodLabel(period.start, period.end))} — there is nothing to copy by hand. Rates stay in the MDO app${totals.approved ? ' and were frozen when this period was approved' : ''}.</p></div>
      <span class="pill pill-${mdo.tone}">${e(mdo.detail)}</span>
    </div>
    <div class="panel panel-spaced">
      <div class="panel-head"><h2>MDO staff this period</h2><span class="muted">Rates come from the MDO app · read-only</span></div>
      ${workspace.mdoError ? '<p class="muted-line">Unavailable until the MDO app can be reached.</p>' : workspace.mdoStaff.length ? `<div class="table-scroll"><table class="pm-table pay-table"><thead><tr><th>Staff</th><th>Pay type</th><th>Rate</th><th>Hours</th><th>PTO</th><th>Gross</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5"><b>MDO total</b></td><td><b>${money(totals.mdo)}</b></td></tr></tfoot></table></div>` : '<p class="muted-line">No childcare staff found for this period.</p>'}
    </div>`;
}

// ── Email / print ─────────────────────────────────────────────────────────────────────────────

function renderReport(bundle) {
  const { periods, period, workspace, layout, alreadySent } = bundle;
  const totals = totalsFor(workspace);
  const lbl = periodLabel(period.start, period.end);
  const report = exportReport({
    periodStart: period.start, periodEnd: period.end, periodLabel: lbl, ...workspace,
    periodApproved: totals.approved, incomplete: !!workspace.mdoError,
  });
  const incompleteNote = workspace.mdoError ? 'The childcare app could not be reached, so no MDO staff are in this report. Do not send it to the payroll service until it can be read.' : '';
  const resend = alreadySent ? `<div class="pay-warn">
      <p>This period was already emailed to ${e(alreadySent.to || 'the bookkeeper')}${alreadySent.at ? ` on ${e(new Date(alreadySent.at).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}.</p>
      <form method="POST" action="/api/v1/payroll-email"><input type="hidden" name="period" value="${e(period.start)}"><input type="hidden" name="force" value="1"><button type="submit">Send it again</button></form>
    </div>` : '';
  return `<div class="pay-report-bar">${periodPicker(periods, period, 'report', { layout })}
      <div class="pay-actions">
        <form method="POST" action="/api/v1/payroll-email"><input type="hidden" name="period" value="${e(period.start)}"><button type="submit"${totals.approved ? '' : ' class="button-outline"'}>Email report</button></form>
        <a class="button-outline pay-add" href="/api/v1/payroll-csv?period=${encodeURIComponent(period.start)}">Export CSV</a>
      </div></div>
    ${banners(bundle)}
    ${totals.approved ? '' : '<p class="status status-pending">This period is not approved yet — the report shows current rates and may still change.</p>'}
    ${resend}
    ${renderLayoutTabs(layout, period.start)}
    <div>${renderReportBody(totals.groups, layout, lbl, incompleteNote)}</div>
    <div id="pay-print">${renderPrintTable(report)}</div>
    <p class="muted-line">To print, use your browser’s Print command — the printout uses the payroll-service layout.</p>`;
}

// ── History ───────────────────────────────────────────────────────────────────────────────────

function renderHistory(bundle) {
  const { yearTotals, periods, year } = bundle;
  if (!yearTotals.ok) {
    return `<p class="status status-error">Payroll history could not be read: ${e(yearTotals.message)}. Nothing here is a real $0.</p>`;
  }
  const approved = yearTotals.rows.filter((r) => r.total_gross_cents !== null && r.total_gross_cents !== undefined);
  const totalCents = approved.reduce((n, r) => n + Number(r.total_gross_cents || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const next = periods.find((p) => p.end >= today);
  const byStart = new Map(periods.map((p) => [p.start, p]));
  const rows = [...yearTotals.rows].reverse().map((r) => {
    const start = String(r.period_start).slice(0, 10);
    const p = byStart.get(start);
    return `<tr><td>${p ? e(paysOnLabel(p.end).replace('Pays ', '')) : '—'}</td><td>${p ? e(periodLabel(p.start, p.end)) : e(start)}</td>
      <td>${r.approved_by ? e(r.approved_by) : '—'}${r.approved_at ? `<small>${e(dayLabel(r.approved_at))}</small>` : ''}</td>
      <td><b>${r.total_gross_cents === null || r.total_gross_cents === undefined ? '<span class="tone-muted">Not yet stamped</span>' : money(fromCents(Number(r.total_gross_cents)))}</b></td>
      <td><a href="${payrollHref('report', { period: start })}">Open report</a></td></tr>`;
  }).join('');
  const kpi = (label, value, note) => `<div class="card"><small>${e(label)}</small><strong>${value}</strong><span>${note}</span></div>`;
  return `<div class="grid">
      ${kpi(`Gross wages ${year}`, money(fromCents(totalCents)), `${approved.length} approved period${approved.length === 1 ? '' : 's'} · biweekly`)}
      ${kpi('Average per period', approved.length ? money(fromCents(Math.round(totalCents / approved.length))) : '—', 'Church and MDO, before withholding')}
      ${kpi('Next payroll', next ? e(paysOnLabel(next.end).replace('Pays ', '')) : '—', next ? e(periodLabel(next.start, next.end)) : '')}
    </div>
    <div class="panel panel-spaced">
      <div class="panel-head"><h2>Approved payrolls, ${year}</h2><span class="muted">Totals frozen at approval</span></div>
      ${rows ? `<div class="table-scroll"><table class="pm-table pay-table"><thead><tr><th>Pay date</th><th>Period</th><th>Approved</th><th>Gross</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted-line">Nothing approved yet this year.</p>'}
      <p class="muted-line">Withholding, employer taxes and net pay are calculated by the payroll service and are not shown here.</p>
    </div>`;
}

export function renderPayrollPage(bundle, { renderStaffForm }) {
  const body = bundle.page === 'staff' ? renderStaff(bundle, renderStaffForm)
    : bundle.page === 'mdo' ? renderMdo(bundle)
      : bundle.page === 'report' ? renderReport(bundle)
        : bundle.page === 'history' ? renderHistory(bundle)
          : renderRun(bundle);
  return `<section aria-label="Payroll" class="payroll">${body}</section>`;
}

export const PAYROLL_STYLES = `
    .pay-hero { display:flex; flex-wrap:wrap; align-items:flex-end; gap:22px 32px; margin-top:18px; padding:20px 22px; border-radius:10px; background:var(--navy); color:#fff; position:relative; }
    .pay-hero small { display:block; color:#C9D2E2; font-size:13px; }
    .pay-hero b { display:block; font-family:"Outfit",sans-serif; font-weight:500; font-size:24px; }
    .pay-hero .pay-period-form { margin:0; }
    .pay-hero label { color:#C9D2E2; font-weight:400; font-size:13px; }
    .pay-period-row { display:flex; gap:6px; margin-top:4px; }
    .pay-period-row button { margin:0; padding:7px 12px; }
    .pay-hero .pay-period-row button { background:var(--gold); color:#1B1608; }
    .pay-hero-pill { position:absolute; right:18px; bottom:18px; padding:3px 10px; border-radius:999px; background:var(--cream); color:var(--gold-ink); font-size:12px; font-weight:600; }
    .pay-hero-pill.is-approved { background:#E6F2EC; color:var(--green); }
    .pay-steps { list-style:none; display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin:14px 0 0; padding:0; }
    .pay-steps a { display:flex; gap:12px; align-items:center; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:#fff; color:var(--ink); text-decoration:none; }
    .pay-steps a:hover { border-color:#C9D0DC; }
    .pay-steps b { display:block; font-size:14px; font-weight:600; }
    .pay-steps small { display:block; color:var(--muted); font-size:12px; }
    .pay-step-num { width:26px; height:26px; flex:0 0 auto; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--page); color:var(--muted); font-size:12px; font-weight:600; }
    .pay-steps .is-done .pay-step-num { background:var(--green); color:#fff; }
    .pay-steps .is-done small { color:var(--green); }
    .pay-table td small { display:block; color:var(--muted); font-size:12px; }
    .pay-table .row-alert td { background:#FBF1EE; }
    .pay-table tfoot td { border-top:1px solid var(--line); }
    .pay-salaried { list-style:none; margin:0; padding:0; }
    .pay-salaried li { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line-soft); }
    .pay-salaried small { display:block; color:var(--muted); font-size:12px; margin-top:2px; }
    .pay-approve-card { display:flex; flex-direction:row; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .pay-run-grid { grid-template-columns:minmax(0,1.45fr) minmax(0,1fr); }
    @media(max-width:1000px){ .pay-run-grid{grid-template-columns:1fr} }
    .pay-table td:first-child { min-width:9rem; }
    .pay-approve-card > div { flex:1 1 320px; }
    .pay-approve-card h2 { margin:0 0 4px; }
    .pay-approve-card form { margin:0; display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
    .pay-approve-card button { margin:0; }
    .pay-add { display:inline-block; text-decoration:none; border-radius:8px; }
    .pay-report-bar { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-top:16px; }
    .pay-report-bar .pay-period-form { margin:0; }
    .pay-actions { display:flex; gap:10px; align-items:center; }
    .pay-actions form { margin:0; }
    .pay-actions button { margin:0; }
`;
