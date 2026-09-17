import { describe, it, expect, vi } from 'vitest';
import {
  qboConfigured, getAuthorizeUrl, exchangeCodeForTokens, refreshTokens, revokeToken, makeQboClient,
} from '../apps/finance/quickbooks-oauth-client.js';

// Every test in this file mocks `fetchImpl` directly -- no test here ever calls the real global
// fetch(), and none makes a request to any *.intuit.com/*.quickbooks.com host. See
// quickbooks-oauth-client.js's own header comment for why this module (like the rest of the
// quickbooks-*.js files added alongside it) is dark, unwired design/port code.

const ENV = { FINANCE_QB_CLIENT_ID: 'client-123', FINANCE_QB_CLIENT_SECRET: 'secret-abc', FINANCE_QB_ENVIRONMENT: 'production' };

describe('qboConfigured', () => {
  it('is true only when both client id and secret are present', () => {
    expect(qboConfigured(ENV)).toBe(true);
    expect(qboConfigured({ FINANCE_QB_CLIENT_ID: 'x' })).toBe(false);
    expect(qboConfigured({})).toBe(false);
  });
});

describe('getAuthorizeUrl', () => {
  it('builds the authorize URL from the discovery document, with client_id/scope/redirect_uri/state', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      authorization_endpoint: 'https://mock-appcenter.example/connect/oauth2',
      token_endpoint: 'https://mock-oauth.example/tokens/bearer',
      revocation_endpoint: 'https://mock-oauth.example/tokens/revoke',
    }), { status: 200 }));
    const url = await getAuthorizeUrl(ENV, 'https://finance.timothystl.org/api/v1/qb/callback', 'state-xyz', fetchImpl);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://mock-appcenter.example/connect/oauth2');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://finance.timothystl.org/api/v1/qb/callback');
    expect(parsed.searchParams.get('state')).toBe('state-xyz');
  });

  it('falls back to the last-resort endpoints when the discovery fetch fails, rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network unreachable'); });
    const url = await getAuthorizeUrl(ENV, 'https://finance.timothystl.org/cb', 'state-1', fetchImpl);
    expect(url.startsWith('https://appcenter.intuit.com/connect/oauth2?')).toBe(true);
  });
});

describe('exchangeCodeForTokens / refreshTokens', () => {
  function discoveryThenToken(tokenBody, tokenStatus = 200) {
    let call = 0;
    return vi.fn(async (url) => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({
          authorization_endpoint: 'https://mock-appcenter.example/connect/oauth2',
          token_endpoint: 'https://mock-oauth.example/tokens/bearer',
          revocation_endpoint: 'https://mock-oauth.example/tokens/revoke',
        }), { status: 200 });
      }
      return new Response(JSON.stringify(tokenBody), { status: tokenStatus });
    });
  }

  it('exchangeCodeForTokens sends grant_type=authorization_code with the code and redirect_uri, and a Basic auth header', async () => {
    let capturedReq;
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('openid_configuration')) {
        return new Response(JSON.stringify({ token_endpoint: 'https://mock-oauth.example/tokens/bearer' }), { status: 200 });
      }
      capturedReq = { url, init };
      return new Response(JSON.stringify({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, x_refresh_token_expires_in: 8640000 }), { status: 200 });
    });
    const tokens = await exchangeCodeForTokens(ENV, 'auth-code-1', 'https://finance.timothystl.org/cb', fetchImpl);
    expect(tokens).toEqual({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, x_refresh_token_expires_in: 8640000 });
    expect(capturedReq.url).toBe('https://mock-oauth.example/tokens/bearer');
    expect(capturedReq.init.method).toBe('POST');
    expect(capturedReq.init.headers.Authorization).toBe('Basic ' + Buffer.from('client-123:secret-abc').toString('base64'));
    const body = new URLSearchParams(capturedReq.init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-1');
    expect(body.get('redirect_uri')).toBe('https://finance.timothystl.org/cb');
  });

  it('refreshTokens sends grant_type=refresh_token with the refresh token', async () => {
    let capturedBody;
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('openid_configuration')) {
        return new Response(JSON.stringify({ token_endpoint: 'https://mock-oauth.example/tokens/bearer' }), { status: 200 });
      }
      capturedBody = init.body;
      return new Response(JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, x_refresh_token_expires_in: 8640000 }), { status: 200 });
    });
    const tokens = await refreshTokens(ENV, 'old-refresh-token', fetchImpl);
    expect(tokens.access_token).toBe('AT2');
    expect(tokens.refresh_token).toBe('RT2');
    const body = new URLSearchParams(capturedBody);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh-token');
  });

  it('throws with Intuit\'s error_description when the token endpoint refuses the refresh', async () => {
    const fetchImpl = discoveryThenToken({ error: 'invalid_grant', error_description: 'Token invalid' }, 400);
    await expect(refreshTokens(ENV, 'expired-refresh-token', fetchImpl)).rejects.toThrow('Token invalid');
  });

  it('throws a generic message when the token endpoint fails without a parseable body', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ token_endpoint: 'https://mock-oauth.example/tokens/bearer' }), { status: 200 });
      return new Response('not json', { status: 500 });
    });
    await expect(refreshTokens(ENV, 'rt', fetchImpl)).rejects.toThrow('QuickBooks token request failed (500)');
  });
});

