import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { buildPropertyValuationMetaFromForm } from '../apps/finance/property-valuation-form.js';

// Commercial Property screens for relays that already existed without a form: capital/repair
// ledger removes (row ids now travel in connect.finance-property-ledgers.v1), the reserve
// disbursement log with its remove, and the valuation editor on property-meta-write-v1.

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };
const JWT = { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' };

const LIVE_LEDGERS = {
  contract: 'connect.finance-property-ledgers.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  capital: [
    { entryDate: '2024-10-07', amountCents: 540000, payee: 'Vail Contracting LLC', description: 'Contracting work', checkRef: '', project: 'Renovation', sortOrder: 1, id: 7 },
  ],
  repairs: [
    { entryDate: '2024-11', category: 'Roof', description: 'Roof leak', amountCents: null, payee: 'Innovative Roofing', capitalized: false, id: 12 },
  ],
  totals: { capitalCents: 540000, repairsCents: 0 },
};

const LIVE_RESERVES = {
  contract: 'connect.finance-property-reserves.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  reserves: [{
    reserveKey: 'property_tax', reportMonth: '2027-01', taxYear: 2027, targetEstimateCents: 1140000,
    reserveBeforeCents: 0, contributionCents: 95000, reserveAfterCents: 95000, fundedPct: 8.333333333333332, note: '',
  }],
  reserveDisbursements: [
    { reserveKey: 'property_tax', periodKey: '2026', amountCents: 1098000, paidViaReportMonth: '2026-12', note: 'County bill' },
  ],
  distributions: [],
};

const LIVE_VALUATION = {
  contract: 'connect.finance-property-valuation.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', asOfDate: '2026-08-12', generatedAt: '2026-09-14T12:00:00Z',
  assumptions: { propertyKey: 'ivanhoe', utilityReimbursementCents: 0, vacancyRatePct: 0.05, managementFeePct: 0, capRate: 0.08 },
  rentRoll: [{ unitKey: 'apartment-1', tenantLabel: 'Apartment 1', squareFeet: 1500, annualRentCents: 1938000 }],
  operatingCosts: [
    { costKey: 'utilities', costLabel: 'Utilities', annualCostCents: 0 },
    { costKey: 'trash', costLabel: 'Trash', annualCostCents: 0 },
    { costKey: 'maintenance_repairs', costLabel: 'Maintenance/Repairs', annualCostCents: 0 },
    { costKey: 'landscaping_snow', costLabel: 'Landscaping/Snow', annualCostCents: 0 },
    { costKey: 'legal', costLabel: 'Legal', annualCostCents: 0 },
    { costKey: 'taxes', costLabel: 'Taxes', annualCostCents: 0 },
    { costKey: 'insurance', costLabel: 'Insurance', annualCostCents: 0 },
  ],
  totals: {
    totalAnnualRentCents: 1938000, grossRentalIncomeCents: 1938000, vacancyCents: 96900, effectiveRentalIncomeCents: 1841100,
    itemizedOperatingCostsCents: 0, managementFeeCents: 0, totalOperatingCostsCents: 0, noiCents: 1841100,
    capitalizedValueCents: Math.round(1841100 / 0.08), reconciled: true,
  },
};

const LIVE_POLICY = {
  contract: 'connect.finance-property-policy.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-26T00:00:00Z',
  reservePolicy: { baseMinimumCents: 450000 },
  capitalPolicy: { method: 'flat_plus_sqft', annualAllowanceCents: 1200000, perSquareFootCents: 20 },
};

const LIVE_DEBT = {
  contract: 'connect.finance-property-debt.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', propertyKey: 'ivanhoe', generatedAt: '2026-09-26T00:00:00Z',
  loan: { lender: 'LCEF', balanceCents: 27969113, balanceAsOfDate: '2026-07-20', interestRatePct: 0.06375, monthlyPaymentCents: 428303, storedAnnualDebtServiceCents: 4539636 },
  activity: [{ period: '2026-08', paymentCents: 428303, interestCents: 94203, principalCents: 334100, balanceAfterCents: 27635013 }],
  projection: { currentBalanceCents: 27635013, currentBalanceAsOf: '2026-08', derivedAnnualDebtServiceCents: 5139636, monthsRemaining: 76, payoffPeriod: '2032-12', totalInterestRemainingCents: 5040000, status: 'ready' },
};

