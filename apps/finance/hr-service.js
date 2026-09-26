// HR & Staff (migrations 0011 and 0016): church staff, MDO staff (the director, who sits outside
// the church staff org), and key volunteers, with their screening and training dates, annual
// reviews and goals, job descriptions, policy signatures, and benefits enrollment. Admin-only.
// Other daycare staff are not stored here; myMDO owns childcare staffing. Background checks are
// dates and status only.
import { runBudgetedReadBatch } from './query-budget.js';
import { FormValidationError, day, int, month, oneOf, optionalId, text } from './form-fields.js';
import { addMonthsToDay, daysBetween, formatMonth } from './facilities-service.js';

// The groups a person is shown in. finance_hr_people.person_group only allows 'Church staff' and
// 'Key volunteer', so MDO staff are stored as staff with organization 'mdo' in
// finance_hr_person_placement (migration 0016) and read back as 'MDO staff'.
export const PERSON_GROUPS = Object.freeze(['Church staff', 'MDO staff', 'Key volunteer']);
export const STAFF_GROUPS = Object.freeze(['Church staff', 'MDO staff']);
export const MINISTRYSAFE_URL = 'https://ministrysafe.com';
export const REVIEW_STATUSES = Object.freeze(['Not started', 'Self-review in', 'Scheduled', 'Complete']);
export const FLSA_CLASSES = Object.freeze(['Exempt · called', 'Exempt', 'Non-exempt']);
export const BENEFIT_CHANGE_STATUSES = Object.freeze(['Requested', 'Waiting for open enrollment', 'Processed', 'Waiver on file']);
export const POLICY_AUDIENCES = Object.freeze({
  staff: 'Church staff',
  staff_and_volunteers: 'Staff and key volunteers',
  volunteers: 'Key volunteers',
});
export const HEALTH_COVERAGE = Object.freeze({
  family: 'Family', self_spouse: 'Self & spouse', self_child: 'Self & child', self: 'Self',
  waived: 'Waived health', opted_out: 'Opted out', not_enrolled: 'Not enrolled', not_eligible: 'Not eligible',
});
export const ENROLLED_COVERAGE = new Set(['family', 'self_spouse', 'self_child', 'self']);

// Renewal periods from the design: background checks and MinistrySafe training every 3 years,
// mandated reporter and CPR / First Aid every 2. The safe_gatherings kind and column names are
// kept from the first design; the congregation uses MinistrySafe for this training.
export const CREDENTIALS = Object.freeze([
  Object.freeze({ kind: 'background_check', label: 'Background check', years: 3, requires: 'requires_background' }),
  Object.freeze({ kind: 'safe_gatherings', label: 'MinistrySafe training', years: 3, requires: 'requires_safe_gatherings' }),
  Object.freeze({ kind: 'mandated_reporter', label: 'Mandated reporter', years: 2, requires: 'requires_mandated_reporter' }),
  Object.freeze({ kind: 'cpr_first_aid', label: 'CPR / First Aid', years: 2, requires: 'requires_cpr' }),
]);
const CREDENTIAL_BY_KIND = new Map(CREDENTIALS.map((c) => [c.kind, c]));
export const DUE_SOON_DAYS = 60;
export const JOB_DESCRIPTION_REVIEW_YEARS = 5;

export const HR_READ_SQL = Object.freeze([
  `SELECT p.id, p.full_name, CASE WHEN p.person_group = 'Church staff' AND pl.organization = 'mdo' THEN 'MDO staff' ELSE p.person_group END AS person_group, p.position, p.reports_to_id, p.start_month, p.employment_type, p.email, p.roster_credential, p.requires_background, p.requires_safe_gatherings, p.requires_mandated_reporter, p.requires_cpr, p.health_coverage, p.pension, p.disability, p.retirement_403b, p.active, p.notes, COALESCE(pl.ministry_team, '') AS ministry_team
    FROM finance_hr_people p LEFT JOIN finance_hr_person_placement pl ON pl.person_id = p.id ORDER BY 3, p.full_name, p.id`,
  'SELECT person_id, kind, completed_on, expires_on FROM finance_hr_credentials',
  'SELECT person_id, review_year, status, note FROM finance_hr_reviews',
  'SELECT id, person_id, review_year, goal, progress_pct FROM finance_hr_goals ORDER BY id',
  'SELECT id, title, reports_to, flsa, hours, description_updated_month FROM finance_hr_positions ORDER BY id',
  'SELECT id, title, version_label, applies_to, active FROM finance_hr_policies ORDER BY id',
  'SELECT policy_id, person_id, version_label, signed_on FROM finance_hr_policy_signatures',
  'SELECT id, person_id, change_date, change, status FROM finance_hr_benefit_changes ORDER BY change_date DESC, id DESC LIMIT 50',
]);

