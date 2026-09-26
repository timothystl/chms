// HR & Staff pages (v3 design), admin-only. Church staff, MDO staff, and key volunteers; other
// daycare staff are kept in myMDO and only pointed to here. Editing is plain form posts to the hr-* writers.
import { escapeHtml } from './render-helpers.js';
import { formatDay, formatMonth } from './facilities-service.js';
import {
  BENEFIT_CHANGE_STATUSES, CREDENTIALS, DUE_SOON_DAYS, ENROLLED_COVERAGE, FLSA_CLASSES, HEALTH_COVERAGE,
  MINISTRYSAFE_URL, PERSON_GROUPS, POLICY_AUDIENCES, REVIEW_STATUSES, buildOrgTree,
} from './hr-service.js';

const e = escapeHtml;
const MYMDO_URL = 'https://mdo.timothystl.org';

function link(page, params = {}) {
  const search = new URLSearchParams({ section: 'hr', page, ...params });
  return `/?${search.toString().replace(/&/g, '&amp;')}`;
}

function kpis(items) {
  return `<div class="grid">${items.map(([label, value, note, tone]) => `<div class="card"><small>${e(label)}</small><strong>${value}</strong>${note ? `<span class="${tone ? `tone-${tone}` : ''}">${note}</span>` : ''}</div>`).join('')}</div>`;
}

function chips(page, param, values, active) {
  return `<div class="chip-row">${['All', ...values].map((value) => {
    const on = (value === 'All' && !active) || value === active;
    return on ? `<span class="chip is-on">${e(value)}</span>` : `<a class="chip" href="${value === 'All' ? link(page) : link(page, { [param]: value })}">${e(value)}</a>`;
  }).join('')}</div>`;
}

function select(name, options, selected, { blank } = {}) {
  return `<select name="${name}">${blank !== undefined ? `<option value="">${e(blank)}</option>` : ''}${options.map(([value, label]) => `<option value="${e(String(value))}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${e(label)}</option>`).join('')}</select>`;
}

function field(label, control, wide) {
  return `<label class="field${wide ? ' field-wide' : ''}"><span>${e(label)}</span>${control}</label>`;
}

function check(name, label, on) {
  return `<label class="check"><input type="checkbox" name="${name}" value="1"${on ? ' checked' : ''}> ${e(label)}</label>`;
}

const STATE_TONE = { current: 'good', due: 'warn', expired: 'bad', missing: 'bad', not_required: 'muted' };
const OVERALL = { current: ['All current', 'good'], due: ['Due soon', 'warn'], expired: ['Expired', 'bad'], missing: ['Missing', 'bad'] };

function credCell(status) {
  return `<span class="tone-${STATE_TONE[status.state]}">${e(status.label)}</span>`;
}

function pill(label, tone) {
  return `<span class="pill pill-${tone}">${e(label)}</span>`;
}

function emptyNote(text) {
  return `<div class="empty-note">${text}</div>`;
}

function statusBanner(status) {
  return status ? `<p class="status${status.ok ? '' : ' status-error'}">${e(status.message)}</p>` : '';
}

const daycareNote = `<p class="muted-line">The MDO director is kept here as MDO staff. Other daycare staff records (screening, CPR, licensing clock hours, reviews) are kept in <a href="${MYMDO_URL}">myMDO</a>, which owns childcare staffing.</p>`;
const ministrySafeLink = `<a href="${MINISTRYSAFE_URL}" target="_blank" rel="noopener">MinistrySafe</a>`;

// CSS modifier and short label for each group.
const GROUP_CLASS = { 'Key volunteer': ' vol', 'MDO staff': ' mdo' };
const GROUP_SHORT = { 'Church staff': 'Church', 'MDO staff': 'MDO', 'Key volunteer': 'Volunteer' };

function roleLine(p) {
  return [p.position, p.ministry_team].filter(Boolean).join(' · ');
}

// ── Staff directory and one person's record ───────────────────────────────────────────────────

