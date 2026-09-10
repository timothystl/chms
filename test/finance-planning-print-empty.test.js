import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { JS_FINANCE } from '../src/frontend/js-finance.js';
import { HTML_TABS_2 } from '../src/frontend/html-tabs.js';

// Reported live: printing the Budget tab ("my budget print is empty") produced a completely
// blank print preview. Root cause was a DOM-nesting mismatch in the body.printing-plan CSS
// contract: the static markup nests the print target TWO levels under #fin-panel-planning
//   #fin-panel-planning > #fin-plan-root > <print target>
// (finRenderPlanning() in js-finance.js fully rebuilds #fin-plan-root's own innerHTML with the
// print target inside it — it never touches #fin-panel-planning directly.) The original CSS rule
// was "#fin-panel-planning > *:not(#fin-plan-print-card){display:none!important;}" — a rule that
// only ever inspects DIRECT children. #fin-plan-root itself is a direct child and is NOT the
// print target, so that rule hid #fin-plan-root outright, taking the print target down with it as
// a descendant. Nothing was left to print. Fixed by naming both nesting levels explicitly.
//
// Print was later rebuilt again (see finPlanBuildPrintSheetHtml/finPlanPrint in js-finance.js) to
// render a dedicated, purpose-built sheet into #fin-plan-printsheet-root — the workspace's
// "Category by category" card (#fin-plan-print-card) itself never prints anymore — but the same
// two-level nesting trap applies to whatever element IS the print target, so this file's coverage
// moved onto #fin-plan-printsheet-root rather than being retired.
//
// No browser exists in this environment to render the cascade directly (vitest runs under
// environment:'node', no jsdom/CSSOM) — verified at the CSS-source level instead, same
// technique as the SC19-FIX1/DSN1 class of bug in this codebase.

