import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleMobileApi } from '../src/api-mobile.js';
import { MOBILE_ADMIN_HTML } from '../src/mobile-admin-html.js';

// Cover for the phone-optimized quick-access page (splash, dashboard, people directory,
// person detail — auto-served at the app's normal URL, no separate route) and its
// backing /admin/api/mobile/* handlers.

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
    CREATE TABLE households(id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE people(id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, preferred_name TEXT,
      email TEXT, phone TEXT, address1 TEXT, address2 TEXT, city TEXT, state TEXT, zip TEXT,
      member_type TEXT, household_id INTEGER, family_role TEXT, active INTEGER DEFAULT 1,
      public_directory INTEGER DEFAULT 1, dir_hide_phone INTEGER DEFAULT 0, dir_hide_email INTEGER DEFAULT 0,
      dir_hide_address INTEGER DEFAULT 0);
    CREATE TABLE worship_services(id INTEGER PRIMARY KEY, service_date TEXT, service_time TEXT,
      service_name TEXT, service_type TEXT, attendance INTEGER, communion INTEGER, notes TEXT);
    CREATE TABLE follow_up_items(id INTEGER PRIMARY KEY, person_id INTEGER, type TEXT, notes TEXT,
      due_date TEXT, completed INTEGER DEFAULT 0, completed_at TEXT DEFAULT '', created_at TEXT);
    CREATE TABLE prayer_requests(id INTEGER PRIMARY KEY, person_id INTEGER, requester_name TEXT,
      requester_email TEXT, request_text TEXT, source TEXT, status TEXT, resolution_note TEXT,
      submitted_at TEXT, resolved_at TEXT, created_at TEXT);
    CREATE TABLE funds(id INTEGER PRIMARY KEY, name TEXT, active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
      category TEXT DEFAULT '', budget_annual_cents INTEGER);
    CREATE TABLE giving_batches(id INTEGER PRIMARY KEY, batch_date TEXT, description TEXT, closed INTEGER DEFAULT 0);
    CREATE TABLE giving_entries(id INTEGER PRIMARY KEY, batch_id INTEGER, person_id INTEGER, fund_id INTEGER,
      amount INTEGER, method TEXT, check_number TEXT, notes TEXT, contribution_date TEXT);

    INSERT INTO households VALUES (1,'Alder Household');
    INSERT INTO people (id,first_name,last_name,preferred_name,email,phone,address1,address2,city,state,zip,member_type,household_id,family_role,active,public_directory,dir_hide_phone,dir_hide_email,dir_hide_address) VALUES
      (1,'Ann','Alder','','ann@example.org','(314) 555-0101','123 Main St','','St. Louis','MO','63101','Member',1,'head',1,1,0,0,0),
      (2,'Al','Alder','','','','','','','','','Member',1,'spouse',1,1,0,0,0),
      (3,'Vera','Visitor','','vera@example.org','','','','','','','Visitor',NULL,NULL,1,1,0,0,0),
      (4,'Ida','Inactive','','','','','','','','','Inactive',NULL,NULL,1,1,0,0,0),
      (5,'Org','Records','','','','','','','','','Organization',NULL,NULL,1,1,0,0,0),
      (6,'Nan','Noshow','','nan@example.org','(314) 555-0106','','','','','','Member',NULL,NULL,1,0,0,0,0),
      (7,'Percy','Private','','percy@example.org','(314) 555-0107','','','','','','Member',NULL,NULL,1,1,1,1,0);
  `);
  return db;
}

function makeReq(body) {
  return { json: async () => body || {} };
}
function makeUrl(path) {
  return new URL('https://connect.timothystl.org/admin/api/mobile/' + path);
}

describe('handleMobileApi — role gating', () => {
  it('denies volunteer outright (a different tool entirely)', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', 'volunteer');
    expect(r.status).toBe(403);
  });

  it('allows member, staff/finance/council/admin through the gate', async () => {
    const db = makeDb();
    for (const role of ['admin', 'finance', 'staff', 'council', 'member']) {
      const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', role);
      expect(r.status).toBe(200);
    }
  });
});

describe('handleMobileApi — dashboard', () => {
  it('finance role (no attendance/followups by default) sees neither section live', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', 'finance');
    const d = await r.json();
    expect(d.can_edit_attendance).toBe(false);
    expect(d.services.every(s => s.count === null)).toBe(true);
    // Prayer requests still show (finance counts as canEditBaseline), but no follow_up_items.
    expect(d.can_view_followups).toBe(true);
  });

  it('staff role gets attendance edit + followups by default', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', 'staff');
    const d = await r.json();
    expect(d.can_edit_attendance).toBe(true);
    expect(d.can_view_followups).toBe(true);
  });

  it('composes open prayer requests and incomplete follow-ups, newest first', async () => {
    const db = makeDb();
    const raw = db.prepare;
    await db.prepare(
      `INSERT INTO follow_up_items(person_id,type,notes,completed,created_at) VALUES (1,'general','Call about pledge',0,'2026-08-01 09:00:00')`
    ).run();
    await db.prepare(
      `INSERT INTO prayer_requests(person_id,requester_name,request_text,source,status,submitted_at) VALUES (3,'Vera Visitor','Please pray for my move','manual','open','2026-08-10')`
    ).run();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', 'admin');
    const d = await r.json();
    expect(d.open_followup_count).toBe(2);
    expect(d.followups.length).toBe(2);
    // Prayer request (2026-08-10) is newer than the follow-up (2026-08-01) — sorts first.
    expect(d.followups[0].kind).toBe('prayer');
    expect(d.followups[0].title).toContain('Vera Visitor');
    expect(d.followups[1].kind).toBe('followup');
  });

  it('people_total (staff scope) excludes only organizations', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', 'admin');
    const d = await r.json();
    // Alder x2, Visitor, Inactive, Nan (opted out), Percy = 6 (Org excluded).
    expect(d.people_total).toBe(6);
  });

  it('people_total (member scope) is narrower: Member type + public_directory=1 only', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('dashboard'), 'GET', 'member');
    const d = await r.json();
    // Ann, Al, Percy — Nan is opted out (public_directory=0), Vera/Ida aren't member_type='Member'.
    expect(d.people_total).toBe(3);
    expect(d.can_view_attendance).toBe(false);
    expect(d.can_view_followups).toBe(false);
  });
});

describe('handleMobileApi — attendance upsert', () => {
  it('inserts a new row, then updates it on a second save (no duplicate)', async () => {
    const db = makeDb();
    const r1 = await handleMobileApi(
      makeReq({ date: '2026-08-23', time: '08:00', count: 120 }),
      { DB: db }, makeUrl('attendance'), 'POST', 'staff'
    );
    const d1 = await r1.json();
    expect(d1.ok).toBe(true);
    expect(d1.count).toBe(120);

    const r2 = await handleMobileApi(
      makeReq({ date: '2026-08-23', time: '08:00', count: 135 }),
      { DB: db }, makeUrl('attendance'), 'POST', 'staff'
    );
    const d2 = await r2.json();
    expect(d2.id).toBe(d1.id);
    expect(d2.count).toBe(135);

    const rows = (await db.prepare(`SELECT * FROM worship_services WHERE service_date='2026-08-23'`).all()).results;
    expect(rows.length).toBe(1);
    expect(rows[0].attendance).toBe(135);
  });

  it('rejects a role without attendance edit access (finance, default matrix)', async () => {
    const db = makeDb();
    const r = await handleMobileApi(
      makeReq({ date: '2026-08-23', time: '08:00', count: 50 }),
      { DB: db }, makeUrl('attendance'), 'POST', 'finance'
    );
    expect(r.status).toBe(403);
  });

  it('rejects an invalid service time', async () => {
    const db = makeDb();
    const r = await handleMobileApi(
      makeReq({ date: '2026-08-23', time: '09:15', count: 50 }),
      { DB: db }, makeUrl('attendance'), 'POST', 'staff'
    );
    expect(r.status).toBe(400);
  });
});

describe('handleMobileApi — attendance history + entry CRUD', () => {
  it('returns recent services newest-first, with can_edit reflecting the role', async () => {
    const db = makeDb();
    await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES ('2026-08-16','08:00','','sunday',110,20,''),('2026-08-23','08:00','','sunday',118,22,'')`
    ).run();
    const rStaff = await handleMobileApi(makeReq(), { DB: db }, makeUrl('attendance/history'), 'GET', 'staff');
    const dStaff = await rStaff.json();
    expect(dStaff.can_edit).toBe(true);
    expect(dStaff.services.length).toBe(2);
    expect(dStaff.services[0].service_date).toBe('2026-08-23');

    const rFinance = await handleMobileApi(makeReq(), { DB: db }, makeUrl('attendance/history'), 'GET', 'finance');
    expect(rFinance.status).toBe(403);
  });

  it('creates a special-service entry with an arbitrary date/type, rejected for a non-edit role', async () => {
    const db = makeDb();
    const rFinance = await handleMobileApi(
      makeReq({ date: '2026-12-24', type: 'special', name: 'Christmas Eve', count: 240 }),
      { DB: db }, makeUrl('attendance/entry'), 'POST', 'finance'
    );
    expect(rFinance.status).toBe(403);

    const r = await handleMobileApi(
      makeReq({ date: '2026-12-24', type: 'special', name: 'Christmas Eve', count: 240, communion: 10 }),
      { DB: db }, makeUrl('attendance/entry'), 'POST', 'staff'
    );
    const d = await r.json();
    expect(d.ok).toBe(true);
    const row = await db.prepare(`SELECT * FROM worship_services WHERE id=?`).bind(d.id).first();
    expect(row.service_type).toBe('special');
    expect(row.service_name).toBe('Christmas Eve');
    expect(row.attendance).toBe(240);
    expect(row.communion).toBe(10);
  });

  it('rejects an entry with a malformed date', async () => {
    const db = makeDb();
    const r = await handleMobileApi(
      makeReq({ date: 'not-a-date', type: 'special', count: 5 }),
      { DB: db }, makeUrl('attendance/entry'), 'POST', 'staff'
    );
    expect(r.status).toBe(400);
  });

  it('edits an existing entry\'s count via PATCH, 404s on an unknown id, and DELETE removes it', async () => {
    const db = makeDb();
    const ins = await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES ('2026-11-25','','Thanksgiving Eve','special',85,0,'')`
    ).run();
    const id = ins.meta.last_row_id;

    const rFinance = await handleMobileApi(makeReq({ count: 90 }), { DB: db }, makeUrl('attendance/entry/' + id), 'PATCH', 'finance');
    expect(rFinance.status).toBe(403);

    const r = await handleMobileApi(makeReq({ count: 90 }), { DB: db }, makeUrl('attendance/entry/' + id), 'PATCH', 'staff');
    expect((await r.json()).ok).toBe(true);
    const row = await db.prepare(`SELECT attendance FROM worship_services WHERE id=?`).bind(id).first();
    expect(row.attendance).toBe(90);

    const rMissing = await handleMobileApi(makeReq({ count: 5 }), { DB: db }, makeUrl('attendance/entry/999999'), 'PATCH', 'staff');
    expect(rMissing.status).toBe(404);

    const rDel = await handleMobileApi(makeReq(), { DB: db }, makeUrl('attendance/entry/' + id), 'DELETE', 'staff');
    expect((await rDel.json()).ok).toBe(true);
    const gone = await db.prepare(`SELECT id FROM worship_services WHERE id=?`).bind(id).first();
    expect(gone).toBeNull();
  });

  it('a view-only override (attendance:view) can read history but not create/edit/delete', async () => {
    const db = makeDb();
    await db.prepare(
      `INSERT INTO chms_config(key,value) VALUES ('role_permissions_json', ?)`
    ).bind(JSON.stringify({ council: { attendance: 'view' } })).run();

    const rHist = await handleMobileApi(makeReq(), { DB: db }, makeUrl('attendance/history'), 'GET', 'council');
    const dHist = await rHist.json();
    expect(rHist.status).toBe(200);
    expect(dHist.can_edit).toBe(false);

    const rCreate = await handleMobileApi(
      makeReq({ date: '2026-12-24', type: 'special', count: 1 }),
      { DB: db }, makeUrl('attendance/entry'), 'POST', 'council'
    );
    expect(rCreate.status).toBe(403);

    const ins = await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES ('2026-08-16','08:00','','sunday',110,0,'')`
    ).run();
    const rEdit = await handleMobileApi(makeReq({ count: 1 }), { DB: db }, makeUrl('attendance/entry/' + ins.meta.last_row_id), 'PATCH', 'council');
    expect(rEdit.status).toBe(403);
    const rDel = await handleMobileApi(makeReq(), { DB: db }, makeUrl('attendance/entry/' + ins.meta.last_row_id), 'DELETE', 'council');
    expect(rDel.status).toBe(403);
  });
});

