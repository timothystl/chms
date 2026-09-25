// Facilities: the campus asset register, service history, preventive-maintenance schedule, and
// capital projects (migration 0010). Finance owns these tables; nothing else writes them.
// Reads go through the named `facilities` query budget; writes validate every field here and
// store money in whole cents.
import { runBudgetedReadBatch } from './query-budget.js';

export const FACILITY_CATEGORIES = Object.freeze([
  'HVAC', 'Boilers', 'Elevator', 'Roofs', 'Electrical', 'Kitchen', 'Fire & security', 'Plumbing',
  'Playground', 'Vehicles & equipment', 'Doors', 'Grounds', 'Other',
]);
export const SERVICE_TYPES = Object.freeze(['Repair', 'Inspection', 'Preventive', 'Replacement']);
export const PROJECT_STATUSES = Object.freeze(['Planned', 'In progress', 'Completed']);
export const NEAR_END_OF_LIFE_PCT = 85;
export const DUE_SOON_DAYS = 30;

export class FacilitiesValidationError extends Error {}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

export const FACILITIES_READ_SQL = Object.freeze([
  'SELECT id, name, category, location, installed_month, expected_life_years, replacement_cost_cents, model, serial, warranty, vendor, notes, status FROM finance_facility_assets ORDER BY category, name, id',
  'SELECT id, asset_id, pm_task_id, service_date, service_type, description, vendor, cost_cents FROM finance_facility_service_log ORDER BY service_date DESC, id DESC LIMIT 500',
  'SELECT id, name, covers, asset_id, interval_months, last_done_on, assignee, active FROM finance_facility_pm_tasks ORDER BY name, id',
  'SELECT id, name, scope, status, target_month, cost_cents, vendor, warranty, useful_life_years, funding, notes FROM finance_facility_projects ORDER BY target_month DESC, id DESC',
]);

export async function readFacilities(db) {
  const { results } = await runBudgetedReadBatch(db, 'facilities', FACILITIES_READ_SQL);
  const rows = (index) => (results[index] && Array.isArray(results[index].results) ? results[index].results : []);
  return { assets: rows(0), service: rows(1), pmTasks: rows(2), projects: rows(3) };
}

// ── Dates ──────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

export function formatMonth(month) {
  if (!month) return '—';
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDay(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function addMonthsToDay(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDay(target);
}

export function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 864e5);
}

// ── Derived views ─────────────────────────────────────────────────────────────────────────────

export function assetLife(asset, today) {
  const [ty, tm] = today.split('-').map(Number);
  const [iy, im] = asset.installed_month.split('-').map(Number);
  const ageYears = Math.max(0, ((ty * 12 + tm) - (iy * 12 + im)) / 12);
  const pctUsed = ageYears / asset.expected_life_years * 100;
  const yearsLeft = Math.max(0, asset.expected_life_years - ageYears);
  const state = pctUsed >= 100 ? 'past' : pctUsed >= NEAR_END_OF_LIFE_PCT ? 'near' : 'ok';
  return { ageYears, pctUsed, yearsLeft, state };
}

export function pmSchedule(task, today) {
  const nextDue = task.last_done_on ? addMonthsToDay(task.last_done_on, task.interval_months) : today;
  const daysUntil = daysBetween(today, nextDue);
  const state = !task.last_done_on ? 'never' : daysUntil < 0 ? 'overdue' : daysUntil <= DUE_SOON_DAYS ? 'soon' : 'scheduled';
  return { nextDue, daysUntil, state };
}

const PM_ORDER = { overdue: 0, never: 1, soon: 2, scheduled: 3 };

export function buildFacilitiesView(data, today) {
  const assets = data.assets.filter((a) => a.status === 'active').map((a) => ({ ...a, life: assetLife(a, today) }));
  const assetById = new Map(data.assets.map((a) => [a.id, a]));
  const pmTasks = data.pmTasks.filter((t) => t.active).map((t) => ({ ...t, schedule: pmSchedule(t, today) }))
    .sort((a, b) => PM_ORDER[a.schedule.state] - PM_ORDER[b.schedule.state] || a.schedule.nextDue.localeCompare(b.schedule.nextDue));
  const dueSoon = pmTasks.filter((t) => t.schedule.state !== 'scheduled');
  const overdue = pmTasks.filter((t) => t.schedule.state === 'overdue' || t.schedule.state === 'never');
  const nearEnd = assets.filter((a) => a.life.state !== 'ok').sort((a, b) => b.life.pctUsed - a.life.pctUsed);
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => thisYear + i);
  const openProjects = data.projects.filter((p) => p.status !== 'Completed');
  const capitalByYear = years.map((year) => ({
    year,
    cents: openProjects.filter((p) => Number(p.target_month.slice(0, 4)) === year).reduce((sum, p) => sum + p.cost_cents, 0),
  }));
  const planned5 = openProjects.filter((p) => years.includes(Number(p.target_month.slice(0, 4))));
  const largest = [...planned5].sort((a, b) => b.cost_cents - a.cost_cents)[0] || null;
  const sumBy = (status) => {
    const list = data.projects.filter((p) => p.status === status);
    return { count: list.length, cents: list.reduce((sum, p) => sum + p.cost_cents, 0), list };
  };
  const projectRank = { 'In progress': 0, Planned: 1, Completed: 2 };
  const projects = [...data.projects].sort((a, b) => projectRank[a.status] - projectRank[b.status]
    || (a.status === 'Completed' ? b.target_month.localeCompare(a.target_month) : a.target_month.localeCompare(b.target_month)));
  const service = data.service.map((s) => ({ ...s, assetName: s.asset_id ? assetById.get(s.asset_id)?.name || 'Removed asset' : 'General' }));
  return {
    today,
    assets,
    allAssets: data.assets,
    assetById,
    locations: new Set(assets.map((a) => a.location).filter(Boolean)).size,
    pmTasks,
    dueSoon,
    overdue,
    nearEnd,
    capitalByYear,
    planned5Cents: planned5.reduce((sum, p) => sum + p.cost_cents, 0),
    largestPlanned: largest,
    projects,
    completed: sumBy('Completed'),
    inProgress: sumBy('In progress'),
    planned: sumBy('Planned'),
    service,
  };
}

