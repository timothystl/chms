import { describe, it, expect, vi } from 'vitest';
import { handleConnect, handleCallback, handleDisconnect, handleSync } from '../apps/finance/quickbooks-oauth-routes.js';

// quickbooks-oauth-routes.js is DESIGN + DARK CODE -- not registered in route-manifest.js, not
// imported by shell.js (see test/finance-quickbooks-unwired.test.js for the standing guard on
// that). These tests exercise the handlers directly, in isolation, with a small purpose-built D1
// mock and a mocked fetchImpl -- never a real network call, never a real database.

const ENV = { FINANCE_QB_CLIENT_ID: 'client-1', FINANCE_QB_CLIENT_SECRET: 'secret-1', FINANCE_QB_ENVIRONMENT: 'production' };
const NOW_MS = Date.parse('2026-09-17T12:00:00Z');

// A minimal, purpose-built D1-shaped mock: only understands the exact statements
// quickbooks-oauth-routes.js issues (see that file). Not a general SQL engine.
function makeMockDb() {
  let connection = null;
  const oauthStates = new Map();
  const snapshot = new Map();
  const settings = new Map();
  const writes = [];

  function execRun(sql, args) {
    if (/^INSERT INTO finance_qb_oauth_state/.test(sql)) {
      const [state, expires_at] = args;
      oauthStates.set(state, { state, expires_at, created_at: new Date(NOW_MS).toISOString() });
      return { success: true };
    }
    if (/^DELETE FROM finance_qb_oauth_state/.test(sql)) {
      oauthStates.delete(args[0]);
      return { success: true };
    }
    if (/^INSERT INTO finance_qb_connection/.test(sql)) {
      const [realmId, companyName, accessToken, refreshToken, accessExp, refreshExp, environment] = args;
      connection = {
        id: 1, realm_id: realmId, company_name: companyName, access_token: accessToken, refresh_token: refreshToken,
        access_token_expires_at: accessExp, refresh_token_expires_at: refreshExp, environment,
        connected_at: new Date(NOW_MS).toISOString(), last_synced_at: connection?.last_synced_at || '',
      };
      return { success: true };
    }
    if (/^UPDATE finance_qb_connection SET access_token/.test(sql)) {
      const [accessToken, refreshToken, accessExp, refreshExp] = args;
      if (connection) Object.assign(connection, { access_token: accessToken, refresh_token: refreshToken, access_token_expires_at: accessExp, refresh_token_expires_at: refreshExp });
      return { success: true };
    }
    if (/^UPDATE finance_qb_connection SET last_synced_at/.test(sql)) {
      if (connection) connection.last_synced_at = args[0];
      return { success: true };
    }
    if (/^DELETE FROM finance_qb_connection/.test(sql)) { connection = null; return { success: true }; }
    if (/^DELETE FROM finance_qb_snapshot/.test(sql)) { snapshot.clear(); return { success: true }; }
    if (/^INSERT INTO finance_qb_snapshot/.test(sql)) {
      const keyMatch = /VALUES \('(\w+)'/.exec(sql);
      const [value, syncedAt] = args;
      snapshot.set(keyMatch[1], { value, synced_at: syncedAt });
      return { success: true };
    }
    writes.push({ sql, args });
    return { success: true };
  }

  function execFirst(sql, args) {
    if (/^SELECT \* FROM finance_qb_connection/.test(sql)) return connection;
    if (/^SELECT state, expires_at FROM finance_qb_oauth_state/.test(sql)) return oauthStates.get(args[0]) || null;
    if (/^SELECT value FROM finance_settings/.test(sql)) {
      const m = /key='([\w_]+)'/.exec(sql);
      return settings.has(m[1]) ? { value: settings.get(m[1]) } : null;
    }
    return null;
  }

  return {
    writes, oauthStates, snapshot, settings,
    getConnection: () => connection,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql, args,
            async run() { return execRun(sql, args); },
            async first() { return execFirst(sql, args); },
          };
        },
        async first() { return execFirst(sql, []); },
        async run() { return execRun(sql, []); },
      };
    },
    async batch(ops) {
      const results = [];
      for (const op of ops) results.push(await op.run());
      return results;
    },
  };
}

function discoveryAndTokenFetch({ tokenBody, companyInfoOk = true }) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('openid_configuration')) {
      return new Response(JSON.stringify({
        authorization_endpoint: 'https://mock-appcenter.example/connect/oauth2',
        token_endpoint: 'https://mock-oauth.example/tokens/bearer',
        revocation_endpoint: 'https://mock-oauth.example/tokens/revoke',
      }), { status: 200 });
    }
    if (u.includes('tokens/bearer')) {
      return new Response(JSON.stringify(tokenBody), { status: 200 });
    }
    if (u.includes('/companyinfo/')) {
      return companyInfoOk
        ? new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Timothy Lutheran Church' } }), { status: 200 })
        : new Response('nope', { status: 500 });
    }
    return new Response('{}', { status: 200 });
  });
}

