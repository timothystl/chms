import { describe, it, expect } from 'vitest';
import { handleFinanceApi } from '../src/api-finance.js';

// The worker's top-level /admin/api/ handler deliberately hides internals and returns a bare
// "Internal server error. Please try again." — correct as a default, but it made a real live
// report ("now Error: Internal server error") impossible to diagnose, because the only copy of
// the actual message was in Cloudflare's logs. These routes are finance-gated, so the real
// message is safe to return and is the difference between a fixable report and a guess.

function row(year, month) {
  return {
    fiscal_year: year, period_month: month, classification: 'Income',
    category_path: 'Income:40085 Sunday Offering', account_name: '40085 Sunday Offering',
    depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: null,
  };
}
const URL_ = new URL('https://x/admin/api/finance/church/monthly-import');

// A db whose batch() fails the way D1 does when it rejects a write.
function failingDb(message) {
  const stmt = { async run() {}, async first() { return null; }, async all() { return { results: [] }; }, bind() { return stmt; } };
  return { prepare: () => stmt, async batch() { throw new Error(message); } };
}

describe('monthly import commit — database failures', () => {
  it('returns the real database message instead of a bare 500', async () => {
    const req = { json: async () => ({ rows: [row(2025, 1), row(2026, 1)] }) };
    const res = await handleFinanceApi(req, {}, URL_, 'POST', 'finance/church/monthly-import',
      failingDb('D1_ERROR: too many SQL variables'), true, true);
    expect(res.status).toBe(500);
    const d = await res.json();
    expect(d.error).toContain('D1_ERROR: too many SQL variables');
    // Names the scope that failed, so a partial multi-year run is identifiable from the report.
    expect(d.error).toContain('FY2025-FY2026');
    expect(d.error).toContain('2 rows');
    expect(d.error).not.toBe('Internal server error. Please try again.');
  });

  it('names a single year when only one is in the payload', async () => {
    const req = { json: async () => ({ rows: [row(2026, 1)] }) };
    const res = await handleFinanceApi(req, {}, URL_, 'POST', 'finance/church/monthly-import',
      failingDb('boom'), true, true);
    const d = await res.json();
    expect(d.error).toContain('FY2026');
    expect(d.error).not.toContain('-FY');
  });

  it('still rejects a malformed payload with a 400 before touching the database', async () => {
    const req = { json: async () => ({ rows: [{ ...row(2026, 1), fiscal_year: 'nope' }] }) };
    const res = await handleFinanceApi(req, {}, URL_, 'POST', 'finance/church/monthly-import',
      failingDb('should never be reached'), true, true);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Malformed row in import payload');
  });
});

describe('monthly import preview — unexpected failures', () => {
  it('reports what went wrong rather than reaching the generic handler', async () => {
    // A workbook that reads fine but whose grid is not an array, so the sheet walk throws.
    const badSheets = { formData: async () => ({ get: () => ({ size: 10, arrayBuffer: async () => new ArrayBuffer(8) }) }) };
    const res = await handleFinanceApi(badSheets, {}, new URL('https://x/p'), 'POST',
      'finance/church/monthly-import-preview', failingDb('unused'), true, true);
    const d = await res.json();
    // Either the xlsx reader rejects it (400) or the walk throws (500) — both must carry a real
    // message, and neither may be the opaque worker-level string.
    expect(d.error).toBeTruthy();
    expect(d.error).not.toBe('Internal server error. Please try again.');
  });
});
