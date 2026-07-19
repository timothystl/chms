#!/usr/bin/env node
// Extracts the <script> blocks from the actual built CHMS_HTML and node --check's each one —
// this app's established technique (see SC3-BUG1/TAP2-BUG in NOTES.md) for catching a stray
// backtick/backslash inside one of the String.raw`...` frontend module templates, which is a
// silent-at-review, silent-at-`npm test`, break-the-whole-page-at-runtime class of bug.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const mod = await import(path.join(process.cwd(), 'src/html-chms.js'));
  const html = mod.CHMS_HTML;
  // CHMS_HTML itself only still has one truly-inline <script>...</script> left (the scheduler's
  // own embedded script) — the two big app chunks were split out into CHMS_APP_CORE_JS/
  // CHMS_APP_EXT_JS, served as external cacheable files instead of inlined (see
  // tlc-volunteer-worker.js /admin/app-core.js, /admin/app-ext.js), so they're checked here
  // directly rather than via the <script> regex, which no longer matches them at all (their
  // <script src="..."> tags carry an attribute, not a bare <script>).
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.push(mod.CHMS_APP_CORE_JS, mod.CHMS_APP_EXT_JS);
  if (!scripts.length) {
    console.error('::error::No <script> blocks found in CHMS_HTML — build output looks wrong.');
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chms-script-'));
  let failed = false;
  scripts.forEach((s, i) => {
    const file = path.join(dir, `block-${i}.js`);
    fs.writeFileSync(file, s);
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      console.log(`Built <script> block ${i}: OK`);
    } catch (e) {
      failed = true;
      console.error(`::error::Built <script> block ${i} failed to parse:\n${e.stderr}`);
    }
  });
  if (failed) process.exit(1);
  console.log(`All ${scripts.length} built <script> blocks parse cleanly.`);
})();
