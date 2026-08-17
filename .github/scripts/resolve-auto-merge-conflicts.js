#!/usr/bin/env node
// Auto-resolves ONLY the two conflict shapes that recur when multiple claude/** branches land
// close together (see NOTES.md's "don't run two claude/** branches editing shared files at once"
// note): the DEPLOY_VERSION line in src/frontend/js-core.js, and pure top-of-changelog insertions
// in NOTES.md/CLAUDE.md. Any other conflicted file, or an unrecognized conflict shape in one of
// these three files, exits non-zero — the calling workflow step then fails the job instead of
// pushing a guessed resolution to main. See auto-merge-claude.yml for the full rationale.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');

const ALLOWED_FILES = new Set(['src/frontend/js-core.js', 'NOTES.md', 'CLAUDE.md']);
const CONFLICT_HUNK = /^<<<<<<< [^\n]*\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> [^\n]*$/gm;

function fail(msg) {
  console.error('::error::' + msg);
  process.exit(1);
}


// The declaration is captured from the conflicting side and REBUILT, never
// retyped. js-core.js declares this as `export const DEPLOY_VERSION` — an
// earlier version of this script wrote back a bare `var DEPLOY_VERSION`, which
// silently removed the named export, so every importer got `undefined` and the
// asset-cache and service-worker tests failed on a branch whose own diff was
// fine. (The `var` form does appear in this file, but inside the JS_CORE
// template literal, which is a different line and never the conflicted one.)
const VERSION_LINE = /^([ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+DEPLOY_VERSION[ \t]*=[ \t]*)'([\d.]+)'([ \t]*;[ \t]*)$/;

function parseVersionSide(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length !== 1) return null;      // more than the version line — not this shape
  const m = VERSION_LINE.exec(lines[0]);
  return m ? { prefix: m[1], version: m[2], suffix: m[3] } : null;
}

function resolveVersionFile(path) {
  const src = fs.readFileSync(path, 'utf8');
  const hunks = [...src.matchAll(CONFLICT_HUNK)];
  if (!hunks.length) fail(`${path} is marked conflicted but no conflict markers were found.`);
  let out = src;
  for (const hunk of hunks) {
    const [whole, ours, theirs] = hunk;
    const o = parseVersionSide(ours), t = parseVersionSide(theirs);
    if (!o || !t) fail(`${path}: conflict hunk doesn't look like a DEPLOY_VERSION collision — refusing to guess.\n${whole}`);
    const bumped = bumpPatch(maxVersion(o.version, t.version));
    out = out.replace(whole, `${o.prefix}'${bumped}'${o.suffix}`);
  }
  // Checks the property that matters — it is still a named export — without
  // pinning the exact spacing, so reformatting that line is not a merge failure.
  if (!/^\s*export\s+const\s+DEPLOY_VERSION\s*=\s*'[\d.]+'\s*;/m.test(out)) {
    fail(`${path}: the resolved file no longer exports DEPLOY_VERSION — refusing to push a build that imports undefined.`);
  }
  fs.writeFileSync(path, out);
  console.log(`Resolved ${path}: DEPLOY_VERSION -> bumped patch above both sides.`);
}

function maxVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? a : b;
  }
  return a;
}
function bumpPatch(v) {
  const p = v.split('.').map(Number);
  p[2] = (p[2] || 0) + 1;
  return p.join('.');
}

// Both sides adding a new "### ..." entry directly under "## Recent Changes (newest first)" —
// keep both, incoming branch's entry first (it's the one just landing). Only handles a single
// conflict hunk that is a pure two-sided insertion (neither side's block is empty) — anything
// else (e.g. an actual edit to the same existing line) isn't this shape and should fail instead.
function resolveChangelogFile(path) {
  const src = fs.readFileSync(path, 'utf8');
  const hunks = [...src.matchAll(CONFLICT_HUNK)];
  if (!hunks.length) fail(`${path} is marked conflicted but no conflict markers were found.`);
  let out = src;
  for (const hunk of hunks) {
    const [whole, ours, theirs] = hunk;
    if (!ours.trim() || !theirs.trim()) fail(`${path}: one side of the conflict is empty — not a pure insertion, refusing to guess.\n${whole}`);
    out = out.replace(whole, `${theirs}\n${ours}`);
  }
  fs.writeFileSync(path, out);
  console.log(`Resolved ${path}: kept both changelog entries (incoming branch's entry first).`);
}

function main() {
  const conflicted = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);

  if (!conflicted.length) fail('Merge reported conflicts but git diff --diff-filter=U found none — unexpected state.');

  for (const f of conflicted) {
    if (!ALLOWED_FILES.has(f)) fail(`Conflict in ${f} is outside the auto-resolvable set (${[...ALLOWED_FILES].join(', ')}) — needs a human to merge this branch.`);
  }

  for (const f of conflicted) {
    if (f === 'src/frontend/js-core.js') resolveVersionFile(f);
    else resolveChangelogFile(f);
  }

  // Check the actual file content for leftover markers, not git's index state — the index still
  // shows these paths as "unmerged" until `git add` runs below, regardless of whether the content
  // was fully resolved.
  const stillConflicted = conflicted.filter(f => /^<<<<<<< /m.test(fs.readFileSync(f, 'utf8')));
  if (stillConflicted.length) fail(`Conflict markers remain after resolution attempt:\n${stillConflicted.join('\n')}`);

  execSync('git add ' + conflicted.map(f => `"${f}"`).join(' '), { stdio: 'inherit' });
  execSync('git commit --no-edit', { stdio: 'inherit' });
  console.log('Auto-resolved all conflicts and committed the merge.');
}

// Exported so the resolution logic can be tested without a real merge in
// progress; `node .github/scripts/resolve-auto-merge-conflicts.js` still runs
// the whole thing exactly as the workflow invokes it.
module.exports = { resolveVersionFile, resolveChangelogFile, maxVersion, bumpPatch, ALLOWED_FILES };

if (require.main === module) main();
