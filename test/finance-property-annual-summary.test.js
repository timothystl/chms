import { describe, it, expect } from 'vitest';
import { computePropertyAnnualSummary } from '../src/api-finance.js';

// The real 2026 rows for 3277 Ivanhoe. Four of the six months report net income with NO separate
// expenses line — the MRI report format AHRA switched to in Jan 2026 — which is what made the
// "Does it fund itself?" card print lines that could not reach its own total.
const REAL_2026 = [
  { period: '2026-01', total_revenue_cents: 932721, total_expenses_cents: null, net_income_cents: 509994, occupancy_pct: 1.0 },
  { period: '2026-02', total_revenue_cents: 1049520, total_expenses_cents: null, net_income_cents: 637333, occupancy_pct: 1.0 },
  { period: '2026-03', total_revenue_cents: 859000, total_expenses_cents: 576665, net_income_cents: 282335, occupancy_pct: 1.0 },
  { period: '2026-04', total_revenue_cents: 1318497, total_expenses_cents: null, net_income_cents: 975000, occupancy_pct: 1.0 },
  { period: '2026-05', total_revenue_cents: 927063, total_expenses_cents: null, net_income_cents: 448614, occupancy_pct: 0.8892 },
  { period: '2026-06', total_revenue_cents: 976527, total_expenses_cents: 446248, net_income_cents: 530279, occupancy_pct: 1.0 },
];

describe('computePropertyAnnualSummary — expenses reconcile to net income', () => {
  const y = computePropertyAnnualSummary(REAL_2026, [], {})[0];

  it('revenue minus expenses equals net income exactly', () => {
    // The defect: revenue and net income accumulated over all six months while expenses
    // accumulated over only the two that had a figure, so the card's visible arithmetic was
    // $16,568.60 short and could never reach its own printed total.
    expect(y.total_revenue_cents - y.total_expenses_cents).toBe(y.net_income_cents);
  });

  it('recovers exactly the $16,568.60 that used to go missing for 2026', () => {
    const reportedOnly = 576665 + 446248;               // the two months AHRA broke out
    expect(y.total_expenses_cents).toBe(2679773);       // $26,797.73
    expect(y.total_expenses_cents - reportedOnly).toBe(1656860); // $16,568.60
    expect(y.total_revenue_cents).toBe(6063328);        // $60,633.28, unchanged
    expect(y.net_income_cents).toBe(3383555);           // $33,835.55, unchanged
  });

  it('reports how many months were reconstructed, so the UI can say so', () => {
    expect(y.expense_months_derived).toBe(4);
  });

  it('derives nothing when every month reports its own expenses', () => {
    const clean = computePropertyAnnualSummary(
      [{ period: '2025-01', total_revenue_cents: 100000, total_expenses_cents: 40000, net_income_cents: 60000 }],
      [], {},
    )[0];
    expect(clean.expense_months_derived).toBe(0);
    expect(clean.total_expenses_cents).toBe(40000);
  });

  it('cannot derive when revenue is missing too, and does not invent a figure', () => {
    const sparse = computePropertyAnnualSummary(
      [{ period: '2025-01', total_revenue_cents: null, total_expenses_cents: null, net_income_cents: 60000 }],
      [], {},
    )[0];
    expect(sparse.total_expenses_cents).toBe(0);
    expect(sparse.expense_months_derived).toBe(0);
  });

  it('leaves revenue, net income, occupancy and distributions untouched', () => {
    const withDist = computePropertyAnnualSummary(REAL_2026, [{ period: '2026-04', amount_cents: 400000 }], {})[0];
    expect(withDist.confirmed_distributions_cents).toBe(400000);
    expect(withDist.avg_occupancy_pct).toBeCloseTo((1 + 1 + 1 + 1 + 0.8892 + 1) / 6, 6);
  });
});
