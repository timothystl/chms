import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { cashCount } from '../apps/finance/gift-batch-pages.js';

const WORKSPACE = {
  contract: 'connect.giving-batch-workspace.v1',
  funds: [{ id: 1, name: 'General Fund' }, { id: 2, name: 'Missions' }],
  open_batches: [{ id: 1039, batch_date: '2026-09-27', description: 'Sunday · plate & envelopes', closed: 0, entry_count: 3, total_cents: 26425, deposit_status: { key: 'needs_deposit', label: 'Needs deposit' } }],
  week: { gift_count: 38, total_cents: 486000 },
  people: [{ id: 7, first_name: 'Walter', last_name: 'Krause', envelope_number: '212' }],
  batch: {
    id: 1039, batch_date: '2026-09-27', description: 'Sunday · plate & envelopes', closed: 0, total_cents: 26425,
    entries: [
      { id: 1, amount: 10000, method: 'check', check_number: '2207', notes: '', fund_name: 'General Fund', person_name: 'Walter Krause', envelope_number: '212' },
      { id: 2, amount: 5025, method: 'check', check_number: '2207', notes: '', fund_name: 'Missions', person_name: 'Walter Krause', envelope_number: '212' },
      { id: 3, amount: 11400, method: 'cash', check_number: '', notes: 'Loose cash', fund_name: 'General Fund', person_name: '', envelope_number: '' },
    ],
    fund_totals: [{ fund_name: 'General Fund', cents: 21400 }, { fund_name: 'Missions', cents: 5025 }],
    method_totals: [{ method: 'check', cents: 15025 }, { method: 'cash', cents: 11400 }],
  },
};
const LEDGER = {
  contract: 'connect.giving-batch-ledger.v1',
  batches: [
    { id: 1040, batch_date: '2026-09-24', description: 'Midweek gifts', closed: 1, entry_count: 4, total_cents: 134000, deposit_status: { key: 'needs_deposit', label: 'Needs deposit', remaining_cents: 134000 } },
    { id: 1039, batch_date: '2026-09-20', description: 'Sunday · plate & envelopes', closed: 1, entry_count: 84, total_cents: 812000, deposit_status: { key: 'unreconciled', label: 'Unreconciled' } },
    { id: 1038, batch_date: '2026-09-13', description: 'Sunday · plate & envelopes', closed: 1, entry_count: 91, total_cents: 930500, deposit_status: { key: 'deposited', label: 'Deposited' } },
  ],
  deposits: [
    { id: 21, deposit_date: '2026-09-21', external_ref: 'Deposit 09/21', bank_cents: null, status: 'open', line_cents: 812000, batch_count: 1 },
    { id: 20, deposit_date: '2026-09-14', external_ref: 'Deposit 09/14', bank_cents: 930500, status: 'reconciled', line_cents: 930500, batch_count: 1 },
  ],
  lines: [{ deposit_id: 21, batch_id: 1039, amount_cents: 812000 }, { deposit_id: 20, batch_id: 1038, amount_cents: 930500 }],
};

