import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sendBirthdayTexts, sendAnniversaryTexts, centralTodayMMDD } from '../src/api-emails.js';

// SMS1's daily birthday/anniversary texts were wired to call Twilio, which this Worker has
// no secrets for anywhere (not in wrangler.toml, not ever `wrangler secret put`) — so every
// cron run and every admin "Send Birthday Texts" click has silently sent nothing since this
// shipped. The docs and the Settings-tab copy both always said "via Brevo". This switches the
// send path to actually match that and use the Brevo account already configured for
// email/newsletter, via the same api-key header pattern already proven for transactional email.

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', dob TEXT NOT NULL DEFAULT '',
    anniversary_date TEXT NOT NULL DEFAULT '', family_role TEXT NOT NULL DEFAULT '',
    household_id INTEGER, member_type TEXT NOT NULL DEFAULT 'member',
    marital_status TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active', deceased INTEGER NOT NULL DEFAULT 0,
    sms_opt_in INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL DEFAULT '', entity_id INTEGER, person_name TEXT NOT NULL DEFAULT '',
    field TEXT NOT NULL DEFAULT '', new_value TEXT NOT NULL DEFAULT '',
    ts TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { const r = sqlite.prepare(sql).run(); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
      };
    },
    batch(stmts) { return Promise.all(stmts.map(s => s.run())); },
  };
  return { db, sqlite };
}

function stubFetch(impl) {
  const calls = [];
  vi.stubGlobal('fetch', (url, init) => { calls.push({ url: String(url), init }); return impl(String(url), init); });
  return calls;
}

const okBrevo = () => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ messageId: 123 }) });

// ⚠ Must be Central-time "today", not the CI runner's local clock (usually UTC).
// sendBirthdayTexts/sendAnniversaryTexts decide "today" via centralTodayMMDD()
// (BG2/SW9) — a plain `new Date()` here disagreed with that for hours every
// evening (UTC rolls to the next day ~5-6 hours before Central does), so the
// seeded birthday matched neither day and every assertion here failed with no
// real bug involved. Reusing the app's own helper keeps the two in sync no
// matter what timezone the test happens to run in.
const MMDD = centralTodayMMDD();
const DOB = `1990-${MMDD}`;

afterEach(() => { vi.unstubAllGlobals(); });

let db, sqlite;
beforeEach(() => { ({ db, sqlite } = makeDb()); });

describe('birthday/anniversary SMS now sends through Brevo, not Twilio', () => {
  it('calls Brevo’s transactional SMS endpoint with the api-key header, not Twilio', async () => {
    sqlite.exec(`INSERT INTO people (first_name,last_name,phone,dob,sms_opt_in,member_type) VALUES ('Jane','Doe','3145551212','${DOB}',1,'member')`);
    const calls = stubFetch(() => okBrevo());
    const result = await sendBirthdayTexts({ DB: db, BREVO_API_KEY: 'brevo-key' });
    expect(result.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/transactionalSMS/sms');
    expect(calls[0].init.headers['api-key']).toBe('brevo-key');
    const body = JSON.parse(calls[0].init.body);
    expect(body.recipient).toBe('+13145551212');
    expect(body.type).toBe('transactional');
    expect(body.content).toContain('Jane');
  });

  it('reports "BREVO_API_KEY not set", never mentions Twilio, when unconfigured', async () => {
    sqlite.exec(`INSERT INTO people (first_name,last_name,phone,dob,sms_opt_in,member_type) VALUES ('Jane','Doe','3145551212','${DOB}',1,'member')`);
    stubFetch(() => okBrevo());
    const result = await sendBirthdayTexts({ DB: db }); // no BREVO_API_KEY
    expect(result.sent).toBe(0);
    expect(result.errors.join(' ')).toContain('BREVO_API_KEY');
    expect(result.errors.join(' ')).not.toContain('Twilio');
  });

  it('uses the admin-configured sender name, sanitized to 11 alphanumeric chars', async () => {
    sqlite.exec(`INSERT INTO people (first_name,last_name,phone,dob,sms_opt_in,member_type) VALUES ('Jane','Doe','3145551212','${DOB}',1,'member')`);
    sqlite.exec(`INSERT INTO chms_config (key,value) VALUES ('sms_sender_name','Not Valid!! Way Too Long')`);
    const calls = stubFetch(() => okBrevo());
    await sendBirthdayTexts({ DB: db, BREVO_API_KEY: 'k' });
    const body = JSON.parse(calls[0].init.body);
    // 'NotValidWayTooLong' stripped of spaces/punctuation, then cut to 11 chars
    expect(body.sender).toBe('NotValidWay');
    expect(body.sender.length).toBeLessThanOrEqual(11);
    expect(/^[A-Za-z0-9]+$/.test(body.sender)).toBe(true);
  });

  it('falls back to a safe default sender when nothing is configured', async () => {
    sqlite.exec(`INSERT INTO people (first_name,last_name,phone,dob,sms_opt_in,member_type) VALUES ('Jane','Doe','3145551212','${DOB}',1,'member')`);
    const calls = stubFetch(() => okBrevo());
    await sendBirthdayTexts({ DB: db, BREVO_API_KEY: 'k' });
    const body = JSON.parse(calls[0].init.body);
    expect(body.sender).toBe('TimothyLuth');
  });

  it('anniversary texts also route through Brevo with the couple’s greeting', async () => {
    sqlite.exec(`INSERT INTO people (first_name,last_name,phone,anniversary_date,family_role,household_id,sms_opt_in,member_type)
      VALUES ('Alice','Smith','3145551111','1990-${MMDD}','head',1,1,'member')`);
    sqlite.exec(`INSERT INTO people (first_name,last_name,phone,anniversary_date,family_role,household_id,sms_opt_in,member_type)
      VALUES ('Bob','Smith','3145552222','1990-${MMDD}','spouse',1,1,'member')`);
    const calls = stubFetch(() => okBrevo());
    const result = await sendAnniversaryTexts({ DB: db, BREVO_API_KEY: 'k' });
    expect(result.sent).toBe(2); // sendAnniversaryTexts counts sent per successful message, one per phone
    expect(calls).toHaveLength(2); // a text goes to each of the two phones in the household
    expect(calls.every(c => c.url === 'https://api.brevo.com/v3/transactionalSMS/sms')).toBe(true);
    const bodies = calls.map(c => JSON.parse(c.init.body));
    expect(bodies[0].content).toContain('Alice and Bob');
  });
});
