import { describe, expect, it } from 'vitest';
import { decodeJwtClaimsUnsafe } from '../apps/finance/jwt-decode-unsafe.js';

function fakeJwt(payload, header = { alg: 'RS256', kid: 'test' }) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc(header)}.${enc(payload)}.fake-signature-not-checked-here`;
}

describe('decodeJwtClaimsUnsafe', () => {
  it('returns null for a missing or malformed token', () => {
    expect(decodeJwtClaimsUnsafe('')).toBeNull();
    expect(decodeJwtClaimsUnsafe('not-a-jwt')).toBeNull();
    expect(decodeJwtClaimsUnsafe('a.b')).toBeNull();
    expect(decodeJwtClaimsUnsafe('a.!!!not-base64!!!.c')).toBeNull();
  });

  it('reads iss, aud (as an array either way), expiry, and whether an email claim exists', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = fakeJwt({
      iss: 'https://timothystl.cloudflareaccess.com',
      aud: 'bb8fd2d550bee50a2c49c9fa42d212b4f51aff89e2eae17db9c3088b672274de',
      exp: nowSec + 3600,
      email: 'someone@timothystl.org',
    });
    const claims = decodeJwtClaimsUnsafe(token);
    expect(claims.iss).toBe('https://timothystl.cloudflareaccess.com');
    expect(claims.aud).toEqual(['bb8fd2d550bee50a2c49c9fa42d212b4f51aff89e2eae17db9c3088b672274de']);
    expect(claims.expiresInSeconds).toBeGreaterThan(3500);
    expect(claims.expiresInSeconds).toBeLessThanOrEqual(3600);
    expect(claims.emailPresent).toBe(true);
  });

  it('preserves a multi-value aud array as-is', () => {
    const claims = decodeJwtClaimsUnsafe(fakeJwt({ aud: ['app-one', 'app-two'] }));
    expect(claims.aud).toEqual(['app-one', 'app-two']);
  });

  it('reports emailPresent false and a null iss/expiry when those claims are absent', () => {
    const claims = decodeJwtClaimsUnsafe(fakeJwt({}));
    expect(claims).toEqual({ iss: null, aud: [], expiresInSeconds: null, emailPresent: false });
  });

  it('never throws on a payload segment that decodes but is not valid JSON', () => {
    const badPayload = Buffer.from('not json').toString('base64url');
    expect(decodeJwtClaimsUnsafe(`header.${badPayload}.sig`)).toBeNull();
  });
});
