import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initDb, _resetInitForTests } from '../src/db.js';
import {
  matchPersonForPayer, recordStaxGift, handleStaxGivingWebhook, handleStaxGivingMockupPublicApi,
} from '../src/stax-giving-mockup.js';
import { handleGivingApi } from '../src/api-giving.js';

// Same real-schema-via-real-initDb approach as test/engagement-tasks-race.test.js: this runs
// the actual migration 0053 additions (see src/db.js), not a hand-copied subset of them.
const forNodeSqlite = (sql) => sql.replace(/=""/g, "=''");

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const q = forNodeSqlite(sql);
      const mk = (args) => ({
        async run() {
          const r = sqlite.prepare(q).run(...args);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
        },
        async first() { return sqlite.prepare(q).get(...args); },
        async all() { return { results: sqlite.prepare(q).all(...args) }; },
      });
      return { bind: (...args) => mk(args), ...mk([]) };
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    _raw: sqlite,
  };
  return db;
}

function insertFund(db, name) {
  db._raw.prepare('INSERT INTO funds (name) VALUES (?)').run(name);
  return db._raw.prepare('SELECT id FROM funds WHERE name=?').get(name).id;
}
function insertPerson(db, { first, last, email, phone }) {
  db._raw.prepare(
    "INSERT INTO people (first_name,last_name,email,phone,active,status) VALUES (?,?,?,?,1,'active')"
  ).run(first, last, email || '', phone || '');
  return db._raw.prepare('SELECT id FROM people WHERE email=? AND first_name=?').get(email || '', first).id;
}

beforeEach(() => _resetInitForTests());

describe('Stax Giving mockup — donor matching', () => {
  it('matches by email first, case-insensitively', async () => {
    const db = makeDb();
    await initDb(db);
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'Jamie@Example.com', phone: '' });
    const p = await matchPersonForPayer(db, { email: 'jamie@example.com', phone: '' });
    expect(p.id).toBe(pid);
  });

  it('falls back to phone when email does not match', async () => {
    const db = makeDb();
    await initDb(db);
    const pid = insertPerson(db, { first: 'Rae', last: 'Okafor', email: '', phone: '(314) 555-0101' });
    const p = await matchPersonForPayer(db, { email: 'nobody@example.com', phone: '3145550101' });
    expect(p.id).toBe(pid);
  });

  it('returns null when nothing matches', async () => {
    const db = makeDb();
    await initDb(db);
    const p = await matchPersonForPayer(db, { email: 'stranger@example.com', phone: '5555550000' });
    expect(p).toBeNull();
  });
});

describe('Stax Giving mockup — recordStaxGift', () => {
  it('records a matched gift against the EXISTING giving_entries ledger, with contribution_date set', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'jamie@example.com', phone: '' });

    const result = await recordStaxGift(db, {
      externalTxnId: 'txn-abc', fundId, amountCents: 5000,
      payerName: 'Jamie Vogel', payerEmail: 'jamie@example.com',
    });
    expect(result.matched).toBe(true);
    expect(result.personId).toBe(pid);

    const row = await db.prepare('SELECT * FROM giving_entries WHERE id=?').bind(result.entryId).first();
    expect(row.person_id).toBe(pid);
    expect(row.fund_id).toBe(fundId);
    expect(row.amount).toBe(5000);
    expect(row.processor).toBe('stax');
    expect(row.external_txn_id).toBe('txn-abc');
    expect(row.contribution_date).not.toBe('');

    const unmatched = await db.prepare('SELECT COUNT(*) c FROM giving_stax_unmatched').first();
    expect(unmatched.c).toBe(0);
  });

  it('lands an unmatched gift with person_id NULL and stages the raw payer info for review', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'Missions');

    const result = await recordStaxGift(db, {
      externalTxnId: 'txn-unmatched', fundId, amountCents: 2500,
      payerName: 'A Stranger', payerEmail: 'stranger@example.com', payerPhone: '3145559999',
      cardBrand: 'visa', cardLast4: '4242',
    });
    expect(result.matched).toBe(false);
    expect(result.personId).toBeNull();

    const row = await db.prepare('SELECT * FROM giving_entries WHERE id=?').bind(result.entryId).first();
    expect(row.person_id).toBeNull();

    const queueRow = await db.prepare('SELECT * FROM giving_stax_unmatched WHERE giving_entry_id=?').bind(result.entryId).first();
    expect(queueRow.status).toBe('open');
    expect(queueRow.payer_email).toBe('stranger@example.com');
    expect(queueRow.card_last4).toBe('4242');
  });

  it('is idempotent on (processor, external_txn_id) — a redelivery never double-records', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');

    const first = await recordStaxGift(db, { externalTxnId: 'dup-1', fundId, amountCents: 1000, payerEmail: 'x@example.com' });
    const second = await recordStaxGift(db, { externalTxnId: 'dup-1', fundId, amountCents: 1000, payerEmail: 'x@example.com' });
    expect(second.alreadyRecorded).toBe(true);
    expect(second.entryId).toBe(first.entryId);

    const count = await db.prepare("SELECT COUNT(*) c FROM giving_entries WHERE external_txn_id='dup-1'").first();
    expect(count.c).toBe(1);
  });

  it('remembers a returning donor by stax_customer_id even if the payer email on the card differs', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Rae', last: 'Okafor', email: 'rae@example.com', phone: '' });

    await recordStaxGift(db, {
      externalTxnId: 'txn-1', fundId, amountCents: 1000,
      payerEmail: 'rae@example.com', staxCustomerId: 'cus_123',
    });
    // Second gift's card was entered with a different (e.g. work) email, but Stax recognizes the
    // same customer id — should still land on the same person via giving_stax_customers.
    const second = await recordStaxGift(db, {
      externalTxnId: 'txn-2', fundId, amountCents: 2000,
      payerEmail: 'rae.work@example.com', staxCustomerId: 'cus_123',
    });
    expect(second.matched).toBe(true);
    expect(second.personId).toBe(pid);
  });
});

