import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DEPLOY_VERSION } from '../src/frontend/js-core.js';

const require_ = createRequire(import.meta.url);
const resolver = require_('../.github/scripts/resolve-auto-merge-conflicts.js');

// The auto-merge workflow resolves two conflict shapes without a human:
// the DEPLOY_VERSION line and top-of-changelog insertions. It runs on every
// claude/** push and pushes straight to main, so a wrong resolution ships.
//
// It shipped one: it rebuilt the version line as a bare `var DEPLOY_VERSION`,
// but js-core.js declares `export const DEPLOY_VERSION`. Auto-resolution
// therefore deleted the named export, every importer read `undefined`, and
// three tests in files the branch never touched failed — on a branch whose own
// diff was fine. These tests exist so that cannot recur silently.

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}
const conflict = (ours, theirs) =>
  '<<<<<<< HEAD\n' + ours + '\n=======\n' + theirs + '\n>>>>>>> origin/main\n';

describe('DEPLOY_VERSION conflict resolution', () => {
  it('keeps the export keyword the file actually uses', () => {
    const p = write('js-core.js',
      '// header\n'
      + conflict("export const DEPLOY_VERSION = '1.182.0';", "export const DEPLOY_VERSION = '1.183.0';")
      + '\nexport const JS_CORE = 1;\n');
    resolver.resolveVersionFile(p);
    const out = fs.readFileSync(p, 'utf8');
    expect(out).toContain("export const DEPLOY_VERSION = '1.183.1';");
    expect(out).not.toMatch(/^var DEPLOY_VERSION/m);
    expect(out).not.toContain('<<<<<<<');
  });

  it('bumps past the higher of the two sides, whichever order they come in', () => {
    const run = (a, b) => {
      const p = write('js-core.js',
        conflict(`export const DEPLOY_VERSION = '${a}';`, `export const DEPLOY_VERSION = '${b}';`));
      resolver.resolveVersionFile(p);
      return /'([\d.]+)'/.exec(fs.readFileSync(p, 'utf8'))[1];
    };
    expect(run('1.182.0', '1.183.0')).toBe('1.183.1');
    expect(run('1.183.0', '1.182.0')).toBe('1.183.1');
    expect(run('1.9.0', '1.10.0')).toBe('1.10.1');     // numeric, not lexical
    expect(run('2.0.0', '1.99.99')).toBe('2.0.1');
  });

  it('preserves indentation and the trailing semicolon', () => {
    const p = write('js-core.js',
      conflict("  export const DEPLOY_VERSION = '1.0.0';", "  export const DEPLOY_VERSION = '1.0.1';"));
    resolver.resolveVersionFile(p);
    expect(fs.readFileSync(p, 'utf8')).toContain("  export const DEPLOY_VERSION = '1.0.2';");
  });

  it('refuses a hunk that is not just the version line, rather than guessing', () => {
    // process.exit(1) inside fail(); a thrown ExitStatus is the observable form.
    const p = write('js-core.js',
      conflict("export const DEPLOY_VERSION = '1.0.0';\nexport const OTHER = 2;",
               "export const DEPLOY_VERSION = '1.0.1';"));
    expect(() => resolver.resolveVersionFile(p)).toThrow();
  });

  it('refuses a hunk that is not a version collision at all', () => {
    const p = write('js-core.js', conflict('var somethingElse = 1;', 'var somethingElse = 2;'));
    expect(() => resolver.resolveVersionFile(p)).toThrow();
  });

  it('refuses to write a file that no longer exports DEPLOY_VERSION', () => {
    // The backstop for the exact bug above: even if the line rebuild were wrong
    // again, the file is checked for the export before it is written.
    const p = write('js-core.js',
      conflict("var DEPLOY_VERSION = '1.0.0';", "var DEPLOY_VERSION = '1.0.1';"));
    expect(() => resolver.resolveVersionFile(p)).toThrow();
  });

  it('matches the declaration the real js-core.js uses', () => {
    // If js-core.js ever changes how it declares this, the resolver's guard
    // must change with it — this is what couples the two.
    const real = fs.readFileSync(new URL('../src/frontend/js-core.js', import.meta.url), 'utf8');
    expect(real).toMatch(/^export const DEPLOY_VERSION = '[\d.]+';$/m);
    expect(DEPLOY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('changelog conflict resolution', () => {
  it('keeps both entries, the incoming branch first', () => {
    const p = write('NOTES.md',
      '## Recent Changes\n\n' + conflict('### v1.182.0 — mine\nbody', '### v1.183.0 — theirs\nbody'));
    resolver.resolveChangelogFile(p);
    const out = fs.readFileSync(p, 'utf8');
    expect(out).toContain('### v1.183.0 — theirs');
    expect(out).toContain('### v1.182.0 — mine');
    expect(out.indexOf('theirs')).toBeLessThan(out.indexOf('mine'));
    expect(out).not.toContain('<<<<<<<');
  });

  it('refuses a one-sided hunk, which is an edit rather than an insertion', () => {
    const p = write('NOTES.md', conflict('### mine', ''));
    expect(() => resolver.resolveChangelogFile(p)).toThrow();
  });
});

describe('what the resolver is allowed to touch', () => {
  it('is limited to the three known hotspots', () => {
    expect([...resolver.ALLOWED_FILES].sort())
      .toEqual(['CLAUDE.md', 'NOTES.md', 'src/frontend/js-core.js']);
  });
});
