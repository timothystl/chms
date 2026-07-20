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
    photo_url TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(readFileSync(new URL('../migrations/0020_scheduler_volunteers.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
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
  const env = { DB: db, ADMIN_PASSWORD };
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
