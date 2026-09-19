import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initDb, _resetInitForTests } from '../src/db.js';
import {
  matchPersonForPayer, recordStaxGift, handleStaxGivingWebhook, handleStaxGivingMockupPublicApi,
  renderStaxGivingMockupReviewHtml, buildScheduleRule,
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

function insertFund(db, name, { publicGiving = true } = {}) {
  // initDb seeds its own defaults, some sharing common names ("General Fund") — look up by the
  // row just inserted (highest id), not by name, so a test never accidentally reads back a
  // same-named seeded row instead of the one it just created.
  const r = db._raw.prepare('INSERT INTO funds (name, public_giving) VALUES (?,?)').run(name, publicGiving ? 1 : 0);
  return Number(r.lastInsertRowid);
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

  it('parses meta.splits for a multi-fund charge into one giving_entries row per fund', async () => {
    const db = makeDb();
    await initDb(db);
    const fundA = insertFund(db, 'General Fund');
    const fundB = insertFund(db, 'Missions');

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: {
        id: 'evt_multi_1', type: 'charge', success: true, status: 'SUCCESS', total: '50.00',
        customer_id: 'cus_multi',
        meta: {
          splits: JSON.stringify([{ f: fundA, a: 3000 }, { f: fundB, a: 2000 }]),
          payer_first_name: 'Multi', payer_last_name: 'Payer', payer_email: 'multi@example.com',
        },
        payment_method: { method_type: 'card' },
      },
    }), { status: 200 }));

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=whsec_test', {
      method: 'POST', body: JSON.stringify({ id: 'evt_multi_1' }),
    });
    const res = await handleStaxGivingWebhook(req, { ...env(), DB: db }, new URL(req.url));
    expect(res.status).toBe(200);

    const rows = (await db.prepare("SELECT fund_id, amount FROM giving_entries WHERE external_txn_id LIKE 'evt_multi_1%' ORDER BY fund_id").all()).results;
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.amount).sort((a, b) => a - b)).toEqual([2000, 3000]);
  });

  it('emails a gift receipt via the existing Brevo transactional path once a charge is confirmed', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'Building Fund');
    db._raw.prepare("INSERT INTO chms_config (key, value) VALUES ('church_from_email', 'giving@timothystl.org')").run();

    const brevoCalls = [];
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/transaction/')) {
        return new Response(JSON.stringify({
          data: {
            id: 'evt_receipt_1', type: 'charge', success: true, status: 'SUCCESS', total: '75.00',
            customer_id: 'cus_r1', meta: { fund_id: fundId, payer_first_name: 'Robin', payer_last_name: 'Vale', payer_email: 'robin@example.com', memo: 'In memory of Grandma' },
            payment_method: { method_type: 'card' },
          },
        }), { status: 200 });
      }
      if (u.includes('api.brevo.com')) {
        brevoCalls.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ messageId: 'brevo_1' }), { status: 200 });
      }
      throw new Error('unexpected fetch ' + u);
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=whsec_test', {
      method: 'POST', body: JSON.stringify({ id: 'evt_receipt_1' }),
    });
    const res = await handleStaxGivingWebhook(req, { ...env(), BREVO_API_KEY: 'brevo_test', DB: db }, new URL(req.url));
    expect(res.status).toBe(200);

    expect(brevoCalls.length).toBe(1);
    expect(brevoCalls[0].to[0].email).toBe('robin@example.com');
    expect(brevoCalls[0].subject).toContain('Thank you');
    expect(brevoCalls[0].htmlContent).toContain('Building Fund');
    expect(brevoCalls[0].htmlContent).toContain('$75.00');
    expect(brevoCalls[0].htmlContent).toContain('In memory of Grandma');
  });

  it('never emails a receipt for a redelivered webhook event (idempotent on alreadyRecorded)', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    db._raw.prepare("INSERT INTO chms_config (key, value) VALUES ('church_from_email', 'giving@timothystl.org')").run();

    let brevoCallCount = 0;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/transaction/')) {
        return new Response(JSON.stringify({
          data: {
            id: 'evt_redeliver_1', type: 'charge', success: true, status: 'SUCCESS', total: '15.00',
            customer_id: 'cus_r2', meta: { fund_id: fundId, payer_email: 'again@example.com' },
            payment_method: { method_type: 'card' },
          },
        }), { status: 200 });
      }
      if (u.includes('api.brevo.com')) { brevoCallCount++; return new Response(JSON.stringify({ messageId: 'x' }), { status: 200 }); }
      throw new Error('unexpected fetch ' + u);
    });

    const makeReq = () => new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=whsec_test', {
      method: 'POST', body: JSON.stringify({ id: 'evt_redeliver_1' }),
    });
    const testEnv = { ...env(), BREVO_API_KEY: 'brevo_test', DB: db };
    await handleStaxGivingWebhook(makeReq(), testEnv, new URL('https://x/?secret=whsec_test'));
    await handleStaxGivingWebhook(makeReq(), testEnv, new URL('https://x/?secret=whsec_test'));
    expect(brevoCallCount).toBe(1);
  });

  it('never emails a receipt in demo mode — there is no real charge behind it to confirm', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    db._raw.prepare("INSERT INTO chms_config (key, value) VALUES ('church_from_email', 'giving@timothystl.org')").run();

    let brevoCallCount = 0;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('api.brevo.com')) { brevoCallCount++; return new Response(JSON.stringify({ messageId: 'x' }), { status: 200 }); }
      throw new Error('unexpected fetch ' + url);
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }],
        payer_first_name: 'Demo', payer_last_name: 'Mode', payer_email: 'demo@example.com',
      }),
    });
    // BREVO_API_KEY set, but no STAX_SANDBOX_API_KEY — demo mode, per staxMockupConfigured().
    const res = await handleStaxGivingMockupPublicApi(req, { BREVO_API_KEY: 'brevo_test', DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(200);
    expect(brevoCallCount).toBe(0);
  });

  it('refuses a partial refund against a multi-fund gift rather than guessing which fund absorbs it', async () => {
    const db = makeDb();
    await initDb(db);
    const fundA = insertFund(db, 'General Fund');
    const fundB = insertFund(db, 'Missions');
    await recordStaxGift(db, {
      externalTxnId: 'chg_multi', splits: [{ fundId: fundA, amountCents: 3000 }, { fundId: fundB, amountCents: 2000 }],
      payerEmail: 'x@example.com',
    });

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'evt_partial_refund', type: 'refund', success: true, status: 'SUCCESS', total: '20.00', reference_id: 'chg_multi' },
    }), { status: 200 }));
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/webhook?secret=whsec_test', {
      method: 'POST', body: JSON.stringify({ id: 'evt_partial_refund' }),
    });
    const res = await handleStaxGivingWebhook(req, { ...env(), DB: db }, new URL(req.url));
    expect(res.status).toBe(409);
  });
});

