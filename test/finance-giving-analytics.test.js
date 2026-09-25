import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { projectWhatIf, whatIfBaseline } from '../apps/finance/giving-analytics-pages.js';

const TOTALS = {
  contract: 'connect.giving-analytics.v1', as_of: '2026-09-20', year: 2026, year_elapsed: 0.72,
  totals: { ytd_cents: 61230000, prior_ytd_cents: 58810000, mtd_cents: 4360000, prior_mtd_cents: 4190000, ytd_online_cents: 28170000, prior_ytd_online_cents: 22940000, ytd_gifts: 5200, first_time_givers: 31 },
  months: [
    { month: '2025-01', cents: 7010000 }, { month: '2025-02', cents: 6840000 }, { month: '2025-03', cents: 8290000 }, { month: '2025-09', cents: 7200000 },
    { month: '2026-01', cents: 7280000 }, { month: '2026-02', cents: 6990000 }, { month: '2026-03', cents: 8610000 }, { month: '2026-09', cents: 4360000 },
  ],
  funds: [{ fund_name: 'General Fund', cents: 51200000 }, { fund_name: 'Building Fund', cents: 5800000 }],
  weeks: Array.from({ length: 13 }, (_, i) => ({ week_ending: `2026-${i < 1 ? '06-21' : '09-20'}`, cents: 1600000 + i * 10000, gifts: 90 })),
  households: {
    ytd_households: 398, prior_ytd_households: 390, last_year_households: 399, both_years_households: 347,
    bands: [
      { label: 'Under $500', households: 142, cents: 2840000 }, { label: '$500 – $999', households: 58, cents: 4180000 },
      { label: '$1,000 – $2,499', households: 96, cents: 15830000 }, { label: '$2,500 – $4,999', households: 61, cents: 21460000 },
      { label: '$5,000 – $9,999', households: 31, cents: 20620000 }, { label: '$10,000 and up', households: 10, cents: 26910000 },
    ],
    concentration: { households: 398, deciles: [0.48, 0.17, 0.11, 0.08, 0.06, 0.04, 0.03, 0.01, 0.01, 0.01].map((share) => ({ households: 40, share })), top_ten_share: 0.24, top_ten_share_last_year: 0.27, median_cents: 112000, households_1000_plus: 198 },
    t12_households: 398, t12_cents: 91840000, retained_households: 376, two_years_ago_households: 400,
    new_last_year_households: 24, new_last_year_avg_cents: 104000, last_year_avg_cents: 231000,
  },
  pledges: { pledgers: 212, pledged_cents: 68400000, received_cents: 48630000, given_cents: 50100000, fulfilled: 20, on_pace: 120, behind: 50, not_started: 22 },
};
const PEOPLE = {
  contract: 'connect.giving-analytics-people.v1', as_of: '2026-09-20', year: 2026,
  nudges: {
    done_this_month: 9,
    kinds: [
      { key: 'first_time', label: 'First-time givers', open_count: 1, items: [{ subject_key: 'ge7:2026-09-13', episode: '2026-09-13', name: 'Jordan Ellis', detail: 'First gift 2026-09-13 · General Fund', cents: 15000, assigned_to: 'pastor', done: false }] },
      { key: 'stopped', label: 'Stopped giving', open_count: 1, items: [{ subject_key: 'p:3', episode: '2026-05-03', name: 'Anna Schreiber', detail: 'Last gift 2026-05-03 · gave in 11 of the prior 12 months', cents: 110000, assigned_to: '', done: false }] },
      { key: 'giving_down', label: 'Giving down', open_count: 0, items: [] },
      { key: 'pledge_behind', label: 'Pledge behind', open_count: 0, items: [] },
      { key: 'stepped_up', label: 'Stepped up', open_count: 0, items: [] },
    ],
  },
  statements: { giving_households_ytd: 391, runs: [{ year: 2025, letter_type: 'year_end', email: 309, print: 103, last_sent: '2026-01-21 09:00:00' }] },
  staff: [{ username: 'pastor', name: 'Pastor Dinger' }, { username: 'sarah', name: 'Sarah' }],
};

