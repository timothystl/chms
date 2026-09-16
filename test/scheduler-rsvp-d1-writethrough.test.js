import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleSchedRsvp, schedKvPut } from '../src/api-scheduler.js';

// Reported live: Daniel Dicus confirmed his Sep 20 8am Liturgist assignment via the
// email link. The RSVP write to KV (RSVP_STORE) succeeded, but the Scheduler kept
// showing him as "Pending" everywhere -- desktop, mobile, even after an admin clicked
// "Sync Confirmations". Root cause: confirmation status only ever reached the shared
// D1 scheduler_data.ws_confirmations blob via a *browser's* local RSVP-token cache
// (ws_rsvp_tokens) being synced and pushed -- and that per-browser cache had silently
// lost Daniel's token, so no browser could ever pull his status in, no matter how many
// times Sync was clicked.
//
// Fix: handleSchedRsvp() (the /rsvp email-link handler) now writes the volunteer's
// response straight into the D1 ws_confirmations blob itself, at RSVP time -- bypassing
// the per-browser token cache entirely for this path.

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
  raw.exec(`CREATE TABLE scheduler_data(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  return db;
}

function makeKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

async function confirmationsBlob(db) {
  const row = await db.prepare("SELECT value FROM scheduler_data WHERE key='ws_confirmations'").first();
  return row ? JSON.parse(row.value) : null;
}

function rsvpUrl(params) {
  const u = new URL('https://connect.timothystl.org/rsvp');
  Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  return u;
}

describe('handleSchedRsvp() writes confirmation straight into D1', () => {
  it('creates the ws_confirmations row and sets the slot status when none existed yet', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, RSVP_STORE: kv };
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

    const confs = await confirmationsBlob(db);
    expect(confs).toEqual({ '2026-09-20|Liturgist|8am': 'confirmed' });
  });

  it('merges into an existing ws_confirmations row without clobbering other slots', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, RSVP_STORE: kv };
    await db.prepare("INSERT INTO scheduler_data (key, value) VALUES ('ws_confirmations', ?)")
      .bind(JSON.stringify({ '2026-09-20|Elder|8am': 'confirmed' })).run();
    await schedKvPut(env, 'tok-daniel', {
      token: 'tok-daniel', name: 'Daniel Dicus',
      assignments: [{ date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Liturgist', status: 'pending' }],
      overallStatus: 'pending',
    });

    await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-daniel', status: 'declined' }));

    const confs = await confirmationsBlob(db);
    expect(confs).toEqual({
      '2026-09-20|Elder|8am': 'confirmed',
      '2026-09-20|Liturgist|8am': 'declined',
    });
  });

  it('writes every assignment on the token, and maps "both services" to the "shared" slot key', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, RSVP_STORE: kv };
    await schedKvPut(env, 'tok-multi', {
      token: 'tok-multi', name: 'Aaron Farrow',
      assignments: [
        { date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '10:45am', role: 'PowerPoint', status: 'pending' },
        { date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: 'both services', role: 'Preacher', status: 'pending' },
      ],
      overallStatus: 'pending',
    });

    await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-multi', status: 'confirmed' }));

    const confs = await confirmationsBlob(db);
    expect(confs).toEqual({
      '2026-09-20|PowerPoint|10:45am': 'confirmed',
      '2026-09-20|Preacher|shared': 'confirmed',
    });
  });

  it('only writes the targeted assignment when idx is given, keeping the D1 blob in step with KV', async () => {
    const db = makeDb();
    const kv = makeKv();
    const env = { DB: db, RSVP_STORE: kv };
    await schedKvPut(env, 'tok-idx', {
      token: 'tok-idx', name: 'Stephen Peeler',
      assignments: [
        { date: 'Sep 20, 2026', dateISO: '2026-09-20', svc: '8am', role: 'Lector', status: 'pending' },
        { date: 'Sep 27, 2026', dateISO: '2026-09-27', svc: '8am', role: 'Lector', status: 'pending' },
      ],
      overallStatus: 'pending',
    });

    await handleSchedRsvp({}, env, rsvpUrl({ token: 'tok-idx', status: 'confirmed', idx: '0' }));

    const confs = await confirmationsBlob(db);
    expect(confs).toEqual({
      '2026-09-20|Lector|8am': 'confirmed',
      '2026-09-27|Lector|8am': 'pending',
    });
  });

  it('never breaks the RSVP response when env.DB is unavailable', async () => {
    const kv = makeKv();
    const env = { RSVP_STORE: kv }; // no DB binding
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
