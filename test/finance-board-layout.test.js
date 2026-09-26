import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { buildBoardLayoutWrites, buildBoardSections, normalizeBoardLayout } from '../apps/finance/board-layout.js';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

// Account names are fabricated QuickBooks-style labels; no real figures.
const LAYOUT = {
  contract: 'connect.finance-board-layout.v1', dataClassification: 'structural', generatedAt: '2026-09-26T00:00:00Z',
  boardCategories: {
    revenue: { 'Income:40 Giving:40100 Plate': 'donor' }, expense: { 'Expenses:70 Office:70100 Supplies': 'property' },
    revenueLabels: { donor: 'General Offerings' }, expenseLabels: {}, donorWrapperLabel: '',
    accountLabels: { 'Expenses:60 Payroll:60100 Salary - Pastor': 'Pastor salary' },
  },
  purposeTags: { tags: [{ id: 'youth', label: 'Youth' }, { id: 'unused', label: 'Not yet used' }], categories: { 'Expenses:70 Office:70100 Supplies': 'youth' } },
};

const line = (category, classification, name, planned) => ({
  category, classification, name, priorActualCents: planned, baseBudgetCents: planned, projectedCents: planned, projectedOverridden: false,
  plan: { plannedAmountCents: planned, basis: 'manual', growthPct: null, baseAmountCents: null, notes: '' },
});
const FY = new Date().getUTCFullYear() + 1;
const BUILDER = {
  contract: 'connect.finance-budget-builder.v1', targetYear: FY, baseYear: FY - 1, priorYear: FY - 2, throughWeek: 52, prorated: false,
  lines: [
    line('Income:40 Giving:40100 Plate', 'Income', '40100 Plate', 1000000),
    line('Income:40 Giving:40200 Designated Missions', 'Income', '40200 Designated Missions', 200000),
    line('Income:45 Other:45100 Building Rental', 'Income', '45100 Building Rental', 300000),
    line('Income:48 Endowment:48100 Interest', 'Income', '48100 Interest', 50000),
    line('Expenses:60 Payroll:60100 Salary - Pastor', 'Expenses', '60100 Salary - Pastor', 700000),
    line('Expenses:60 Payroll:60200 Pension', 'Expenses', '60200 Pension', 90000),
    line('Expenses:70 Office:70100 Supplies', 'Expenses', '70100 Supplies', 40000),
    line('Expenses:80 Misc:80100 Choir music', 'Expenses', '80100 Choir music', 10000),
  ],
};

describe('board layout (legacy Board view)', () => {
  it('places accounts by saved category, else by name, in legacy order under the Donor Income wrapper', () => {
    const layout = normalizeBoardLayout(LAYOUT);
    const s = buildBoardSections(BUILDER.lines, layout, (l) => ({ path: l.category, name: l.name, isRevenue: l.classification === 'Income' }));
    expect(s.revenue.map((x) => x.label)).toEqual(['Donor Income', 'Earned Income', 'Passive Income']);
    expect(s.revenue[0].groups.map((g) => [g.label, g.items.map((l) => l.name)])).toEqual([
      ['General Offerings', ['40100 Plate']], ['Restricted Gifts', ['40200 Designated Missions']],
    ]);
    expect(s.expense.map((g) => [g.key, g.items.map((l) => l.name)])).toEqual([
      ['salaries', ['60100 Salary - Pastor']], ['benefits', ['60200 Pension']], ['worship', ['80100 Choir music']], ['property', ['70100 Supplies']],
    ]);
  });

  it('turns the editor’s changed rows into merge bodies, moving selected rows only on their own side', () => {
    const f = new URLSearchParams({
      bulk_category: 'expense:programs',
      path_0: 'Expenses:A', side_0: 'expense', orig_cat_0: '', cat_0: '', name_0: '', orig_name_0: '', tag_0: '', orig_tag_0: '', select_0: '1',
      path_1: 'Expenses:B', side_1: 'expense', orig_cat_1: '', cat_1: '', name_1: 'Renamed', orig_name_1: '', tag_1: 'youth', orig_tag_1: '',
      path_2: 'Income:C', side_2: 'revenue', orig_cat_2: 'donor', cat_2: 'donor', name_2: '', orig_name_2: 'Old', tag_2: '', orig_tag_2: '', select_2: '1',
      path_3: 'Income:D', side_3: 'revenue', orig_cat_3: '', cat_3: '', name_3: '', orig_name_3: '', tag_3: '', orig_tag_3: '',
    });
    expect(buildBoardLayoutWrites(f, 'accounts')).toEqual({
      boardBody: { expense: { 'Expenses:A': 'programs' }, accountLabels: { 'Expenses:B': 'Renamed', 'Income:C': '' } },
      tagsBody: { categories: { 'Expenses:B': 'youth' } },
    });
    const none = new URLSearchParams({ path_0: 'Income:D', side_0: 'revenue', orig_cat_0: '', cat_0: '', name_0: '', orig_name_0: '', tag_0: '', orig_tag_0: '' });
    expect(buildBoardLayoutWrites(none, 'accounts')).toEqual({ boardBody: null, tagsBody: null });
    const headings = buildBoardLayoutWrites(new URLSearchParams({ donor_wrapper_label: ' Gifts ', label_expense_mdo: 'Preschool' }), 'headings');
    expect(headings.boardBody.donorWrapperLabel).toBe('Gifts');
    expect(headings.boardBody.expenseLabels).toMatchObject({ mdo: 'Preschool', salaries: '' });
    expect(Object.keys(headings.boardBody.revenueLabels)).toEqual(['donor', 'earned', 'passive', 'restricted']);
  });
});

