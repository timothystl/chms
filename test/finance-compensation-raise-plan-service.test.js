import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { applyCompensationWorkerPlanWrite } from '../apps/finance/compensation-plan-write-service.js';
import { readRaisePlanOptions, saveRaisePlanOptions, RAISE_PLAN_WRITE_ROLES } from '../apps/finance/compensation-raise-plan-service.js';
import { councilDraftKey, saveCouncilDraft, buildCouncilDraftView } from '../apps/finance/compensation-council-draft-service.js';

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0007_finance_compensation_worker_plan.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0009_finance_compensation_raise_plan.sql', import.meta.url), 'utf8'));
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

const WORKER_A = {
  workerKey: 'pastor_a', name: 'Pastor A', roleLabel: 'Senior Pastor',
  salaryCents: 7000000, benefitsCents: 1500000, compMethod: 'cola', adjustmentPct: 3.0,
  hideFromCouncil: false, notes: '',
};
const HIDDEN_WORKER = {
  workerKey: 'sensitive_1', name: 'Sensitive Worker', roleLabel: 'Confidential',
  salaryCents: 9000000, benefitsCents: 2000000, compMethod: 'custom', adjustmentPct: 5.0,
  hideFromCouncil: true, notes: '',
};

async function seedRoster(db) {
  await applyCompensationWorkerPlanWrite(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'seed', rows: [WORKER_A, HIDDEN_WORKER] });
}

describe('RAISE_PLAN_WRITE_ROLES is a real subset of the existing role model', () => {
  it('never invents a role name outside admin/council/compensation/finance/staff/member/volunteer', () => {
    const KNOWN_ROLES = ['admin', 'council', 'compensation', 'finance', 'staff', 'member', 'volunteer'];
    for (const role of RAISE_PLAN_WRITE_ROLES) expect(KNOWN_ROLES).toContain(role);
    expect(RAISE_PLAN_WRITE_ROLES).toEqual(['admin', 'compensation']);
  });
});

