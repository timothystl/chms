import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finComputeAvailableForDistribution() lives inside the served (String.raw) frontend script, not
// as an exported module function — extract and eval standalone, same technique used elsewhere in
// this project (see CLAUDE.md SC3-BUG1 / TAP11 / FIN10 / finance-church-detail-body).
function loadHelper() {
  const m = CHMS_APP_EXT_JS.match(/function finComputeAvailableForDistribution\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeAvailableForDistribution not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeAvailableForDistribution; })()`);
}

describe('finComputeAvailableForDistribution', () => {
  const finComputeAvailableForDistribution = loadHelper();
  const thisYear = new Date().getFullYear();

  it('subtracts this year\'s reserve contributions and capital spend from annual net income', () => {
    const d = {
      annualSummary: [{ year: thisYear, net_income_cents: 5000000 }, { year: thisYear - 1, net_income_cents: 999999 }],
      reserves: {
        property_tax: [
          { report_month: `${thisYear}-01`, contribution_cents: 100000 },
          { report_month: `${thisYear}-02`, contribution_cents: 100000 },
          { report_month: `${thisYear - 1}-12`, contribution_cents: 999999 }, // prior year — excluded
        ],
      },
      capitalLedger: [
        { entry_date: `${thisYear}-03-01`, amount_cents: 500000 },
        { entry_date: `${thisYear - 1}-11-01`, amount_cents: 999999 }, // prior year — excluded
      ],
    };
    const result = finComputeAvailableForDistribution(d);
    expect(result.year).toBe(thisYear);
    expect(result.annualNetCents).toBe(5000000);
    expect(result.reserveContribCents).toBe(200000);
    expect(result.capitalCents).toBe(500000);
    expect(result.availableCents).toBe(5000000 - 200000 - 500000);
  });

  it('handles no data for the current year gracefully', () => {
    const result = finComputeAvailableForDistribution({ annualSummary: [], reserves: {}, capitalLedger: [] });
    expect(result.annualNetCents).toBe(0);
    expect(result.reserveContribCents).toBe(0);
    expect(result.capitalCents).toBe(0);
    expect(result.availableCents).toBe(0);
  });
});