describe('Stax Giving mockup — webhook', () => {
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_GIVING_WEBHOOK_SECRET: 'whsec_test' });

  it('rejects a webhook call without a valid secret', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=wrong', {
      method: 'POST', body: JSON.stringify({ id: 'evt_1' }),
    });
    const res = await handleStaxGivingWebhook(req, { ...env(), DB: db }, new URL(req.url));
    expect(res.status).toBe(401);
  });

  it('503s when the mockup is not configured', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook', { method: 'POST', body: '{}' });
    const res = await handleStaxGivingWebhook(req, { DB: db }, new URL(req.url));
    expect(res.status).toBe(503);
  });

  it('re-fetches and verifies the transaction before recording a charge (does not trust the POST body)', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');

    global.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain('/transaction/evt_charge_1');
      return new Response(JSON.stringify({
        data: {
          id: 'evt_charge_1', type: 'charge', success: true, status: 'SUCCESS', total: '42.00',
          customer_id: 'cus_9', meta: { fund_id: fundId, payer_name: 'Payer One', payer_email: 'payer1@example.com' },
          payment_method: { method_type: 'card', card_type: 'visa', card_last_four: '1111' },
        },
      }), { status: 200 });
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=whsec_test', {
      method: 'POST',
      // Deliberately wrong amount in the body — only the RE-FETCHED transaction's $42.00 should
      // be trusted, mirroring childcare-portal's stax-webhook contract.
      body: JSON.stringify({ id: 'evt_charge_1', total: '999999.00' }),
    });
    const res = await handleStaxGivingWebhook(req, { ...env(), DB: db }, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    const row = await db.prepare("SELECT * FROM giving_entries WHERE external_txn_id='evt_charge_1'").first();
    expect(row.amount).toBe(4200);
    expect(row.processor).toBe('stax');
  });

  it('records a refund as a negative entry against the original gift, idempotently', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const charge = await recordStaxGift(db, { externalTxnId: 'chg_1', fundId, amountCents: 5000, payerEmail: 'x@example.com' });

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'evt_refund_1', type: 'refund', success: true, status: 'SUCCESS', total: '50.00', reference_id: 'chg_1' },
    }), { status: 200 }));

    const makeReq = () => new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=whsec_test', {
      method: 'POST', body: JSON.stringify({ id: 'evt_refund_1' }),
    });
    const req = makeReq();
    const res = await handleStaxGivingWebhook(req, { ...env(), DB: db }, new URL(req.url));
    expect(res.status).toBe(200);

    const refundRow = await db.prepare("SELECT * FROM giving_entries WHERE external_txn_id='evt_refund_1'").first();
    expect(refundRow.amount).toBe(-5000);
    expect(refundRow.fund_id).toBe(fundId);

    // Redelivery of the same refund event (a fresh Request, since a body stream reads once) must
    // not create a second reversal.
    const req2 = makeReq();
    const res2 = await handleStaxGivingWebhook(req2, { ...env(), DB: db }, new URL(req2.url));
    expect(res2.status).toBe(200);
    const count = await db.prepare("SELECT COUNT(*) c FROM giving_entries WHERE external_txn_id='evt_refund_1'").first();
    expect(count.c).toBe(1);
    void charge; // referenced above only to create the original gift
  });
});

