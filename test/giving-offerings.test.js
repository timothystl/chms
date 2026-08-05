import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { batchDepositStatus, batchDepositStatusFromCounts } from '../src/api-utils.js';
import { handleGivingApi } from '../src/api-giving.js';

describe('batchDepositStatus', () => {
  it('is "Needs deposit" when the batch is in no deposit at all', () => {
    const st = batchDepositStatus(500000, []);
    expect(st.key).toBe('needs_deposit');
    expect(st.tone).toBe('warn');
    expect(st.linked_cents).toBe(0);
    expect(st.remaining_cents).toBe(500000);
  });

  it('is "Split" with the outstanding amount when the links don\'t cover the batch', () => {
    // $5,988 counted, $3,000 + $1,500 banked → $1,488 still in the safe.
    const st = batchDepositStatus(598800, [
      { deposit_id: 1, amount_cents: 300000, bank_cents: 300000 },
      { deposit_id: 2, amount_cents: 150000, bank_cents: null },
    ]);
    expect(st.key).toBe('split');
    expect(st.remaining_cents).toBe(148800);
  });

  it('is "Unreconciled" when fully linked but a deposit has no bank amount yet', () => {
    const st = batchDepositStatus(100000, [
      { deposit_id: 1, amount_cents: 60000, bank_cents: 59800 },
      { deposit_id: 2, amount_cents: 40000, bank_cents: null },
    ]);
    expect(st.key).toBe('unreconciled');
    expect(st.tone).toBe('bad');
  });

  it('is "Deposited" only when fully linked and every deposit has a bank amount', () => {
    const st = batchDepositStatus(100000, [
      { deposit_id: 1, amount_cents: 60000, bank_cents: 60000 },
      { deposit_id: 2, amount_cents: 40000, bank_cents: 39800 },
    ]);
    expect(st.key).toBe('deposited');
    expect(st.tone).toBe('ok');
  });

  it('treats a bank amount of $0 as entered, not missing', () => {
    // 0 is a real answer ("the deposit bounced / netted nothing"); only null means unanswered.
    expect(batchDepositStatus(100000, [{ amount_cents: 100000, bank_cents: 0 }]).key).toBe('deposited');
  });

  it('tolerates sub-dollar rounding rather than reading "Split · $0.00" forever', () => {
    const st = batchDepositStatus(100001, [{ amount_cents: 100000, bank_cents: 100000 }]);
    expect(st.key).toBe('deposited');
  });

  it('agrees with the pre-aggregated form the batch list uses', () => {
    const links = [
      { amount_cents: 60000, bank_cents: null },
      { amount_cents: 40000, bank_cents: 1 },
    ];
    const a = batchDepositStatus(100000, links);
    const b = batchDepositStatusFromCounts(100000, 100000, 2, 1);
    expect(b).toEqual(a);
  });
});

