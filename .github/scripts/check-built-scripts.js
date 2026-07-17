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
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
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
