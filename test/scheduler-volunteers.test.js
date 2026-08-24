import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleSchedulerVolunteersApi } from '../src/api-scheduler.js';
import { authCookieHeader } from '../src/auth.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as test/finance-church.test.js —
// runs against real SQL (real ON CONFLICT/UNIQUE semantics) instead of a hand-rolled mock.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    photo_url TEXT NOT NULL DEFAULT '',
    breeze_id TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    member_type TEXT NOT NULL DEFAULT 'visitor',
    first_contact_date TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE scheduler_data (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(readFileSync(new URL('../migrations/0020_scheduler_volunteers.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0021_scheduler_volunteers_legacy_id.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}

const ADMIN_PASSWORD = 'test-secret';

async function makeEnvAndReq(db) {
  const env = { DB: db, ADMIN_PASSWORD, SESSION_SECRET: ADMIN_PASSWORD };
  const cookie = await authCookieHeader(env, 'admin', '');
  const req = { headers: new Map([['cookie', cookie]]) };
  req.headers.get = Map.prototype.get.bind(req.headers);
  return { env, req };
}

function makeUrl(pathAndQuery) {
  return new URL('https://chms.example.com/admin/api/scheduler/volunteers' + pathAndQuery);
}

describe('handleSchedulerVolunteersApi', () => {
  let db, env, req;

  beforeEach(async () => {
    db = makeTestDb();
    db._raw.prepare(`INSERT INTO people (id, first_name, last_name, email) VALUES (1, 'Frank', 'Kohn', 'frank.kohn@lcms.org')`).run();
    db._raw.prepare(`INSERT INTO people (id, first_name, last_name, email) VALUES (2, 'Judith', 'Meyer', 'judith@example.com')`).run();
    ({ env, req } = await makeEnvAndReq(db));
  });

  it('rejects unauthenticated requests', async () => {
    const anonReq = { headers: new Map() };
    anonReq.headers.get = Map.prototype.get.bind(anonReq.headers);
    const res = await handleSchedulerVolunteersApi(anonReq, env, makeUrl(''), 'GET');
    expect(res.status).toBe(403);
  });

  it('creates a volunteer link to a real person and lists it', async () => {
    const createRes = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ person_id: 1, roles: ['Elder', 'Lector'], service_preference: '8am' }) },
      env, makeUrl(''), 'POST'
    );
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.ok).toBe(true);
    expect(created.volunteer.first_name).toBe('Frank');
    expect(created.volunteer.roles).toEqual(['Elder', 'Lector']);
    expect(created.volunteer.service_preference).toBe('8am');
    expect(created.volunteer.active).toBe(true);

    const listRes = await handleSchedulerVolunteersApi(req, env, makeUrl(''), 'GET');
    const listed = await listRes.json();
    expect(listed.volunteers.length).toBe(1);
    expect(listed.volunteers[0].person_id).toBe(1);
    expect(listed.volunteers[0].last_name).toBe('Kohn');
  });

  it('rejects linking a nonexistent person', async () => {
    const res = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ person_id: 999 }) },
      env, makeUrl(''), 'POST'
    );
    expect(res.status).toBe(404);
  });

  it('upserts on re-POST for the same person_id instead of duplicating', async () => {
    await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ person_id: 1, roles: ['Elder'] }) }, env, makeUrl(''), 'POST'
    );
    await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ person_id: 1, roles: ['Elder', 'Acolyte'] }) }, env, makeUrl(''), 'POST'
    );
    const listRes = await handleSchedulerVolunteersApi(req, env, makeUrl(''), 'GET');
    const listed = await listRes.json();
    expect(listed.volunteers.length).toBe(1);
    expect(listed.volunteers[0].roles).toEqual(['Elder', 'Acolyte']);
  });

  it('sparse-updates only the fields provided via PATCH', async () => {
    await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ person_id: 2, roles: ['PowerPoint'], service_preference: 'both' }) },
      env, makeUrl(''), 'POST'
    );
    const patchRes = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ blackout_dates: ['2026-12-25'] }) },
      env, makeUrl('/2'), 'PATCH'
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.volunteer.blackout_dates).toEqual(['2026-12-25']);
    // Untouched fields survive the sparse update
    expect(patched.volunteer.roles).toEqual(['PowerPoint']);
    expect(patched.volunteer.service_preference).toBe('both');
  });

  it('404s a PATCH for a person with no volunteer link', async () => {
    const res = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ roles: ['Elder'] }) }, env, makeUrl('/2'), 'PATCH'
    );
    expect(res.status).toBe(404);
  });

  it('soft-deletes via DELETE, excluding from the default active list but keeping the row', async () => {
    await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ person_id: 1, roles: ['Elder'] }) }, env, makeUrl(''), 'POST'
    );
    const delRes = await handleSchedulerVolunteersApi(req, env, makeUrl('/1'), 'DELETE');
    expect(delRes.status).toBe(200);

    const activeList = await (await handleSchedulerVolunteersApi(req, env, makeUrl(''), 'GET')).json();
    expect(activeList.volunteers.length).toBe(0);

    const allList = await (await handleSchedulerVolunteersApi(req, env, makeUrl('?active=all'), 'GET')).json();
    expect(allList.volunteers.length).toBe(1);
    expect(allList.volunteers[0].active).toBe(false);
  });

  it('404s DELETE for a person with no volunteer link', async () => {
    const res = await handleSchedulerVolunteersApi(req, env, makeUrl('/1'), 'DELETE');
    expect(res.status).toBe(404);
  });
});

