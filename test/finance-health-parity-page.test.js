import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../apps/finance/shell.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/api-utils.js';
import { buildFinanceHealthV1 } from '../src/api-finance-health-contract.js';
import { fetchLiveFinanceHealth } from '../apps/finance/finance-health-client.js';
import { layoutFlow, renderHealthParity } from '../apps/finance/health-parity-pages.js';
import { buildHealthEntityOverview } from '../apps/finance/entity-overview-service.js';
import { makeDb, seed } from './finance-health-fixture.js';

// Finance's Financial Health, Full detail: every section of Connect's legacy tab, rendered from
// connect.finance-health.v1 with no script (Finance's CSP allows none).
async function syntheticHealth() {
  const db = makeDb();
  seed(db);
  return buildFinanceHealthV1(db, { fiscalYear: 2026, now: new Date() });
}

const runway = {
  source: 'live', fiscalYear: 2026, asOfDate: '2026-06-30', accountName: '11027 Operating Checking', cashSource: 'balance_sheet',
  operatingCashCents: 2000000, annualExpenseCents: 714286 * 12, monthlyExpenseCents: 714286, runwayMonths: 2000000 / 714286,
  policyFloorMonths: 3, floorCents: 2142858, gapToFloorCents: 142858, daycareExcludedCents: 4000000,
};

