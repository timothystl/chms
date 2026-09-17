import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINANCE_ROUTE_MANIFEST } from '../apps/finance/route-manifest.js';

// Standing guard for the QuickBooks OAuth/sync DESIGN + DARK CODE added alongside this test
// (quickbooks-oauth-client.js, quickbooks-token-service.js, quickbooks-budget-merge.js,
// quickbooks-oauth-routes.js, migrations/0008_finance_qb_connection.sql). Every one of those
// files says in its own header comment that it is not wired to anything deployed. This test makes
// that independently, mechanically checkable rather than a claim resting on comments alone: if a
// future change imports any of them from shell.js, lists a qb route in route-manifest.js, or adds
// a QuickBooks secret/binding to either wrangler.finance*.jsonc, this test fails and says so.
// Actually connecting Finance to QuickBooks needs Andrew's separate explicit approval plus,
// likely, an Intuit app-registration change only he can make -- see
// quickbooks-oauth-client.js's header comment. Un-skip/relax this test only as part of that
// approved change, never incidentally.

const repoRoot = new URL('..', import.meta.url);
const shellSrc = readFileSync(new URL('apps/finance/shell.js', repoRoot), 'utf8');
const routeManifestSrc = readFileSync(new URL('apps/finance/route-manifest.js', repoRoot), 'utf8');
// Read as plain text, not JSON.parse'd -- wrangler.finance.jsonc (production) carries `//`
// comments that plain JSON.parse cannot handle, and a substring check is all this guard needs.
const stagingConfigSrc = readFileSync(new URL('wrangler.finance.staging.jsonc', repoRoot), 'utf8');
const prodConfigSrc = readFileSync(new URL('wrangler.finance.jsonc', repoRoot), 'utf8');

describe('QuickBooks OAuth/sync design code stays fully unwired', () => {
  it('shell.js never imports any of the new quickbooks-* modules', () => {
    expect(shellSrc).not.toMatch(/quickbooks-oauth-client|quickbooks-token-service|quickbooks-budget-merge|quickbooks-oauth-routes/);
  });

  it('route-manifest.js never lists a QuickBooks OAuth/sync route', () => {
    expect(routeManifestSrc).not.toMatch(/qb[-/](connect|callback|disconnect|sync)/i);
    for (const route of FINANCE_ROUTE_MANIFEST) {
      for (const path of route.paths) expect(path).not.toMatch(/qb/i);
    }
  });

  it('neither wrangler.finance config adds a QuickBooks secret var, a KV namespace, or any other new binding', () => {
    for (const configSrc of [stagingConfigSrc, prodConfigSrc]) {
      expect(configSrc).not.toMatch(/kv_namespaces/);
      expect(configSrc).not.toMatch(/QB_CLIENT|FINANCE_QB/i);
    }
  });

  it('the QuickBooks design modules exist but are only ever imported by their own tests', () => {
    const designModules = [
      'apps/finance/quickbooks-oauth-client.js',
      'apps/finance/quickbooks-token-service.js',
      'apps/finance/quickbooks-budget-merge.js',
      'apps/finance/quickbooks-oauth-routes.js',
    ];
    for (const modPath of designModules) {
      // Will throw (failing this test) if the file is missing entirely.
      const src = readFileSync(new URL(modPath, repoRoot), 'utf8');
      expect(src).toMatch(/NOT WIRED/);
    }
  });
});