function makeEnv({ role = 'finance', giving = 'edit', refuse } = {}) {
  const calls = [];
  const env = {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: { prepare: (sql) => ({ sql }) }, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        const body = req.method === 'POST' ? await req.json() : null;
        calls.push({ path: url.pathname, body, jwt: req.headers.get('Cf-Access-Jwt-Assertion') });
        if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions: { finance: 'edit', giving } }));
        if (refuse) return new Response(JSON.stringify({ error: 'Updating a giving follow-up requires Giving edit access' }), { status: 403 });
        if (url.pathname.endsWith('/giving-analytics-v1')) return new Response(JSON.stringify(TOTALS));
        if (url.pathname.endsWith('/giving-analytics-people-v1')) return new Response(JSON.stringify(PEOPLE));
        if (url.pathname.endsWith('/giving-followup-write-v1')) return new Response(JSON.stringify({ ok: true }));
        return new Response('{}', { status: 404 });
      },
    },
  };
  return { env, calls };
}
const get = (env, query) => worker.fetch(new Request(`https://finance.test/?section=giving-analytics${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);
const post = (env, fields, headers = {}) => worker.fetch(new Request('https://finance.test/api/v1/giving-followup-write', {
  method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin', ...headers }, body: new URLSearchParams(fields),
}), env);
const paths = (calls) => calls.map((c) => c.path.split('/').pop());

describe('Giving analytics pages (Finance v3)', () => {
  it('shows Trends from Connect’s totals, naming nobody', async () => {
    const { env, calls } = makeEnv();
    const html = await (await get(env, '')).text();
    expect(html).toContain('<h1 class="page-title">Trends</h1>');
    expect(html).toContain('$612,300');
    expect(html).toContain('+4.1% vs. 2025 to date');
    expect(html).toContain('31 first-time givers this year');
    expect(html).toContain('Up from 39% last year');
    expect(html).toContain('General Fund');
    expect(paths(calls)).toContain('giving-analytics-v1');
    expect(paths(calls)).not.toContain('giving-analytics-people-v1');
  });

  it('compares months and the same days of last year on Year over year', async () => {
    const { env } = makeEnv();
    const html = await (await get(env, '&page=year-over-year')).text();
    expect(html).toContain('Same period 2025');
    expect(html).toContain('347');
    expect(html).toContain('87% of 399 households from 2025 have given again');
    expect(html).toContain('<td>$82,900</td><td>$86,100</td><td class="tone-good">+$3,200</td>');
    expect(html).toContain('Sep (2026 to date; all of 2025)');
    expect(html).toContain('<tr class="total-row"><td>Jan–Aug</td>');
    expect(html).toContain('ga-bar is-best');
  });

  it('lists household bands and pledge progress', async () => {
    const { env } = makeEnv();
    const bands = await (await get(env, '&page=household-bands')).text();
    expect(bands).toContain('<td>$10,000 and up</td><td>10</td><td>3%</td><td>$269,100</td><td>29%</td>');
    expect(bands).toContain('No names are shown on this page.');
    const pledges = await (await get(env, '&page=pledges')).text();
    expect(pledges).toContain('$684,000');
    expect(pledges).toContain('212 pledgers');
    expect(pledges).toContain('71% · 72% of the year gone');
  });

  it('projects next year from adjustable assumptions without saving anything', async () => {
    const base = whatIfBaseline(TOTALS.households);
    expect(base).toMatchObject({ households: 398, average: 2308, retention: 94, new_households: 24 });
    const p = projectWhatIf(base, new URLSearchParams('households=400&average=2400&retention=95&new_households=30'));
    expect(p.returning).toBe(380);
    expect(p.returningCents).toBe(380 * 2400 * 100);
    const { env, calls } = makeEnv();
    const html = await (await get(env, '&page=what-if&households=400&average=2400&retention=95&new_households=30')).text();
    expect(html).toContain('Assumptions for 2027');
    expect(html).toContain('name="retention" value="95"');
    expect(html).toContain('Reset to actual');
    expect(calls.every((c) => c.body === null)).toBe(true);
  });

  it('links statements to Connect, and hides named pages for council', async () => {
    const { env } = makeEnv();
    const html = await (await get(env, '&page=statements')).text();
    expect(html).toContain('Year-end statement · 2025');
    expect(html).toContain('Email 309 · print 103');
    expect(html).toContain('href="https://connect.timothystl.org/?pane=letters#giving"');
    const council = makeEnv({ role: 'council', giving: 'anon' });
    const hidden = await (await get(council.env, '&page=nudges')).text();
    expect(hidden).toContain('Giving nudges name each household');
    expect(hidden).not.toContain('Anna Schreiber');
    expect(paths(council.calls)).not.toContain('giving-analytics-people-v1');
    const preview = makeEnv();
    const previewed = await (await get(preview.env, '&page=statements&council=1')).text();
    expect(previewed).toContain('Giving statements name each household');
    expect(paths(preview.calls)).not.toContain('giving-analytics-people-v1');
  });

  it('shows nudges with assign and done forms, and relays them to Connect', async () => {
    const { env, calls } = makeEnv();
    const html = await (await get(env, '&page=nudges&kind=stopped')).text();
    expect(html).toContain('Anna Schreiber');
    expect(html).toContain('Done this month');
    expect(html).toContain('<option value="pastor">Pastor Dinger</option>');
    expect(html).toContain('value="done"');
    const res = await post(env, { op: 'assign', kind: 'stopped', subject_key: 'p:3', episode: '2026-05-03', assigned_to: 'pastor' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?section=giving-analytics&page=nudges&kind=stopped&status=ok&msg=Nudge+assigned.');
    expect(calls.find((c) => c.path.endsWith('/giving-followup-write-v1')).body).toEqual({ op: 'assign', kind: 'stopped', subject_key: 'p:3', episode: '2026-05-03', assigned_to: 'pastor' });
    const first = await (await get(env, '&page=nudges')).text();
    expect(first).toContain('href="https://connect.timothystl.org/?pane=receipts#giving"');
    const viewOnly = makeEnv({ giving: 'view' });
    expect(await (await get(viewOnly.env, '&page=nudges&kind=stopped')).text()).not.toContain('value="done"');
  });

  it('shows Connect’s refusal and refuses cross-site posts and unknown actions itself', async () => {
    const refused = makeEnv({ refuse: true });
    const res = await post(refused.env, { op: 'done', kind: 'stopped', subject_key: 'p:3', episode: '2026-05-03' });
    expect(decodeURIComponent(res.headers.get('Location').replace(/\+/g, ' '))).toContain('requires Giving edit access');
    const { env, calls } = makeEnv();
    expect((await post(env, { op: 'done', kind: 'stopped' }, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('Location')).toContain('status=error');
    expect((await post(env, { op: 'erase', kind: 'stopped' })).headers.get('Location')).toContain('Unknown+action');
    expect(calls.filter((c) => c.path.endsWith('/giving-followup-write-v1'))).toHaveLength(0);
    const page = await (await get(refused.env, '&page=trends')).text();
    expect(page).toContain('Giving trends could not be read from Connect');
  });

  it('shows giving concentration on Charts, from totals only', async () => {
    const { env, calls } = makeEnv({ role: 'council', giving: 'anon' });
    const html = await (await worker.fetch(new Request('https://finance.test/?section=charts&page=concentration', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env)).text();
    expect(html).toContain('<h1 class="page-title">Giving concentration</h1>');
    expect(html).toContain('24% of giving');
    expect(html).toContain('Down from 27% in 2025');
    expect(html).toContain('$1,120');
    expect(html).toContain('ga-decile-bar is-top');
    expect(html).toContain('<td>Top 50%</td><td>200</td><td>90%</td>');
    expect(paths(calls)).toContain('giving-analytics-v1');
    expect(paths(calls)).not.toContain('giving-analytics-people-v1');
  });
});
