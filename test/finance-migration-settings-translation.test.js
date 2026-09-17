import { describe, expect, it } from 'vitest';
import {
  translateDaycareAllocationConfig, deriveCompensationSalaryByRole, COMPENSATION_TRANSLATION_GAPS,
} from '../apps/finance/migration/settings-translation.js';

// All fixtures below stand in for real finance_settings rows -- no real database is read.

describe('translateDaycareAllocationConfig', () => {
  it('reshapes the single production JSON blob into two apps/finance scalar rows', () => {
    const sourceRow = {
      key: 'finance_daycare_allocation_config',
      value: JSON.stringify({ utilityPct: 0.5, insurancePct: 0.5 }),
      updated_at: '2026-08-01T00:00:00Z',
    };
    const rows = translateDaycareAllocationConfig(sourceRow);
    expect(rows).toEqual([
      { key: 'daycare_utility_pct', value: '0.5', updated_at: '2026-08-01T00:00:00Z' },
      { key: 'daycare_insurance_pct', value: '0.5', updated_at: '2026-08-01T00:00:00Z' },
    ]);
  });

  it('carries through whatever real percentages are stored, not a hardcoded 0.5/0.5', () => {
    // Proves this is a real reshape of the actual value, not a copy of the documented example.
    const sourceRow = {
      key: 'finance_daycare_allocation_config',
      value: JSON.stringify({ utilityPct: 0.62, insurancePct: 0.38 }),
      updated_at: '2026-09-01T00:00:00Z',
    };
    const rows = translateDaycareAllocationConfig(sourceRow);
    expect(rows.find((r) => r.key === 'daycare_utility_pct').value).toBe('0.62');
    expect(rows.find((r) => r.key === 'daycare_insurance_pct').value).toBe('0.38');
  });

  it('writes bare numeric strings, never a re-encoded JSON blob', () => {
    const rows = translateDaycareAllocationConfig({
      key: 'finance_daycare_allocation_config', value: '{"utilityPct":0.5,"insurancePct":0.5}',
    });
    for (const row of rows) {
      expect(row.value).not.toMatch(/[{}]/);
      expect(row.value).not.toMatch(/utilityPct|insurancePct/);
      expect(Number.isFinite(Number(row.value))).toBe(true);
    }
  });

  it('rejects the wrong source key rather than silently translating something else', () => {
    expect(() => translateDaycareAllocationConfig({ key: 'finance_cash_policy', value: '{}' }))
      .toThrow(/finance_daycare_allocation_config/);
  });

  it('rejects malformed JSON rather than defaulting to 0.5/0.5', () => {
    expect(() => translateDaycareAllocationConfig({ key: 'finance_daycare_allocation_config', value: 'not json' }))
      .toThrow(/not valid JSON/);
  });

  it('rejects non-numeric percentages rather than defaulting', () => {
    expect(() => translateDaycareAllocationConfig({
      key: 'finance_daycare_allocation_config', value: JSON.stringify({ utilityPct: 'half', insurancePct: 0.5 }),
    })).toThrow(/numeric/);
  });
});

describe('deriveCompensationSalaryByRole', () => {
  it('never returns benefits_cents or adjustment_pct -- the documented, deliberately unimplemented gap', () => {
    const roster = JSON.stringify({
      roster: [{ name: 'Real Worker', position: 'Senior Pastor', actualSalaryCents: 8500000 }],
    });
    const rows = deriveCompensationSalaryByRole(roster, { fiscalYear: 2027 });
    expect(rows).toHaveLength(1);
    expect(rows[0].benefitsCents).toBeNull();
    expect(rows[0].adjustmentPct).toBeNull();
    expect(COMPENSATION_TRANSLATION_GAPS.benefits_cents).toMatch(/never fabricated/i);
    expect(COMPENSATION_TRANSLATION_GAPS.adjustment_pct).toMatch(/never fabricated/i);
  });

  it('groups workers by position and sums only directly-stored actualSalaryCents figures', () => {
    const roster = JSON.stringify({
      roster: [
        { name: 'Worker A', position: 'Parish Administrator', actualSalaryCents: 4200000 },
        { name: 'Worker B', position: 'Parish Administrator', actualSalaryCents: 3800000 },
        { name: 'Worker C', position: 'Director of Parish Music', actualSalaryCents: 5000000 },
      ],
    });
    const rows = deriveCompensationSalaryByRole(roster, { fiscalYear: 2027 });
    const admin = rows.find((r) => r.roleLabel === 'Parish Administrator');
    const music = rows.find((r) => r.roleLabel === 'Director of Parish Music');
    expect(admin.knownSalaryCents).toBe(8000000);
    expect(admin.workerCount).toBe(2);
    expect(admin.completeSalaryTotal).toBe(true);
    expect(music.knownSalaryCents).toBe(5000000);
    expect(music.completeSalaryTotal).toBe(true);
  });

  it('marks a role incomplete -- and does not silently sum a partial total as if it were whole -- when a worker relies on an account-code lookup this module cannot resolve', () => {
    // Matches the real worked example in test/finance-compensation-planner.test.js: a worker with
    // no actualSalaryCents relies on `accountCode` resolved against the live chart-of-accounts
    // budget tree, which this settings-only translation does not have access to.
    const roster = JSON.stringify({
      roster: [
        { name: 'Rev. Dinger', position: 'Senior Pastor', accountCode: '58001' },
        { name: 'Assistant Pastor', position: 'Senior Pastor', actualSalaryCents: 6000000 },
      ],
    });
    const rows = deriveCompensationSalaryByRole(roster, { fiscalYear: 2027 });
    const pastor = rows.find((r) => r.roleLabel === 'Senior Pastor');
    expect(pastor.workerCount).toBe(2);
    expect(pastor.workersWithUnresolvedSalary).toBe(1);
    expect(pastor.completeSalaryTotal).toBe(false);
    // The known-only sum must never be presented as the whole role total once it's incomplete;
    // callers are expected to check completeSalaryTotal before trusting knownSalaryCents.
    expect(pastor.knownSalaryCents).toBe(6000000);
  });

  it('falls back to role, then an explicit unspecified label, when position is missing', () => {
    const roster = JSON.stringify({
      roster: [
        { name: 'Worker A', role: 'commissioned', actualSalaryCents: 1000000 },
        { name: 'Worker B', actualSalaryCents: 2000000 },
      ],
    });
    const rows = deriveCompensationSalaryByRole(roster);
    expect(rows.map((r) => r.roleLabel).sort()).toEqual(['Unspecified role', 'commissioned']);
  });

  it('never includes a worker name or any other individually-identifying field in its output', () => {
    const roster = JSON.stringify({
      roster: [{ name: 'Rev. Dinger', position: 'Senior Pastor', actualSalaryCents: 8500000, hideFromCouncil: true }],
    });
    const rows = deriveCompensationSalaryByRole(roster);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toMatch(/Dinger/);
    expect(serialized).not.toMatch(/hideFromCouncil/);
  });

  it('rejects a value that is not a roster object rather than guessing a shape', () => {
    expect(() => deriveCompensationSalaryByRole(JSON.stringify({ notARoster: true })))
      .toThrow(/roster array/);
    expect(() => deriveCompensationSalaryByRole('not json')).toThrow(/not valid JSON/);
  });

  it('this module provides no function that writes into finance_compensation_plan', async () => {
    const module = await import('../apps/finance/migration/settings-translation.js');
    const exportNames = Object.keys(module);
    for (const name of exportNames) {
      expect(name.toLowerCase()).not.toMatch(/write|insert|persist|save/);
    }
  });
});
