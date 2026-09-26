import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { renderClassificationEditors } from '../apps/finance/classification-pages.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };
const classification = {
  contract: 'connect.finance-classification.v1', fiscalYear: 2026,
  revenueStreams: {
    options: [{ key: 'donor', label: 'Donor income' }, { key: 'earned', label: 'Earned income' }],
    groups: [{ label: '40 Offerings', actualCents: 1000000, budgetCents: 1200000, stream: 'donor', mapped: true }, { label: '44 Rentals', actualCents: 200000, budgetCents: 180000, stream: 'earned', mapped: false }],
  },
  expenseCategories: {
    options: [{ key: 'salaries', label: 'Salaries & Benefits' }, { key: 'property', label: 'Property & Operations' }],
    groups: [{ label: '58 Salaries', actualCents: 700000, key: 'salaries', mapped: true }, { label: '62 Utilities', actualCents: 100000, key: 'property', mapped: false }],
  },
};

function post(path, env, body, accessJwt = 'signed.jwt.here') {
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(accessJwt ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}) }, body: new URLSearchParams(body),
  }), env);
}

describe('Data & Imports classification editors and existing Connect relays', () => {
  it('renders confirmed/guessed groups read-only for non-admins and complete forms for admins', () => {
    const readOnly = renderClassificationEditors({ ok: true, classification });
    expect(readOnly).toContain('44 Rentals <small>(guessed)</small>');
    expect(readOnly).not.toContain('/api/v1/connect-revenue-streams-write');
    const admin = renderClassificationEditors({ ok: true, classification }, { canManage: true });
    expect(admin).toContain('action="/api/v1/connect-revenue-streams-write"');
    expect(admin).toContain('action="/api/v1/connect-flow-expense-map-write"');
    expect(admin).toContain('name="stream"');
    expect(admin).toContain('name="key"');
    expect(admin).toContain('value="40 Offerings"');
    expect(admin).toContain('value="62 Utilities"');
  });

  it('renders independent success/error feedback and an honest unavailable state', () => {
    expect(renderClassificationEditors({ ok: true, classification }, { canManage: true, revenueStatus: 'ok' })).toContain('Revenue-stream classification saved in Connect.');
    expect(renderClassificationEditors({ ok: true, classification }, { canManage: true, expenseStatus: 'error', expenseMessage: 'Access denied' })).toContain('Not saved: Access denied');
    expect(renderClassificationEditors({ ok: false, reason: 'http_error' })).toContain('live classification settings could not be read');
  });

  it('forwards all revenue groups and returns to Data & Imports', async () => {
    let captured;
    const env = { ...baseEnv, FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { captured = req; return new Response(JSON.stringify({ ok: true })); } } };
    const response = await post('/api/v1/connect-revenue-streams-write', env, [['label', '40 Offerings'], ['stream', 'donor'], ['label', '44 Rentals'], ['stream', 'earned']]);
    const location = new URL(response.headers.get('location'), 'https://finance.test');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ section: 'data', op: 'revenue-streams', status: 'ok' });
    expect(JSON.parse(await captured.text())).toEqual({ map: { '40 Offerings': 'donor', '44 Rentals': 'earned' } });
    expect(new URL(captured.url).pathname).toBe('/api/contracts/finance-revenue-streams-write-v1');
  });

  it('forwards all expense groups and keeps refusal feedback scoped to that editor', async () => {
    let captured;
    const env = { ...baseEnv, FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { captured = req; return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }); } } };
    const response = await post('/api/v1/connect-flow-expense-map-write', env, [['label', '58 Salaries'], ['key', 'salaries'], ['label', '62 Utilities'], ['key', 'property']]);
    const location = new URL(response.headers.get('location'), 'https://finance.test');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ section: 'data', op: 'flow-expense-map', status: 'error', reason: 'http_error', message: 'Access denied' });
    expect(JSON.parse(await captured.text())).toEqual({ map: { '58 Salaries': 'salaries', '62 Utilities': 'property' } });
  });

  it('retains method, configuration, and identity boundaries', async () => {
    for (const path of ['/api/v1/connect-revenue-streams-write', '/api/v1/connect-flow-expense-map-write']) {
      const get = await worker.fetch(new Request(`https://finance.test${path}`), baseEnv);
      expect(get.status).toBe(405);
      const unconfigured = await post(path, baseEnv, [['label', 'A'], [path.includes('revenue') ? 'stream' : 'key', path.includes('revenue') ? 'donor' : 'programs']]);
      expect(new URL(unconfigured.headers.get('location'), 'https://finance.test').searchParams.get('reason')).toBe('not_configured');
      const noIdentity = await post(path, { ...baseEnv, FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { throw new Error('must not call'); } } }, [['label', 'A']], '');
      expect(new URL(noIdentity.headers.get('location'), 'https://finance.test').searchParams.get('reason')).toBe('no_access_identity');
    }
  });
});
