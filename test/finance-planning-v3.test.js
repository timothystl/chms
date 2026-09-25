import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { applyScenario, buildForecast, readGrowth } from '../apps/finance/planning-scenarios-service.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';

const FY = new Date().getUTCFullYear() + 1;
const LINES = [
  { category: 'Offerings', classification: 'Income', plannedAmountCents: 94600400, group: 'donor' },
  { category: 'Property distributions', classification: 'Income', plannedAmountCents: 14688000, group: 'passive' },
  { category: 'Daycare reimbursement', classification: 'Income', plannedAmountCents: 9984000, group: 'earned' },
  { category: 'Other income', classification: 'Income', plannedAmountCents: 9600000, group: 'earned' },
  { category: 'Salaries & benefits', classification: 'Expenses', plannedAmountCents: 74420600, group: 'salaries' },
  { category: 'Building & grounds', classification: 'Expenses', plannedAmountCents: 26208000, group: 'property' },
  { category: 'Worship & programs', classification: 'Expenses', plannedAmountCents: 27494700, group: 'programs' },
];
const RUNWAY = {
  contract: 'connect.finance-cash-runway.v1', dataClassification: 'aggregate', sourceProduct: 'connect',
  consumerProduct: 'finance', currency: 'USD', fiscalYear: FY - 1, generatedAt: '2026-09-25T12:00:00Z',
  available: true, onHandCents: 40038000, expensesYtdCents: 90000000, monthsElapsed: 9,
  averageMonthlyExpenseCents: 10000000, monthsOfCash: 4, policyFloorMonths: 3,
  floorCents: 30000000, gapToFloorCents: 0, cashSource: 'balance_sheet',
  cashAccounts: ['Operating checking'], asOfDate: '2026-09-01', daycareExcludedCents: 300000,
  allExpensesYtdCents: 90300000,
};

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
      return out;
    },
  };
}

function makeEnv({ role = 'admin', permissions = { finance: 'edit', budget: 'edit', giving: 'edit' }, basisFails = false, lines = LINES } = {}) {
  const db = makeDb();
  const calls = [];
  const env = {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        calls.push(url.pathname + url.search);
        if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions, identity: 'andrew@example.org' }));
        if (url.pathname.endsWith('/finance-planning-basis-v1')) {
          if (basisFails) return new Response('{}', { status: 500 });
          return new Response(JSON.stringify({ contract: 'connect.finance-planning-basis.v1', fiscalYear: FY, lines, totals: {} }));
        }
        if (url.pathname.endsWith('/finance-cash-runway-v1')) return new Response(JSON.stringify(RUNWAY));
        return new Response('{}', { status: 404 });
      },
    },
  };
  return { env, db, calls };
}
const get = (env, query) => worker.fetch(new Request(`https://finance.test/?section=planning${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);
const post = (env, path, fields, headers = {}) => worker.fetch(new Request(`https://finance.test${path}`, {
  method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin', ...headers }, body: new URLSearchParams(fields),
}), env);

beforeEach(() => resetEnsuredSchemasForTests());

describe('Planning scenarios and forecast math', () => {
  it('applies group percentages to the plan without dropping any line', () => {
    const plan = applyScenario(LINES, { giving_pct: 0, earned_pct: 0, passive_pct: 0, staff_pct: 0, other_pct: 0 });
    expect(plan).toMatchObject({ incomeCents: 128872400, expenseCents: 128123300, resultCents: 749100 });
    const soft = applyScenario(LINES, { giving_pct: -3, earned_pct: 0, passive_pct: -10, staff_pct: 2, other_pct: 0 });
    expect(soft.incomeCents).toBe(128872400 - Math.round(94600400 * 0.03) - Math.round(14688000 * 0.1));
    expect(soft.expenseCents).toBe(128123300 + Math.round(74420600 * 0.02));
    expect(soft.byAdjustment.giving_pct).toEqual({ planCents: 94600400, scenarioCents: Math.round(94600400 * 0.97) });
  });

  it('grows later years and carries cash forward from today', () => {
    const rows = buildForecast({ firstYear: 2027, first: { incomeCents: 128872400, expenseCents: 128123300 }, incomeGrowthPct: 2.5, expenseGrowthPct: 3, startCashCents: 40038000 });
    expect(rows.map((r) => r.fiscalYear)).toEqual([2027, 2028, 2029, 2030, 2031]);
    expect(rows[0]).toMatchObject({ resultCents: 749100, cashCents: 40787100 });
    expect(rows[1].incomeCents).toBe(Math.round(128872400 * 1.025));
    expect(rows[4].resultCents).toBeLessThan(0);
    expect(rows[0].reserveMonths).toBeCloseTo(40787100 / (128123300 / 12), 5);
    expect(buildForecast({ firstYear: 2027, first: { incomeCents: 1, expenseCents: 1 }, incomeGrowthPct: 0, expenseGrowthPct: 0, startCashCents: null })[0].cashCents).toBeNull();
    expect(readGrowth(new URLSearchParams('g=+4.25%'), 'g', 2.5)).toBe(4.3);
    expect(readGrowth(new URLSearchParams('g=99'), 'g', 2.5)).toBe(15);
    expect(readGrowth(new URLSearchParams(''), 'g', 2.5)).toBe(2.5);
  });
});

