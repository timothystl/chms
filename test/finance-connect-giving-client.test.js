import { describe, it, expect } from 'vitest';
import { fetchLiveConnectGivingSummary, defaultLiveGivingPeriod, postConnectGivingQuickEntry } from '../apps/finance/connect-giving-client.js';
import validExample from '../contracts/examples/giving-summary-v1.synthetic.json';

const PERIOD = { startDate: '2026-01-01', endDate: '2026-01-31' };
const ENTRY = { date: '2026-01-15', fund_id: '9', amount: '50.00', method: 'check' };

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchLiveConnectGivingSummary', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveConnectGivingSummary({ FINANCE_CONTRACT_API_KEY: 'x' }, PERIOD);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveConnectGivingSummary({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, PERIOD);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and the requested period, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(validExample), { status: 200 });
    });
    const result = await fetchLiveConnectGivingSummary(env, PERIOD);
    expect(result.ok).toBe(true);
    expect(result.summary.contract).toBe('connect.giving-summary.v1');
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/connect-giving-summary-v1');
    expect(url.searchParams.get('from')).toBe('2026-01-01');
    expect(url.searchParams.get('to')).toBe('2026-01-31');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveConnectGivingSummary(env, PERIOD);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network_error');
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveConnectGivingSummary(env, PERIOD);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveConnectGivingSummary(env, PERIOD);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.giving-summary.v1' }), { status: 200 }));
    const result = await fetchLiveConnectGivingSummary(env, PERIOD);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});

describe('postConnectGivingQuickEntry', () => {
  it('is not_configured when the service binding or shared secret is missing', async () => {
    expect(await postConnectGivingQuickEntry({ FINANCE_CONTRACT_API_KEY: 'x' }, 'jwt', ENTRY))
      .toEqual({ ok: false, reason: 'not_configured' });
    expect(await postConnectGivingQuickEntry({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, 'jwt', ENTRY))
      .toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is no_access_identity when there is no Access JWT to forward, without ever calling out', async () => {
    let called = false;
    const env = envWith(async () => { called = true; return new Response('{}'); });
    const result = await postConnectGivingQuickEntry(env, '', ENTRY);
    expect(result).toEqual({ ok: false, reason: 'no_access_identity' });
    expect(called).toBe(false);
  });

  it('POSTs the entry as JSON with the shared secret and the forwarded Access JWT, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify({ id: 42, batch_id: 7, enteredBy: 'sarah' }), { status: 200 });
    });
    const result = await postConnectGivingQuickEntry(env, 'signed.jwt.here', ENTRY);
    expect(result).toEqual({ ok: true, result: { id: 42, batch_id: 7, enteredBy: 'sarah' } });
    expect(capturedRequest.method).toBe('POST');
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    expect(capturedRequest.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/giving-quick-entry-v1');
    expect(JSON.parse(await capturedRequest.text())).toEqual(ENTRY);
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await postConnectGivingQuickEntry(env, 'signed.jwt.here', ENTRY);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network_error');
  });

  it('surfaces Connect\'s own refusal message on a non-200 response, rather than a bare status', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }));
    const result = await postConnectGivingQuickEntry(env, 'signed.jwt.here', ENTRY);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 403, message: 'Access denied' });
  });

  it('fails closed on malformed JSON instead of assuming success or failure', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await postConnectGivingQuickEntry(env, 'signed.jwt.here', ENTRY);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });
});

describe('defaultLiveGivingPeriod', () => {
  it('ends yesterday and starts January 1 of that same year, so it is never a future period', () => {
    const period = defaultLiveGivingPeriod(new Date('2026-06-15T12:00:00Z'));
    expect(period).toEqual({ startDate: '2026-01-01', endDate: '2026-06-14' });
  });

  it('rolls back to the prior year on January 1, rather than crossing into a future-looking January 1 start', () => {
    const period = defaultLiveGivingPeriod(new Date('2026-01-01T00:30:00Z'));
    expect(period).toEqual({ startDate: '2025-01-01', endDate: '2025-12-31' });
  });
});
