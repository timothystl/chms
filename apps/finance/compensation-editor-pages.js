// ── Compensation Planner roster editor ───────────────────────────────────────────────────────
// Real add/edit/remove capability for the Plan page's roster -- fetch-edit-resubmit against the
// same raw plan state postConnectFinanceCompensationWrite expects back (see finance-compensation-
// client.js's own comment on why a partial body would wipe the rest of a real plan). Shown only to
// admin/compensation (finCompCanEdit()'s own two roles in the legacy tool, src/frontend/
// js-finance.js) -- council's real editing surface is only the five raise-plan fields
// (COUNCIL_EDITABLE_FIELDS, api-finance.js), a different, narrower form, not this one.
//
// Fields: name/position/account code/role/track/years/stipends/current-pay override/FTE/coverage
// tier/hand-set opt-out and employee-only premium/FICA self-employment/dependents/health
// enrollment/cash-only/externally funded/hideFromCouncil, with computed LCMS salary scale (using
// the plan's own entered base salaries), employer FICA, and Concordia pension figures shown per
// worker (compensation-calc.js, byte-verified against the legacy formulas). Raise methods,
// reference figures, the health quote and Concordia ranges have their own forms in
// compensation-settings-pages.js.
import { escapeHtml, formatCents, renderSectionHeading } from './render-helpers.js';
import {
  finComputeLcmsSalary, finDefaultSelfEmployedFica, finComputeEmployerFicaCents,
  finConcordiaPensionRateFor, finComputePensionCents, LCMS_COMMISSIONED_TRACKS, LCMS_OTHER_WORKER_TRACKS, FIN_HEALTH_TIERS,
} from './compensation-calc.js';

export function defaultCompensationTargetYear(now = new Date()) {
  return now.getUTCFullYear() + 1;
}

function computeWorkerFigures(w, targetYear, referenceByYear) {
  const role = w.role === 'pastor' || w.role === 'commissioned' ? w.role : 'other';
  const salary = finComputeLcmsSalary({
    year: targetYear, role, trackKey: w.trackKey, yearsExperience: w.yearsExperience,
    colaPct: 0, referenceByYear: referenceByYear || {}, responsibilityStipend: w.responsibilityStipend, attendanceBonus: w.attendanceBonus,
  });
  const computedCents = salary ? salary.salaryCents : null;
  const payCents = w.actualSalaryCents != null ? w.actualSalaryCents : computedCents;
  const selfEmployedFica = w.selfEmployedFica != null ? Boolean(w.selfEmployedFica) : finDefaultSelfEmployedFica(role);
  const ficaCents = payCents != null ? finComputeEmployerFicaCents(payCents, selfEmployedFica) : null;
  const pensionRate = finConcordiaPensionRateFor(targetYear).rate;
  const pensionCents = payCents != null ? finComputePensionCents(payCents, pensionRate) : null;
  return { computedCents, payCents, ficaCents, pensionCents };
}

function renderRosterRow(w, index, referenceByYear) {
  const targetYear = defaultCompensationTargetYear();
  const { computedCents, payCents, ficaCents, pensionCents } = computeWorkerFigures(w, targetYear, referenceByYear);
  return `<tr>
    <td>${escapeHtml(w.name || '(unnamed)')}</td>
    <td>${escapeHtml(w.position || '')}</td>
    <td>${w.actualSalaryCents != null ? formatCents(w.actualSalaryCents) + ' (entered)' : (computedCents != null ? formatCents(computedCents) + ' (computed)' : '—')}</td>
    <td>${payCents != null ? formatCents(payCents) : '—'}</td>
    <td>${ficaCents != null ? formatCents(ficaCents) : '—'}</td>
    <td>${pensionCents != null ? formatCents(pensionCents) : '—'}</td>
    <td><a href="/?section=compensation&amp;page=plan&amp;edit=${index}">Edit</a>
      <form method="POST" action="/api/v1/connect-compensation-plan-write" style="display:inline">
        <input type="hidden" name="action" value="remove"><input type="hidden" name="index" value="${index}">
        <button type="submit" onclick="return confirm('Remove ${escapeHtml(w.name || 'this worker')} from the roster?')">Remove</button>
      </form>
    </td>
  </tr>`;
}

