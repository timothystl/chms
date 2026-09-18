import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  applyCompensationWorkerPlanWrite,
  applyCompensationPlanOptionsWrite,
  readCompensationPlanOptions,
  applyCompensationCouncilDraftWrite,
  readCompensationCouncilDraft,
  mergeCouncilDraftIntoRoster,
  councilDraftKey,
  readCompensationWorkerPlan,
} from '../apps/finance/compensation-plan-write-service.js';

// Same minimal D1-shaped wrapper used by test/finance-compensation-plan-write-service.test.js.
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

describe('compOverrides parity — override_cents on the per-worker seed-fact write', () => {
  it('admin/compensation may set a hand-typed dollar override alongside the normal seed facts', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [{ ...ADMIN_WORKER, overrideCents: 7500000 }],
    });
    expect(result.ok).toBe(true);
    const row = db._raw.prepare('SELECT override_cents FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(row.override_cents).toBe(7500000);
    const read = await readCompensationWorkerPlan(db, 2027, 'admin');
    expect(read[0].overrideCents).toBe(7500000);
  });

  it('defaults to null (no override) when not supplied', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER] });
    const row = db._raw.prepare('SELECT override_cents FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(row.override_cents).toBeNull();
  });

  it('rejects a non-integer override', async () => {
    const db = makeTestDb();
    const result = await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [{ ...ADMIN_WORKER, overrideCents: 'not a number' }],
    });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/overrideCents/);
  });

  it('a council patch can never set overrideCents even if it tries to smuggle it in', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER] });
    await applyCompensationWorkerPlanWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      rows: [{ workerKey: 'pastor_a', compMethod: 'scale', adjustmentPct: 4, overrideCents: 999999999 }],
    });
    const row = db._raw.prepare('SELECT override_cents FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(row.override_cents).toBeNull();
  });
});

describe('applyCompensationPlanOptionsWrite / readCompensationPlanOptions — global raise-plan options', () => {
  it('admin can save and read back the shared roster-wide options', async () => {
    const db = makeTestDb();
    const result = await applyCompensationPlanOptionsWrite(db, {
      fiscalYear: 2027, role: 'admin', updatedBy: 'andrew@timothystl.org',
      options: { compCustomPct: 3.5, compScalePct: null, compBaselineRosterOnly: true },
    });
    expect(result.ok).toBe(true);
    const read = await readCompensationPlanOptions(db, 2027);
    expect(read).toMatchObject({ fiscalYear: 2027, compCustomPct: 3.5, compScalePct: null, compBaselineRosterOnly: true, updatedBy: 'andrew@timothystl.org' });
  });

  it('a second save replaces the row wholesale (whole-blob replace, matching legacy)', async () => {
    const db = makeTestDb();
    await applyCompensationPlanOptionsWrite(db, { fiscalYear: 2027, role: 'compensation', updatedBy: 'hr', options: { compCustomPct: 2, compScalePct: 5 } });
    await applyCompensationPlanOptionsWrite(db, { fiscalYear: 2027, role: 'compensation', updatedBy: 'hr', options: { compScalePct: 9 } });
    const read = await readCompensationPlanOptions(db, 2027);
    // compCustomPct was not sent on the second save -- it reverts to null, it is NOT preserved
    // from the first save (legacy's own real behavior -- see this file's header comment).
    expect(read.compCustomPct).toBeNull();
    expect(read.compScalePct).toBe(9);
  });

  it('is scoped per fiscal year', async () => {
    const db = makeTestDb();
    await applyCompensationPlanOptionsWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', options: { compCustomPct: 1 } });
    await applyCompensationPlanOptionsWrite(db, { fiscalYear: 2028, role: 'admin', updatedBy: 'x', options: { compCustomPct: 2 } });
    expect((await readCompensationPlanOptions(db, 2027)).compCustomPct).toBe(1);
    expect((await readCompensationPlanOptions(db, 2028)).compCustomPct).toBe(2);
  });

  it('refuses council -- these are the SHARED options, council gets its own private draft instead', async () => {
    const db = makeTestDb();
    const result = await applyCompensationPlanOptionsWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1', options: { compCustomPct: 99 },
    });
    expect(result.status).toBe(403);
    expect(await readCompensationPlanOptions(db, 2027)).toBeNull();
  });

  it('rejects a role outside admin/council/compensation', async () => {
    const db = makeTestDb();
    const result = await applyCompensationPlanOptionsWrite(db, { fiscalYear: 2027, role: 'staff', updatedBy: 'x', options: {} });
    expect(result.status).toBe(403);
  });

  it('rejects a non-finite compCustomPct', async () => {
    const db = makeTestDb();
    const result = await applyCompensationPlanOptionsWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', options: { compCustomPct: 'lots' } });
    expect(result.status).toBe(400);
  });
});

