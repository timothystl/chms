import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/api-admin.js';
import { findDuplicateSignupGroups, mergeDuplicateSignupGroup, findPossibleDuplicateSignupGroups, mergeSignupsByIds } from '../src/api-scheduler.js';
import { authCookieHeader } from '../src/auth.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as
// test/serve-signup-merge.test.js.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE serve_events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
  sqlite.exec(`CREATE TABLE serve_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL,
    slots INTEGER NOT NULL DEFAULT 0, role_date TEXT NOT NULL DEFAULT '', start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER, role_id INTEGER, ministry TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', roles TEXT NOT NULL DEFAULT '[]',
    service TEXT NOT NULL DEFAULT '', sundays TEXT NOT NULL DEFAULT '[]', shirt_wanted INTEGER NOT NULL DEFAULT 0,
    shirt_size TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
    person_id INTEGER DEFAULT NULL, contacted_at TEXT NOT NULL DEFAULT '', contact_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new', sms_reminder_opt_in INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE signup_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, signup_id INTEGER NOT NULL, role_id INTEGER NOT NULL)`);
  sqlite.exec(`CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, entity_type TEXT, entity_id INTEGER, person_name TEXT, field TEXT, old_value TEXT, new_value TEXT)`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { const r = sqlite.prepare(sql).run(); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
        async first() { return sqlite.prepare(sql).get() || null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    _raw: sqlite,
  };
}

function seedHistoricalDuplicates(db) {
  const s = db._raw;
  s.prepare('INSERT INTO serve_events (name) VALUES (?)').run('Christmas Market');
  const roleA = Number(s.prepare("INSERT INTO serve_roles (event_id,name,slots,role_date) VALUES (1,'Setup Crew',5,'2026-12-04')").run().lastInsertRowid);
  const roleB = Number(s.prepare("INSERT INTO serve_roles (event_id,name,slots,role_date) VALUES (1,'Cashier',2,'2026-12-05')").run().lastInsertRowid);

  const jane1 = Number(s.prepare("INSERT INTO signups (event_id,ministry,name,email,phone,status,contact_count) VALUES (1,'events','Jane Doe','jane@example.com','314-555-1111','new',0)").run().lastInsertRowid);
  s.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').run(jane1, roleA);
  const jane2 = Number(s.prepare("INSERT INTO signups (event_id,ministry,name,email,notes,status,contact_count) VALUES (1,'events','Jane Doe','JANE@example.com','Bring my own gloves','contacted',2)").run().lastInsertRowid);
  s.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').run(jane2, roleB);

  const bob1 = Number(s.prepare("INSERT INTO signups (event_id,ministry,name,email,roles,status) VALUES (0,'worship','Bob Smith','bob@example.com','[\"Usher\"]','confirmed')").run().lastInsertRowid);
  const bob2 = Number(s.prepare("INSERT INTO signups (event_id,ministry,name,email,roles,status) VALUES (0,'education','Bob Smith','bob@example.com','[\"Sunday School Teacher\"]','new')").run().lastInsertRowid);

  s.prepare("INSERT INTO signups (event_id,ministry,name,email,roles) VALUES (0,'outreach','Frank Only','frank@example.com','[\"Food pantry\"]')").run();

  return { roleA, roleB, jane1, jane2, bob1, bob2 };
}

// Same person, same event, but a DIFFERENT email each time (e.g. a personal
// address on one sign-up, a work address on the other) — never caught by
// the exact-email grouping above, since that's the same key handleSignup
// itself uses for a live merge.
function seedSameNameDifferentEmail(db) {
  const s = db._raw;
  const evId = Number(s.prepare("INSERT INTO serve_events (name) VALUES ('Christmas Market')").run().lastInsertRowid);
  const roleA = Number(s.prepare('INSERT INTO serve_roles (event_id,name,slots,role_date) VALUES (?,?,?,?)').run(evId, 'Move stuff', 5, '2026-12-04').lastInsertRowid);
  const roleB = Number(s.prepare('INSERT INTO serve_roles (event_id,name,slots,role_date) VALUES (?,?,?,?)').run(evId, 'Grill', 5, '2026-12-05').lastInsertRowid);
  const row1 = Number(s.prepare("INSERT INTO signups (event_id,ministry,name,email) VALUES (?,'events','Andrew Dinger','dinger.andrew@gmail.com')").run(evId).lastInsertRowid);
  s.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').run(row1, roleA);
  const row2 = Number(s.prepare("INSERT INTO signups (event_id,ministry,name,email,phone) VALUES (?,'events','Andrew Dinger','dinger@timothystl.org','(908) 635-7464')").run(evId).lastInsertRowid);
  s.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').run(row2, roleB);
  return { evId, roleA, roleB, row1, row2 };
}

function makeReq(cookie, body) {
  return { headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) }, json: async () => body || {} };
}

