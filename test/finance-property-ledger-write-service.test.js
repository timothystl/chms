import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  isPropertyLedgerWritesEnabled,
  recordPropertyDistribution,
  recordPropertyReserveMonthly,
  recordPropertyReserveDisbursement,
  recordPropertyCapitalLedgerEntry,
  PropertyLedgerValidationError,
} from '../apps/finance/property-ledger-write-service.js';

// Same minimal D1-shaped wrapper around node:sqlite used by test/finance-property.test.js for
// legacy's own version of these routes -- runs against real SQL (Finance's OWN schema, from
// apps/finance/migrations/0001_finance_foundation.sql) instead of a hand-rolled mock, so a bug in
// the SQL itself (a typo in a column name, a broken ON CONFLICT clause) fails the test too.
const foundationSql = readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8');

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(foundationSql);
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  return { db, sqlite };
}

describe('isPropertyLedgerWritesEnabled — off-by-default gate', () => {
  it('is disabled with no db and no env override', async () => {
    expect(await isPropertyLedgerWritesEnabled({}, null)).toBe(false);
    expect(await isPropertyLedgerWritesEnabled(undefined, null)).toBe(false);
  });

  it('is disabled on a freshly migrated database with no flag row set', async () => {
    const { db } = makeTestDb();
    expect(await isPropertyLedgerWritesEnabled({}, db)).toBe(false);
  });

  it('stays disabled for any value of the flag row other than the exact string "1"', async () => {
    const { db, sqlite } = makeTestDb();
    for (const value of ['0', 'true', 'yes', 'TRUE', '', '1 ']) {
      sqlite.exec("DELETE FROM finance_settings WHERE key='property_ledger_writes_enabled'");
      sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('property_ledger_writes_enabled', ?)").run(value);
      expect(await isPropertyLedgerWritesEnabled({}, db)).toBe(false);
    }
  });

  it('is enabled once finance_settings.property_ledger_writes_enabled is exactly "1"', async () => {
    const { db, sqlite } = makeTestDb();
    sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('property_ledger_writes_enabled','1')").run();
    expect(await isPropertyLedgerWritesEnabled({}, db)).toBe(true);
  });

  it('is enabled by the env var alone (exact string "1"), without needing a database row', async () => {
    const { db } = makeTestDb();
    expect(await isPropertyLedgerWritesEnabled({ PROPERTY_LEDGER_WRITES_ENABLED: '1' }, db)).toBe(true);
    expect(await isPropertyLedgerWritesEnabled({ PROPERTY_LEDGER_WRITES_ENABLED: '1' }, null)).toBe(true);
  });

  it('does not treat any other env value as enabling it', async () => {
    const { db } = makeTestDb();
    expect(await isPropertyLedgerWritesEnabled({ PROPERTY_LEDGER_WRITES_ENABLED: 'true' }, db)).toBe(false);
  });

  it('fails closed (disabled) if the settings read itself throws', async () => {
    const throwingDb = { prepare() { throw new Error('boom'); } };
    expect(await isPropertyLedgerWritesEnabled({}, throwingDb)).toBe(false);
  });
});

describe('recordPropertyDistribution', () => {
  it('rejects a malformed period', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyDistribution(db, 'ivanhoe', { period: '2026', amount: '100' }))
      .rejects.toThrow(PropertyLedgerValidationError);
    await expect(recordPropertyDistribution(db, 'ivanhoe', { period: '2026', amount: '100' }))
      .rejects.toThrow('period must be YYYY-MM');
  });

  it('rejects a non-numeric amount', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyDistribution(db, 'ivanhoe', { period: '2026-01', amount: 'abc' }))
      .rejects.toThrow('Invalid amount');
  });

  it('converts dollars to cents and upserts on the same (property_key, period)', async () => {
    const { db, sqlite } = makeTestDb();
    await recordPropertyDistribution(db, 'ivanhoe', { period: '2026-04', amount: '5000' });
    let row = sqlite.prepare("SELECT amount_cents FROM finance_property_distributions WHERE property_key='ivanhoe' AND period='2026-04'").get();
    expect(row.amount_cents).toBe(500000);

    await recordPropertyDistribution(db, 'ivanhoe', { period: '2026-04', amount: '6250.50' });
    row = sqlite.prepare("SELECT amount_cents FROM finance_property_distributions WHERE property_key='ivanhoe' AND period='2026-04'").get();
    expect(row.amount_cents).toBe(625050);
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM finance_property_distributions WHERE property_key='ivanhoe' AND period='2026-04'").get();
    expect(count.n).toBe(1);
  });

  it('places no sign restriction on amount, matching legacy', async () => {
    const { db, sqlite } = makeTestDb();
    await recordPropertyDistribution(db, 'ivanhoe', { period: '2026-05', amount: '-100' });
    const row = sqlite.prepare("SELECT amount_cents FROM finance_property_distributions WHERE property_key='ivanhoe' AND period='2026-05'").get();
    expect(row.amount_cents).toBe(-10000);
  });
});