function personForm(view, person = {}) {
  const others = view.people.filter((p) => p.id !== person.id).map((p) => [p.id, p.full_name]);
  const isNew = !person.id;
  const vol = person.person_group === 'Key volunteer';
  return `<form method="POST" action="/api/v1/hr/person-save" class="form-grid facility-form">
    ${person.id ? `<input type="hidden" name="id" value="${person.id}">` : ''}
    ${field('Name', `<input name="full_name" required maxlength="120" value="${e(person.full_name || '')}">`)}
    ${field('Group', select('person_group', PERSON_GROUPS.map((g) => [g, g]), person.person_group || 'Church staff'))}
    ${field('Position', `<input name="position" maxlength="160" value="${e(person.position || '')}">`)}
    ${field('Ministry team', `<input name="ministry_team" maxlength="80" list="hr-teams" value="${e(person.ministry_team || '')}" placeholder="e.g. VBS, Sunday School"><datalist id="hr-teams">${view.teams.map((t) => `<option value="${e(t.name)}">`).join('')}</datalist>`)}
    ${field('Reports to', select('reports_to_id', others, person.reports_to_id, { blank: 'Church Council' }))}
    ${field('Start', `<input type="month" name="start_month" value="${e(person.start_month || '')}">`)}
    ${field('Type', `<input name="employment_type" maxlength="120" value="${e(person.employment_type || '')}" placeholder="e.g. Full-time · called">`)}
    ${field('Email', `<input type="email" name="email" maxlength="200" value="${e(person.email || '')}">`)}
    ${field('Roster / credential', `<input name="roster_credential" maxlength="160" value="${e(person.roster_credential || '')}" placeholder="e.g. LCMS roster · Active">`)}
    <div class="field field-wide"><span>Required screening and training</span><div class="check-row">
      ${check('requires_background', 'Background check', isNew ? true : person.requires_background)}
      ${check('requires_safe_gatherings', 'MinistrySafe training', isNew ? true : person.requires_safe_gatherings)}
      ${check('requires_mandated_reporter', 'Mandated reporter', isNew ? true : person.requires_mandated_reporter && !vol)}
      ${check('requires_cpr', 'CPR / First Aid', person.requires_cpr)}
    </div></div>
    ${field('Health coverage', select('health_coverage', Object.entries(HEALTH_COVERAGE), person.health_coverage || 'not_enrolled'))}
    <div class="field"><span>Other benefits</span><div class="check-row">
      ${check('pension', 'Pension', person.pension)}${check('disability', 'D&S', person.disability)}${check('retirement_403b', '403(b)', person.retirement_403b)}
    </div></div>
    ${person.id ? field('Status', select('active', [['1', 'Active'], ['0', 'No longer serving']], String(person.active ?? 1))) : ''}
    ${field('Notes', `<input name="notes" maxlength="2000" value="${e(person.notes || '')}">`, true)}
    <div class="form-actions"><button type="submit">${person.id ? 'Save changes' : 'Add person'}</button></div>
  </form>`;
}

function credentialForm(person, today) {
  const required = CREDENTIALS.filter((c) => person[c.requires]);
  if (!required.length) return '';
  return `<form method="POST" action="/api/v1/hr/credential-save" class="form-grid facility-form">
    <input type="hidden" name="person_id" value="${person.id}">
    ${field('Record a completion', select('kind', required.map((c) => [c.kind, `${c.label} (${c.years} yrs)`]), required[0].kind))}
    ${field('Completed', `<input type="date" name="completed_on" required value="${today}">`)}
    ${field('Expires (optional)', '<input type="date" name="expires_on">')}
    <div class="form-actions"><button type="submit" class="button-outline">Record</button></div>
  </form>`;
}

function renderPerson(view, person, canEdit) {
  const full = view.people.find((p) => p.id === person.id);
  const boss = person.reports_to_id ? view.byId.get(person.reports_to_id)?.full_name : 'Church Council';
  const facts = [
    ['Group', person.person_group], ['Position', person.position], ['Ministry team', person.ministry_team], ['Reports to', boss], ['Start', formatMonth(person.start_month)],
    ['Type', person.employment_type], ['Email', person.email], ['Roster / credential', person.roster_credential],
    ['Benefits', full?.benefits || ''],
  ];
  return `<p class="crumb"><a href="${link('directory')}">Staff directory</a></p>
    <div class="panel">
      <div class="panel-head"><div class="person-head"><span class="initials">${e(full?.initials || '')}</span><h2>${e(person.full_name)}</h2></div>${full ? pill(...(OVERALL[full.overall] || ['—', 'plain'])) : pill('No longer serving', 'plain')}</div>
      <dl class="fact-grid">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v || '—')}</dd></div>`).join('')}</dl>
      ${person.notes ? `<p>${e(person.notes)}</p>` : ''}
    </div>
    ${full ? `<div class="panel panel-spaced"><h2>Screening and training</h2>
      <ul class="row-list">${CREDENTIALS.map((c) => `<li><div><b>${e(c.label)}</b><small>Renews every ${c.years} years${full.credentials[c.kind].record ? ` · completed ${formatDay(full.credentials[c.kind].record.completed_on)}` : ''}</small></div><div class="right">${credCell(full.credentials[c.kind])}</div></li>`).join('')}</ul>
      ${canEdit ? credentialForm(person, view.today) : ''}
      <p class="muted-line">Stored as dates and status only — never reports or results. Training and screening records live in ${ministrySafeLink}.</p></div>` : ''}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"><summary>Edit ${e(person.full_name)}</summary>${personForm(view, person)}</details>` : ''}`;
}

