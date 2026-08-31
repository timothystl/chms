import { describe, it, expect } from 'vitest';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// Grid view's open ("— assign — / OPEN") cells were spanning the ENTIRE grid
// width instead of staying inside their own Sunday's column. Root cause was a
// class-name collision, not a specificity fight over the properties this file
// had already hardened: ChMS's own global stylesheet (html-head.js) carries an
// UNSCOPED ".empty" rule for its own "no results" empty-states, and that rule
// sets `grid-column: 1/-1`. CSS class matching has no notion of component
// boundaries — the scheduler's own cells carry the class "role-row gr-cell
// empty" (the "empty" half is the scheduler's own convention for an unfilled
// slot, coincidentally the same class name), so the outer app's rule reached
// straight into the embedded scheduler's DOM. .role-row.gr-cell never set
// grid-column at all, so the outer app's rule was the ONLY declaration for
// that property and won outright, regardless of every other property the
// scheduler's own higher-specificity rule had already locked down.
//
// This test pins the fix at the CSS-source level (not by rendering, since
// there's no browser here) — the app shell really does still carry the
// colliding rule (that's not itself a bug; it serves the app's own
// empty-states), and the scheduler's own embedded CSS must set grid-column
// explicitly on its own empty-cell selector so it can never again be the
// only rule holding that property.

describe('Grid view empty cells do not inherit the app shell\'s unrelated .empty rule', () => {
  it('the app shell really does carry the colliding grid-column rule (documents why this matters)', () => {
    const emptyRuleMatch = HTML_HEAD.match(/\.empty\s*\{[^}]*\}/);
    expect(emptyRuleMatch).toBeTruthy();
    expect(emptyRuleMatch[0]).toMatch(/grid-column\s*:\s*1\s*\/\s*-1/);
  });

  it('the scheduler embed sets its own grid-column for .role-row.gr-cell.empty, so the collision cannot reach it', () => {
    const { markup } = getSchedulerInlineParts();
    const styleMatch = markup.match(/<style>\n([\s\S]*?)\n<\/style>/);
    expect(styleMatch).toBeTruthy();
    const css = styleMatch[1];

    // Scoped by _scopeCss() to ".sched-root .role-row.gr-cell.empty { ... }"
    const ruleMatch = css.match(/\.role-row\.gr-cell\.empty\s*\{([^}]*)\}/);
    expect(ruleMatch).toBeTruthy();
    expect(ruleMatch[1]).toMatch(/grid-column\s*:\s*auto/);
  });

  it('the scoped selector has higher specificity than the bare .empty rule regardless of source order', () => {
    const { markup } = getSchedulerInlineParts();
    // .sched-root .role-row.gr-cell.empty — 1 id-less descendant + 4 classes = far
    // more specific than the app shell's bare ".empty" (1 class). Confirms the
    // scoping prefix (_scopeCss) actually reached this selector.
    expect(markup).toMatch(/\.sched-root \.role-row\.gr-cell\.empty\s*\{/);
  });
});
