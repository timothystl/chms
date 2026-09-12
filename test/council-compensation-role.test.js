import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/api-admin.js';
import { authCookieHeader } from '../src/auth.js';

// Council gets a narrower, per-user slice of the Compensation Planner. Finance is three
// independently grantable items for every configurable role (see financeSegItems in
// api-chms.js): plain `finance` (the rest of the Finance workspace), `compensation` (this
// tab) and `budget` (the Budget/Planning tab). Council's defaults are finance:'none',
// compensation:'edit', budget:'none' — so out of the box it reaches only the Compensation
// Planner, same practical result as before this item existed, but now a real, independently
// toggleable permission rather than a hardcoded role-based carve-out.
//
// Unlike the dedicated `compensation` role (one shared fork), council's own save is further
// restricted: only the raise PLAN — the roster-wide/per-worker raise method, the custom/scale
// percentages, and the baseline-only comparison toggle — never a worker's seed facts or a
// hand-typed dollar override. Every council save lands under a key scoped to that user's own
// username (api-finance.js), so one council member's plan can never overwrite another's or the
// real admin/finance plan. api-finance.js's PUT handler for this segment still only recognizes
// admin, the dedicated `compensation` role and `council` by name — granting finance/staff the
// `compensation` item only affects what they can reach/see, not this write, unless that inner
// check is later widened too.

const SECRET = 'test-signing-secret';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  )`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
  sqlite.exec(`CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  sqlite.exec(`CREATE TABLE finance_church_balances (
    fiscal_year INTEGER,
    category_path TEXT,
    as_of_date TEXT
  )`);
  sqlite.exec(`CREATE TABLE finance_budget_plan (
    category             TEXT    NOT NULL,
    classification        TEXT    NOT NULL DEFAULT 'Expenses',
    fiscal_year           INTEGER NOT NULL,
    planned_amount_cents  INTEGER NOT NULL DEFAULT 0,
    basis                 TEXT    NOT NULL DEFAULT 'manual',
    growth_pct            REAL,
    base_amount_cents     INTEGER,
    notes                 TEXT    NOT NULL DEFAULT '',
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (category, fiscal_year)
  )`);
  sqlite.exec(`CREATE TABLE finance_qb_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    realm_id TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    access_token_expires_at TEXT NOT NULL DEFAULT '',
    refresh_token_expires_at TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL DEFAULT 'production',
    connected_at TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT NOT NULL DEFAULT ''
  )`);
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
    batch(stmts) { return Promise.all(stmts.map(s => s.run())); },
  };
  return { db, sqlite };
}

let db, sqlite, env;
beforeEach(() => {
  ({ db, sqlite } = makeDb());
  env = { DB: db, ADMIN_PASSWORD: SECRET, SESSION_SECRET: SECRET };
  // getAuthInfo live-checks any username-bearing cookie against app_users on every request
  // (auth.js), so each council login needs a real, active row here — unlike the admin/
  // break-glass cookies elsewhere in this file, which carry no username and skip that check.
  sqlite.prepare(`INSERT INTO app_users (username, role, active) VALUES (?, 'council', 1)`).run('elder1');
  sqlite.prepare(`INSERT INTO app_users (username, role, active) VALUES (?, 'council', 1)`).run('elder2');
});

