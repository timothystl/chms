import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleHouseholdsApi } from '../src/api-households.js';

// 2026-08-04: members were given read access to a single household so the directory's family
// chips work. GET /admin/api/households/:id returns the FULL household to staff — private
// household notes, the envelope number, the anniversary, five years of giving totals, and every
// member's phone and email ignoring their own dir_hide_* opt-outs. None of that would ever pass
// memberSafeView on the person endpoints, so the handler needs its own member branch.
//
// These run the real handleHouseholdsApi against real SQLite.

let sqlite, db;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE households (id INTEGER PRIMARY KEY, name TEXT, address1 TEXT, address2 TEXT,
      city TEXT, state TEXT, zip TEXT, notes TEXT, photo_url TEXT);
    CREATE TABLE people (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT,
      member_type TEXT, family_role TEXT, phone TEXT, email TEXT, photo_url TEXT,
      envelope_number TEXT, anniversary_date TEXT, household_id INTEGER, active INTEGER,
      public_directory INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE giving_entries (id INTEGER PRIMARY KEY, batch_id INTEGER, person_id INTEGER,
      amount INTEGER, contribution_date TEXT);
    CREATE TABLE giving_batches (id INTEGER PRIMARY KEY, batch_date TEXT);
    INSERT INTO households VALUES (7,'Doe Family','1 Main St','','St. Louis','MO','63101',
      'PRIVATE pastoral note about this family','hh.jpg');
    INSERT INTO people VALUES
      (1,'Jane','Doe','member','head','555-1111','jane@x.com','jane.jpg','ENV-9','2005-06-01',7,1,1),
      (2,'John','Doe','member','spouse','555-2222','john@x.com','john.jpg','','',7,1,1);
    INSERT INTO giving_batches VALUES (1,'2026-01-05');
    INSERT INTO giving_entries VALUES (1,1,1,250000,'2026-01-05');
  `);
  db = {
    prepare(sql) {
      const mk = (args) => ({
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
        async first() { return sqlite.prepare(sql).get(...args); },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...a) => mk(a), ...mk([]) };
    },
    batch: async () => [],
  };
});

async function getHousehold(role) {
  const url = new URL('https://connect.timothystl.org/admin/api/households/7');
  const req = new Request(url, { method: 'GET' });
  const res = await handleHouseholdsApi(
    req, {}, url, 'GET', 'households/7', db,
    role === 'admin', role !== 'member', role
  );
  return res.json();
}

describe('household detail — member role', () => {
  it('returns the family chips a directory needs', async () => {
    const h = await getHousehold('member');
    expect(h.name).toBe('Doe Family');
    expect(h.members.map((m) => m.first_name).sort()).toEqual(['Jane', 'John']);
    expect(h.members[0].photo_url).toBeTruthy();
    expect(h.members[0].member_type).toBe('member');
  });

  it('leaks no giving data', async () => {
    const h = await getHousehold('member');
    expect(h.giving_years).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain('250000');
  });

  it('leaks no envelope number or anniversary', async () => {
    const h = await getHousehold('member');
    expect(h.envelope_number).toBeUndefined();
    expect(h.anniversary_date).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain('ENV-9');
  });

  it('leaks no private household notes', async () => {
    const h = await getHousehold('member');
    expect(h.notes).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain('PRIVATE');
  });

  it("leaks no member's phone, email or family role", async () => {
    const h = await getHousehold('member');
    const blob = JSON.stringify(h);
    expect(blob).not.toContain('555-1111');
    expect(blob).not.toContain('jane@x.com');
    expect(blob).not.toContain('spouse');
    for (const m of h.members) {
      expect(m.phone).toBeUndefined();
      expect(m.email).toBeUndefined();
      expect(m.family_role).toBeUndefined();
    }
  });

  it('exposes no household key outside the agreed set', async () => {
    const h = await getHousehold('member');
    expect(Object.keys(h).sort()).toEqual(['display_name', 'id', 'members', 'name', 'photo_url']);
  });
});

describe('household detail — staff role is unchanged', () => {
  it('still gets giving, envelope, notes and full member records', async () => {
    const h = await getHousehold('staff');
    expect(h.giving_years).toBeDefined();
    expect(h.envelope_number).toBe('ENV-9');
    expect(h.notes).toContain('PRIVATE');
    expect(h.members[0].phone).toBeTruthy();
    expect(h.members[0].email).toBeTruthy();
  });
});
