// ── FINANCE'S PAYROLL SCREEN — full parity with Website's admin/payroll.html,
//    rebuilt as server-rendered forms because Finance's CSP forbids all
//    client-side script (see shell.js's SECURITY_HEADERS). Every read and
//    write goes through the SAME payroll_* RPC relay Website's own screen
//    uses (payroll-proxy-client.js / resolvePayrollContractCaller on
//    Website's side) — Finance never stores payroll data of its own.
//    Emailing the report relays to Website's own /payroll/email route
//    (payroll-email-client.js) the same way, now that it accepts Finance's
//    contract-relay identity too (timothystl/website PR #587).
//
// NOT ported in this pass (needs a THIRD Website route extended the same
// way, which is separate, cross-repo work):
//   - The "payroll ready" push notification (Website's /api/push/payroll-ready)
// Printing has no button here (Finance has no script to call window.print());
// the print CSS (#pay-print, @media print in shell.js) works with the
// browser's own print command regardless of how it is invoked.
import { callPayrollProxy } from './payroll-proxy-client.js';
import { postPayrollEmailReport } from './payroll-email-client.js';
import {
  cents, fromCents, money, hrs, takesPto,
  effectiveChurch, mergeMdoHours, mdoPtoMapFrom, mdoRateSnapshotMapFrom,
  reportGroups, subtotal, exportReport, missingHours as computeMissingHours, payablePeople,
} from './payroll-calc.js';
import { buildPayrollPeriods, defaultPeriodStart, findPeriod, periodLabel, paysOnLabel } from './payroll-periods.js';
import { renderLayoutTabs, renderReportBody, renderPrintTable, buildPayrollCsv } from './payroll-report-render.js';

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return [...String(value)].map((character) => entities[character] || character).join('');
}

function rows(result) {
  return result?.ok && Array.isArray(result.result) ? result.result : [];
}
function row0(result) {
  return rows(result)[0] || null;
}