export async function readHr(db) {
  const { results } = await runBudgetedReadBatch(db, 'hr', HR_READ_SQL);
  const rows = (index) => (results[index] && Array.isArray(results[index].results) ? results[index].results : []);
  return {
    people: rows(0), credentials: rows(1), reviews: rows(2), goals: rows(3),
    positions: rows(4), policies: rows(5), signatures: rows(6), benefitChanges: rows(7),
  };
}

// ── Derived views ─────────────────────────────────────────────────────────────────────────────

export function credentialStatus(person, credential, record, today) {
  if (!person[credential.requires]) return { state: 'not_required', label: 'Not required' };
  if (!record) return { state: 'missing', label: 'Missing' };
  const days = daysBetween(today, record.expires_on);
  const when = formatMonth(record.expires_on.slice(0, 7));
  if (days < 0) return { state: 'expired', label: `Expired · ${when}`, record };
  if (days <= DUE_SOON_DAYS) return { state: 'due', label: `Due soon · by ${when}`, record };
  return { state: 'current', label: `Current · to ${when}`, record };
}

const WORST = ['missing', 'expired', 'due'];

function overallStatus(statuses) {
  for (const state of WORST) if (statuses.some((s) => s.state === state)) return state;
  return 'current';
}

export function benefitsSummary(person) {
  const parts = [HEALTH_COVERAGE[person.health_coverage] || 'Not enrolled'];
  if (person.pension) parts.push('pension');
  if (person.disability) parts.push('D&S');
  if (person.retirement_403b) parts.push('403(b)');
  return parts.join(' · ');
}

export function policyAppliesTo(policy, person) {
  if (policy.applies_to === 'staff') return person.person_group === 'Church staff';
  if (policy.applies_to === 'volunteers') return person.person_group === 'Key volunteer';
  return true;
}