describe('Planning pages (Finance v3)', () => {
  it('shows three scenarios from the live plan, with the saved plan as the default basis', async () => {
    const { env, calls } = makeEnv();
    const html = await (await get(env, '&page=scenarios')).text();
    expect(html).toContain('<h1 class="page-title">Scenarios</h1>');
    expect(calls).toContain(`/api/contracts/finance-planning-basis-v1?fiscal_year=${FY}`);
    expect(html).toContain('Conservative');
    expect(html).toContain('Hopeful');
    expect(html).toContain('+$7,491');
    expect(html).toContain('<span class="pl-basis-tag">Basis for council</span>');
    expect(html).toContain('Use this scenario');
    expect(html).toContain('Adjust Conservative');
    expect(html).toContain('<b>Staff costs:</b> Salaries &amp; benefits');
  });

  it('saves a scenario and a basis in Finance’s own tables, and refuses other roles', async () => {
    const { env, db } = makeEnv();
    const save = await post(env, '/api/v1/planning/scenario-save', { fiscal_year: String(FY), slot: 'conservative', name: 'Soft year', note: 'Giving down', giving_pct: '-5', earned_pct: '0', passive_pct: '-10', staff_pct: '0', other_pct: '-2.5' });
    expect(save.status).toBe(303);
    expect(save.headers.get('Location')).toBe('/?section=planning&page=scenarios&status=ok');
    expect(db.sqlite.prepare('SELECT name, giving_pct, other_pct, updated_by FROM finance_planning_scenarios').get()).toEqual({ name: 'Soft year', giving_pct: -5, other_pct: -2.5, updated_by: 'andrew@example.org' });
    const bad = await post(env, '/api/v1/planning/scenario-save', { fiscal_year: String(FY), slot: 'conservative', name: 'x', giving_pct: '-80', earned_pct: '0', passive_pct: '0', staff_pct: '0', other_pct: '0' });
    expect(decodeURIComponent(bad.headers.get('Location'))).toContain('reason=invalid');
    expect((await post(env, '/api/v1/planning/scenario-save', { fiscal_year: String(FY), slot: 'plan', name: 'x' })).headers.get('Location')).toContain('reason=invalid');
    await post(env, '/api/v1/planning/scenario-basis', { fiscal_year: String(FY), slot: 'conservative' });
    const html = await (await get(env, '&page=scenarios')).text();
    expect(html).toContain('Soft year');
    expect(html.indexOf('pl-card is-basis')).toBeLessThan(html.indexOf('Budget plan</h2>'));
    resetEnsuredSchemasForTests();
    const staff = makeEnv({ role: 'staff', permissions: { finance: 'view', budget: 'view', giving: 'view' } });
    expect((await post(staff.env, '/api/v1/planning/scenario-basis', { fiscal_year: String(FY), slot: 'hopeful' })).headers.get('Location')).toContain('access_denied');
    expect(await (await get(staff.env, '&page=scenarios')).text()).not.toContain('Use this scenario');
    expect((await post(env, '/api/v1/planning/scenario-basis', { fiscal_year: String(FY), slot: 'hopeful' }, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('Location')).toContain('cross_site');
  });

  it('forecasts five years from the basis scenario and today’s operating cash', async () => {
    const { env } = makeEnv();
    const html = await (await get(env, '&page=multi-year')).text();
    expect(html).toContain('<h1 class="page-title">Multi-year forecast</h1>');
    expect(html).toContain(`FY${FY + 4} result`);
    expect(html).toContain('Starting from $400,380 today');
    expect(html).toContain('Council target: 3 months');
    expect(html).toContain('<td>$407,871</td>');
    expect(html).toContain('name="income_growth" value="2.5"');
    const custom = await (await get(env, '&page=multi-year&scenario=hopeful&income_growth=4&expense_growth=2')).text();
    expect(custom).toContain('name="income_growth" value="4"');
    expect(custom).toContain('<span class="chip is-on">Hopeful</span>');
  });

  it('says so plainly when the plan cannot be read or does not exist yet', async () => {
    const failing = makeEnv({ basisFails: true });
    expect(await (await get(failing.env, '&page=scenarios')).text()).toContain('could not be read from Connect');
    const empty = makeEnv({ lines: [] });
    resetEnsuredSchemasForTests();
    expect(await (await get(empty.env, '&page=multi-year')).text()).toContain(`No FY${FY} budget plan yet`);
  });
});