describe('revokeToken', () => {
  it('posts the token to the revocation endpoint and never throws even on failure', async () => {
    let capturedBody;
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('openid_configuration')) {
        return new Response(JSON.stringify({ revocation_endpoint: 'https://mock-oauth.example/tokens/revoke' }), { status: 200 });
      }
      capturedBody = init.body;
      throw new Error('revocation endpoint unreachable');
    });
    await expect(revokeToken(ENV, 'rt-to-revoke', fetchImpl)).resolves.toBeUndefined();
    expect(JSON.parse(capturedBody)).toEqual({ token: 'rt-to-revoke' });
  });

  it('does nothing (no request at all) when there is no token to revoke', async () => {
    const fetchImpl = vi.fn();
    await revokeToken(ENV, '', fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('makeQboClient', () => {
  it('returns null when the connection is incomplete', () => {
    expect(makeQboClient(ENV, null)).toBeNull();
    expect(makeQboClient(ENV, { realm_id: '123' })).toBeNull();
  });

  it('builds authenticated GET requests against the right host/company for each report/query', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (url, init) => { requests.push({ url: String(url), init }); return new Response('{}', { status: 200 }); });
    const client = makeQboClient(ENV, { realm_id: '999', access_token: 'AT-live', environment: 'production' }, fetchImpl);

    await client.accounts();
    await client.budgets();
    await client.profitAndLoss({ start_date: '2026-01-01', end_date: '2026-12-31' });

    expect(requests).toHaveLength(3);
    for (const { url, init } of requests) {
      expect(url.startsWith('https://quickbooks.api.intuit.com/v3/company/999/')).toBe(true);
      expect(init.headers.Authorization).toBe('Bearer AT-live');
    }
    expect(requests[0].url).toContain('/query?query=');
    expect(requests[1].url).toContain(encodeURIComponent('SELECT * FROM Budget'));
    expect(requests[2].url).toContain('/reports/ProfitAndLoss?');
    expect(requests[2].url).toContain('start_date=2026-01-01');
    expect(requests[2].url).toContain('end_date=2026-12-31');
  });

  it('uses the sandbox host when the stored connection environment is sandbox', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = makeQboClient(ENV, { realm_id: '1', access_token: 'AT', environment: 'sandbox' }, fetchImpl);
    await client.accounts();
    expect(fetchImpl.mock.calls[0][0]).toContain('sandbox-quickbooks.api.intuit.com');
  });
});
