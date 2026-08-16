// ── Scheduler inline embed helper ───────────────────────────────────────────
// Transforms SCHEDULER_HTML for direct embedding inside the ChMS SPA.
// Returns a string containing: <style>(scoped CSS)</style>
//                              <div class="sched-root">…HTML…</div>
//                              <script>…transformed JS…</script>
//
// Called once at module load time; result is cached.
//
// getSchedulerInlineParts() exposes the same three pieces separately so the
// ~321KB bundle can be served as two long-cached assets and fetched only when
// someone actually opens the Scheduler tab (which is admin-only, so most
// sessions never load it at all) instead of being inlined into every single
// page load. getSchedulerInline() still composes them exactly as before, so
// the embedded-markup shape is defined in one place, not duplicated.
import { SCHEDULER_HTML } from './scheduler-html.js';

let _cached = null;
let _cachedParts = null;

export function getSchedulerInline() {
  const p = getSchedulerInlineParts();
  if (!_cached) _cached = `${p.markup}\n<script>\n${p.js}\n</script>`;
  return _cached;
}

// { markup, js } — `markup` is the <style> block plus the .sched-root subtree
// (safe to drop straight into an element's innerHTML; a <style> inserted that
// way is applied by the browser, whereas a <script> would NOT execute — which
// is exactly why the JS is kept separate and loaded via its own <script src>).
export function getSchedulerInlineParts() {
  if (!_cachedParts) _cachedParts = _build();
  return _cachedParts;
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

  // Always show schedule-output in embedded mode — auth is already handled by ChMS,
  // so there's no login gate. The empty state ("No schedule generated yet") is always
  // better than an invisible area. JS would set display:block after d1Pull() but that
  // path is fragile (inside try/catch; d1Pull() may be async or throw).
  html = html.replace(
    /(<div class="card" id="schedule-output") style="display:none;"/,
    '$1'
  );

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

  return {
    markup: `<style>\n${css}\n</style>\n<div class="sched-root">\n${body}\n</div>`,
    js,
  };
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

  // 3c. Force window.location.origin as base in breezeGet/breezePost so a
  //     misconfigured workerUrl never routes Breeze proxy calls to the wrong host.
  js = js.replace(
    /\(s\.workerUrl \|\| window\.location\.origin\)\.replace/g,
    'window.location.origin.replace'
  );

  // 3d. Relax the apiKey required guard — in inline context the server holds
  //     the Breeze API key via env var; the settings field will always be blank.
  js = js.replace(
    "if (!subdomain||!apiKey) { showAlert('settings-alert','Please enter both subdomain and API key.','warning'); return; }",
    "if (!subdomain) { showAlert('settings-alert','Please enter your Breeze subdomain.','warning'); return; }"
  );

  // 4. Rename functions that collide with ChMS globals.
  //    Use \bNAME\b (not \bNAME\() so we also catch callback references like
  //    addEventListener('click', savePerson) — those are bare identifier
  //    references with no parentheses; missing them leaves a ReferenceError
  //    at script load time that halts every subsequent addEventListener.
  js = js.replace(/\bfmtDate\b/g,      'schedFmtDate');
  js = js.replace(/\bshowTab\b/g,      'schedShowTab');
  js = js.replace(/\bsavePerson\b/g,   'schedSavePerson');
  js = js.replace(/\bdeletePerson\b/g, 'schedDeletePerson');
  // AVATAR_TINTS/avatarTint (Focus Week redesign, added 2026-07-06): ChMS's own
  // js-core.js defines identically-named globals for its People list (keyed by
  // NUMERIC D1 ids via Math.abs(id||0)). Because ChMS's <script> executes after
  // the scheduler's in the concatenated page, its version silently overwrites
  // the scheduler's — and the scheduler's person ids are client-generated
  // STRINGS (makeId()), so Math.abs(stringId) is NaN and the array lookup
  // returns undefined, crashing every avatar render ("Cannot read properties
  // of undefined (reading 'ring')") the moment the embedded tab loads.
  js = js.replace(/\bAVATAR_TINTS\b/g, 'SCHED_AVATAR_TINTS');
  js = js.replace(/\bavatarTint\b/g,   'schedAvatarTint');

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
     + '  try {\n'
     + '    var _ml = document.getElementById(\'sched-current-month-label\');\n'
     + '    if (_ml) _ml.textContent = monthKeyLabel(currentMonthKey);\n'
     + '  } catch(e) {}\n'
     + '  try {\n'
     + '    if (typeof renderFocusWeek === \'function\') renderFocusWeek();\n'
     + '    var _so = document.getElementById(\'schedule-output\');\n'
     + '    if (_so) _so.style.display = \'block\';\n'
     + '  } catch(e) {}\n'
     + '  var _cfgFetch = fetch(\'/admin/api/scheduler/config\', {credentials:\'include\'})\n'
     + '    .then(function(r) { return r.ok ? r.json() : {}; }).catch(function() { return {}; });\n'
     + '  var _d1Fetch = (typeof d1Pull === \'function\') ? d1Pull() : Promise.resolve();\n'
     + '  Promise.all([_cfgFetch, _d1Fetch]).then(function(res) {\n'
     + '    var cfg = res[0];\n'
     + '    try {\n'
     + '      var _s = getBreezeSettings();\n'
     + '      if (cfg.subdomain) _s.subdomain = cfg.subdomain;\n'
     + '      if (cfg.emailFrom) _s.emailFrom = cfg.emailFrom;\n'
     + '      if (cfg.workerUrl) _s.workerUrl = cfg.workerUrl;\n'
     + '      if (Array.isArray(cfg.tagIds) && cfg.tagIds.length && !(_s.tagIds && _s.tagIds.length)) _s.tagIds = cfg.tagIds;\n'
     + '      if (cfg.replyTo && !_s.replyTo) _s.replyTo = cfg.replyTo;\n'
     + '      _esvConfigured = !!cfg.hasEsvApiKey;\n'
     + '      if (typeof renderReminderEsvBlock === \'function\') renderReminderEsvBlock();\n'
     + '      saveBreezeSettings(_s);\n'
     + '      if (typeof loadSettingsForm === \'function\') loadSettingsForm();\n'
     + '      var _missing = \'<span style="color:#b03a2e;font-style:italic;font-weight:400;">(not configured)</span>\';\n'
     + '      var _esc = function(s) { return String(s||\'\').replace(/[&<>"]/g, function(c) { return ({\'&\':\'&amp;\',\'<\':\'&lt;\',\'>\':\'&gt;\',\'"\':\'&quot;\'})[c]; }); };\n'
     + '      var _ok  = function(label) { return \'<span style="color:#2e7d32;font-weight:600;">&#128274; \' + label + \'</span>\'; };\n'
     + '      var _bad = function(label) { return \'<span style="color:#b03a2e;font-weight:600;">&#10007; \' + label + \'</span>\'; };\n'
     + '      var _ds = document.getElementById(\'sdisp-subdomain\');\n'
     + '      if (_ds) _ds.innerHTML = cfg.subdomain ? _esc(cfg.subdomain + \'.breezechms.com\') : _missing;\n'
     + '      var _dw = document.getElementById(\'sdisp-workerurl\');\n'
     + '      if (_dw) _dw.innerHTML = cfg.workerUrl ? _esc(cfg.workerUrl) : _missing;\n'
     + '      var _df = document.getElementById(\'sdisp-emailfrom\');\n'
     + '      if (_df) _df.innerHTML = cfg.emailFrom ? _esc(cfg.emailFrom) : _missing;\n'
     + '      var _bk = document.getElementById(\'sdisp-breezekey\');\n'
     + '      if (_bk) _bk.innerHTML = cfg.hasBreezeApiKey ? _ok(\'configured on server\') : _bad(\'not configured\');\n'
     + '      var _ws = document.getElementById(\'sdisp-workersecret\');\n'
     + '      if (_ws) _ws.innerHTML = cfg.hasWorkerSecret ? _ok(\'configured on server\') : _bad(\'not configured\');\n'
     + '      var _rk = document.getElementById(\'sdisp-resendkey\');\n'
     + '      if (_rk) _rk.innerHTML = cfg.hasResendKey ? _ok(\'configured on server\') : _bad(\'not configured\');\n'
     + '    } catch(e) {}\n'
     + '    document.querySelectorAll(\'.sunday-detail\').forEach(function(tr) { tr.style.display=\'none\'; });\n'
     + '    if (typeof syncConfirmations === \'function\') syncConfirmations(true);\n'
     + '  }).catch(function(){});\n'
     + '  if (typeof fetchPendingSignups === \'function\') fetchPendingSignups();\n'
     + '  if (typeof fetchGeneralVolunteers === \'function\') fetchGeneralVolunteers();\n'
     + '  if (typeof fetchEventVolunteers === \'function\') fetchEventVolunteers();\n'
     + '};\n';
  js = _schedInitCode + '\n' + js;

  return js;
}
