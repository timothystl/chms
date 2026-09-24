import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
function envFor(role, permissions) {
  const calls = [];
  return { calls, env: { ENVIRONMENT: 'production', FINANCE_CONTRACT_API_KEY: 'test-only',
    CONNECT_SERVICE: { async fetch(req) {
      const path = new URL(req.url).pathname; calls.push(path);
      if (path === '/api/contracts/staff-role-v1') return Response.json({ role, permissions });
      throw new Error('Sensitive report read should not have been attempted');
    } },
  } };
}
const signed = { headers: { 'Cf-Access-Jwt-Assertion': 'test-assertion' } };
describe('Finance permission boundaries', () => {
  it('does not call any service without an identity on the Giving API', async () => {
    const { env, calls } = envFor('admin', {});
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview'), env);
    expect(res.status).toBe(403); expect(calls).toEqual([]);
  });
  for (const role of ['member', 'volunteer', 'staff', 'compensation']) {
    it(`denies Giving API access for ${role} without Giving permissions`, async () => {
      const { env, calls } = envFor(role, { giving: 'none' });
      const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview', signed), env);
      expect(res.status).toBe(403); expect(calls).toEqual(['/api/contracts/staff-role-v1']);
    });
  }
  for (const [role, section, permissions] of [
    ['council', 'church', { finance: 'none', compensation: 'edit' }],
    ['staff', 'balance', { finance: 'none' }],
    ['finance', 'health', { finance: 'view', giving: 'none' }],
    ['council', 'compensation', { compensation: 'none' }],
    ['council', 'planning', { budget: 'none' }],
    ['unknown', 'church', { finance: 'edit' }],
  ]) {
    it(`denies ${role}/${section} before reading reports`, async () => {
      const { env, calls } = envFor(role, permissions);
      const res = await worker.fetch(new Request(`https://finance.test/?section=${section}`, signed), env);
      expect(res.status).toBe(403); expect(calls).toEqual(['/api/contracts/staff-role-v1']);
    });
  }
});