export function buildHrView(data, today, reviewYear) {
  const credentialsByPerson = new Map();
  for (const c of data.credentials) {
    if (!credentialsByPerson.has(c.person_id)) credentialsByPerson.set(c.person_id, new Map());
    credentialsByPerson.get(c.person_id).set(c.kind, c);
  }
  const reviews = new Map(data.reviews.filter((r) => r.review_year === reviewYear).map((r) => [r.person_id, r]));
  const goalsByPerson = new Map();
  for (const g of data.goals.filter((goal) => goal.review_year === reviewYear)) {
    if (!goalsByPerson.has(g.person_id)) goalsByPerson.set(g.person_id, []);
    goalsByPerson.get(g.person_id).push(g);
  }
  const people = data.people.filter((p) => p.active).map((p) => {
    const records = credentialsByPerson.get(p.id) || new Map();
    const credentials = Object.fromEntries(CREDENTIALS.map((c) => [c.kind, credentialStatus(p, c, records.get(c.kind), today)]));
    const goals = goalsByPerson.get(p.id) || [];
    return {
      ...p,
      initials: p.full_name.replace(/^(Rev\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(),
      credentials,
      overall: overallStatus(Object.values(credentials)),
      review: reviews.get(p.id) || { status: 'Not started', note: '' },
      goals,
      goalAvg: goals.length ? Math.round(goals.reduce((sum, g) => sum + g.progress_pct, 0) / goals.length) : null,
      benefits: benefitsSummary(p),
    };
  });
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const staff = people.filter((p) => p.person_group === 'Church staff');
  const mdoStaff = people.filter((p) => p.person_group === 'MDO staff');
  const employees = people.filter((p) => STAFF_GROUPS.includes(p.person_group));
  const volunteers = people.filter((p) => p.person_group === 'Key volunteer');
  const attention = people.reduce((n, p) => n + Object.values(p.credentials).filter((s) => WORST.includes(s.state)).length, 0);
  const policies = data.policies.filter((p) => p.active).map((policy) => {
    const required = people.filter((person) => policyAppliesTo(policy, person));
    const signed = new Set(data.signatures.filter((s) => s.policy_id === policy.id && s.version_label === policy.version_label).map((s) => s.person_id));
    const waiting = required.filter((person) => !signed.has(person.id));
    return { ...policy, required: required.length, signedCount: required.length - waiting.length, waiting };
  });
  const thisYear = Number(today.slice(0, 4));
  const positions = data.positions.map((p) => ({
    ...p,
    stale: !p.description_updated_month || thisYear - Number(p.description_updated_month.slice(0, 4)) >= JOB_DESCRIPTION_REVIEW_YEARS,
  }));
  return {
    today, reviewYear, people, staff, mdoStaff, employees, volunteers, teams: ministryTeams(people), byId, attention, policies, positions,
    benefitChanges: data.benefitChanges.map((c) => ({ ...c, name: byId.get(c.person_id)?.full_name || 'Former staff' })),
  };
}

// Ministry teams (VBS, Sunday School, ...) with the active people on each, largest first.
export function ministryTeams(people) {
  const teams = new Map();
  for (const p of people) {
    const team = String(p.ministry_team || '').trim();
    if (!team) continue;
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push(p);
  }
  return [...teams].map(([name, members]) => ({ name, members })).sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
}

// Org chart: a forest rooted at people with no one above them (the council sits over the root).
export function buildOrgTree(people) {
  const ids = new Set(people.map((p) => p.id));
  const children = new Map();
  const roots = [];
  for (const p of people) {
    if (p.reports_to_id && ids.has(p.reports_to_id) && p.reports_to_id !== p.id) {
      if (!children.has(p.reports_to_id)) children.set(p.reports_to_id, []);
      children.get(p.reports_to_id).push(p);
    } else {
      roots.push(p);
    }
  }
  const seen = new Set();
  const build = (p) => {
    if (seen.has(p.id)) return null; // a reporting loop never renders twice
    seen.add(p.id);
    return { person: p, reports: (children.get(p.id) || []).map(build).filter(Boolean) };
  };
  return roots.map(build).filter(Boolean);
}

// ── Writing ────────────────────────────────────────────────────────────────────────────────────

const flag = (value) => (value === '1' || value === 'on' || value === 'true' ? 1 : 0);

async function requirePerson(db, id) {
  const row = await db.prepare('SELECT id FROM finance_hr_people WHERE id = ?').bind(id).first();
  if (!row) throw new FormValidationError('That person is no longer on record.');
}

export async function saveHrPerson(db, form, actor) {
  const id = optionalId(form.id);
  const reportsTo = optionalId(form.reports_to_id);
  if (reportsTo) {
    if (id && reportsTo === id) throw new FormValidationError('A person cannot report to themselves.');
    await requirePerson(db, reportsTo);
  }
  const group = oneOf(form.person_group, PERSON_GROUPS, 'group');
  const values = [
    text(form.full_name, 120, 'Name', { required: true }),
    group === 'Key volunteer' ? 'Key volunteer' : 'Church staff',
    text(form.position, 160, 'Position'),
    reportsTo,
    String(form.start_month ?? '').trim() ? month(form.start_month, 'Start') : null,
    text(form.employment_type, 120, 'Type'),
    text(form.email, 200, 'Email'),
    text(form.roster_credential, 160, 'Roster / credential'),
    flag(form.requires_background), flag(form.requires_safe_gatherings),
    flag(form.requires_mandated_reporter), flag(form.requires_cpr),
    oneOf(form.health_coverage || 'not_enrolled', Object.keys(HEALTH_COVERAGE), 'health coverage'),
    flag(form.pension), flag(form.disability), flag(form.retirement_403b),
    form.active === '0' ? 0 : 1,
    text(form.notes, 2000, 'Notes'),
    String(actor || ''),
  ];
  if (values[6] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[6])) throw new FormValidationError('Email must be an email address.');
  const placement = (personId) => db.prepare(`INSERT INTO finance_hr_person_placement (person_id, organization, ministry_team, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (person_id) DO UPDATE SET organization = excluded.organization, ministry_team = excluded.ministry_team, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .bind(personId, group === 'MDO staff' ? 'mdo' : 'church', text(form.ministry_team, 80, 'Ministry team'), String(actor || ''));
  if (id) {
    await requirePerson(db, id);
    await db.batch([
      db.prepare(`UPDATE finance_hr_people SET full_name = ?, person_group = ?, position = ?, reports_to_id = ?, start_month = ?, employment_type = ?, email = ?, roster_credential = ?, requires_background = ?, requires_safe_gatherings = ?, requires_mandated_reporter = ?, requires_cpr = ?, health_coverage = ?, pension = ?, disability = ?, retirement_403b = ?, active = ?, notes = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(...values, id),
      placement(id),
    ]);
    return { id };
  }
  const result = await db.prepare('INSERT INTO finance_hr_people (full_name, person_group, position, reports_to_id, start_month, employment_type, email, roster_credential, requires_background, requires_safe_gatherings, requires_mandated_reporter, requires_cpr, health_coverage, pension, disability, retirement_403b, active, notes, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(...values).run();
  const newId = result.meta?.last_row_id ?? null;
  if (newId) await placement(newId).run();
  return { id: newId };
}