const CHART = {
  contract: 'connect.finance-chart-of-accounts.v1', dataClassification: 'structural', sourceProduct: 'connect', consumerProduct: 'finance', generatedAt: '2026-09-26T00:00:00Z',
  accounts: [
    { classification: 'Expenses', categoryPath: 'Expenses:60 Payroll', accountName: '60 Payroll', depth: 1, hasChildren: true, boardCategoryKey: 'unassigned', boardCategoryLabel: 'Unassigned', purposeTagId: null, purposeTagLabel: null },
    { classification: 'Expenses', categoryPath: 'Expenses:60 Payroll:60100 Salary - Pastor', accountName: '60100 Salary - Pastor', depth: 2, hasChildren: false, boardCategoryKey: 'unassigned', boardCategoryLabel: 'Unassigned', purposeTagId: null, purposeTagLabel: null },
    { classification: 'Expenses', categoryPath: 'Expenses:70 Office:70100 Supplies', accountName: '70100 Supplies', depth: 2, hasChildren: false, boardCategoryKey: 'property', boardCategoryLabel: 'Property & Operations', purposeTagId: 'youth', purposeTagLabel: 'Youth' },
    { classification: 'Income', categoryPath: 'Income:40 Giving:40100 Plate', accountName: '40100 Plate', depth: 2, hasChildren: false, boardCategoryKey: 'donor', boardCategoryLabel: 'General Offerings', purposeTagId: null, purposeTagLabel: null },
  ],
  reconciliation: { accountCount: 4, incomeCount: 1, expenseCount: 3, unassignedCount: 2 },
};