const LIVE_BY_PATH = {
  '/api/contracts/finance-property-ledgers-v1': LIVE_LEDGERS,
  '/api/contracts/finance-property-reserves-v1': LIVE_RESERVES,
  '/api/contracts/finance-property-valuation-v1': LIVE_VALUATION,
  '/api/contracts/finance-property-policy-v1': LIVE_POLICY,
  '/api/contracts/finance-property-debt-v1': LIVE_DEBT,
};

function roleEnv(role, onWrite = async () => new Response('not found', { status: 404 })) {
  return {
    ...baseEnv,
    FINANCE_CONTRACT_API_KEY: 'test-secret',
    CONNECT_SERVICE: {
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: { finance: 'edit' } }), { status: 200 });
        if (LIVE_BY_PATH[pathname]) return new Response(JSON.stringify(LIVE_BY_PATH[pathname]), { status: 200 });
        return onWrite(req);
      },
    },
  };
}

async function page(env, query) {
  const res = await worker.fetch(new Request(`https://finance.test/?${query}`, { headers: JWT }), env);
  expect(res.status).toBe(200);
  return res.text();
}

describe('Commercial Property ledger removes', () => {
  it('shows per-row Delete on live capital and repair rows for an admin, keyed on the Connect row id', async () => {
    const env = roleEnv('admin');
    const capital = await page(env, 'section=property&page=capital');
    expect(capital).toContain('action="/api/v1/connect-property-capital-ledger-remove"');
    expect(capital).toContain('name="id" value="7"');
    const repairs = await page(env, 'section=property&page=work-orders');
    expect(repairs).toContain('action="/api/v1/connect-property-repair-remove"');
    expect(repairs).toContain('name="id" value="12"');
  });

  it('hides Delete from a finance-role viewer and on the synthetic fallback', async () => {
    const finance = await page(roleEnv('finance'), 'section=property&page=capital');
    expect(finance).not.toContain('connect-property-capital-ledger-remove');
    const synthetic = await (await worker.fetch(new Request('https://finance.test/?section=property&page=work-orders'), baseEnv)).text();
    expect(synthetic).not.toContain('connect-property-repair-remove');
  });

  it('leaves the action cell empty for a live row without an id (older Connect producer)', async () => {
    const withoutIds = { ...LIVE_LEDGERS, capital: LIVE_LEDGERS.capital.map(({ id, ...row }) => row) };
    const env = roleEnv('admin');
    const inner = env.CONNECT_SERVICE.fetch;
    env.CONNECT_SERVICE = {
      async fetch(req) {
        if (new URL(req.url).pathname === '/api/contracts/finance-property-ledgers-v1') return new Response(JSON.stringify(withoutIds), { status: 200 });
        return inner(req);
      },
    };
    const html = await page(env, 'section=property&page=capital');
    expect(html).toContain('Vail Contracting LLC');
    expect(html).not.toContain('connect-property-capital-ledger-remove');
  });
});

describe('Commercial Property reserve disbursement log', () => {
  it('lists live disbursements with an admin Delete keyed on reserve and period', async () => {
    const html = await page(roleEnv('admin'), 'section=property&page=reserve-distribution');
    expect(html).toContain('Paid from reserves');
    expect(html).toContain('County bill');
    expect(html).toContain('action="/api/v1/connect-property-reserve-disbursement-remove"');
    expect(html).toContain('name="reserve_key" value="property_tax"><input type="hidden" name="period_key" value="2026"');
  });

  it('shows the log read-only to a finance-role viewer', async () => {
    const html = await page(roleEnv('finance'), 'section=property&page=reserve-distribution');
    expect(html).toContain('County bill');
    expect(html).not.toContain('connect-property-reserve-disbursement-remove');
  });
});