export async function saveHrCredential(db, form, actor) {
  const personId = optionalId(form.person_id);
  if (!personId) throw new FormValidationError('Choose a person.');
  await requirePerson(db, personId);
  const credential = CREDENTIAL_BY_KIND.get(String(form.kind || ''));
  if (!credential) throw new FormValidationError('Choose a valid credential.');
  const completed = day(form.completed_on, 'Completed');
  const expires = String(form.expires_on ?? '').trim() ? day(form.expires_on, 'Expires') : addMonthsToDay(completed, credential.years * 12);
  if (expires < completed) throw new FormValidationError('Expiration cannot be before completion.');
  await db.prepare(`INSERT INTO finance_hr_credentials (person_id, kind, completed_on, expires_on, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (person_id, kind) DO UPDATE SET completed_on = excluded.completed_on, expires_on = excluded.expires_on, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .bind(personId, credential.kind, completed, expires, String(actor || '')).run();
  return { id: personId };
}

export async function saveHrReview(db, form, actor) {
  const personId = optionalId(form.person_id);
  if (!personId) throw new FormValidationError('Choose a person.');
  await requirePerson(db, personId);
  const year = int(form.review_year, 2000, 2200, 'Year');
  await db.prepare(`INSERT INTO finance_hr_reviews (person_id, review_year, status, note, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (person_id, review_year) DO UPDATE SET status = excluded.status, note = excluded.note, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .bind(personId, year, oneOf(form.status, REVIEW_STATUSES, 'review status'), text(form.note, 200, 'Note'), String(actor || '')).run();
  return { id: personId };
}

export async function saveHrGoal(db, form, actor) {
  const id = optionalId(form.id);
  const progress = int(form.progress_pct || '0', 0, 100, 'Progress');
  if (id) {
    const row = await db.prepare('SELECT id FROM finance_hr_goals WHERE id = ?').bind(id).first();
    if (!row) throw new FormValidationError('That goal no longer exists.');
    if (form.remove === '1') {
      await db.prepare('DELETE FROM finance_hr_goals WHERE id = ?').bind(id).run();
      return { id };
    }
    await db.prepare(`UPDATE finance_hr_goals SET goal = ?, progress_pct = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(text(form.goal, 300, 'Goal', { required: true }), progress, String(actor || ''), id).run();
    return { id };
  }
  const personId = optionalId(form.person_id);
  if (!personId) throw new FormValidationError('Choose a person.');
  await requirePerson(db, personId);
  const result = await db.prepare('INSERT INTO finance_hr_goals (person_id, review_year, goal, progress_pct, updated_by) VALUES (?, ?, ?, ?, ?)')
    .bind(personId, int(form.review_year, 2000, 2200, 'Year'), text(form.goal, 300, 'Goal', { required: true }), progress, String(actor || '')).run();
  return { id: result.meta?.last_row_id ?? null };
}

export async function saveHrPosition(db, form, actor) {
  const id = optionalId(form.id);
  const values = [
    text(form.title, 160, 'Position', { required: true }),
    text(form.reports_to, 160, 'Reports to'),
    oneOf(form.flsa, FLSA_CLASSES, 'FLSA class'),
    text(form.hours, 80, 'Hours'),
    String(form.description_updated_month ?? '').trim() ? month(form.description_updated_month, 'Last updated') : null,
    String(actor || ''),
  ];
  if (id) {
    const row = await db.prepare('SELECT id FROM finance_hr_positions WHERE id = ?').bind(id).first();
    if (!row) throw new FormValidationError('That position no longer exists.');
    await db.prepare(`UPDATE finance_hr_positions SET title = ?, reports_to = ?, flsa = ?, hours = ?, description_updated_month = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values, id).run();
    return { id };
  }
  const result = await db.prepare('INSERT INTO finance_hr_positions (title, reports_to, flsa, hours, description_updated_month, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(...values).run();
  return { id: result.meta?.last_row_id ?? null };
}

// Saving a policy with a new version label means everyone signs again: signatures count only
// against the version they were recorded for.
export async function saveHrPolicy(db, form, actor) {
  const id = optionalId(form.id);
  const values = [
    text(form.title, 160, 'Policy', { required: true }),
    text(form.version_label, 80, 'Version', { required: true }),
    oneOf(form.applies_to, Object.keys(POLICY_AUDIENCES), 'audience'),
    form.active === '0' ? 0 : 1,
    String(actor || ''),
  ];
  if (id) {
    const row = await db.prepare('SELECT id FROM finance_hr_policies WHERE id = ?').bind(id).first();
    if (!row) throw new FormValidationError('That policy no longer exists.');
    await db.prepare(`UPDATE finance_hr_policies SET title = ?, version_label = ?, applies_to = ?, active = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values, id).run();
    return { id };
  }
  const result = await db.prepare('INSERT INTO finance_hr_policies (title, version_label, applies_to, active, updated_by) VALUES (?, ?, ?, ?, ?)')
    .bind(...values).run();
  return { id: result.meta?.last_row_id ?? null };
}

export async function recordHrSignature(db, form, actor) {
  const policyId = optionalId(form.policy_id);
  const personId = optionalId(form.person_id);
  if (!policyId || !personId) throw new FormValidationError('Choose a policy and a person.');
  const policy = await db.prepare('SELECT id, version_label FROM finance_hr_policies WHERE id = ?').bind(policyId).first();
  if (!policy) throw new FormValidationError('That policy no longer exists.');
  await requirePerson(db, personId);
  await db.prepare(`INSERT INTO finance_hr_policy_signatures (policy_id, person_id, version_label, signed_on, recorded_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (policy_id, person_id, version_label) DO UPDATE SET signed_on = excluded.signed_on, recorded_by = excluded.recorded_by`)
    .bind(policyId, personId, policy.version_label, day(form.signed_on, 'Signed on'), String(actor || '')).run();
  return { id: policyId };
}

export async function saveHrBenefitChange(db, form, actor) {
  const personId = optionalId(form.person_id);
  if (!personId) throw new FormValidationError('Choose a person.');
  await requirePerson(db, personId);
  const result = await db.prepare('INSERT INTO finance_hr_benefit_changes (person_id, change_date, change, status, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(personId, day(form.change_date, 'Date'), text(form.change, 300, 'Change', { required: true }), oneOf(form.status, BENEFIT_CHANGE_STATUSES, 'status'), String(actor || '')).run();
  return { id: result.meta?.last_row_id ?? null };
}

export const HR_WRITERS = Object.freeze({
  'hr-person-save-v1': { run: saveHrPerson, page: 'directory', returnParam: 'person' },
  'hr-credential-save-v1': { run: saveHrCredential, page: 'directory', returnParam: 'person' },
  'hr-review-save-v1': { run: saveHrReview, page: 'reviews', keepParams: ['review_year'] },
  'hr-goal-save-v1': { run: saveHrGoal, page: 'reviews', keepParams: ['review_year'] },
  'hr-position-save-v1': { run: saveHrPosition, page: 'org-chart' },
  'hr-policy-save-v1': { run: saveHrPolicy, page: 'policies' },
  'hr-signature-save-v1': { run: recordHrSignature, page: 'policies' },
  'hr-benefit-change-save-v1': { run: saveHrBenefitChange, page: 'benefits' },
});
