import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceCompensationV1 } from '../src/api-contracts.js';
import { validateFinanceCompensationV1 } from '../contracts/validators/finance-compensation-consumer.js';

// finance_settings is not part of migrations/0001_baseline.sql -- same reason other producer
// tests here add their own table as EXTRA_SCHEMA. Column-for-column identical to
// migrations/0050_finance_settings.sql's real CREATE TABLE.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
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
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    _raw: sqlite,
  };
}

function seedRoster(db, roster) {
  db._raw.prepare(
    `INSERT INTO finance_settings (key, value) VALUES ('finance_salary_planner', ?)`
  ).run(JSON.stringify({ roster }));
}

// Every name/dollar figure below is entirely fabricated for this test -- never a real production
// value (see this PR's own investigation notes on why real figures never appear in test fixtures).
describe('buildFinanceCompensationV1', () => {
  it('returns a valid, empty-roster contract when nothing has ever been saved', async () => {
    const db = makeTestDb();
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceCompensationV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.contract).toBe('connect.finance-compensation.v1');
    expect(result.dataClassification).toBe('aggregate');
    expect(result.workers).toEqual([]);
    expect(result.totals).toEqual({
      workerCount: 0, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 0,
    });
    expect(result.reconciliation).toEqual({ workerCount: 0, totalsMatch: true });
  });

  it('passes through a real-shaped roster with a hand-entered current pay figure', async () => {
    const db = makeTestDb();
    seedRoster(db, [
      {
        name: 'Test Worker A', position: 'Fictional Youth Director', accountCode: '58010',
        role: 'other', trackKey: 'business_manager_music', education: 'bachelors',
        yearsExperience: 5, responsibilityStipend: 0.1, attendanceBonus: 0, selfEmployedFica: false,
        hasDependents: true, healthEnrolled: true, hideFromCouncil: false, actualSalaryCents: 5000000,
      },
    ]);
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceCompensationV1(result).ok).toBe(true);
    expect(result.workers).toEqual([{
      name: 'Test Worker A', position: 'Fictional Youth Director', accountCode: '58010',
      role: 'other', trackKey: 'business_manager_music', education: 'bachelors',
      yearsExperience: 5, responsibilityStipend: 0.1, attendanceBonus: 0, selfEmployedFica: false,
      hasDependents: true, healthEnrolled: true, hideFromCouncil: false,
      currentPayCents: 5000000, currentPaySource: 'entered',
    }]);
    expect(result.totals).toEqual({
      workerCount: 1, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 5000000,
    });
  });

  it('marks a worker with a linked budget line but no hand-entered figure as budget_line, with null currentPayCents', async () => {
    const db = makeTestDb();
    seedRoster(db, [
      { name: 'Test Worker B', position: 'Fictional Custodian', accountCode: '58020' },
    ]);
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceCompensationV1(result).ok).toBe(true);
    expect(result.workers[0].currentPayCents).toBe(null);
    expect(result.workers[0].currentPaySource).toBe('budget_line');
    expect(result.totals).toEqual({
      workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0,
    });
  });

  it('marks a worker with neither a hand-entered figure nor a linked account code as unset', async () => {
    const db = makeTestDb();
    seedRoster(db, [{ name: 'Test Worker C', position: 'Fictional Volunteer Coordinator' }]);
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceCompensationV1(result).ok).toBe(true);
    expect(result.workers[0].currentPayCents).toBe(null);
    expect(result.workers[0].currentPaySource).toBe('unset');
  });

  it('defaults missing string/number/boolean fields rather than failing the contract', async () => {
    const db = makeTestDb();
    seedRoster(db, [{ name: 'Test Worker D' }]);
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceCompensationV1(result).ok).toBe(true);
    expect(result.workers[0]).toMatchObject({
      position: '', accountCode: '', role: '', trackKey: '', education: '',
      yearsExperience: 0, responsibilityStipend: 0, attendanceBonus: 0,
      selfEmployedFica: false, hasDependents: false, healthEnrolled: false, hideFromCouncil: false,
    });
  });

  it('sums enteredCurrentPayCents across multiple entered workers only, excluding budget-line and unset workers', async () => {
    const db = makeTestDb();
    seedRoster(db, [
      { name: 'Test Worker E', actualSalaryCents: 4000000 },
      { name: 'Test Worker F', actualSalaryCents: 6000000 },
      { name: 'Test Worker G', accountCode: '58030' },
      { name: 'Test Worker H' },
    ]);
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceCompensationV1(result).ok).toBe(true);
    expect(result.totals).toEqual({
      workerCount: 4, enteredCurrentPayCount: 2, unenteredCurrentPayCount: 2, enteredCurrentPayCents: 10000000,
    });
  });

  it('is not fiscal-year-scoped -- carries no fiscalYear field at all, unlike Budget/Church Report/Balance Sheet/Daycare Report', async () => {
    const db = makeTestDb();
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(result.fiscalYear).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(
      ['consumerProduct', 'contract', 'currency', 'dataClassification', 'generatedAt', 'reconciliation', 'sourceProduct', 'totals', 'workers'].sort()
    );
  });

  it('ignores a malformed or non-array roster rather than throwing', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES ('finance_salary_planner', 'not json')`).run();
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceCompensationV1(result).ok).toBe(true);
    expect(result.workers).toEqual([]);
  });

  it('never reads the compensation-role fork or a council per-username overlay -- only the shared canonical roster', async () => {
    const db = makeTestDb();
    seedRoster(db, [{ name: 'Shared Roster Worker', actualSalaryCents: 1234500 }]);
    db._raw.prepare(
      `INSERT INTO finance_settings (key, value) VALUES ('finance_salary_planner_compensation', ?)`
    ).run(JSON.stringify({ roster: [{ name: 'Compensation Fork Worker', actualSalaryCents: 9999900 }] }));
    const result = await buildFinanceCompensationV1(db, { now: new Date('2026-09-14T12:00:00Z') });
    expect(result.workers).toHaveLength(1);
    expect(result.workers[0].name).toBe('Shared Roster Worker');
  });
});
