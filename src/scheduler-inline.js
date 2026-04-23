// ── Scheduler inline embed helper ───────────────────────────────────────────
// Transforms SCHEDULER_HTML for direct embedding inside the ChMS SPA.
// Returns a string containing: <style>(scoped CSS)</style>
//                              <div class="sched-root">…HTML…</div>
//                              <script>…transformed JS…</script>
//
// Called once at module load time; result is cached.
import { SCHEDULER_HTML } from './scheduler-html.js';

let _cached = null;

export function getSchedulerInline() {
  if (!_cached) _cached = _build();
  return _cached;
}

function _build() {
  let raw = SCHEDULER_HTML;

  // ── 1. CSS ──────────────────────────────────────────────────────────────
  const cssMatch = raw.match(/<style>([\s\S]*?)<\/style>/);
  const css = cssMatch ? _scopeCss(cssMatch[1]) : '';

  // ── 2. HTML ─────────────────────────────────────────────────────────────
  // Drop login-screen (just a "Checking authentication…" placeholder)
  let html = raw.replace(/<div id="login-screen"[\s\S]*?<\/div>\s*\n/, '');

  // app-content: remove display:none, rename ID so it doesn't conflict with ChMS
  html = html.replace(
    /<div id="app-content" style="display:none;">/,
    '<div id="sched-app-content">'
  );

  // Drop the standalone page header (logo + nav links — redundant inside ChMS)
  html = html.replace(/<header>[\s\S]*?<\/header>\n?/, '');

  // Rename IDs that duplicate ChMS's own IDs
  html = html.replace(/id="current-month-label"/g, 'id="sched-current-month-label"');
  html = html.replace(/id="(tab-(?:people|schedule|stats|settings))"/g,     'id="sched-$1"');
  html = html.replace(/id="(tab-btn-(?:people|schedule|stats|settings))"/g, 'id="sched-$1"');

  // Extract just the app-content subtree
  const bodyMatch = html.match(/<div id="sched-app-content">[\s\S]*?<\/div><!-- \/#app-content -->/);
  const body = bodyMatch ? bodyMatch[0] : '';

  // ── 3. JS ────────────────────────────────────────────────────────────────
  const jsMatch = raw.match(/<script>([\s\S]*?)<\/script>/);
  const js = jsMatch ? _transformJs(jsMatch[1]) : '';

  return `<style>\n${css}\n</style>\n<div class="sched-root">\n${body}\n</div>\n<script>\n${js}\n</script>`;
}

// ── CSS transformer ──────────────────────────────────────────────────────────

function _scopeCss(css) {
  const SCOPE = '.sched-root';

  // Drop :root block — ChMS already declares the same CSS custom properties
  css = css.replace(/:root\s*\{[^}]*\}/s, '');

  // Drop body.embedded rules — we're always "embedded" in SC2
  css = css.replace(/body\.embedded[^{]*\{[^}]*\}\n?/g, '');

  return _prefixSelectors(css, SCOPE);
}

