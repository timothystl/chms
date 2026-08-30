import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleMobileApi } from '../src/api-mobile.js';

// Mobile Admin's read-only Scheduler screen: "who's serving the current/upcoming Sunday,
// by role, with confirm/decline status" — GET /admin/api/mobile/scheduler/this-sunday.
// Gated narrower than the rest of Mobile Admin (admin/staff only, matching the desktop
// Scheduler tab's own gate — see handleSchedulerDataApi in api-admin.js), and reads the
// schedule out of the generic scheduler_data blob table (ws_schedule_v2/ws_people/
// ws_confirmations) rather than any relational schema, since none exists for it.

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const st = raw.prepare(sql);
      let binds = [];
      const api = {
        bind(...a) { binds = a; return api; },
        all() { return Promise.resolve({ results: st.all(...binds) }); },
        first() { return Promise.resolve(st.get(...binds) ?? null); },
        run() { const r = st.run(...binds); return Promise.resolve({ meta: { last_row_id: r.lastInsertRowid } }); },
      };
      return api;
    },
  };
  raw.exec(`
    CREATE TABLE chms_config(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE scheduler_data(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '{}', updated_at TEXT);
    CREATE TABLE people(id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, member_type TEXT,
      active INTEGER DEFAULT 1, public_directory INTEGER DEFAULT 1);
    CREATE TABLE worship_services(id INTEGER PRIMARY KEY, service_date TEXT, service_time TEXT,
      service_name TEXT, service_type TEXT, attendance INTEGER, communion INTEGER, notes TEXT);
    CREATE TABLE follow_up_items(id INTEGER PRIMARY KEY, person_id INTEGER, type TEXT, notes TEXT,
      completed INTEGER DEFAULT 0, completed_at TEXT DEFAULT '', created_at TEXT);
    CREATE TABLE prayer_requests(id INTEGER PRIMARY KEY, person_id INTEGER, requester_name TEXT,
      request_text TEXT, status TEXT, submitted_at TEXT, resolved_at TEXT);
  `);
  return db;
}

function seedSchedulerData(db, { schedule, people, confirmations, confirmationsUpdatedAt }) {
  const rows = [
    ['ws_schedule_v2', schedule != null ? schedule : {}, null],
    ['ws_people', people != null ? people : [], null],
    ['ws_confirmations', confirmations != null ? confirmations : {}, confirmationsUpdatedAt || '2026-08-25 09:00:00'],
  ];
  return Promise.all(rows.map(([key, value, updatedAt]) =>
    db.prepare(
      updatedAt
        ? `INSERT INTO scheduler_data (key,value,updated_at) VALUES (?,?,?)`
        : `INSERT INTO scheduler_data (key,value) VALUES (?,?)`
    ).bind(...(updatedAt ? [key, JSON.stringify(value), updatedAt] : [key, JSON.stringify(value)])).run()
  ));
}

function makeReq() { return { json: async () => ({}) }; }
function makeUrl(path) { return new URL('https://connect.timothystl.org/admin/api/mobile/' + path); }

describe('handleMobileApi — scheduler/this-sunday role gate', () => {
  it('admin and staff are allowed; finance/council/member/volunteer are denied', async () => {
    const db = makeDb();
    for (const role of ['admin', 'staff']) {
      const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', role);
      expect(r.status).toBe(200);
    }
    for (const role of ['finance', 'council', 'member', 'volunteer']) {
      const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', role);
      expect(r.status).toBe(403);
    }
  });
});

describe('handleMobileApi — dashboard can_view_scheduler flag', () => {
  it('is true only for admin/staff, matching the endpoint gate above', async () => {
    const db = makeDb();
    for (const role of ['admin', 'staff']) {
      const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', role);
      const d = await r.json();
      expect(d.can_view_scheduler).toBe(true);
    }
    for (const role of ['finance', 'council', 'member']) {
      const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', role);
      const d = await r.json();
      expect(d.can_view_scheduler).toBe(false);
    }
  });
});

describe('handleMobileApi — scheduler/this-sunday date resolution', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves to the NEXT Sunday when today is mid-week', async () => {
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z')); // a Wednesday
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'admin');
    const d = await r.json();
    expect(d.date_iso).toBe('2026-09-06');
  });

  it('resolves to TODAY when today is already a Sunday', async () => {
    vi.setSystemTime(new Date('2026-09-06T15:00:00Z'));
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'admin');
    const d = await r.json();
    expect(d.date_iso).toBe('2026-09-06');
  });

  it('reports has_schedule:false when no scheduler_data exists at all', async () => {
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'staff');
    const d = await r.json();
    expect(d.has_schedule).toBe(false);
    expect(d.date_iso).toBe('2026-09-06');
  });

  it('reports has_schedule:false when the month exists but not this Sunday', async () => {
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    const db = makeDb();
    await seedSchedulerData(db, {
      schedule: { '2026-09': { rows: [{ type: 'sunday', dateISO: '2026-09-13', ordinal: 2, assignments: {} }] } },
      people: [],
      confirmations: {},
    });
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'staff');
    const d = await r.json();
    expect(d.has_schedule).toBe(false);
  });
});

