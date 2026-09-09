import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
  };
}

const PATH = '/api/contracts/connect-giving-summary-v1';

function call({ key = 'right-secret', expectedKey = 'right-secret', query = 'from=2026-01-01&to=2026-01-31' } = {}) {
  const env = { DB: makeTestDb(), FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}?${query}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi', () => {
  it('refuses with 503 when no key is configured on this Worker at all', async () => {
    const env = { DB: makeTestDb() };
    const req = new Request(`https://connect.example${PATH}?from=2026-01-01&to=2026-01-31`, {
      headers: { 'X-Contract-Key': 'whatever' },
    });
    const res = await handleContractsServiceApi(req, env, PATH);
    expect(res.status).toBe(503);
  });

  it('refuses with 401 when no header or the wrong key is sent', async () => {
    for (const key of [null, 'wrong-secret', '']) {
      const res = await call({ key });
      expect(res.status, String(key)).toBe(401);
    }
  });

  it('accepts a matching key and returns a real, valid contract', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.giving-summary.v1');
    expect(body.funds).toEqual([]); // empty DB, but a real query ran and a real shape came back
  });

  it('still validates the request the same way as the human-facing route (missing dates -> 400)', async () => {
    const res = await call({ query: '' });
    expect(res.status).toBe(400);
  });

  it('answers 404 for any other path once authenticated', async () => {
    const env = { DB: makeTestDb(), FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const req = new Request('https://connect.example/api/contracts/something-else', {
      headers: { 'X-Contract-Key': 'right-secret' },
    });
    const res = await handleContractsServiceApi(req, env, '/api/contracts/something-else');
    expect(res.status).toBe(404);
  });
});
