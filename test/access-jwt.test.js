import { describe, it, expect, beforeEach } from 'vitest';
import { verifyAccessJwt, resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}
function b64urlToUint8Array(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlDecodeJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToUint8Array(str)));
}

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
}

async function signToken(privateKey, kid, payload, { alg = 'RS256' } = {}) {
  const header = { alg, kid, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

function validPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    email: 'bookkeeper@timothystl.org',
    iss: `https://${TEAM}`,
    aud: AUD,
    exp: now + 3600,
    iat: now,
    ...overrides,
  };
}

describe('verifyAccessJwt', () => {
  let keyPair, jwk, kid;

  beforeEach(async () => {
    resetAccessJwtCacheForTests();
    kid = 'test-kid-1';
    keyPair = await makeKeyPair();
    jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    jwk.kid = kid;
    jwk.alg = 'RS256';
    jwk.use = 'sig';
  });

  function mockFetch(keysOverride) {
    return async (url) => {
      expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      return new Response(JSON.stringify({ keys: keysOverride || [jwk] }), { status: 200 });
    };
  }

  it('accepts a validly signed, current token and returns the lowercased email', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload({ email: 'Bookkeeper@TimothySTL.org' }));
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBe('bookkeeper@timothystl.org');
  });

  it('caches the JWKS fetch across calls instead of refetching every time', async () => {
    let fetchCount = 0;
    const fi = async (url) => { fetchCount++; return mockFetch()(url); };
    const token = await signToken(keyPair.privateKey, kid, validPayload());
    await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: fi });
    await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: fi });
    expect(fetchCount).toBe(1);
  });

  it('rejects when the token or required config is missing', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload());
    expect(await verifyAccessJwt('', { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() })).toBeNull();
    expect(await verifyAccessJwt(null, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() })).toBeNull();
    expect(await verifyAccessJwt(token, { teamDomain: '', audience: AUD, fetchImpl: mockFetch() })).toBeNull();
    expect(await verifyAccessJwt(token, { teamDomain: TEAM, audience: '', fetchImpl: mockFetch() })).toBeNull();
  });

  it('rejects a malformed token that is not three dot-separated parts', async () => {
    expect(await verifyAccessJwt('not-a-jwt', { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() })).toBeNull();
  });

  it('rejects alg:none and other non-RS256 algorithms rather than trusting the header', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload(), { alg: 'none' });
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('rejects a token signed by a key that is not the one published under its kid', async () => {
    const attackerKeyPair = await makeKeyPair();
    // Same kid as the real, published key -- but signed with a different private key.
    const token = await signToken(attackerKeyPair.privateKey, kid, validPayload());
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('rejects a tampered payload even though the signature segment is untouched', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload());
    const [h, p, s] = token.split('.');
    const tampered = b64urlJson({ ...b64urlDecodeJson(p), email: 'attacker@evil.example' });
    const email = await verifyAccessJwt(`${h}.${tampered}.${s}`, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload({ exp: Math.floor(Date.now() / 1000) - 10 }));
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('rejects a not-yet-valid token (nbf in the future)', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload({ nbf: Math.floor(Date.now() / 1000) + 3600 }));
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('rejects the wrong audience', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload({ aud: 'someone-elses-app' }));
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('accepts an array-form aud claim that includes the expected audience', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload({ aud: [AUD, 'other-app'] }));
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBe('bookkeeper@timothystl.org');
  });

  it('rejects the wrong issuer', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload({ iss: 'https://someone-else.cloudflareaccess.com' }));
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('rejects a token with no email claim', async () => {
    const payload = validPayload();
    delete payload.email;
    const token = await signToken(keyPair.privateKey, kid, payload);
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch() });
    expect(email).toBeNull();
  });

  it('re-fetches the JWKS once when the kid is unknown, to tolerate key rotation', async () => {
    const rotatedKeyPair = await makeKeyPair();
    const rotatedJwk = await crypto.subtle.exportKey('jwk', rotatedKeyPair.publicKey);
    rotatedJwk.kid = 'rotated-kid';

    let fetchCount = 0;
    const fi = async (url) => {
      fetchCount++;
      const keys = fetchCount === 1 ? [jwk] : [rotatedJwk]; // simulates Access having rotated keys
      expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      return new Response(JSON.stringify({ keys }), { status: 200 });
    };

    // Prime the cache with the pre-rotation key set.
    await verifyAccessJwt(await signToken(keyPair.privateKey, kid, validPayload()), {
      teamDomain: TEAM, audience: AUD, fetchImpl: fi,
    });
    expect(fetchCount).toBe(1);

    // A token signed with the new key isn't in the cached set -- must force a refetch, not just fail.
    const rotatedToken = await signToken(rotatedKeyPair.privateKey, 'rotated-kid', validPayload());
    const email = await verifyAccessJwt(rotatedToken, { teamDomain: TEAM, audience: AUD, fetchImpl: fi });
    expect(fetchCount).toBe(2);
    expect(email).toBe('bookkeeper@timothystl.org');
  });

  it('gives up (does not loop) if the kid is still unknown after one refetch', async () => {
    let fetchCount = 0;
    const fi = async (url) => { fetchCount++; return mockFetch()(url); }; // always serves the same one key
    const token = await signToken(keyPair.privateKey, 'a-kid-that-was-never-published', validPayload());
    const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: fi });
    expect(email).toBeNull();
    expect(fetchCount).toBe(2); // one initial fetch + one forced refetch, then stop
  });

  it('fails closed, without throwing, if the certs endpoint errors', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload());
    const email = await verifyAccessJwt(token, {
      teamDomain: TEAM, audience: AUD, fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    expect(email).toBeNull();
  });

  it('fails closed if the certs endpoint is unreachable', async () => {
    const token = await signToken(keyPair.privateKey, kid, validPayload());
    const email = await verifyAccessJwt(token, {
      teamDomain: TEAM, audience: AUD, fetchImpl: async () => { throw new Error('network down'); },
    });
    expect(email).toBeNull();
  });
});
