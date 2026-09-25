import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { MOBILE_ADMIN_HTML } from '../src/mobile-admin-html.js';
import { LOGIN_HTML } from '../src/html-templates.js';
import { JS_PEOPLE } from '../src/frontend/js-people.js';
import { JS_CORE } from '../src/frontend/js-core.js';
import { HTML_TABS_1, HTML_TABS_2 } from '../src/frontend/html-tabs.js';

// OS1 (2026-09-25): Connect's staff shell moved onto Timothy Workspace v1.0 "Open Sky".
// These pin the parts of that foundation a later edit could quietly undo.

const STYLE = HTML_HEAD.slice(HTML_HEAD.indexOf('<style>'), HTML_HEAD.indexOf('</style>'));
const ROOT = STYLE.slice(STYLE.indexOf(':root{\n  /* ── Open Sky canonical colors'));
const rootBlock = ROOT.slice(0, ROOT.indexOf('\n}') + 2);

describe('OS1 — Open Sky tokens', () => {
  it('declares the canonical Open Sky colors', () => {
    const canonical = {
      '--primary': '#386781', '--primary-hover': '#2B5065', '--accent': '#C9973A',
      '--page': '#F3F7FA', '--surface': '#FFFFFF', '--text': '#293D49', '--muted': '#536B79',
      '--tint': '#DFEBF2', '--border': '#D7E2E9', '--control-border': '#718694',
      '--success': '#1A5C3E', '--warning': '#7A5A00', '--error': '#A12B24',
    };
    for (const [name, value] of Object.entries(canonical)) {
      expect(rootBlock, name).toMatch(new RegExp(name.replace(/-/g, '\\-') + ':' + value + '[;\\n]', 'i'));
    }
  });

  it('aliases the heavily-used legacy names onto Open Sky instead of old hex values', () => {
    for (const name of ['--color-navy', '--color-teal', '--warm-gray', '--linen', '--charcoal', '--steel-anchor', '--warm-white', '--danger']) {
      expect(rootBlock, name).toMatch(new RegExp('(^|[;{\\s])' + name + ':var\\(--'));
    }
  });

  it('uses Source Sans 3 and no longer loads the PAL1 fonts', () => {
    for (const html of [HTML_HEAD, LOGIN_HTML, MOBILE_ADMIN_HTML]) {
      expect(html).toContain('family=Source+Sans+3');
      expect(html).not.toMatch(/Cormorant|DM\+Sans|family=Lora/);
    }
  });
});

