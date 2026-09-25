import { describe, expect, it } from 'vitest';
import { handleFinanceApi } from '../src/api-finance.js';

// Andrew, 2026-09-25: every Finance import is admin-only, in standalone Finance's relays and in
// legacy Connect #finance alike; "Clear all church data" is retired everywhere.
const IMPORT_SEGMENTS = [
  'finance/daycare/church-budget-import',
  'finance/church/import-preview', 'finance/church/import',
  'finance/church/monthly-import-preview', 'finance/church/monthly-import',
  'finance/church/activity-import-preview', 'finance/church/activity-import',
  'finance/church/budget-multi-year-import-preview', 'finance/church/budget-multi-year-import',
  'finance/church/balances/import-preview', 'finance/church/balances/import',
  'finance/church/balances/multi-year-import-preview', 'finance/church/balances/multi-year-import',
];

const untouchedDb = new Proxy({}, { get() { throw new Error('database must not be touched'); } });

function call(seg, { isAdmin, method = 'POST' } = {}) {
  const url = new URL(`https://connect.test/admin/api/${seg}`);
  const req = new Request(url, { method, body: method === 'POST' ? '{}' : undefined });
  return handleFinanceApi(req, {}, url, method, seg, untouchedDb, isAdmin, true, isAdmin ? 'admin' : 'finance');
}

describe('legacy Connect Finance imports', () => {
  it.each(IMPORT_SEGMENTS)('refuses %s for a non-admin before reading the upload or database', async (seg) => {
    const res = await call(seg, { isAdmin: false });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/requires admin access/);
  });
});

describe('retired Clear all church data', () => {
  it.each([['finance/church/clear-all-preview', 'GET'], ['finance/church/clear-all', 'POST']])('%s is no longer a route', async (seg, method) => {
    // Unrouted: the handler returns null (Connect answers 404) without touching the database.
    expect(await call(seg, { isAdmin: true, method })).toBeNull();
  });
});
