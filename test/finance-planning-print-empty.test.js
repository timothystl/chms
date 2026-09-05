import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { JS_FINANCE } from '../src/frontend/js-finance.js';
import { HTML_TABS_2 } from '../src/frontend/html-tabs.js';

// Reported live: printing the Budget tab ("my budget print is empty") produced a completely
// blank print preview. Root cause was a DOM-nesting mismatch in the body.printing-plan CSS
// contract, not anything in finPlanPrint() itself (which correctly toggles the body class — see
// the existing coverage in finance-planning-chart-of-accounts.test.js).
//
// The static markup nests #fin-plan-print-card TWO levels under #fin-panel-planning:
//   #fin-panel-planning > #fin-plan-root > #fin-plan-print-card
// (finRenderPlanning() in js-finance.js fully rebuilds #fin-plan-root's own innerHTML with the
// print card inside it — it never touches #fin-panel-planning directly.) The pre-fix CSS rule
// was "#fin-panel-planning > *:not(#fin-plan-print-card){display:none!important;}" — a rule
// that only ever inspects DIRECT children. #fin-plan-root itself is a direct child and is NOT
// #fin-plan-print-card, so that rule hid #fin-plan-root outright, taking the print card down
// with it as a descendant. Nothing was left to print.
//
// No browser exists in this environment to render the cascade directly (vitest runs under
// environment:'node', no jsdom/CSSOM) — verified at the CSS-source level instead, same
// technique as the SC19-FIX1/DSN1 class of bug in this codebase.

describe('Budget tab print no longer blanks out (finPlanPrint / body.printing-plan)', () => {
  it('the static markup nests #fin-plan-print-card two levels under #fin-panel-planning, via #fin-plan-root', () => {
    const panelMatch = HTML_TABS_2.match(/<div id="fin-panel-planning"[^>]*>([\s\S]*?)<\/div>\s*<!--/) ||
      HTML_TABS_2.match(/<div id="fin-panel-planning"[^>]*>([\s\S]{0,200})/);
    expect(panelMatch).toBeTruthy();
    // The only static child is the mount point; the print card is injected into it at render
    // time, not present in the shipped markup at all — confirming the card can never be a
    // direct child of #fin-panel-planning.
    expect(panelMatch[1]).toMatch(/<div id="fin-plan-root">/);
    expect(panelMatch[1]).not.toMatch(/fin-plan-print-card/);

    expect(JS_FINANCE).toMatch(/id="fin-plan-print-card"/);
    // finRenderPlanning() targets #fin-plan-root, not #fin-panel-planning — confirms where the
    // print card actually lands once rendered.
    const renderFnMatch = JS_FINANCE.match(/function finRenderPlanning\(\)\s*\{([\s\S]*?)\n\}\n/);
    expect(renderFnMatch).toBeTruthy();
    expect(renderFnMatch[1]).toMatch(/getElementById\('fin-plan-root'\)/);
  });

  it('the printing-plan CSS block names both nesting levels explicitly, not just the outer one', () => {
    const blockMatch = HTML_HEAD.match(/body\.printing-plan[\s\S]*?body\.printing-plan #fin-plan-print-card\{[^}]*\}/);
    expect(blockMatch).toBeTruthy();
    const block = blockMatch[0];

    // The fixed shape: #fin-plan-root is carved out from #fin-panel-planning's children, and
    // #fin-plan-print-card is separately carved out from #fin-plan-root's children.
    expect(block).toMatch(/#fin-panel-planning\s*>\s*\*:not\(#fin-plan-root\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
    expect(block).toMatch(/#fin-plan-root\s*>\s*\*:not\(#fin-plan-print-card\)\s*\{\s*display:\s*none\s*!important;\s*\}/);

    // The regression shape: a single rule reaching straight from #fin-panel-planning to
    // #fin-plan-print-card, skipping the intermediate #fin-plan-root level. If this ever comes
    // back, it silently hides #fin-plan-root (and everything inside it) again.
    expect(block).not.toMatch(/#fin-panel-planning\s*>\s*\*:not\(#fin-plan-print-card\)/);
  });

  it('#fin-plan-print-card is forced visible in case any ambient rule ever sets it display:none', () => {
    const blockMatch = HTML_HEAD.match(/body\.printing-plan #fin-plan-print-card\{([^}]*)\}/);
    expect(blockMatch).toBeTruthy();
    expect(blockMatch[1]).toMatch(/display:\s*block\s*!important/);
  });
});
