import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const statements = [];
const baseEnv = {
  ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha',
  FINANCE_DB: { prepare(sql) { statements.push(sql); return { sql }; } },
};

function liveEnv(fetchImpl) {
  return { ...baseEnv, PAYROLL_SERVICE: { fetch: fetchImpl }, FINANCE_PAYROLL_CONTRACT_KEY: 'test-secret' };
}

function getPayrollSection(env, { accessJwt } = {}) {
  return worker.fetch(new Request('https://finance.test/?section=payroll', {
    headers: accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {},
  }), env);
}

describe('Finance Payroll section', () => {
  it('appears in the workspace navigation', async () => {
    const res = await getPayrollSection(baseEnv, { accessJwt: 'whatever' });
    const html = await res.text();
    expect(html).toContain('href="/?section=payroll"');
    expect(html).toContain('>Payroll<');
  });

  it('shows a clear not-connected status and no table when the relay is not configured, without querying Finance\'s own database', async () => {
    statements.length = 0;
    const res = await getPayrollSection(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Staff roster');
    expect(html).toContain('Not connected: not_configured');
    expect(html).not.toContain('<table>');
    expect(statements).toHaveLength(0);
  });

  it('shows the not-connected reason and message when Website declines the call', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 }));
    const res = await getPayrollSection(env, { accessJwt: 'signed.jwt.here' });
    const html = await res.text();
    expect(html).toContain('Not connected: http_error: Not authenticated.');
  });

  it('forwards the caller\'s Access assertion and renders a real staff roster table', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify([
        { id: 'abc', full_name: 'Sarah Example', role: 'Teacher' },
        { id: 'def', full_name: 'James Example', role: 'Office' },
      ]), { status: 200 });
    });
    const res = await getPayrollSection(env, { accessJwt: 'signed.jwt.here' });
    const html = await res.text();
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('Sarah Example');
    expect(html).toContain('James Example');
    expect(html).toContain('<th>full_name</th>');
    expect(html).toContain('<th>role</th>');
    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
  });

  it('shows a plain empty-state message when Website returns zero staff records', async () => {
    const env = liveEnv(async () => new Response('[]', { status: 200 }));
    const res = await getPayrollSection(env, { accessJwt: 'signed.jwt.here' });
    const html = await res.text();
    expect(html).toContain('No staff records were returned.');
    expect(html).not.toContain('<table>');
  });
});
