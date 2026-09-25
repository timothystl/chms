import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import {
  FacilitiesValidationError, addMonthsToDay, assetLife, buildFacilitiesView, logFacilityService,
  markFacilityPmDone, parseDollarsToCents, pmSchedule, readFacilities, saveFacilityAsset,
  saveFacilityPmTask, saveFacilityProject,
} from '../apps/finance/facilities-service.js';
import { canEditFacilities, isSameOriginPost } from '../apps/finance/facilities-routes.js';

const migrationSql = readFileSync(new URL('../apps/finance/migrations/0010_finance_facilities.sql', import.meta.url), 'utf8');
const fixtureSql = readFileSync(new URL('../apps/finance/fixtures/0013_synthetic_facilities.sql', import.meta.url), 'utf8');

// A D1-shaped wrapper around node:sqlite so the real migration SQL and queries run.
function makeDb({ seed = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(migrationSql);
  if (seed) sqlite.exec(fixtureSql);
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  const db = {
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, sqlite };
}

const TODAY = '2026-09-24';

describe('Facilities calculations', () => {
  it('computes asset life used and flags near-end and past-life assets', () => {
    expect(assetLife({ installed_month: '2009-06', expected_life_years: 20 }, TODAY)).toMatchObject({ state: 'near' });
    expect(Math.round(assetLife({ installed_month: '2009-06', expected_life_years: 20 }, TODAY).pctUsed)).toBe(86);
    expect(assetLife({ installed_month: '2001-03', expected_life_years: 25 }, TODAY).state).toBe('past');
    expect(assetLife({ installed_month: '2019-06', expected_life_years: 25 }, TODAY).state).toBe('ok');
  });

  it('schedules maintenance from the last completion and clamps month ends', () => {
    expect(addMonthsToDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDay('2025-10-02', 12)).toBe('2026-10-02');
    expect(pmSchedule({ last_done_on: '2026-02-20', interval_months: 6 }, TODAY)).toMatchObject({ nextDue: '2026-08-20', state: 'overdue', daysUntil: -35 });
    expect(pmSchedule({ last_done_on: '2026-08-28', interval_months: 1 }, TODAY).state).toBe('soon');
    expect(pmSchedule({ last_done_on: '2025-11-06', interval_months: 12 }, TODAY).state).toBe('scheduled');
    expect(pmSchedule({ last_done_on: null, interval_months: 3 }, TODAY).state).toBe('never');
  });

  it('parses dollar input into whole cents and refuses anything else', () => {
    expect(parseDollarsToCents('$1,234.50', 'Cost')).toBe(123450);
    expect(parseDollarsToCents('', 'Cost')).toBe(0);
    expect(() => parseDollarsToCents('12.345', 'Cost')).toThrow(FacilitiesValidationError);
    expect(() => parseDollarsToCents('-5', 'Cost')).toThrow(FacilitiesValidationError);
  });

  it('builds the overview from the synthetic fixture', async () => {
    const { db } = makeDb({ seed: true });
    const view = buildFacilitiesView(await readFacilities(db), TODAY);
    expect(view.assets).toHaveLength(8);
    expect(view.nearEnd.map((a) => a.name)[0]).toBe('Synthetic walk-in cooler');
    expect(view.overdue.map((t) => t.name)).toEqual(['Roof inspection, spring & fall', 'Playground safety check']);
    expect(view.capitalByYear.map((y) => y.cents)).toEqual([6200000, 21000000, 14500000, 2800000, 0]);
    expect(view.largestPlanned.name).toBe('Synthetic sanctuary roof replacement');
    expect(view.projects.map((p) => p.status)).toEqual(['In progress', 'Planned', 'Planned', 'Planned', 'Completed']);
    expect(view.service[0].assetName).toBe('Synthetic passenger elevator');
  });
});

describe('Facilities writes', () => {
  it('creates and updates an asset, validating every field', async () => {
    const { db, sqlite } = makeDb();
    const form = { name: 'Boiler #2', category: 'Boilers', location: 'Mechanical room', installed_month: '2014-09', expected_life_years: '25', replacement_cost: '38,000' };
    const { id } = await saveFacilityAsset(db, form, 'office@example.com');
    expect(sqlite.prepare('SELECT name, replacement_cost_cents, updated_by, status FROM finance_facility_assets WHERE id = ?').get(id))
      .toEqual({ name: 'Boiler #2', replacement_cost_cents: 3800000, updated_by: 'office@example.com', status: 'active' });
    await saveFacilityAsset(db, { ...form, id: String(id), status: 'retired' }, 'office@example.com');
    expect(sqlite.prepare('SELECT status FROM finance_facility_assets WHERE id = ?').get(id).status).toBe('retired');
    await expect(saveFacilityAsset(db, { ...form, category: 'Spaceships' })).rejects.toThrow('Choose a valid category.');
    await expect(saveFacilityAsset(db, { ...form, installed_month: '2014-13' })).rejects.toThrow(FacilitiesValidationError);
    await expect(saveFacilityAsset(db, { ...form, name: '  ' })).rejects.toThrow('Name is required.');
    await expect(saveFacilityAsset(db, { ...form, id: '999' })).rejects.toThrow('That asset no longer exists.');
  });

  it('logs service against an asset or the campus in general', async () => {
    const { db, sqlite } = makeDb({ seed: true });
    await logFacilityService(db, { asset_id: '3', service_date: '2026-09-20', service_type: 'Repair', description: 'Replaced gasket', cost: '240' });
    await logFacilityService(db, { asset_id: '', service_date: '2026-09-21', service_type: 'Inspection', description: 'Walkthrough' });
    expect(sqlite.prepare("SELECT asset_id, cost_cents FROM finance_facility_service_log WHERE description IN ('Replaced gasket','Walkthrough') ORDER BY id").all())
      .toEqual([{ asset_id: 3, cost_cents: 24000 }, { asset_id: null, cost_cents: 0 }]);
    await expect(logFacilityService(db, { service_date: '2026-02-30', service_type: 'Repair', description: 'x' })).rejects.toThrow('Date must be a date.');
    await expect(logFacilityService(db, { asset_id: '77', service_date: '2026-09-20', service_type: 'Repair', description: 'x' })).rejects.toThrow('That asset no longer exists.');
  });

  it('marks maintenance done: logs history and never moves the schedule backward', async () => {
    const { db, sqlite } = makeDb({ seed: true });
    await markFacilityPmDone(db, { id: '4', done_on: '2026-09-22', note: 'south slope ok' }, 'office@example.com');
    expect(sqlite.prepare('SELECT last_done_on FROM finance_facility_pm_tasks WHERE id = 4').get().last_done_on).toBe('2026-09-22');
    expect(sqlite.prepare('SELECT asset_id, pm_task_id, service_type, description FROM finance_facility_service_log WHERE pm_task_id = 4').get())
      .toEqual({ asset_id: 5, pm_task_id: 4, service_type: 'Preventive', description: 'Roof inspection, spring & fall · south slope ok' });
    await markFacilityPmDone(db, { id: '4', done_on: '2026-03-01' });
    expect(sqlite.prepare('SELECT last_done_on FROM finance_facility_pm_tasks WHERE id = 4').get().last_done_on).toBe('2026-09-22');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_service_log WHERE pm_task_id = 4').get().n).toBe(2);
    await expect(markFacilityPmDone(db, { id: '99', done_on: '2026-09-22' })).rejects.toThrow('That task no longer exists.');
  });

  it('saves maintenance tasks and capital projects', async () => {
    const { db, sqlite } = makeDb();
    const task = await saveFacilityPmTask(db, { name: 'Backflow test', interval_months: '12', last_done_on: '' });
    expect(sqlite.prepare('SELECT last_done_on, active FROM finance_facility_pm_tasks WHERE id = ?').get(task.id)).toEqual({ last_done_on: null, active: 1 });
    await expect(saveFacilityPmTask(db, { name: 'x', interval_months: '0' })).rejects.toThrow('Every (months) must be a whole number from 1 to 120.');
    const project = await saveFacilityProject(db, { name: 'Tuckpointing', status: 'Planned', target_month: '2027-09', cost: '48000', useful_life_years: '' });
    expect(sqlite.prepare('SELECT cost_cents, useful_life_years FROM finance_facility_projects WHERE id = ?').get(project.id)).toEqual({ cost_cents: 4800000, useful_life_years: null });
    await expect(saveFacilityProject(db, { name: 'x', status: 'Dreaming', target_month: '2027-09', cost: '1' })).rejects.toThrow('Choose a valid status.');
  });
});

describe('Facilities routes and pages', () => {
  const adminRole = { role: 'admin', identity: 'office@example.com', permissions: { finance: 'edit', giving: 'edit' } };
  function envFor(role, db) {
    return {
      ENVIRONMENT: 'staging', RELEASE_SHA: 'test', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: { fetch: async () => (role ? new Response(JSON.stringify(role)) : new Response('{}', { status: 403 })) },
    };
  }
  const post = (path, fields, headers = {}) => new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin', Origin: 'https://finance.test', ...headers },
    body: new URLSearchParams(fields),
  });

  it('decides who may edit and which posts count as same-origin', () => {
    expect(canEditFacilities({ ok: true, role: 'admin' })).toBe(true);
    expect(canEditFacilities({ ok: true, role: 'finance', permissions: { finance: 'edit' } })).toBe(true);
    expect(canEditFacilities({ ok: true, role: 'finance', permissions: { finance: 'view' } })).toBe(false);
    expect(canEditFacilities({ ok: true, role: 'council', permissions: { finance: 'edit' } })).toBe(false);
    expect(canEditFacilities({ ok: false, reason: 'not_configured' })).toBe(false);
    const url = new URL('https://finance.test/api/v1/facilities/asset-save');
    const req = (headers) => new Request(url, { method: 'POST', headers });
    expect(isSameOriginPost(req({ 'Sec-Fetch-Site': 'same-origin', Origin: 'https://finance.test' }), url)).toBe(true);
    expect(isSameOriginPost(req({ 'Sec-Fetch-Site': 'cross-site' }), url)).toBe(false);
    expect(isSameOriginPost(req({ Origin: 'https://evil.example' }), url)).toBe(false);
    expect(isSameOriginPost(req({ Origin: 'null' }), url)).toBe(false);
    // A no-referrer page's own post: Origin is null but Fetch Metadata says same-origin.
    expect(isSameOriginPost(req({ 'Sec-Fetch-Site': 'same-origin', Origin: 'null' }), url)).toBe(true);
    expect(isSameOriginPost(req({ 'Sec-Fetch-Site': 'same-site', Origin: 'https://finance.test' }), url)).toBe(false);
  });

  it('saves through the form post for an admin and redirects to the new asset', async () => {
    const { db, sqlite } = makeDb();
    const res = await worker.fetch(post('/api/v1/facilities/asset-save', { name: 'Walk-in cooler', category: 'Kitchen', installed_month: '2011-04', expected_life_years: '15' }), envFor(adminRole, db));
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?section=facilities&page=assets&status=ok&asset=1');
    expect(sqlite.prepare('SELECT updated_by FROM finance_facility_assets').get().updated_by).toBe('office@example.com');
  });

  it('refuses cross-site posts, unverified callers, and view-only roles without writing', async () => {
    const { db, sqlite } = makeDb();
    const fields = { name: 'x', category: 'Kitchen', installed_month: '2011-04', expected_life_years: '15' };
    const cross = await worker.fetch(post('/api/v1/facilities/asset-save', fields, { 'Sec-Fetch-Site': 'cross-site' }), envFor(adminRole, db));
    expect(cross.headers.get('Location')).toContain('reason=cross_site');
    const unverified = await worker.fetch(post('/api/v1/facilities/asset-save', fields), envFor(null, db));
    expect(unverified.headers.get('Location')).toContain('reason=access_denied');
    const viewer = await worker.fetch(post('/api/v1/facilities/asset-save', fields), envFor({ role: 'finance', permissions: { finance: 'view', giving: 'view' } }, db));
    expect(viewer.headers.get('Location')).toContain('reason=access_denied');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_assets').get().n).toBe(0);
    expect((await worker.fetch(new Request('https://finance.test/api/v1/facilities/asset-save'), envFor(adminRole, db))).status).toBe(405);
  });

  it('reports validation errors back on the page', async () => {
    const { db } = makeDb();
    const res = await worker.fetch(post('/api/v1/facilities/service-log', { service_date: '2026-09-20', service_type: 'Repair', description: '' }), envFor(adminRole, db));
    const location = res.headers.get('Location');
    expect(location).toContain('page=service-history');
    const page = await (await worker.fetch(new Request(`https://finance.test${location}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), envFor(adminRole, db))).text();
    expect(page).toContain('<p class="status status-error">What was done is required. Nothing was saved.</p>');
  });

  it('renders every page, with editing forms only for editors', async () => {
    const { db } = makeDb({ seed: true });
    const get = async (query, role) => (await worker.fetch(new Request(`https://finance.test/?section=facilities${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), envFor(role, db))).text();
    const overview = await get('', adminRole);
    expect(overview).toContain('Assets on record');
    expect(overview).toContain('Nearing end of useful life');
    expect(overview).toContain('Capital plan by year');
    const assets = await get('&page=assets&category=HVAC', adminRole);
    expect(assets).toContain('Synthetic RTU #1');
    expect(assets).not.toContain('Synthetic Boiler #1');
    expect(assets).toContain('action="/api/v1/facilities/asset-save"');
    const detail = await get('&page=assets&asset=3', adminRole);
    expect(detail).toContain('Circulator pump replaced');
    expect(detail).toContain('Edit this asset');
    const pm = await get('&page=preventive-maintenance', adminRole);
    expect(pm).toContain('action="/api/v1/facilities/pm-done"');
    expect(pm).not.toContain('<h2>Edit: ');
    const editing = await get('&page=preventive-maintenance&edit=2', adminRole);
    expect(editing).toContain('<h2>Edit: Boiler fall start-up &amp; cleaning</h2>');
    const viewer = { role: 'finance', permissions: { finance: 'view', giving: 'view' } };
    for (const page of ['assets', 'service-history', 'capital-projects', 'preventive-maintenance']) {
      const html = await get(`&page=${page}`, viewer);
      expect(html, page).not.toContain('<form method="POST"');
    }
    // Page text from the database is escaped.
    await saveFacilityAsset(db, { name: '<script>x</script>', category: 'Other', installed_month: '2020-01', expected_life_years: '10' });
    expect(await get('&page=assets', adminRole)).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('shows an honest unavailable page when the tables cannot be read', async () => {
    const broken = { prepare: () => ({}), batch: async () => { throw new Error('no such table'); } };
    const html = await (await worker.fetch(new Request('https://finance.test/?section=facilities', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), envFor(adminRole, broken))).text();
    expect(html).toContain('Facilities records could not be read for this request');
  });
});
