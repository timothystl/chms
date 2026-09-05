import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleHouseholdsApi } from '../src/api-households.js';

function testDb() {
  const sql = [];
  return {
    sql,
    prepare(statement) {
      sql.push(statement);
      return {
        async all() {
          if (statement.includes('FROM giving_entries')) {
            return { results: [{ fund_id: 1, cnt: 3, total_cents: 12500 }] };
          }
          return { results: [{ id: 1, name: 'General Fund', category: 'general' }] };
        },
      };
    },
  };
}

async function getFunds(url, isAdmin = true) {
  const db = testDb();
  const response = await handleHouseholdsApi(
    {}, {}, new URL(url), 'GET', 'funds', db, isAdmin, true, isAdmin ? 'admin' : 'staff'
  );
  return { db, body: await response.json() };
}

describe('GET funds history statistics', () => {
  it('does not scan giving_entries for ordinary fund-picker requests', async () => {
    const { db, body } = await getFunds('https://x/admin/api/funds');
    expect(db.sql).toHaveLength(1);
    expect(db.sql[0]).toContain('FROM funds');
    expect(body.funds[0]).not.toHaveProperty('entry_count');
    expect(body.funds[0]).not.toHaveProperty('total_cents');
  });

  it('returns history statistics only when the Manage Funds screen opts in', async () => {
    const { db, body } = await getFunds('https://x/admin/api/funds?include_stats=1');
    expect(db.sql).toHaveLength(2);
    expect(db.sql[1]).toContain('FROM giving_entries');
    expect(body.funds[0]).toMatchObject({ entry_count: 3, total_cents: 12500 });
  });

  it('keeps the Manage Funds caller opted into the history fields it displays', () => {
    const source = readFileSync(new URL('../src/frontend/js-export-import.js', import.meta.url), 'utf8');
    const manageFunds = source.slice(source.indexOf('function loadManageFunds()'), source.indexOf('function renderManageFunds()'));
    expect(manageFunds).toContain("api('/admin/api/funds?include_stats=1')");
  });

  it('does not let a non-admin manufacture the expensive scan with a query parameter', async () => {
    const { db, body } = await getFunds('https://x/admin/api/funds?include_stats=1', false);
    expect(db.sql).toHaveLength(1);
    expect(body.funds[0]).not.toHaveProperty('entry_count');
  });
});