function renderDirectory(view, params, canEdit, data) {
  const personId = Number(params.get('person'));
  const person = personId ? data.people.find((p) => p.id === personId) : null;
  if (person) return renderPerson(view, person, canEdit);
  const group = PERSON_GROUPS.includes(params.get('group')) ? params.get('group') : null;
  const list = view.people.filter((p) => !group || p.person_group === group);
  const ft = view.staff.filter((p) => /full/i.test(p.employment_type)).length;
  const top = kpis([
    ['Church staff', String(view.staff.length), view.staff.length ? `${ft} full-time · ${view.staff.length - ft} other` : 'Add staff below'],
    ['MDO staff', String(view.mdoStaff.length), 'Outside the church staff org'],
    ['Key volunteers', String(view.volunteers.length), view.teams.length ? `${view.teams.length} ministry team${view.teams.length === 1 ? '' : 's'}` : 'Serving with children, youth or money'],
    ['Items needing attention', String(view.attention), `Expired, missing or due in ${DUE_SOON_DAYS} days`, view.attention ? 'warn' : 'good'],
  ]);
  return `${top}
    ${chips('directory', 'group', PERSON_GROUPS, group)}
    <div class="panel list-panel">${list.length
    ? `<ul class="row-list">${list.map((p) => `<li><a class="row-link" href="${link('directory', { person: String(p.id) })}"><div class="person-row"><span class="initials${GROUP_CLASS[p.person_group] || ''}">${e(p.initials)}</span><div><b>${e(p.full_name)}</b><small>${e(roleLine(p) || '—')}</small></div></div><div class="right">${pill(...OVERALL[p.overall])}<small>${GROUP_SHORT[p.person_group] || ''}</small></div></a></li>`).join('')}</ul>`
    : emptyNote(view.people.length ? 'No one in this group.' : 'No staff or key volunteers on record yet.')}</div>
    ${daycareNote}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"${view.people.length ? '' : ' open'}><summary>Add a person</summary>${personForm(view)}</details>` : ''}`;
}

// ── Org chart and job descriptions ────────────────────────────────────────────────────────────

function orgNode(person, extra = '') {
  return `<div class="org-node${GROUP_CLASS[person.person_group] || ''}${extra}"><b>${e(person.full_name)}</b><small>${e(person.position || '')}</small></div>`;
}

function flatten(node) {
  return node.reports.flatMap((child) => [child.person, ...flatten(child)]);
}

// Staff are drawn one by one; key volunteers with a ministry team fold into one line per team
// (open it to see who serves), so a column stays readable when a leader oversees many volunteers.
function orgMembers(people) {
  const teams = new Map();
  const out = [];
  for (const p of people) {
    const team = p.person_group === 'Key volunteer' ? String(p.ministry_team || '').trim() : '';
    if (!team) { out.push(orgNode(p)); continue; }
    if (!teams.has(team)) { teams.set(team, []); out.push({ team }); }
    teams.get(team).push(p);
  }
  return out.map((item) => (typeof item === 'string' ? item : (() => {
    const members = teams.get(item.team);
    return `<details class="org-team"><summary><b>${e(item.team)}</b><small>${members.length} volunteer${members.length === 1 ? '' : 's'}</small></summary><ul>${members.map((m) => `<li>${e(m.full_name)}${m.position ? ` <small>${e(m.position)}</small>` : ''}</li>`).join('')}</ul></details>`;
  })())).join('');
}

function orgColumns(root) {
  const of = (group) => root.reports.filter((child) => child.person.person_group === group);
  const cols = of('Church staff').map((child) => `<div class="org-col">${orgNode(child.person)}${orgMembers(flatten(child))}</div>`);
  // MDO sits outside the church staff org, so it gets its own labeled column.
  cols.push(...of('MDO staff').map((child) => `<div class="org-col"><div class="org-col-head">MDO</div>${orgNode(child.person)}${orgMembers(flatten(child))}</div>`));
  const volunteers = of('Key volunteer');
  if (volunteers.length) {
    cols.push(`<div class="org-col"><div class="org-col-head">Volunteers</div>${orgMembers(volunteers.flatMap((child) => [child.person, ...flatten(child)]))}</div>`);
  }
  return cols.join('');
}

function positionForm(position = {}) {
  return `<form method="POST" action="/api/v1/hr/position-save" class="form-grid facility-form">
    ${position.id ? `<input type="hidden" name="id" value="${position.id}">` : ''}
    ${field('Position', `<input name="title" required maxlength="160" value="${e(position.title || '')}">`)}
    ${field('Reports to', `<input name="reports_to" maxlength="160" value="${e(position.reports_to || '')}">`)}
    ${field('FLSA', select('flsa', FLSA_CLASSES.map((f) => [f, f]), position.flsa || 'Non-exempt'))}
    ${field('Hours', `<input name="hours" maxlength="80" value="${e(position.hours || '')}" placeholder="e.g. Part-time · 24 hrs">`)}
    ${field('Description last updated', `<input type="month" name="description_updated_month" value="${e(position.description_updated_month || '')}">`)}
    <div class="form-actions"><button type="submit">${position.id ? 'Save changes' : 'Add position'}</button></div>
  </form>`;
}

function renderOrg(view, params, canEdit) {
  const tree = buildOrgTree(view.people);
  const chart = tree.length
    ? `<div class="org"><div class="org-top">Church Council</div>${tree.map((root) => `<div class="org-root">${orgNode(root.person, root.person.person_group === 'Church staff' ? ' lead' : '')}</div>
      ${root.reports.length ? `<div class="org-columns">${orgColumns(root)}</div>` : ''}`).join('')}
      <div class="org-legend"><span class="sw"></span>Church staff <span class="sw mdo"></span>MDO staff <span class="sw vol"></span>Key volunteer</div></div>`
    : emptyNote('Add staff with who they report to, and the chart draws itself.');
  const stale = view.positions.filter((p) => p.stale).map((p) => p.title);
  const editing = canEdit ? view.positions.find((p) => String(p.id) === params.get('edit')) : null;
  return `<div class="panel">${chart}</div>
    <div class="panel panel-spaced"><div class="panel-head"><h2>Job descriptions</h2><span class="muted">${stale.length ? `${e(stale.join(', '))} need${stale.length === 1 ? 's' : ''} updating` : 'All updated within 5 years'}</span></div>
    ${view.positions.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Position</th><th>Reports to</th><th>FLSA</th><th>Hours</th><th>Last updated</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${view.positions.map((p) => `<tr><td>${e(p.title)}</td><td>${e(p.reports_to || '—')}</td><td>${e(p.flsa)}</td><td>${e(p.hours || '—')}</td><td>${p.description_updated_month ? `<span class="${p.stale ? 'tone-warn' : ''}">${formatMonth(p.description_updated_month)}${p.stale ? ' · review' : ''}</span>` : '<span class="tone-bad">None on file</span>'}</td>${canEdit ? `<td><a class="edit-link" href="${link('org-chart', { edit: String(p.id) })}">Edit</a></td>` : ''}</tr>`).join('')}</tbody></table></div>` : emptyNote('No job descriptions on record yet.')}
    </div>
    ${editing ? `<div class="panel panel-spaced"><div class="panel-head"><h2>Edit: ${e(editing.title)}</h2><a href="${link('org-chart')}">Cancel</a></div>${positionForm(editing)}</div>` : ''}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"${view.positions.length ? '' : ' open'}><summary>Add a position</summary>${positionForm()}</details>` : ''}`;
}

// ── Performance reviews ───────────────────────────────────────────────────────────────────────

const REVIEW_TONE = { Complete: 'good', 'Self-review in': 'info', Scheduled: 'info', 'Not started': 'muted' };

function renderReviews(view, params, canEdit) {
  const staff = view.employees;
  const count = (status) => staff.filter((p) => p.review.status === status).length;
  const inProgress = count('Self-review in') + count('Scheduled');
  const top = kpis([
    ['Complete', String(count('Complete')), `of ${staff.length}`, 'good'],
    ['In progress', String(inProgress), 'Self-review in or meeting set', 'info'],
    ['Not started', String(count('Not started')), '', count('Not started') ? 'warn' : ''],
  ]);
  const years = [view.reviewYear - 1, view.reviewYear, view.reviewYear + 1];
  const rows = staff.map((p) => `<tr>
      <td><b>${e(p.full_name)}</b>${p.person_group === 'MDO staff' ? ' <small class="muted">MDO</small>' : ''}</td><td>${e(p.position || '—')}</td>
      <td><span class="tone-${REVIEW_TONE[p.review.status]}">${e(p.review.status)}${p.review.note ? ` · ${e(p.review.note)}` : ''}</span></td>
      <td>${p.goals.length ? `${p.goals.length} · ${p.goalAvg}% avg` : '—'}</td>
      <td><details class="edit-inline"><summary>Goals${canEdit ? ' &amp; status' : ''}</summary>
        ${p.goals.length ? `<ul class="goal-list">${p.goals.map((g) => `<li><div class="goal-head"><span>${e(g.goal)}</span><b>${g.progress_pct}%</b></div><div class="life-bar"><span class="tone-bg-ok" style="width:${g.progress_pct}%"></span></div>${canEdit ? `<form method="POST" action="/api/v1/hr/goal-save" class="inline-form"><input type="hidden" name="id" value="${g.id}"><input type="hidden" name="review_year" value="${view.reviewYear}"><input type="hidden" name="goal" value="${e(g.goal)}"><input type="number" name="progress_pct" min="0" max="100" value="${g.progress_pct}" aria-label="Progress"><button type="submit" class="button-outline">Update</button><button type="submit" name="remove" value="1" class="link-button">Remove</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="muted-line">No goals set.</p>'}
        ${canEdit ? `<form method="POST" action="/api/v1/hr/goal-save" class="inline-form"><input type="hidden" name="person_id" value="${p.id}"><input type="hidden" name="review_year" value="${view.reviewYear}"><input name="goal" required maxlength="300" placeholder="New goal"><button type="submit" class="button-outline">Add goal</button></form>
        <form method="POST" action="/api/v1/hr/review-save" class="inline-form"><input type="hidden" name="person_id" value="${p.id}"><input type="hidden" name="review_year" value="${view.reviewYear}">${select('status', REVIEW_STATUSES.map((s) => [s, s]), p.review.status)}<input name="note" maxlength="200" value="${e(p.review.note || '')}" placeholder="e.g. Oct 28 · council personnel"><button type="submit" class="button-outline">Save status</button></form>` : ''}
      </details></td>
    </tr>`).join('');
  return `${top}
    <div class="panel list-panel"><div class="panel-head review-head"><h2>${view.reviewYear} annual reviews</h2><span class="year-links">${years.map((y) => y === view.reviewYear ? `<b>${y}</b>` : `<a href="${link('reviews', { review_year: String(y) })}">${y}</a>`).join(' · ')}</span></div>
    ${staff.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Staff</th><th>Position</th><th>Status</th><th>Goals</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyNote('Add church or MDO staff in the directory to track reviews.')}</div>
    ${daycareNote}`;
}

