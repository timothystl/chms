import { describe, expect, it } from 'vitest';
import { resolveCompensationReport, COMPENSATION_LIVE_ALLOWED_ROLES, readSyntheticCompensationReport } from '../apps/finance/compensation-report-service.js';

const syntheticRows = [
  { fiscal_year: 2026, role_label: 'Synthetic Pastoral Staff', salary_cents: 6000000, benefits_cents: 1500000, adjustment_pct: 3.0, basis: 'synthetic_fixture', notes: '' },
];

function dbWith(results) {
  return {
    prepare(sql) { return { sql }; },
    async batch(statements) {
      expect(statements).toHaveLength(1);
      expect(statements[0].sql).toMatch(/^SELECT\b/);
      expect(statements[0].sql).toContain("basis='synthetic_fixture'");
      return [{ results }];
    },
  };
}

// Every name/dollar figure below is entirely fabricated for this test -- never a real production
// value. resolveCompensationReport itself takes the already-fetched synthetic rows, not a `db` --
// see its own header comment on why (avoiding a redundant second read of the same fixture table
// shell.js already reads unconditionally for the Benchmarks/Benefits/Council sub-pages).
const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-compensation.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  generatedAt: '2026-09-14T12:00:00Z',
  workers: [{
    name: 'Test Worker A', position: 'Fictional Director', accountCode: '', role: 'other',
    trackKey: '', education: 'bachelors', yearsExperience: 3, responsibilityStipend: 0,
    attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthEnrolled: true,
    hideFromCouncil: false, currentPayCents: 5000000, currentPaySource: 'entered',
  }],
  totals: { workerCount: 1, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 5000000 },
  reconciliation: { workerCount: 1, totalsMatch: true },
};

describe('COMPENSATION_LIVE_ALLOWED_ROLES', () => {
  it('is exactly admin, council, and compensation -- never finance or staff', () => {
    expect([...COMPENSATION_LIVE_ALLOWED_ROLES].sort()).toEqual(['admin', 'compensation', 'council']);
    expect(COMPENSATION_LIVE_ALLOWED_ROLES.includes('finance')).toBe(false);
    expect(COMPENSATION_LIVE_ALLOWED_ROLES.includes('staff')).toBe(false);
  });
});

describe('resolveCompensationReport (live connect.finance-compensation.v1 with synthetic fallback)', () => {
  it('never attempts the live fetch, going straight to synthetic fallback, when roleVerified is false', async () => {
    let liveFetchAttempted = false;
    const env = {
      CONNECT_SERVICE: { async fetch() { liveFetchAttempted = true; return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveCompensationReport(env, syntheticRows, false);
    expect(liveFetchAttempted).toBe(false);
    expect(result).toEqual({ source: 'synthetic-fallback', fallbackReason: 'role_not_verified_for_individual_data', rows: syntheticRows });
  });

  it('falls back to the synthetic fixture when the live contract is not configured, even with roleVerified true', async () => {
    const result = await resolveCompensationReport({}, syntheticRows, true);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(syntheticRows);
  });

  it('returns the live payload as-is when roleVerified is true and the live call succeeds', async () => {
    let requestedUrl;
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveCompensationReport(env, syntheticRows, true);
    expect(result.source).toBe('live');
    expect(requestedUrl.pathname).toBe('/api/contracts/finance-compensation-v1');
    expect(result.workers).toEqual(VALID_LIVE_PAYLOAD.workers);
    expect(result.totals).toEqual(VALID_LIVE_PAYLOAD.totals);
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-compensation.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveCompensationReport(env, syntheticRows, true);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(syntheticRows);
  });
});

describe('readSyntheticCompensationReport (unchanged synthetic reader, still used by the fallback path and Benchmarks/Benefits/Council)', () => {
  it('runs one SELECT and returns detached rows', async () => {
    const result = await readSyntheticCompensationReport(dbWith(syntheticRows));
    expect(result).toEqual(syntheticRows);
    expect(result).not.toBe(syntheticRows);
  });
});