describe('Stax Giving mockup — public checkout API (demo mode)', () => {
  it('lists only active, public_giving funds', async () => {
    const db = makeDb();
    await initDb(db);
    // initDb seeds its own default funds (seedChmsDefaults) with public_giving=0 (the new
    // column's default) — assert on the funds this test adds, not the full list, so it doesn't
    // drift if the seeded defaults ever change.
    insertFund(db, 'Mockup Open Fund');
    insertFund(db, 'Mockup Not-Public Fund', { publicGiving: false });
    const closedId = insertFund(db, 'Mockup Closed Fund');
    await db.prepare('UPDATE funds SET active=0 WHERE id=?').bind(closedId).run();

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/funds');
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'GET', 'funds');
    const body = await res.json();
    const names = body.funds.map(f => f.name);
    expect(names).toContain('Mockup Open Fund');
    expect(names).not.toContain('Mockup Not-Public Fund');
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
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }],
        payer_first_name: 'Jamie', payer_last_name: 'Vogel', payer_email: 'jamie@example.com',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(body.matched).toBe(true);
    expect(body.personId).toBe(pid);
    expect(body.totalCents).toBe(2500);
  });

  it('requires first name, last name, and email', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({ gifts: [{ fund_id: fundId, amount: '10.00' }], payer_first_name: 'X' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(400);
  });

  // Stress-tested live against production: "notanemail" sailed straight through the old
  // truthiness-only check and was stopped only by the unrelated missing payment_method_id check
  // further down — meaning it would have silently reached a real Stax customer/charge call had
  // one been supplied. Never validated at all before this.
  it('rejects a malformed email address instead of silently accepting it', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '10.00' }],
        payer_first_name: 'Test', payer_last_name: 'Case', payer_email: 'notanemail',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Enter a valid email address.');
  });

  it('accepts a normal email address', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '10.00' }],
        payer_first_name: 'Test', payer_last_name: 'Case', payer_email: 'test.case+gift@example.co.uk',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(200);
  });

  it('refuses a checkout against a fund not open for public giving', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'Retired Fund', { publicGiving: false });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '10.00' }],
        payer_first_name: 'X', payer_last_name: 'Y', payer_email: 'x@example.com',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(400);
  });

  it('splits one gift across multiple funds into separate ledger rows sharing one base transaction id', async () => {
    const db = makeDb();
    await initDb(db);
    const fundA = insertFund(db, 'General Fund');
    const fundB = insertFund(db, 'Missions');

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundA, amount: '30.00' }, { fund_id: fundB, amount: '20.00' }],
        payer_first_name: 'Multi', payer_last_name: 'Fund', payer_email: 'multi@example.com',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryIds.length).toBe(2);
    expect(body.totalCents).toBe(5000);

    const rows = (await db.prepare('SELECT fund_id, amount, external_txn_id FROM giving_entries WHERE id IN (?,?) ORDER BY fund_id').bind(...body.entryIds).all()).results;
    expect(rows.map(r => r.amount).sort((a, b) => a - b)).toEqual([2000, 3000]);
    // Both rows carry the SAME base transaction id (fund-suffixed), never two independent ids —
    // that's what keeps a webhook redelivery for this one Stax charge idempotent for the group.
    // (A plain split('-f') is ambiguous here: the demo mode's base id is itself a UUID, whose hex
    // groups routinely contain their own "-f" substrings — strip each row's own known suffix
    // instead of guessing where the base id ends.)
    const baseIds = rows.map(r => r.external_txn_id.slice(0, r.external_txn_id.length - `-f${r.fund_id}`.length));
    expect(baseIds[0]).toBe(baseIds[1]);
    for (const r of rows) expect(r.external_txn_id).toBe(`${baseIds[0]}-f${r.fund_id}`);
  });

  it('cover_fees adds an estimated fee to the total and the first gift line only', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '100.00' }], cover_fees: true,
        payer_first_name: 'Fee', payer_last_name: 'Cover', payer_email: 'fee@example.com',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'checkout');
    const body = await res.json();
    expect(res.status).toBe(200);
    // 10000 * 0.02 = 200 -> total 10200, per the module's documented flat estimated fee rate.
    expect(body.totalCents).toBe(10200);
    const row = await db.prepare('SELECT amount FROM giving_entries WHERE id=?').bind(body.entryId).first();
    expect(row.amount).toBe(10200);
  });
});

