import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  // Every Connect migration, in order, so giving_entries/people/deposits carry their real columns.
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  }
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    _raw: sqlite,
  };
}

function insertUser(db, { username, email, role, active = 1 }) {
  db._raw.prepare(
    `INSERT INTO app_users (username, password_hash, role, active, email) VALUES (?,?,?,?,?)`
  ).run(username, 'irrelevant-hash', role, active, email);
}

function insertFund(db, name) {
  db._raw.prepare('INSERT INTO funds (name) VALUES (?)').run(name);
  return db._raw.prepare('SELECT id FROM funds WHERE name=?').get(name).id;
}

// ── Minimal RSA JWT helpers, mirroring test/access-jwt.test.js ─────────────
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
}
async function signToken(privateKey, kid, payload) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}
function accessPayload(email, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { email, iss: `https://${TEAM}`, aud: AUD, exp: now + 3600, iat: now, ...overrides };
}



describe('Giving analytics contracts (giving-analytics-*-v1, giving-followup-write-v1)', () => {
  let keyPair, jwk, kid, originalFetch;
  beforeEach(async () => {
    resetAccessJwtCacheForTests();
    originalFetch = globalThis.fetch;
    kid = 'test-kid';
    keyPair = await makeKeyPair();
    jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    jwk.kid = kid;
    globalThis.fetch = async (url) => {
      if (String(url) === CERTS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      throw new Error(`Unexpected fetch in test: ${url}`);
    };
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const env = (db) => ({ DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD });
  async function call(db, path, { email = 'sarah@timothystl.org', method = 'GET', body, query = '?as_of=2026-09-20' } = {}) {
    const token = await signToken(keyPair.privateKey, kid, accessPayload(email));
    const req = new Request(`https://connect.example${path}${query}`, {
      method,
      headers: { 'X-Contract-Key': 'right-secret', 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return handleContractsServiceApi(req, env(db), path);
  }

  function setup() {
    const db = makeTestDb();
    const general = insertFund(db, 'General Fund');
    const building = insertFund(db, 'Building Fund');
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    insertUser(db, { username: 'carl', email: 'carl@timothystl.org', role: 'council' });
    insertUser(db, { username: 'pastor', email: 'pastor@timothystl.org', role: 'admin' });
    const raw = db._raw;
    raw.prepare("INSERT INTO households (name) VALUES ('The Krause Family')").run();
    const hh = raw.prepare('SELECT id FROM households').get().id;
    const person = (first, last, extra = {}) => {
      raw.prepare('INSERT INTO people (first_name, last_name, household_id, member_type) VALUES (?,?,?,?)')
        .run(first, last, extra.household ?? null, extra.type || 'member');
      return raw.prepare('SELECT MAX(id) AS id FROM people').get().id;
    };
    const ids = {
      walter: person('Walter', 'Krause', { household: hh }),
      mary: person('Mary', 'Krause', { household: hh }),
      anna: person('Anna', 'Schreiber'),
      jordan: person('Jordan', 'Ellis'),
      claire: person('Claire', 'Hollis'),
      minh: person('Minh', 'Nguyen'),
      acme: person('Acme', 'Hardware', { type: 'organization' }),
    };
    raw.prepare("INSERT INTO giving_batches (batch_date, description) VALUES ('2026-09-20','Test')").run();
    const gift = (who, day, dollars, { fund = general, method = 'check' } = {}) => raw.prepare(
      'INSERT INTO giving_entries (batch_id, person_id, fund_id, amount, method, contribution_date) VALUES (1,?,?,?,?,?)'
    ).run(who, fund, Math.round(dollars * 100), method, day);
    // Krause household: $200 a month from Walter since 2024, plus Mary online in 2026.
    for (const y of [2024, 2025, 2026]) {
      for (let m = 1; m <= (y === 2026 ? 9 : 12); m += 1) gift(ids.walter, `${y}-${String(m).padStart(2, '0')}-06`, 200);
    }
    gift(ids.mary, '2026-03-15', 500, { method: 'online', fund: building });
    // Anna: monthly Jul 2025 – May 2026, then nothing.
    for (const d of ['2025-07-06', '2025-08-03', '2025-09-07', '2025-10-05', '2025-11-02', '2025-12-07', '2026-01-04', '2026-02-01', '2026-03-01', '2026-04-05', '2026-05-03']) gift(ids.anna, d, 100);
    gift(ids.jordan, '2026-09-13', 150, { method: 'online' });
    // Claire: $1,200 in the six months before, $300 in the last six.
    gift(ids.claire, '2025-10-12', 600); gift(ids.claire, '2026-01-11', 600); gift(ids.claire, '2026-08-16', 300);
    // Minh: $200 before, $1,000 recently.
    gift(ids.minh, '2025-11-09', 200); gift(ids.minh, '2026-05-10', 500); gift(ids.minh, '2026-08-09', 500);
    gift(ids.acme, '2026-02-01', 5000);
    raw.prepare("INSERT INTO giving_entries (batch_id, person_id, fund_id, amount, method, contribution_date) VALUES (1, NULL, ?, 11400, 'cash', '2026-09-20')").run(general);
    raw.prepare('INSERT INTO pledges (person_id, fiscal_year, amount_cents) VALUES (?, 2026, 600000)').run(ids.walter);
    return { db, ids, general };
  }

  it('reports totals, weeks, funds, household bands and pledges without naming anyone', async () => {
    const { db } = setup();
    const res = await call(db, '/api/contracts/giving-analytics-v1');
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a).toMatchObject({ contract: 'connect.giving-analytics.v1', as_of: '2026-09-20', year: 2026 });
    // 2026 through Sep 20: Walter 9×$200, Mary $500, Anna 5×$100, Jordan $150, Claire $900, Minh $1,000, Acme $5,000, loose $114.
    expect(a.totals.ytd_cents).toBe(180000 + 50000 + 50000 + 15000 + 90000 + 100000 + 500000 + 11400);
    expect(a.totals.ytd_online_cents).toBe(65000);
    expect(a.totals.first_time_givers).toBe(2); // Jordan, and Mary's first gift in March; never the organization
    expect(a.weeks).toHaveLength(13);
    expect(a.weeks.at(-1)).toMatchObject({ week_ending: '2026-09-20', cents: 11400 });
    expect(a.funds[0].fund_name).toBe('General Fund');
    expect(a.months.find((m) => m.month === '2026-09').cents).toBe(20000 + 15000 + 11400);
    // Households exclude organizations and anonymous cash.
    expect(a.households.ytd_households).toBe(5);
    expect(a.households.both_years_households).toBe(4);
    expect(a.households.bands.reduce((s, b) => s + b.households, 0)).toBe(a.households.t12_households);
    expect(a.households.bands.find((b) => b.label === '$2,500 – $4,999').households).toBe(1);
    expect(a.pledges).toMatchObject({ pledgers: 1, pledged_cents: 600000, received_cents: 180000, behind: 1 });
    const c = a.households.concentration;
    expect(c.households).toBe(a.households.t12_households);
    expect(c.deciles).toHaveLength(10);
    expect(c.deciles.reduce((s2, d) => s2 + d.share, 0)).toBeCloseTo(1, 6);
    expect(c.deciles.reduce((s2, d) => s2 + d.households, 0)).toBe(c.households);
    expect(c.top_ten_share).toBe(1);
    expect(c.households_1000_plus).toBeGreaterThan(0);
    const text = JSON.stringify(a);
    for (const name of ['Krause', 'Schreiber', 'Ellis', 'Hollis', 'Nguyen', 'Acme']) expect(text).not.toContain(name);
  });

  it('lets council read the totals but not the named detail or the follow-up writer', async () => {
    const { db } = setup();
    expect((await call(db, '/api/contracts/giving-analytics-v1', { email: 'carl@timothystl.org' })).status).toBe(200);
    const named = await call(db, '/api/contracts/giving-analytics-people-v1', { email: 'carl@timothystl.org' });
    expect(named.status).toBe(403);
    expect((await named.json()).error).toContain('council access is totals only');
    const write = await call(db, '/api/contracts/giving-followup-write-v1', { email: 'carl@timothystl.org', method: 'POST', body: { op: 'done', kind: 'stopped', subject_key: 'p:3', episode: '2026-05-03' } });
    expect(write.status).toBe(403);
    expect((await call(db, '/api/contracts/giving-analytics-v1', { email: 'stranger@example.com' })).status).toBe(403);
  });

  it('finds nudges, and remembers who has one and when it is done', async () => {
    const { db, ids } = setup();
    const people = await (await call(db, '/api/contracts/giving-analytics-people-v1')).json();
    const kind = (k) => people.nudges.kinds.find((x) => x.key === k);
    expect(kind('first_time').items.map((i) => i.name)).toEqual(['Jordan Ellis']);
    expect(kind('first_time').items[0]).toMatchObject({ subject_key: `ge${ids.jordan}:2026-09-13`, episode: '2026-09-13', cents: 15000 });
    expect(kind('stopped').items.map((i) => i.name)).toEqual(['Anna Schreiber']);
    expect(kind('giving_down').items.map((i) => i.name)).toEqual(['Claire Hollis']);
    expect(kind('stepped_up').items.map((i) => i.name)).toEqual(['Minh Nguyen']);
    expect(kind('pledge_behind').items.map((i) => i.name)).toEqual(['Walter Krause']);
    expect(JSON.stringify(people)).not.toContain('Acme');
    expect(people.staff.map((s) => s.username)).toEqual(expect.arrayContaining(['sarah', 'pastor']));
    expect(people.staff.map((s) => s.username)).not.toContain('carl');

    const stopped = kind('stopped').items[0];
    const post = (body) => call(db, '/api/contracts/giving-followup-write-v1', { method: 'POST', body: { kind: 'stopped', subject_key: stopped.subject_key, episode: stopped.episode, ...body } });
    expect((await post({ op: 'assign', assigned_to: 'pastor' })).status).toBe(200);
    expect((await post({ op: 'assign', assigned_to: 'nobody' })).status).toBe(400);
    let again = await (await call(db, '/api/contracts/giving-analytics-people-v1')).json();
    expect(again.nudges.kinds.find((x) => x.key === 'stopped').items[0].assigned_to).toBe('pastor');
    expect((await post({ op: 'done' })).status).toBe(200);
    again = await (await call(db, '/api/contracts/giving-analytics-people-v1')).json();
    expect(again.nudges.kinds.find((x) => x.key === 'stopped').open_count).toBe(0);
    expect(again.nudges.done_this_month).toBe(1);
    const row = db._raw.prepare('SELECT assigned_to, status, done_by FROM giving_followups').get();
    expect(row).toEqual({ assigned_to: 'pastor', status: 'done', done_by: 'sarah@timothystl.org' });
    expect(db._raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'giving_followup_%_via_finance'").get().n).toBe(2);
    expect((await post({ op: 'reopen' })).status).toBe(200);
    expect((await post({ op: 'drop' })).status).toBe(400);
    expect((await call(db, '/api/contracts/giving-followup-write-v1', { method: 'POST', body: { op: 'done', kind: 'stopped', subject_key: "p:1' OR 1=1", episode: '2026-05-03' } })).status).toBe(400);
  });

  it('treats a first gift already thanked from Connect as done, and summarizes statement runs', async () => {
    const { db, ids } = setup();
    db._raw.prepare(`INSERT INTO giving_letter_sends (person_id, year, letter_type, channel, recipient_key, sent_at) VALUES (?, 2026, 'thank_you', 'email', ?, '2026-09-14 10:00:00')`).run(ids.jordan, `ge${ids.jordan}:2026-09-13`);
    db._raw.prepare(`INSERT INTO giving_letter_sends (person_id, year, letter_type, channel, recipient_key, sent_at) VALUES (?, 2025, 'year_end', 'email', 'h1', '2026-01-21 09:00:00'), (?, 2025, 'year_end', 'print', 'p3', '2026-01-22 09:00:00')`).run(ids.walter, ids.anna);
    const people = await (await call(db, '/api/contracts/giving-analytics-people-v1')).json();
    expect(people.nudges.kinds.find((x) => x.key === 'first_time').open_count).toBe(0);
    expect(people.statements.runs).toEqual([{ year: 2025, letter_type: 'year_end', email: 1, print: 1, last_sent: '2026-01-22 09:00:00' }]);
    expect(people.statements.giving_households_ytd).toBe(5);
  });
});