async function call(role, username, path, method, body) {
  const cookie = (await authCookieHeader(env, role, username || '')).split(';')[0];
  const url = new URL('https://connect.timothystl.org/admin/api/' + path);
  const req = new Request(url, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleAdminApi(req, env, url, method);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

describe('council role — GET /admin/api/me', () => {
  it('resolves finance:none, compensation:edit, budget:none, and giving:anon', async () => {
    const r = await call('council', 'elder1', 'me', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('council');
    expect(r.body.permissions.finance).toBe('none');
    expect(r.body.permissions.compensation).toBe('edit');
    expect(r.body.permissions.budget).toBe('none');
    expect(r.body.permissions.giving).toBe('anon');
    expect(r.body.permissions.register).toBe('none');
  });
});

describe('council role — Compensation Planner reads', () => {
  it('can read the bootstrap segments the tab needs', async () => {
    // finance/overview/finance/daycare/etc. are also grantable via 'compensation' alone
    // (financeSegItems in api-chms.js) but pull in QuickBooks/daycare tables this minimal
    // harness doesn't model; finance/status and finance/planning/salary are the two exercised
    // by compensation-role.test.js for the same reason and are representative of the read path
    // being tested here.
    for (const seg of ['finance/status', 'finance/planning/salary']) {
      const r = await call('council', 'elder1', seg, 'GET');
      expect(r.status, seg).toBe(200);
    }
  });

  it('403s the rest of the Finance module (finance:\'none\' by default)', async () => {
    for (const seg of ['finance/church/balances', 'finance/qb/connect', 'finance/property/detail']) {
      const r = await call('council', 'elder1', seg, 'GET');
      expect(r.status, seg).toBe(403);
    }
  });

  it('reaches those same segments once an admin grants council plain Finance access', async () => {
    // Confirms 'finance' still means the rest of the workspace and is independent of
    // 'compensation' — granting one doesn't require or imply the other.
    const configRes = await call('admin', '', 'config/role-permissions', 'PUT', {
      permissions: { council: { finance: 'view' } },
    });
    expect(configRes.status).toBe(200);
    const r = await call('council', 'elder1', 'finance/church/balances', 'GET');
    expect(r.status).toBe(200);
  });

  it('the Budget toggle passes council through the outer gate; granted "edit" it may hand-correct a Plan figure, forked into its own key', async () => {
    // finance/planning/church/override needs 'finance' or 'budget' (financeSegItems); with
    // neither granted, council 403s before ever reaching api-finance.js.
    const before = await call('council', 'elder1', 'finance/planning/church/override', 'POST', { category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: 100 });
    expect(before.status).toBe(403);
    expect(before.body.error).toMatch(/Access denied/);
    await call('admin', '', 'config/role-permissions', 'PUT', { permissions: { council: { budget: 'edit' } } });
    // A real admin/finance figure for the same category+year, to confirm council's edit never
    // touches it (Andrew, 2026-09-09: "preserve the admin budget data on its own").
    sqlite.prepare(
      `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis) VALUES (?,?,?,?,?)`
    ).run('Expenses:Utilities', 'Expenses', 2027, 500000, 'manual');
    const after = await call('council', 'elder1', 'finance/planning/church/override', 'POST', { category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: 100 });
    expect(after.status).toBe(200);
    // The shared table — what admin/finance and every other viewer sees — is untouched.
    const sharedRow = sqlite.prepare(`SELECT planned_amount_cents FROM finance_budget_plan WHERE category=? AND fiscal_year=?`).get('Expenses:Utilities', 2027);
    expect(sharedRow.planned_amount_cents).toBe(500000);
    // Council's own GET sees their $100 in place of the shared $5,000 figure.
    const councilGet = await call('council', 'elder1', 'finance/planning/church', 'GET');
    expect(councilGet.status).toBe(200);
    const councilRow = councilGet.body.rows.find(r => r.category === 'Expenses:Utilities' && r.fiscal_year === 2027);
    expect(councilRow.planned_amount_cents).toBe(10000);
    // A second council login is isolated: still sees the real shared $5,000 figure, never
    // elder1's fork.
    const elder2Get = await call('council', 'elder2', 'finance/planning/church', 'GET');
    const elder2Row = elder2Get.body.rows.find(r => r.category === 'Expenses:Utilities' && r.fiscal_year === 2027);
    expect(elder2Row.planned_amount_cents).toBe(500000);
  });

  it('keeps Generate All / Commit / Base Projected / Actual corrections admin-only even with Budget:edit', async () => {
    await call('admin', '', 'config/role-permissions', 'PUT', { permissions: { council: { budget: 'edit' } } });
    const generateAll = await call('council', 'elder1', 'finance/planning/church/generate-all', 'POST', { base_year: 2026, target_year: 2027, growth_pct: 0.03 });
    expect(generateAll.status).toBe(403);
    expect(generateAll.body.error).toMatch(/admin access/);
    const commit = await call('council', 'elder1', 'finance/planning/church/commit', 'POST', { fiscal_year: 2027 });
    expect(commit.status).toBe(403);
    const baseProj = await call('council', 'elder1', 'finance/planning/base-projection', 'PUT', { year: 2026, rows: [] });
    expect(baseProj.status).toBe(403);
    const actualOverride = await call('council', 'elder1', 'finance/church/actual-override', 'PUT', { year: 2026, rows: [{ category: 'Expenses:Utilities', amount: 1 }] });
    expect(actualOverride.status).toBe(403);
  });

  it('403s everywhere else in the app the way a normal council session would not', async () => {
    const r = await call('council', 'elder1', 'finance/planning/church/override-bulk', 'POST', { rows: [] });
    expect(r.status).toBe(403);
  });
});

describe('council role — saving the plan', () => {
  it('saves only the raise-plan fields, into a key scoped to this username', async () => {
    const r = await call('council', 'elder1', 'finance/planning/salary', 'PUT', {
      roster: [{ name: 'Smuggled Seed Edit', actualSalaryCents: 1 }],
      compMethod: 'custom', compCustomPct: 4.25, compBaselineRosterOnly: true,
      compOverrides: { 0: '999999' },
      targetCategory: 'Smuggled Category',
    });
    expect(r.status).toBe(200);
    const stored = JSON.parse(sqlite.prepare("SELECT value FROM finance_settings WHERE key='finance_salary_planner_council_elder1'").get().value);
    expect(stored.compMethod).toBe('custom');
    expect(stored.compCustomPct).toBe(4.25);
    expect(stored.compBaselineRosterOnly).toBe(true);
    // Everything outside COUNCIL_EDITABLE_FIELDS is dropped, even though the client sent it.
    expect(stored.roster).toBeUndefined();
    expect(stored.compOverrides).toBeUndefined();
    expect(stored.targetCategory).toBeUndefined();
    // And the shared admin/finance roster was never touched.
    expect(sqlite.prepare("SELECT value FROM finance_settings WHERE key='finance_salary_planner'").get()).toBeFalsy();
  });

  it('never lets a council save overwrite the real admin/finance plan', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Admin Worker' }], compMethod: 'cola' });
    await call('council', 'elder1', 'finance/planning/salary', 'PUT', { compMethod: 'custom', compCustomPct: 10 });
    const adminRead = await call('admin', '', 'finance/planning/salary', 'GET');
    expect(adminRead.body.data.roster[0].name).toBe('Admin Worker');
    expect(adminRead.body.data.compMethod).toBe('cola');
  });

  it("layers this council member's plan choices on top of the real roster, not in place of it", async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', {
      roster: [{ name: 'Real Worker', actualSalaryCents: 5000000 }], compMethod: 'cola',
    });
    await call('council', 'elder1', 'finance/planning/salary', 'PUT', { compMethod: 'custom', compScalePct: 90 });
    const r = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    expect(r.body.data.roster[0].name).toBe('Real Worker');       // seed data: the real roster
    expect(r.body.data.roster[0].actualSalaryCents).toBe(5000000);
    expect(r.body.data.compMethod).toBe('custom');                // this member's own plan choice
    expect(r.body.data.compScalePct).toBe(90);
  });

  it('two council members never see or overwrite each other\'s plan', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Real Worker' }], compMethod: 'cola' });
    await call('council', 'elder1', 'finance/planning/salary', 'PUT', { compMethod: 'custom', compCustomPct: 2 });
    await call('council', 'elder2', 'finance/planning/salary', 'PUT', { compMethod: 'scalepct', compScalePct: 80 });
    const r1 = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    const r2 = await call('council', 'elder2', 'finance/planning/salary', 'GET');
    expect(r1.body.data.compMethod).toBe('custom');
    expect(r1.body.data.compCustomPct).toBe(2);
    expect(r2.body.data.compMethod).toBe('scalepct');
    expect(r2.body.data.compScalePct).toBe(80);
    // Both still see the same real roster underneath.
    expect(r1.body.data.roster[0].name).toBe('Real Worker');
    expect(r2.body.data.roster[0].name).toBe('Real Worker');
  });

  it('before saving, reads the same shared roster everyone else starts from', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Admin Worker' }] });
    const r = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    expect(r.body.data.roster[0].name).toBe('Admin Worker');
  });
});

