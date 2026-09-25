import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { MOBILE_ADMIN_HTML } from '../src/mobile-admin-html.js';
import { LOGIN_HTML } from '../src/html-templates.js';

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