describe('handleMobileApi — giving: funds, recent, quick entry', () => {
  function seedFund(db, name) {
    return db.prepare(`INSERT INTO funds (name, active, sort_order) VALUES (?,1,0)`).bind(name).run();
  }

  it('finance (default edit) can list funds/recent and record a gift; staff (default none) is denied', async () => {
    const db = makeDb();
    const fund = await seedFund(db, 'General Fund');

    const rFundsStaff = await handleMobileApi(makeReq(), { DB: db }, makeUrl('giving/funds'), 'GET', 'staff');
    expect(rFundsStaff.status).toBe(403);
    const rRecentStaff = await handleMobileApi(makeReq(), { DB: db }, makeUrl('giving/recent'), 'GET', 'staff');
    expect(rRecentStaff.status).toBe(403);
    const rEntryStaff = await handleMobileApi(
      makeReq({ fund_id: fund.meta.last_row_id, amount: '20', date: '2026-08-23' }),
      { DB: db }, makeUrl('giving/entry'), 'POST', 'staff'
    );
    expect(rEntryStaff.status).toBe(403);

    const rFunds = await handleMobileApi(makeReq(), { DB: db }, makeUrl('giving/funds'), 'GET', 'finance');
    const dFunds = await rFunds.json();
    expect(dFunds.can_edit).toBe(true);
    expect(dFunds.funds.length).toBe(1);
    expect(dFunds.funds[0].name).toBe('General Fund');

    const rEntry = await handleMobileApi(
      makeReq({ person_id: 1, fund_id: fund.meta.last_row_id, amount: '43.50', method: 'cash', date: '2026-08-23' }),
      { DB: db }, makeUrl('giving/entry'), 'POST', 'finance'
    );
    const dEntry = await rEntry.json();
    expect(dEntry.ok).toBe(true);
    const row = await db.prepare(`SELECT * FROM giving_entries WHERE id=?`).bind(dEntry.id).first();
    expect(row.amount).toBe(4350);
    expect(row.person_id).toBe(1);
    expect(row.fund_id).toBe(fund.meta.last_row_id);

    const rRecent = await handleMobileApi(makeReq(), { DB: db }, makeUrl('giving/recent'), 'GET', 'finance');
    const dRecent = await rRecent.json();
    expect(dRecent.entries.length).toBe(1);
    expect(dRecent.entries[0].person_name).toBe('Ann Alder');
    expect(dRecent.entries[0].fund_name).toBe('General Fund');
  });

  it('a second same-month entry reuses the same manual-entry batch (shared logic with the desktop quick-entry route)', async () => {
    const db = makeDb();
    const fund = await seedFund(db, 'Building Fund');
    const r1 = await handleMobileApi(
      makeReq({ fund_id: fund.meta.last_row_id, amount: '10', date: '2026-08-05' }),
      { DB: db }, makeUrl('giving/entry'), 'POST', 'finance'
    );
    const r2 = await handleMobileApi(
      makeReq({ fund_id: fund.meta.last_row_id, amount: '15', date: '2026-08-20' }),
      { DB: db }, makeUrl('giving/entry'), 'POST', 'finance'
    );
    const d1 = await r1.json(), d2 = await r2.json();
    expect(d1.batch_id).toBe(d2.batch_id);
  });

  it('rejects a zero/invalid amount', async () => {
    const db = makeDb();
    const fund = await seedFund(db, 'General Fund');
    const r = await handleMobileApi(
      makeReq({ fund_id: fund.meta.last_row_id, amount: '0', date: '2026-08-23' }),
      { DB: db }, makeUrl('giving/entry'), 'POST', 'finance'
    );
    expect(r.status).toBe(400);
  });

  it("council's default 'anon' level is NOT enough — every giving endpoint shows/writes a named gift", async () => {
    const db = makeDb();
    const fund = await seedFund(db, 'General Fund');
    const rFunds = await handleMobileApi(makeReq(), { DB: db }, makeUrl('giving/funds'), 'GET', 'council');
    expect(rFunds.status).toBe(403);
    const rRecent = await handleMobileApi(makeReq(), { DB: db }, makeUrl('giving/recent'), 'GET', 'council');
    expect(rRecent.status).toBe(403);
    const rEntry = await handleMobileApi(
      makeReq({ fund_id: fund.meta.last_row_id, amount: '20', date: '2026-08-23' }),
      { DB: db }, makeUrl('giving/entry'), 'POST', 'council'
    );
    expect(rEntry.status).toBe(403);
  });
});