function makeEnv({ role = 'admin', layoutStatus = 200 } = {}) {
  const calls = [];
  return {
    calls,
    env: {
      ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: { prepare: (sql) => ({ sql }) }, FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: {
        async fetch(req) {
          const url = new URL(req.url);
          const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
          calls.push({ path: url.pathname, body });
          if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions: { finance: 'edit', budget: 'edit' } }));
          if (url.pathname.endsWith('/finance-budget-builder-v1')) return new Response(JSON.stringify(BUILDER));
          if (url.pathname.endsWith('/finance-board-layout-v1')) return layoutStatus === 200 ? new Response(JSON.stringify(LAYOUT)) : new Response('{}', { status: layoutStatus });
          if (url.pathname.endsWith('/finance-chart-of-accounts-v1')) return new Response(JSON.stringify(CHART));
          if (url.pathname.endsWith('-write-v1')) return new Response(JSON.stringify({ ok: true }));
          return new Response('{}', { status: 404 });
        },
      },
    },
  };
}
const get = (env, q) => worker.fetch(new Request(`https://finance.test/?${q}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);

describe('Budget builder and Chart of Accounts board layout', () => {
  it('groups the Budget builder by board category with subtotals, and offers QuickBooks order', async () => {
    const html = await (await get(makeEnv().env, 'section=planning&page=builder')).text();
    expect(html).toContain('<tr class="bb-cat"><td colspan="9">Donor Income</td></tr>');
    expect(html).toContain('<tr class="bb-subcat"><td colspan="9">General Offerings</td></tr>');
    expect(html).toContain('<td>Total General Offerings</td>');
    expect(html).toContain('<td>Total Donor Income</td>');
    expect(html).toContain('<tr class="bb-cat"><td colspan="9">Worship &amp; Music</td></tr>');
    expect(html).toContain('<b>Pastor salary</b>');
    expect(html.indexOf('Salaries</td>')).toBeLessThan(html.indexOf('Benefits</td>'));
    expect(html).toContain('Edit the layout in Chart of Accounts');
    const qb = await (await get(makeEnv().env, 'section=planning&page=builder&view=qb')).text();
    expect(qb).not.toContain('class="bb-cat"');
    expect(qb).toContain('<span class="is-on">QuickBooks order</span>');
    const missing = await (await get(makeEnv({ layoutStatus: 500 }).env, 'section=planning&page=builder')).text();
    expect(missing).toContain('could not be read, so lines are listed in QuickBooks order');
  });

  it('gives an admin the layout editor on Chart of Accounts, with every saved purpose tag', async () => {
    const html = await (await get(makeEnv().env, 'section=accounts&page=chart')).text();
    expect(html).toContain('id="layout"');
    expect(html).toContain('name="label_revenue_donor" value="General Offerings"');
    expect(html).toContain('placeholder="60100 Salary - Pastor"');
    expect(html).toContain('value="Pastor salary"');
    expect(html).toContain('Automatic (Salaries)');
    expect(html).not.toContain('name="path_3"');
    expect(html).toContain('Salaries (automatic)');
    expect(html).toContain('unused,Not yet used');
    const council = await (await get(makeEnv({ role: 'council' }).env, 'section=accounts&page=chart')).text();
    expect(council).not.toContain('id="layout"');
  });

  it('relays a layout save as merge bodies for categories, names and tags', async () => {
    const { env, calls } = makeEnv();
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-board-categories-write', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        form_kind: 'accounts',
        path_0: 'Expenses:60 Payroll:60100 Salary - Pastor', side_0: 'expense', orig_cat_0: '', cat_0: 'benefits', name_0: 'Pastor salary', orig_name_0: 'Pastor salary', tag_0: 'youth', orig_tag_0: '',
      }).toString(),
    }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?section=accounts&page=chart&status=ok#layout');
    expect(calls.find((c) => c.path.endsWith('/finance-board-categories-write-v1')).body).toEqual({ expense: { 'Expenses:60 Payroll:60100 Salary - Pastor': 'benefits' } });
    expect(calls.find((c) => c.path.endsWith('/finance-purpose-tags-write-v1')).body).toEqual({ categories: { 'Expenses:60 Payroll:60100 Salary - Pastor': 'youth' } });
  });
});

describe('connect.finance-board-layout.v1', () => {
  it('returns the saved board categories and purpose tags behind the contract key', async () => {
    const sqlite = new DatabaseSync(':memory:');
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    }
    sqlite.prepare("INSERT INTO finance_settings (key, value) VALUES ('finance_planning_board_categories', ?)").run(JSON.stringify(LAYOUT.boardCategories));
    sqlite.prepare("INSERT INTO finance_settings (key, value) VALUES ('finance_planning_purpose_tags', ?)").run(JSON.stringify(LAYOUT.purposeTags));
    const statement = (sql, args = []) => ({
      bind: (...next) => statement(sql, next),
      async first() { return sqlite.prepare(sql).get(...args); },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    });
    const db = { prepare: (sql) => statement(sql) };
    const call = (key) => handleContractsServiceApi(new Request('https://c.example/api/contracts/finance-board-layout-v1', { headers: { 'X-Contract-Key': key } }), { DB: db, FINANCE_CONTRACT_API_KEY: 'k' }, '/api/contracts/finance-board-layout-v1');
    expect((await call('wrong')).status).toBe(401);
    const body = await (await call('k')).json();
    expect(body.contract).toBe('connect.finance-board-layout.v1');
    expect(body.boardCategories).toMatchObject({ revenueLabels: { donor: 'General Offerings' }, accountLabels: LAYOUT.boardCategories.accountLabels });
    expect(body.purposeTags.tags).toEqual(LAYOUT.purposeTags.tags);
  });
});