// A display-only label for payroll_approve_period's p_approved_by -- who this looks like,
// read directly (and unverified, by Finance's own side) off the incoming Access JWT.
// Safe for this one purpose even though Finance never independently checks the signature:
// Website's own resolvePayrollContractCaller() re-verifies the SAME token before the write
// is ever allowed to run at all, so either the token is genuine (making this label accurate)
// or the whole call is rejected before any RPC executes -- there is no path where a forged
// token gets its claimed email stored as who approved a real payroll run. Unlike
// describeIncomingAccessJwt() (jwt-decode-unsafe.js), which deliberately withholds the email
// because that diagnostic route is reachable by anyone who can already view the page.
export function approverEmailFromJwt(accessJwt) {
  const parts = (accessJwt || '').split('.');
  if (parts.length !== 3) return '';
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

export function resolvePayrollPeriod(periodParam) {
  const periods = buildPayrollPeriods();
  const start = periodParam && findPeriod(periods, periodParam) ? periodParam : defaultPeriodStart(periods);
  const period = findPeriod(periods, start) || periods[periods.length - 1];
  return { periods, period };
}

// One aggregated read of everything the entry/report views need for a period,
// mirroring Website's onPeriodChange()/loadMdoData(). Every RPC call is
// independent and fails soft (an error on one relay call does not stop the
// others) -- a single unreachable table must not blank the whole screen.
export async function loadPayrollWorkspace(env, accessJwt, periodStart, periodEnd) {
  const call = (fn, params) => callPayrollProxy(env, accessJwt, fn, params);
  const [staffRes, entriesRes, approvalRes, mdoApprovalRes, mdoSnapRes, priorPtoRes,
    mdoStaffRes, mdoHoursRes, mdoClockRes, mdoPtoRes] = await Promise.all([
    call('payroll_get_staff', {}),
    call('payroll_get_period_entries', { p_period_start: periodStart }),
    call('payroll_get_period_approval', { p_period_start: periodStart }),
    call('payroll_get_mdo_period_approval', { p_period_start: periodStart }),
    call('payroll_get_mdo_rate_snapshot', { p_period_start: periodStart }),
    call('payroll_get_prior_pto', { p_period_start: periodStart }),
    call('payroll_get_mdo_staff', {}),
    call('payroll_get_mdo_hours', { p_start: periodStart, p_end: periodEnd }),
    call('payroll_get_mdo_clock_events', { p_start: periodStart, p_end: periodEnd }),
    call('payroll_get_mdo_pto', { p_period_start: periodStart }),
  ]);

  const churchStaff = rows(staffRes);
  const periodEntries = new Map(rows(entriesRes).map((e) => [e.staff_id, e]));
  const periodApproval = row0(approvalRes);
  const mdoPeriodApproval = row0(mdoApprovalRes);
  const mdoRateSnapshot = mdoRateSnapshotMapFrom(rows(mdoSnapRes));

  const priorPto = {};
  for (const e of rows(priorPtoRes)) {
    if (!priorPto[e.staff_id]) priorPto[e.staff_id] = { earned: 0, used: 0 };
    priorPto[e.staff_id].earned += Number(e.pto_hours_earned);
    priorPto[e.staff_id].used += Number(e.pto_hours_used);
  }

  // A failed MDO query used to be swallowed by `|| []` on Website (PY-9) --
  // a payroll run would quietly under-report childcare staff. Surfaced here
  // the same explicit way: any one of the four MDO calls failing marks the
  // whole MDO read incomplete rather than silently showing an empty roster.
  const mdoFailed = [mdoStaffRes, mdoHoursRes, mdoClockRes, mdoPtoRes].find((r) => !r.ok);
  const mdoStaff = mdoFailed ? [] : rows(mdoStaffRes);
  const mdoHoursMap = mdoFailed ? new Map() : mergeMdoHours(rows(mdoHoursRes), rows(mdoClockRes));
  const mdoPtoMap = mdoFailed ? new Map() : mdoPtoMapFrom(rows(mdoPtoRes));
  const mdoError = mdoFailed ? (mdoFailed.message || mdoFailed.reason || 'The childcare app could not be reached.') : '';

  const staffError = !staffRes.ok ? (staffRes.message || staffRes.reason) : '';

  return {
    churchStaff, periodEntries, periodApproval, mdoPeriodApproval, mdoRateSnapshot, priorPto,
    mdoStaff, mdoHoursMap, mdoPtoMap, mdoError, staffError,
  };
}

export async function loadYearToDate(env, accessJwt, year) {
  const result = await callPayrollProxy(env, accessJwt, 'payroll_get_year_totals', { p_year: year });
  if (!result.ok) return `Year to date: could not be read — ${result.message || result.reason}.`;
  const totals = rows(result).filter((r) => r.total_gross_cents !== null && r.total_gross_cents !== undefined);
  if (!totals.length) return `Year to date, ${year}: nothing approved yet.`;
  const total = fromCents(totals.reduce((n, r) => n + Number(r.total_gross_cents || 0), 0));
  return `Year to date, ${year}: ${money(total)} across ${totals.length} approved period${totals.length === 1 ? '' : 's'}.`;
}

// A period approved before the rate-freeze fix shipped on Website may have a
// real, signed-off total that was never stamped onto total_gross_cents --
// healed here the first time anybody opens that period, from the SAME
// reportGroups()/subtotal() the report renders, written with
// payroll_backfill_total, which only ever fills a currently-null column.
export async function healMissingTotal(env, accessJwt, periodStart, workspace) {
  if (!workspace.periodApproval || workspace.periodApproval.total_gross_cents != null) return workspace.periodApproval;
  const groups = reportGroups({
    churchStaff: workspace.churchStaff, periodEntries: workspace.periodEntries,
    mdoStaff: workspace.mdoStaff, mdoHoursMap: workspace.mdoHoursMap, mdoPtoMap: workspace.mdoPtoMap,
    mdoRateSnapshot: workspace.mdoRateSnapshot, periodApproved: true,
  });
  const healedCents = cents(groups.reduce((n, g) => n + fromCents(cents(subtotal(g.people))), 0));
  const result = await callPayrollProxy(env, accessJwt, 'payroll_backfill_total', { p_period_start: periodStart, p_total_gross_cents: healedCents });
  if (!result.ok) return workspace.periodApproval;
  return { ...workspace.periodApproval, total_gross_cents: healedCents };
}

function pillHtml(tone, label) {
  return `<span class="pay-pill pay-pill-${tone}">${escapeHtml(label)}</span>`;
}

function entryStatus(kind, hoursEntered, approved) {
  if (kind === 'hourly' && !hoursEntered) return { tone: 'warn', label: 'Needs hours' };
  if (approved) return { tone: 'good', label: 'Approved' };
  return { tone: 'plain', label: 'Ready' };
}

function periodPickerHtml(periods, period, view, layout) {
  const options = periods.map((p) => `<option value="${escapeHtml(p.start)}"${p.start === period.start ? ' selected' : ''}>${escapeHtml(periodLabel(p.start, p.end))}</option>`).join('');
  return `<form method="GET" action="/">
    <input type="hidden" name="section" value="payroll">
    <input type="hidden" name="view" value="${escapeHtml(view)}">
    ${layout ? `<input type="hidden" name="layout" value="${escapeHtml(layout)}">` : ''}
    <div class="field"><label for="pay-period">Pay period</label>
      <span style="display:flex;gap:.5rem;align-items:center;"><select id="pay-period" name="period">${options}</select>
      <button type="submit" style="margin-top:0;">Go</button></span>
    </div>
  </form>`;
}

function viewTabsHtml(period, view) {
  return `<nav aria-label="Payroll view">
    <a href="/?section=payroll&period=${encodeURIComponent(period.start)}&view=entry"${view === 'entry' ? ' aria-current="page"' : ''}>Enter &amp; approve</a>
    <a href="/?section=payroll&period=${encodeURIComponent(period.start)}&view=report"${view === 'report' ? ' aria-current="page"' : ''}>Report</a>
  </nav>`;
}

export function renderPayrollToolbar(periods, period, view, ytdLine) {
  return `<p><small>${escapeHtml(ytdLine)}</small></p>
    ${periodPickerHtml(periods, period, view)}
    ${viewTabsHtml(period, view)}`;
}

function approvalLine(periodApproval) {
  if (!periodApproval) return '';
  const when = periodApproval.approved_at ? new Date(periodApproval.approved_at) : null;
  const stamp = when && !isNaN(when)
    ? when.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + ' at ' + when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  return `Approved${periodApproval.approved_by ? ' by ' + escapeHtml(periodApproval.approved_by) : ''}${stamp ? ' on ' + stamp : ''}.`;
}

// ── ENTRY & APPROVE VIEW ────────────────────────────────────────────────────
export function renderEntryView({ period, periods, workspace, statusMsg, needsConfirm, alreadySent }) {
  const { churchStaff, periodEntries, periodApproval, mdoStaff, mdoHoursMap, mdoPtoMap, mdoPeriodApproval, mdoError, staffError } = workspace;
  const approved = !!periodApproval;
  const lockAttr = approved ? ' readonly title="Approved — take back the approval to change hours"' : '';

  const churchRows = churchStaff.map((s) => {
    const entry = periodEntries.get(s.id) || {};
    const isSalary = s.pay_type === 'salary';
    const hoursVal = entry.hours_worked ?? '';
    const ptoVal = entry.pto_hours_used ?? '';
    const st = entryStatus(isSalary ? 'salary' : 'hourly', Number(hoursVal) > 0, approved);
    const es = effectiveChurch(s, entry, approved);
    const rate = isSalary ? `${money(es.base_salary_biweekly)}/period` : `${money(es.hourly_rate)}/hr`;
    return `<tr>
      <td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.role || 'Church staff')} · ${escapeHtml(rate)}</small></td>
      <td>${isSalary ? 'n/a' : `<input class="pay-in" type="number" min="0" step="0.25" name="hours_${escapeHtml(s.id)}" value="${escapeHtml(hoursVal)}"${lockAttr} aria-label="Hours worked by ${escapeHtml(s.name)}">`}</td>
      <td>${takesPto(s.pay_type) ? `<input class="pay-in" type="number" min="0" step="0.25" name="pto_${escapeHtml(s.id)}" value="${escapeHtml(ptoVal)}"${lockAttr} aria-label="PTO used by ${escapeHtml(s.name)}">` : 'n/a'}</td>
      <td>${pillHtml(st.tone, st.label)} <a href="/?section=payroll&view=staff-form&id=${escapeHtml(s.id)}">Edit</a></td>
    </tr>`;
  }).join('');

  const mdoRows = mdoStaff.map((s) => {
    const isSalary = s.pay_type === 'salary';
    const h = mdoHoursMap.get(s.id) || 0;
    const pto = mdoPtoMap.get(s.id) || 0;
    if (!isSalary && h === 0 && pto === 0) return '';
    const st = entryStatus(isSalary ? 'salary' : 'hourly', true, approved);
    return `<tr>
      <td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.role || 'Childcare')}</small></td>
      <td>${isSalary ? 'n/a' : escapeHtml(hrs(h))}</td>
      <td>${isSalary ? 'n/a' : escapeHtml(hrs(pto))}</td>
      <td>${pillHtml(st.tone, st.label)}</td>
    </tr>`;
  }).join('');

  const allRows = churchRows + mdoRows;
  const missing = computeMissingHours(churchStaff, periodEntries);
  const people = payablePeople(churchStaff, mdoStaff, mdoHoursMap, mdoPtoMap);

  const hourlyCount = churchStaff.filter((x) => x.pay_type === 'hourly').length
    + mdoStaff.filter((x) => x.pay_type !== 'salary' && ((mdoHoursMap.get(x.id) || 0) > 0 || (mdoPtoMap.get(x.id) || 0) > 0)).length;
  const salariedCount = churchStaff.filter((x) => x.pay_type === 'salary').length
    + mdoStaff.filter((x) => x.pay_type === 'salary').length;
  const totalHours = [...periodEntries.values()].reduce((n, e) => n + Number(e.hours_worked || 0), 0)
    + [...mdoHoursMap.values()].reduce((n, h) => n + h, 0);
  const summaryLine = approved ? approvalLine(periodApproval)
    : `${totalHours.toFixed(2)} hours from ${hourlyCount} hourly staff · ${salariedCount} salaried, exceptions only`;

  const mdoLiveText = mdoError
    ? 'The childcare app could not be reached, so no childcare hours are included below — this report is incomplete.'
    : mdoStaff.length
      ? `${mdoStaff.length} childcare staff read live from the MDO app · hours and rates come from there, not from here`
      : 'No childcare staff found for this period.';

  const confirmBanner = needsConfirm && missing.length ? `<div class="pay-warn">
    <p>${missing.length} ${missing.length === 1 ? 'person has' : 'people have'} no hours entered — ${escapeHtml(missing.map((m) => m.name).join(', '))}.</p>
    <form method="POST" action="/api/v1/payroll-period-approve">
      <input type="hidden" name="period" value="${escapeHtml(period.start)}">
      <input type="hidden" name="action" value="approve">
      <input type="hidden" name="confirm_missing" value="1">
      <button type="submit">Approve the period anyway</button>
    </form>
  </div>` : '';

  // Website's own confirm()-before-resend, rebuilt as a query-param confirm step:
  // the first submit answers already_sent (not an error) and redirects back here
  // with the fact of it; only a deliberate second submit carries force=1.
  const emailAlreadySentBanner = alreadySent ? `<div class="pay-warn">
    <p>This period was already emailed to ${escapeHtml(alreadySent.to || 'the bookkeeper')}${alreadySent.at ? ` on ${escapeHtml(new Date(alreadySent.at).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}.</p>
    <form method="POST" action="/api/v1/payroll-email">
      <input type="hidden" name="period" value="${escapeHtml(period.start)}">
      <input type="hidden" name="force" value="1">
      <button type="submit">Send it again</button>
    </form>
  </div>` : '';

  const approveForm = `<form method="POST" action="/api/v1/payroll-period-approve">
    <input type="hidden" name="period" value="${escapeHtml(period.start)}">
    <input type="hidden" name="action" value="${approved ? 'unapprove' : 'approve'}">
    ${!approved ? '' : '<label style="display:flex;gap:.4rem;align-items:center;font-weight:400;text-transform:none;letter-spacing:0;"><input type="checkbox" name="confirm_unapprove" value="1" required style="width:auto;"> I understand this reopens hours entry for this period</label>'}
    <button type="submit" class="pay-approve${approved ? ' is-done' : ''}"${!people ? ' disabled' : ''}>${approved ? 'Take back approval' : 'Approve period'}</button>
  </form>`;

  return `
    ${statusMsg ? `<p class="status">${escapeHtml(statusMsg)}</p>` : ''}
    ${staffError ? `<p class="status status-error">Church staff could not be read: ${escapeHtml(staffError)}</p>` : ''}
    <div class="pay-card">
      <div class="pay-card-bar">Pay period · ${escapeHtml(periodLabel(period.start, period.end))} · ${escapeHtml(paysOnLabel(period.end))}</div>
      <p style="padding:.65rem 1rem 0;margin:0;">${escapeHtml(mdoLiveText)} ${mdoPeriodApproval ? pillHtml('good', `MDO approved by ${mdoPeriodApproval.approved_by}`) : pillHtml('plain', 'MDO not yet approved')}</p>
      <form method="POST" action="/api/v1/payroll-hours-save">
        <input type="hidden" name="period" value="${escapeHtml(period.start)}">
        <div class="table-wrap"><table><thead><tr><th>Person</th><th>Hours</th><th>PTO used</th><th>Status</th></tr></thead>
        <tbody>${allRows || '<tr><td colspan="4">Nobody to pay in this period.</td></tr>'}</tbody></table></div>
        ${!approved ? '<button type="submit">Save hours</button>' : ''}
      </form>
      <div class="pay-foot"><span>${escapeHtml(summaryLine)}</span>${approveForm}</div>
    </div>
    ${confirmBanner}
    ${emailAlreadySentBanner}
    <p><a href="/?section=payroll&view=staff-form&id=new">+ Add person</a> · <a href="/api/v1/payroll-csv?period=${encodeURIComponent(period.start)}">Export CSV</a></p>
    <form method="POST" action="/api/v1/payroll-email" style="margin-top:0;">
      <input type="hidden" name="period" value="${escapeHtml(period.start)}">
      <button type="submit">Email report</button>
    </form>
    <p><small>Church hours are typed here and saved with the Save hours button. Childcare hours come from the MDO app and cannot be edited here.</small></p>
    <p><small>Rates for church staff are entered here, shown beside each name above. Rates for childcare staff live in the MDO app and are read from it — there is deliberately no field for them here.</small></p>
  `;
}

// ── REPORT VIEW ──────────────────────────────────────────────────────────
export function renderReportView({ period, workspace, layout }) {
  const { churchStaff, periodEntries, periodApproval, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, mdoError } = workspace;
  const approved = !!periodApproval;
  const groups = reportGroups({ churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, periodApproved: approved });
  const lbl = periodLabel(period.start, period.end);
  const report = exportReport({
    periodStart: period.start, periodEnd: period.end, periodLabel: lbl,
    churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot,
    periodApproved: approved, incomplete: !!mdoError,
  });
  const incompleteNote = mdoError ? 'The childcare app could not be reached, so no MDO staff are in this report. Do not send it to the payroll service until it can be read.' : '';
  return `
    ${renderLayoutTabs(layout, period.start)}
    <div>${renderReportBody(groups, layout, lbl, incompleteNote)}</div>
    <div id="pay-print">${renderPrintTable(report)}</div>
  `;
}

// The one report shape CSV, print and the emailed report are all built from —
// matching Website's own "one shape, three destinations" exportReport(), so
// none of Finance's three can quietly disagree with each other either.
function buildReportForPeriod(period, workspace) {
  const { churchStaff, periodEntries, periodApproval, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot, mdoError } = workspace;
  return exportReport({
    periodStart: period.start, periodEnd: period.end, periodLabel: periodLabel(period.start, period.end),
    churchStaff, periodEntries, mdoStaff, mdoHoursMap, mdoPtoMap, mdoRateSnapshot,
    periodApproved: !!periodApproval, incomplete: !!mdoError,
  });
}

export function buildCsvForPeriod(period, workspace) {
  return buildPayrollCsv(buildReportForPeriod(period, workspace));
}

// Emails the report to the bookkeeper through Website's /payroll/email route.
// `force` skips Website's own "already emailed in the last 12 hours" dedup —
// set it only on a deliberate, confirmed resend (see the confirm banner in
// renderEntryView), never on the first attempt.
export async function emailReport(env, accessJwt, period, workspace, force) {
  const report = buildReportForPeriod(period, workspace);
  return postPayrollEmailReport(env, accessJwt, {
    periodStart: report.periodStart, periodEnd: report.periodEnd, periodLabel: report.label,
    approved: !!workspace.periodApproval, approvedBy: workspace.periodApproval?.approved_by || '',
    incomplete: report.incomplete, total: report.total,
    mdo: report.mdo, church: report.church, force: !!force,
  });
}

// ── STAFF ADD/EDIT VIEW (replaces Website's slide-out drawer) ──────────────
export function renderStaffFormView({ id, churchStaff, formError }) {
  const staff = id && id !== 'new' ? churchStaff.find((s) => String(s.id) === String(id)) : null;
  const isSalary = !staff || staff.pay_type === 'salary';
  const val = (field, fallback = '') => (staff ? (staff[field] ?? fallback) : fallback);
  return `
    <h2>${staff ? escapeHtml(staff.name) : 'Add a person'}</h2>
    <p>Church staff only. Childcare staff come from the MDO app.</p>
    ${formError ? `<p class="status status-error">${escapeHtml(formError)}</p>` : ''}
    <form method="POST" action="/api/v1/payroll-staff-save">
      <input type="hidden" name="id" value="${staff ? escapeHtml(staff.id) : ''}">
      <div class="field"><label for="f-name">Full name</label><input id="f-name" type="text" name="name" value="${escapeHtml(val('name'))}" required></div>
      <div class="field"><label for="f-role">Role</label><input id="f-role" type="text" name="role" value="${escapeHtml(val('role'))}"></div>
      <div class="field"><label for="f-pay-type">Paid as</label>
        <select id="f-pay-type" name="pay_type">
          <option value="salary"${isSalary ? ' selected' : ''}>Salaried — a fixed amount each period</option>
          <option value="hourly"${!isSalary ? ' selected' : ''}>Hourly — hours entered each period</option>
        </select>
      </div>
      <div class="field"><label for="f-salary">Base salary per period ($)</label><input id="f-salary" type="number" min="0" step="0.01" name="base_salary_biweekly" value="${escapeHtml(val('base_salary_biweekly'))}"></div>
      <div class="field"><label for="f-rate">Hourly rate ($)</label><input id="f-rate" type="number" min="0" step="0.01" name="hourly_rate" value="${escapeHtml(val('hourly_rate'))}"></div>
      <div class="field"><label for="f-housing">Housing allowance per period ($)</label><input id="f-housing" type="number" min="0" step="0.01" name="housing_allowance_biweekly" value="${escapeHtml(val('housing_allowance_biweekly'))}"></div>
      <div class="field"><label for="f-optout">Insurance opt-out per period ($)</label><input id="f-optout" type="number" min="0" step="0.01" name="insurance_opt_out_biweekly" value="${escapeHtml(val('insurance_opt_out_biweekly'))}"></div>
      <div class="field"><label for="f-hsa">HSA contribution per period ($)</label><input id="f-hsa" type="number" min="0" step="0.01" name="hsa_contribution_biweekly" value="${escapeHtml(val('hsa_contribution_biweekly'))}"></div>
      <div class="field"><label for="f-mileage">Mileage per period ($)</label><input id="f-mileage" type="number" min="0" step="0.01" name="mileage_biweekly" value="${escapeHtml(val('mileage_biweekly'))}"></div>
      <div class="field"><label for="f-403type">403(b) deduction</label>
        <select id="f-403type" name="retirement_403b_type">
          <option value="fixed"${val('retirement_403b_type', 'fixed') !== 'percent' ? ' selected' : ''}>A fixed amount each period</option>
          <option value="percent"${val('retirement_403b_type') === 'percent' ? ' selected' : ''}>A percentage of base earnings</option>
        </select>
      </div>
      <div class="field"><label for="f-403amt">403(b) amount</label><input id="f-403amt" type="number" min="0" step="0.0001" name="retirement_403b_amount" value="${escapeHtml(val('retirement_403b_amount'))}"><p><small>A dollar amount, or a decimal fraction (0.05 is 5%) if the deduction above is a percentage.</small></p></div>
      <button type="submit">Save</button>
    </form>
    ${staff ? `<form method="POST" action="/api/v1/payroll-staff-deactivate" style="margin-top:1rem;">
      <input type="hidden" name="id" value="${escapeHtml(staff.id)}">
      <label style="display:flex;gap:.4rem;align-items:center;font-weight:400;text-transform:none;letter-spacing:0;"><input type="checkbox" name="confirm" value="1" required style="width:auto;"> Remove ${escapeHtml(staff.name)} from the church staff list. Their past periods stay in the record.</label>
      <button type="submit">Remove</button>
    </form>` : ''}
    <p><a href="/?section=payroll">← Back to Payroll</a></p>
  `;
}

// ── ONE ENTRY POINT — used by shell.js's renderSectionBody() ───────────────
// Everything the payroll section needs is already resolved by the time this
// runs (see loadPayrollSectionBundle() below); this just picks the right
// view and wraps it in the shared toolbar (period picker + Enter&approve/
// Report tabs), except the staff-form view, which is its own sub-page.
export function renderPayrollSection(bundle) {
  const { periods, period, view, layout, ytdLine, workspace, statusMsg, needsConfirm, staffFormId, staffFormError, alreadySent } = bundle;
  if (view === 'staff-form') {
    return `<section aria-label="Payroll"><h2>Payroll</h2>${renderStaffFormView({ id: staffFormId, churchStaff: workspace.churchStaff, formError: staffFormError })}</section>`;
  }
  const body = view === 'report'
    ? renderReportView({ period, workspace, layout })
    : renderEntryView({ period, periods, workspace, statusMsg, needsConfirm, alreadySent });
  return `<section aria-label="Payroll">
    <div class="section-heading"><div><div class="eyebrow">Payroll</div><h2>Payroll</h2></div><span class="badge">Relayed live to Website</span></div>
    <p>Enter hours and exceptions, approve the period, then read the gross-pay report — church staff and Timothy MDO, with a combined total. Withholding, taxes and bank details stay with the payroll service.</p>
    ${renderPayrollToolbar(periods, period, view, ytdLine)}
    ${body}
  </section>`;
}

// ── WRITE ORCHESTRATION — called from shell.js's route handlers ────────────
// Every write is a live payroll_* RPC call through the same contract relay
// the reads above use. None of these touch Finance's own database.

// Saves every church-staff row present in the form in one submit (there is
// no autosave here, unlike Website's screen -- see the module header). A
// blank input saves as 0, the same as Website's parseFloat(...)||0. Each
// staff member's existing pto_hours_earned is preserved, matching Website's
// doHoursSave(), which never lets the entry form touch that figure.
export async function saveAllHours(env, accessJwt, periodStart, churchStaff, periodEntries, form) {
  const results = await Promise.all(churchStaff.map(async (s) => {
    const hoursRaw = form.get(`hours_${s.id}`);
    const ptoRaw = form.get(`pto_${s.id}`);
    if (hoursRaw === null && ptoRaw === null) return { ok: true }; // MDO or an untouched row: nothing to save
    const hoursWorked = parseFloat(hoursRaw) || 0;
    const ptoUsed = parseFloat(ptoRaw) || 0;
    const ptoEarned = Number(periodEntries.get(s.id)?.pto_hours_earned || 0);
    return callPayrollProxy(env, accessJwt, 'payroll_save_hours', {
      p_staff_id: s.id, p_period_start: periodStart,
      p_hours_worked: hoursWorked, p_pto_used: ptoUsed, p_pto_earned: ptoEarned,
    });
  }));
  const failed = results.find((r) => !r.ok);
  return failed ? { ok: false, reason: failed.reason, message: failed.message } : { ok: true };
}

// Approves or unapproves the period. The total is computed from the SAME
// reportGroups()/subtotal() the report renders, and computed from the
// workspace as it was loaded before this call -- at that instant the period
// was not yet approved, so this reads live rates exactly once, at the moment
// of approval, matching what Website's payroll_approve_period is about to
// freeze per person.
export async function approvePeriod(env, accessJwt, periodStart, approvedBy, workspace) {
  if (workspace.periodApproval) {
    return callPayrollProxy(env, accessJwt, 'payroll_unapprove_period', { p_period_start: periodStart });
  }
  const groups = reportGroups({
    churchStaff: workspace.churchStaff, periodEntries: workspace.periodEntries,
    mdoStaff: workspace.mdoStaff, mdoHoursMap: workspace.mdoHoursMap, mdoPtoMap: workspace.mdoPtoMap,
    mdoRateSnapshot: workspace.mdoRateSnapshot, periodApproved: false,
  });
  const totalGrossCents = cents(groups.reduce((n, g) => n + fromCents(cents(subtotal(g.people))), 0));
  return callPayrollProxy(env, accessJwt, 'payroll_approve_period', {
    p_period_start: periodStart, p_approved_by: approvedBy, p_total_gross_cents: totalGrossCents,
  });
}

export async function saveStaffFromForm(env, accessJwt, form) {
  const id = form.get('id') || null;
  const name = String(form.get('name') || '').trim();
  if (!name) return { ok: false, reason: 'validation', message: 'A name is required.' };
  const payType = form.get('pay_type') === 'hourly' ? 'hourly' : 'salary';
  const num = (field) => parseFloat(form.get(field)) || 0;
  const retirementType = form.get('retirement_403b_type') === 'percent' ? 'percent' : 'fixed';
  return callPayrollProxy(env, accessJwt, 'payroll_save_staff', {
    p_id: id, p_name: name, p_role: String(form.get('role') || '').trim() || null,
    p_pay_type: payType,
    p_hourly_rate: payType === 'hourly' ? num('hourly_rate') : 0,
    p_base_salary_biweekly: payType === 'salary' ? num('base_salary_biweekly') : 0,
    p_housing_allowance_biweekly: num('housing_allowance_biweekly'),
    p_insurance_opt_out_biweekly: num('insurance_opt_out_biweekly'),
    p_hsa_contribution_biweekly: num('hsa_contribution_biweekly'),
    p_mileage_biweekly: num('mileage_biweekly'),
    p_retirement_403b_type: retirementType,
    p_retirement_403b_amount: num('retirement_403b_amount'),
  });
}

export async function deactivateStaffFromForm(env, accessJwt, form) {
  const id = form.get('id');
  if (!id) return { ok: false, reason: 'validation', message: 'No person was specified.' };
  return callPayrollProxy(env, accessJwt, 'payroll_deactivate_staff', { p_id: id });
}

const LAYOUTS = new Set(['cards', 'table', 'summary']);

// One resolved bundle of everything shell.js's GET / (shell route) needs to
// render the payroll section for the current query string -- the period,
// which view/layout, live workspace data, the YTD line and any status/error
// banner left by a prior write's redirect.
export async function buildPayrollSectionBundle(env, accessJwt, searchParams) {
  const { periods, period } = resolvePayrollPeriod(searchParams.get('period'));
  const rawView = searchParams.get('view');
  const view = rawView === 'report' ? 'report' : rawView === 'staff-form' ? 'staff-form' : 'entry';
  const rawLayout = searchParams.get('layout');
  const layout = LAYOUTS.has(rawLayout) ? rawLayout : 'cards';
  const needsConfirm = searchParams.get('needs_confirm') === '1';
  const statusParam = searchParams.get('status');
  const errorMessage = statusParam === 'error' ? (searchParams.get('message') || 'unknown error') : '';

  const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
  const [ytdLine, healedApproval] = await Promise.all([
    loadYearToDate(env, accessJwt, new Date().getFullYear()),
    healMissingTotal(env, accessJwt, period.start, workspace),
  ]);
  workspace.periodApproval = healedApproval;

  const statusMsg = view === 'staff-form' ? '' : {
    saved: 'Hours saved.', approved: 'Period approved.', unapproved: 'Approval taken back.',
    staff_saved: 'Saved.', staff_removed: 'Removed from the church staff list.',
    emailed: `Emailed to ${searchParams.get('to') || 'the bookkeeper'}.`,
    error: `That did not save: ${errorMessage}.`,
  }[statusParam] || '';

  const alreadySent = statusParam === 'already_sent'
    ? { to: searchParams.get('to') || '', at: searchParams.get('at') || '' }
    : null;

  return {
    periods, period, view, layout, needsConfirm, statusMsg, ytdLine, workspace, alreadySent,
    staffFormId: searchParams.get('id') || null,
    staffFormError: view === 'staff-form' && statusParam === 'error' ? errorMessage : '',
  };
}