function renderTrackOptions(selected) {
  const group = (label, tracks) => `<optgroup label="${escapeHtml(label)}">${Object.keys(tracks).map((key) =>
    `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(tracks[key].label)}</option>`).join('')}</optgroup>`;
  return `<option value=""${!selected ? ' selected' : ''}>— (pastor track, or unset)</option>`
    + group('Commissioned', LCMS_COMMISSIONED_TRACKS) + group('Other Church Worker', LCMS_OTHER_WORKER_TRACKS);
}

function renderTierOptions(selected) {
  const choices = [['', 'Automatic (from enrollment and dependents)'], ...FIN_HEALTH_TIERS.map((t) => [t.key, t.label]), ['optout', 'Opts out (cash)']];
  return choices.map(([key, label]) => `<option value="${key}"${(selected || '') === key ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function renderWorkerForm(worker, index) {
  const w = worker || {};
  const isEdit = index != null;
  return `<section aria-label="${isEdit ? 'Edit worker' : 'Add a worker'}">
    ${renderSectionHeading({ eyebrow: 'Compensation Plan', heading: isEdit ? `Edit ${escapeHtml(w.name || 'worker')}` : 'Add a worker', badge: 'Relayed live to Connect' })}
    <form method="POST" action="/api/v1/connect-compensation-plan-write">
      <input type="hidden" name="action" value="${isEdit ? 'edit' : 'add'}">
      ${isEdit ? `<input type="hidden" name="index" value="${index}">` : ''}
      <div class="grid form-grid">
        <div class="field"><label for="cw-name">Name</label><input id="cw-name" type="text" name="name" value="${escapeHtml(w.name || '')}" required></div>
        <div class="field"><label for="cw-position">Position</label><input id="cw-position" type="text" name="position" value="${escapeHtml(w.position || '')}"></div>
        <div class="field"><label for="cw-account">Account code</label><input id="cw-account" type="text" name="accountCode" value="${escapeHtml(w.accountCode || '')}" placeholder="optional -- links to a Chart of Accounts budget line"></div>
        <div class="field"><label for="cw-role">Role</label><select id="cw-role" name="role">
          <option value="pastor"${w.role === 'pastor' ? ' selected' : ''}>Pastor</option>
          <option value="commissioned"${w.role === 'commissioned' ? ' selected' : ''}>Commissioned Minister</option>
          <option value="other"${w.role !== 'pastor' && w.role !== 'commissioned' ? ' selected' : ''}>Other Church Worker</option>
        </select></div>
        <div class="field"><label for="cw-track">Education/track (commissioned or other worker only)</label><select id="cw-track" name="trackKey">${renderTrackOptions(w.trackKey)}</select></div>
        <div class="field"><label for="cw-education">Education (free text)</label><input id="cw-education" type="text" name="education" value="${escapeHtml(w.education || '')}"></div>
        <div class="field"><label for="cw-years">Years of experience</label><input id="cw-years" type="number" name="yearsExperience" min="0" step="1" value="${w.yearsExperience != null ? escapeHtml(String(w.yearsExperience)) : '0'}"></div>
        <div class="field"><label for="cw-stipend">Responsibility stipend (fraction, e.g. 0.25)</label><input id="cw-stipend" type="number" name="responsibilityStipend" min="0" max="1" step="0.01" value="${w.responsibilityStipend != null ? escapeHtml(String(w.responsibilityStipend)) : '0'}"></div>
        <div class="field"><label for="cw-bonus">Attendance bonus (fraction, sole/senior pastor only)</label><input id="cw-bonus" type="number" name="attendanceBonus" min="0" max="1" step="0.01" value="${w.attendanceBonus != null ? escapeHtml(String(w.attendanceBonus)) : '0'}"></div>
        <div class="field"><label for="cw-pay">Current pay override ($, annual)</label><input id="cw-pay" type="number" name="actualSalary" min="0" step="1" value="${w.actualSalaryCents != null ? escapeHtml(String(Math.round(w.actualSalaryCents / 100))) : ''}" placeholder="blank = use the LCMS-computed figure"></div>
        <div class="field"><label for="cw-fte">Full-time equivalent (%)</label><input id="cw-fte" type="number" name="ftePct" min="1" max="100" step="1" value="${w.ftePct != null ? escapeHtml(String(w.ftePct)) : '100'}"></div>
        <div class="field"><label for="cw-tier">Health coverage tier</label><select id="cw-tier" name="healthTier">${renderTierOptions(w.healthTier)}</select></div>
        <div class="field"><label for="cw-optout">Opt-out cash for this worker ($/yr)</label><input id="cw-optout" type="number" name="healthOptOutOverride" min="0" step="1" value="${w.healthOptOutOverrideCents != null ? escapeHtml(String(w.healthOptOutOverrideCents / 100)) : ''}" placeholder="blank = the year's opt-out figure"></div>
        <div class="field"><label for="cw-eeprem">Employee-only premium ($/yr)</label><input id="cw-eeprem" type="number" name="employeeOnlyPremium" min="0" step="1" value="${w.employeeOnlyPremiumCents != null ? escapeHtml(String(w.employeeOnlyPremiumCents / 100)) : ''}" placeholder="blank = the quote's tier rate"></div>
      </div>
      <input type="hidden" name="benefit_fields" value="1">
      <div class="field"><label><input type="checkbox" name="selfEmployedFica"${w.selfEmployedFica ? ' checked' : ''}> Self-employed for FICA/SECA (defaults by role if left unset on add)</label></div>
      <div class="field"><label><input type="checkbox" name="hasDependents"${w.hasDependents ? ' checked' : ''}> Has dependents</label></div>
      <div class="field"><label><input type="checkbox" name="healthEnrolled"${w.healthEnrolled ? ' checked' : ''}> Enrolled in the church health plan</label></div>
      <div class="field"><label><input type="checkbox" name="cashOnly"${w.cashOnly ? ' checked' : ''}> Cash only (below the hours floor: no pension, disability or health)</label></div>
      <div class="field"><label><input type="checkbox" name="externallyFunded"${w.externallyFunded ? ' checked' : ''}> Externally funded (left out of every church figure)</label></div>
      <div class="field"><label><input type="checkbox" name="hideFromCouncil"${w.hideFromCouncil ? ' checked' : ''}> Hide from council view</label></div>
      <button type="submit">${isEdit ? 'Save changes' : 'Add worker'}</button>
      ${isEdit ? ' <a href="/?section=compensation&page=plan">Cancel</a>' : ''}
    </form>
  </section>`;
}

export function renderCompensationPlanEditor(planData, editIndex, entryStatus, entryMessage) {
  const roster = Array.isArray(planData?.roster) ? planData.roster : [];
  const targetYear = defaultCompensationTargetYear();
  const editWorker = editIndex != null && roster[editIndex] ? roster[editIndex] : null;

  return `<section aria-label="Compensation Plan roster editor">
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    ${renderSectionHeading({ eyebrow: 'Compensation Plan', heading: `Editable roster (FY${targetYear} LCMS scale)`, badge: 'Relayed live to Connect' })}
    <table><thead><tr><th>Name</th><th>Position</th><th>LCMS/entered salary</th><th>Used for FICA/pension</th><th>Employer FICA</th><th>Pension</th><th></th></tr></thead>
    <tbody>${roster.length ? roster.map((w, i) => renderRosterRow(w, i, planData.referenceByYear)).join('') : '<tr><td colspan="7">No workers on this plan yet.</td></tr>'}</tbody></table>
    <p><small>This writes directly into Connect's own <code>finance_salary_planner</code> plan -- the same one the legacy in-Connect Salary Planner edits. Every save fetches the current full plan first and resubmits it complete, so nothing else in the plan is lost. Only Connect's own admin/compensation roles may save; Connect independently re-verifies your identity and role for every request.</small></p>
    ${renderWorkerForm(editWorker, editIndex != null ? editIndex : null)}
    <p><small>Raise methods are below. Reference figures, the health plan quote and each worker’s Concordia ranges are on <a href="/?section=compensation&amp;page=rates">Rates &amp; ranges</a>.</small></p>
  </section>`;
}
