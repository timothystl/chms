import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { fetchVerifiedRole } from '../apps/finance/connect-role-client.js';

const ROLE = { role: 'admin', identity: 'admin@example.org', permissions: { finance: 'edit' } };

function envWith(responses) {
  let calls = 0;
  return {
    env: {
      ENVIRONMENT: 'production', FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: {
        async fetch() {
          const next = responses[Math.min(calls, responses.length - 1)];
          calls += 1;
          if (next === 'throw') throw new Error('Network connection lost.');
          if (next === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
          return next();
        },
      },
    },
    calls: () => calls,
  };
}
const ok = () => new Response(JSON.stringify(ROLE));
const status = (code) => () => new Response(JSON.stringify({ error: 'x' }), { status: code });

describe('Finance role verification', () => {
  it('retries once after a timeout or a 5xx, then succeeds', async () => {
    const a = envWith(['throw', ok]);
    expect(await fetchVerifiedRole(a.env, 'jwt')).toMatchObject({ ok: true, role: 'admin' });
    expect(a.calls()).toBe(2);
    const b = envWith([status(503), ok]);
    expect((await fetchVerifiedRole(b.env, 'jwt')).ok).toBe(true);
    expect(b.calls()).toBe(2);
  });

  it('does not retry a timeout', async () => {
    const a = envWith(['timeout', ok]);
    expect(await fetchVerifiedRole(a.env, 'jwt')).toMatchObject({ ok: false, timedOut: true });
    expect(a.calls()).toBe(1);
  });

  it('never retries a refusal', async () => {
    const a = envWith([status(403), ok]);
    expect(await fetchVerifiedRole(a.env, 'jwt')).toMatchObject({ ok: false, status: 403 });
    expect(a.calls()).toBe(1);
  });

  it('names the reason on the denial page', async () => {
    for (const [responses, text] of [
      [[status(403)], 'Connect found no active account for this sign-in (403)'],
      [[status(401)], 'Connect did not accept the Finance sign-in or contract key (401)'],
      [['throw'], 'the call to Connect failed after'],
      [['timeout'], 'Connect did not answer in time after'],
    ]) {
      const { env } = envWith(responses);
      const res = await worker.fetch(new Request('https://finance.test/', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain(`(Reason: ${text}`);
    }
  });
});
