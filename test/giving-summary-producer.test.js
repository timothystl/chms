import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildConnectGivingSummaryV1 } from '../src/api-contracts.js';
import { validateConnectGivingSummaryV1 } from '../apps/finance/connect-giving-consumer.js';

// Same minimal D1-shaped wrapper pattern as test/giving-board-general-fund.test.js.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
    _raw: sqlite,
  };
}

function insertFund(db, name) {
  db._raw.prepare('INSERT INTO funds (name) VALUES (?)').run(name);
  return db._raw.prepare('SELECT id FROM funds WHERE name=?').get(name).id;
}
function insertPerson(db, { householdId = null } = {}) {
  db._raw.prepare('INSERT INTO people (first_name, last_name, household_id) VALUES (?, ?, ?)')
    .run('Test', 'Giver', householdId);
  return db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function insertBatch(db, date) {
  db._raw.prepare('INSERT INTO giving_batches (batch_date) VALUES (?)').run(date);
  return db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function insertEntry(db, { batchId, fundId, personId = null, amount, date }) {
  db._raw.prepare(
    `INSERT INTO giving_entries (batch_id, fund_id, person_id, amount, contribution_date) VALUES (?,?,?,?,?)`
  ).run(batchId, fundId, personId, amount, date);
}

describe('buildConnectGivingSummaryV1', () => {
  it('produces a summary that Finance\'s own real consumer validator accepts', async () => {
    const db = makeTestDb();
    const genFundId = insertFund(db, 'General Fund');
    const outreachFundId = insertFund(db, 'Outreach');
    const p1 = insertPerson(db, { householdId: 10 });
    const p2 = insertPerson(db, { householdId: 10 }); // same household as p1
    const p3 = insertPerson(db); // no household -> counts as their own household
    const batch = insertBatch(db, '2026-01-15');

    insertEntry(db, { batchId: batch, fundId: genFundId, personId: p1, amount: 10000, date: '2026-01-05' });
    insertEntry(db, { batchId: batch, fundId: genFundId, personId: p2, amount: 5000, date: '2026-01-10' });
    insertEntry(db, { batchId: batch, fundId: genFundId, personId: p1, amount: -2000, date: '2026-01-20' }); // refund/correction
    insertEntry(db, { batchId: batch, fundId: outreachFundId, personId: p3, amount: 3000, date: '2026-01-25' });

    const summary = await buildConnectGivingSummaryV1(db, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      now: new Date('2026-02-01T00:00:00Z'),
    });

    const validation = validateConnectGivingSummaryV1(summary);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(summary.contract).toBe('connect.giving-summary.v1');
    expect(summary.dataClassification).toBe('aggregate');
    expect(summary.period).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(summary.sourceThrough).toBe('2026-01-31T23:59:59Z');

    const general = summary.funds.find((f) => f.fundRef === String(genFundId));
    expect(general.giftCount).toBe(3);
    expect(general.householdCount).toBe(1); // p1 and p2 share a household
    expect(general.amounts).toEqual({ grossCents: 15000, refundCents: 2000, netCents: 13000 });

    const outreach = summary.funds.find((f) => f.fundRef === String(outreachFundId));
    expect(outreach.giftCount).toBe(1);
    expect(outreach.householdCount).toBe(1);
    expect(outreach.amounts).toEqual({ grossCents: 3000, refundCents: 0, netCents: 3000 });

    expect(summary.totals).toEqual({ grossCents: 18000, refundCents: 2000, netCents: 16000 });
    expect(summary.reconciliation).toEqual({ sourceRecordCount: 4, fundCount: 2, totalsMatch: true });
  });

  it('excludes entries outside the requested period and funds with no activity in it', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    const quietFundId = insertFund(db, 'Building Fund'); // no entries at all
    const p = insertPerson(db);
    const batch = insertBatch(db, '2026-01-15');
    insertEntry(db, { batchId: batch, fundId, personId: p, amount: 10000, date: '2025-12-31' }); // before period
    insertEntry(db, { batchId: batch, fundId, personId: p, amount: 20000, date: '2026-01-01' }); // period start, inclusive
    insertEntry(db, { batchId: batch, fundId, personId: p, amount: 30000, date: '2026-01-31' }); // period end, inclusive
    insertEntry(db, { batchId: batch, fundId, personId: p, amount: 40000, date: '2026-02-01' }); // after period

    const summary = await buildConnectGivingSummaryV1(db, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      now: new Date('2026-02-02T00:00:00Z'),
    });

    expect(summary.funds).toHaveLength(1);
    expect(summary.funds[0].fundRef).toBe(String(fundId));
    expect(summary.funds[0].amounts.grossCents).toBe(50000);
    expect(summary.funds.some((f) => f.fundRef === String(quietFundId))).toBe(false);
  });

  it('returns a zero-fund, schema-valid summary for a period with no giving at all', async () => {
    const db = makeTestDb();
    const summary = await buildConnectGivingSummaryV1(db, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      now: new Date('2026-02-01T00:00:00Z'),
    });
    expect(validateConnectGivingSummaryV1(summary).ok).toBe(true);
    expect(summary.funds).toEqual([]);
    expect(summary.totals).toEqual({ grossCents: 0, refundCents: 0, netCents: 0 });
    expect(summary.reconciliation).toEqual({ sourceRecordCount: 0, fundCount: 0, totalsMatch: true });
  });
});