describe('applyCompensationCouncilDraftWrite / readCompensationCouncilDraft — private per-council-member draft', () => {
  it('one council member can save a draft that a different council member never sees', async () => {
    const db = makeTestDb();
    await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder-one@example.org',
      options: { compCustomPct: 4, compBaselineRosterOnly: true },
      workerOverrides: { pastor_a: { compMethod: 'scale', adjustmentPct: 2.5 } },
    });
    await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder-two@example.org',
      options: { compCustomPct: 9 },
      workerOverrides: { pastor_a: { adjustmentPct: 7 } },
    });
    const one = await readCompensationCouncilDraft(db, 2027, 'elder-one@example.org');
    const two = await readCompensationCouncilDraft(db, 2027, 'elder-two@example.org');
    expect(one.compCustomPct).toBe(4);
    expect(one.workerOverrides).toEqual({ pastor_a: { compMethod: 'scale', adjustmentPct: 2.5 } });
    expect(two.compCustomPct).toBe(9);
    expect(two.workerOverrides).toEqual({ pastor_a: { adjustmentPct: 7 } });
    // Never collided into one row.
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_council_draft WHERE fiscal_year=2027').get().n).toBe(2);
  });

  it('a second save from the SAME council member replaces their own draft wholesale, not a merge', async () => {
    const db = makeTestDb();
    await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      options: { compCustomPct: 4, compScalePct: 8 }, workerOverrides: { pastor_a: { adjustmentPct: 1 } },
    });
    await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1',
      options: { compScalePct: 3 }, workerOverrides: {},
    });
    const draft = await readCompensationCouncilDraft(db, 2027, 'elder1');
    expect(draft.compCustomPct).toBeNull(); // not carried over from the first save
    expect(draft.compScalePct).toBe(3);
    expect(draft.workerOverrides).toEqual({});
  });

  it('refuses admin/compensation -- only council has a private draft', async () => {
    const db = makeTestDb();
    for (const role of ['admin', 'compensation']) {
      const result = await applyCompensationCouncilDraftWrite(db, { fiscalYear: 2027, role, updatedBy: 'x', options: {}, workerOverrides: {} });
      expect(result.status, role).toBe(403);
    }
  });

  it('refuses a council request with no resolvable identity', async () => {
    const db = makeTestDb();
    const result = await applyCompensationCouncilDraftWrite(db, { fiscalYear: 2027, role: 'council', updatedBy: '', options: {}, workerOverrides: {} });
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/no identity/);
  });

  it('rejects an invalid compMethod inside workerOverrides', async () => {
    const db = makeTestDb();
    const result = await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1', options: {},
      workerOverrides: { pastor_a: { compMethod: 'made_up' } },
    });
    expect(result.status).toBe(400);
  });

  it('rejects a malformed workerKey inside workerOverrides', async () => {
    const db = makeTestDb();
    const result = await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1', options: {},
      workerOverrides: { 'not a valid key!': { adjustmentPct: 1 } },
    });
    expect(result.status).toBe(400);
  });

  it('never touches the shared finance_compensation_worker_plan table', async () => {
    const db = makeTestDb();
    await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'x', rows: [ADMIN_WORKER] });
    await applyCompensationCouncilDraftWrite(db, {
      fiscalYear: 2027, role: 'council', updatedBy: 'elder1', options: { compCustomPct: 50 },
      workerOverrides: { pastor_a: { adjustmentPct: 99 } },
    });
    const sharedRow = db._raw.prepare('SELECT adjustment_pct FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(sharedRow.adjustment_pct).toBe(3.0); // untouched by the private draft
  });

  it('reading a draft that was never saved returns null, not a throw', async () => {
    const db = makeTestDb();
    expect(await readCompensationCouncilDraft(db, 2027, 'nobody')).toBeNull();
  });
});

describe('councilDraftKey — sanitizes the same way legacy\'s councilPlannerKey does', () => {
  it('lowercases and strips characters outside [a-z0-9_-]', () => {
    expect(councilDraftKey('Elder.One@Example.ORG')).toBe('elderoneexampleorg');
    expect(councilDraftKey('')).toBe('');
    expect(councilDraftKey(undefined)).toBe('');
  });
});

describe('mergeCouncilDraftIntoRoster — pure overlay of a draft onto an already-filtered roster', () => {
  it('overlays only the fields the draft actually carries, leaving everything else untouched', () => {
    const baseRows = [
      { workerKey: 'pastor_a', name: 'Pastor A', compMethod: 'cola', adjustmentPct: 3, hideFromCouncil: false },
      { workerKey: 'staff_b', name: 'Staff B', compMethod: 'cola', adjustmentPct: 2, hideFromCouncil: false },
    ];
    const draft = { compCustomPct: 5, compScalePct: null, compBaselineRosterOnly: true, workerOverrides: { pastor_a: { compMethod: 'scale', adjustmentPct: 6 } } };
    const { rows, planOptions } = mergeCouncilDraftIntoRoster(baseRows, draft);
    expect(rows.find((w) => w.workerKey === 'pastor_a')).toMatchObject({ compMethod: 'scale', adjustmentPct: 6, name: 'Pastor A' });
    expect(rows.find((w) => w.workerKey === 'staff_b')).toMatchObject({ compMethod: 'cola', adjustmentPct: 2 });
    expect(planOptions).toEqual({ compCustomPct: 5, compScalePct: null, compBaselineRosterOnly: true });
  });

  it('returns the base rows unchanged and null planOptions when there is no draft', () => {
    const baseRows = [{ workerKey: 'pastor_a', compMethod: 'cola', adjustmentPct: 3 }];
    const result = mergeCouncilDraftIntoRoster(baseRows, null);
    expect(result.rows).toBe(baseRows);
    expect(result.planOptions).toBeNull();
  });

  it('never adds a worker the base roster does not already contain (a draft cannot smuggle in a phantom or hidden worker)', () => {
    const baseRows = [{ workerKey: 'pastor_a', compMethod: 'cola', adjustmentPct: 3 }];
    const draft = { workerOverrides: { sensitive_1: { adjustmentPct: 999 } } };
    const { rows } = mergeCouncilDraftIntoRoster(baseRows, draft);
    expect(rows).toEqual(baseRows);
  });
});
