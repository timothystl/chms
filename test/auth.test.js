import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('hashPassword / verifyPassword', () => {
  it('returns a stored string in pbkdf2:<salt>:<hash> format', async () => {
    const stored = await hashPassword('correcthorsebatterystaple');
    expect(stored).toMatch(/^pbkdf2:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('round-trips: verifyPassword returns true for the original password', async () => {
    const stored = await hashPassword('MyP@ssw0rd!');
    expect(await verifyPassword('MyP@ssw0rd!', stored)).toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const stored = await hashPassword('correctPassword');
    expect(await verifyPassword('wrongPassword', stored)).toBe(false);
  });

  it('returns false for an empty password against a real hash', async () => {
    const stored = await hashPassword('secret');
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('each call produces a different salt (different stored string)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed stored value', async () => {
    expect(await verifyPassword('anything', 'notpbkdf2')).toBe(false);
    expect(await verifyPassword('anything', 'pbkdf2:onlyone')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('handles passwords with unicode characters', async () => {
    const stored = await hashPassword('pässwörд🔐');
    expect(await verifyPassword('pässwörд🔐', stored)).toBe(true);
    expect(await verifyPassword('passWord', stored)).toBe(false);
  });
});