describe('recordPropertyReserveMonthly', () => {
  it('rejects a malformed report_month', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026', contribution: '100' }))
      .rejects.toThrow('report_month must be YYYY-MM');
  });

  it('rejects a reserve key that does not match [a-z_]+', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveMonthly(db, 'ivanhoe', 'Property-Tax', { report_month: '2026-01', contribution: '100' }))
      .rejects.toThrow('reserve key must match [a-z_]+');
  });

  it('rejects an invalid target_estimate', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', target_estimate: 'abc', contribution: '100' }))
      .rejects.toThrow('Invalid target_estimate');
  });

  it('rejects an invalid contribution', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', contribution: 'abc' }))
      .rejects.toThrow('Invalid contribution');
  });

  it('auto-computes reserve_before from the prior month and carries the running balance forward (matches legacy exactly)', async () => {
    const { db } = makeTestDb();
    const jan = await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', tax_year: 2026, target_estimate: '11400', contribution: '950' });
    expect(jan.reserve_before_cents).toBe(0);
    expect(jan.reserve_after_cents).toBe(95000);

    const feb = await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-02', tax_year: 2026, target_estimate: '11400', contribution: '950' });
    expect(feb.reserve_before_cents).toBe(95000);
    expect(feb.reserve_after_cents).toBe(190000);
  });

  it('honors an explicitly supplied reserve_before instead of the auto-computed one', async () => {
    const { db } = makeTestDb();
    await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', contribution: '950' });
    const feb = await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-02', reserve_before: '0', contribution: '950' });
    expect(feb.reserve_before_cents).toBe(0);
    expect(feb.reserve_after_cents).toBe(95000);
  });

  it('allows a zero-contribution "paid" month that zeroes the reserve, matching legacy', async () => {
    const { db } = makeTestDb();
    await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2025-10', contribution: '674.20' });
    const paid = await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2025-11', tax_year: 2025, target_estimate: '0', contribution: '0', reserve_before: '0', note: 'tax paid, reserve zeroed' });
    expect(paid.reserve_after_cents).toBe(0);
  });

  it('places no minimum on contribution_cents -- a negative correction is allowed, matching legacy', async () => {
    const { db } = makeTestDb();
    await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', contribution: '1000' });
    const feb = await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-02', contribution: '-300' });
    expect(feb.reserve_before_cents).toBe(100000);
    expect(feb.reserve_after_cents).toBe(70000);
  });

  it('upserts in place when the same (property_key, reserve_key, report_month) is posted again', async () => {
    const { db, sqlite } = makeTestDb();
    await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', contribution: '950' });
    await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', contribution: '1000', note: 'corrected' });
    const rows = sqlite.prepare("SELECT * FROM finance_property_reserves WHERE property_key='ivanhoe' AND reserve_key='property_tax'").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].contribution_cents).toBe(100000);
    expect(rows[0].note).toBe('corrected');
  });
});

