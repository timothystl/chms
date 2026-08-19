import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handlePeopleApi } from '../src/api-people.js';
import { handleHouseholdsApi } from '../src/api-households.js';

// SEC16 / P22-A, decision 2026-08-19: the member directory honors "Include in directory".
//
// The person edit modal's `pm-public` checkbox is labeled "Include in directory" and is drawn
// as the PARENT of the five dir_hide_* field toggles. `public_directory` was honored by the
// printed/exported directory (api-import.js) and referenced NOWHERE in the People query path —
// so an opted-out person still appeared by name, photo, household and member type to every
// member account, and only the per-field toggles suppressed contact details. Nothing covered
// this column at all: a grep of test/ for `public_directory` returned zero before this file.
//
// These run the real handlers against real SQLite. The two roles are tested side by side on
// the same fixture, because the whole risk in this change is over-applying it — staff must
// still see everyone, or the opt-out becomes a way to hide from the church office.

let sqlite, db;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE households (id INTEGER PRIMARY KEY, name TEXT, address1 TEXT, address2 TEXT,
      city TEXT, state TEXT, zip TEXT, notes TEXT, photo_url TEXT);
    CREATE TABLE people (
      id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, preferred_name TEXT,
      middle_name TEXT, email TEXT, phone TEXT, address1 TEXT, address2 TEXT, city TEXT,
      state TEXT, zip TEXT, member_type TEXT, family_role TEXT, photo_url TEXT,
      envelope_number TEXT, envelope_history TEXT, anniversary_date TEXT, dob TEXT,
      household_id INTEGER, active INTEGER, status TEXT,
      dir_hide_address INTEGER DEFAULT 0, dir_hide_phone INTEGER DEFAULT 0,
      dir_hide_email INTEGER DEFAULT 0, dir_hide_dob INTEGER DEFAULT 0,
      dir_hide_anniversary INTEGER DEFAULT 0,
      public_directory INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE person_tags (person_id INTEGER, tag_id INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, color TEXT);
    CREATE TABLE giving_entries (id INTEGER PRIMARY KEY, batch_id INTEGER, person_id INTEGER,
      amount INTEGER, contribution_date TEXT);
    CREATE TABLE giving_batches (id INTEGER PRIMARY KEY, batch_date TEXT);

    INSERT INTO households VALUES
      (7,'Doe','1 Main St','','St. Louis','MO','63101','','hh.jpg'),
      (8,'Doe','2 Oak St','','St. Louis','MO','63101','','hh2.jpg'),
      (9,'Quiet','3 Elm St','','St. Louis','MO','63101','','hh3.jpg');
  `);
  // (id, first, last, preferred, middle, email, phone, addr1, addr2, city, state, zip,
  //  member_type, family_role, photo, env#, envHist, anniv, dob, hh, active, status,
  //  hideAddr, hidePhone, hideEmail, hideDob, hideAnniv, public_directory)
  const person = (id, first, last, hh, role, pub) =>
    sqlite.prepare(
      `INSERT INTO people VALUES (?,?,?,'','',?,'555-0000','','','','','','member',?,'p.jpg','','','','',?,1,'active',0,0,0,0,0,?)`
    ).run(id, first, last, (first + '@x.com').toLowerCase(), role, hh, pub);

  // ⚠ John is the HEAD and is the one opted out. That is deliberate: disambiguation reads the
  // head's first name, so with a visible head the opt-out path is never exercised and the
  // disambiguation tests below pass no matter what the code does (they did, on the first draft).
  person(1, 'Jane', 'Doe', 7, 'spouse', 1);    // in the directory
  person(2, 'John', 'Doe', 7, 'head', 0);      // opted OUT, and head of household 7
  person(3, 'Mary', 'Doe', 8, 'head', 1);      // household 8 shares the name "Doe"
  person(4, 'Silent', 'Quiet', 9, 'head', 0);  // whole household opted out

  db = {
    prepare(sql) {
      const mk = (args) => ({
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
        async first() { return sqlite.prepare(sql).get(...args); },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...a) => mk(a), ...mk([]) };
    },
    batch: async (stmts) => Promise.all(stmts.map((s) => s.all())),
  };
});

// handlePeopleApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit, canRegister, role)
async function people(role, qs = '') {
  const url = new URL('https://connect.timothystl.org/admin/api/people' + qs);
  const canEdit = role !== 'member';
  const res = await handlePeopleApi(
    new Request(url), {}, url, 'GET', 'people', db,
    role === 'admin', canEdit, canEdit, canEdit, canEdit, role
  );
  return res.json();
}
async function person(role, id) {
  const url = new URL('https://connect.timothystl.org/admin/api/people/' + id);
  const canEdit = role !== 'member';
  const res = await handlePeopleApi(
    new Request(url), {}, url, 'GET', 'people/' + id, db,
    role === 'admin', canEdit, canEdit, canEdit, canEdit, role
  );
  return { status: res.status, body: await res.json() };
}
async function household(role, id) {
  const url = new URL('https://connect.timothystl.org/admin/api/households/' + id);
  const res = await handleHouseholdsApi(
    new Request(url), {}, url, 'GET', 'households/' + id, db,
    role === 'admin', role !== 'member', role
  );
  return { status: res.status, body: await res.json() };
}

describe('member directory honors the "Include in directory" opt-out', () => {
  it('omits an opted-out person from the list', async () => {
    const d = await people('member');
    const names = d.people.map((p) => p.first_name).sort();
    expect(names).toEqual(['Jane', 'Mary']);
    expect(names).not.toContain('John');
  });

  it('counts the list the same way it filters it', async () => {
    // total drives the pagination footer; if it kept counting hidden people the UI would
    // promise a page that can never be filled.
    const d = await people('member', '?limit=1');
    expect(d.total).toBe(2);
  });

  it('404s an opted-out person fetched directly by id', async () => {
    // 404 rather than 403: a member should not learn that the id exists.
    const r = await person('member', 2);
    expect(r.status).toBe(404);
  });

  it('still serves a person who is in the directory', async () => {
    const r = await person('member', 1);
    expect(r.status).toBe(200);
    expect(r.body.first_name).toBe('Jane');
  });

  it('drops an opted-out member from the household family chips', async () => {
    const r = await household('member', 7);
    expect(r.status).toBe(200);
    expect(r.body.members.map((m) => m.first_name)).toEqual(['Jane']);
  });

  it('404s a household whose every member has opted out', async () => {
    // Otherwise a member could walk /households/1..N and harvest names and photos for
    // exactly the families that asked to be left out.
    const r = await household('member', 9);
    expect(r.status).toBe(404);
  });

  it('never disambiguates a household name using an opted-out person', async () => {
    // Households 7 and 8 are both "Doe", so the label becomes "Doe (First)". If that name
    // came from the head regardless of opt-out, John's first name would surface on the very
    // list he was excluded from.
    const list = await people('member');
    const jane = list.people.find((p) => p.first_name === 'Jane');
    expect(jane.household_display_name).toBeTruthy();
    expect(jane.household_display_name).not.toContain('John');
    expect(jane.household_display_name).toContain('Jane');

    const hh = await household('member', 7);
    expect(hh.body.display_name).not.toContain('John');
    expect(hh.body.display_name).toContain('Jane');
  });
});

describe('staff are unaffected — the opt-out hides from the directory, not from the office', () => {
  it('still lists an opted-out person', async () => {
    for (const role of ['staff', 'admin', 'finance', 'council']) {
      const d = await people(role);
      expect(d.people.map((p) => p.first_name).sort(), role).toContain('John');
    }
  });

  it('still serves an opted-out person by id', async () => {
    const r = await person('staff', 2);
    expect(r.status).toBe(200);
    expect(r.body.first_name).toBe('John');
  });

  it('still shows every household member, and the fully opted-out household', async () => {
    const r = await household('staff', 7);
    expect(r.body.members.map((m) => m.first_name).sort()).toEqual(['Jane', 'John']);
    const q = await household('staff', 9);
    expect(q.status).toBe(200);
  });

  it('still disambiguates from the real head even when the head opted out', async () => {
    // Staff see the real household label — "Doe (John)". Only the member view substitutes a
    // visible member. This is the assertion that catches the filter being over-applied.
    const d = await people('staff');
    const jane = d.people.find((p) => p.first_name === 'Jane');
    expect(jane.household_display_name).toContain('John');

    const hh = await household('staff', 7);
    expect(hh.body.display_name).toContain('John');
  });
});

describe('the default is "included", so nobody vanishes on deploy', () => {
  it('treats a row written without the column as in the directory', async () => {
    sqlite.prepare(
      `INSERT INTO people (id, first_name, last_name, member_type, household_id, active, status)
       VALUES (99,'New','Person','member',7,1,'active')`
    ).run();
    const d = await people('member');
    expect(d.people.map((p) => p.first_name)).toContain('New');
  });
});