describe('Stax Giving mockup — /stax-customer (the AVS/address exemption)', () => {
  // customer_id makes Stax.js skip address/AVS requirements entirely (confirmed against Stax's
  // own tokenize() field reference — see getOrCreateStaxCustomerId's comment), so this endpoint
  // is what the browser calls BEFORE tokenize() to get one.
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test' });

  it('returns a null customerId in demo mode (no live Stax credentials configured)', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/stax-customer', {
      method: 'POST',
      body: JSON.stringify({ payer_first_name: 'X', payer_last_name: 'Y', payer_email: 'x@example.com' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'stax-customer');
    expect(res.status).toBe(200);
    expect((await res.json()).customerId).toBeNull();
  });

  it('requires first name, last name, and email', async () => {
    const db = makeDb();
    await initDb(db);
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/stax-customer', {
      method: 'POST',
      body: JSON.stringify({ payer_first_name: 'X' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'stax-customer');
    expect(res.status).toBe(400);
  });

  it('creates a fresh Stax customer for an unmatched donor, without linking it to any person', async () => {
    const db = makeDb();
    await initDb(db);
    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain('/customer');
      const body = JSON.parse(init.body);
      expect(body.firstname).toBe('Stranger');
      expect(body.email).toBe('stranger@example.com');
      return new Response(JSON.stringify({ id: 'cus_new_1' }), { status: 200 });
    });
    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/stax-customer', {
      method: 'POST',
      body: JSON.stringify({ payer_first_name: 'Stranger', payer_last_name: 'Donor', payer_email: 'stranger@example.com' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'stax-customer');
    expect(res.status).toBe(200);
    expect((await res.json()).customerId).toBe('cus_new_1');
    const link = await db.prepare('SELECT * FROM giving_stax_customers').first();
    expect(link).toBeUndefined();
  });

  it('creates and links a new Stax customer the first time a matched donor gives', async () => {
    const db = makeDb();
    await initDb(db);
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'jamie@example.com', phone: '' });
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'cus_jamie_1' }), { status: 200 }));

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/stax-customer', {
      method: 'POST',
      body: JSON.stringify({ payer_first_name: 'Jamie', payer_last_name: 'Vogel', payer_email: 'jamie@example.com' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'stax-customer');
    expect((await res.json()).customerId).toBe('cus_jamie_1');
    const link = await db.prepare('SELECT * FROM giving_stax_customers WHERE person_id=?').bind(pid).first();
    expect(link.stax_customer_id).toBe('cus_jamie_1');
  });

  it('reuses an already-linked Stax customer for a returning donor without calling Stax again', async () => {
    const db = makeDb();
    await initDb(db);
    const pid = insertPerson(db, { first: 'Rae', last: 'Okafor', email: 'rae@example.com', phone: '' });
    await db.prepare('INSERT INTO giving_stax_customers (person_id, stax_customer_id) VALUES (?,?)').bind(pid, 'cus_rae_existing').run();
    global.fetch = vi.fn(async () => { throw new Error('Stax should not be called — the existing customer id should be reused'); });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/stax-customer', {
      method: 'POST',
      body: JSON.stringify({ payer_first_name: 'Rae', payer_last_name: 'Okafor', payer_email: 'rae@example.com' }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'stax-customer');
    expect((await res.json()).customerId).toBe('cus_rae_existing');
  });
});

describe('Stax Giving mockup — checkout reuses a client-supplied stax_customer_id', () => {
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test' });

  it('does not create a second Stax customer when the browser already sent one from /stax-customer', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain('/charge'); // /customer must never be hit here
      const body = JSON.parse(init.body);
      expect(body.customer_id).toBe('cus_already_have_one');
      return new Response(JSON.stringify({ id: 'chg_reuse_1', success: true, total_fees: '0.50', payment_method: {} }), { status: 200 });
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '15.00' }],
        payer_first_name: 'Reuse', payer_last_name: 'Customer', payer_email: 'reuse@example.com',
        payment_method_id: 'pm_1', stax_customer_id: 'cus_already_have_one',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(200);
  });
});

describe('Stax Giving mockup — a "Gateway Unreachable" charge outcome is never treated as a safe-to-retry decline', () => {
  // Confirmed against docs.staxpayments.com/docs/payment-status: this response means Stax itself
  // never got an answer back from the card network, so the transaction is genuinely PENDING —
  // it may still succeed on its own. Andrew hit this live; the giving page's generic error
  // message would otherwise invite an immediate resubmit with the same card, risking a real
  // donor being charged twice for one gift.
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test' });

  it('checkout flags pending:true and warns against an immediate retry, never generic decline text', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/customer')) return new Response(JSON.stringify({ id: 'cus_gw_1' }), { status: 200 });
      if (u.endsWith('/charge')) return new Response(JSON.stringify({ status: 'PENDING', message: 'Gateway Unreachable', success: false }), { status: 200 });
      throw new Error('unexpected fetch ' + u);
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }],
        payer_first_name: 'Andrew', payer_last_name: 'Dinger', payer_email: 'revdinger@example.com',
        payment_method_id: 'pm_1',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.pending).toBe(true);
    expect(body.error.toLowerCase()).toContain("don't submit this card again");
    expect(body.error).not.toBe('Gateway Unreachable');

    // Never recorded as a gift — its outcome is genuinely unknown, not a completed charge.
    const entryCount = (await db.prepare('SELECT COUNT(*) AS c FROM giving_entries').first()).c;
    expect(entryCount).toBe(0);
  });

  it('recurring flags pending:true the same way and never creates a schedule', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/customer')) return new Response(JSON.stringify({ id: 'cus_gw_2' }), { status: 200 });
      if (u.endsWith('/charge')) return new Response(JSON.stringify({ status: 'PENDING', message: 'Gateway Unreachable', success: false }), { status: 200 });
      throw new Error('unexpected fetch ' + u + ' — a pending charge must never reach /invoice/schedule/');
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/recurring', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }], interval: 'weekly',
        payer_first_name: 'Andrew', payer_last_name: 'Dinger', payer_email: 'revdinger@example.com',
        payment_method_id: 'pm_1',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'recurring');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.pending).toBe(true);
    const scheduleCount = (await db.prepare('SELECT COUNT(*) AS c FROM giving_stax_recurring_schedules').first()).c;
    expect(scheduleCount).toBe(0);
  });

  it('a normal decline (velocity limit) is NOT flagged pending, and shows Stax\'s own message', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/customer')) return new Response(JSON.stringify({ id: 'cus_decline_1' }), { status: 200 });
      if (u.endsWith('/charge')) return new Response(JSON.stringify({
        success: false,
        message: 'This transaction exceeds the number of times the same payment method can be charged in succession. Please contact support if you would like to increase your limit.',
      }), { status: 200 });
      throw new Error('unexpected fetch ' + u);
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/checkout', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }],
        payer_first_name: 'Andrew', payer_last_name: 'Dinger', payer_email: 'revdinger@example.com',
        payment_method_id: 'pm_1',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'checkout');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.pending).toBe(false);
    expect(body.error).toContain('exceeds the number of times');
  });
});

