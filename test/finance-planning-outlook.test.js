import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
// P25-E: finance-only functions moved out of the ext bundle into their own lazily-loaded
// bundle (see html-chms.js). This file only extracts source by regex/string search, so the
// two are simply concatenated back together for that purpose.
const CHMS_APP_EXT_JS_ALL = CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS;

// finRenderPlanningOutlook() lives inside the served (String.raw) frontend script — extract and
// eval standalone, same technique used elsewhere in this project (see CLAUDE.md SC3-BUG1 /
// TAP11 / FIN10 / finance-church-detail-body). It reads _finPlanTargetYear as a free variable
// and calls finFmtMoney/finFmtSigned/finMoney0, so those are stubbed/extracted alongside it.
//
// The Finance Workspace v3 redesign (2026-08) replaced the old three-year GROUPED BAR chart —
// revenue +2.5%/yr, expenses +3%/yr, one net figure per year — with the handoff's five-year LINE
// chart: expenses compounding against revenue held flat, with the widening gap filled between
// them. That is a deliberate change of what the chart claims, not a regression: "what does this
// plan cost us if nothing changes on the revenue side" is a question a growth-adjusted revenue
// line quietly answers away. These tests pin the new contract.
function loadHelper() {
  const escStub = 'var _finPlanTargetYear = 2027;';
  const fmtMoneyM = CHMS_APP_EXT_JS_ALL.match(/function finFmtMoney\([^)]*\) \{[\s\S]*?\n\}/);
  const fmtSignedM = CHMS_APP_EXT_JS_ALL.match(/function finFmtSigned\([^)]*\) \{[\s\S]*?\n\}/);
  const money0M = CHMS_APP_EXT_JS_ALL.match(/function finMoney0\([^)]*\) \{[\s\S]*?\n\}/);
  const outlookM = CHMS_APP_EXT_JS_ALL.match(/function finRenderPlanningOutlook\([^)]*\) \{[\s\S]*?\n\}/);
  if (!fmtMoneyM || !fmtSignedM || !money0M || !outlookM) throw new Error('helper(s) not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${escStub} ${fmtMoneyM[0]} ${fmtSignedM[0]} ${money0M[0]} ${outlookM[0]} return finRenderPlanningOutlook; })()`);
}

describe('finRenderPlanningOutlook', () => {
  const finRenderPlanningOutlook = loadHelper();

  it('projects five years from the target year', () => {
    const html = finRenderPlanningOutlook(100000000, 90000000); // $1,000,000 revenue / $900,000 expenses
    for (const y of [2027, 2028, 2029, 2030, 2031]) expect(html, String(y)).toContain('>' + y + '<');
    expect(html, 'a sixth year would mean the window drifted').not.toContain('>2032<');
  });

  it('compounds expenses at 3% and holds revenue flat', () => {
    // $1,000,000 flat revenue against $900,000 growing 3%/yr crosses over inside the window:
    // 900,000 * 1.03^4 = 1,012,957.93 — so the final year's gap is $12,958.
    const html = finRenderPlanningOutlook(100000000, 90000000);
    expect(html, 'final-year gap, from 3% compounding against flat revenue').toContain('$12,958');
    // Two lines, not bars: the expense line solid, the flat revenue line dashed.
    expect(html).toContain('stroke="var(--danger)"');
    expect(html).toContain('stroke-dasharray="6 5"');
    expect(html).toContain('&mdash; Revenue if flat');
  });

  it('says plainly when the plan stays in surplus across the window', () => {
    // Expenses far below revenue never catch up within five years at 3%.
    const html = finRenderPlanningOutlook(100000000, 10000000);
    expect(html).toContain('stays closed through FY2031');
    expect(html).not.toContain('compounds to');
  });

  it('carries an aria-label that states the trend in words', () => {
    const html = finRenderPlanningOutlook(100000000, 90000000);
    const label = html.match(/aria-label="([^"]+)"/);
    expect(label, 'the chart must be readable without seeing it').toBeTruthy();
    expect(label[1]).toContain('expenses rising from $900,000 to $1,012,958');
    expect(label[1]).toContain('widening gap');
  });

  it('mounts the Ivanhoe forecast beside it rather than below the page', () => {
    // finRenderPropertyMultiYearForecast() targets this id; if the outlook stops emitting it the
    // forecast silently renders nowhere, which is exactly the failure this catches.
    expect(finRenderPlanningOutlook(100000000, 90000000)).toContain('id="fin-plan-property-mount"');
  });
});
