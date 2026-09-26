import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import {
  CREDENTIALS, buildHrView, buildOrgTree, credentialStatus, readHr, recordHrSignature, saveHrCredential,
  saveHrGoal, saveHrPerson, saveHrPolicy, saveHrReview,
} from '../apps/finance/hr-service.js';
import { canEditHr } from '../apps/finance/hr-routes.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';

const migrationSql = readFileSync(new URL('../apps/finance/migrations/0011_finance_hr.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('../apps/finance/migrations/0016_finance_hr_placement.sql', import.meta.url), 'utf8');
const fixtureSql = readFileSync(new URL('../apps/finance/fixtures/0014_synthetic_hr.sql', import.meta.url), 'utf8');

function makeDb({ migrate = true, seed = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  if (migrate) sqlite.exec(migrationSql);
  if (seed) sqlite.exec(fixtureSql);
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  const db = {
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
      return out;
    },
  };
  return { db, sqlite };
}

const TODAY = '2026-09-24';
const person = { requires_background: 1, requires_safe_gatherings: 1, requires_mandated_reporter: 0, requires_cpr: 0 };
const bg = CREDENTIALS.find((c) => c.kind === 'background_check');
const mr = CREDENTIALS.find((c) => c.kind === 'mandated_reporter');

beforeEach(() => resetEnsuredSchemasForTests());

describe('HR calculations', () => {
  it('labels screening as current, due soon, expired, missing, or not required', () => {
    expect(credentialStatus(person, bg, { expires_on: '2027-02-01' }, TODAY)).toMatchObject({ state: 'current', label: 'Current · to Feb 2027' });
    expect(credentialStatus(person, bg, { expires_on: '2026-10-15' }, TODAY)).toMatchObject({ state: 'due', label: 'Due soon · by Oct 2026' });
    expect(credentialStatus(person, bg, { expires_on: '2026-05-01' }, TODAY)).toMatchObject({ state: 'expired', label: 'Expired · May 2026' });
    expect(credentialStatus(person, bg, null, TODAY)).toMatchObject({ state: 'missing' });
    expect(credentialStatus(person, mr, null, TODAY)).toMatchObject({ state: 'not_required', label: 'Not required' });
  });

  it('builds the directory, policies, and org chart from the synthetic fixture', async () => {
    const { db } = makeDb({ seed: true });
    const view = buildHrView(await readHr(db), TODAY, 2026);
    expect(view.staff).toHaveLength(6);
    expect(view.mdoStaff.map((p) => p.full_name)).toEqual(['Synthetic MDO Director']);
    expect(view.employees).toHaveLength(7);
    expect(view.volunteers).toHaveLength(5);
    expect(view.teams.map((t) => [t.name, t.members.length])).toEqual([['VBS', 2], ['Sunday School', 1]]);
    const byName = Object.fromEntries(view.people.map((p) => [p.full_name, p]));
    expect(byName['Rev. Synthetic Pastor'].overall).toBe('current');
    expect(byName['Rev. Synthetic Pastor'].initials).toBe('SP');
    expect(byName['Synthetic Educator'].overall).toBe('due');
    expect(byName['Synthetic Custodian'].overall).toBe('expired');
    expect(byName['Synthetic Nursery Volunteer'].overall).toBe('missing');
    expect(byName['Synthetic Administrator'].benefits).toBe('Self · pension · D&S · 403(b)');
    expect(byName['Rev. Synthetic Pastor'].goalAvg).toBe(48);
    // A signature on an old version does not count toward the current one.
    const handbook = view.policies.find((p) => p.title === 'Employee handbook');
    expect(handbook).toMatchObject({ required: 6, signedCount: 3 });
    expect(handbook.waiting.map((p) => p.full_name)).toContain('Synthetic Custodian');
    expect(view.positions.find((p) => p.title === 'Director of Music').stale).toBe(true);
    expect(view.positions.find((p) => p.title === 'Office Assistant').stale).toBe(true);
    const tree = buildOrgTree(view.people);
    expect(tree).toHaveLength(1);
    expect(tree[0].person.full_name).toBe('Rev. Synthetic Pastor');
    expect(tree[0].reports.map((r) => r.person.position)).toEqual(expect.arrayContaining(['Business Administrator', 'Nursery Volunteer', 'MDO Director']));
  });

  it('never loops on a reporting cycle', () => {
    const people = [{ id: 1, reports_to_id: 2 }, { id: 2, reports_to_id: 1 }, { id: 3, reports_to_id: null }];
    const tree = buildOrgTree(people);
    expect(tree.map((n) => n.person.id)).toEqual([3]);
  });
});

describe('HR writes', () => {
  it('adds and edits a person with validation', async () => {
    const { db, sqlite } = makeDb();
    const { id } = await saveHrPerson(db, { full_name: 'Pat Example', person_group: 'Church staff', position: 'Organist', requires_background: '1', pension: 'on' }, 'office@example.com');
    expect(sqlite.prepare('SELECT requires_background, requires_cpr, pension, updated_by FROM finance_hr_people WHERE id = ?').get(id))
      .toEqual({ requires_background: 1, requires_cpr: 0, pension: 1, updated_by: 'office@example.com' });
    await expect(saveHrPerson(db, { id: String(id), full_name: 'Pat', person_group: 'Church staff', reports_to_id: String(id) })).rejects.toThrow('cannot report to themselves');
    await expect(saveHrPerson(db, { full_name: 'X', person_group: 'Daycare staff' })).rejects.toThrow('Choose a valid group.');
    const mdo = await saveHrPerson(db, { full_name: 'Morgan Example', person_group: 'MDO staff', position: 'MDO Director' });
    const vol = await saveHrPerson(db, { full_name: 'Val Example', person_group: 'Key volunteer', ministry_team: ' VBS ' });
    await saveHrPerson(db, { id: String(id), full_name: 'Pat Example', person_group: 'MDO staff' });
    expect(sqlite.prepare('SELECT person_group FROM finance_hr_people WHERE id = ?').get(mdo.id).person_group).toBe('Church staff');
    const groups = Object.fromEntries((await readHr(db)).people.map((p) => [p.full_name, [p.person_group, p.ministry_team]]));
    expect(groups).toEqual({ 'Morgan Example': ['MDO staff', ''], 'Pat Example': ['MDO staff', ''], 'Val Example': ['Key volunteer', 'VBS'] });
    expect(vol.id).toBeGreaterThan(0);
    await expect(saveHrPerson(db, { full_name: 'X', person_group: 'Church staff', email: 'nope' })).rejects.toThrow('Email must be an email address.');
  });

  it('records a completion with the renewal period, or an explicit expiration', async () => {
    const { db, sqlite } = makeDb({ seed: true });
    await saveHrCredential(db, { person_id: '8', kind: 'background_check', completed_on: '2026-09-20' });
    expect(sqlite.prepare("SELECT expires_on FROM finance_hr_credentials WHERE person_id = 8 AND kind = 'background_check'").get().expires_on).toBe('2029-09-20');
    await saveHrCredential(db, { person_id: '8', kind: 'background_check', completed_on: '2026-09-21', expires_on: '2027-01-01' });
    expect(sqlite.prepare("SELECT completed_on, expires_on FROM finance_hr_credentials WHERE person_id = 8 AND kind = 'background_check'").get()).toEqual({ completed_on: '2026-09-21', expires_on: '2027-01-01' });
    await expect(saveHrCredential(db, { person_id: '8', kind: 'ssn', completed_on: '2026-09-20' })).rejects.toThrow('Choose a valid credential.');
    await expect(saveHrCredential(db, { person_id: '8', kind: 'cpr_first_aid', completed_on: '2026-09-20', expires_on: '2026-01-01' })).rejects.toThrow('before completion');
  });

  it('saves reviews and goals, and asks everyone to re-sign a new policy version', async () => {
    const { db, sqlite } = makeDb({ seed: true });
    await saveHrReview(db, { person_id: '2', review_year: '2026', status: 'Complete' });
    expect(sqlite.prepare('SELECT status FROM finance_hr_reviews WHERE person_id = 2 AND review_year = 2026').get().status).toBe('Complete');
    const goal = await saveHrGoal(db, { person_id: '2', review_year: '2026', goal: 'Grow mentor team', progress_pct: '10' });
    await saveHrGoal(db, { id: String(goal.id), goal: 'Grow mentor team', progress_pct: '80' });
    expect(sqlite.prepare('SELECT progress_pct FROM finance_hr_goals WHERE id = ?').get(goal.id).progress_pct).toBe(80);
    await saveHrGoal(db, { id: String(goal.id), goal: 'x', remove: '1' });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_hr_goals WHERE id = ?').get(goal.id).n).toBe(0);
    await recordHrSignature(db, { policy_id: '3', person_id: '6', signed_on: '2026-09-01' });
    await saveHrPolicy(db, { id: '3', title: 'Harassment prevention', version_label: 'Revised Sep 2026', applies_to: 'staff' });
    const view = buildHrView(await readHr(db), TODAY, 2026);
    expect(view.policies.find((p) => p.id === 3).signedCount).toBe(0);
  });
});

describe('HR routes and pages', () => {
  const admin = { role: 'admin', identity: 'office@example.com', permissions: { finance: 'edit', giving: 'edit' } };
  const envFor = (role, db) => ({
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: { fetch: async () => new Response(JSON.stringify(role)) },
  });
  const get = async (query, role, db) => worker.fetch(new Request(`https://finance.test/?section=hr${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), envFor(role, db));

  it('is admin-only for both reading and editing', async () => {
    const { db } = makeDb({ seed: true });
    expect(canEditHr({ ok: true, role: 'admin' })).toBe(true);
    expect(canEditHr({ ok: true, role: 'finance', permissions: { finance: 'edit' } })).toBe(false);
    const denied = await get('', { role: 'finance', permissions: { finance: 'edit', giving: 'edit' } }, db);
    expect(denied.status).toBe(403);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/hr/person-save', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ full_name: 'X', person_group: 'Church staff' }),
    }), envFor({ role: 'finance', permissions: { finance: 'edit', giving: 'edit' } }, db));
    expect(res.headers.get('Location')).toContain('reason=access_denied');
  });

  it('creates its own tables on first use, then saves and shows a new person', async () => {
    const { db, sqlite } = makeDb({ migrate: false });
    const empty = await (await get('', admin, db)).text();
    expect(empty).toContain('No staff or key volunteers on record yet.');
    const res = await worker.fetch(new Request('https://finance.test/api/v1/hr/person-save', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ full_name: 'Pat Example', person_group: 'Church staff', position: 'Organist' }),
    }), envFor(admin, db));
    expect(res.headers.get('Location')).toBe('/?section=hr&page=directory&status=ok&person=1');
    expect(sqlite.prepare('SELECT full_name FROM finance_hr_people').get().full_name).toBe('Pat Example');
    const record = await (await get('&page=directory&person=1&status=ok', admin, db)).text();
    expect(record).toContain('<h2>Pat Example</h2>');
    expect(record).toContain('Stored as dates and status only');
  });

  it('renders every HR page from the fixture, pointing daycare staff to myMDO', async () => {
    const { db } = makeDb({ seed: true });
    const pages = {
      directory: 'Items needing attention', 'org-chart': 'Job descriptions', reviews: 'annual reviews', checks: 'Background check (3 yrs)',
      trainings: 'Mandated reporter (2 yrs)', policies: 'Waiting on', benefits: 'Recent changes', volunteers: 'Not yet screened',
    };
    for (const [page, text] of Object.entries(pages)) {
      const html = await (await get(`&page=${page}`, admin, db)).text();
      expect(html, page).toContain(text);
    }
    expect(await (await get('&page=directory', admin, db)).text()).toContain('kept in <a href="https://mdo.timothystl.org">myMDO</a>');
    const org = await (await get('&page=org-chart', admin, db)).text();
    expect(org).toContain('<div class="org-node mdo"><b>Synthetic MDO Director</b>');
    expect(org).toContain('<summary><b>VBS</b><small>2 volunteers</small></summary>');
    expect(org).toContain('MDO staff');
    const trainings = await (await get('&page=trainings', admin, db)).text();
    expect(trainings).toContain('<a href="https://ministrysafe.com" target="_blank" rel="noopener">MinistrySafe</a>');
    expect(trainings).not.toContain('Safe Gatherings');
    const vbs = await (await get('&page=volunteers&team=VBS', admin, db)).text();
    expect(vbs).toContain('Synthetic VBS Helper');
    expect(vbs).not.toContain('Synthetic Counter');
    const reviews2025 = await (await get('&page=reviews&review_year=2025', admin, db)).text();
    expect(reviews2025).toContain('2025 annual reviews');
  });
});