describe('findDuplicateSignupGroups / mergeDuplicateSignupGroup', () => {
  it('groups by (email, event) and leaves a singleton alone', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    seedHistoricalDuplicates(db);
    const groups = await findDuplicateSignupGroups(env);
    expect(groups.length).toBe(2);
    expect(groups.map(g => g.email).sort()).toEqual(['bob@example.com', 'jane@example.com']);
  });

  it('merges an event group: unions slots, keeps the further-along status, prefers non-empty fields', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const { roleA, roleB, jane1, jane2 } = seedHistoricalDuplicates(db);
    const groups = await findDuplicateSignupGroups(env);
    const janeGroup = groups.find(g => g.email === 'jane@example.com');
    const removed = await mergeDuplicateSignupGroup(env, janeGroup.rows);
    expect(removed).toBe(1);

    const row = await env.DB.prepare('SELECT * FROM signups WHERE id=?').bind(jane1).first();
    expect(row.phone).toBe('314-555-1111'); // kept from canonical, since dupe had none
    expect(row.notes).toBe('Bring my own gloves'); // pulled in from the dupe
    expect(row.status).toBe('contacted'); // further along than canonical's 'new'
    expect(row.contact_count).toBe(2);

    const gone = await env.DB.prepare('SELECT id FROM signups WHERE id=?').bind(jane2).first();
    expect(gone).toBeNull();

    const slots = await env.DB.prepare('SELECT role_id FROM signup_slots WHERE signup_id=?').bind(jane1).all();
    expect(slots.results.map(r => r.role_id).sort()).toEqual([roleA, roleB].sort());
  });

  it('merges a ministry-only group: unions role labels and ministries', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const { bob1 } = seedHistoricalDuplicates(db);
    const groups = await findDuplicateSignupGroups(env);
    const bobGroup = groups.find(g => g.email === 'bob@example.com');
    await mergeDuplicateSignupGroup(env, bobGroup.rows);

    const row = await env.DB.prepare('SELECT * FROM signups WHERE id=?').bind(bob1).first();
    expect(JSON.parse(row.roles)).toEqual(['Usher', 'Sunday School Teacher']);
    expect(row.ministry).toBe('worship, education');
    expect(row.status).toBe('confirmed'); // never downgraded by the dupe's 'new'
  });
});

describe('GET/POST /admin/api/signups/duplicates|merge-duplicates', () => {
  it('requires staff/admin', async () => {
    const db = makeTestDb();
    const env = { DB: db, ADMIN_PASSWORD: 'secret' };
    seedHistoricalDuplicates(db);
    const r = await handleAdminApi(makeReq(''), env, new URL('https://x/admin/api/signups/duplicates'), 'GET');
    expect(r.status).toBe(403);
  });

  it('previews groups, refuses a stale confirm_count, then merges everything on a matching one', async () => {
    const db = makeTestDb();
    const env = { DB: db, ADMIN_PASSWORD: 'secret' };
    seedHistoricalDuplicates(db);
    const cookie = (await authCookieHeader(env, 'admin', '')).split(';')[0];

    const rPreview = await handleAdminApi(makeReq(cookie), env, new URL('https://x/admin/api/signups/duplicates'), 'GET');
    const bPreview = await rPreview.json();
    expect(bPreview.groups.length).toBe(2);

    const rBadConfirm = await handleAdminApi(makeReq(cookie, { confirm_count: 1 }), env, new URL('https://x/admin/api/signups/merge-duplicates'), 'POST');
    expect(rBadConfirm.status).toBe(409);
    // Nothing was merged by the refused call.
    let stillTwo = await handleAdminApi(makeReq(cookie), env, new URL('https://x/admin/api/signups/duplicates'), 'GET');
    expect((await stillTwo.json()).groups.length).toBe(2);

    const rMerge = await handleAdminApi(makeReq(cookie, { confirm_count: bPreview.groups.length }), env, new URL('https://x/admin/api/signups/merge-duplicates'), 'POST');
    expect(rMerge.status).toBe(200);
    const bMerge = await rMerge.json();
    expect(bMerge.ok).toBe(true);
    expect(bMerge.groups_merged).toBe(2);
    expect(bMerge.signups_removed).toBe(2);

    const rAfter = await handleAdminApi(makeReq(cookie), env, new URL('https://x/admin/api/signups/duplicates'), 'GET');
    expect((await rAfter.json()).groups.length).toBe(0);

    const totalRow = await env.DB.prepare('SELECT COUNT(*) as n FROM signups').first();
    expect(totalRow.n).toBe(3); // jane (merged), bob (merged), frank (untouched singleton)
  });
});