// ── Writing ────────────────────────────────────────────────────────────────────────────────────

function text(value, max, label, { required = false } = {}) {
  const v = String(value ?? '').trim();
  if (required && !v) throw new FacilitiesValidationError(`${label} is required.`);
  if (v.length > max) throw new FacilitiesValidationError(`${label} is too long (${max} characters at most).`);
  return v;
}

function oneOf(value, list, label) {
  const v = String(value ?? '').trim();
  if (!list.includes(v)) throw new FacilitiesValidationError(`Choose a valid ${label}.`);
  return v;
}

function month(value, label) {
  const v = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1850 || Number(m[1]) > 2200) {
    throw new FacilitiesValidationError(`${label} must be a month like 2026-09.`);
  }
  return v;
}

function day(value, label) {
  const v = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || isoDay(new Date(`${v}T00:00:00Z`)) !== v) {
    throw new FacilitiesValidationError(`${label} must be a date.`);
  }
  return v;
}

function int(value, min, max, label, { optional = false } = {}) {
  const v = String(value ?? '').trim();
  if (optional && v === '') return null;
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
    throw new FacilitiesValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return Number(v);
}

export function parseDollarsToCents(value, label) {
  const v = String(value ?? '').replace(/[$,\s]/g, '');
  if (v === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new FacilitiesValidationError(`${label} must be a dollar amount.`);
  const cents = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) throw new FacilitiesValidationError(`${label} is too large.`);
  return cents;
}

function optionalId(value) {
  const v = String(value ?? '').trim();
  if (v === '' || v === '0') return null;
  if (!/^\d+$/.test(v)) throw new FacilitiesValidationError('Unknown record.');
  return Number(v);
}

async function requireRow(db, table, id, label) {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new FacilitiesValidationError(`That ${label} no longer exists.`);
}