function makeEnv({ refuse } = {}) {
  const calls = [];
  const env = {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: { prepare: (sql) => ({ sql }) }, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        const body = req.method === 'POST' ? await req.json() : null;
        calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), body, jwt: req.headers.get('Cf-Access-Jwt-Assertion') });
        if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role: 'finance', permissions: { finance: 'edit', giving: 'edit' } }));
        if (refuse) return new Response(JSON.stringify({ error: 'Entering gifts requires Giving edit access' }), { status: 403 });
        if (url.pathname.endsWith('/giving-batch-workspace-v1')) return new Response(JSON.stringify(WORKSPACE));
        if (url.pathname.endsWith('/giving-batch-ledger-v1')) return new Response(JSON.stringify(LEDGER));
        if (url.pathname.endsWith('/giving-batch-write-v1')) return new Response(JSON.stringify({ ok: true, batch_id: body.batch_id ? Number(body.batch_id) : 1041, ids: [9] }));
        return new Response('{}', { status: 404 });
      },
    },
  };
  return { env, calls };
}
const get = (env, query) => worker.fetch(new Request(`https://finance.test/?section=giving${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);
const post = (env, fields, headers = {}) => worker.fetch(new Request('https://finance.test/api/v1/gift-batch-write', {
  method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin', ...headers }, body: new URLSearchParams(fields),
}), env);

describe('Gift Entry batches (Finance v3)', () => {
  it('makes Enter a batch the first Gift Entry page, read live from Connect', async () => {
    const { env, calls } = makeEnv();
    const html = await (await get(env, '&q=212')).text();
    expect(html).toContain('<h1 class="page-title">Enter a batch</h1>');
    expect(calls.find((c) => c.path.endsWith('/giving-batch-workspace-v1'))).toMatchObject({ query: { q: '212' }, jwt: 'jwt' });
    expect(html).toContain('BATCH #1039');
    expect(html).toContain('$264.25');
    expect(html).toContain('Walter Krause');
    expect(html).toContain('General Fund · Check · Check #2207 · Env. #212');
    expect(html).toContain('Loose cash');
    expect(html).toContain('href="/?section=giving&amp;page=batch&amp;batch_id=1039&amp;person=7&amp;person_name=Walter+Krause"');
    expect(html).toContain('Close batch #1039');
    expect(html).toContain('Split this gift across funds');
    expect(html).toContain('>Record a single gift</a>');
  });

  it('checks a cash count against the batch’s cash gifts without saving it', async () => {
    expect(cashCount(new URLSearchParams('c1=14&c5=6&c10=3&c20=5&coins=0'))).toMatchObject({ cents: 17400, bills: 28, entered: true });
    const { env } = makeEnv();
    const off = await (await get(env, '&batch_id=1039&c20=5&c10=1')).text();
    expect(off).toContain('Off by $4.00 — less cash counted than recorded.');
    const ok = await (await get(env, '&batch_id=1039&c100=1&c10=1&c1=4')).text();
    expect(ok).toContain('Cash matches ✓');
  });

  it('relays a split gift to Connect and returns to the batch', async () => {
    const { env, calls } = makeEnv();
    const res = await post(env, { op: 'add_gift', batch_id: '1039', person_id: '7', method: 'check', check_number: '2207', fund_1: '1', amount_1: '100', fund_2: '2', amount_2: '50.25', fund_3: '', amount_3: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?section=giving&page=batch&batch_id=1039&status=ok&msg=Gift+added.');
    const sent = calls.find((c) => c.path.endsWith('/giving-batch-write-v1'));
    expect(sent.body).toEqual({ op: 'add_gift', batch_id: '1039', person_id: '7', method: 'check', check_number: '2207', splits: [{ fund_id: '1', amount: '100' }, { fund_id: '2', amount: '50.25' }] });
    expect(sent.jwt).toBe('jwt');
  });

  it('shows Connect’s refusal, and refuses cross-site posts and unknown actions itself', async () => {
    const refused = makeEnv({ refuse: true });
    const res = await post(refused.env, { op: 'close_batch', batch_id: '1039' });
    expect(res.headers.get('Location')).toContain('status=error');
    expect(decodeURIComponent(res.headers.get('Location').replace(/\+/g, ' '))).toContain('Entering gifts requires Giving edit access');
    const { env, calls } = makeEnv();
    expect((await post(env, { op: 'close_batch', batch_id: '1' }, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('Location')).toContain('status=error');
    expect((await post(env, { op: 'drop_tables' })).headers.get('Location')).toContain('Unknown+action');
    expect(calls.filter((c) => c.path.endsWith('/giving-batch-write-v1'))).toHaveLength(0);
    const page = await (await get(refused.env, '&page=batch')).text();
    expect(page).toContain('Gift batches could not be read from Connect: Entering gifts requires Giving edit access');
  });

  it('shows deposits to match and batches waiting for a deposit on Reconciliation to bank', async () => {
    const { env } = makeEnv();
    const html = await (await get(env, '&page=reconciliation')).text();
    expect(html).toContain('Matched through');
    expect(html).toContain('Sep 14');
    expect(html).toContain('Midweek gifts');
    expect(html).toContain('Deposit $1,340.00');
    expect(html).toContain('name="bank_amount" inputmode="decimal" value="8120.00"');
    const res = await post(env, { op: 'reconcile_deposit', deposit_id: '21', bank_amount: '8120.00' });
    expect(res.headers.get('Location')).toBe('/?section=giving&page=reconciliation&status=ok&msg=Deposit+matched+to+the+bank.');
  });

  it('lists batches with deposit status on Batch reports', async () => {
    const { env } = makeEnv();
    const html = await (await get(env, '&page=reports')).text();
    expect(html).toContain('<h1 class="page-title">Batch reports</h1>');
    expect(html).toContain('Midweek gifts');
    expect(html).toContain('Needs deposit');
    expect(html).toContain('Deposited');
    expect(html).toContain('href="/?section=giving&amp;page=batch&amp;batch_id=1038"');
  });
});