describe('Commercial Property valuation editor', () => {
  it('renders the current live inputs for an admin, as percentages', async () => {
    const html = await page(roleEnv('admin'), 'section=property&page=valuation');
    expect(html).toContain('Edit valuation inputs');
    expect(html).toContain('name="valuation_form" value="1"');
    expect(html).toContain('name="tenant" value="Apartment 1"');
    expect(html).toContain('name="annual_rent" min="0" step="0.01" value="19380.00"');
    expect(html).toContain('name="cap_rate_pct" min="0.01" max="100" step="0.001" value="8"');
    expect(html).toContain('name="vacancy_rate_pct" min="0" max="100" step="0.1" value="5"');
    expect(html).toContain('name="oc_maintenance_repairs"');
  });

  it('is not offered to a finance-role viewer', async () => {
    const html = await page(roleEnv('finance'), 'section=property&page=valuation');
    expect(html).not.toContain('Edit valuation inputs');
  });

  it('relays the legacy valuation section, with computed outputs, through property-meta-write', async () => {
    let sent;
    const env = roleEnv('admin', async (req) => {
      sent = { path: new URL(req.url).pathname, body: JSON.parse(await req.text()) };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const form = new URLSearchParams([
      ['valuation_form', '1'],
      ['tenant', 'Apartment 1'], ['sqft', '1500'], ['annual_rent', '19380'],
      ['tenant', ''], ['sqft', ''], ['annual_rent', ''],
      ['utility_reimbursement', '0'], ['vacancy_rate_pct', '5'], ['management_fee_pct', '0'], ['cap_rate_pct', '8'],
      ['oc_taxes', '1000'],
    ]);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?section=property&page=valuation&status=ok');
    expect(sent.path).toBe('/api/contracts/finance-property-meta-write-v1');
    expect(Object.keys(sent.body)).toEqual(['valuation']);
    const valuation = sent.body.valuation;
    expect(valuation.rent_roll).toEqual([{ tenant: 'Apartment 1', sqft: 1500, annual_rent_cents: 1938000 }]);
    expect(valuation.cap_rate).toBeCloseTo(0.08);
    expect(valuation.vacancy_rate_pct).toBeCloseTo(0.05);
    expect(valuation.operating_costs.taxes_cents).toBe(100000);
    expect(valuation.net_operating_income_cents).toBe(1841100 - 100000);
    expect(valuation.capitalized_value_cents).toBe(Math.round((1841100 - 100000) / 0.08));
  });

  it('redirects with a readable error instead of relaying invalid input', async () => {
    let relayed = false;
    const env = roleEnv('admin', async () => { relayed = true; return new Response('{}'); });
    const form = new URLSearchParams([['valuation_form', '1'], ['tenant', 'A'], ['sqft', '1'], ['annual_rent', '1'], ['cap_rate_pct', '0']]);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    }), env);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('page')).toBe('valuation');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('message')).toContain('cap rate');
    expect(relayed).toBe(false);
  });
});

describe('Commercial Property reserve and capital policy editors', () => {
  it('shows current policy and admin-only forms on the pages those figures drive', async () => {
    const reserves = await page(roleEnv('admin'), 'section=property&page=reserve-distribution');
    expect(reserves).toContain('Base minimum reserve');
    expect(reserves).toContain('$4,500');
    expect(reserves).toContain('name="reserve_policy_form" value="1"');
    const valuation = await page(roleEnv('admin'), 'section=property&page=valuation');
    expect(valuation).toContain('Capital allowance');
    expect(valuation).toContain('name="capital_policy_form" value="1"');
    expect(valuation).toContain('<option value="flat_plus_sqft" selected>');
    expect(valuation).toContain('name="annual_allowance" min="0" step="0.01" value="12000.00"');
  });

  it('renders the policy read-only to finance viewers', async () => {
    const reserves = await page(roleEnv('finance'), 'section=property&page=reserve-distribution');
    expect(reserves).toContain('$4,500');
    expect(reserves).not.toContain('reserve_policy_form');
    const valuation = await page(roleEnv('finance'), 'section=property&page=valuation');
    expect(valuation).toContain('Flat amount plus amount per square foot');
    expect(valuation).not.toContain('capital_policy_form');
  });

  it('relays reserve and capital sections without touching other property metadata', async () => {
    const sent = [];
    const env = roleEnv('admin', async (req) => { sent.push(JSON.parse(await req.text())); return new Response(JSON.stringify({ ok: true })); });
    const reserve = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reserve_policy_form: '1', base_minimum: '5000.25' }).toString(),
    }), env);
    expect(reserve.headers.get('location')).toContain('op=reserve-policy&status=ok');
    const capital = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ capital_policy_form: '1', method: 'per_sqft', annual_allowance: '', per_square_foot: '0.25' }).toString(),
    }), env);
    expect(capital.headers.get('location')).toContain('op=capital-policy&status=ok');
    expect(sent).toEqual([
      { reserves: { base_minimum_cents: 500025 } },
      { capital: { method: 'per_sqft', annual_allowance_cents: null, per_sqft_cents: 25 } },
    ]);
  });

  it('rejects malformed policy values before relaying', async () => {
    let relayed = false;
    const env = roleEnv('admin', async () => { relayed = true; return new Response('{}'); });
    const response = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ capital_policy_form: '1', method: 'invented', annual_allowance: '-1' }).toString(),
    }), env);
    expect(response.headers.get('location')).toContain('reason=invalid_input');
    expect(relayed).toBe(false);
  });
});

