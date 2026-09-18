import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  applyCompensationWorkerPlanWrite,
  COMPENSATION_PLAN_WRITE_FLAG_KEY,
  isCompensationPlanWriteEnabled,
  readCompensationWorkerPlan,
} from '../apps/finance/compensation-plan-write-service.js';

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0007_finance_compensation_worker_plan.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0009_finance_compensation_plan_options.sql', import.meta.url), 'utf8'));
  return {
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
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

const ADMIN_WORKER = {
  workerKey: 'pastor_a', name: 'Pastor A', roleLabel: 'Senior Pastor',
  salaryCents: 7000000, benefitsCents: 1500000, compMethod: 'cola', adjustmentPct: 3.0,
  hideFromCouncil: false, notes: 'seed',
};
const HIDDEN_WORKER = {
  workerKey: 'sensitive_1', name: 'Sensitive Worker', roleLabel: 'Confidential Role',
  salaryCents: 9000000, benefitsCents: 2000000, compMethod: 'custom', adjustmentPct: 5.0,
  hideFromCouncil: true, notes: 'never shown to council',
};

describe('isCompensationPlanWriteEnabled — off by default', () => {
  it('is disabled with no flag row and no env override', async () => {
    const db = makeTestDb();
    expect(await isCompensationPlanWriteEnabled({}, db)).toBe(false);
  });

  it('stays disabled for any flag value other than the literal string "1"', async () => {
    const db = makeTestDb();
    for (const value of ['0', 'true', 'yes', '']) {
      db._raw.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(COMPENSATION_PLAN_WRITE_FLAG_KEY, value);
      expect(await isCompensationPlanWriteEnabled({}, db)).toBe(false);
    }
  });

  it('is enabled once the finance_settings flag is set to "1"', async () => {
    const db = makeTestDb();
    db._raw.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?)').run(COMPENSATION_PLAN_WRITE_FLAG_KEY, '1');
    expect(await isCompensationPlanWriteEnabled({}, db)).toBe(true);
  });

  it('is enabled via the env var override even with no DB row at all', async () => {
    const db = makeTestDb();
    expect(await isCompensationPlanWriteEnabled({ COMPENSATION_PLAN_WRITE_ENABLED: '1' }, db)).toBe(true);
  });
});

describe('applyCompensationWorkerPlanWrite — role gating (reuses COMPENSATION_LIVE_ALLOWED_ROLES)', () => {
  it('rejects a role outside admin/council/compensation, e.g. plain finance or staff', async () => {
    const db = makeTestDb();
    for (const role of ['finance', 'staff', 'member', 'volunteer']) {
      const result = await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role, updatedBy: 'x', rows: [ADMIN_WORKER] });
      expect(result.status, role).toBe(403);
      expect(result.error, role).toMatch(/Access denied/);
    }
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_worker_plan').get().n).toBe(0);
  });
});

describe('applyCompensationWorkerPlanWrite — admin/compensation full seed-fact writes', () => {
  it('creates a new worker row', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'andrew@timothystl.org', rows: [ADMIN_WORKER] });
    expect(result.ok).toBe(true);
    expect(result.saved).toBe(1);
    const row = db._raw.prepare('SELECT * FROM finance_compensation_worker_plan WHERE fiscal_year=? AND worker_key=?').get(2027, 'pastor_a');
    expect(row.name).toBe('Pastor A');
    expect(row.salary_cents).toBe(7000000);
    expect(row.hide_from_council).toBe(0);
    expect(row.updated_by).toBe('andrew@timothystl.org');
    expect(row.updated_by_role).toBe('admin');
  });

  it('updates an existing row in place on a second save (upsert, not a duplicate row)', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'compensation', updatedBy: 'hr', rows: [ADMIN_WORKER] });
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'compensation', updatedBy: 'hr', rows: [{ ...ADMIN_WORKER, salaryCents: 7200000 }] });
    const rows = db._raw.prepare('SELECT * FROM finance_compensation_worker_plan WHERE fiscal_year=?').all(2027);
    expect(rows).toHaveLength(1);
    expect(rows[0].salary_cents).toBe(7200000);
  });

  it('the compensation role may also set hideFromCouncil on a worker (seed fact, same as admin)', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'compensation', updatedBy: 'hr', rows: [HIDDEN_WORKER] });
    expect(result.ok).toBe(true);
    const row = db._raw.prepare('SELECT hide_from_council FROM finance_compensation_worker_plan WHERE worker_key=?').get('sensitive_1');
    expect(row.hide_from_council).toBe(1);
  });

  it('validates required fields and refuses to write anything if any row in the batch is invalid', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'admin', updatedBy: 'x',
      rows: [ADMIN_WORKER, { ...HIDDEN_WORKER, salaryCents: -100 }],
    });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/salaryCents/);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_worker_plan').get().n).toBe(0);
  });

  it('rejects an unknown compMethod', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [{ ...ADMIN_WORKER, compMethod: 'made_up' }] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/compMethod/);
  });

  it('rejects duplicate workerKeys within the same save', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER, { ...ADMIN_WORKER }] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/duplicate workerKey/);
  });
});

