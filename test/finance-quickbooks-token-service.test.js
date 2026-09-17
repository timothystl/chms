import { describe, it, expect, vi } from 'vitest';
import { ensureFreshAccessToken } from '../apps/finance/quickbooks-token-service.js';

// This is the direct Finance-owned port of src/api-finance.js's ensureFreshAccessToken -- the
// piece of legacy code AGENTS.md confirms has not run again since the one successful connection
// on 2026-07-28. Every test below mocks `refreshTokensFn` (standing in for
// quickbooks-oauth-client.js's `refreshTokens`, itself only ever HTTP-mocked in its own test
// file) and a small fake D1 -- no real network call, no real database.

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { calls.push({ sql, args }); return { success: true }; },
          };
        },
      };
    },
  };
}

const BASE_CONN = {
  id: 1, realm_id: 'realm-1', company_name: 'Timothy Lutheran Church',
  access_token: 'old-access-token', refresh_token: 'old-refresh-token',
  access_token_expires_at: '', refresh_token_expires_at: '',
  environment: 'production', connected_at: '2026-07-28T19:37:31Z', last_synced_at: '2026-07-28T19:37:52Z',
};

describe('ensureFreshAccessToken', () => {
  it('returns the connection unchanged when the access token still has more than 2 minutes left', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: new Date(now() + 10 * 60 * 1000).toISOString() };
    const refreshTokensFn = vi.fn();
    const db = fakeDb();
    const result = await ensureFreshAccessToken({}, db, conn, { refreshTokensFn, now });
    expect(result).toBe(conn);
    expect(refreshTokensFn).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it('refreshes when the access token has already expired, persists the rotated tokens, and returns the updated connection', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: new Date(now() - 60 * 1000).toISOString() };
    const refreshTokensFn = vi.fn(async (env, refreshToken) => {
      expect(refreshToken).toBe('old-refresh-token');
      return { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600, x_refresh_token_expires_in: 8640000 };
    });
    const db = fakeDb();
    const result = await ensureFreshAccessToken({ FINANCE_QB_CLIENT_ID: 'x' }, db, conn, { refreshTokensFn, now });

    expect(result.access_token).toBe('new-access-token');
    expect(result.refresh_token).toBe('new-refresh-token');
    expect(result.access_token_expires_at).toBe(new Date(now() + 3600 * 1000).toISOString());
    expect(result.refresh_token_expires_at).toBe(new Date(now() + 8640000 * 1000).toISOString());
    // Unrelated fields (realm_id, company_name, etc.) are preserved untouched.
    expect(result.realm_id).toBe('realm-1');
    expect(result.company_name).toBe('Timothy Lutheran Church');

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toMatch(/UPDATE finance_qb_connection SET/);
    expect(db.calls[0].args).toEqual(['new-access-token', 'new-refresh-token', result.access_token_expires_at, result.refresh_token_expires_at]);
  });

  it('refreshes when the access token is within the 2-minute skew window even though not yet expired', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: new Date(now() + 90 * 1000).toISOString() }; // 90s left < 2min skew
    const refreshTokensFn = vi.fn(async () => ({ access_token: 'rotated', refresh_token: 'rotated-rt', expires_in: 3600, x_refresh_token_expires_in: 8640000 }));
    const db = fakeDb();
    const result = await ensureFreshAccessToken({}, db, conn, { refreshTokensFn, now });
    expect(refreshTokensFn).toHaveBeenCalledTimes(1);
    expect(result.access_token).toBe('rotated');
  });

  it('falls back to default 1hr/100day expiries when Intuit omits expires_in/x_refresh_token_expires_in', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: new Date(now() - 1000).toISOString() };
    const refreshTokensFn = vi.fn(async () => ({ access_token: 'a', refresh_token: 'r' }));
    const db = fakeDb();
    const result = await ensureFreshAccessToken({}, db, conn, { refreshTokensFn, now });
    expect(result.access_token_expires_at).toBe(new Date(now() + 3600 * 1000).toISOString());
    expect(result.refresh_token_expires_at).toBe(new Date(now() + 8640000 * 1000).toISOString());
  });

  it('propagates a refresh failure without touching the database -- the caller must treat this as "reconnect QuickBooks"', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: new Date(now() - 1000).toISOString() };
    const refreshTokensFn = vi.fn(async () => { throw new Error('Token invalid'); });
    const db = fakeDb();
    await expect(ensureFreshAccessToken({}, db, conn, { refreshTokensFn, now })).rejects.toThrow('Token invalid');
    expect(db.calls).toHaveLength(0);
  });

  it('refuses to run without an explicit refreshTokensFn -- there is no default network-calling implementation', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: new Date(now() - 1000).toISOString() };
    await expect(ensureFreshAccessToken({}, fakeDb(), conn, { now })).rejects.toThrow(TypeError);
  });

  it('treats a missing/blank access_token_expires_at as already expired', async () => {
    const now = () => Date.parse('2026-09-17T12:00:00Z');
    const conn = { ...BASE_CONN, access_token_expires_at: '' };
    const refreshTokensFn = vi.fn(async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8640000 }));
    await ensureFreshAccessToken({}, fakeDb(), conn, { refreshTokensFn, now });
    expect(refreshTokensFn).toHaveBeenCalledTimes(1);
  });
});
