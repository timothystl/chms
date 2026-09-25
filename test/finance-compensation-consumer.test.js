import { describe, it, expect } from 'vitest';
import { validateFinanceCompensationV1, acceptFinanceCompensationV1 } from '../contracts/validators/finance-compensation-consumer.js';

// Every name/dollar figure below is entirely fabricated for this test -- never a real production
// value.
function validWorker(overrides = {}) {
  return {
    name: 'Test Worker A', position: 'Fictional Director', accountCode: '', role: 'other',
    trackKey: '', education: 'bachelors', yearsExperience: 3, responsibilityStipend: 0,
    attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthEnrolled: true,
    hideFromCouncil: false, currentPayCents: 5000000, currentPaySource: 'entered', ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    contract: 'connect.finance-compensation.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    generatedAt: '2026-09-14T12:00:00Z',
    workers: [validWorker()],
    totals: { workerCount: 1, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 5000000 },
    reconciliation: { workerCount: 1, totalsMatch: true },
    ...overrides,
  };
}

describe('validateFinanceCompensationV1', () => {
  it('accepts a well-formed payload', () => {
    const result = validateFinanceCompensationV1(validPayload());
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('accepts an empty roster', () => {
    const payload = validPayload({
      workers: [], totals: { workerCount: 0, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 0 },
      reconciliation: { workerCount: 0, totalsMatch: true },
    });
    expect(validateFinanceCompensationV1(payload).ok).toBe(true);
  });

  it('rejects a wrong contract/dataClassification/sourceProduct/consumerProduct/currency', () => {
    expect(validateFinanceCompensationV1(validPayload({ contract: 'connect.finance-budget.v1' })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ dataClassification: 'structural' })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ sourceProduct: 'mymdo' })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ consumerProduct: 'website' })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ currency: 'CAD' })).ok).toBe(false);
  });

  it('rejects an extra or missing root field', () => {
    expect(validateFinanceCompensationV1(validPayload({ fiscalYear: 2026 })).ok).toBe(false);
    const { workers, ...withoutWorkers } = validPayload();
    expect(validateFinanceCompensationV1(withoutWorkers).ok).toBe(false);
  });

  it('rejects a malformed generatedAt', () => {
    expect(validateFinanceCompensationV1(validPayload({ generatedAt: '2026-09-14' })).ok).toBe(false);
  });

  it('rejects a worker with an extra or missing field', () => {
    expect(validateFinanceCompensationV1(validPayload({ workers: [{ ...validWorker(), ssn: '000-00-0000' }] })).ok).toBe(false);
    const { hideFromCouncil, ...incomplete } = validWorker();
    expect(validateFinanceCompensationV1(validPayload({ workers: [incomplete] })).ok).toBe(false);
  });

  it('rejects a worker with wrong-typed fields', () => {
    expect(validateFinanceCompensationV1(validPayload({ workers: [validWorker({ name: 42 })] })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ workers: [validWorker({ yearsExperience: '3' })] })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ workers: [validWorker({ selfEmployedFica: 'yes' })] })).ok).toBe(false);
  });

  it('rejects an unknown currentPaySource', () => {
    expect(validateFinanceCompensationV1(validPayload({ workers: [validWorker({ currentPaySource: 'guessed' })] })).ok).toBe(false);
  });

  it('rejects currentPaySource entered without integer currentPayCents', () => {
    expect(validateFinanceCompensationV1(validPayload({
      workers: [validWorker({ currentPaySource: 'entered', currentPayCents: null })],
      totals: { workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0 },
    })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ workers: [validWorker({ currentPaySource: 'entered', currentPayCents: 500.5 })] })).ok).toBe(false);
  });

  it('rejects a non-entered worker with a non-null currentPayCents', () => {
    expect(validateFinanceCompensationV1(validPayload({
      workers: [validWorker({ currentPaySource: 'budget_line', accountCode: '58010', currentPayCents: 100 })],
    })).ok).toBe(false);
  });

  it('rejects currentPaySource/accountCode mismatches (unset with an accountCode, budget_line without one)', () => {
    expect(validateFinanceCompensationV1(validPayload({
      workers: [validWorker({ currentPaySource: 'unset', currentPayCents: null, accountCode: '58010' })],
      totals: { workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0 },
    })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({
      workers: [validWorker({ currentPaySource: 'budget_line', currentPayCents: null, accountCode: '' })],
      totals: { workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0 },
    })).ok).toBe(false);
  });

  it('accepts a valid budget_line worker with null currentPayCents', () => {
    const payload = validPayload({
      workers: [validWorker({ currentPaySource: 'budget_line', currentPayCents: null, accountCode: '58020' })],
      totals: { workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0 },
    });
    expect(validateFinanceCompensationV1(payload).ok).toBe(true);
  });

  it('accepts a valid unset worker with null currentPayCents and no accountCode', () => {
    const payload = validPayload({
      workers: [validWorker({ currentPaySource: 'unset', currentPayCents: null, accountCode: '' })],
      totals: { workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0 },
    });
    expect(validateFinanceCompensationV1(payload).ok).toBe(true);
  });

  it('rejects totals that do not reconcile against the workers array', () => {
    expect(validateFinanceCompensationV1(validPayload({ totals: { workerCount: 2, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 5000000 } })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ totals: { workerCount: 1, enteredCurrentPayCount: 0, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 0 } })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ totals: { workerCount: 1, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 999 } })).ok).toBe(false);
  });

  it('rejects a reconciliation.workerCount mismatch or a false totalsMatch', () => {
    expect(validateFinanceCompensationV1(validPayload({ reconciliation: { workerCount: 2, totalsMatch: true } })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ reconciliation: { workerCount: 1, totalsMatch: false } })).ok).toBe(false);
  });

  it('rejects totals/reconciliation with an extra or missing field', () => {
    expect(validateFinanceCompensationV1(validPayload({ totals: { ...validPayload().totals, extra: 1 } })).ok).toBe(false);
    expect(validateFinanceCompensationV1(validPayload({ reconciliation: { workerCount: 1 } })).ok).toBe(false);
  });
});

describe('acceptFinanceCompensationV1', () => {
  it('returns a detached copy of a valid payload', () => {
    const payload = validPayload();
    const accepted = acceptFinanceCompensationV1(payload);
    expect(accepted).toEqual(payload);
    expect(accepted).not.toBe(payload);
    expect(accepted.workers).not.toBe(payload.workers);
    expect(accepted.workers[0]).not.toBe(payload.workers[0]);
  });

  it('throws on an invalid payload, naming the reason', () => {
    expect(() => acceptFinanceCompensationV1(validPayload({ currency: 'CAD' }))).toThrow(/currency must be USD/);
  });
});