describe('Stax Giving mockup — public checkout API (demo mode)', () => {
  it('lists only active funds', async () => {
    const db = makeDb();
    await initDb(db);
    // initDb seeds its own default funds (seedChmsDefaults) — assert on the two funds this test
    // adds, not on the full list, so it doesn't drift if the seeded defaults ever change.
    insertFund(db, 'Mockup Open Fund');
    const closedId = insertFund(db, 'Mockup Closed Fund');
    await db.prepare('UPDATE funds SET active=0 WHERE id=?').bind(closedId).run();

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/funds');
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'GET', 'funds');
    const body = await res.json();
    const names = body.funds.map(f => f.name);
    expect(names).toContain('Mockup Open Fund');
    expect(names).not.toContain('Mockup Closed Fund');
    expect(body.configured).toBe(false);
  });

  it('records a demo gift end to end when no live Stax sandbox key is configured', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'jamie@example.com', phone: '' });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({ fund_id: fundId, amount: '25.00', payer_name: 'Jamie Vogel', payer_email: 'jamie@example.com' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(body.matched).toBe(true);
    expect(body.personId).toBe(pid);
  });

  it('refuses a checkout against an inactive fund', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'Retired Fund');
    await db.prepare('UPDATE funds SET active=0 WHERE id=?').bind(fundId).run();

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST', body: JSON.stringify({ fund_id: fundId, amount: '10.00', payer_name: 'X', payer_email: 'x@example.com' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(400);
  });
});

describe('Stax Giving mockup — CORS (browser calls from the Website domain)', () => {
  it('echoes Access-Control-Allow-Origin for the allowlisted give.timothystl.org origin', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/funds', {
      headers: { Origin: 'https://give.timothystl.org' },
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'GET', 'funds');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://give.timothystl.org');
  });

  it('does not echo Access-Control-Allow-Origin for an origin not on the allowlist', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/funds', {
      headers: { Origin: 'https://evil.example.com' },
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'GET', 'funds');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers an OPTIONS preflight with the allowlisted origin and no route logic', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'OPTIONS', headers: { Origin: 'https://give.timothystl.org' },
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'OPTIONS', 'checkout');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://give.timothystl.org');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('Stax Giving mockup — staff review queue (src/api-giving.js)', () => {
  function givingReq(method, body) {
    return new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/queue', {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
  }

  it('lists open unmatched gifts for staff', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    await recordStaxGift(db, { externalTxnId: 'q1', fundId, amountCents: 1000, payerName: 'Unmatched Payer', payerEmail: 'nobody@example.com' });

    const req = givingReq('GET');
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'GET', 'giving/stax-mockup/queue', db, false, true, false, true);
    const body = await res.json();
    expect(body.queue.length).toBe(1);
    expect(body.queue[0].payer_email).toBe('nobody@example.com');
  });

  it('links an unmatched gift to a person, updating both the ledger row and the queue', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Late', last: 'Match', email: 'late@example.com', phone: '' });
    const gift = await recordStaxGift(db, { externalTxnId: 'q2', fundId, amountCents: 1000, payerName: 'Late Match', payerEmail: 'typo@example.com' });

    const queueRow = await db.prepare('SELECT id FROM giving_stax_unmatched WHERE giving_entry_id=?').bind(gift.entryId).first();
    const req = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/queue/' + queueRow.id + '/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: pid }),
    });
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'POST', 'giving/stax-mockup/queue/' + queueRow.id + '/link', db, false, true, false, true);
    expect(res.status).toBe(200);

    const entry = await db.prepare('SELECT person_id FROM giving_entries WHERE id=?').bind(gift.entryId).first();
    expect(entry.person_id).toBe(pid);
    const updatedQueue = await db.prepare('SELECT status, linked_person_id FROM giving_stax_unmatched WHERE id=?').bind(queueRow.id).first();
    expect(updatedQueue.status).toBe('linked');
    expect(updatedQueue.linked_person_id).toBe(pid);
  });

  it('rejects linking for a non-finance role', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const gift = await recordStaxGift(db, { externalTxnId: 'q3', fundId, amountCents: 1000, payerEmail: 'nobody@example.com' });
    const queueRow = await db.prepare('SELECT id FROM giving_stax_unmatched WHERE giving_entry_id=?').bind(gift.entryId).first();

    const req = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/queue/' + queueRow.id + '/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: 1 }),
    });
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'POST', 'giving/stax-mockup/queue/' + queueRow.id + '/link', db, false, false, false, true);
    expect(res.status).toBe(403);
  });

  it('ignoring a queue row leaves the gift in the ledger unmatched but closes the review item', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const gift = await recordStaxGift(db, { externalTxnId: 'q4', fundId, amountCents: 1000, payerEmail: 'nobody@example.com' });
    const queueRow = await db.prepare('SELECT id FROM giving_stax_unmatched WHERE giving_entry_id=?').bind(gift.entryId).first();

    const req = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/queue/' + queueRow.id + '/ignore', { method: 'POST' });
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'POST', 'giving/stax-mockup/queue/' + queueRow.id + '/ignore', db, false, true, false, true);
    expect(res.status).toBe(200);

    const updatedQueue = await db.prepare('SELECT status FROM giving_stax_unmatched WHERE id=?').bind(queueRow.id).first();
    expect(updatedQueue.status).toBe('ignored');
    const entry = await db.prepare('SELECT person_id FROM giving_entries WHERE id=?').bind(gift.entryId).first();
    expect(entry.person_id).toBeNull();
  });
});
