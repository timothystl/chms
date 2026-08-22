import { describe, it, expect, vi } from 'vitest';
import { handleAdminLogin } from '../src/api-admin.js';

// Review finding (SEC21/P22-F(b)): login rate limiting used a FIXED window key
// (`rl_login:${ip}:${Math.floor(Date.now()/WINDOW_MS)}`). Ten failed attempts right at the end
// of one 15-minute bucket plus ten more right at the start of the next gives twenty back-to-back
// attempts with no wait — the fixed boundary is exactly what an attacker straddles.
//
// Fixed by dropping the bucket suffix: the key is now per-IP only, and every failed attempt
// re-arms the KV entry's TTL (20 min), so the count only actually resets once a full window
// passes with no attempts at all — there is no boundary to straddle.

function makeKvStore() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

function makeReq(username, password) {
  const body = new URLSearchParams({ username, password }).toString();
  return new Request('https://connect.timothystl.org/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.9' },
    body,
  });
}

describe('login rate limiting: sliding window, no fixed-bucket boundary', () => {
  it('uses the same KV key across attempts regardless of which time bucket a fixed-window scheme would land in', async () => {
    const RSVP_STORE = makeKvStore();
    const env = { ADMIN_PASSWORD: 'correct-horse-battery-staple', RSVP_STORE, DB: null };

    // First failed attempt "now"...
    await handleAdminLogin(makeReq('admin', 'wrong-1'), env);
    // ...second failed attempt simulated as if real time had jumped forward across what would
    // have been a 15-minute fixed-bucket boundary. The old scheme keyed on
    // Math.floor(Date.now()/WINDOW_MS), so this would have produced a DIFFERENT key and reset
    // the counter to 1 instead of continuing to 2.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 16 * 60 * 1000;
      await handleAdminLogin(makeReq('admin', 'wrong-2'), env);
    } finally {
      Date.now = realNow;
    }

    const keys = [...RSVP_STORE._store.keys()].filter((k) => k.startsWith('rl_login:'));
    // Exactly one key for this IP — not two separate per-bucket keys — and its count reflects
    // both attempts, proving the "straddle the boundary" reset the old scheme allowed can't happen.
    expect(keys.length).toBe(1);
    expect(RSVP_STORE._store.get(keys[0])).toBe('2');
  });

  it('still blocks after MAX_ATTEMPTS failed attempts from the same IP', async () => {
    const RSVP_STORE = makeKvStore();
    const env = { ADMIN_PASSWORD: 'correct-horse-battery-staple', RSVP_STORE, DB: null };
    let lastRes;
    for (let i = 0; i < 11; i++) {
      lastRes = await handleAdminLogin(makeReq('admin', 'wrong'), env);
    }
    expect(lastRes.status).toBe(429);
  });
});