describe('Budget tab print no longer blanks out (finPlanPrint / body.printing-plan)', () => {
  it('the static markup nests the print target two levels under #fin-panel-planning, via #fin-plan-root', () => {
    const panelMatch = HTML_TABS_2.match(/<div id="fin-panel-planning"[^>]*>([\s\S]*?)<\/div>\s*<!--/) ||
      HTML_TABS_2.match(/<div id="fin-panel-planning"[^>]*>([\s\S]{0,200})/);
    expect(panelMatch).toBeTruthy();
    // The only static child is the mount point; the print sheet is injected into it at render
    // time, not present in the shipped markup at all — confirming it can never be a direct child
    // of #fin-panel-planning.
    expect(panelMatch[1]).toMatch(/<div id="fin-plan-root">/);
    expect(panelMatch[1]).not.toMatch(/fin-plan-printsheet-root/);

    expect(JS_FINANCE).toMatch(/id="fin-plan-printsheet-root"/);
    // finRenderPlanning() targets #fin-plan-root, not #fin-panel-planning — confirms where the
    // print sheet mount point actually lands once rendered.
    const renderFnMatch = JS_FINANCE.match(/function finRenderPlanning\(\)\s*\{([\s\S]*?)\n\}\n/);
    expect(renderFnMatch).toBeTruthy();
    expect(renderFnMatch[1]).toMatch(/getElementById\('fin-plan-root'\)/);
  });

  it('the printing-plan CSS block names both nesting levels explicitly, not just the outer one', () => {
    const blockMatch = HTML_HEAD.match(/body\.printing-plan[\s\S]*?body\.printing-plan #fin-plan-printsheet-root\{[^}]*\}/);
    expect(blockMatch).toBeTruthy();
    const block = blockMatch[0];

    // The fixed shape: #fin-plan-root is carved out from #fin-panel-planning's children, and
    // #fin-plan-printsheet-root is separately carved out from #fin-plan-root's children.
    expect(block).toMatch(/#fin-panel-planning\s*>\s*\*:not\(#fin-plan-root\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
    expect(block).toMatch(/#fin-plan-root\s*>\s*\*:not\(#fin-plan-printsheet-root\)\s*\{\s*display:\s*none\s*!important;\s*\}/);

    // The regression shape: a single rule reaching straight from #fin-panel-planning to the print
    // sheet, skipping the intermediate #fin-plan-root level. If this ever comes back, it silently
    // hides #fin-plan-root (and everything inside it) again.
    expect(block).not.toMatch(/#fin-panel-planning\s*>\s*\*:not\(#fin-plan-printsheet-root\)/);
  });

  it('#fin-plan-printsheet-root is forced visible in case any ambient rule ever sets it display:none', () => {
    const blockMatch = HTML_HEAD.match(/body\.printing-plan #fin-plan-printsheet-root\{([^}]*)\}/);
    expect(blockMatch).toBeTruthy();
    expect(blockMatch[1]).toMatch(/display:\s*block\s*!important/);
  });
});

// Reported live, again: with the two-level nesting above already fixed and the sheet correctly
// visible, three explicit break-before:page pages still printed as one, with the Revenue and
// Expenses content simply gone rather than flowing onto pages 2/3. Root cause was app-wide, not
// specific to Planning: the global "html,body{height:100%;overflow:hidden;}" rule (for the SPA
// shell's fixed-viewport screen layout, where internal panels scroll but the page itself never
// does) was never relaxed for print, so the browser's print engine paginated a body capped at one
// viewport's height — anything past that was clipped before pagination ever saw it. Verified with
// an actual generated PDF (chrome --headless --print-to-pdf), the same check a human's "Save as
// PDF" performs, since vitest itself runs under environment:'node' with no page-layout engine —
// same technique as the tests above, one level more literal.
describe('Print pagination isn\'t silently clipped to one page (the global overflow:hidden reset)', () => {
  it('a print-scoped rule relaxes html,body back to auto/visible, undoing the SPA shell\'s fixed-viewport screen layout', () => {
    // Scoped inside @media print, not a bare rule — a bare (unconditional) reset would fight the
    // screen-only rule below on every ordinary page load, not just print.
    const printResetIndex = HTML_HEAD.indexOf('html,body{height:auto!important;overflow:visible!important;}');
    expect(printResetIndex).toBeGreaterThan(-1);
    const precedingMediaPrint = HTML_HEAD.lastIndexOf('@media print{', printResetIndex);
    expect(precedingMediaPrint).toBeGreaterThan(-1);
    // Every ordinary "selector{...}" rule between the two is brace-balanced on its own, so a net
    // count of exactly 1 unmatched "{" (the @media's own) means the block never closed before
    // reaching this rule — closed and reopened would show 0, one full rule short would show 2.
    const between = HTML_HEAD.slice(precedingMediaPrint, printResetIndex);
    const netOpenBraces = (between.match(/\{/g) || []).length - (between.match(/\}/g) || []).length;
    expect(netOpenBraces).toBe(1);
  });

  it('the screen-only html,body rule (height:100%;overflow:hidden) is untouched — this is a print-only reset, not a removal', () => {
    expect(HTML_HEAD).toMatch(/html,body\{height:100%;overflow:hidden;\}/);
  });
});

// Reported live a third time: with html,body relaxed, the sheet STILL printed as one page in a
// real browser, even though an isolated repro (the print-sheet content alone, no surrounding app
// shell) correctly produced multiple pages — the isolation itself was hiding the bug. The real
// ancestor chain is body > .app-shell > .content-area > #tab-finance(.tab-panel) > ... >
// #fin-plan-printsheet-root, and .app-shell (height:100vh) / .content-area (overflow:hidden) — the
// screen shell's own sidebar+content-area flex layout — clip exactly like html,body did, one level
// deeper, and were equally unscoped to screen-only. Confirmed by reproducing that full ancestor
// chain (not just the print-sheet content in isolation) and extracting real per-page text from a
// generated PDF (pdfminer, since vitest has no page-layout engine): hidden siblings (sidebar,
// topbar, other tabs, the old workspace table) never appeared on any page, and Revenue/Expenses
// correctly flowed across as many pages as the content needed.
describe('The app shell itself (.app-shell/.content-area) doesn\'t re-clip print after the html,body fix', () => {
  it('a print-scoped rule drops .app-shell and .content-area to plain block flow, undoing their fixed-height/overflow-hidden/flex screen layout', () => {
    const rule = '.app-shell,.content-area{display:block!important;height:auto!important;overflow:visible!important;}';
    const ruleIndex = HTML_HEAD.indexOf(rule);
    expect(ruleIndex).toBeGreaterThan(-1);
    const precedingMediaPrint = HTML_HEAD.lastIndexOf('@media print{', ruleIndex);
    expect(precedingMediaPrint).toBeGreaterThan(-1);
    const between = HTML_HEAD.slice(precedingMediaPrint, ruleIndex);
    const netOpenBraces = (between.match(/\{/g) || []).length - (between.match(/\}/g) || []).length;
    expect(netOpenBraces).toBe(1);
  });

  it('the screen-only .app-shell/.content-area rules (the fixed-viewport flex shell) are untouched — this is a print-only reset, not a removal', () => {
    expect(HTML_HEAD).toMatch(/\.app-shell\{display:flex;height:100vh;height:100dvh;\}/);
    expect(HTML_HEAD).toMatch(/\.content-area\{flex:1;display:flex;flex-direction:column;overflow:hidden;margin-left:0;\}/);
  });
});
