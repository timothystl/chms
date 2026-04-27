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

  let scoped = _prefixSelectors(css, SCOPE);

  // Safety overrides: side panels and the overlay are position:fixed; inset:0
  // (or right:0; height:100vh) with z-index 300/301. They sit above the schedule
  // table and month-nav buttons. CSS transforms push closed panels offscreen
  // visually but their hit-test boxes can still intercept clicks in some
  // engines (or whenever a panel is briefly mid-transition). Force
  // pointer-events:none unless explicitly opened.
  scoped += '\n'
    + SCOPE + ' .side-panel { pointer-events: none; }\n'
    + SCOPE + ' .side-panel.open { pointer-events: auto; }\n'
    + SCOPE + ' .panel-overlay { pointer-events: none; }\n'
    + SCOPE + ' .panel-overlay.open { pointer-events: auto; }\n';

  return scoped;
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
    // Strip CSS comments from the selector text — comments inside selectors are
    // invalid per CSS2.1 and cause the entire rule to be silently ignored.
    const trimmed     = before.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
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

  // 2. Keep scheduler's own esc(). The scheduler <script> runs at page load
  //    BEFORE ChMS's <script> defines its own esc(). Several scheduler init
  //    callbacks (renderPeopleList, loadSchedule → renderTable) call esc()
  //    immediately. Dropping the scheduler's definition would make those
  //    throw ReferenceError at load (harmless via _safeInit catch, but it
  //    pollutes the console and skips the initial paint). ChMS's later
  //    function declaration will overwrite this one — both versions are
  //    functionally equivalent (HTML entity escape).

  // 3. Fix relative URL — without <base href="/scheduler/">, this would 404
  js = js.replaceAll("fetch('lcms_calendar.json')", "fetch('/scheduler/lcms_calendar.json')");

  // 3b. Strip workerUrl prefix from fetch() calls. The scheduler historically
  //     lived at volunteer.timothystl.org and stored that as workerUrl. Now
  //     that everything runs in the same Worker, fetch calls must be
  //     same-origin or CSP (connect-src 'self') will block them. The
  //     workerUrl setting is still preserved for email body links (which
  //     need full URLs so volunteers can click from their inbox).
  js = js.replace(/fetch\(\s*s\.workerUrl\s*\+\s*/g,         "fetch(");
  js = js.replace(/fetch\(\s*settings\.workerUrl\s*\+\s*/g,  "fetch(");

  // 4. Rename functions that collide with ChMS globals.
  //    Use \bNAME\b (not \bNAME\() so we also catch callback references like
  //    addEventListener('click', savePerson) — those are bare identifier
  //    references with no parentheses; missing them leaves a ReferenceError
  //    at script load time that halts every subsequent addEventListener.
  js = js.replace(/\bfmtDate\b/g,      'schedFmtDate');
  js = js.replace(/\bshowTab\b/g,      'schedShowTab');
  js = js.replace(/\bsavePerson\b/g,   'schedSavePerson');
  js = js.replace(/\bdeletePerson\b/g, 'schedDeletePerson');

  // 5. Fix dynamic tab ID construction to match renamed HTML IDs
  js = js.replace(/'tab-btn-' \+ t/g, "'sched-tab-btn-' + t");
  js = js.replace(/'tab-' \+ t/g,     "'sched-tab-' + t");

  // 6. Fix hardcoded getElementById calls for renamed IDs
  js = js.replace(/getElementById\('current-month-label'\)/g, "getElementById('sched-current-month-label')");
  js = js.replace(/getElementById\('app-content'\)/g,         "getElementById('sched-app-content')");

  // 7. Remove the top-level checkAuth() call — deferred to schedInitScheduler below.
  js = js.replace(/^checkAuth\(\);\n/m, '');

  // 8. Prepend schedInitScheduler at the START of the transformed script.
  //    The scheduler JS has many top-level addEventListener registrations that run at
  //    page load. If any getElementById call returns null (element out of DOM),
  //    a TypeError would halt execution before an appended schedInitScheduler could
  //    be reached. Prepending ensures it is defined before any top-level code runs.
  //    schedInitScheduler calls d1Pull() directly (avoids checkAuth() indirection
  //    which is unnecessary — the user is already authenticated in ChMS). It also
  //    sets the month label in case the page-load INIT try/catch swallowed an error.
  // 9. Replace CSS-class-based .sunday-detail visibility with explicit inline style.
  //    The scheduler's <style> tag lives inside a .tab-panel that starts display:none;
  //    some browsers may apply those rules lazily or with unexpected specificity when
  //    the panel becomes visible. Using style.display directly is unambiguous.
  js = js.replace(
    /tr\.classList\.remove\('visible'\);/g,
    "tr.style.display='none';"
  );
  js = js.replace(
    /tr\.classList\.add\('visible'\);/g,
    "tr.style.display='table-row';"
  );
  js = js.replace(
    /tr\.classList\.toggle\('visible', isExpanded\);/g,
    "tr.style.display=isExpanded?'table-row':'none';"
  );

  const _schedInitCode = 'window.schedInitScheduler = function() {\n'
     + '  if (window._schedInited) return;\n'
     + '  window._schedInited = true;\n'
     + '  // Click-blocking belt-and-suspenders: scope-prefixed rules now also live\n'
     + '  // in the appended <style> ensuring closed side-panels and the closed overlay\n'
     + '  // pass clicks through (their position:fixed; height:100vh hit-test region can\n'
     + '  // still absorb clicks in some scenarios). When a panel opens, the .open rule\n'
     + '  // restores pointer-events:auto so background clicks close it normally.\n'
     + '  try {\n'
     + '    var _ml = document.getElementById(\'sched-current-month-label\');\n'
     + '    if (_ml) _ml.textContent = monthKeyLabel(currentMonthKey);\n'
     + '  } catch(e) {}\n'
     + '  if (typeof d1Pull === \'function\') {\n'
     + '    d1Pull().then(function() {\n'
     + '      document.querySelectorAll(\'.sunday-detail\').forEach(function(tr) { tr.style.display=\'none\'; });\n'
     + '      if (typeof syncConfirmations === \'function\') syncConfirmations(true);\n'
     + '    }).catch(function(){});\n'
     + '  }\n'
     + '  if (typeof fetchPendingSignups === \'function\') fetchPendingSignups();\n'
     + '  if (typeof fetchGeneralVolunteers === \'function\') fetchGeneralVolunteers();\n'
     + '  if (typeof fetchEventVolunteers === \'function\') fetchEventVolunteers();\n'
     + '};\n';
  js = _schedInitCode + '\n' + js;

  return js;
}
