import { describe, it, expect } from 'vitest';
import { CHMS_APP_CSS } from '../src/html-chms.js';

// P26-C: --ev-navy/--ev-teal/--ev-ink/--ev-danger were exact-value aliases for
// --color-navy/--color-teal/--charcoal/--danger (confirmed during RDS5). Every
// var(--ev-navy|teal|ink|danger) usage now points at the brand token directly, so the
// four alias definitions are retired -- nothing left in the assembled stylesheet
// references them, in either direction.
//
// --ev-muted/--ev-cream/--ev-moss/--ev-border/--ev-border2 have no matching brand
// token (--ev-moss is a deliberately distinct green from --sage) and are untouched --
// this is a targeted dedup of the four that had a real duplicate, not a rename of the
// whole --ev-* family.

const RETIRED = ['--ev-navy', '--ev-teal', '--ev-ink', '--ev-danger'];
const KEPT = ['--ev-muted', '--ev-cream', '--ev-moss', '--ev-border', '--ev-border2'];

describe('P26-C: --ev-navy/--ev-teal/--ev-ink/--ev-danger retired as aliases', () => {
  it('no rule references the four retired tokens any more', () => {
    for (const t of RETIRED) {
      expect(CHMS_APP_CSS, t + ' should not be referenced').not.toContain('var(' + t + ')');
    }
  });

  it('the four retired tokens are no longer declared in :root', () => {
    const rootBlock = CHMS_APP_CSS.slice(0, CHMS_APP_CSS.indexOf('}') + 1);
    for (const t of RETIRED) {
      expect(rootBlock, t + ' should not be declared').not.toMatch(new RegExp('(^|[;{\\n])\\s*' + t + '\\s*:'));
    }
  });

  it('the five tokens with no brand equivalent are still declared and still used', () => {
    const rootBlock = CHMS_APP_CSS.slice(0, CHMS_APP_CSS.indexOf('}') + 1);
    for (const t of KEPT) {
      expect(rootBlock, t + ' should still be declared').toMatch(new RegExp('(^|[;{\\n])\\s*' + t + '\\s*:'));
      expect(CHMS_APP_CSS, t + ' should still be referenced').toContain('var(' + t + ')');
    }
  });

  it('every retired usage resolved to the correct brand token, not dropped or blanked', () => {
    // A spot-check on real rules from html-head.js/html-tabs.js that used to read
    // var(--ev-navy)/var(--ev-teal) -- if the substitution had silently dropped the
    // color instead of replacing it, these selectors would be missing any color rule.
    expect(CHMS_APP_CSS).toContain('.ev-list-header h4{');
    expect(CHMS_APP_CSS).toMatch(/\.ev-list-header h4\{[^}]*color:var\(--color-navy\)/);
    expect(CHMS_APP_CSS).toMatch(/\.ev-edit-link\{[^}]*color:var\(--color-teal\)/);
  });
});
