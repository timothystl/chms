#!/usr/bin/env node
// Stage 1 migration CLI -- a one-time admin operation, not a Worker HTTP endpoint (per the
// Stage 0 reconciliation doc's own recommendation and AGENTS.md's "don't add new attack surface
// for a one-time operation" default). Run manually, by a human, against one table at a time, with
// an explicit --apply flag required before anything is written.
//
// This file is a thin transport around copy-and-verify.js's pure logic: it shells out to the
// `wrangler d1 execute` CLI (already the project's standard way to run ad hoc D1 SQL) to read the
// source table and to apply the generated upsert SQL to the destination, then re-reads the
// destination and reports count/checksum verification. NONE of this is unit tested directly --
// there is no real D1 to test against, and AGENTS.md/the task treats live D1 as inaccessible here.
// copy-and-verify.js's own tests (test/finance-migration-copy-and-verify.test.js) exercise every
// piece of logic this file calls, against an in-memory fake transport.
//
// Usage (from the repository root):
//   node apps/finance/migration/cli.js --table=finance_church_entries \
//     --source-db=tlc-volunteer-db --dest-db=timothy-finance-db-staging [--remote] [--apply]
//
// Without --apply, the generated SQL is written to a file for review and NOTHING is sent to the
// destination -- the default is always a dry run. --remote targets the real hosted database for
// both source and destination (wrangler's own --remote flag); omit it only against a local/dev D1.
//
// Running this against any real staging or production database still requires Andrew's separate,
// explicit go-ahead for that specific run, per AGENTS.md -- this script existing does not grant
// that approval, and nothing in this repository invokes it automatically.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATABLE_TABLES } from './table-registry.js';
import { copyAndVerifyTable } from './copy-and-verify.js';

function parseArgs(argv) {
  const args = { apply: false, remote: false };
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = m[2] === undefined ? true : m[2];
  }
  return args;
}

function wranglerJsonQuery(dbName, sql, { remote }) {
  const cliArgs = ['d1', 'execute', dbName, '--json', '--command', sql];
  if (remote) cliArgs.push('--remote');
  const out = execFileSync('wrangler', cliArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  // wrangler d1 execute --json returns an array of {results, success, meta} per statement.
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first || first.success === false) throw new Error(`wrangler d1 execute against ${dbName} failed`);
  return first.results || [];
}

function wranglerApplyFile(dbName, filePath, { remote }) {
  const cliArgs = ['d1', 'execute', dbName, '--file', filePath];
  if (remote) cliArgs.push('--remote');
  execFileSync('wrangler', cliArgs, { stdio: 'inherit' });
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.table || !args.sourceDb || !args.destDb) {
    console.error('Usage: node cli.js --table=<name> --source-db=<db> --dest-db=<db> [--remote] [--apply]');
    console.error(`Migratable tables: ${MIGRATABLE_TABLES.map((t) => t.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const remote = !!args.remote;
  const readSourceRows = (tableName) => wranglerJsonQuery(args.sourceDb, `SELECT * FROM ${tableName}`, { remote });
  const readDestRows = (tableName) => wranglerJsonQuery(args.destDb, `SELECT * FROM ${tableName}`, { remote });
  const writeStatements = (tableName, statements) => {
    const sqlText = statements.join('\n\n');
    const dir = mkdtempSync(path.join(tmpdir(), 'finance-migration-'));
    const filePath = path.join(dir, `${tableName}.sql`);
    writeFileSync(filePath, sqlText, 'utf8');
    console.log(`Generated ${statements.length} upsert statement(s) for ${tableName} at ${filePath}`);
    if (!args.apply) {
      console.log('Dry run only (pass --apply to actually write to the destination). Nothing was sent.');
      throw new DryRunStop();
    }
    wranglerApplyFile(args.destDb, filePath, { remote });
  };

  try {
    const result = await copyAndVerifyTable(args.table, { readSourceRows, readDestRows, writeStatements });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    if (err instanceof DryRunStop) return;
    console.error(err.stack || String(err));
    process.exitCode = 1;
  }
}

class DryRunStop extends Error {}

// Only run when invoked directly (`node cli.js ...`), never on import -- lets copy-and-verify.js
// and this file's own pure helpers be imported by tests without shelling out to wrangler.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}

export { parseArgs };
