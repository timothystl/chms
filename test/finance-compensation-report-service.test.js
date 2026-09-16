import { describe, expect, it } from 'vitest';
import { buildCompensationCouncilSnapshot, buildCompensationReportView, buildLiveCompensationCouncilSnapshot, filterCompensationWorkersForViewer, readSyntheticCompensationReport, summarizeCompensationWorkers } from '../apps/finance/compensation-report-service.js';

const rows = [
  { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', salary_cents: 6000000, benefits_cents: 1200000, adjustment_pct: 3, basis: 'synthetic_fixture', notes: 'Synthetic fixture only' },
  { fiscal_year: 2027, role_label: 'Synthetic Operations Role', salary_cents: 4500000, benefits_cents: 900000, adjustment_pct: 3, basis: 'synthetic_fixture', notes: 'Synthetic fixture only' },
];

describe('Finance synthetic Compensation service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = { prepare(sql) { statements.push(sql); return { sql }; }, async batch() { return [{ results: rows }]; } };
    const result = await readSyntheticCompensationReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("basis='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('totals salary, benefits, and total compensation', () => {
    expect(buildCompensationReportView(rows)).toMatchObject({
      fiscalYear: 2027,
      totals: { salaryCents: 10500000, benefitsCents: 2100000, totalCents: 12600000 },
    });
  });

  it('fails closed on personal-looking labels and mixed years', async () => {
    const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: [{ ...rows[0], role_label: 'Named Person' }] }]; } };
    await expect(readSyntheticCompensationReport(db)).rejects.toThrow('Synthetic Compensation rows invalid');
    expect(() => buildCompensationReportView([rows[0], { ...rows[1], fiscal_year: 2028 }])).toThrow('Synthetic Compensation fiscal year mismatch');
  });

  it('builds a reconciled role-only council review snapshot', () => {
    const report = buildCompensationReportView(rows);
    expect(buildCompensationCouncilSnapshot(report)).toMatchObject({
      fiscalYear: 2027,
      roleCount: 2,
      totals: { salaryCents: 10500000, benefitsCents: 2100000, totalCents: 12600000 },
      weightedAdjustmentPct: 3,
      identitiesIncluded: false,
      reviewStatus: 'review_only',
      approved: false,
    });
    expect(buildCompensationCouncilSnapshot(report).benefitsSharePct).toBeCloseTo(100 / 6);
  });

  it('fails closed when council totals are stale or report rows are malformed', () => {
    const report = buildCompensationReportView(rows);
    expect(() => buildCompensationCouncilSnapshot({ ...report, totals: { ...report.totals, totalCents: 1 } }))
      .toThrow('Synthetic Compensation council totals do not reconcile');
    expect(() => buildCompensationReportView([{ ...rows[0], salary_cents: -1 }]))
      .toThrow('Synthetic Compensation report rows invalid');
  });
});

// Every name/dollar figure below is entirely fabricated for this test -- never a real production
// value. Mirrors the shape `resolveCompensationReport` returns on a successful live fetch (see
// finance-compensation-service.test.js's VALID_LIVE_PAYLOAD).
function liveWorker(overrides) {
  return {
    name: 'Test Worker', position: 'Fictional Role', accountCode: '', role: 'other', trackKey: '',
    education: 'bachelors', yearsExperience: 1, responsibilityStipend: 0, attendanceBonus: 0,
    selfEmployedFica: false, hasDependents: false, healthEnrolled: true, hideFromCouncil: false,
    currentPayCents: 5000000, currentPaySource: 'entered',
    ...overrides,
  };
}

