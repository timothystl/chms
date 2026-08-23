import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// Reported live from a phone: the off-canvas sidebar drawer stopped scrolling at
// "Volunteers," with Scheduler/Settings/Sign Out unreachable below the fold. Root cause:
// `.sidebar` is `position:fixed; height:100vh`, and mobile Safari measures 100vh against
// the LARGE viewport (address bar collapsed) — taller than what's actually visible
// whenever the address bar is showing. A fixed element sized to that oversized box
// extends below the real screen, with nothing to scroll (the box itself isn't
// overflowing its own bounds, it's just positioned past the visible viewport).
//
// Fix: layer a 100dvh declaration after 100vh, so browsers that support the dynamic
// viewport unit (which tracks what's actually on screen) use it, and everything else
// keeps the 100vh fallback.

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));

function rule(selector) {
  const m = STYLE.match(new RegExp(selector.replace(/[.#]/g, '\\$&') + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

describe('mobile sidebar drawer height (100dvh over 100vh)', () => {
  it('.sidebar declares both 100vh and 100dvh for height, dvh last so it wins', () => {
    const body = rule('.sidebar');
    expect(body).toMatch(/height:100vh/);
    expect(body).toMatch(/height:100dvh/);
    expect(body.indexOf('height:100dvh')).toBeGreaterThan(body.indexOf('height:100vh'));
  });

  it('.app-shell declares both 100vh and 100dvh for height, dvh last so it wins', () => {
    const body = rule('.app-shell');
    expect(body).toMatch(/height:100vh/);
    expect(body).toMatch(/height:100dvh/);
    expect(body.indexOf('height:100dvh')).toBeGreaterThan(body.indexOf('height:100vh'));
  });

  it('.sidebar keeps its scroll-internally-when-drawer-is-open properties', () => {
    // Guards against a fix that accidentally drops these while touching the rule.
    const body = rule('.sidebar');
    expect(body).toMatch(/position:fixed/);
    expect(body).toMatch(/overflow-y:auto/);
  });
});