describe('Commercial Property debt payoff', () => {
  it('replaces the placeholder with the live payoff projection and an admin editor', async () => {
    const html = await page(roleEnv('admin'), 'section=property&page=debt');
    expect(html).toContain('Debt payoff &amp; future');
    expect(html).toContain('$276,350');
    expect(html).toContain('2032-12');
    expect(html).toContain('name="debt_policy_form" value="1"');
    expect(html).toContain('name="interest_rate" min="0" max="100" step="0.00001" value="6.375"');
    expect(html).toContain('Review the saved annual debt service');
  });

  it('adds payoff by year and an extra-principal what-if to the projection', async () => {
    const html = await page(roleEnv('admin'), 'section=property&page=debt&extra=500');
    expect(html).toContain('Payoff by year');
    expect(html).toContain('Balance at year end');
    expect(html).toContain('months sooner');
    expect(html).toContain('stays with the property');
    expect(html).not.toContain('The loan record lists a');
    expect(html).not.toContain('NaN');
  });

  it('flags a reported payment that differs from the loan record', async () => {
    const saved = LIVE_DEBT.activity;
    LIVE_DEBT.activity = [{ ...saved[0], paymentCents: 378303 }];
    try {
      const html = await page(roleEnv('admin'), 'section=property&page=debt');
      expect(html).toContain('The loan record lists a $4,283 monthly payment, but the 2026-08 report shows $3,783.');
    } finally {
      LIVE_DEBT.activity = saved;
    }
  });

  it('keeps the debt page read-only for a finance viewer', async () => {
    const html = await page(roleEnv('finance'), 'section=property&page=debt');
    expect(html).toContain('$276,350');
    expect(html).not.toContain('debt_policy_form');
  });

  it('relays only the loan section and derives annual debt service from the monthly payment', async () => {
    let sent;
    const env = roleEnv('admin', async (req) => { sent = JSON.parse(await req.text()); return new Response(JSON.stringify({ ok: true })); });
    const response = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ debt_policy_form: '1', lender: 'LCEF', balance: '270000.25', balance_as_of_date: '2026-09-20', interest_rate: '6.375', monthly_payment: '4283.03' }).toString(),
    }), env);
    expect(response.headers.get('location')).toBe('/?section=property&page=debt&op=property-debt&status=ok');
    expect(sent).toEqual({ loan: { lender: 'LCEF', balance_cents: 27000025, balance_as_of_date: '2026-09-20', interest_rate_pct: 0.06375, monthly_payment_cents: 428303, annual_debt_service_cents: 5139636 } });
  });

  it('rejects invalid loan terms before the relay', async () => {
    let relayed = false;
    const env = roleEnv('admin', async () => { relayed = true; return new Response('{}'); });
    const response = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-meta-write', {
      method: 'POST', headers: { ...JWT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ debt_policy_form: '1', balance: '-1', balance_as_of_date: 'bad', interest_rate: '101', monthly_payment: '0' }).toString(),
    }), env);
    expect(response.headers.get('location')).toContain('reason=invalid_input');
    expect(relayed).toBe(false);
  });
});

describe('buildPropertyValuationMetaFromForm', () => {
  const form = (pairs) => new URLSearchParams(pairs);

  it('drops blank tenant rows, which is how a tenant is removed', () => {
    const result = buildPropertyValuationMetaFromForm(form([
      ['tenant', ' '], ['sqft', '900'], ['annual_rent', '12000'],
      ['tenant', 'Suite B'], ['sqft', '800'], ['annual_rent', '9600.5'],
      ['cap_rate_pct', '7.5'],
    ]), new Date('2026-09-25T12:00:00Z'));
    expect(result.rent_roll).toEqual([{ tenant: 'Suite B', sqft: 800, annual_rent_cents: 960050 }]);
    expect(result.as_of_date).toBe('2026-09-25');
    expect(Object.keys(result.operating_costs)).toHaveLength(7);
  });

  it('rejects negative amounts and percentages over 100', () => {
    expect(buildPropertyValuationMetaFromForm(form([['cap_rate_pct', '8'], ['oc_legal', '-5']])).error).toMatch(/non-negative/);
    expect(buildPropertyValuationMetaFromForm(form([['cap_rate_pct', '8'], ['vacancy_rate_pct', '120']])).error).toMatch(/100 or less/);
  });
});