describe('handleConnect', () => {
  it('denies non-admins', async () => {
    const res = await handleConnect(null, new URL('https://finance.timothystl.org/api/v1/qb/connect'), ENV, makeMockDb(), { isAdmin: false });
    expect(res.status).toBe(403);
  });

  it('refuses when QuickBooks is not configured for Finance', async () => {
    const res = await handleConnect(null, new URL('https://finance.timothystl.org/api/v1/qb/connect'), {}, makeMockDb(), { isAdmin: true });
    expect(res.status).toBe(503);
  });

  it('persists a CSRF state row and redirects to the (mocked) authorize URL', async () => {
    const db = makeMockDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ authorization_endpoint: 'https://mock-appcenter.example/connect/oauth2' }), { status: 200 }));
    const res = await handleConnect(null, new URL('https://finance.timothystl.org/api/v1/qb/connect'), ENV, db, {
      isAdmin: true, fetchImpl, now: () => NOW_MS, randomUUID: () => 'fixed-state-1',
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location'));
    expect(location.origin + location.pathname).toBe('https://mock-appcenter.example/connect/oauth2');
    expect(location.searchParams.get('state')).toBe('fixed-state-1');
    expect(location.searchParams.get('redirect_uri')).toBe('https://finance.timothystl.org/api/v1/qb/callback');
    expect(db.oauthStates.has('fixed-state-1')).toBe(true);
  });

  it('fails closed with 503 if the state row cannot be written', async () => {
    const db = makeMockDb();
    db.prepare = () => { throw new Error('db unavailable'); };
    const res = await handleConnect(null, new URL('https://finance.timothystl.org/api/v1/qb/connect'), ENV, db, { isAdmin: true, now: () => NOW_MS, randomUUID: () => 's1' });
    expect(res.status).toBe(503);
  });
});

describe('handleCallback', () => {
  const url = new URL('https://finance.timothystl.org/api/v1/qb/callback?code=auth-code&realmId=realm-9&state=fixed-state-1');

  it('denies non-admins', async () => {
    const res = await handleCallback(null, url, ENV, makeMockDb(), { isAdmin: false });
    expect(res.status).toBe(403);
  });

  it('rejects a state that was never issued', async () => {
    const res = await handleCallback(null, url, ENV, makeMockDb(), { isAdmin: true, now: () => NOW_MS });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('invalid_or_expired_state');
  });

  it('rejects an expired state and still consumes it (no replay)', async () => {
    const db = makeMockDb();
    await db.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').bind('fixed-state-1', new Date(NOW_MS - 1000).toISOString()).run();
    const res = await handleCallback(null, url, ENV, db, { isAdmin: true, now: () => NOW_MS });
    expect(res.status).toBe(400);
    expect(db.oauthStates.has('fixed-state-1')).toBe(false);
  });

  it('exchanges the code, stores the connection, and returns the company name on success', async () => {
    const db = makeMockDb();
    await db.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').bind('fixed-state-1', new Date(NOW_MS + 60000).toISOString()).run();
    const fetchImpl = discoveryAndTokenFetch({ tokenBody: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, x_refresh_token_expires_in: 8640000 } });
    const res = await handleCallback(null, url, ENV, db, { isAdmin: true, now: () => NOW_MS, fetchImpl });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, companyName: 'Timothy Lutheran Church' });
    const conn = db.getConnection();
    expect(conn.realm_id).toBe('realm-9');
    expect(conn.access_token).toBe('AT');
    expect(conn.refresh_token).toBe('RT');
    // The consumed state is gone -- a replay of the same callback URL fails.
    expect(db.oauthStates.has('fixed-state-1')).toBe(false);
  });

  it('still succeeds (without a display name) when the companyinfo call fails -- non-fatal, matching legacy behavior', async () => {
    const db = makeMockDb();
    await db.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').bind('fixed-state-1', new Date(NOW_MS + 60000).toISOString()).run();
    const fetchImpl = discoveryAndTokenFetch({ tokenBody: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, x_refresh_token_expires_in: 8640000 }, companyInfoOk: false });
    const res = await handleCallback(null, url, ENV, db, { isAdmin: true, now: () => NOW_MS, fetchImpl });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.companyName).toBe('');
  });
});