export async function saveFacilityAsset(db, form, actor) {
  const id = optionalId(form.id);
  const values = [
    text(form.name, 160, 'Name', { required: true }),
    oneOf(form.category, FACILITY_CATEGORIES, 'category'),
    text(form.location, 160, 'Location'),
    month(form.installed_month, 'Installed'),
    int(form.expected_life_years, 1, 150, 'Expected life'),
    parseDollarsToCents(form.replacement_cost, 'Replacement cost'),
    text(form.model, 160, 'Model'),
    text(form.serial, 120, 'Serial'),
    text(form.warranty, 200, 'Warranty'),
    text(form.vendor, 160, 'Contractor'),
    text(form.notes, 2000, 'Notes'),
    form.status === 'retired' ? 'retired' : 'active',
    String(actor || ''),
  ];
  if (id) {
    await requireRow(db, 'finance_facility_assets', id, 'asset');
    await db.prepare(`UPDATE finance_facility_assets SET name = ?, category = ?, location = ?, installed_month = ?, expected_life_years = ?, replacement_cost_cents = ?, model = ?, serial = ?, warranty = ?, vendor = ?, notes = ?, status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values, id).run();
    return { id };
  }
  const result = await db.prepare(`INSERT INTO finance_facility_assets (name, category, location, installed_month, expected_life_years, replacement_cost_cents, model, serial, warranty, vendor, notes, status, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...values).run();
  return { id: result.meta?.last_row_id ?? null };
}

export async function logFacilityService(db, form, actor) {
  const assetId = optionalId(form.asset_id);
  if (assetId) await requireRow(db, 'finance_facility_assets', assetId, 'asset');
  const values = [
    assetId,
    day(form.service_date, 'Date'),
    oneOf(form.service_type, SERVICE_TYPES, 'type'),
    text(form.description, 500, 'What was done', { required: true }),
    text(form.vendor, 160, 'Contractor'),
    parseDollarsToCents(form.cost, 'Cost'),
    String(actor || ''),
  ];
  const result = await db.prepare('INSERT INTO finance_facility_service_log (asset_id, service_date, service_type, description, vendor, cost_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(...values).run();
  return { id: result.meta?.last_row_id ?? null };
}

// Mistakes only: an entry logged against the wrong asset or with a typo. Real history stays.
export async function removeFacilityServiceEntry(db, form) {
  const id = optionalId(form.id);
  if (!id) throw new FacilitiesValidationError('Unknown record.');
  await requireRow(db, 'finance_facility_service_log', id, 'service entry');
  await db.prepare('DELETE FROM finance_facility_service_log WHERE id = ?').bind(id).run();
  return { id };
}

export async function saveFacilityPmTask(db, form, actor) {
  const id = optionalId(form.id);
  const assetId = optionalId(form.asset_id);
  if (assetId) await requireRow(db, 'finance_facility_assets', assetId, 'asset');
  const lastDone = String(form.last_done_on ?? '').trim() ? day(form.last_done_on, 'Last done') : null;
  const values = [
    text(form.name, 160, 'Task', { required: true }),
    text(form.covers, 200, 'Covers'),
    assetId,
    int(form.interval_months, 1, 120, 'Every (months)'),
    lastDone,
    text(form.assignee, 160, 'Who'),
    form.active === '0' ? 0 : 1,
    String(actor || ''),
  ];
  if (id) {
    await requireRow(db, 'finance_facility_pm_tasks', id, 'task');
    await db.prepare(`UPDATE finance_facility_pm_tasks SET name = ?, covers = ?, asset_id = ?, interval_months = ?, last_done_on = ?, assignee = ?, active = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values, id).run();
    return { id };
  }
  const result = await db.prepare('INSERT INTO finance_facility_pm_tasks (name, covers, asset_id, interval_months, last_done_on, assignee, active, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(...values).run();
  return { id: result.meta?.last_row_id ?? null };
}

// Marking a task done logs it to service history and moves the schedule forward. An older date
// (catching up on paperwork) never moves the schedule backward.
export async function markFacilityPmDone(db, form, actor) {
  const id = optionalId(form.id);
  if (!id) throw new FacilitiesValidationError('Unknown task.');
  const task = await db.prepare('SELECT id, name, covers, asset_id, assignee, last_done_on FROM finance_facility_pm_tasks WHERE id = ?').bind(id).first();
  if (!task) throw new FacilitiesValidationError('That task no longer exists.');
  const doneOn = day(form.done_on, 'Done on');
  const cost = parseDollarsToCents(form.cost, 'Cost');
  const note = text(form.note, 300, 'Note');
  const description = note ? `${task.name} · ${note}` : task.name;
  await db.batch([
    db.prepare('INSERT INTO finance_facility_service_log (asset_id, pm_task_id, service_date, service_type, description, vendor, cost_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(task.asset_id ?? null, id, doneOn, 'Preventive', description, task.assignee || '', cost, String(actor || '')),
    db.prepare(`UPDATE finance_facility_pm_tasks SET last_done_on = CASE WHEN last_done_on IS NULL OR last_done_on < ? THEN ? ELSE last_done_on END, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(doneOn, doneOn, String(actor || ''), id),
  ]);
  return { id };
}

export async function saveFacilityProject(db, form, actor) {
  const id = optionalId(form.id);
  const values = [
    text(form.name, 160, 'Project', { required: true }),
    text(form.scope, 600, 'Scope'),
    oneOf(form.status, PROJECT_STATUSES, 'status'),
    month(form.target_month, 'Target / completed'),
    parseDollarsToCents(form.cost, 'Cost'),
    text(form.vendor, 160, 'Contractor'),
    text(form.warranty, 200, 'Warranty'),
    int(form.useful_life_years, 1, 150, 'Useful life', { optional: true }),
    text(form.funding, 200, 'Funding'),
    text(form.notes, 2000, 'Notes'),
    String(actor || ''),
  ];
  if (id) {
    await requireRow(db, 'finance_facility_projects', id, 'project');
    await db.prepare(`UPDATE finance_facility_projects SET name = ?, scope = ?, status = ?, target_month = ?, cost_cents = ?, vendor = ?, warranty = ?, useful_life_years = ?, funding = ?, notes = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values, id).run();
    return { id };
  }
  const result = await db.prepare('INSERT INTO finance_facility_projects (name, scope, status, target_month, cost_cents, vendor, warranty, useful_life_years, funding, notes, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(...values).run();
  return { id: result.meta?.last_row_id ?? null };
}

export const FACILITIES_WRITERS = Object.freeze({
  'facilities-asset-save-v1': { run: saveFacilityAsset, page: 'assets' },
  'facilities-service-log-v1': { run: logFacilityService, page: 'service-history' },
  'facilities-service-remove-v1': { run: removeFacilityServiceEntry, page: 'service-history' },
  'facilities-pm-save-v1': { run: saveFacilityPmTask, page: 'preventive-maintenance' },
  'facilities-pm-done-v1': { run: markFacilityPmDone, page: 'preventive-maintenance' },
  'facilities-project-save-v1': { run: saveFacilityProject, page: 'capital-projects' },
});