describe('handleMobileApi — follow-up toggle', () => {
  it('toggles a follow_up_item completed on then off', async () => {
    const db = makeDb();
    const ins = await db.prepare(
      `INSERT INTO follow_up_items(person_id,type,notes,completed,created_at) VALUES (1,'general','x',0,'2026-08-01')`
    ).run();
    const id = ins.meta.last_row_id;
    const r1 = await handleMobileApi(makeReq({ kind: 'followup', id }), { DB: db }, makeUrl('followups/toggle'), 'POST', 'staff');
    const d1 = await r1.json();
    expect(d1.done).toBe(true);
    const row1 = await db.prepare(`SELECT completed FROM follow_up_items WHERE id=?`).bind(id).first();
    expect(row1.completed).toBe(1);

    const r2 = await handleMobileApi(makeReq({ kind: 'followup', id }), { DB: db }, makeUrl('followups/toggle'), 'POST', 'staff');
    const d2 = await r2.json();
    expect(d2.done).toBe(false);
  });

  it('toggling a prayer request marks it answered, then back to open', async () => {
    const db = makeDb();
    const ins = await db.prepare(
      `INSERT INTO prayer_requests(person_id,requester_name,request_text,source,status,submitted_at) VALUES (3,'Vera','pray','manual','open','2026-08-10')`
    ).run();
    const id = ins.meta.last_row_id;
    const r1 = await handleMobileApi(makeReq({ kind: 'prayer', id }), { DB: db }, makeUrl('followups/toggle'), 'POST', 'admin');
    const d1 = await r1.json();
    expect(d1.done).toBe(true);
    const row1 = await db.prepare(`SELECT status FROM prayer_requests WHERE id=?`).bind(id).first();
    expect(row1.status).toBe('answered');

    const r2 = await handleMobileApi(makeReq({ kind: 'prayer', id }), { DB: db }, makeUrl('followups/toggle'), 'POST', 'admin');
    const d2 = await r2.json();
    expect(d2.done).toBe(false);
    const row2 = await db.prepare(`SELECT status FROM prayer_requests WHERE id=?`).bind(id).first();
    expect(row2.status).toBe('open');
  });

  it('a role without followups edit access cannot toggle a follow_up_item', async () => {
    const db = makeDb();
    const ins = await db.prepare(
      `INSERT INTO follow_up_items(person_id,type,notes,completed,created_at) VALUES (1,'general','x',0,'2026-08-01')`
    ).run();
    const r = await handleMobileApi(
      makeReq({ kind: 'followup', id: ins.meta.last_row_id }),
      { DB: db }, makeUrl('followups/toggle'), 'POST', 'finance'
    );
    expect(r.status).toBe(403);
  });
});

