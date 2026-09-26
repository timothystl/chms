import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { renderChartsPage } from '../apps/finance/charts-pages.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

const churchRows = [
  { fiscal_year: 2026, classification: 'Income', account_name: 'Income', own_actual_cents: 12000000 },
  { fiscal_year: 2026, classification: 'Expenses', account_name: 'Expenses', own_actual_cents: 8000000 },
];
const cashRunway = {
  source: 'live',
  runway: {
    available: true, fiscalYear: 2026, asOfDate: '2026-09-01', cashAccounts: ['11027 Lindell Checking'], cashSource: 'balance_sheet',
    onHandCents: 2400000, expensesYtdCents: 900000, monthsElapsed: 9, averageMonthlyExpenseCents: 100000,
    monthsOfCash: 24, policyFloorMonths: 3, floorCents: 300000, gapToFloorCents: 0, daycareExcludedCents: 300000,
    policySettings: { floorMonths: 3, cashOnHandCents: null, cashAccountCode: '11027', generalFundBudgetCode: '40085' },
  },
};
const reserves = [{ reserve_after_cents: 500000, funded_pct: 50, report_month: '2026-09' }];

function render(overrides = {}) {
  return renderChartsPage('cash-reserve', {
    churchReport: churchRows, churchReportLive: { source: 'synthetic-fallback' }, cashRunway,
    propertyReserves: reserves, propertyReservesLive: { source: 'synthetic-fallback' }, giving: null, givingSource: 'synthetic-fallback',
    ...overrides,
  });
}

function postForm(env, fields = {}, accessJwt = 'signed.jwt.here') {
  const body = new URLSearchParams({
    policy_floor_months: '4.5', cash_account_code: '11027', general_fund_budget_code: '40085', cash_on_hand_dollars: '1234.56',
    ...fields,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-cash-policy-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(accessJwt ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}) },
    body,
  }), env);
}

describe('Charts — cash reserve policy form and existing Connect relay', () => {
  it('shows all authoritative settings only to an admin with a live extended contract', () => {
    const html = render({ canManageCashPolicy: true });
    expect(html).toContain('action="/api/v1/connect-cash-policy-write"');
    expect(html).toContain('name="policy_floor_months"');
    expect(html).toContain('value="11027"');
    expect(html).toContain('value="40085"');
    expect(render({ canManageCashPolicy: false })).not.toContain('/api/v1/connect-cash-policy-write');
    expect(render({ canManageCashPolicy: true, cashRunway: { source: 'live', runway: { ...cashRunway.runway, policySettings: undefined } } })).not.toContain('/api/v1/connect-cash-policy-write');
  });

  it('renders success and refusal feedback beside the form', () => {
    expect(render({ canManageCashPolicy: true, cashPolicyStatus: 'ok' })).toContain('Cash reserve policy saved.');
    expect(render({ canManageCashPolicy: true, cashPolicyStatus: 'error', cashPolicyMessage: 'Connect refused it.' })).toContain('Not saved: Connect refused it.');
  });

  it('forwards the complete policy in Connect cents and returns to Cash & reserve', async () => {
    let captured;
    const env = { ...baseEnv, FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { captured = req; return new Response(JSON.stringify({ ok: true })); } } };
    const response = await postForm(env);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location'), 'https://finance.test');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ section: 'charts', page: 'cash-reserve', op: 'cash-policy', status: 'ok' });
    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('secret');
    expect(new URL(captured.url).pathname).toBe('/api/contracts/finance-cash-policy-write-v1');
    expect(JSON.parse(await captured.text())).toEqual({
      policy_floor_months: '4.5', cash_on_hand_cents: 123456, cash_account_code: '11027', general_fund_budget_code: '40085',
    });
  });

  it('preserves blank manual cash and surfaces relay failures without writing locally', async () => {
    let captured;
    const env = { ...baseEnv, FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { captured = req; return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }); } } };
    const response = await postForm(env, { cash_on_hand_dollars: '' });
    const location = new URL(response.headers.get('location'), 'https://finance.test');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ section: 'charts', page: 'cash-reserve', op: 'cash-policy', status: 'error', reason: 'http_error', message: 'Access denied' });
    expect(JSON.parse(await captured.text()).cash_on_hand_cents).toBe('');
  });

  it('keeps method and identity/configuration boundaries closed', async () => {
    const get = await worker.fetch(new Request('https://finance.test/api/v1/connect-cash-policy-write'), baseEnv);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const unconfigured = await postForm(baseEnv);
    expect(new URL(unconfigured.headers.get('location'), 'https://finance.test').searchParams.get('reason')).toBe('not_configured');
    const noIdentity = await postForm({ ...baseEnv, FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch() { throw new Error('must not call'); } } }, {}, '');
    expect(new URL(noIdentity.headers.get('location'), 'https://finance.test').searchParams.get('reason')).toBe('no_access_identity');
  });
});
