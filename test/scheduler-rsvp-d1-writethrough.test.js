import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleSchedRsvp, handleSchedRsvpStore, handleSchedRsvpStatus, schedKvPut } from '../src/api-scheduler.js';

// Reported live: Daniel Dicus confirmed his Sep 20 8am Liturgist assignment via the email
// link. The RSVP write to KV succeeded, but the Scheduler kept showing him as
// "Pending" everywhere -- desktop, mobile, even after an admin clicked "Sync Confirmations",
// on multiple devices. Root cause, in two layers:
//
//  1. Confirmation status only ever reached the shared D1 scheduler_data.ws_confirmations
//     BLOB via a browser's local RSVP-token cache (ws_rsvp_tokens) being synced and pushed --
//     and that per-browser cache had silently lost Daniel's token, so no browser could ever
//     pull his status in, no matter how many times Sync was clicked.
//  2. Worse: that per-browser cache was the ONLY place "person -> RSVP token" was ever
//     recorded. Two browsers (or the same admin on two devices, or a stale reload) could each
//     hold a different, incomplete copy, and whichever one saved last silently overwrote the
//     shared blob with its own incomplete view -- dropping other volunteers' tokens with no
//     error, no warning.
//
// Fix, done properly rather than patched around the blob: scheduler_confirmations and
// scheduler_rsvp_tokens (migrations/0052_scheduler_rsvp_relational.sql) are real tables, one
// row per slot / per person. handleSchedRsvp() writes a volunteer's response straight into
// scheduler_confirmations at RSVP time. handleSchedRsvpStore() (the /rsvp/store call a
// reminder-send makes) writes the person->token pairing straight into scheduler_rsvp_tokens,
// so that pairing is a real, always-current, server-side fact -- not a browser's local
// notepad that can quietly lose entries. GET /rsvp/status returns both tables in full, so a
// caller never needs its own local list of who to even ask about.

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
    CREATE TABLE scheduler_confirmations (
      date_iso TEXT NOT NULL, role TEXT NOT NULL, svc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date_iso, role, svc)
    );
    CREATE TABLE scheduler_rsvp_tokens (
      person_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

async function confirmationsAsMap(db) {
  const rows = (await db.prepare('SELECT date_iso, role, svc, status FROM scheduler_confirmations').all()).results;
  const out = {};
  for (const r of rows) out[r.date_iso + '|' + r.role + '|' + r.svc] = r.status;
  return out;
}

async function tokensAsMap(db) {
  const rows = (await db.prepare('SELECT person_id, token FROM scheduler_rsvp_tokens').all()).results;
  const out = {};
  for (const r of rows) out[r.person_id] = r.token;
  return out;
}

function rsvpUrl(params) {
  const u = new URL('https://connect.timothystl.org/rsvp');
  Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  return u;
}

describe('handleSchedRsvp() writes confirmation straight into scheduler_confirmations', () => {
  it('creates a row and sets the slot status when none existed yet', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, KV: kv };
    await schedKvPut(env, 'tok-daniel', {
      token: 'tok-daniel', name: 'Daniel Dicus',
      assignments: [{ date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Liturgist', status: 'pending' }],
      overallStatus: 'pending',
    });

    const res = await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-daniel', status: 'confirmed' }));
    expect(res.status).toBe(200);

    const kvRecord = JSON.parse(await kv.get('tok-daniel'));
    expect(kvRecord.overallStatus).toBe('confirmed');
    expect(kvRecord.assignments[0].status).toBe('confirmed');

    expect(await confirmationsAsMap(db)).toEqual({ '2026-09-20|Liturgist|8am': 'confirmed' });
  });

  it('merges without clobbering other slots', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, KV: kv };
    await db.prepare(
      "INSERT INTO scheduler_confirmations (date_iso, role, svc, status) VALUES ('2026-09-20','Elder','8am','confirmed')"
    ).run();
    await schedKvPut(env, 'tok-daniel', {
      token: 'tok-daniel', name: 'Daniel Dicus',
      assignments: [{ date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Liturgist', status: 'pending' }],
      overallStatus: 'pending',
    });

    await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-daniel', status: 'declined' }));

    expect(await confirmationsAsMap(db)).toEqual({
      '2026-09-20|Elder|8am': 'confirmed',
      '2026-09-20|Liturgist|8am': 'declined',
    });
  });

  it('writes every assignment on the token, and maps "both services" to the "shared" slot key', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, KV: kv };
    await schedKvPut(env, 'tok-multi', {
      token: 'tok-multi', name: 'Aaron Farrow',
      assignments: [
        { date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '10:45am', role: 'PowerPoint', status: 'pending' },
        { date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: 'both services', role: 'Preacher', status: 'pending' },
      ],
      overallStatus: 'pending',
    });

    await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-multi', status: 'confirmed' }));

    expect(await confirmationsAsMap(db)).toEqual({
      '2026-09-20|PowerPoint|10:45am': 'confirmed',
      '2026-09-20|Preacher|shared': 'confirmed',
    });
  });

  it('only writes the targeted assignment when idx is given', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, KV: kv };
    await schedKvPut(env, 'tok-idx', {
      token: 'tok-idx', name: 'Stephen Peeler',
      assignments: [
        { date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Lector', status: 'pending' },
        { date: 'Sep 27, 2026', dateISO: '2026-09-27', svc: '8am', role: 'Lector', status: 'pending' },
      ],
      overallStatus: 'pending',
    });

    await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-idx', status: 'confirmed', idx: '0' }));

    expect(await confirmationsAsMap(db)).toEqual({
      '2026-09-20|Lector|8am': 'confirmed',
      '2026-09-27|Lector|8am': 'pending',
    });
  });

  it('never breaks the RSVP response when env.DB is unavailable', async () => {
    const kv = makeKv();
    const env = { KV: kv }; // no DB binding
    await schedKvPut(env, 'tok-nodb', {
      token: 'tok-nodb', name: 'No DB',
      assignments: [{ date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Elder', status: 'pending' }],
      overallStatus: 'pending',
    });

    const res = await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-nodb', status: 'confirmed' }));
    expect(res.status).toBe(200);
    const kvRecord = JSON.parse(await kv.get('tok-nodb'));
    expect(kvRecord.overallStatus).toBe('confirmed');
  });
});