describe('handleMobileApi — people directory (staff/admin scope)', () => {
  it('excludes organizations, filters by member_type, searches by name', async () => {
    const db = makeDb();
    const all = await (await handleMobileApi(makeReq(), { DB: db }, makeUrl('people'), 'GET', 'admin')).json();
    expect(all.people.map(p => p.name)).not.toContain('Org Records');
    expect(all.total).toBe(6);

    const url = makeUrl('people'); url.searchParams.set('member_type', 'Visitor');
    const visitors = await (await handleMobileApi(makeReq(), { DB: db }, url, 'GET', 'admin')).json();
    expect(visitors.people.length).toBe(1);
    expect(visitors.people[0].name).toBe('Vera Visitor');

    const url2 = makeUrl('people'); url2.searchParams.set('q', 'alder');
    const search = await (await handleMobileApi(makeReq(), { DB: db }, url2, 'GET', 'admin')).json();
    expect(search.people.length).toBe(2);
  });

  it('reports household_size for a household member and 0 for someone with none', async () => {
    const db = makeDb();
    const all = await (await handleMobileApi(makeReq(), { DB: db }, makeUrl('people'), 'GET', 'admin')).json();
    const ann = all.people.find(p => p.name === 'Ann Alder');
    const vera = all.people.find(p => p.name === 'Vera Visitor');
    expect(ann.household_size).toBe(2);
    expect(vera.household_size).toBe(0);
  });

  it('an admin sees phone/email even for someone who has dir_hide_phone/email set', async () => {
    const db = makeDb();
    const all = await (await handleMobileApi(makeReq(), { DB: db }, makeUrl('people'), 'GET', 'admin')).json();
    const percy = all.people.find(p => p.name === 'Percy Private');
    expect(percy.phone).toBe('(314) 555-0107');
    expect(percy.email).toBe('percy@example.org');
  });
});

