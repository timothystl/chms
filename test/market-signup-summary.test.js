import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  handleChristmasMarketSummary, buildMarketSummary, marketShiftLabel,
} from '../src/api-scheduler.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as
// test/scheduler-volunteers.test.js — real SQL, not a hand-rolled mock.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE serve_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_time_slots INTEGER NOT NULL DEFAULT 1,
    slug TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE serve_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    slots INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    role_date TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    lead TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    role_id INTEGER,
    ministry TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE signup_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signup_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL
  )`);
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
    _raw: sqlite,
  };
}

const KEY = 'test-intake-key';

function reqWith(key) {
  const headers = new Map(key === undefined ? [] : [['X-Intake-Key', key]]);
  headers.get = Map.prototype.get.bind(headers);
  return { headers };
}

function seedMarket(db, { hidden = 0, slug = 'christmasmarket' } = {}) {
  const s = db._raw;
  s.prepare('INSERT INTO serve_events (name,hidden,slug) VALUES (?,?,?)')
    .run('Christmas Market', hidden, slug);
  const evId = 1;
  // Two "Parking" shifts on market day plus a setup-day role, so grouping,
  // labeling and per-shift counting are all exercised.
  const ins = 'INSERT INTO serve_roles (event_id,name,slots,sort_order,role_date,start_time,end_time,lead) VALUES (?,?,?,?,?,?,?,?)';
  // "Set up tents" deliberately has no lead: blank is a real state, and the caller
  // prints it as Unassigned rather than being handed a guess.
  s.prepare(ins).run(evId, 'Set up tents', 4, 0, '2026-12-04', '9:00 AM', '11:00 AM', '');
  s.prepare(ins).run(evId, 'Parking', 2, 1, '2026-12-05', '8:30 AM', '11:00 AM', 'Rick Vogel');
  s.prepare(ins).run(evId, 'Parking', 2, 2, '2026-12-05', '11:00 AM', '2:30 PM', 'Rick Vogel');
  return evId;
}

function addVolunteer(db, evId, name, email, roleIds) {
  const s = db._raw;
  const r = s.prepare('INSERT INTO signups (event_id,name,email) VALUES (?,?,?)').run(evId, name, email);
  for (const rid of roleIds) {
    s.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').run(Number(r.lastInsertRowid), rid);
  }
}

describe('GET /api/signups/christmasmarket/summary', () => {
  let db, env;
  beforeEach(() => {
    db = makeTestDb();
    env = { DB: db, CHMS_INTAKE_API_KEY: KEY };
  });

  it('refuses a request with no shared secret', async () => {
    seedMarket(db);
    const res = await handleChristmasMarketSummary(reqWith(undefined), env);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong shared secret', async () => {
    seedMarket(db);
    const res = await handleChristmasMarketSummary(reqWith('nope'), env);
    expect(res.status).toBe(401);
  });

  it('answers 503 rather than serving PII when the key is unset on this Worker', async () => {
    seedMarket(db);
    const res = await handleChristmasMarketSummary(reqWith(KEY), { DB: db });
    expect(res.status).toBe(503);
  });

  it('returns a valid empty shape with a 200 when the event does not exist', async () => {
    const res = await handleChristmasMarketSummary(reqWith(KEY), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ open: false, signedUp: 0, openShifts: 0, roles: [] });
  });

  it('groups shifts under one role name and counts people, not shifts', async () => {
    const evId = seedMarket(db);
    addVolunteer(db, evId, 'Ray Stoltz', 'ray@example.com', [2, 3]); // both Parking shifts
    addVolunteer(db, evId, 'Ann Weber', 'ann@example.com', [2]);
    addVolunteer(db, evId, 'Bo Katz', 'bo@example.com', [3]);

    const res = await handleChristmasMarketSummary(reqWith(KEY), env);
    const d = await res.json();

    expect(d.open).toBe(true);
    // Three people, five shift-slots between them.
    expect(d.signedUp).toBe(3);

    const parking = d.roles.find(r => r.name === 'Parking');
    expect(parking.shifts).toHaveLength(2);
    expect(parking.shifts[0].needed).toBe(2);
    expect(parking.shifts[0].filled).toBe(2);
    expect(parking.shifts[0].people.map(p => p.email).sort())
      .toEqual(['ann@example.com', 'ray@example.com']);
    expect(parking.shifts[1].filled).toBe(2);

    // Only "Set up tents" (0 of 4) is still short-handed.
    expect(d.openShifts).toBe(1);
    const tents = d.roles.find(r => r.name === 'Set up tents');
    expect(tents.shifts[0]).toMatchObject({ needed: 4, filled: 0, people: [] });
  });

  it('sends structured start, end and date alongside the label, as wall clocks', async () => {
    seedMarket(db);
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    const parking = d.roles.find(r => r.name === 'Parking');

    expect(parking.shifts[0]).toMatchObject({
      date: '2026-12-05', start: '8:30 AM', end: '11:00 AM',
    });
    expect(parking.shifts[1]).toMatchObject({
      date: '2026-12-05', start: '11:00 AM', end: '2:30 PM',
    });
    // The setup day is a different date, which is what lets the caller draw a
    // Friday/Saturday switch at all.
    const tents = d.roles.find(r => r.name === 'Set up tents');
    expect(tents.shifts[0].date).toBe('2026-12-04');

    // The label is the fallback and must survive alongside the structured fields.
    expect(parking.shifts[0].label).toBe('Sat, Dec 5, 8:30 AM – 11:00 AM');
  });

  it('never sends a UTC instant or an offset in a time', async () => {
    seedMarket(db);
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    for (const role of d.roles) {
      for (const sh of role.shifts) {
        // A trailing Z or a +HH:MM offset would be read as a wall clock by the
        // caller and drawn hours away from when the crew is actually asked to be
        // there. Wall clock only, forever.
        expect(sh.start).not.toMatch(/Z$|[+-]\d{2}:\d{2}$/);
        expect(sh.end).not.toMatch(/Z$|[+-]\d{2}:\d{2}$/);
      }
    }
  });

  it('sends the job lead on the group and on each shift', async () => {
    seedMarket(db);
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    const parking = d.roles.find(r => r.name === 'Parking');
    expect(parking.lead).toBe('Rick Vogel');
    expect(parking.shifts.map(sh => sh.lead)).toEqual(['Rick Vogel', 'Rick Vogel']);
  });

  it('leaves a job with no lead recorded genuinely blank', async () => {
    seedMarket(db);
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    const tents = d.roles.find(r => r.name === 'Set up tents');
    expect(tents.lead).toBeUndefined();
    expect(tents.shifts[0].lead).toBe('');
  });

  it('keeps every key the caller already depended on', async () => {
    const evId = seedMarket(db);
    addVolunteer(db, evId, 'Ray Stoltz', 'ray@example.com', [2]);
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    expect(Object.keys(d).sort()).toEqual(['open', 'openShifts', 'roles', 'signedUp']);
    for (const role of d.roles) {
      expect(role).toHaveProperty('name');
      expect(role).toHaveProperty('shifts');
      for (const sh of role.shifts) {
        for (const k of ['label', 'needed', 'filled', 'people']) {
          expect(sh).toHaveProperty(k);
        }
      }
    }
  });

  it('reports open=false for a hidden event without hiding its data', async () => {
    const evId = seedMarket(db, { hidden: 1 });
    addVolunteer(db, evId, 'Ray Stoltz', 'ray@example.com', [2]);
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    expect(d.open).toBe(false);
    expect(d.signedUp).toBe(1);
  });

  it('finds the event by name when no slug has been set', async () => {
    seedMarket(db, { slug: '' });
    const d = await (await handleChristmasMarketSummary(reqWith(KEY), env)).json();
    expect(d.open).toBe(true);
    expect(d.roles.length).toBeGreaterThan(0);
  });
});

describe('market summary shaping', () => {
  it('labels a shift with its date so the two market days are distinguishable', () => {
    expect(marketShiftLabel({
      name: 'Parking', role_date: '2026-12-05', start_time: '8:30 AM', end_time: '11:00 AM',
    })).toBe('Sat, Dec 5, 8:30 AM – 11:00 AM');
  });

  it('falls back to the role name when a shift carries no date or time', () => {
    expect(marketShiftLabel({ name: 'Music', role_date: '', start_time: '', end_time: '' }))
      .toBe('Music');
  });

  it('reports needed as null — never 0 — when no capacity was ever recorded', () => {
    const roles = [{ id: 1, name: 'Go-Fer', slots: 0, role_date: '2026-12-05', start_time: '10:00 AM', end_time: '12:00 PM' }];
    const out = buildMarketSummary(roles, new Map());
    expect(out.roles[0].shifts[0].needed).toBeNull();
    // A shift with no stated capacity can't be counted as short-handed.
    expect(out.openShifts).toBe(0);
  });

  it('withholds a group lead when two shifts of one job name different people', () => {
    const roles = [
      { id: 1, name: 'Kitchen', slots: 3, role_date: '2026-12-04', start_time: '9:00 AM', end_time: '11:00 AM', lead: 'Marla Beck' },
      { id: 2, name: 'Kitchen', slots: 3, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM', lead: 'Rick Vogel' },
    ];
    const out = buildMarketSummary(roles, new Map());
    // Neither name is true of the group, and printing the first one found would put
    // a real person against the wrong day. Unassigned is the honest answer.
    expect(out.roles[0].lead).toBeUndefined();
    // The per-shift figures stay exact either way.
    expect(out.roles[0].shifts.map(sh => sh.lead)).toEqual(['Marla Beck', 'Rick Vogel']);
  });

  it('states the group lead when only some shifts of a job name one, and they agree', () => {
    const roles = [
      { id: 1, name: 'Kitchen', slots: 3, role_date: '2026-12-05', start_time: '9:00 AM', end_time: '11:00 AM', lead: '' },
      { id: 2, name: 'Kitchen', slots: 3, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM', lead: 'Marla Beck' },
    ];
    expect(buildMarketSummary(roles, new Map()).roles[0].lead).toBe('Marla Beck');
  });

  it('drops a date that is not a bare YYYY-MM-DD rather than passing it through', () => {
    const roles = [
      { id: 1, name: 'Kitchen', slots: 1, role_date: 'Saturday', start_time: '9:00 AM', end_time: '11:00 AM' },
    ];
    // The caller tests the same shape before trusting it, so a malformed value would
    // simply be ignored there -- but sending one at all invites somebody to widen the
    // test at the other end instead of fixing the data.
    expect(buildMarketSummary(roles, new Map()).roles[0].shifts[0].date).toBe('');
  });

  it('preserves the order shifts arrive in within a role group', () => {
    const roles = [
      { id: 1, name: 'Kitchen', slots: 3, role_date: '2026-12-05', start_time: '9:00 AM', end_time: '11:00 AM' },
      { id: 2, name: 'Trash', slots: 1, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM' },
      { id: 3, name: 'Kitchen', slots: 3, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM' },
    ];
    const out = buildMarketSummary(roles, new Map());
    expect(out.roles.map(r => r.name)).toEqual(['Kitchen', 'Trash']);
    expect(out.roles[0].shifts.map(s => s.label)).toEqual([
      'Sat, Dec 5, 9:00 AM – 11:00 AM',
      'Sat, Dec 5, 11:00 AM – 1:00 PM',
    ]);
  });
});