// ── Linking against a real database ──────────────────────────────────────────
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of ['0001_baseline', '0031_giving_deposits', '0032_giving_deposit_lines']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), 'utf8'));
  }
  return {
    prepare(sql) {
      const stmt = { _b: [] };
      const run = (args) => sqlite.prepare(sql).run(...args);
      return {
        bind(...args) {
          return {
            async run() { return { meta: { last_row_id: run(args).lastInsertRowid } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { return { meta: { last_row_id: run([]).lastInsertRowid } }; },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

function call(db, { method = 'GET', seg, body, query = '' }) {
  const req = { json: async () => body };
  const url = new URL('https://x/admin/api/' + seg + query);
  return handleGivingApi(req, {}, url, method, seg, db, true, true, true, true);
}

function seedBatch(db, { date, description, amounts }) {
  db._raw.prepare('INSERT INTO funds (name) VALUES (?)').run('General Fund');
  const fundId = db._raw.prepare('SELECT id FROM funds LIMIT 1').get().id;
  db._raw.prepare('INSERT INTO giving_batches (batch_date, description) VALUES (?,?)').run(date, description);
  const batchId = db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
  for (const a of amounts) {
    db._raw.prepare('INSERT INTO giving_entries (batch_id, fund_id, amount, contribution_date) VALUES (?,?,?,?)')
      .run(batchId, fundId, a, date);
  }
  return batchId;
}

describe('batch ↔ deposit links', () => {
  it('splits one batch across two deposits and reports the coverage on the batch', async () => {
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday offering', amounts: [400000, 198800] });

    // First bank run.
    const d1 = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 300000 } })).json();
    // Second, a few days later.
    const d2 = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-12', batch_id: batchId, amount_cents: 150000 } })).json();

    const b = await (await call(db, { seg: `giving/batches/${batchId}` })).json();
    expect(b.total_cents).toBe(598800);
    expect(b.deposits.map(x => x.amount_cents)).toEqual([300000, 150000]);
    expect(b.deposit_status.key).toBe('split');
    expect(b.deposit_status.remaining_cents).toBe(148800);
    expect(d1.id).not.toBe(d2.id);
  });

  it('holds several batches on one deposit and shows the others from inside each batch', async () => {
    const db = makeTestDb();
    const plate = seedBatch(db, { date: '2026-08-09', description: 'Sunday offering', amounts: [200000] });
    const online = seedBatch(db, { date: '2026-08-11', description: 'Online (ACH batch)', amounts: [412000] });

    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-12', batch_id: plate, amount_cents: 200000 } })).json();
    await call(db, { method: 'POST', seg: 'giving/deposit-lines', body: { deposit_id: dep.id, batch_id: online, amount_cents: 412000 } });

    const b = await (await call(db, { seg: `giving/batches/${plate}` })).json();
    expect(b.deposits).toHaveLength(1);
    expect(b.deposits[0].deposit_given_cents).toBe(612000);
    expect(b.deposits[0].other_batches).toHaveLength(1);
    expect(b.deposits[0].other_batches[0].description).toBe('Online (ACH batch)');
    // Fully covered, but the bank amount hasn't been entered yet.
    expect(b.deposit_status.key).toBe('unreconciled');
  });

  it('flips the batch to Deposited once the bank amount lands', async () => {
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday offering', amounts: [100000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 100000 } })).json();
    await call(db, { method: 'PATCH', seg: `giving/deposits/${dep.id}`, body: { bank_cents: 99800 } });
    const b = await (await call(db, { seg: `giving/batches/${batchId}` })).json();
    expect(b.deposit_status.key).toBe('deposited');
  });

  it('upserts rather than duplicating when the same link is saved twice', async () => {
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday', amounts: [100000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 40000 } })).json();
    await call(db, { method: 'POST', seg: 'giving/deposit-lines', body: { deposit_id: dep.id, batch_id: batchId, amount_cents: 100000 } });
    const rows = db._raw.prepare('SELECT * FROM giving_deposit_lines').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(100000);
  });

  it('deletes the deposit when its last link is removed, so no empty slip is left behind', async () => {
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday', amounts: [100000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 100000 } })).json();
    const r = await (await call(db, { method: 'DELETE', seg: 'giving/deposit-lines', query: `?deposit_id=${dep.id}&batch_id=${batchId}` })).json();
    expect(r.deposit_deleted).toBe(true);
    expect(db._raw.prepare('SELECT COUNT(*) n FROM giving_deposits').get().n).toBe(0);
    const b = await (await call(db, { seg: `giving/batches/${batchId}` })).json();
    expect(b.deposit_status.key).toBe('needs_deposit');
  });

  it('keeps a deposit that still holds another batch', async () => {
    const db = makeTestDb();
    const a = seedBatch(db, { date: '2026-08-09', description: 'A', amounts: [100000] });
    const b2 = seedBatch(db, { date: '2026-08-10', description: 'B', amounts: [50000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-11', batch_id: a, amount_cents: 100000 } })).json();
    await call(db, { method: 'POST', seg: 'giving/deposit-lines', body: { deposit_id: dep.id, batch_id: b2, amount_cents: 50000 } });
    const r = await (await call(db, { method: 'DELETE', seg: 'giving/deposit-lines', query: `?deposit_id=${dep.id}&batch_id=${a}` })).json();
    expect(r.deposit_deleted).toBe(false);
    expect(db._raw.prepare('SELECT COUNT(*) n FROM giving_deposits').get().n).toBe(1);
  });

  it('refuses to change what a reconciled deposit holds', async () => {
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday', amounts: [100000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 100000 } })).json();
    db._raw.prepare("UPDATE giving_deposits SET status='reconciled' WHERE id=?").run(dep.id);
    const res = await call(db, { method: 'POST', seg: 'giving/deposit-lines', body: { deposit_id: dep.id, batch_id: batchId, amount_cents: 5 } });
    expect(res.status).toBe(409);
  });

  it('offers only deposits this batch is not already in', async () => {
    const db = makeTestDb();
    const a = seedBatch(db, { date: '2026-08-09', description: 'A', amounts: [100000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: a, amount_cents: 100000 } })).json();
    await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-11' } });
    const opts = await (await call(db, { seg: 'giving/deposit-options', query: `?batch_id=${a}` })).json();
    expect(opts.deposits).toHaveLength(1);
    expect(opts.deposits[0].id).not.toBe(dep.id);
  });

  it('badges every batch in the list without fetching each one', async () => {
    const db = makeTestDb();
    // Split across TWO deposits on purpose: with a second LEFT JOIN instead of the subqueries,
    // this batch's rows would multiply and its total would come back doubled.
    const a = seedBatch(db, { date: '2026-08-09', description: 'Banked', amounts: [60000, 40000] });
    const b2 = seedBatch(db, { date: '2026-08-10', description: 'Still in the safe', amounts: [50000] });
    const d1 = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-11', batch_id: a, amount_cents: 60000 } })).json();
    const d2 = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-12', batch_id: a, amount_cents: 40000 } })).json();
    await call(db, { method: 'PATCH', seg: `giving/deposits/${d1.id}`, body: { bank_cents: 60000 } });
    await call(db, { method: 'PATCH', seg: `giving/deposits/${d2.id}`, body: { bank_cents: 39900 } });
    const list = await (await call(db, { seg: 'giving/batches', query: '?status=all' })).json();
    const byDesc = Object.fromEntries(list.batches.map(x => [x.description, x]));
    expect(byDesc['Banked'].total_cents).toBe(100000);
    expect(byDesc['Banked'].linked_cents).toBe(100000);
    expect(byDesc['Banked'].deposit_count).toBe(2);
    expect(byDesc['Banked'].deposit_status.key).toBe('deposited');
    expect(byDesc['Still in the safe'].deposit_status.key).toBe('needs_deposit');
    expect(byDesc['Still in the safe'].id).toBe(b2);
  });
});

describe('batch deletion and deposit links', () => {
  it('takes the deposit links with the batch, so no deposit claims a batch that is gone', async () => {
    // Left behind, the orphan line makes GET /deposits (subqueries, no join to giving_batches)
    // and GET /deposits/:id (joins) report different totals for the same deposit, permanently.
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday', amounts: [500000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 500000 } })).json();
    await call(db, { method: 'PATCH', seg: `giving/deposits/${dep.id}`, body: { bank_cents: 490000 } });

    await call(db, { method: 'DELETE', seg: `giving/batches/${batchId}` });
    expect(db._raw.prepare('SELECT COUNT(*) n FROM giving_deposit_lines').get().n).toBe(0);

    const list = await (await call(db, { seg: 'giving/deposits' })).json();
    const detail = await (await call(db, { seg: `giving/deposits/${dep.id}` })).json();
    expect(list.deposits[0].given_cents).toBe(detail.given_cents);
    expect(list.deposits[0].given_cents).toBe(0);
    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.fees_ytd.cents).toBe(0); // not $4,900 of "fees" from a batch that no longer exists
  });
});

describe('deposits pane figures', () => {
  it('reports a lines-built deposit at its real total, not $0 given and a negative fee', async () => {
    // The Offerings workflow links whole BATCHES; it never sets giving_entries.deposit_id. A
    // screen reading the per-gift total would show $0 given and a fee of minus the bank amount.
    const db = makeTestDb();
    const batchId = seedBatch(db, { date: '2026-08-09', description: 'Sunday', amounts: [710000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: '2026-08-10', batch_id: batchId, amount_cents: 710000 } })).json();
    await call(db, { method: 'PATCH', seg: `giving/deposits/${dep.id}`, body: { bank_cents: 709000 } });

    const list = await (await call(db, { seg: 'giving/deposits' })).json();
    expect(list.deposits[0].given_cents).toBe(710000);
    expect(list.deposits[0].batch_count).toBe(1);
    expect(list.deposits[0].gross_cents).toBe(0);  // the per-gift figure really is 0 here

    const detail = await (await call(db, { seg: `giving/deposits/${dep.id}` })).json();
    expect(detail.given_cents).toBe(710000);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].description).toBe('Sunday');
  });
});

describe('offerings work queue', () => {
  it('counts open batches, undeposited money, unreconciled slips and fees', async () => {
    const db = makeTestDb();
    const year = new Date().getFullYear();
    const open = seedBatch(db, { date: `${year}-08-09`, description: 'Open, uncounted', amounts: [120000] });
    const closed = seedBatch(db, { date: `${year}-08-02`, description: 'Closed, banked', amounts: [200000] });
    db._raw.prepare('UPDATE giving_batches SET closed=1 WHERE id=?').run(closed);
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: `${year}-08-03`, batch_id: closed, amount_cents: 200000 } })).json();
    await call(db, { method: 'PATCH', seg: `giving/deposits/${dep.id}`, body: { bank_cents: 198000 } });

    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.open_batches).toEqual({ count: 1, cents: 120000 });
    expect(q.awaiting_deposit.count).toBe(1);          // only the open one is undeposited
    expect(q.awaiting_deposit.cents).toBe(120000);
    expect(q.unreconciled_deposits.count).toBe(0);
    expect(q.fees_ytd.cents).toBe(2000);               // 200000 given − 198000 banked
    expect(open).toBeTruthy();
  });

  it('reads a legacy per-gift deposit\'s fees correctly, not as a large negative', async () => {
    // A deposit built the old way (gifts assigned directly, no batch lines) has zero lines.
    // Subtracting its bank amount from zero reported the year's fees as a big NEGATIVE number —
    // a windfall that never happened.
    const db = makeTestDb();
    const year = new Date().getFullYear();
    const bid = seedBatch(db, { date: `${year}-02-01`, description: 'Legacy', amounts: [100000] });
    db._raw.prepare("INSERT INTO giving_deposits (deposit_date, source, bank_cents, status) VALUES (?,'check',99000,'open')").run(`${year}-02-02`);
    const did = db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
    db._raw.prepare('UPDATE giving_entries SET deposit_id=? WHERE batch_id=?').run(did, bid);
    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.fees_ytd.cents).toBe(1000);
  });

  it('windows "awaiting deposit" so historical batches do not flood it on first deploy', async () => {
    // Batch-to-deposit links only exist from this feature onward, so EVERY older batch is
    // technically undeposited. Unwindowed, the card would announce years of money in the safe.
    const db = makeTestDb();
    const year = new Date().getFullYear();
    for (const y of [year - 5, year - 4, year - 3]) {
      const old = seedBatch(db, { date: `${y}-03-01`, description: 'Ancient ' + y, amounts: [500000] });
      db._raw.prepare('UPDATE giving_batches SET closed=1 WHERE id=?').run(old);
    }
    const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    seedBatch(db, { date: recent, description: 'This week', amounts: [70000] });
    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.awaiting_deposit.count).toBe(1);
    expect(q.awaiting_deposit.cents).toBe(70000);
    expect(q.awaiting_deposit.days).toBe(90);
    // ...and the window is adjustable, for anyone who does want the whole backlog.
    const wide = await (await call(db, { seg: 'giving/offerings-summary', query: '?awaiting_days=365' })).json();
    expect(wide.awaiting_deposit.days).toBe(365);
  });

  it('derives no fee from a deposit that holds nothing', async () => {
    // Only a bank figure and no giving behind it: "given - bank" would be that figure negated.
    const db = makeTestDb();
    const year = new Date().getFullYear();
    db._raw.prepare("INSERT INTO giving_deposits (deposit_date, source, bank_cents, status) VALUES (?,'check',490000,'open')").run(`${year}-08-01`);
    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.fees_ytd.cents).toBe(0);
  });

  it('windows unreconciled deposits too, so an old unreconciled slip cannot pin the card', async () => {
    const db = makeTestDb();
    const year = new Date().getFullYear();
    db._raw.prepare("INSERT INTO giving_deposits (deposit_date, source, status) VALUES (?,'check','open')").run(`${year - 3}-04-01`);
    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.unreconciled_deposits.count).toBe(0);
    const wide = await (await call(db, { seg: 'giving/offerings-summary', query: '?awaiting_days=365' })).json();
    expect(wide.unreconciled_deposits.count).toBe(0); // still outside even a 1-year window
  });

  it('does not count a deposit with no bank figure as $0 in fees', async () => {
    // Counting it would read as a windfall — "no fees at all this year" — from a slip nobody
    // has reconciled yet.
    const db = makeTestDb();
    const year = new Date().getFullYear();
    const b = seedBatch(db, { date: `${year}-08-09`, description: 'Banked, unreconciled', amounts: [200000] });
    const dep = await (await call(db, { method: 'POST', seg: 'giving/deposits', body: { deposit_date: `${year}-08-10`, batch_id: b, amount_cents: 200000 } })).json();
    const q = await (await call(db, { seg: 'giving/offerings-summary' })).json();
    expect(q.fees_ytd.cents).toBe(0);
    expect(q.unreconciled_deposits.count).toBe(1);
    expect(q.unreconciled_deposits.earliest_date).toBe(`${year}-08-10`);
    expect(dep.ok).toBe(true);
  });
});