describe('Financial Health parity page', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-07-01T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders every section of the legacy tab, with computed decisions instead of static text', async () => {
    const health = await syntheticHealth();
    const html = renderHealthParity(health, { runway, isAdmin: true });
    for (const heading of ['The revenue mix', 'Donor income', 'Earned income', 'Passive income', 'Designated funds',
      'How the money moves', 'The three engines', 'General Fund giving against budget pace', 'Operating cash runway',
      'Five years of the mix', 'What this points to', 'What an appeal would have to look like', 'Lever 1 · Cut',
      'Lever 2 · Distribute', 'Lever 3 · Ask', 'So what do we decide?']) {
      expect(html, heading).toContain(heading);
    }
    expect(html).not.toMatch(/<script|onclick=/i);
    // A: control band and restricted folded into donor. B: households.
    expect(html).toContain('We set the ask');
    expect(html).toContain('Donor includes $1,000 of restricted gifts');
    expect(html).toContain('40 giving households');
    // C: the tie-out, from recorded giving and booked donor income.
    expect(html).toContain('Recorded giving $19,500 − designated $2,500 = <b>$17,000</b> that funds the budget, against $51,000');
    // D: the Sankey is inline SVG, with every node labeled.
    expect(html).toMatch(/<svg class="hp-sankey"[^>]*role="img"/);
    expect(html).toContain('WHERE IT GOES');
    // E: engines on Connect's periods and formulas.
    expect(html).toContain('Projected year-end <b>−$1,714</b>');
    expect(html).toContain('Tuition $30,000 · Costs $31,000');
    expect(html).toContain('$5,000 of utilities &amp; insurance');
    expect(html).toContain('Cash minus reserves · AHRA, 2026-05');
    expect(html).toContain('Occupancy 95%, trailing 12 months.');
    // F, G: pace against the General Fund budget, runway against the policy floor.
    expect(html).toContain('$2,500 given to designated and pass-through funds is not counted here.');
    expect(html).toContain('3-month policy floor');
    expect(html).toContain('takes <b>$1,429</b> more in reserves');
    expect(html).toContain('$40,000 of daycare expense left out');
    // I, J: callout and ladder read the same targets.
    expect(html).toContain('5 waiting');
    expect(html).toContain(`Target <b>$${(health.appeal.gapReserves.totalCents / 100).toLocaleString('en-US')}</b> — close the $1,714 operating gap`);
    expect(html).toContain('6 households already give above $2,000 a year');
    // K, L: levers and decisions carry this year's figures.
    expect(html).toContain('60 Salaries is');
    expect(html).toContain('Size an appeal at $1,714 — or $3,143 with reserves.');
    expect(html).toContain('We have taken $5,000 so far in 2026');
    // The unconfirmed-classification note is for admins only, as on the legacy tab.
    expect(html).toContain('classified by name and never confirmed');
    expect(renderHealthParity(health, { runway, isAdmin: false })).not.toContain('classified by name and never confirmed');
  });

  it('switches the flow view and appeal scope with plain links', async () => {
    const health = await syntheticHealth();
    const flowView = renderHealthParity(health, { runway });
    expect(flowView).toContain('href="/?section=health&amp;view=detail&amp;flow=share#hp-flow"');
    expect(flowView).toContain('href="/?section=health&amp;view=detail&amp;appeal=gap#hp-appeal"');
    const share = renderHealthParity(health, { runway, flow: 'share', appeal: 'gap', councilPreview: true });
    expect(share).toContain('Money in');
    expect(share).toContain('TOTAL EXPENSES');
    expect(share).not.toContain('class="hp-sankey"');
    expect(share).toContain('the projected operating gap alone');
    expect(share).toContain('href="/?section=health&amp;view=detail&amp;flow=share&amp;council=1#hp-appeal"');
  });

  it('says there is no ledger yet instead of drawing zeros', async () => {
    const health = await syntheticHealth();
    const html = renderHealthParity({ ...health, hasLedger: false }, { runway });
    expect(html).toContain('No church ledger data for 2026 yet');
    expect(html).not.toContain('The revenue mix');
  });

  it('lays the flow diagram out so no two labels in a column overlap', async () => {
    const health = await syntheticHealth();
    const layout = layoutFlow(health.flowDiagram);
    for (const column of [layout.sources, layout.streams, layout.expenses]) {
      for (let i = 1; i < column.length; i++) expect(column[i].labelTop).toBeGreaterThanOrEqual(column[i - 1].labelBottom);
    }
  });

  it('puts church and daycare on Connect’s periods in the entity views', async () => {
    const health = await syntheticHealth();
    const overview = buildHealthEntityOverview(health, null);
    expect(overview.entities[0]).toMatchObject({ periodLabel: 'FY2026', incomeCents: 8900000, expenseCents: 9000000, resultCents: -100000 });
    expect(overview.entities[1]).toMatchObject({ periodLabel: '2026', resultCents: -100000, available: true });
    expect(overview.entities[2]).toMatchObject({ id: 'property', available: false });
    const noDaycare = buildHealthEntityOverview({ ...health, daycare: { ...health.daycare, available: false } }, null);
    expect(noDaycare.entities[1].unavailableNote).toBe('No 2026 daycare figures imported yet.');
  });

  it('renders the live sections in Finance, and an honest note when Connect cannot answer', async () => {
    const health = await syntheticHealth();
    const financeDb = { prepare(sql) { return { sql, bind() { return this; }, async all() { throw new Error('no fixture'); }, async first() { throw new Error('no fixture'); } }; }, async batch() { throw new Error('no fixture'); } };
    const envFor = (healthResponse) => ({
      ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_DB: financeDb, FINANCE_CONTRACT_API_KEY: 'test-secret',
      CONNECT_SERVICE: {
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role: 'admin', permissions: DEFAULT_ROLE_PERMISSIONS.admin }));
          if (path === '/api/contracts/finance-health-v1') return healthResponse();
          return new Response('{}', { status: 503 });
        },
      },
    });
    const get = (env) => worker.fetch(new Request('https://finance.test/?section=health&view=detail', { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), env);

    const live = await get(envFor(() => new Response(JSON.stringify(health))));
    expect(live.status).toBe(200);
    const liveHtml = await live.text();
    expect(liveHtml).toContain('How the money moves');
    expect(liveHtml).toContain('So what do we decide?');
    expect(liveHtml).toContain('Size an appeal at $1,714');
    expect(liveHtml).not.toContain('Set the ask and stewardship plan');

    const down = await get(envFor(() => new Response('{}', { status: 500 })));
    expect(down.status).toBe(200);
    const downHtml = await down.text();
    expect(downHtml).toContain('The Financial Health figures from Connect could not be read for this request.');
    expect(downHtml).not.toContain('How the money moves');
    expect(downHtml).toContain('Set the ask and stewardship plan');

    const summary = await worker.fetch(new Request('https://finance.test/?section=health&view=entity', { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), envFor(() => new Response(JSON.stringify(health))));
    const summaryHtml = await summary.text();
    expect(summaryHtml).toContain('Church and Daycare are this year’s figures');
  });

  it('labels client failures instead of throwing', async () => {
    expect(await fetchLiveFinanceHealth({}, 2026)).toEqual({ ok: false, reason: 'not_configured' });
    const bad = await fetchLiveFinanceHealth({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { return new Response('{}'); } } }, 2026);
    expect(bad.reason).toBe('contract_validation_failed');
    let seen;
    await fetchLiveFinanceHealth({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch(req) { seen = req; return new Response('{}', { status: 500 }); } } }, 2026);
    expect(new URL(seen.url).pathname).toBe('/api/contracts/finance-health-v1');
    expect(new URL(seen.url).searchParams.get('fiscal_year')).toBe('2026');
    expect(seen.headers.get('X-Contract-Key')).toBe('x');
  });
});
