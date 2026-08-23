import { describe, it, expect } from 'vitest';
import { handleChmsApi } from '../src/api-chms.js';

// P24-C (retires DSN8). Two COUNCIL1-rename leftovers found by an external review: the
// `roleLabels` map in api-admin.js was missing `council` (already fixed — see the comment
// above `roleLabels` there), and the write-refusal string in api-chms.js still named the
// retired `office` role instead of `council`. This test pins the second one, since nothing
// covered the exact string before.

function makeEnv() {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          run: async () => ({ meta: { last_row_id: 1 } }),
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        run: async () => ({ meta: { last_row_id: 1 } }),
        all: async () => ({ results: [] }),
      }),
      batch: async () => [],
    },
  };
}

describe('write-refusal message names the current role, not the retired one (P24-C)', () => {
  // canEdit is true for every real non-member/non-volunteer role (admin/finance/staff/council),
  // so this specific message only fires as a defense-in-depth catch for a role string that
  // isn't one of the six known ones — still worth pinning, since a stale rename here would
  // otherwise sit unnoticed exactly the way the original "office" wording did.
  it('says "council", never "office", when an unrecognized role tries to write', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/people/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT' }), makeEnv(), url, 'PUT', 'people/1', 'some-unknown-role'
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('council');
    expect(body.error).not.toContain('office');
  });

  it('a council account is not blocked by this canEdit gate at all', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/people/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT', body: '{}' }), makeEnv(), url, 'PUT', 'people/1', 'council'
    );
    // Not the 403 this test is about — it may still fail downstream on the fake DB (people
    // write goes further than this gate), but it must not be blocked by the canEdit check.
    if (res.status === 403) {
      const body = await res.json();
      expect(body.error).not.toMatch(/editing requires/);
    }
  });
});
