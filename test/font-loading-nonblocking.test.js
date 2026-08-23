import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { LOGIN_HTML } from '../src/html-templates.js';

// P25-C (LOAD5/CR2/AU2): the app shell's Google Fonts <link> was a plain blocking
// stylesheet request with no preconnect at all, for 3 families at 17 weight/italic
// combinations — on a slow/filtered network this stalls first paint of the whole app the
// same way it stalled the login page (AU2's original report). The login page's own font
// link had the identical shape. Both now preconnect and load the stylesheet
// non-blockingly (media="print" + onload swap, with a <noscript> fallback).

function assertNonBlockingFontLoad(html, label) {
  expect(html, label).toMatch(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/);
  expect(html, label).toMatch(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
  // The real, render-visible stylesheet link must not block rendering: it starts as
  // print-only and swaps to all media once loaded, rather than a bare rel="stylesheet"
  // with no media/onload. Scoped to BEFORE <noscript> — the noscript fallback is
  // deliberately a plain blocking link, since there's no JS there to swap it in later.
  const beforeNoscript = html.slice(0, html.indexOf('<noscript><link'));
  expect(beforeNoscript, label).not.toMatch(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/);
  const nonBlockingLink = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet" media="print" onload="this\.media='all'">/;
  expect(beforeNoscript, label).toMatch(nonBlockingLink);
  // A <noscript> fallback so fonts still load with JS disabled.
  expect(html, label).toMatch(/<noscript><link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet"><\/noscript>/);
}

describe('font loading is non-blocking with a preconnect (P25-C)', () => {
  it('the app shell head preconnects and loads fonts non-blockingly', () => {
    assertNonBlockingFontLoad(HTML_HEAD, 'HTML_HEAD');
  });

  it('the login page preconnects and loads fonts non-blockingly', () => {
    // LOGIN_HTML is a plain (non-String.raw) template literal interpolating DEPLOY_VERSION;
    // render it with a dummy version so the JS itself doesn't need to be re-evaluated here.
    assertNonBlockingFontLoad(LOGIN_HTML, 'LOGIN_HTML');
  });

  it('preconnect appears before the stylesheet link, not after', () => {
    // A preconnect hint only helps if the browser sees it before it needs the connection —
    // placed after the stylesheet link it can't shave any time off that request.
    for (const [html, label] of [[HTML_HEAD, 'HTML_HEAD'], [LOGIN_HTML, 'LOGIN_HTML']]) {
      const preconnectIdx = html.indexOf('<link rel="preconnect" href="https://fonts.googleapis.com">');
      const stylesheetIdx = html.indexOf('rel="stylesheet" media="print"');
      expect(preconnectIdx, label).toBeGreaterThan(-1);
      expect(stylesheetIdx, label).toBeGreaterThan(-1);
      expect(preconnectIdx, label).toBeLessThan(stylesheetIdx);
    }
  });
});
