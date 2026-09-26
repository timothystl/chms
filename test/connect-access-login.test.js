import { describe, expect, it, vi } from 'vitest';
import { handleAccessLogin } from '../src/api-admin.js';

function envWithUser(user) {
  const statements = [];
  const DB = {
    prepare(sql) {
      const statement = {
        bind(...values) { statement.values = values; return statement; },
        async first() { statements.push({ sql, values: statement.values }); return user; },
        async run() { statements.push({ sql, values: statement.values }); return { success: true }; },
      };
      return statement;
    },
  };
  return {
    env: {
      DB,
      SESSION_SECRET: 'test-session-secret-with-enough-entropy',
      CONNECT_ACCESS_TEAM_DOMAIN: 'timothystl.cloudflareaccess.com',
      CONNECT_ACCESS_AUD: 'connect-audience',
    },
    statements,
  };
}

const request = (token = 'signed.jwt') => new Request('https://connect.timothystl.org/admin/access-login', {
  headers: { 'Cf-Access-Jwt-Assertion': token },
});

describe('Connect shared staff login', () => {
  it('maps the verified email to an active local account and mints the existing session', async () => {
    const { env, statements } = envWithUser({ id: 7, username: 'andrew', role: 'admin' });
    const verifyJwt = vi.fn().mockResolvedValue('andrew@timothystl.org');
    const response = await handleAccessLogin(request(), env, { verifyJwt });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/');
    expect(response.headers.get('Set-Cookie')).toMatch(/^vol_auth=.*; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(verifyJwt).toHaveBeenCalledWith('signed.jwt', {
      teamDomain: 'timothystl.cloudflareaccess.com',
      audience: 'connect-audience',
    });
    expect(statements[0].values).toEqual(['andrew@timothystl.org']);
    expect(statements.some(({ sql, values }) => sql.includes('UPDATE app_users SET last_login') && values[0] === 7)).toBe(true);
  });

  it('does not create an account or session for a valid but unassigned identity', async () => {
    const { env } = envWithUser(null);
    const response = await handleAccessLogin(request(), env, {
      verifyJwt: vi.fn().mockResolvedValue('newperson@timothystl.org'),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await response.text()).toContain('not assigned an active Connect account');
  });

  it('fails closed on a bad token, missing configuration, or database failure', async () => {
    const { env } = envWithUser(null);
    expect((await handleAccessLogin(request('bad'), env, { verifyJwt: vi.fn().mockResolvedValue(null) })).status).toBe(401);

    const unconfigured = { ...env, CONNECT_ACCESS_AUD: '' };
    expect((await handleAccessLogin(request(), unconfigured, { verifyJwt: vi.fn() })).status).toBe(503);

    const broken = {
      ...env,
      DB: { prepare: () => ({ bind() { return this; }, first: async () => { throw new Error('offline'); } }) },
    };
    expect((await handleAccessLogin(request(), broken, { verifyJwt: vi.fn().mockResolvedValue('andrew@timothystl.org') })).status).toBe(503);
  });
});