describe('Stax Giving mockup — an unmatched gift shows its real payer name, not just "(anonymous)"', () => {
  // Real gap, reported live: a donor who didn't match a Connect person showed as a bare
  // "(anonymous)" in the batch view, with no way to tell who actually gave or link them — even
  // though their name was captured the whole time (giving_stax_unmatched.payer_name).
  it('surfaces payer_name and a needs_review flag on the batch-detail entries endpoint', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const result = await recordStaxGift(db, {
      externalTxnId: 'chg_unmatched_1', fundId, amountCents: 2500,
      payerFirstName: 'Casey', payerLastName: 'Stranger', payerEmail: 'casey.stranger@example.com',
    });
    expect(result.matched).toBe(false);

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/batches/${result.entryId}`);
    // Look up the batch id the gift actually landed in.
    const row = await db.prepare('SELECT batch_id FROM giving_entries WHERE id=?').bind(result.entryId).first();
    const batchReq = new Request(`https://connect.timothystl.org/admin/api/giving/batches/${row.batch_id}`);
    const res = await handleGivingApi(batchReq, { DB: db }, new URL(batchReq.url), 'GET', `giving/batches/${row.batch_id}`, db, false, true, false, true);
    const body = await res.json();
    const entry = body.entries.find(e => e.id === result.entryId);
    expect(entry.person_name).toBe('Casey Stranger');
    expect(entry.needs_review).toBeTruthy();
  });

  it('does not flag needs_review once staff have linked the gift to a person', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'jamie@example.com', phone: '' });
    const result = await recordStaxGift(db, {
      externalTxnId: 'chg_matched_1', fundId, amountCents: 2500,
      payerFirstName: 'Jamie', payerLastName: 'Vogel', payerEmail: 'jamie@example.com',
    });
    expect(result.matched).toBe(true);

    const row = await db.prepare('SELECT batch_id FROM giving_entries WHERE id=?').bind(result.entryId).first();
    const batchReq = new Request(`https://connect.timothystl.org/admin/api/giving/batches/${row.batch_id}`);
    const res = await handleGivingApi(batchReq, { DB: db }, new URL(batchReq.url), 'GET', `giving/batches/${row.batch_id}`, db, false, true, false, true);
    const body = await res.json();
    const entry = body.entries.find(e => e.id === result.entryId);
    expect(entry.person_name).toBe('Jamie Vogel');
    expect(entry.needs_review).toBeFalsy();
    expect(pid).toBeTruthy();
  });
});

describe('Stax Giving mockup — funds visibility (staff, src/api-giving.js)', () => {
  it('lists all active funds with their public_giving flag for staff, and only saves the flag on POST', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund', { publicGiving: false });

    const listReq = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/funds');
    const listRes = await handleGivingApi(listReq, { DB: db }, new URL(listReq.url), 'GET', 'giving/stax-mockup/funds', db, false, true, false, true);
    const listBody = await listRes.json();
    expect(listBody.funds.some(f => f.id === fundId && f.public_giving === 0)).toBe(true);

    const saveReq = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/funds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funds: [{ id: fundId, public_giving: true }] }),
    });
    const saveRes = await handleGivingApi(saveReq, { DB: db }, new URL(saveReq.url), 'POST', 'giving/stax-mockup/funds', db, false, true, false, true);
    expect(saveRes.status).toBe(200);

    const fund = await db.prepare('SELECT public_giving, name FROM funds WHERE id=?').bind(fundId).first();
    expect(fund.public_giving).toBe(1);
    expect(fund.name).toBe('General Fund'); // untouched — this endpoint only ever writes the flag
  });

  it('rejects saving fund visibility for a non-finance role', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const req = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/funds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funds: [{ id: fundId, public_giving: false }] }),
    });
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'POST', 'giving/stax-mockup/funds', db, false, false, false, true);
    expect(res.status).toBe(403);
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