describe('council role — a hideFromCouncil worker never reaches a council session', () => {
  it('drops the flagged worker from the roster council receives, admin still sees everyone', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', {
      roster: [
        { name: 'Visible One' },
        { name: 'Hidden Worker', hideFromCouncil: true },
        { name: 'Visible Two' },
      ],
    });
    const adminRead = await call('admin', '', 'finance/planning/salary', 'GET');
    expect(adminRead.body.data.roster.map(w => w.name)).toEqual(['Visible One', 'Hidden Worker', 'Visible Two']);
    const councilRead = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    expect(councilRead.body.data.roster.map(w => w.name)).toEqual(['Visible One', 'Visible Two']);
  });

  it('re-indexes compPerWorkerMethod/compOverrides so they still point at the right worker', async () => {
    // Index 1 (Hidden Worker) is removed, so index 2 (Visible Two) becomes the new index 1 —
    // its per-worker method and hand-typed override must move with it, not stay at "1" and land
    // on whoever now sits there.
    await call('admin', '', 'finance/planning/salary', 'PUT', {
      roster: [
        { name: 'Visible One' },
        { name: 'Hidden Worker', hideFromCouncil: true },
        { name: 'Visible Two' },
      ],
      compPerWorkerMethod: { 0: 'worksheet', 1: 'cola', 2: 'custom' },
      compOverrides: { 2: '99000' },
    });
    const r = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    expect(r.body.data.roster.map(w => w.name)).toEqual(['Visible One', 'Visible Two']);
    expect(r.body.data.compPerWorkerMethod).toEqual({ 0: 'worksheet', 1: 'custom' });
    expect(r.body.data.compOverrides).toEqual({ 1: '99000' });
  });
});