// Stateful CSS selector prefixer.
// Handles: regular rules, @media (nested), @keyframes (inner selectors skipped).
function _prefixSelectors(css, scope) {
  let result = '';
  let i = 0;
  let depth = 0;
  let inKeyframes = false;

  while (i < css.length) {
    const nextOpen  = css.indexOf('{', i);
    const nextClose = css.indexOf('}', i);

    if (nextOpen === -1 && nextClose === -1) {
      result += css.slice(i);
      break;
    }

    // Closing brace comes first — emit it and decrease depth
    if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
      result += css.slice(i, nextClose + 1);
      i = nextClose + 1;
      if (depth > 0) depth--;
      if (depth === 0) inKeyframes = false;
      continue;
    }

    // Opening brace is next
    const before      = css.slice(i, nextOpen);
    const trimmed     = before.trim();
    const leadingWs   = before.match(/^(\s*)/)[0];

    if (!trimmed) {
      // Empty / whitespace-only — keep as-is (closing of @-rule wrapper, etc.)
      result += before + '{';
    } else if (inKeyframes || depth > 1) {
      // Inside @keyframes or deeply nested: don't prefix
      result += before + '{';
    } else if (trimmed.startsWith('@')) {
      if (/^@keyframes/.test(trimmed)) inKeyframes = true;
      result += before + '{';
    } else {
      // Regular CSS selectors at top-level or inside @media — prefix each part
      const scoped = trimmed.split(',').map(function(s) {
        const st = s.trim();
        if (!st) return '';
        if (st === 'body')            return scope;
        if (st === '*')               return scope + ' *';
        if (st.startsWith('body.'))   return scope + st.slice(4);  // body.foo → .sched-root.foo
        if (st.startsWith('body '))   return scope + ' ' + st.slice(5);
        if (st.startsWith('body:'))   return scope + st.slice(4);
        return scope + ' ' + st;
      }).filter(Boolean).join(', ');
      result += leadingWs + scoped + ' {';
    }

    i = nextOpen + 1;
    depth++;
  }

  return result;
}

// ── JS transformer ───────────────────────────────────────────────────────────

function _transformJs(js) {
  // 1. Hard-code _embedded = true (replaces the iframe / body-class detection block)
  js = js.replace(
    /\/\/ ── Embedded mode detection ──[\s\S]*?if \(_embedded\) document\.body\.classList\.add\('embedded'\);/,
    'var _embedded = true;'
  );

  // 2. Drop esc() — ChMS already exposes an identical global esc()
  js = js.replace(/function esc\(s\) \{[^}]*\}/, '');

  // 3. Fix relative URL — without <base href="/scheduler/">, this would 404
  js = js.replace("fetch('lcms_calendar.json')", "fetch('/scheduler/lcms_calendar.json')");

  // 4. Rename functions that collide with ChMS globals
  js = js.replace(/function fmtDate\(/g,    'function schedFmtDate(');
  js = js.replace(/\bfmtDate\(/g,           'schedFmtDate(');
  js = js.replace(/function showTab\(/g,    'function schedShowTab(');
  js = js.replace(/\bshowTab\(/g,           'schedShowTab(');
  js = js.replace(/function savePerson\(/g, 'function schedSavePerson(');
  js = js.replace(/\bsavePerson\(/g,        'schedSavePerson(');
  js = js.replace(/function deletePerson\(/g, 'function schedDeletePerson(');
  js = js.replace(/\bdeletePerson\(/g,       'schedDeletePerson(');

  // 5. Fix dynamic tab ID construction to match renamed HTML IDs
  js = js.replace(/'tab-btn-' \+ t/g, "'sched-tab-btn-' + t");
  js = js.replace(/'tab-' \+ t/g,     "'sched-tab-' + t");

  // 6. Fix hardcoded getElementById calls for renamed IDs
  js = js.replace(/getElementById\('current-month-label'\)/g, "getElementById('sched-current-month-label')");
  js = js.replace(/getElementById\('app-content'\)/g,         "getElementById('sched-app-content')");

  // 7. Remove the top-level checkAuth() call — it will be deferred to schedInitScheduler
  js = js.replace(/^checkAuth\(\);\n/m, '');

  // 8. Wrap the INIT block (+ checkAuth call) in window.schedInitScheduler so ChMS
  //    controls when data loading begins (on first tab visit, not on page load).
  js = js.replace(
    /(\/\/ [^\n]+\n\/\/ INIT\n\/\/ [^\n]+\n)([\s\S]*?)(\/\/ [^\n]+\n\/\/ SCHEDULE HISTORY)/,
    '$1window.schedInitScheduler = function() {\n  if (window._schedInited) return;\n  window._schedInited = true;\n  checkAuth();\n$2};\n\n$3'
  );

  return js;
}