describe('handleMobileApi — scheduler/this-sunday regular Sunday row', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-02T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const PEOPLE = [
    { id: 12, name: 'Elaine Reyes' },
    { id: 7, name: 'James Poe' },
    { id: 9, name: 'Marcus Vale' },
  ];
  const SCHEDULE = {
    '2026-09': {
      rows: [{
        type: 'sunday', dateISO: '2026-09-06', ordinal: 1, label: '',
        assignments: {
          Elder: { '8am': 12, '10:45am': 7 },
          Acolyte: { '8am': null, '10:45am': 9 },
          PowerPoint: { '8am': 9, '10:45am': 9 },
          Lector: { '8am': null, '10:45am': null },
          Liturgist: { '8am': 7, '10:45am': 7 },
          Preacher: { shared: 12 },
          'Childrens Message': { shared: null },
        },
      }],
    },
  };
  const CONFIRMATIONS = {
    '2026-09-06|Elder|8am': 'confirmed',
    '2026-09-06|Elder|10:45am': 'declined',
    '2026-09-06|Preacher|shared': 'needs_changes',
    // Acolyte/10:45am, PowerPoint/*, Liturgist/* deliberately absent → default 'pending'.
  };

  it('resolves person names, confirmation status, and open slots correctly', async () => {
    const db = makeDb();
    await seedSchedulerData(db, { schedule: SCHEDULE, people: PEOPLE, confirmations: CONFIRMATIONS, confirmationsUpdatedAt: '2026-08-30 14:02:11' });
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'admin');
    const d = await r.json();

    expect(d.has_schedule).toBe(true);
    expect(d.kind).toBe('sunday');
    expect(d.ordinal).toBe(1);
    expect(d.confirmations_as_of).toBe('2026-08-30 14:02:11');

    const svc8 = d.services.find(s => s.svc === '8am');
    const elder8 = svc8.roles.find(r2 => r2.role === 'Elder');
    expect(elder8.person).toEqual({ id: 12, name: 'Elaine Reyes' });
    expect(elder8.status).toBe('confirmed');

    const svc1045 = d.services.find(s => s.svc === '10:45am');
    const elder1045 = svc1045.roles.find(r2 => r2.role === 'Elder');
    expect(elder1045.status).toBe('declined');

    // Open slot: no person assigned.
    const acolyte8 = svc8.roles.find(r2 => r2.role === 'Acolyte');
    expect(acolyte8.person).toBe(null);
    // No confirmation entry recorded for a filled slot → defaults to pending.
    const powerpoint8 = svc8.roles.find(r2 => r2.role === 'PowerPoint');
    expect(powerpoint8.person).toEqual({ id: 9, name: 'Marcus Vale' });
    expect(powerpoint8.status).toBe('pending');

    const preacher = d.shared_roles.find(r2 => r2.role === 'Preacher');
    expect(preacher.person).toEqual({ id: 12, name: 'Elaine Reyes' });
    expect(preacher.status).toBe('needs_changes');
    const kidsMsg = d.shared_roles.find(r2 => r2.role === 'Childrens Message');
    expect(kidsMsg.person).toBe(null);

    // Total slots = 5 roles x 2 services + 2 shared = 12; open = Acolyte/8am, Lector/8am,
    // Lector/10:45am, Childrens Message = 4; filled = 8.
    expect(d.counts.total).toBe(12);
    expect(d.counts.open).toBe(4);
    expect(d.counts.filled).toBe(8);
  });

  it('labels a person id with no matching ws_people entry as (unknown), not a crash', async () => {
    const db = makeDb();
    const scheduleWithGhost = {
      '2026-09': { rows: [{ type: 'sunday', dateISO: '2026-09-06', ordinal: 1, assignments: { Elder: { '8am': 999, '10:45am': null } } }] },
    };
    await seedSchedulerData(db, { schedule: scheduleWithGhost, people: [], confirmations: {} });
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'admin');
    const d = await r.json();
    const elder8 = d.services.find(s => s.svc === '8am').roles.find(r2 => r2.role === 'Elder');
    expect(elder8.person).toEqual({ id: 999, name: '(unknown)' });
  });

  it('reports no confirmations-as-of note when the confirmations key was never written', async () => {
    const db = makeDb();
    // Only write ws_schedule_v2/ws_people — no ws_confirmations row at all.
    await db.prepare(`INSERT INTO scheduler_data (key,value) VALUES ('ws_schedule_v2', ?)`).bind(JSON.stringify(SCHEDULE)).run();
    await db.prepare(`INSERT INTO scheduler_data (key,value) VALUES ('ws_people', ?)`).bind(JSON.stringify(PEOPLE)).run();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'admin');
    const d = await r.json();
    expect(d.confirmations_as_of).toBe(null);
    // Still resolves statuses to 'pending' rather than throwing.
    const elder8 = d.services.find(s => s.svc === '8am').roles.find(r2 => r2.role === 'Elder');
    expect(elder8.status).toBe('pending');
  });
});

describe('handleMobileApi — scheduler/this-sunday special-service row', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-21T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders a special-service Sunday (e.g. Christmas) via its own shape', async () => {
    const db = makeDb();
    const schedule = {
      '2026-12': {
        rows: [{
          type: 'special', dateISO: '2026-12-27', name: 'Christmas I',
          services: [{ time: '10:00 AM', roles: ['Elder', 'Acolyte'], assignments: { Elder: 12, Acolyte: null } }],
        }],
      },
    };
    await seedSchedulerData(db, { schedule, people: [{ id: 12, name: 'Elaine Reyes' }], confirmations: {} });
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('scheduler/this-sunday'), 'GET', 'admin');
    const d = await r.json();
    expect(d.has_schedule).toBe(true);
    expect(d.kind).toBe('special');
    expect(d.name).toBe('Christmas I');
    expect(d.services[0].time).toBe('10:00 AM');
    expect(d.services[0].roles.find(x => x.role === 'Elder').person).toEqual({ id: 12, name: 'Elaine Reyes' });
    expect(d.services[0].roles.find(x => x.role === 'Acolyte').person).toBe(null);
    expect(d.counts).toEqual({ filled: 1, open: 1, total: 2 });
  });
});