describe('Stax Giving mockup — the queue\'s person-search shows the best match first', () => {
  // Real ask, reported live: the shared /admin/api/people endpoint sorts alphabetically by last
  // name (other screens reusing it want that), so searching "Dinger" could bury Andrew Dinger
  // behind unrelated, alphabetically-earlier results. matchScore() re-ranks this page's own
  // datalist only — an exact "first last" match first, then a name that starts with what was
  // typed, everything else keeping its original (alphabetical) order.
  function extractMatchScore(html) {
    const m = html.match(/function matchScore\(p, needle\)\{[\s\S]*?\n  \}/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-eval
    return eval('(' + m[0].replace('function matchScore', 'function') + ')');
  }

  it('ranks an exact or prefix name match ahead of alphabetically-earlier non-matches', async () => {
    const res = renderStaxGivingMockupReviewHtml();
    const html = await res.text();
    const matchScore = extractMatchScore(html);
    const people = [
      { id: 1, first_name: 'Aaron', last_name: 'Abbott' },
      { id: 2, first_name: 'Andrew', last_name: 'Dinger' },
      { id: 3, first_name: 'Bev', last_name: 'Zinger' },
    ];
    const needle = 'dinger';
    const sorted = people.slice().sort((a, b) => matchScore(a, needle) - matchScore(b, needle));
    expect(sorted.map(p => p.id)).toEqual([2, 1, 3]);
  });

  it('ranks a full "first last" exact match above a mere prefix match', async () => {
    const res = renderStaxGivingMockupReviewHtml();
    const html = await res.text();
    const matchScore = extractMatchScore(html);
    const exact = { first_name: 'Andrew', last_name: 'Dinger' };
    const prefixOnly = { first_name: 'Andrea', last_name: 'Dingerson' };
    expect(matchScore(exact, 'andrew dinger')).toBeLessThan(matchScore(prefixOnly, 'andrew dinger'));
  });
});

describe('Stax Giving mockup — buildScheduleRule', () => {
  // The standing schedule must start on the NEXT occurrence, never today — today's gift is
  // already charged directly by /recurring. A wrong DTSTART here would double-charge day one.
  it('weekly starts 7 days out', () => {
    expect(buildScheduleRule('weekly', '2026-09-19')).toBe('DTSTART=20260926T120000Z;FREQ=WEEKLY');
  });
  it('biweekly starts 14 days out', () => {
    expect(buildScheduleRule('biweekly', '2026-09-19')).toBe('DTSTART=20261003T120000Z;FREQ=WEEKLY;INTERVAL=2');
  });
  it('twice_monthly jumps to the 15th when starting before it', () => {
    expect(buildScheduleRule('twice_monthly', '2026-09-05')).toBe('DTSTART=20260915T120000Z;FREQ=MONTHLY;BYMONTHDAY=1,15');
  });
  it('twice_monthly jumps to next month\'s 1st when starting on/after the 15th', () => {
    expect(buildScheduleRule('twice_monthly', '2026-09-19')).toBe('DTSTART=20261001T120000Z;FREQ=MONTHLY;BYMONTHDAY=1,15');
  });
  it('monthly starts on the same day next month', () => {
    expect(buildScheduleRule('monthly', '2026-09-19')).toBe('DTSTART=20261019T120000Z;FREQ=MONTHLY');
  });
});

describe('Stax Giving mockup — /recurring charges the first gift immediately', () => {
  // Andrew's own ask: "if someone sets up recurring gift there should be a gift made." Before
  // this, a recurring signup only ever created a schedule row and relied on a separate,
  // unverified Stax API call to bill FUTURE occurrences — a donor could see "Thank you" with no
  // money moved, no ledger entry, and no receipt if that call silently failed.
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test', BREVO_API_KEY: 'brevo_test' });

  it('demo mode creates a schedule row but records no gift and sends no receipt', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async () => { throw new Error('demo mode should never call Stax or Brevo'); });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/recurring', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }], interval: 'monthly',
        payer_first_name: 'Demo', payer_last_name: 'Donor', payer_email: 'demo@example.com',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { DB: db }, new URL(req.url), 'POST', 'recurring');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(true);
    const schedule = await db.prepare('SELECT status FROM giving_stax_recurring_schedules WHERE id=?').bind(body.id).first();
    expect(schedule.status).toBe('pending_manual_setup');
    const entryCount = (await db.prepare('SELECT COUNT(*) AS c FROM giving_entries').first()).c;
    expect(entryCount).toBe(0);
  });

  it('charges the first gift, records it, emails a receipt, and links the schedule to the matched person', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'jamie@example.com', phone: '' });
    db._raw.prepare("INSERT INTO chms_config (key, value) VALUES ('church_from_email', 'giving@timothystl.org')").run();

    let brevoCalled = false;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('api.brevo.com')) { brevoCalled = true; return new Response(JSON.stringify({ messageId: 'x' }), { status: 200 }); }
      if (u.includes('/customer')) return new Response(JSON.stringify({ id: 'cus_recur_1' }), { status: 200 });
      if (u.endsWith('/charge')) {
        const body = JSON.parse(init.body);
        expect(body.customer_id).toBe('cus_recur_1');
        expect(body.total).toBe('25.00');
        return new Response(JSON.stringify({ id: 'chg_recur_1', success: true, total_fees: '0.50', payment_method: {} }), { status: 200 });
      }
      if (u.includes('/invoice/schedule/')) {
        const body = JSON.parse(init.body);
        expect(body.customer_id).toBe('cus_recur_1');
        expect(body.payment_method_id).toBe('pm_1');
        expect(body.total).toBe('25.00');
        expect(body.url).toBe('https://app.staxpayments.com/#/bill/');
        // Weekly interval — the schedule must start on the NEXT occurrence (7 days out), never
        // today, since today's gift was already charged directly above.
        expect(body.rule).toMatch(/^DTSTART=\d{8}T120000Z;FREQ=WEEKLY$/);
        return new Response(JSON.stringify({ id: 'sched_recur_1' }), { status: 200 });
      }
      throw new Error('unexpected fetch ' + u);
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/recurring', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }], interval: 'weekly',
        payer_first_name: 'Jamie', payer_last_name: 'Vogel', payer_email: 'jamie@example.com',
        payment_method_id: 'pm_1',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', 'recurring');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(false);
    expect(body.giftEntryIds.length).toBe(1);

    // The first gift landed as a real ledger entry, matched to the person.
    const entry = await db.prepare('SELECT person_id, amount, external_txn_id FROM giving_entries WHERE id=?').bind(body.giftEntryIds[0]).first();
    expect(entry.person_id).toBe(pid);
    expect(entry.amount).toBe(2500);
    expect(entry.external_txn_id).toBe('chg_recur_1');
    expect(brevoCalled).toBe(true);

    // The standing schedule for future occurrences is linked to that same matched person.
    const schedule = await db.prepare('SELECT person_id, status, stax_schedule_id FROM giving_stax_recurring_schedules WHERE id=?').bind(body.id).first();
    expect(schedule.person_id).toBe(pid);
    expect(schedule.status).toBe('active');
    expect(schedule.stax_schedule_id).toBe('sched_recur_1');
  });

  it('never creates a schedule if the first charge fails', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/customer')) return new Response(JSON.stringify({ id: 'cus_fail_1' }), { status: 200 });
      if (u.endsWith('/charge')) return new Response(JSON.stringify({ message: 'Card declined', success: false }), { status: 200 });
      throw new Error('unexpected fetch ' + u + ' — a failed charge must never reach /invoice/schedule/');
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/recurring', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }], interval: 'monthly',
        payer_first_name: 'Fail', payer_last_name: 'Case', payer_email: 'fail@example.com',
        payment_method_id: 'pm_1',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test', DB: db }, new URL(req.url), 'POST', 'recurring');
    expect(res.status).toBe(402);
    const scheduleCount = (await db.prepare('SELECT COUNT(*) AS c FROM giving_stax_recurring_schedules').first()).c;
    expect(scheduleCount).toBe(0);
  });

  // Andrew hit this live: every schedule on the admin screen showed "Needs setup" with no way
  // to tell why. This confirms Stax's actual failure response is captured and stored, not just
  // silently swallowed into pending_manual_setup — the exact gap that made the live failure
  // undiagnosable from the admin screen alone.
  it('records what Stax said when the schedule call fails, without losing the already-charged gift', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/customer')) return new Response(JSON.stringify({ id: 'cus_err_1' }), { status: 200 });
      if (u.endsWith('/charge')) return new Response(JSON.stringify({ id: 'chg_err_1', success: true, total_fees: '0.50', payment_method: {} }), { status: 200 });
      if (u.includes('/invoice/schedule/')) return new Response(JSON.stringify({ message: 'route_not_found' }), { status: 404 });
      throw new Error('unexpected fetch ' + u);
    });

    const req = new Request('https://connect.timothystl.org/api/mockup/stax-giving/recurring', {
      method: 'POST',
      body: JSON.stringify({
        gifts: [{ fund_id: fundId, amount: '25.00' }], interval: 'weekly',
        payer_first_name: 'Andrew', payer_last_name: 'Dinger', payer_email: 'revdinger@example.com',
        payment_method_id: 'pm_1',
      }),
    });
    const res = await handleStaxGivingMockupPublicApi(req, { STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test', DB: db }, new URL(req.url), 'POST', 'recurring');
    expect(res.status).toBe(200);
    const body = await res.json();

    // The first gift still charged and recorded even though the schedule call failed.
    expect(body.giftEntryIds.length).toBe(1);

    const schedule = await db.prepare('SELECT status, stax_error FROM giving_stax_recurring_schedules WHERE id=?').bind(body.id).first();
    expect(schedule.status).toBe('pending_manual_setup');
    expect(schedule.stax_error).toContain('404');
    expect(schedule.stax_error).toContain('route_not_found');
  });
});

