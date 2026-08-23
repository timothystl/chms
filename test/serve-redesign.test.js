// Structural regression coverage for the "Serve at Timothy" redesign
// (design_handoff_serve_timothy): the volunteer sign-up wizard on the landing page
// and the Christmas Market shift picker. These assert against the real assembled
// PUBLIC_HTML/PUBLIC_SCRIPTS (no separate fixture that could drift), matching this
// repo's existing convention of structural checks rather than a real browser in CI
// — the full click-through was verified separately with Playwright against a live
// Chromium (see scripts/verify-serve-redesign.mjs and -2.mjs; not run in CI because
// this repo has no browser install step).
import { describe, it, expect } from 'vitest';
import { PUBLIC_HTML, PUBLIC_APP_JS } from '../src/html-templates.js';

// P25-G pulled the inline <script> out of PUBLIC_HTML into its own PUBLIC_APP_JS
// constant, served as an external ?v=DEPLOY_VERSION route rather than inlined — the
// same code, just no longer embedded in the page markup itself.
const SCRIPT = PUBLIC_APP_JS;

function idsOf(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

describe('Serve redesign — assembled page is well-formed', () => {
  it('has exactly one #page-landing and one #page-market, both wired', () => {
    expect((PUBLIC_HTML.match(/id="page-landing"/g) || []).length).toBe(1);
    expect((PUBLIC_HTML.match(/id="page-market"/g) || []).length).toBe(1);
    expect((PUBLIC_HTML.match(/id="page-ministries"/g) || []).length).toBe(1);
  });

  it('has no duplicate element ids', () => {
    const ids = [...PUBLIC_HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const seen = new Set(); const dupes = [];
    for (const id of ids) { if (seen.has(id)) dupes.push(id); seen.add(id); }
    expect(dupes, 'duplicate ids: ' + dupes.join(', ')).toEqual([]);
  });

  it('every getElementById call the script makes (besides the retired drawer) targets a real id', () => {
    const ids = idsOf(PUBLIC_HTML);
    const referenced = [...SCRIPT.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
    const knownDead = new Set([
      'drawer-backdrop', 'menu-drawer', // hamburger removed by this redesign; openDrawer/closeDrawer null-check
      // sv-role-grid: created at runtime via innerHTML (svRenderRoleGroup, scripts.js) before
      // the getElementById call that reads it back — never present in the STATIC markup this
      // check scans, so it's a real false positive here, not a dangling reference. It only
      // ever looked "found" before P25-G because the inline <script> text (which literally
      // contains the string id="sv-role-grid") was itself part of PUBLIC_HTML; once the
      // script moved to its own external PUBLIC_APP_JS file that coincidence went away.
      'sv-role-grid',
    ]);
    const missing = referenced.filter(id => !ids.has(id) && !knownDead.has(id));
    expect(missing, 'missing ids: ' + missing.join(', ')).toEqual([]);
  });

  it('the extracted <script> is syntactically valid on its own (SC3-BUG1 class check)', () => {
    // new Function throws a SyntaxError synchronously for bad JS without executing it
    // (there is no DOM here, so we cannot run it — only confirm it parses).
    expect(() => new Function(SCRIPT)).not.toThrow();
  });

  it('the header nav is Volunteer / Christmas Market / Ministries, with a CTA outside the nav', () => {
    const headerMatch = PUBLIC_HTML.match(/<header class="sv-header"[\s\S]*?<\/header>/);
    expect(headerMatch).toBeTruthy();
    const header = headerMatch[0];
    expect(header).toMatch(/data-nav-page="landing">Volunteer</);
    expect(header).toMatch(/data-nav-page="market">Christmas Market</);
    expect(header).toMatch(/data-nav-page="ministries">Ministries</);
    expect(header).toMatch(/id="sv-header-cta"/);
  });

  it('the old hamburger drawer markup is gone', () => {
    expect(PUBLIC_HTML).not.toMatch(/class="menu-drawer"/);
    expect(PUBLIC_HTML).not.toMatch(/id="hamburger-btn"/);
  });
});

describe('Serve redesign — volunteer wizard', () => {
  it('has the three-step rail and all three step sections', () => {
    expect(PUBLIC_HTML).toMatch(/id="sv-steprail"/);
    expect(PUBLIC_HTML).toMatch(/id="sv-step1"/);
    expect(PUBLIC_HTML).toMatch(/id="sv-step2"/);
    expect(PUBLIC_HTML).toMatch(/id="sv-step3"/);
    expect(PUBLIC_HTML).toMatch(/id="sv-step-done"/);
  });

  it('step 1 asks for name and email, but not a service dropdown', () => {
    const step1 = PUBLIC_HTML.match(/<div class="sv-section" id="sv-step1">[\s\S]*?<\/div>\s*<div class="sv-section" id="sv-step2"/)[0];
    expect(step1).toMatch(/id="sv-name"/);
    expect(step1).toMatch(/id="sv-email"/);
    expect(step1).toMatch(/id="sv-phone"/);
    expect(step1).not.toMatch(/<select/);
  });

  it('links out to the Christmas Market from step 1', () => {
    expect(PUBLIC_HTML).toMatch(/data-nav-page="market">I'm here about the Christmas Market/);
  });

  it('defines all five category chips including Partner ministries', () => {
    expect(SCRIPT).toMatch(/key: 'worship',\s*label: 'Worship'/);
    expect(SCRIPT).toMatch(/key: 'education',\s*label: 'Christian Education'/);
    expect(SCRIPT).toMatch(/key: 'acceptance',\s*label: 'Acceptance'/);
    expect(SCRIPT).toMatch(/key: 'outreach',\s*label: 'Outreach'/);
    expect(SCRIPT).toMatch(/key: 'partner',\s*label: 'Partner ministries'/);
  });

  it('has three hardcoded partner-ministry roles (lasm, wol, cfna) since they have no ministry_roles rows', () => {
    expect(SCRIPT).toMatch(/ministry: 'lasm'/);
    expect(SCRIPT).toMatch(/ministry: 'wol'/);
    expect(SCRIPT).toMatch(/ministry: 'cfna'/);
  });

  it('tapping a role card both adds the role and advances to step 3 (svAddRoleFromCard ends in svGoStep(3))', () => {
    const fn = SCRIPT.match(/function svAddRoleFromCard\(idx\) \{[\s\S]*?\n\}/)[0];
    expect(fn.trim().endsWith('svGoStep(3);\n}')).toBe(true);
  });

  it('submits to /serve/signup with the picked roles as "Category: Role" labels', () => {
    const fn = SCRIPT.match(/function svSubmitWizard\(\)[\s\S]*?\n\}/)[0];
    expect(fn).toMatch(/fetch\('\/serve\/signup'/);
    expect(fn).toMatch(/r\.category \+ ': ' \+ r\.label/);
  });

  it('reset clears both state and the DOM field values', () => {
    const fn = SCRIPT.match(/function svReset\(\)[\s\S]*?\n\}/)[0];
    expect(fn).toMatch(/svState = \{/);
    expect(fn).toMatch(/el\.value = '';/);
  });
});

describe('Serve redesign — Christmas Market shift picker', () => {
  it('has the segmented by-job / by-time / by-day toggle', () => {
    expect(PUBLIC_HTML).toMatch(/data-mode="job"[^>]*>By job/);
    expect(PUBLIC_HTML).toMatch(/data-mode="time"[^>]*>By time/);
    expect(PUBLIC_HTML).toMatch(/data-mode="day"[^>]*>By day/);
  });

  it('has the contact card, summary panel, sticky bar and toast', () => {
    expect(PUBLIC_HTML).toMatch(/id="sv-mkt-you"/);
    expect(PUBLIC_HTML).toMatch(/id="mkt-summary"/);
    expect(PUBLIC_HTML).toMatch(/id="mkt-stickybar"/);
    expect(PUBLIC_HTML).toMatch(/id="mkt-toast"/);
  });

  it('links out to the real vendor application on timothystl.org, not a page in this app', () => {
    expect(PUBLIC_HTML).toMatch(/href="https:\/\/timothystl\.org\/christmasmarket\/vendors"/);
  });

  it('resolves the event by name, not a hardcoded id, and caches it', () => {
    const fn = SCRIPT.match(/function svMktEnsureEvent\(\)[\s\S]*?\n\}/)[0];
    expect(fn).toMatch(/e\.name === 'Christmas Market'/);
  });

  it('capacity is a real function of slots vs filled_count, not a placeholder', () => {
    expect(SCRIPT).toMatch(/function svMktIsFullServer\(r\) \{ return r\.slots > 0 && svMktAvailable\(r\) <= 0; \}/);
    expect(PUBLIC_HTML).not.toMatch(/placeholders? until the sign-up sheet is connected/i);
  });

  it('a full slot cannot be claimed unless it is already claimed by this user (undo stays available)', () => {
    const fn = SCRIPT.match(/function svMktToggleClaim\(role, flashEl\) \{[\s\S]*?\n\}/)[0];
    expect(fn).toMatch(/if \(svMktIsFullServer\(role\)\) return;/);
  });

  it('dedupes a claim by role id, so re-clicking the same slot undoes it', () => {
    const fn = SCRIPT.match(/function svMktToggleClaim\(role, flashEl\) \{[\s\S]*?\n\}/)[0];
    expect(fn).toMatch(/if \(s\.id === role\.id\) idx = i;/);
  });

  it('validation order: shift error is checked before the who-error, and a missing name scrolls+focuses', () => {
    const fn = SCRIPT.match(/function svMktSubmit\(\)[\s\S]*?\n\}/)[0];
    const shiftIdx = fn.indexOf('svMkt.shifts.length');
    const whoIdx = fn.indexOf('svMktValidateWho');
    expect(shiftIdx).toBeGreaterThan(-1);
    expect(whoIdx).toBeGreaterThan(shiftIdx);
    const whoFn = SCRIPT.match(/function svMktValidateWho\(\)[\s\S]*?\n\}/)[0];
    expect(whoFn).toMatch(/nameInput\.focus\(\);/);
  });

  it('submits event_id + role_ids (the real serve_roles ids) to /serve/signup', () => {
    const fn = SCRIPT.match(/function svMktSubmit\(\)[\s\S]*?\n\}/)[0];
    expect(fn).toMatch(/event_id: svMkt\.ev\.id/);
    expect(fn).toMatch(/role_ids: svMkt\.shifts\.map\(function\(s\) \{ return s\.id; \}\)/);
  });

  it('a direct visit to the market event via #event-<id> is redirected into #page-market, not the generic event page', () => {
    const fn = SCRIPT.match(/function openEventPage\(evId, replaceHistory\) \{[\s\S]*?\n {2}\}\);/)[0];
    expect(fn).toMatch(/ev\.name === 'Christmas Market'/);
    expect(fn).toMatch(/showPageAndLoad\('market'\)/);
  });
});

describe('Serve redesign — footer', () => {
  it('carries the real tagline and links back into the three top-level pages', () => {
    expect(PUBLIC_HTML).toMatch(/from our Neighborhood to the Nations/);
    expect(PUBLIC_HTML).toMatch(/class="sv-footer"/);
  });
});
