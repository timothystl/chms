import { describe, it, expect } from 'vitest';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// P26-A (retires DSN1). _scopeCss() drops the Scheduler's own :root block on embed with the
// comment "ChMS already declares the same CSS custom properties" — true for most tokens, false
// for nine of them (`--honey`, `--soft-sage`, `--on-pale-gold`, `--on-pale-sage`, `--error-bg`,
// `--on-error-bg`, `--error-border`, `--danger-btn`, `--danger-hover`), which went undefined the
// moment RD3 retired the standalone /scheduler page and made the embed the only Scheduler there
// is. This is the build-time assertion the plan asked for, so the next token added to the
// Scheduler can't silently repeat this.

/** Every :root{...} block in the assembled shell CSS, merged into one declared-token set. */
function declaredTokens(css) {
  const declared = new Set();
  for (const block of css.matchAll(/:root\s*\{([^}]*)\}/gs)) {
    for (const m of block[1].matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);
  }
  return declared;
}

/** var(--x) usages with NO fallback — the ones that must actually resolve. A var() with a
 * fallback (var(--x, #fallback)) is fine either way; the fallback is what renders. */
function varsWithoutFallback(css) {
  const used = new Set();
  for (const m of css.matchAll(/var\(--([a-zA-Z0-9-]+)\s*\)/g)) used.add(m[1]);
  return used;
}

describe('the embedded Scheduler never references an undefined CSS custom property', () => {
  it('every no-fallback var(--x) the embed uses resolves against the app shell\'s declared tokens', () => {
    const { markup } = getSchedulerInlineParts();
    const styleMatch = markup.match(/<style>\n([\s\S]*?)\n<\/style>/);
    expect(styleMatch).toBeTruthy();
    const schedulerCss = styleMatch[1];

    const declared = declaredTokens(HTML_HEAD);
    const used = varsWithoutFallback(schedulerCss);
    const undeclared = [...used].filter((name) => !declared.has(name));

    expect(undeclared).toEqual([]);
  });

  it('the nine originally-missing tokens are declared with their original Scheduler values', () => {
    // Pinned to the exact values scheduler-html.js's own (now-stripped-on-embed) :root
    // declared, so this fix cannot silently drift the colors while staying "defined".
    const expected = {
      '--honey': '#E8C070',
      '--soft-sage': '#9AB89E',
      '--on-pale-gold': '#5a3a00',
      '--on-pale-sage': '#1a3d1f',
      '--on-error-bg': '#7a1f1f',
      '--error-bg': '#FAEAEA',
      '--error-border': '#D4726A',
      '--danger-btn': '#B85C3A',
      '--danger-hover': '#A04A2A',
    };
    for (const [name, value] of Object.entries(expected)) {
      const re = new RegExp(name.replace('--', '\\-\\-') + '\\s*:\\s*' + value, 'i');
      expect(HTML_HEAD).toMatch(re);
    }
  });
});