describe('findPossibleDuplicateSignupGroups / mergeSignupsByIds — same name, different email', () => {
  it('is invisible to the exact-email grouping', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    seedSameNameDifferentEmail(db);
    const groups = await findDuplicateSignupGroups(env);
    expect(groups.length).toBe(0);
  });

  it('surfaces the same-name pair, with both distinct emails visible, and leaves a true singleton alone', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    seedSameNameDifferentEmail(db);
    const possible = await findPossibleDuplicateSignupGroups(env);
    expect(possible.length).toBe(1);
    expect(possible[0].name).toBe('Andrew Dinger');
    expect(possible[0].rows.map(r => r.email).sort()).toEqual(['dinger.andrew@gmail.com', 'dinger@timothystl.org'].sort());
    expect(possible[0].eventName).toBe('Christmas Market');
  });

  it('a group already sharing one email is excluded (that is findDuplicateSignupGroups\' job, not this one\'s)', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    seedHistoricalDuplicates(db); // jane's two rows share ONE email
    const possible = await findPossibleDuplicateSignupGroups(env);
    expect(possible.find(g => g.name === 'Jane Doe')).toBeUndefined();
  });

  it('manually merges the same-name pair: unions slots, keeps a non-empty phone', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const { roleA, roleB, row1, row2 } = seedSameNameDifferentEmail(db);
    const { removed, canonicalId } = await mergeSignupsByIds(env, [row1, row2]);
    expect(removed).toBe(1);
    expect(canonicalId).toBe(row1);

    const row = await env.DB.prepare('SELECT * FROM signups WHERE id=?').bind(row1).first();
    expect(row.email).toBe('dinger.andrew@gmail.com'); // canonical (oldest) row's own email is kept
    expect(row.phone).toBe('(908) 635-7464'); // pulled in from the dupe, since canonical had none

    const gone = await env.DB.prepare('SELECT id FROM signups WHERE id=?').bind(row2).first();
    expect(gone).toBeNull();

    const slots = await env.DB.prepare('SELECT role_id FROM signup_slots WHERE signup_id=?').bind(row1).all();
    expect(slots.results.map(r => r.role_id).sort()).toEqual([roleA, roleB].sort());
  });

  it('refuses fewer than 2 ids and a non-existent id', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const single = await mergeSignupsByIds(env, [1]);
    expect(single.canonicalId).toBeNull();
    expect(single.removed).toBe(0);
  });
});

describe('POST /admin/api/signups/merge (manual, arbitrary ids)', () => {
  it('requires staff/admin', async () => {
    const db = makeTestDb();
    const env = { DB: db, ADMIN_PASSWORD: 'secret' };
    const { row1, row2 } = seedSameNameDifferentEmail(db);
    const r = await handleAdminApi(makeReq('', { ids: [row1, row2] }), env, new URL('https://x/admin/api/signups/merge'), 'POST');
    expect(r.status).toBe(403);
  });

  it('rejects fewer than 2 ids', async () => {
    const db = makeTestDb();
    const env = { DB: db, ADMIN_PASSWORD: 'secret' };
    const cookie = (await authCookieHeader(env, 'admin', '')).split(';')[0];
    const r = await handleAdminApi(makeReq(cookie, { ids: [1] }), env, new URL('https://x/admin/api/signups/merge'), 'POST');
    expect(r.status).toBe(400);
  });

  it('merges the two Andrew Dinger rows the GET /duplicates response would surface as a possible duplicate', async () => {
    const db = makeTestDb();
    const env = { DB: db, ADMIN_PASSWORD: 'secret' };
    const { roleA, roleB, row1, row2 } = seedSameNameDifferentEmail(db);
    const cookie = (await authCookieHeader(env, 'admin', '')).split(';')[0];

    const rPreview = await handleAdminApi(makeReq(cookie), env, new URL('https://x/admin/api/signups/duplicates'), 'GET');
    const bPreview = await rPreview.json();
    expect(bPreview.groups.length).toBe(0);
    expect(bPreview.possible_groups.length).toBe(1);
    const ids = bPreview.possible_groups[0].signups.map(s => s.id);
    expect(ids.sort()).toEqual([row1, row2].sort());

    const rMerge = await handleAdminApi(makeReq(cookie, { ids }), env, new URL('https://x/admin/api/signups/merge'), 'POST');
    expect(rMerge.status).toBe(200);
    const bMerge = await rMerge.json();
    expect(bMerge.ok).toBe(true);
    expect(bMerge.signups_removed).toBe(1);

    const totalRow = await env.DB.prepare('SELECT COUNT(*) as n FROM signups').first();
    expect(totalRow.n).toBe(1);
    const slots = await env.DB.prepare('SELECT role_id FROM signup_slots').all();
    expect(slots.results.map(r => r.role_id).sort()).toEqual([roleA, roleB].sort());

    const rAfter = await handleAdminApi(makeReq(cookie), env, new URL('https://x/admin/api/signups/duplicates'), 'GET');
    expect((await rAfter.json()).possible_groups.length).toBe(0);
  });
});
