import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
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
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    _raw: sqlite,
  };
}

const PATH = '/api/contracts/finance-compensation-v1';

function call({ key = 'right-secret', expectedKey = 'right-secret', db = makeTestDb() } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-compensation-v1', () => {
  it('refuses with 503 when no key is configured on this Worker at all', async () => {
    const env = { DB: makeTestDb() };
    const req = new Request(`https://connect.example${PATH}`, { headers: { 'X-Contract-Key': 'whatever' } });
    const res = await handleContractsServiceApi(req, env, PATH);
    expect(res.status).toBe(503);
  });

  it('refuses with 401 when no header or the wrong key is sent', async () => {
    for (const key of [null, 'wrong-secret', '']) {
      const res = await call({ key });
      expect(res.status, String(key)).toBe(401);
    }
  });

  it('returns a real, valid, empty-roster contract when nothing has ever been saved', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-compensation.v1');
    expect(body.workers).toEqual([]);
  });

  it('reflects a real-shaped roster, with a fabricated name and dollar figure', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_settings (key, value) VALUES ('finance_salary_planner', ?)`
    ).run(JSON.stringify({ roster: [{ name: 'Test Worker A', position: 'Fictional Director', actualSalaryCents: 5000000 }] }));
    const res = await call({ db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0]).toMatchObject({ name: 'Test Worker A', currentPayCents: 5000000, currentPaySource: 'entered' });
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