describe('OS1 — shell', () => {
  it('keeps the sidebar open on wide screens and makes it a drawer at the 1100px tier', () => {
    expect(STYLE).toMatch(/\.sidebar\{position:fixed;left:0;[^}]*width:var\(--sidebar-width\)/);
    expect(STYLE).toMatch(/\.content-area\{[^}]*margin-left:var\(--sidebar-width\)/);
    const drawer = STYLE.slice(STYLE.indexOf('@media(max-width:1100px){\n  .sidebar{'));
    expect(drawer).toMatch(/^@media\(max-width:1100px\)\{\n  \.sidebar\{left:calc\(/);
    expect(drawer.slice(0, 400)).toMatch(/\.content-area\{margin-left:0;\}/);
  });

  it('never fills the sidebar with navy', () => {
    expect(STYLE).toMatch(/\.sidebar\{[^}]*background:var\(--surface\)/);
  });

  it('keeps a visible 3px focus ring', () => {
    expect(STYLE).toContain(':focus-visible{outline:3px solid var(--focus);outline-offset:3px;}');
  });

  it('makes every sidebar destination keyboard-reachable', () => {
    const nav = HTML_HEAD.slice(HTML_HEAD.indexOf('<nav class="sidebar"'), HTML_HEAD.indexOf('</nav>'));
    const divItems = nav.match(/<div [^>]*class="s-item[^"]*"/g) || [];
    expect(divItems.length).toBeGreaterThan(10);
    for (const tag of divItems) expect(tag).toContain('tabindex="0"');
  });
});

// OS2/OS3 (2026-09-25): the People list and person page decisions made with Andrew.

describe('OS2 — People list', () => {
  it('retires the Card and Household views', () => {
    expect(HTML_TABS_1).not.toMatch(/p-view-card-btn|p-view-household-btn|id="p-card-grid"|id="p-hh-view"/);
    expect(JS_PEOPLE).not.toMatch(/function renderPeopleCards|function setPeopleViewMode/);
  });

  it('lists name, household, member type, phone and email', () => {
    for (const col of ["sortTh('Name'", "sortTh('Household'", "sortTh('Member type'", '>Phone</th>', '>Email</th>']) {
      expect(JS_PEOPLE).toContain(col);
    }
  });

  it('shows member type as plain text, not a colored dot', () => {
    const fn = JS_CORE.slice(JS_CORE.indexOf('function typeDotHtml'), JS_CORE.indexOf('function typeDotHtml') + 400);
    expect(fn).not.toContain('type-dot');
    expect(fn).toContain('type-label');
  });

  it('keeps the preview hidden until someone is chosen', () => {
    expect(HTML_TABS_1).toMatch(/class="ppl-quickview is-empty" id="ppl-quickview"/);
  });
});

describe('OS3 — person page', () => {
  it('edits by section with one Save, not field by field', () => {
    expect(JS_PEOPLE).toContain('function pvfSectionEdit');
    expect(JS_PEOPLE).toContain('function pvfSectionSave');
    expect(JS_PEOPLE).not.toContain('function pvfStart');
  });

  it('has a More actions menu and no Attendance tab', () => {
    expect(JS_PEOPLE).toContain('function pvMoreActionsHtml');
    expect(HTML_TABS_2 + HTML_TABS_1).not.toContain('id="ptab-attendance"');
  });

  it('adds a person through the short form, extra sections hidden', () => {
    const all = HTML_TABS_1 + HTML_TABS_2;
    expect(all).toMatch(/id="pm-dates-section" class="pm-extra"/);
    expect(STYLE).toContain('#person-modal:not(.pm-full) .pm-extra{display:none!important;}');
  });
});

// OS5 (2026-09-25): Home leads with Sunday attendance entry and the month's birthdays,
// anniversaries and baptism anniversaries (listed, copyable, printable). Every section collapses.

import { JS_DASHBOARD } from '../src/frontend/js-dashboard.js';
import { JS_ATTENDANCE } from '../src/frontend/js-attendance.js';

describe('OS5 — Home', () => {
  it('puts attendance entry and the month lists first, then the older panels', () => {
    const render = JS_DASHBOARD.slice(JS_DASHBOARD.indexOf('function renderDashboard'));
    const order = ["dashSection('att'", "dashSection('month'", "dashSection('glance'", "dashPanel('weeklyTasks'"];
    const at = order.map((s) => render.indexOf(s));
    at.forEach((i, n) => expect(i, order[n]).toBeGreaterThan(-1));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('opens attendance and the month lists by default and remembers each section', () => {
    expect(JS_DASHBOARD).toMatch(/DASH_OPEN_DEFAULTS = \{att:true, month:true, bd:true, ann:true, bap:true/);
    expect(JS_DASHBOARD).toContain("localStorage.setItem('dashOpen'");
    expect(JS_DASHBOARD).toContain('aria-expanded');
  });

  it('prints and copies the month lists without emoji', () => {
    expect(JS_DASHBOARD).toContain('function dashPrintMonth');
    expect(JS_DASHBOARD).toContain('Copy for bulletin');
    expect(JS_DASHBOARD).not.toContain('&#128203;');
    expect(JS_DASHBOARD).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('saves Home attendance through the Attendance tab writer', () => {
    expect(JS_DASHBOARD).toContain('attSaveSunday(ds, a8, a1045, row)');
    expect(JS_ATTENDANCE).toMatch(/function attSaveEntry\(\) \{[\s\S]*?attSaveSunday\(date, a8, a1045/);
  });
});

describe('OS5 — attSaveSunday', () => {
  function load() {
    const calls = [];
    const api = (url, opts) => { calls.push([url, opts && opts.method, opts && JSON.parse(opts.body)]); return Promise.resolve({}); };
    const fn = new Function('api', '_loadedServices', JS_ATTENDANCE + '\nreturn { attSaveSunday, attSundayMap };');
    return { calls, ...fn(api, []) };
  }

  it('creates both services in one call for a new Sunday', async () => {
    const { calls, attSaveSunday } = load();
    await attSaveSunday('2026-09-20', 90, 140, undefined);
    expect(calls).toEqual([['/admin/api/attendance/bulk-sunday', 'POST', { service_date: '2026-09-20', service_name: '', att_8: 90, att_1045: 140 }]]);
  });

  it('updates recorded services in place and adds the missing one', async () => {
    const { calls, attSaveSunday, attSundayMap } = load();
    const map = attSundayMap([{ id: 7, service_type: 'sunday', service_date: '2026-09-20', service_time: '08:00', attendance: 80, service_name: 'Pentecost 17' }]);
    await attSaveSunday('2026-09-20', 91, 150, map['2026-09-20']);
    expect(calls).toEqual([
      ['/admin/api/attendance/7', 'PUT', { attendance: 91 }],
      ['/admin/api/attendance', 'POST', { service_date: '2026-09-20', service_time: '10:45', service_name: 'Pentecost 17', service_type: 'sunday', attendance: 150 }],
    ]);
  });

  it('rejects when any write fails', async () => {
    const fn = new Function('api', '_loadedServices', JS_ATTENDANCE + '\nreturn attSaveSunday;');
    const save = fn((url) => url.endsWith('/7') ? Promise.reject(new Error('nope')) : Promise.resolve({}), []);
    await expect(save('2026-09-20', 1, 2, { id8: 7, id1045: 8, name: '' })).rejects.toThrow('nope');
  });
});
