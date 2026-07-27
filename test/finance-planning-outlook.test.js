import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finRenderPlanningOutlook() lives inside the served (String.raw) frontend script — extract and
// eval standalone, same technique used elsewhere in this project (see CLAUDE.md SC3-BUG1 /
// TAP11 / FIN10 / finance-church-detail-body). It reads _finPlanTargetYear as a free variable
// and calls finFmtMoney/finFmtSigned, so those are stubbed/extracted alongside it.
function loadHelper() {
  const escStub = 'var _finPlanTargetYear = 2027;';
  const fmtMoneyM = CHMS_APP_EXT_JS.match(/function finFmtMoney\([^)]*\) \{[\s\S]*?\n\}/);
  const fmtSignedM = CHMS_APP_EXT_JS.match(/function finFmtSigned\([^)]*\) \{[\s\S]*?\n\}/);
  const outlookM = CHMS_APP_EXT_JS.match(/function finRenderPlanningOutlook\([^)]*\) \{[\s\S]*?\n\}/);
  if (!fmtMoneyM || !fmtSignedM || !outlookM) throw new Error('helper(s) not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${escStub} ${fmtMoneyM[0]} ${fmtSignedM[0]} ${outlookM[0]} return finRenderPlanningOutlook; })()`);
}

describe('finRenderPlanningOutlook', () => {
  const finRenderPlanningOutlook = loadHelper();

  it('grows revenue 2.5%/yr and expenses 3%/yr across 4 years (target year + 3)', () => {
    const html = finRenderPlanningOutlook(100000000, 90000000); // $1,000,000 revenue / $900,000 expenses
    // Year 0 (FY2027): net = $100,000
    expect(html).toContain('FY2027');
    expect(html).toContain('+$100,000.00');
    // Year 1 (FY2028): revenue 1,000,000*1.025=1,025,000, expenses 900,000*1.03=927,000, net=98,000
    expect(html).toContain('FY2028');
    expect(html).toContain('+$98,000.00');
    // Year 3 (FY2030) should exist and be a smaller surplus (or a deficit) as expenses outgrow revenue
    expect(html).toContain('FY2030');
  });

  it('colors a deficit year distinctly (negative net renders with a minus sign via finFmtSigned)', () => {
    const html = finRenderPlanningOutlook(100000, 100000000); // revenue way below expenses
    expect(html).toContain('-$');
  });
});