describe('handleSchedRsvpStore() keeps scheduler_rsvp_tokens as the real person<->token record', () => {
  function storeReq(body) { return { json: async () => body }; }

  it('records a brand-new person/token pairing', async () => {
    const db = makeDb();
    const env = { DB: db, KV: makeKv() };

    const res = await handleSchedRsvpStore(storeReq({
      token: 'tok-p1275', name: 'Daniel Dicus', personId: 'p1275',
      assignments: [{ date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Liturgist' }],
    }), env);
    expect(res.status).toBe(200);

    expect(await tokensAsMap(db)).toEqual({ p1275: 'tok-p1275' });
  });

  it('updates the token on a re-send without losing other people already recorded', async () => {
    const db = makeDb();
    const env = { DB: db, KV: makeKv() };
    await db.prepare("INSERT INTO scheduler_rsvp_tokens (person_id, token, name) VALUES ('p999','tok-other','Someone Else')").run();

    await handleSchedRsvpStore(storeReq({ token: 'tok-p1275-v1', name: 'Daniel Dicus', personId: 'p1275', assignments: [] }), env);
    await handleSchedRsvpStore(storeReq({ token: 'tok-p1275-v2', name: 'Daniel Dicus', personId: 'p1275', assignments: [] }), env);

    expect(await tokensAsMap(db)).toEqual({ p999: 'tok-other', p1275: 'tok-p1275-v2' });
  });

  it('never breaks the store response when env.DB is unavailable', async () => {
    const env = { KV: makeKv() };
    const res = await handleSchedRsvpStore(storeReq({ token: 'tok-x', name: 'X', personId: 'pX', assignments: [] }), env);
    expect(res.status).toBe(200);
  });
});

describe('GET /rsvp/status returns the full authoritative picture, unfiltered by any local cache', () => {
  it('returns every token and every confirmation on file', async () => {
    const db = makeDb();
    await db.prepare("INSERT INTO scheduler_rsvp_tokens (person_id, token, name) VALUES ('p1275','tok-daniel','Daniel Dicus')").run();
    await db.prepare("INSERT INTO scheduler_rsvp_tokens (person_id, token, name) VALUES ('p121','tok-eva','Eva Bordeleau')").run();
    await db.prepare("INSERT INTO scheduler_confirmations (date_iso, role, svc, status) VALUES ('2026-09-20','Liturgist','8am','confirmed')").run();
    await db.prepare("INSERT INTO scheduler_confirmations (date_iso, role, svc, status) VALUES ('2026-09-27','Lector','10:45am','declined')").run();

    const res = await handleSchedRsvpStatus({}, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokens).toEqual({ p1275: 'tok-daniel', p121: 'tok-eva' });
    expect(body.confirmations).toEqual({
      '2026-09-20|Liturgist|8am': 'confirmed',
      '2026-09-27|Lector|10:45am': 'declined',
    });
  });

  it('returns empty maps, not an error, when env.DB is unavailable', async () => {
    const res = await handleSchedRsvpStatus({}, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tokens: {}, confirmations: {} });
  });
});