describe('handleDisconnect', () => {
  it('denies non-admins', async () => {
    const res = await handleDisconnect(null, new URL('https://finance.timothystl.org/api/v1/qb/disconnect'), ENV, makeMockDb(), { isAdmin: false });
    expect(res.status).toBe(403);
  });

  it('revokes the refresh token and deletes the connection + snapshot', async () => {
    const db = makeMockDb();
    await db.prepare(
      `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at) VALUES (1,?,?,?,?,?,?,?,?,?)`
    ).bind('realm-1', 'Church', 'AT', 'RT', 'x', 'y', 'production', 'z', '').run();
    await db.prepare("INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('accounts','{}','now')").run();
    let revoked = false;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('openid_configuration')) return new Response(JSON.stringify({ revocation_endpoint: 'https://mock-oauth.example/tokens/revoke' }), { status: 200 });
      revoked = true;
      return new Response('{}', { status: 200 });
    });
    const res = await handleDisconnect(null, new URL('https://finance.timothystl.org/api/v1/qb/disconnect'), ENV, db, { isAdmin: true, fetchImpl });
    expect(res.status).toBe(200);
    expect(revoked).toBe(true);
    expect(db.getConnection()).toBeNull();
    expect(db.snapshot.size).toBe(0);
  });
});

describe('handleSync', () => {
  it('denies non-admins', async () => {
    const res = await handleSync(null, new URL('https://finance.timothystl.org/api/v1/qb/sync'), ENV, makeMockDb(), { isAdmin: false });
    expect(res.status).toBe(403);
  });

  it('requires an existing connection', async () => {
    const res = await handleSync(null, new URL('https://finance.timothystl.org/api/v1/qb/sync'), ENV, makeMockDb(), { isAdmin: true });
    expect(res.status).toBe(400);
  });

  it('surfaces a re-authentication failure as 502 without caching stale data', async () => {
    const db = makeMockDb();
    await db.prepare(
      `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at) VALUES (1,?,?,?,?,?,?,?,?,?)`
    ).bind('realm-1', 'Church', 'expired-at', 'RT', new Date(NOW_MS - 1000).toISOString(), 'y', 'production', 'z', '').run();
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('openid_configuration')) return new Response(JSON.stringify({ token_endpoint: 'https://mock-oauth.example/tokens/bearer' }), { status: 200 });
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token invalid' }), { status: 400 });
    });
    const res = await handleSync(null, new URL('https://finance.timothystl.org/api/v1/qb/sync'), ENV, db, { isAdmin: true, now: () => NOW_MS, fetchImpl });
    expect(res.status).toBe(502);
    expect(db.snapshot.size).toBe(0);
  });

  it('syncs the Budget vs Actual reconstruction + accounts into finance_qb_snapshot and bumps last_synced_at', async () => {
    const db = makeMockDb();
    await db.prepare(
      `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at) VALUES (1,?,?,?,?,?,?,?,?,?)`
    ).bind('realm-1', 'Church', 'valid-access-token', 'RT', new Date(NOW_MS + 60 * 60 * 1000).toISOString(), 'y', 'production', 'z', '2026-07-28T19:37:52Z').run();

    const budgetFixture = { QueryResponse: { Budget: [{ Id: '1', StartDate: '2026-01-01', BudgetDetail: [{ AccountRef: { value: 'a1', name: 'Contributions' }, Amount: '1000.00' }] }] } };
    const plFixture = { Rows: { Row: [
      { type: 'Section', Header: { ColData: [{ value: 'Income' }] }, Rows: { Row: [
        { ColData: [{ value: 'Contributions', id: 'a1' }, { value: '1200.00' }] },
      ] } },
      { ColData: [{ value: 'Net Income' }, { value: '1200.00' }] },
    ] } };
    const accountsFixture = { QueryResponse: { Account: [{ Id: 'a1', Name: 'Checking', CurrentBalance: 5000 }] } };

    const fetchImpl = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('SELECT%20*%20FROM%20Budget') || u.includes(encodeURIComponent('SELECT * FROM Budget'))) return new Response(JSON.stringify(budgetFixture), { status: 200 });
      if (u.includes('/reports/ProfitAndLoss')) return new Response(JSON.stringify(plFixture), { status: 200 });
      if (u.includes('/query?query=')) return new Response(JSON.stringify(accountsFixture), { status: 200 });
      return new Response('{}', { status: 200 });
    });

    const res = await handleSync(null, new URL('https://finance.timothystl.org/api/v1/qb/sync'), ENV, db, { isAdmin: true, now: () => NOW_MS, fetchImpl });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fetched).toEqual({ budgetVsActual: true, accounts: true });
    expect(db.snapshot.has('budget_vs_actual')).toBe(true);
    expect(db.snapshot.has('accounts')).toBe(true);
    expect(db.getConnection().last_synced_at).toBe(new Date(NOW_MS).toISOString());
    const storedBva = JSON.parse(db.snapshot.get('budget_vs_actual').value);
    expect(storedBva.Rows.Row[0].Rows.Row[0].ColData).toEqual([{ value: 'Contributions' }, { value: '1200.00' }, { value: '1000.00' }, { value: '200.00' }]);
  });
});