describe('handleMobileApi — people directory (member scope)', () => {
  it('is forced to member_type=Member regardless of a requested filter, and excludes opt-outs', async () => {
    const db = makeDb();
    const url = makeUrl('people'); url.searchParams.set('member_type', 'Visitor');
    const r = await (await handleMobileApi(makeReq(), { DB: db }, url, 'GET', 'member')).json();
    // The requested Visitor filter is ignored for a member session — every result is
    // still member_type='Member', and Nan (public_directory=0) never appears.
    expect(r.people.every(p => p.member_type === 'Member')).toBe(true);
    expect(r.people.map(p => p.name)).not.toContain('Nan Noshow');
    expect(r.people.map(p => p.name)).not.toContain('Vera Visitor');
    expect(r.total).toBe(3);
  });

  it('redacts phone/email for a person with dir_hide_phone/dir_hide_email set', async () => {
    const db = makeDb();
    const r = await (await handleMobileApi(makeReq(), { DB: db }, makeUrl('people'), 'GET', 'member')).json();
    const percy = r.people.find(p => p.name === 'Percy Private');
    expect(percy.phone).toBe('');
    expect(percy.email).toBe('');
    const ann = r.people.find(p => p.name === 'Ann Alder');
    expect(ann.phone).toBe('(314) 555-0101');
  });
});

