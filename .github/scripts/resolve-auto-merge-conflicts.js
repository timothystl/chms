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

const conflicted = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);

if (!conflicted.length) fail('Merge reported conflicts but git diff --diff-filter=U found none — unexpected state.');

for (const f of conflicted) {
  if (!ALLOWED_FILES.has(f)) fail(`Conflict in ${f} is outside the auto-resolvable set (${[...ALLOWED_FILES].join(', ')}) — needs a human to merge this branch.`);
}

function resolveVersionFile(path) {
  const src = fs.readFileSync(path, 'utf8');
  const hunks = [...src.matchAll(CONFLICT_HUNK)];
  if (!hunks.length) fail(`${path} is marked conflicted but no conflict markers were found.`);
  let out = src;
  for (const hunk of hunks) {
    const [whole, ours, theirs] = hunk;
    const ourVer = /DEPLOY_VERSION\s*=\s*'([\d.]+)'/.exec(ours);
    const theirVer = /DEPLOY_VERSION\s*=\s*'([\d.]+)'/.exec(theirs);
    if (!ourVer || !theirVer) fail(`${path}: conflict hunk doesn't look like a DEPLOY_VERSION collision — refusing to guess.\n${whole}`);
    const higher = maxVersion(ourVer[1], theirVer[1]);
    const bumped = bumpPatch(higher);
    out = out.replace(whole, `var DEPLOY_VERSION = '${bumped}';`);
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
