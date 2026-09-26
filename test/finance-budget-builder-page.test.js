import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { summarizeBuilder } from '../apps/finance/planning-builder-pages.js';

const FY = new Date().getUTCFullYear() + 1;
const BUILDER = {
  contract: 'connect.finance-budget-builder.v1', targetYear: FY, baseYear: FY - 1, priorYear: FY - 2, throughWeek: 37.6, prorated: true,
  lines: [
    { category: 'Income:Offerings', classification: 'Income', name: 'Offerings', priorActualCents: 91840000, baseBudgetCents: 96000000, projectedCents: 91845000, projectedOverridden: false, plan: { plannedAmountCents: 94600400, basis: 'grown', growthPct: 0.03, baseAmountCents: 91845000, notes: '' } },
    { category: 'Expenses:Utilities', classification: 'Expenses', name: 'Utilities & insurance', priorActualCents: 8390000, baseBudgetCents: 8800000, projectedCents: 8424000, projectedOverridden: true, plan: { plannedAmountCents: 8845200, basis: 'grown', growthPct: 0.05, baseAmountCents: 8424000, notes: 'Ameren rate case' } },
    { category: 'Expenses:Missions', classification: 'Expenses', name: 'Missions & synod', priorActualCents: 9600000, baseBudgetCents: 9600000, projectedCents: 9600000, projectedOverridden: false, plan: { plannedAmountCents: 9600000, basis: 'manual', growthPct: null, baseAmountCents: null, notes: 'Council goal' } },
    { category: 'Expenses:Office', classification: 'Expenses', name: 'Office', priorActualCents: 4610000, baseBudgetCents: 4800000, projectedCents: 4770000, projectedOverridden: false, plan: null },
  ],
};

function makeEnv({ role = 'admin', builderStatus = 200 } = {}) {
  const calls = [];
  return {
    calls,
    env: {
      ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: { prepare: (sql) => ({ sql }) }, FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: {
        async fetch(req) {
          const url = new URL(req.url);
          const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
          calls.push({ path: url.pathname, search: url.search, body });
          if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions: { finance: 'edit', budget: 'edit', giving: 'edit' } }));
          if (url.pathname.endsWith('/finance-budget-builder-v1')) return builderStatus === 200 ? new Response(JSON.stringify(BUILDER)) : new Response('{}', { status: builderStatus });
          if (url.pathname.includes('generate-all')) return new Response(JSON.stringify({ ok: true, generated: 3 }));
          return new Response('{}', { status: 404 });
        },
      },
    },
  };
}
const get = (env, q = '') => worker.fetch(new Request(`https://finance.test/?section=planning&page=builder${q}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);

describe('Budget builder (Finance v3)', () => {
  it('totals the plan against the base-year budget', () => {
    expect(summarizeBuilder(BUILDER)).toMatchObject({ incomeCents: 94600400, expenseCents: 8845200 + 9600000, grown: 2, manual: 1, planned: 3, unplanned: 1 });
  });

  it('shows every line with last year, this year and next year, editable in place for an admin', async () => {
    const { env, calls } = makeEnv();
    const html = await (await get(env)).text();
    expect(calls.find((c) => c.path.endsWith('/finance-budget-builder-v1')).search).toBe(`?target_year=${FY}`);
    expect(html).toContain('<h1 class="page-title">Budget builder</h1>');
    expect(html).toContain(`FY${String(FY).slice(2)} plan`);
    expect(html).toContain('Utilities &amp; insurance');
    expect(html).toContain('<span class="bb-badge is-grown">Grown</span>');
    expect(html).toContain('<span class="bb-badge is-manual">Manual</span>');
    expect(html).toContain('<span class="bb-badge is-none">Not planned</span>');
    expect(html).toContain('+5%');
    expect(html).toContain('name="planned_amount" step="1" min="0" value="946004"');
    expect(html).toContain('class="is-corrected"');
    expect(html).toContain('Apply to every grown line');
    expect(html).toContain('Ameren rate case');
    expect(html).toContain('2 grown · 1 manual · 1 not planned');
  });

  it('shows the tabs’ other forms and converts a percentage growth rate for Connect', async () => {
    const { env, calls } = makeEnv();
    expect(await (await get(env, '&tab=project')).text()).toContain('Project this line');
    expect(await (await get(env, '&tab=commit')).text()).toContain(`Commit the FY${FY} plan to the Church report`);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-budget-generate-all', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ base_year: String(FY - 1), target_year: String(FY), growth_percent: '3' }),
    }), env);
    expect(res.status).toBe(303);
    const sent = calls.find((c) => c.path.includes('generate-all'));
    expect(Number(sent.body.growth_pct)).toBeCloseTo(0.03, 10);
  });

  it('is read-only for council, and falls back to the older page when the table cannot be read', async () => {
    const council = await (await get(makeEnv({ role: 'council' }).env)).text();
    expect(council).toContain('kept as a private copy');
    expect(council).not.toContain('name="planned_amount"');
    expect(council).not.toContain('Apply to every grown line');
    const fallback = await (await get(makeEnv({ builderStatus: 500 }).env)).text();
    expect(fallback).not.toContain('class="bb-banner"');
  });
});