describe('applyCompensationWorkerPlanWrite — council isolation (the critical property)', () => {
  it('council may never create a new worker row', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [{ workerKey: 'new_worker', compMethod: 'custom', adjustmentPct: 10 }],
    });
    expect(result.status).toBe(403);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_worker_plan').get().n).toBe(0);
  });

  it('council may never read OR write a hideFromCouncil worker row, and gets the identical denial as a nonexistent worker', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER, HIDDEN_WORKER] });

    // Read side: filtered out entirely, matching the live-roster precedent.
    const councilView = await readCompensationWorkerPlan(db, 2027, 'council');
    expect(councilView.map((w) => w.workerKey)).toEqual(['pastor_a']);
    expect(councilView.some((w) => w.workerKey === 'sensitive_1')).toBe(false);
    const adminView = await readCompensationWorkerPlan(db, 2027, 'admin');
    expect(adminView.map((w) => w.workerKey).sort()).toEqual(['pastor_a', 'sensitive_1']);

    // Write side: an attempt against the hidden worker is refused...
    const hiddenAttempt = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [{ workerKey: 'sensitive_1', compMethod: 'custom', adjustmentPct: 99 }],
    });
    expect(hiddenAttempt.status).toBe(403);
    expect(hiddenAttempt.error).toBe('Access denied: you may not edit this worker row');

    // ...with the EXACT SAME error as a worker that doesn't exist at all, so a council session can
    // never distinguish "hidden" from "no such worker" by probing.
    const nonexistentAttempt = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [{ workerKey: 'totally_made_up', compMethod: 'custom', adjustmentPct: 99 }],
    });
    expect(nonexistentAttempt.status).toBe(403);
    expect(nonexistentAttempt.error).toBe(hiddenAttempt.error);

    // And the hidden row itself was never touched.
    const hiddenRow = db._raw.prepare('SELECT * FROM finance_compensation_worker_plan WHERE worker_key=?').get('sensitive_1');
    expect(hiddenRow.comp_method).toBe('custom');
    expect(hiddenRow.adjustment_pct).toBe(5.0);
  });

  it('council may edit compMethod/adjustmentPct on a visible row, but never its seed facts even if it tries to smuggle them in', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER] });
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [{
        workerKey: 'pastor_a', compMethod: 'scale', adjustmentPct: 4.5,
        // Smuggled fields below must be silently ignored -- council's UPDATE only ever touches
        // comp_method/adjustment_pct.
        name: 'Renamed By Council', salaryCents: 1, benefitsCents: 1, hideFromCouncil: true, notes: 'tampered',
      }],
    });
    expect(result.ok).toBe(true);
    const row = db._raw.prepare('SELECT * FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(row.comp_method).toBe('scale');
    expect(row.adjustment_pct).toBe(4.5);
    expect(row.name).toBe('Pastor A');
    expect(row.salary_cents).toBe(7000000);
    expect(row.benefits_cents).toBe(1500000);
    expect(row.hide_from_council).toBe(0);
    expect(row.notes).toBe('seed');
    expect(row.updated_by).toBe('elder1');
    expect(row.updated_by_role).toBe('council');
  });

  it('rejects an unknown compMethod from a council patch too', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER] });
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [{ workerKey: 'pastor_a', compMethod: 'made_up' }],
    });
    expect(result.status).toBe(400);
  });

  it('one bad row in a multi-row council save blocks the whole save, including the otherwise-valid row', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER, { ...HIDDEN_WORKER, hideFromCouncil: false, workerKey: 'visible_2' }] });
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [
        { workerKey: 'pastor_a', adjustmentPct: 2 },
        { workerKey: 'sensitive_1', adjustmentPct: 2 }, // hidden -- fails the whole save
      ],
    });
    expect(result.status).toBe(403);
    const row = db._raw.prepare('SELECT adjustment_pct FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(row.adjustment_pct).toBe(3.0); // untouched
  });
});

describe('readCompensationWorkerPlan', () => {
  it('throws on a non-integer fiscalYear rather than silently reading everything', async () => {
    const db = makeTestDb();
    await expect(readCompensationWorkerPlan(db, NaN, 'admin')).rejects.toThrow(/fiscalYear/);
  });

  it('scopes strictly to the requested fiscal year', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER] });
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2028, role: 'admin', updatedBy: 'x', rows: [{ ...ADMIN_WORKER, salaryCents: 8000000 }] });
    const y2027 = await readCompensationWorkerPlan(db, 2027, 'admin');
    const y2028 = await readCompensationWorkerPlan(db, 2028, 'admin');
    expect(y2027).toHaveLength(1);
    expect(y2027[0].salaryCents).toBe(7000000);
    expect(y2028[0].salaryCents).toBe(8000000);
  });
});