// ── SC6 Phase 2: legacy migration preview/commit ──────────────────────────
describe('handleSchedulerVolunteersApi — migration preview/commit', () => {
  let db, env, req;

  function seedLegacy(entries) {
    db._raw.prepare(`INSERT INTO scheduler_data (key, value) VALUES ('ws_people', ?)`).run(JSON.stringify(entries));
  }

  beforeEach(async () => {
    db = makeTestDb();
    db._raw.prepare(`INSERT INTO people (id, first_name, last_name, email, breeze_id) VALUES (1, 'Frank', 'Kohn', 'frank.kohn@lcms.org', 'bz-100')`).run();
    db._raw.prepare(`INSERT INTO people (id, first_name, last_name, email) VALUES (2, 'Judith', 'Meyer', 'judith@example.com')`).run();
    // Two real people who happen to share a name — the ambiguous-match case.
    db._raw.prepare(`INSERT INTO people (id, first_name, last_name, email) VALUES (3, 'John', 'Hawkins', 'john.h1@example.com')`).run();
    db._raw.prepare(`INSERT INTO people (id, first_name, last_name, email) VALUES (4, 'John', 'Hawkins', 'john.h2@example.com')`).run();
    ({ env, req } = await makeEnvAndReq(db));
  });

  it('matches by breezePersonId first, ahead of a name match', async () => {
    seedLegacy([{ id: 'lg1', name: 'Frank Kohn', email: 'frank.kohn@lcms.org', breezePersonId: 'bz-100', roles: ['Elder'] }]);
    const res = await handleSchedulerVolunteersApi(req, env, makeUrl('/migration-preview'), 'GET');
    const body = await res.json();
    expect(body.pending.length).toBe(1);
    expect(body.pending[0].match.confidence).toBe('breeze_id');
    expect(body.pending[0].match.suggested.id).toBe(1);
  });

  it('falls back to an exact name match with no breezePersonId', async () => {
    seedLegacy([{ id: 'lg2', name: 'Judith Meyer', email: 'judith@example.com', roles: ['PowerPoint'] }]);
    const body = await (await handleSchedulerVolunteersApi(req, env, makeUrl('/migration-preview'), 'GET')).json();
    expect(body.pending[0].match.confidence).toBe('exact_name');
    expect(body.pending[0].match.suggested.id).toBe(2);
  });

  it('flags an ambiguous match (two real people share the legacy name) without guessing', async () => {
    seedLegacy([{ id: 'lg3', name: 'John Hawkins', email: '', roles: [] }]);
    const body = await (await handleSchedulerVolunteersApi(req, env, makeUrl('/migration-preview'), 'GET')).json();
    expect(body.pending[0].match.confidence).toBe('ambiguous_name');
    expect(body.pending[0].match.suggested).toBeNull();
    expect(body.pending[0].match.candidates.length).toBe(2);
  });

  it('reports no match for a name with no corresponding person', async () => {
    seedLegacy([{ id: 'lg4', name: 'Nobody Real', email: '', roles: [] }]);
    const body = await (await handleSchedulerVolunteersApi(req, env, makeUrl('/migration-preview'), 'GET')).json();
    expect(body.pending[0].match.confidence).toBe('none');
    expect(body.pending[0].match.suggested).toBeNull();
  });

  it('excludes already-migrated legacy ids from the preview', async () => {
    seedLegacy([{ id: 'lg1', name: 'Frank Kohn', breezePersonId: 'bz-100', roles: ['Elder'] }]);
    await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ mappings: [{ legacy_id: 'lg1', action: 'link', person_id: 1 }] }) },
      env, makeUrl('/migration-commit'), 'POST'
    );
    const body = await (await handleSchedulerVolunteersApi(req, env, makeUrl('/migration-preview'), 'GET')).json();
    expect(body.pending.length).toBe(0);
    expect(body.already_migrated_count).toBe(1);
  });

  it('commits a "link" mapping using the legacy blob\'s own data, not client-supplied data', async () => {
    seedLegacy([{ id: 'lg1', name: 'Frank Kohn', roles: ['Elder', 'Lector'], servicePreference: '8am', preferredSundays: [1, 3] }]);
    const res = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ mappings: [{ legacy_id: 'lg1', action: 'link', person_id: 1, roles: ['SHOULD_BE_IGNORED'] }] }) },
      env, makeUrl('/migration-commit'), 'POST'
    );
    const body = await res.json();
    expect(body.linked).toBe(1);

    const listed = await (await handleSchedulerVolunteersApi(req, env, makeUrl('?active=all'), 'GET')).json();
    const v = listed.volunteers.find(function(x) { return x.person_id === 1; });
    expect(v.roles).toEqual(['Elder', 'Lector']);
    expect(v.service_preference).toBe('8am');
    expect(v.preferred_sundays).toEqual([1, 3]);
    expect(v.migrated_from_legacy_id).toBe('lg1');
  });

  it('commits a "create" mapping by making a new person record', async () => {
    seedLegacy([{ id: 'lg5', name: 'Brand New', email: 'brand.new@example.com', roles: ['Acolyte'] }]);
    const res = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ mappings: [{ legacy_id: 'lg5', action: 'create' }] }) },
      env, makeUrl('/migration-commit'), 'POST'
    );
    const body = await res.json();
    expect(body.created).toBe(1);
    const newPerson = db._raw.prepare(`SELECT * FROM people WHERE email='brand.new@example.com'`).get();
    expect(newPerson.first_name).toBe('Brand');
    expect(newPerson.last_name).toBe('New');
    const listed = await (await handleSchedulerVolunteersApi(req, env, makeUrl('?active=all'), 'GET')).json();
    expect(listed.volunteers.find(function(v) { return v.person_id === newPerson.id; }).roles).toEqual(['Acolyte']);
  });

  it('skips a mapping with action "skip"', async () => {
    seedLegacy([{ id: 'lg6', name: 'Skip Me', roles: [] }]);
    const res = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ mappings: [{ legacy_id: 'lg6', action: 'skip' }] }) },
      env, makeUrl('/migration-commit'), 'POST'
    );
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.linked).toBe(0);
  });

  it('refuses to link two different legacy volunteers to the same person', async () => {
    seedLegacy([
      { id: 'lg1', name: 'Frank Kohn', roles: ['Elder'] },
      { id: 'lg7', name: 'Someone Else', roles: ['Lector'] },
    ]);
    await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ mappings: [{ legacy_id: 'lg1', action: 'link', person_id: 1 }] }) },
      env, makeUrl('/migration-commit'), 'POST'
    );
    const res = await handleSchedulerVolunteersApi(
      { ...req, json: async () => ({ mappings: [{ legacy_id: 'lg7', action: 'link', person_id: 1 }] }) },
      env, makeUrl('/migration-commit'), 'POST'
    );
    const body = await res.json();
    expect(body.linked).toBe(0);
    expect(body.errors.length).toBe(1);
    expect(body.errors[0].legacy_id).toBe('lg7');
  });
});
