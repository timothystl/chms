import { describe, it, expect } from 'vitest';
import { handleChmsApi } from '../src/api-chms.js';

// Reported 2026-08-03: a member account loaded the directory fine but showed a permanent red
// "Access denied" banner, and the app landed on tabs with nothing behind them.
//
// Cause: the member allowlist listed `member-types`, but the route the frontend actually calls
// is `config/member-types` (api-import.js). The alias never matched, so loadMemberTypes() 403'd
// on every page load — and it was the one boot call with no .catch(), so the rejection painted
// a banner over an otherwise working page.
//
// These exercise the real handleChmsApi ACL, so a future rename of the route breaks the test
// rather than silently 403ing members again.

// handleChmsApi takes (req, env, url, method, seg, role) — seg and role are passed in by
// api-admin.js rather than derived here, so the ACL can be exercised directly.
const ENV = {
  DB: {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: {} }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    }),
    batch: async () => [],
  },
};

/** The ACL decision for `seg` as `role`: 403 when denied, anything else when allowed. */
async function aclStatus(role, seg, method = 'GET') {
  const url = new URL('https://connect.timothystl.org/admin/api/' + seg);
  const req = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  });
  try {
    const res = await handleChmsApi(req, ENV, url, method, seg, role);
    return res ? res.status : 0;
  } catch {
    // A handler past the ACL may fail against the stub DB. That still means the ACL let it
    // through, which is the only thing under test here.
    return 200;
  }
}

const denied = async (role, path, method) => (await aclStatus(role, path, method)) === 403;

describe('member role — what the directory actually needs', () => {
  it('allows config/member-types, the path the frontend really calls', async () => {
    // The regression. Before the fix this was 403 on every member page load.
    expect(await denied('member', 'config/member-types')).toBe(false);
  });

  it('allows the people directory and tags', async () => {
    expect(await denied('member', 'people')).toBe(false);
    expect(await denied('member', 'people/1')).toBe(false);
    expect(await denied('member', 'tags')).toBe(false);
  });
});

describe('member role — what it must still not reach', () => {
  it('denies the dashboard, which is what the Home tab loads', async () => {
    expect(await denied('member', 'dashboard')).toBe(true);
  });

  it('denies households and organizations', async () => {
    expect(await denied('member', 'households')).toBe(true);
    expect(await denied('member', 'organizations')).toBe(true);
  });

  it('denies giving, finance, attendance and funds', async () => {
    for (const p of ['giving', 'giving/batches', 'finance/overview', 'attendance', 'funds']) {
      expect(await denied('member', p), p).toBe(true);
    }
  });

  it('denies every write, including to paths it can read', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await denied('member', 'people/1', m), m).toBe(true);
    }
  });

  it('denies config writes even though config reads are allowed', async () => {
    expect(await denied('member', 'config/member-types', 'PUT')).toBe(true);
  });
});

describe('other roles are unaffected by the member allowlist', () => {
  it('still lets staff reach the dashboard and households', async () => {
    expect(await denied('staff', 'dashboard')).toBe(false);
    expect(await denied('staff', 'households')).toBe(false);
  });

  it('still lets staff and admin read member-types', async () => {
    expect(await denied('staff', 'config/member-types')).toBe(false);
    expect(await denied('admin', 'config/member-types')).toBe(false);
  });
});

describe('member household access (2026-08-04)', () => {
  it('allows GET of a single household, for the directory family chips', () => {
    // Needed by loadQuickViewHousehold. The handler returns a redacted shape for this role.
    return expect(denied('member', 'households/7')).resolves.toBe(false);
  });

  it('still denies the household LIST and every other household route', async () => {
    for (const p of ['households', 'households/no-head-count', 'households/fix-heads',
                     'households/7/sync-address', 'households/7/use-member-photo',
                     'households/7/apply-photo-to-members']) {
      expect(await denied('member', p), p).toBe(true);
    }
  });

  it('still denies writes to a household it can read', async () => {
    for (const m of ['PUT', 'POST', 'DELETE']) {
      expect(await denied('member', 'households/7', m), m).toBe(true);
    }
  });

  it('does not accidentally allow a non-numeric household segment', async () => {
    expect(await denied('member', 'households/abc')).toBe(true);
    expect(await denied('member', 'households/7/giving')).toBe(true);
  });
});
