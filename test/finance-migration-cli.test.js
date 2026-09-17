import { describe, expect, it } from 'vitest';
import { parseArgs } from '../apps/finance/migration/cli.js';

// cli.js's own wrangler-shelling code path is not exercised here -- there is no real D1 to run it
// against (see cli.js's own header comment). This only proves its pure argument parsing, and that
// a write is never attempted by default.

describe('migration CLI argument parsing', () => {
  it('parses --key=value flags into camelCase', () => {
    const args = parseArgs(['--table=finance_import_log', '--source-db=tlc-volunteer-db', '--dest-db=timothy-finance-db-staging']);
    expect(args.table).toBe('finance_import_log');
    expect(args.sourceDb).toBe('tlc-volunteer-db');
    expect(args.destDb).toBe('timothy-finance-db-staging');
  });

  it('defaults apply/remote to false so a bare invocation is always a dry run against local D1', () => {
    const args = parseArgs(['--table=finance_import_log']);
    expect(args.apply).toBe(false);
    expect(args.remote).toBe(false);
  });

  it('treats bare boolean flags as true', () => {
    const args = parseArgs(['--apply', '--remote']);
    expect(args.apply).toBe(true);
    expect(args.remote).toBe(true);
  });
});