// ── Background checks, trainings, volunteer screening ─────────────────────────────────────────

function credentialCounts(people, kinds) {
  const c = { expired: 0, due: 0, missing: 0 };
  for (const p of people) for (const k of kinds) if (c[p.credentials[k].state] !== undefined) c[p.credentials[k].state] += 1;
  return c;
}

function renderChecks(view) {
  const c = credentialCounts(view.people, ['background_check']);
  const top = kpis([
    ['Expired', String(c.expired), 'Background checks', c.expired ? 'bad' : ''],
    [`Due in ${DUE_SOON_DAYS} days`, String(c.due), '', c.due ? 'warn' : ''],
    ['Missing', String(c.missing), 'Never run', c.missing ? 'bad' : ''],
  ]);
  return `<p class="lede">Background checks renew every 3 years for everyone who works with children or money. Only dates and status are kept here.</p>${top}
    <div class="panel list-panel">${view.people.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Person</th><th>Group</th><th>Background check (3 yrs)</th><th>Roster / credential</th></tr></thead><tbody>${view.people.map((p) => `<tr><td><a href="${link('directory', { person: String(p.id) })}">${e(p.full_name)}</a></td><td>${e(p.person_group)}</td><td>${credCell(p.credentials.background_check)}</td><td>${p.roster_credential ? `<span class="tone-good">${e(p.roster_credential)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : emptyNote('No one on record yet.')}</div>
    <p class="muted-line">Record a completion from a person’s page in the staff directory.</p>${daycareNote}`;
}

function renderTrainings(view) {
  const count = (kind) => {
    const req = view.people.filter((p) => p.credentials[kind].state !== 'not_required');
    return [req.filter((p) => ['current', 'due'].includes(p.credentials[kind].state)).length, req.length];
  };
  const [sg, sgN] = count('safe_gatherings');
  const [mr, mrN] = count('mandated_reporter');
  const [cpr, cprN] = count('cpr_first_aid');
  const top = kpis([
    ['MinistrySafe current', `${sg} of ${sgN}`, ''], ['Mandated reporter current', `${mr} of ${mrN}`, ''], ['CPR / First Aid current', `${cpr} of ${cprN}`, ''],
  ]);
  return `<p class="lede">${ministrySafeLink} is the congregation’s child-protection (sexual abuse awareness) training. Record each completion here after it posts in MinistrySafe.</p>${top}
    <div class="panel list-panel">${view.people.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Person</th><th>MinistrySafe (3 yrs)</th><th>Mandated reporter (2 yrs)</th><th>CPR / First Aid (2 yrs)</th></tr></thead><tbody>${view.people.map((p) => `<tr><td><a href="${link('directory', { person: String(p.id) })}">${e(p.full_name)}</a></td><td>${credCell(p.credentials.safe_gatherings)}</td><td>${credCell(p.credentials.mandated_reporter)}</td><td>${credCell(p.credentials.cpr_first_aid)}</td></tr>`).join('')}</tbody></table></div>` : emptyNote('No one on record yet.')}</div>
    <p class="muted-line">Daycare licensing clock hours are tracked in <a href="${MYMDO_URL}">myMDO</a>.</p>`;
}

function renderVolunteers(view, params) {
  const status = (p) => {
    const states = [p.credentials.background_check.state, p.credentials.safe_gatherings.state];
    if (states.includes('missing')) return ['Not cleared', 'bad'];
    if (states.includes('expired')) return ['Renewal needed', 'bad'];
    if (states.includes('due')) return ['Renew soon', 'warn'];
    return ['Cleared', 'good'];
  };
  const team = view.teams.some((t) => t.name === params.get('team')) ? params.get('team') : null;
  const rows = view.volunteers.filter((p) => !team || p.ministry_team === team).map((p) => ({ p, s: status(p) }));
  const top = kpis([
    ['Cleared', String(rows.filter((r) => r.s[0] === 'Cleared').length), `of ${rows.length}`, 'good'],
    ['Needs renewal', String(rows.filter((r) => ['Renewal needed', 'Renew soon'].includes(r.s[0])).length), ''],
    ['Not yet screened', String(rows.filter((r) => r.s[0] === 'Not cleared').length), 'Can’t serve until cleared', 'bad'],
  ]);
  const teamNames = view.teams.filter((t) => t.members.some((m) => m.person_group === 'Key volunteer')).map((t) => t.name);
  return `<p class="lede">Volunteers who serve with children or youth, or handle money, must be screened before they start. Screening and training run through ${ministrySafeLink}.</p>${top}
    ${teamNames.length ? chips('volunteers', 'team', teamNames, team) : ''}
    <div class="panel list-panel">${rows.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Volunteer</th><th>Role · team</th><th>Background check</th><th>MinistrySafe</th><th>Status</th></tr></thead><tbody>${rows.map(({ p, s }) => `<tr><td><a href="${link('directory', { person: String(p.id) })}">${e(p.full_name)}</a></td><td>${e(roleLine(p) || '—')}</td><td>${credCell(p.credentials.background_check)}</td><td>${credCell(p.credentials.safe_gatherings)}</td><td><span class="tone-${s[1]}">${s[0]}</span></td></tr>`).join('')}</tbody></table></div>` : emptyNote('No key volunteers on record. Add them in the staff directory with the group “Key volunteer.”')}</div>`;
}

// ── Policies ──────────────────────────────────────────────────────────────────────────────────

function policyForm(policy = {}) {
  return `<form method="POST" action="/api/v1/hr/policy-save" class="form-grid facility-form">
    ${policy.id ? `<input type="hidden" name="id" value="${policy.id}">` : ''}
    ${field('Policy', `<input name="title" required maxlength="160" value="${e(policy.title || '')}">`)}
    ${field('Version', `<input name="version_label" required maxlength="80" value="${e(policy.version_label || '')}" placeholder="e.g. Version 3 · Jan 2026">`)}
    ${field('Who signs', select('applies_to', Object.entries(POLICY_AUDIENCES), policy.applies_to || 'staff'))}
    ${policy.id ? field('Status', select('active', [['1', 'Active'], ['0', 'Retired']], String(policy.active ?? 1))) : ''}
    <div class="form-actions"><button type="submit">${policy.id ? 'Save (a new version asks everyone to sign again)' : 'Add policy'}</button></div>
  </form>`;
}

function renderPolicies(view, canEdit) {
  const rows = view.policies.map((p) => {
    const pct = p.required ? Math.round(p.signedCount / p.required * 100) : 100;
    const done = p.waiting.length === 0;
    return `<li class="policy-row">
      <div class="policy-name"><b>${e(p.title)}</b><small>${e(p.version_label)} · ${e(POLICY_AUDIENCES[p.applies_to])}</small></div>
      <div class="policy-bar"><div class="goal-head"><span>${p.signedCount} of ${p.required} signed</span><b class="tone-${done ? 'good' : 'muted'}">${pct}%</b></div><div class="life-bar"><span class="${done ? 'tone-bg-good' : 'tone-bg-navy'}" style="width:${pct}%"></span></div></div>
      <div class="policy-wait">${done ? 'Everyone has signed' : `Waiting on ${e(p.waiting.map((w) => w.full_name).join(', '))}`}</div>
      ${canEdit && !done ? `<form method="POST" action="/api/v1/hr/signature-save" class="inline-form"><input type="hidden" name="policy_id" value="${p.id}">${select('person_id', p.waiting.map((w) => [w.id, w.full_name]), p.waiting[0].id)}<input type="date" name="signed_on" value="${view.today}" aria-label="Signed on"><button type="submit" class="button-outline">Record signature</button></form>` : ''}
      ${canEdit ? `<details class="edit-inline"><summary>Edit</summary>${policyForm(p)}</details>` : ''}
    </li>`;
  }).join('');
  return `<p class="lede">Each policy tracks who has read and signed the current version.</p>
    <div class="panel list-panel">${rows ? `<ul class="row-list">${rows}</ul>` : emptyNote('No policies on record yet.')}</div>
    ${canEdit ? `<details class="panel panel-spaced edit-panel"${view.policies.length ? '' : ' open'}><summary>Add a policy</summary>${policyForm()}</details>` : ''}`;
}

// ── Benefits enrollment ───────────────────────────────────────────────────────────────────────

function renderBenefits(view, canEdit) {
  view = { ...view, staff: view.employees };
  const eligible = view.staff.filter((p) => p.health_coverage !== 'not_eligible');
  const enrolled = view.staff.filter((p) => ENROLLED_COVERAGE.has(p.health_coverage));
  const top = kpis([
    ['Enrolled in health', String(enrolled.length), `of ${eligible.length} eligible`],
    ['Concordia pension', String(view.staff.filter((p) => p.pension).length), 'Rates on Compensation → Benefits & taxes'],
    ['403(b) participants', String(view.staff.filter((p) => p.retirement_403b).length), ''],
  ]);
  const changeForm = canEdit && view.staff.length ? `<form method="POST" action="/api/v1/hr/benefit-change-save" class="form-grid facility-form">
      ${field('Staff', select('person_id', view.staff.map((p) => [p.id, p.full_name]), view.staff[0].id))}
      ${field('Date', `<input type="date" name="change_date" required value="${view.today}">`)}
      ${field('Status', select('status', BENEFIT_CHANGE_STATUSES.map((s) => [s, s]), 'Requested'))}
      ${field('Change', '<input name="change" required maxlength="300" placeholder="e.g. Marriage · health Self → Self & spouse">', true)}
      <div class="form-actions"><button type="submit">Log change</button></div>
    </form>` : '';
  return `<p class="lede">Plan rates and options come from Compensation → Benefits &amp; taxes. Update a person’s coverage from their directory page.</p>${top}
    <div class="panel list-panel"><h2 class="list-title">Current enrollment</h2>${view.staff.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Staff</th><th>Position</th><th>Benefits</th></tr></thead><tbody>${view.staff.map((p) => `<tr><td><a href="${link('directory', { person: String(p.id) })}">${e(p.full_name)}</a></td><td>${e(p.position || '—')}</td><td>${e(p.benefits)}</td></tr>`).join('')}</tbody></table></div>` : emptyNote('No church or MDO staff on record yet.')}</div>
    <div class="panel panel-spaced"><h2>Recent changes</h2>${view.benefitChanges.length ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Date</th><th>Staff</th><th>Change</th><th>Status</th></tr></thead><tbody>${view.benefitChanges.map((c) => `<tr><td>${formatDay(c.change_date)}</td><td>${e(c.name)}</td><td>${e(c.change)}</td><td><span class="tone-${c.status === 'Processed' || c.status === 'Waiver on file' ? 'good' : 'warn'}">${e(c.status)}</span></td></tr>`).join('')}</tbody></table></div>` : emptyNote('No changes logged.')}${changeForm}</div>
    ${daycareNote}`;
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

export function renderHrPage(pageId, { view, data, params, canEdit, status }) {
  const body = pageId === 'org-chart' ? renderOrg(view, params, canEdit)
    : pageId === 'reviews' ? renderReviews(view, params, canEdit)
      : pageId === 'checks' ? renderChecks(view)
        : pageId === 'trainings' ? renderTrainings(view)
          : pageId === 'policies' ? renderPolicies(view, canEdit)
            : pageId === 'benefits' ? renderBenefits(view, canEdit)
              : pageId === 'volunteers' ? renderVolunteers(view, params)
                : renderDirectory(view, params, canEdit, data);
  return `<section class="hr" aria-label="HR &amp; Staff">${statusBanner(status)}${body}</section>`;
}

export const HR_STYLES = `
    .tone-muted { color:var(--muted) !important; }
    .tone-bg-good { background:var(--green); }
    .tone-bg-navy { background:var(--navy); }
    .person-row, .person-head { display:flex; align-items:center; gap:12px; }
    .person-head h2 { margin:0; }
    .initials { width:34px; height:34px; flex:0 0 auto; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#EEF1F6; color:var(--navy); font-size:12px; font-weight:600; }
    .initials.vol { background:var(--cream); color:var(--gold-ink); }
    .initials.mdo { background:#E8F3EE; color:#2F6B4F; }
    .check-row { display:flex; flex-wrap:wrap; gap:6px 16px; padding-top:4px; }
    .check { display:flex; align-items:center; gap:6px; color:var(--ink); font-size:13.5px; font-weight:400; }
    .check input { padding:0; }
    .org { display:flex; flex-direction:column; align-items:center; gap:14px; }
    .org-top { padding:8px 16px; border:1px solid var(--line); border-radius:6px; background:#F7F8FA; font-size:14px; }
    .org-root .org-node.lead { background:var(--navy); border-color:var(--navy); }
    .org-root .org-node.lead b, .org-root .org-node.lead small { color:#fff; }
    .org-columns { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; width:100%; padding-top:14px; border-top:1px solid var(--line); }
    .org-col { display:flex; flex-direction:column; gap:8px; }
    .org-col > .org-node:first-child, .org-col > .org-col-head + .org-node:not(.vol):not(.mdo) { border-color:var(--navy); }
    .org-node { padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:#fff; }
    .org-node.vol { background:#FBF6EC; border-color:#EBD9B4; }
    .org-node.mdo, .org-col > .org-node.mdo:first-child, .org-col > .org-col-head + .org-node.mdo { background:#EEF6F1; border-color:#9CC7AF; border-style:dashed; }
    .org-col-head { font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); padding:2px 2px 0; }
    .org-team { border:1px solid #EBD9B4; border-radius:6px; background:#FBF6EC; }
    .org-team summary { cursor:pointer; padding:8px 12px; list-style-position:inside; }
    .org-team summary b { font-size:13.5px; font-weight:600; color:var(--navy); margin-right:6px; }
    .org-team summary small, .org-team li small { color:var(--muted); font-size:11.5px; }
    .org-team ul { margin:0; padding:0 12px 8px 28px; font-size:13px; }
    .org-team li { margin:2px 0; }
    .org-node b { display:block; font-size:13.5px; font-weight:600; color:var(--navy); }
    .org-node small { color:var(--muted); font-size:11.5px; }
    .org-legend { display:flex; gap:10px; align-items:center; color:var(--muted); font-size:12px; }
    .org-legend .sw { width:10px; height:10px; border:1px solid var(--line); border-radius:2px; background:#fff; }
    .org-legend .sw.vol { background:#FBF6EC; border-color:#EBD9B4; }
    .org-legend .sw.mdo { background:#EEF6F1; border-color:#9CC7AF; }
    .review-head { align-items:center; padding-top:14px; }
    .year-links { font-size:13px; color:var(--muted); }
    .goal-list { list-style:none; margin:8px 0; padding:0; min-width:260px; }
    .goal-list li { margin-bottom:10px; }
    .goal-head { display:flex; justify-content:space-between; gap:10px; font-size:13px; }
    .inline-form input[type=number] { width:4.5rem; padding:5px 6px; }
    .inline-form input:not([type]) , .inline-form input[name=goal], .inline-form input[name=note] { padding:5px 8px; font-size:13px; }
    .inline-form select { padding:5px 6px; font-size:13px; }
    details.edit-inline .inline-form { margin-top:8px; flex-wrap:wrap; }
    .policy-row { display:grid !important; grid-template-columns:minmax(200px,1.2fr) minmax(200px,1fr) minmax(180px,1.2fr); gap:14px 20px; align-items:center; }
    .policy-row .inline-form, .policy-row details { grid-column:1 / -1; }
    .policy-wait { color:var(--muted); font-size:13px; }
    .list-title { padding-top:16px; }
    @media(max-width:767px){ .policy-row{grid-template-columns:1fr} }
`;