describe('recordPropertyReserveDisbursement', () => {
  it('rejects a missing/blank period_key', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { amount: '100' }))
      .rejects.toThrow('period_key is required');
    await expect(recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { period_key: '   ', amount: '100' }))
      .rejects.toThrow('period_key is required');
  });

  it('rejects a reserve key that does not match [a-z_]+', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveDisbursement(db, 'ivanhoe', 'PropertyTax', { period_key: '2025', amount: '100' }))
      .rejects.toThrow('reserve key must match [a-z_]+');
  });

  it('rejects a non-numeric amount but allows a null amount ("not yet paid"), matching legacy', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { period_key: '2025', amount: 'abc' }))
      .rejects.toThrow('Invalid amount');
    const result = await recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { period_key: '2025', note: 'Not yet paid.' });
    expect(result).toEqual({ ok: true });
  });

  it('converts dollars to cents and upserts on (property_key, reserve_key, period_key), matching legacy exactly', async () => {
    const { db, sqlite } = makeTestDb();
    await recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { period_key: '2025', amount: '11349.64', paid_via_report_month: '2025-11', note: 'annual tax bill' });
    let row = sqlite.prepare("SELECT * FROM finance_property_reserve_disbursements WHERE property_key='ivanhoe' AND reserve_key='property_tax' AND period_key='2025'").get();
    expect(row.amount_cents).toBe(1134964);
    expect(row.paid_via_report_month).toBe('2025-11');

    await recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { period_key: '2025', amount: '11400', paid_via_report_month: '2025-12', note: 'revised' });
    row = sqlite.prepare("SELECT * FROM finance_property_reserve_disbursements WHERE property_key='ivanhoe' AND reserve_key='property_tax' AND period_key='2025'").get();
    expect(row.amount_cents).toBe(1140000);
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM finance_property_reserve_disbursements WHERE property_key='ivanhoe' AND reserve_key='property_tax' AND period_key='2025'").get();
    expect(count.n).toBe(1);
  });

  // Real finding (see this file's header note and property-ledger-write-service.js's own header
  // comment): legacy enforces NO sufficient-funds / no-overdraw check on this path at all. This
  // test pins that down concretely rather than leaving it as an unverified claim -- a disbursement
  // for far more than the reserve's own running balance still succeeds, exactly as it does against
  // legacy's real src/api-finance.js today. If a real balance check is ever wanted, it is a new
  // product decision (see property-ledger-write-service.js's header), not something this port
  // silently adds.
  it('does NOT block a disbursement that exceeds the reserve schedule\'s running balance -- matches legacy, which has no such check', async () => {
    const { db, sqlite } = makeTestDb();
    const monthly = await recordPropertyReserveMonthly(db, 'ivanhoe', 'property_tax', { report_month: '2026-01', contribution: '100' });
    expect(monthly.reserve_after_cents).toBe(10000); // $100.00 in the reserve

    // Disburse $10,000.00 -- one hundred times the reserve's own running balance.
    const result = await recordPropertyReserveDisbursement(db, 'ivanhoe', 'property_tax', { period_key: '2026', amount: '10000' });
    expect(result).toEqual({ ok: true });

    const disbursement = sqlite.prepare("SELECT amount_cents FROM finance_property_reserve_disbursements WHERE property_key='ivanhoe' AND reserve_key='property_tax' AND period_key='2026'").get();
    expect(disbursement.amount_cents).toBe(1000000);

    // The reserve schedule's own running balance is untouched by the disbursement -- the two
    // tables are independent logs, exactly as in legacy.
    const reserve = sqlite.prepare("SELECT reserve_after_cents FROM finance_property_reserves WHERE property_key='ivanhoe' AND reserve_key='property_tax' AND report_month='2026-01'").get();
    expect(reserve.reserve_after_cents).toBe(10000);
  });
});

describe('recordPropertyCapitalLedgerEntry', () => {
  it('rejects a non-numeric amount', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyCapitalLedgerEntry(db, 'ivanhoe', { amount: 'abc' })).rejects.toThrow('Invalid amount');
  });

  it('rejects a malformed entry_date', async () => {
    const { db } = makeTestDb();
    await expect(recordPropertyCapitalLedgerEntry(db, 'ivanhoe', { amount: '100', entry_date: '10/07/2024' }))
      .rejects.toThrow('entry_date must be YYYY, YYYY-MM, or YYYY-MM-DD');
  });

  it('accepts YYYY, YYYY-MM, and YYYY-MM-DD entry_date shapes', async () => {
    const { db } = makeTestDb();
    for (const entry_date of ['2024', '2024-10', '2024-10-07']) {
      await expect(recordPropertyCapitalLedgerEntry(db, 'ivanhoe', { amount: '100', entry_date })).resolves.toMatchObject({ ok: true });
    }
  });

  it('assigns increasing sort_order per property and totals correctly, matching legacy', async () => {
    const { db, sqlite } = makeTestDb();
    const r1 = await recordPropertyCapitalLedgerEntry(db, 'ivanhoe', { entry_date: '2024-10-07', amount: '5400', payee: 'Vail Contracting LLC', description: 'renovation', project: 'Apartment renovation' });
    const r2 = await recordPropertyCapitalLedgerEntry(db, 'ivanhoe', { entry_date: '2024-10-19', amount: '2302.25', payee: 'SS Stone', description: 'countertop', project: 'Apartment renovation' });
    expect(typeof r1.id).toBe('number');
    expect(typeof r2.id).toBe('number');

    const rows = sqlite.prepare("SELECT * FROM finance_property_capital_ledger WHERE property_key='ivanhoe' ORDER BY sort_order ASC").all();
    expect(rows).toHaveLength(2);
    expect(rows[0].sort_order).toBe(0);
    expect(rows[1].sort_order).toBe(1);
    const total = rows.reduce((sum, r) => sum + r.amount_cents, 0);
    expect(total).toBe(540000 + 230225);
  });
});