describe('Stax Giving mockup — admin recurring-schedules screen (src/api-giving.js)', () => {
  it('lists schedules with the matched person\'s name when linked', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const pid = insertPerson(db, { first: 'Jamie', last: 'Vogel', email: 'jamie@example.com', phone: '' });
    await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules (person_id, fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(pid, fundId, 2500, 'monthly', 'cus_1', 'sched_1', 'active', 'Jamie Vogel', 'jamie@example.com').run();

    const req = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring');
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'GET', 'giving/stax-mockup/recurring', db, false, true, false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedules.length).toBe(1);
    expect(body.schedules[0].first_name).toBe('Jamie');
    expect(body.schedules[0].fund_name).toBe('General Fund');
  });

  it('cancelling calls Stax to stop future billing and always marks the local row cancelled', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const r = await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules (fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(fundId, 2500, 'monthly', 'cus_1', 'sched_cancel_1', 'active', 'Test Donor', 'test@example.com').run();
    const scheduleId = r.meta.last_row_id;

    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain('/invoice/schedule/sched_cancel_1');
      expect(init.method).toBe('DELETE');
      return new Response('{}', { status: 200 });
    });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}/cancel`, { method: 'POST' });
    const res = await handleGivingApi(req, { STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test', DB: db }, new URL(req.url), 'POST', `giving/stax-mockup/recurring/${scheduleId}/cancel`, db, false, true, false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stax_cancelled).toBe(true);

    const updated = await db.prepare('SELECT status FROM giving_stax_recurring_schedules WHERE id=?').bind(scheduleId).first();
    expect(updated.status).toBe('cancelled');
  });

  it('still cancels the local row even if the Stax call fails, but reports it was not confirmed', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const r = await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules (fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(fundId, 2500, 'monthly', 'cus_1', 'sched_down_1', 'active', 'Test Donor', 'test@example.com').run();
    const scheduleId = r.meta.last_row_id;
    global.fetch = vi.fn(async () => { throw new Error('Stax is down'); });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}/cancel`, { method: 'POST' });
    const res = await handleGivingApi(req, { STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test', DB: db }, new URL(req.url), 'POST', `giving/stax-mockup/recurring/${scheduleId}/cancel`, db, false, true, false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stax_cancelled).toBe(false);
    expect(body.had_stax_schedule).toBe(true);

    const updated = await db.prepare('SELECT status FROM giving_stax_recurring_schedules WHERE id=?').bind(scheduleId).first();
    expect(updated.status).toBe('cancelled');
  });

  it('list includes the captured stax_error for a row needing manual setup', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules (fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email, stax_error)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(fundId, 2500, 'weekly', 'cus_1', '', 'pending_manual_setup', 'Andrew Dinger', 'revdinger@example.com', 'HTTP 404: Store not found').run();

    const req = new Request('https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring');
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'GET', 'giving/stax-mockup/recurring', db, false, true, false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedules[0].stax_error).toBe('HTTP 404: Store not found');
  });

  it('rejects cancelling for a non-finance role', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const r = await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules (fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(fundId, 2500, 'monthly', '', '', 'pending_manual_setup', 'Test Donor', 'test@example.com').run();
    const scheduleId = r.meta.last_row_id;

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}/cancel`, { method: 'POST' });
    const res = await handleGivingApi(req, { DB: db }, new URL(req.url), 'POST', `giving/stax-mockup/recurring/${scheduleId}/cancel`, db, false, false, false, true);
    expect(res.status).toBe(403);
  });
});

describe('Stax Giving mockup — refund/void a gift in-app (src/api-giving.js)', () => {
  // Andrew asked for this directly, the first time he saw a Stax gift land in the real batch
  // view: "there should be a refund button inside the app and not have to go to stax to do it."
  // Endpoint confirmed against docs.staxpayments.com/reference/void-or-refund-transaction:
  // POST /transaction/:id/void-or-refund — Stax itself decides void vs refund based on whether
  // the transaction has settled, so the route only needs to record whichever outcome comes back.
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test' });

  async function makeStaxEntry(db, fundId, { amountCents = 2500 } = {}) {
    const result = await recordStaxGift(db, {
      externalTxnId: 'chg_refund_test_' + Math.random().toString(36).slice(2),
      fundId, amountCents, payerName: 'Test Donor', payerEmail: 'test@example.com',
    });
    return result.entryId;
  }

  it('marks the entry voided when Stax reports is_voided:true', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const entryId = await makeStaxEntry(db, fundId);

    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain('/void-or-refund');
      expect(init.method).toBe('POST');
      return new Response(JSON.stringify({ is_voided: true }), { status: 200 });
    });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/entries/${entryId}/void-or-refund`, { method: 'POST' });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', `giving/entries/${entryId}/void-or-refund`, db, false, true, false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voided).toBe(true);

    const row = await db.prepare('SELECT voided_at, refunded_cents FROM giving_entries WHERE id=?').bind(entryId).first();
    expect(row.voided_at).not.toBe('');
    expect(row.refunded_cents).toBe(0);
  });

  it('marks the entry fully refunded when Stax refunds instead of voiding', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const entryId = await makeStaxEntry(db, fundId, { amountCents: 4200 });

    global.fetch = vi.fn(async () => new Response(JSON.stringify({ is_voided: false, total_refunded: 42 }), { status: 200 }));

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/entries/${entryId}/void-or-refund`, { method: 'POST' });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', `giving/entries/${entryId}/void-or-refund`, db, false, true, false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voided).toBe(false);
    expect(body.refunded_cents).toBe(4200);

    const row = await db.prepare('SELECT voided_at, refunded_cents FROM giving_entries WHERE id=?').bind(entryId).first();
    expect(row.voided_at).toBe('');
    expect(row.refunded_cents).toBe(4200);
  });

  it('refuses to refund a manual (non-Stax) entry', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const batchId = (await db.prepare(`INSERT INTO giving_batches (batch_date, description) VALUES ('2026-09-19','Manual')`).run()).meta.last_row_id;
    const r = await db.prepare(
      `INSERT INTO giving_entries (batch_id, fund_id, amount, method, processor, external_txn_id)
       VALUES (?, ?, 1000, 'cash', '', '')`
    ).bind(batchId, fundId).run();
    const entryId = r.meta.last_row_id;
    global.fetch = vi.fn(async () => { throw new Error('a manual entry must never reach Stax'); });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/entries/${entryId}/void-or-refund`, { method: 'POST' });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', `giving/entries/${entryId}/void-or-refund`, db, false, true, false, true);
    expect(res.status).toBe(400);
  });

  it('refuses to refund an entry that was already voided', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const entryId = await makeStaxEntry(db, fundId);
    await db.prepare("UPDATE giving_entries SET voided_at=datetime('now') WHERE id=?").bind(entryId).run();
    global.fetch = vi.fn(async () => { throw new Error('an already-voided entry must never reach Stax again'); });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/entries/${entryId}/void-or-refund`, { method: 'POST' });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', `giving/entries/${entryId}/void-or-refund`, db, false, true, false, true);
    expect(res.status).toBe(409);
  });

  it('surfaces the Stax error message when the API call itself fails', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const entryId = await makeStaxEntry(db, fundId);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Transaction already voided' }), { status: 422 }));

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/entries/${entryId}/void-or-refund`, { method: 'POST' });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', `giving/entries/${entryId}/void-or-refund`, db, false, true, false, true);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Transaction already voided');
  });

  it('rejects for a non-finance role', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const entryId = await makeStaxEntry(db, fundId);

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/entries/${entryId}/void-or-refund`, { method: 'POST' });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'POST', `giving/entries/${entryId}/void-or-refund`, db, false, false, false, true);
    expect(res.status).toBe(403);
  });
});

describe('Stax Giving mockup — edit a recurring schedule (src/api-giving.js)', () => {
  // Andrew asked for edit alongside cancel/refund. Endpoint confirmed against
  // docs.staxpayments.com/reference/edit-an-invoice-schedule: PUT /invoice/schedule/:id. Fund is
  // purely local (never sent to Stax at signup), so changing it never needs a Stax call; amount/
  // interval do when a live stax_schedule_id exists — and unlike cancel, a failed Stax call here
  // must NOT be swallowed, since the local row would otherwise claim an amount Stax doesn't have.
  const env = () => ({ STAX_SANDBOX_API_KEY: 'sk_test', STAX_SANDBOX_WEB_PAYMENTS_TOKEN: 'wpt_test' });

  async function makeSchedule(db, fundId, overrides = {}) {
    const r = await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules (fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      fundId, overrides.amountCents ?? 2500, overrides.interval ?? 'monthly',
      overrides.staxCustomerId ?? 'cus_1', overrides.staxScheduleId ?? 'sched_1',
      overrides.status ?? 'active', 'Test Donor', 'test@example.com'
    ).run();
    return r.meta.last_row_id;
  }

  it('updates fund/amount/interval locally and pushes amount/interval to Stax when a live schedule exists', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const newFundId = insertFund(db, 'Building Fund');
    const scheduleId = await makeSchedule(db, fundId);

    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain('/invoice/schedule/sched_1');
      expect(init.method).toBe('PUT');
      const body = JSON.parse(init.body);
      expect(body.total).toBe('40.00');
      expect(body.rule).toMatch(/^DTSTART=\d{8}T120000Z;FREQ=WEEKLY$/);
      return new Response(JSON.stringify({ id: 'sched_1' }), { status: 200 });
    });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ fund_id: newFundId, amount: '40.00', interval: 'weekly' }),
    });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'PUT', `giving/stax-mockup/recurring/${scheduleId}`, db, false, true, false, true);
    expect(res.status).toBe(200);

    const row = await db.prepare('SELECT fund_id, amount_cents, interval FROM giving_stax_recurring_schedules WHERE id=?').bind(scheduleId).first();
    expect(row.fund_id).toBe(newFundId);
    expect(row.amount_cents).toBe(4000);
    expect(row.interval).toBe('weekly');
  });

  it('updates the fund locally without any Stax call when the schedule is still pending_manual_setup', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const newFundId = insertFund(db, 'Building Fund');
    const scheduleId = await makeSchedule(db, fundId, { staxScheduleId: '', status: 'pending_manual_setup' });
    global.fetch = vi.fn(async () => { throw new Error('a pending schedule with no stax_schedule_id must never call Stax'); });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ fund_id: newFundId, amount: '25.00', interval: 'monthly' }),
    });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'PUT', `giving/stax-mockup/recurring/${scheduleId}`, db, false, true, false, true);
    expect(res.status).toBe(200);
    const row = await db.prepare('SELECT fund_id FROM giving_stax_recurring_schedules WHERE id=?').bind(scheduleId).first();
    expect(row.fund_id).toBe(newFundId);
  });

  it('does not save anything locally when the Stax update call fails', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const scheduleId = await makeSchedule(db, fundId, { amountCents: 2500, interval: 'monthly' });
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Invalid rule' }), { status: 422 }));

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ fund_id: fundId, amount: '99.00', interval: 'weekly' }),
    });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'PUT', `giving/stax-mockup/recurring/${scheduleId}`, db, false, true, false, true);
    expect(res.status).toBe(502);
    const row = await db.prepare('SELECT amount_cents, interval FROM giving_stax_recurring_schedules WHERE id=?').bind(scheduleId).first();
    expect(row.amount_cents).toBe(2500);
    expect(row.interval).toBe('monthly');
  });

  it('refuses to edit a cancelled schedule', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const scheduleId = await makeSchedule(db, fundId, { status: 'cancelled' });
    global.fetch = vi.fn(async () => { throw new Error('a cancelled schedule must never reach Stax'); });

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ fund_id: fundId, amount: '25.00', interval: 'monthly' }),
    });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'PUT', `giving/stax-mockup/recurring/${scheduleId}`, db, false, true, false, true);
    expect(res.status).toBe(409);
  });

  it('rejects an inactive fund', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const inactiveFundId = insertFund(db, 'Retired Fund', { publicGiving: false });
    await db.prepare('UPDATE funds SET active=0 WHERE id=?').bind(inactiveFundId).run();
    const scheduleId = await makeSchedule(db, fundId);

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ fund_id: inactiveFundId, amount: '25.00', interval: 'monthly' }),
    });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'PUT', `giving/stax-mockup/recurring/${scheduleId}`, db, false, true, false, true);
    expect(res.status).toBe(400);
  });

  it('rejects for a non-finance role', async () => {
    const db = makeDb();
    await initDb(db);
    const fundId = insertFund(db, 'General Fund');
    const scheduleId = await makeSchedule(db, fundId);

    const req = new Request(`https://connect.timothystl.org/admin/api/giving/stax-mockup/recurring/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({ fund_id: fundId, amount: '25.00', interval: 'monthly' }),
    });
    const res = await handleGivingApi(req, { ...env(), DB: db }, new URL(req.url), 'PUT', `giving/stax-mockup/recurring/${scheduleId}`, db, false, false, false, true);
    expect(res.status).toBe(403);
  });
});