describe('handleMobileApi — person detail (staff/admin scope)', () => {
  it('returns composed address, map url, and household members excluding self', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('people/1'), 'GET', 'admin');
    const p = await r.json();
    expect(p.name).toBe('Ann Alder');
    expect(p.address).toBe('123 Main St, St. Louis, MO 63101');
    expect(p.map_url).toContain(encodeURIComponent('123 Main St, St. Louis, MO 63101'));
    expect(p.household.length).toBe(1);
    expect(p.household[0].name).toBe('Al Alder');
    expect(p.household[0].rel).toBe('Spouse');
  });

  it('404s for an unknown or inactive person', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('people/999'), 'GET', 'admin');
    expect(r.status).toBe(404);
  });
});

describe('handleMobileApi — person detail (member scope)', () => {
  it('404s on someone outside the member-visible slice (opted out), even by direct id', async () => {
    const db = makeDb();
    // Nan Noshow (id 6) has public_directory=0 — a guessed id must not reach them.
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('people/6'), 'GET', 'member');
    expect(r.status).toBe(404);
  });

  it('404s on a non-Member type (Visitor), even by direct id', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('people/3'), 'GET', 'member');
    expect(r.status).toBe(404);
  });

  it('redacts phone/email/address per that person\'s own dir_hide_* flags', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('people/7'), 'GET', 'member');
    const p = await r.json();
    expect(p.name).toBe('Percy Private');
    expect(p.phone).toBe('');
    expect(p.email).toBe('');
    // dir_hide_address is 0 for Percy in the fixture, but there's no address on file either way.
    expect(p.address).toBe('');
  });

  it('a visible member sees full detail, unredacted', async () => {
    const db = makeDb();
    const r = await handleMobileApi(makeReq(), { DB: db }, makeUrl('people/1'), 'GET', 'member');
    const p = await r.json();
    expect(p.name).toBe('Ann Alder');
    expect(p.phone).toBe('(314) 555-0101');
    expect(p.address).toBe('123 Main St, St. Louis, MO 63101');
  });
});

describe('MOBILE_ADMIN_HTML', () => {
  it('interpolates DEPLOY_VERSION and has no stray unresolved template markers', () => {
    expect(MOBILE_ADMIN_HTML).not.toContain('${DEPLOY_VERSION}');
    expect(MOBILE_ADMIN_HTML).toContain('/icons/connect-mark.png?v=');
  });

  it('balances every div/button/span/a tag in the assembled markup', () => {
    for (const tag of ['div', 'button', 'span', 'a']) {
      const opens = (MOBILE_ADMIN_HTML.match(new RegExp('<' + tag + '(\\s|>)', 'g')) || []).length;
      const closes = (MOBILE_ADMIN_HTML.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      expect(opens, tag + ' open/close mismatch').toBe(closes);
    }
  });

  it('the served <script type="module"> block parses as valid JS', async () => {
    const m = MOBILE_ADMIN_HTML.match(/<script type="module">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    // Throws a SyntaxError if malformed — the same class of bug documented repeatedly
    // in CLAUDE.md (SC3-BUG1 etc.): a stray backtick/backslash in the outer template
    // literal silently breaking the *inner* served script.
    expect(() => new Function(m[1])).not.toThrow();
  });
});