describe('saveRaisePlanOptions / readRaisePlanOptions -- GLOBAL raise-plan row', () => {
  it('rejects a council caller outright -- council never writes this shared table directly', async () => {
    const db = makeTestDb();
    const result = await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'council', updatedBy: 'x', customPct: 3, scalePct: 2, baselineRosterOnly: false });
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/Access denied/);
    expect(await readRaisePlanOptions(db, 2027)).toBeNull();
  });

  it('rejects a plain finance/staff role too', async () => {
    const db = makeTestDb();
    for (const role of ['finance', 'staff', 'member', 'volunteer']) {
      const result = await saveRaisePlanOptions(db, { fiscalYear: 2027, role, updatedBy: 'x', customPct: 3, scalePct: 2, baselineRosterOnly: false });
      expect(result.status, role).toBe(403);
    }
  });

  it('admin can save and read back the plan-wide assumptions', async () => {
    const db = makeTestDb();
    const result = await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'admin@x', customPct: 3.5, scalePct: 2.25, baselineRosterOnly: true });
    expect(result).toEqual({ ok: true, fiscalYear: 2027 });
    const read = await readRaisePlanOptions(db, 2027);
    expect(read).toMatchObject({ fiscalYear: 2027, customPct: 3.5, scalePct: 2.25, baselineRosterOnly: true, updatedBy: 'admin@x', updatedByRole: 'admin' });
  });

  it('compensation role may also save (the same fork legacy grants a compensation-role write to)', async () => {
    const db = makeTestDb();
    const result = await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'compensation', updatedBy: 'c@x', customPct: 1, scalePct: 1, baselineRosterOnly: false });
    expect(result.ok).toBe(true);
  });

  it('upserts by fiscal year -- a second save for the same year replaces, not duplicates', async () => {
    const db = makeTestDb();
    await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'a', customPct: 1, scalePct: 1, baselineRosterOnly: false });
    await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'b', customPct: 9, scalePct: 8, baselineRosterOnly: true });
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_raise_plan_options').get().n).toBe(1);
    const read = await readRaisePlanOptions(db, 2027);
    expect(read).toMatchObject({ customPct: 9, scalePct: 8, baselineRosterOnly: true, updatedBy: 'b' });
  });

  it('validates fiscalYear/customPct/scalePct/baselineRosterOnly types', async () => {
    const db = makeTestDb();
    expect((await saveRaisePlanOptions(db, { fiscalYear: 'nope', role: 'admin', customPct: 1, scalePct: 1, baselineRosterOnly: false })).error).toMatch(/fiscalYear/);
    expect((await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', customPct: 'nope', scalePct: 1, baselineRosterOnly: false })).error).toMatch(/customPct/);
    expect((await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', customPct: 1, scalePct: 'nope', baselineRosterOnly: false })).error).toMatch(/scalePct/);
    expect((await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', customPct: 1, scalePct: 1, baselineRosterOnly: 'nope' })).error).toMatch(/baselineRosterOnly/);
  });

  it('reading a fiscal year with no saved row returns null, never a fabricated default', async () => {
    const db = makeTestDb();
    expect(await readRaisePlanOptions(db, 2099)).toBeNull();
  });
});

describe('councilDraftKey -- same lower-case/sanitize shape as legacy councilPlannerKey', () => {
  it('lower-cases and strips characters outside a-z0-9_-', () => {
    expect(councilDraftKey('Jane.Doe@Example.com')).toBe('janedoeexamplecom');
    expect(councilDraftKey('  ')).toBe('');
    expect(councilDraftKey(undefined)).toBe('');
  });
});

describe('saveCouncilDraft / buildCouncilDraftView -- per-council-member PRIVATE draft, additive', () => {
  it('rejects a non-council role outright', async () => {
    const db = makeTestDb();
    for (const role of ['admin', 'compensation', 'finance', 'staff']) {
      const result = await saveCouncilDraft(db, { fiscalYear: 2027, role, councilIdentity: 'alice@x.org', customPct: 1, scalePct: 1, baselineRosterOnly: false, workerOverrides: {} });
      expect(result.status, role).toBe(403);
    }
  });

  it('rejects a council caller with no usable identity', async () => {
    const db = makeTestDb();
    const result = await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: '', customPct: 1, scalePct: 1, baselineRosterOnly: false });
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/no council identity/);
  });

  it('a council member can save a private draft and read it back untouched by another council member\'s save', async () => {
    const db = makeTestDb();
    await seedRoster(db);
    const aliceSave = await saveCouncilDraft(db, {
      fiscalYear: 2027, role: 'council', councilIdentity: 'alice@x.org',
      customPct: 4, scalePct: 3, baselineRosterOnly: true,
      workerOverrides: { pastor_a: { compMethod: 'custom', adjustmentPct: 7 } },
    });
    expect(aliceSave.ok).toBe(true);

    const bobSave = await saveCouncilDraft(db, {
      fiscalYear: 2027, role: 'council', councilIdentity: 'bob@x.org',
      customPct: 1, scalePct: 1, baselineRosterOnly: false,
      workerOverrides: { pastor_a: { compMethod: 'scale', adjustmentPct: 2 } },
    });
    expect(bobSave.ok).toBe(true);

    // Two distinct rows -- one per council member, never merged or overwritten.
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_council_draft').get().n).toBe(2);

    const aliceView = await buildCouncilDraftView(db, 2027, 'alice@x.org');
    expect(aliceView.hasDraft).toBe(true);
    expect(aliceView.raisePlanOptions).toEqual({ customPct: 4, scalePct: 3, baselineRosterOnly: true });
    const aliceWorkerA = aliceView.roster.find((w) => w.workerKey === 'pastor_a');
    expect(aliceWorkerA).toMatchObject({ compMethod: 'custom', adjustmentPct: 7 });

    const bobView = await buildCouncilDraftView(db, 2027, 'bob@x.org');
    const bobWorkerA = bobView.roster.find((w) => w.workerKey === 'pastor_a');
    expect(bobWorkerA).toMatchObject({ compMethod: 'scale', adjustmentPct: 2 });

    // The shared table itself was never touched by either private save.
    const sharedRow = db._raw.prepare("SELECT comp_method, adjustment_pct FROM finance_compensation_worker_plan WHERE worker_key='pastor_a'").get();
    expect(sharedRow).toMatchObject({ comp_method: 'cola', adjustment_pct: 3.0 });
  });

  it('never leaks a hideFromCouncil worker into the merged view even if a stale draft override names it', async () => {
    const db = makeTestDb();
    await seedRoster(db);
    // A draft entry naming the hidden worker's own workerKey (e.g. saved before it was hidden, or
    // a crafted request) must never surface that worker in the merged view.
    await saveCouncilDraft(db, {
      fiscalYear: 2027, role: 'council', councilIdentity: 'alice@x.org',
      workerOverrides: { sensitive_1: { compMethod: 'custom', adjustmentPct: 99 } },
    });
    const view = await buildCouncilDraftView(db, 2027, 'alice@x.org');
    expect(view.roster.find((w) => w.workerKey === 'sensitive_1')).toBeUndefined();
  });

  it('falls back to the GLOBAL raise-plan row when the viewer has no private draft of their own', async () => {
    const db = makeTestDb();
    await seedRoster(db);
    await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'admin', customPct: 6, scalePct: 5, baselineRosterOnly: true });
    const view = await buildCouncilDraftView(db, 2027, 'someone-with-no-draft@x.org');
    expect(view.hasDraft).toBe(false);
    expect(view.raisePlanOptions).toEqual({ customPct: 6, scalePct: 5, baselineRosterOnly: true });
    // Roster is the unmodified, council-filtered shared roster (no overrides to apply).
    expect(view.roster.find((w) => w.workerKey === 'pastor_a')).toMatchObject({ compMethod: 'cola', adjustmentPct: 3.0 });
    expect(view.roster.find((w) => w.workerKey === 'sensitive_1')).toBeUndefined();
  });

  it('a draft may override only ONE of customPct/scalePct/baselineRosterOnly, falling back to the global row per-field', async () => {
    const db = makeTestDb();
    await seedRoster(db);
    await saveRaisePlanOptions(db, { fiscalYear: 2027, role: 'admin', updatedBy: 'admin', customPct: 6, scalePct: 5, baselineRosterOnly: true });
    await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'alice@x.org', customPct: 11 });
    const view = await buildCouncilDraftView(db, 2027, 'alice@x.org');
    expect(view.raisePlanOptions).toEqual({ customPct: 11, scalePct: 5, baselineRosterOnly: true });
  });

  it('validates workerOverrides entries (workerKey pattern, compMethod enum, adjustmentPct type)', async () => {
    const db = makeTestDb();
    expect((await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'a@x', workerOverrides: { 'bad key!': { compMethod: 'cola' } } })).error).toMatch(/invalid workerKey/);
    expect((await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'a@x', workerOverrides: { ok_key: { compMethod: 'not-a-method' } } })).error).toMatch(/compMethod must be one of/);
    expect((await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'a@x', workerOverrides: { ok_key: { adjustmentPct: 'nope' } } })).error).toMatch(/adjustmentPct must be a finite number/);
  });

  it('upserts by (fiscal_year, council_identity) -- a second save from the same person replaces their own prior draft wholesale', async () => {
    const db = makeTestDb();
    await seedRoster(db);
    await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'alice@x.org', customPct: 1, workerOverrides: { pastor_a: { adjustmentPct: 1 } } });
    await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'ALICE@X.ORG', customPct: 2, workerOverrides: { pastor_a: { adjustmentPct: 2 } } });
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_council_draft').get().n).toBe(1);
    const view = await buildCouncilDraftView(db, 2027, 'alice@x.org');
    expect(view.raisePlanOptions.customPct).toBe(2);
    expect(view.roster.find((w) => w.workerKey === 'pastor_a').adjustmentPct).toBe(2);
    // A full-replace save with no workerOverrides field clears the prior overrides (matches
    // legacy's own whole-blob resend save shape -- see this module's header comment).
    await saveCouncilDraft(db, { fiscalYear: 2027, role: 'council', councilIdentity: 'alice@x.org', customPct: 3 });
    const cleared = await buildCouncilDraftView(db, 2027, 'alice@x.org');
    expect(cleared.roster.find((w) => w.workerKey === 'pastor_a').adjustmentPct).toBe(3.0); // back to the shared row's own value
  });
});