describe('buildLiveCompensationCouncilSnapshot (real aggregate rollup, admin/council/compensation only)', () => {
  const liveReport = {
    source: 'live',
    generatedAt: '2026-09-15T00:00:00Z',
    workers: [
      liveWorker({ name: 'Worker A', currentPayCents: 5000000, currentPaySource: 'entered' }),
      liveWorker({ name: 'Worker B', currentPayCents: null, currentPaySource: 'budget_line', accountCode: '58004' }),
      liveWorker({ name: 'Worker C (hidden)', currentPayCents: 9000000, currentPaySource: 'entered', hideFromCouncil: true }),
    ],
  };

  it('for admin/compensation, aggregates every real worker, including one flagged hideFromCouncil', () => {
    const snapshot = buildLiveCompensationCouncilSnapshot(liveReport, 'admin');
    expect(snapshot).toEqual({
      source: 'live',
      generatedAt: '2026-09-15T00:00:00Z',
      workerCount: 3,
      enteredCurrentPayCount: 2,
      unenteredCurrentPayCount: 1,
      enteredCurrentPayCents: 14000000,
      identitiesIncluded: false,
      reviewStatus: 'review_only',
      approved: false,
    });
    expect(buildLiveCompensationCouncilSnapshot(liveReport, 'compensation').workerCount).toBe(3);
  });

  it('for the council role, drops a worker flagged hideFromCouncil before aggregating -- same rule the real Salary Planner enforces', () => {
    const snapshot = buildLiveCompensationCouncilSnapshot(liveReport, 'council');
    expect(snapshot.workerCount).toBe(2);
    expect(snapshot.enteredCurrentPayCount).toBe(1);
    expect(snapshot.unenteredCurrentPayCount).toBe(1);
    // Worker C's $90,000 entered pay never reaches the council-visible total.
    expect(snapshot.enteredCurrentPayCents).toBe(5000000);
  });

  it('never fabricates a benefits-share or weighted-adjustment figure', () => {
    const snapshot = buildLiveCompensationCouncilSnapshot(liveReport, 'admin');
    expect(snapshot.benefitsSharePct).toBeUndefined();
    expect(snapshot.weightedAdjustmentPct).toBeUndefined();
    expect(snapshot.roleCount).toBeUndefined();
  });

  it('fails closed on a non-live or malformed report', () => {
    expect(() => buildLiveCompensationCouncilSnapshot({ source: 'synthetic-fallback', workers: [] }, 'admin'))
      .toThrow('Live Compensation council snapshot requires a live compensation report');
    expect(() => buildLiveCompensationCouncilSnapshot(null, 'admin'))
      .toThrow('Live Compensation council snapshot requires a live compensation report');
    expect(() => buildLiveCompensationCouncilSnapshot({ source: 'live', workers: 'nope' }, 'admin'))
      .toThrow('Live Compensation council snapshot requires a live compensation report');
    expect(() => buildLiveCompensationCouncilSnapshot({
      source: 'live', workers: [liveWorker({ currentPaySource: 'entered', currentPayCents: null })],
    }, 'admin')).toThrow('Live Compensation worker summary has an invalid entered current pay figure');
  });
});

// The Plan page's own worker table/KPIs reuse these two helpers directly (compensation-pages.js)
// so a `council` viewer can never see a hideFromCouncil worker there either -- the same gap that
// was open on the live Plan page before this section-level rollup existed on Council.
describe('filterCompensationWorkersForViewer / summarizeCompensationWorkers (shared by Plan and Council)', () => {
  const workers = [
    liveWorker({ name: 'Worker A', currentPayCents: 5000000, currentPaySource: 'entered' }),
    liveWorker({ name: 'Worker B', currentPayCents: null, currentPaySource: 'budget_line', accountCode: '58004' }),
    liveWorker({ name: 'Worker C (hidden)', currentPayCents: 9000000, currentPaySource: 'entered', hideFromCouncil: true }),
  ];

  it('drops a hideFromCouncil worker only for the council role', () => {
    expect(filterCompensationWorkersForViewer(workers, 'council').map((w) => w.name)).toEqual(['Worker A', 'Worker B']);
    expect(filterCompensationWorkersForViewer(workers, 'admin').map((w) => w.name)).toEqual(['Worker A', 'Worker B', 'Worker C (hidden)']);
    expect(filterCompensationWorkersForViewer(workers, 'compensation')).toHaveLength(3);
  });

  it('recomputes totals from whatever list it is given, never a stored total', () => {
    expect(summarizeCompensationWorkers(workers)).toEqual({
      workerCount: 3, enteredCurrentPayCount: 2, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 14000000,
    });
    const councilVisible = filterCompensationWorkersForViewer(workers, 'council');
    expect(summarizeCompensationWorkers(councilVisible)).toEqual({
      workerCount: 2, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 1, enteredCurrentPayCents: 5000000,
    });
  });

  it('fails closed on an invalid entered current-pay figure', () => {
    expect(() => summarizeCompensationWorkers([liveWorker({ currentPaySource: 'entered', currentPayCents: null })]))
      .toThrow('Live Compensation worker summary has an invalid entered current pay figure');
  });
});
