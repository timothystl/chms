import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import {
  applyRaiseMethodsForm, applyReferenceForm, applyHealthQuoteForm, applyConcordiaRangesForm,
  applyWorkerBenefitFields, planFormReturnLocation, PlanFormError,
} from '../apps/finance/compensation-plan-form.js';

// Every name and figure here is fabricated for the test.
const PLAN = {
  roster: [
    { name: 'Test Pastor', position: 'Pastor', role: 'pastor', yearsExperience: 10, actualSalaryCents: 6000000, hasDependents: true, healthEnrolled: true,
      concordia: { churchLcmsLow: '55,000', churchLcmsMid: '62,000', churchLcmsHigh: '70,000', asOfDate: '01/02/2026' } },
    { name: 'Test Secretary', position: 'Secretary', role: 'other', trackKey: 'secretary', yearsExperience: 2, actualSalaryCents: 3000000, healthMode: 'optout' },
  ],
  compMethod: 'cola', compPerWorkerMethod: { 1: 'none' }, compOverrides: { 0: '64000' },
  compCustomPct: 3.5, compScalePct: 95, referenceByYear: { 2027: { baseSalaryCents: 5152900, pensionPct: 0.12 } },
  healthPlanPremiumOverrides: { renewal: { medicalCents: 999, tiersMonthlyCents: { family: 205100 } } },
  healthPlanOption: 'renewal', targetCategory: 'Expenses:Payroll', keepMe: { untouched: true },
};
const form = (fields) => new URLSearchParams(fields);

describe('Compensation plan settings forms', () => {
  it('sets the plan-wide method, per-worker methods and hand-set salaries, keeping the rest of the plan', () => {
    const next = applyRaiseMethodsForm(PLAN, form({
      comp_method: 'custom', comp_custom_pct: '4', comp_scale_pct: '90', comp_base_year_basis: 'ledger',
      worker_method_0: 'worksheet', worker_override_0: '', worker_method_1: 'default', worker_override_1: '$31,500',
    }));
    expect(next).toMatchObject({ compMethod: 'custom', compCustomPct: 4, compScalePct: 90, compBaseYearBasis: 'ledger', compBaselineRosterOnly: false });
    expect(next.compPerWorkerMethod).toEqual({ 0: 'worksheet' });
    expect(next.compOverrides).toEqual({ 1: '31500' });
    expect(next.roster).toBe(PLAN.roster);
    expect(next.keepMe).toEqual({ untouched: true });
    expect(PLAN.compPerWorkerMethod).toEqual({ 1: 'none' });
  });

  it('applies one method to everyone the way legacy did, clearing per-worker choices', () => {
    const next = applyRaiseMethodsForm(PLAN, form({ comp_method: 'scalepct', apply_to_all: '1', worker_method_1: 'cola' }));
    expect(next.compPerWorkerMethod).toEqual({});
    expect(next.compOverrides).toEqual({});
    expect(() => applyRaiseMethodsForm(PLAN, form({ comp_method: 'flat' }))).toThrow(PlanFormError);
  });

  it('stores reference figures as legacy does: fractions, cents, text, and blank clears', () => {
    const next = applyReferenceForm(PLAN, form({
      ref_year: '2028', baseSalaryCents: '53,100', pensionPct: '11.5', ssaColaPct: '2.6', healthOptOutCents: '3000', districtSource: 'District paper 2028', ficaPct: '',
    }));
    expect(next.referenceByYear[2028]).toEqual({ baseSalaryCents: 5310000, pensionPct: 0.115, ssaColaPct: 0.026, healthOptOutCents: 300000, districtSource: 'District paper 2028' });
    expect(next.referenceByYear[2027]).toEqual(PLAN.referenceByYear[2027]);
    const cleared = applyReferenceForm(PLAN, form({ ref_year: '2027', baseSalaryCents: '', pensionPct: '' }));
    expect(cleared.referenceByYear[2027]).toBeUndefined();
    expect(() => applyReferenceForm(PLAN, form({ ref_year: 'next' }))).toThrow(PlanFormError);
  });

  it('saves typed health quote rates and drops an old flat medical figure when a tier rate changes', () => {
    const next = applyHealthQuoteForm(PLAN, form({
      tier_renewal_family: '2100.50', tier_renewal_self: '', quote_option1_dentalCents: '1600', health_plan_option: 'option1', health_family_size: '4', ref_year: '2027', quoteSource: 'Quote #1',
    }));
    expect(next.healthPlanPremiumOverrides.renewal).toEqual({ tiersMonthlyCents: { family: 210050 } });
    expect(next.healthPlanPremiumOverrides.option1).toEqual({ dentalCents: 160000 });
    expect(next).toMatchObject({ healthPlanOption: 'option1', healthFamilySize: 4 });
    expect(next.referenceByYear[2027].quoteSource).toBe('Quote #1');
    const unchanged = applyHealthQuoteForm(PLAN, form({ tier_renewal_family: '2051' }));
    expect(unchanged.healthPlanPremiumOverrides.renewal.medicalCents).toBe(999);
  });

  it('edits one worker’s Concordia ranges without touching anyone else', () => {
    const next = applyConcordiaRangesForm(PLAN, form({ index: '1', churchLcmsLow: '28000', churchLcmsMid: '31000', churchLcmsHigh: '35000', position: 'Church Secretary' }));
    expect(next.roster[1].concordia).toEqual({ churchLcmsLow: '28000', churchLcmsMid: '31000', churchLcmsHigh: '35000', position: 'Church Secretary' });
    expect(next.roster[0]).toBe(PLAN.roster[0]);
    const cleared = applyConcordiaRangesForm(PLAN, form({ index: '0', churchLcmsLow: '', asOfDate: '01/02/2026' }));
    expect(cleared.roster[0].concordia.churchLcmsLow).toBeUndefined();
    expect(() => applyConcordiaRangesForm(PLAN, form({ index: '7' }))).toThrow(PlanFormError);
  });

  it('reads the worker drawer fields: FTE, cash only, externally funded and coverage tier', () => {
    const w = applyWorkerBenefitFields({ healthEnrolled: false }, form({ ftePct: '50', benefit_fields: '1', cashOnly: 'on', healthTier: 'selfSpouse', healthOptOutOverride: '' }));
    expect(w).toMatchObject({ ftePct: 50, cashOnly: true, externallyFunded: false, healthTier: 'selfSpouse', healthMode: 'employee', healthEnrolled: true, healthOptOutOverrideCents: null });
    const auto = applyWorkerBenefitFields({ healthTier: 'family', healthMode: 'family' }, form({ healthTier: '' }));
    expect(auto.healthTier).toBeUndefined();
    expect(auto.healthMode).toBeUndefined();
    const legacyMode = applyWorkerBenefitFields({ healthMode: 'optout' }, form({ healthTier: '' }));
    expect(legacyMode.healthMode).toBe('optout');
  });

  it('sends a save back to the page it came from', () => {
    expect(planFormReturnLocation(form({ return_page: 'rates', plan_year: '2028', ref_year: '2029' }), { status: 'ok' }))
      .toBe('/?section=compensation&page=rates&plan_year=2028&ref_year=2029&status=ok');
    expect(planFormReturnLocation(form({ return_page: 'elsewhere' }))).toBe('/?section=compensation&page=plan');
  });
});

function roleEnv(role, { onWrite } = {}) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_CONTRACT_API_KEY: 'test-secret',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: { compensation: 'edit' } }));
        if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: PLAN }));
        if (url.pathname === '/api/contracts/finance-compensation-write-v1') {
          onWrite?.(JSON.parse(await req.text()));
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response('{}', { status: 404 });
      },
    },
  };
}
const page = (env, q) => worker.fetch(new Request(`https://finance.test/?section=compensation&${q}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);

describe('Compensation settings pages and relay', () => {
  it('gives admin the raise-method grid on Plan and every editor on Rates & ranges', async () => {
    const env = roleEnv('admin');
    const plan = await (await page(env, 'page=plan&plan_year=2027')).text();
    expect(plan).toContain('Raise methods');
    expect(plan).toContain('name="worker_method_1"');
    expect(plan).toContain('name="worker_override_0"');
    expect(plan).toContain('value="64000"');
    expect(plan).toContain('name="ftePct"');
    const rates = await (await page(env, 'page=rates&plan_year=2027')).text();
    expect(rates).toContain('<h1 class="page-title">Rates &amp; ranges</h1>');
    expect(rates).toContain('value="reference"');
    expect(rates).toContain('name="baseSalaryCents" step="any" value="51529"');
    expect(rates).toContain('name="pensionPct" step="any" value="12"');
    expect(rates).toContain('name="tier_renewal_family"');
    expect(rates).toContain('value="ranges"');
    expect(rates).toContain('value="62,000"');
  });

  it('shows council the figures without any form that writes the shared plan', async () => {
    const rates = await (await page(roleEnv('council'), 'page=rates')).text();
    expect(rates).toContain('District guidelines and Concordia Plans rates');
    expect(rates).not.toContain('/api/v1/connect-compensation-plan-write');
  });

  it('relays a raise-method save as the complete plan and returns to the Plan page', async () => {
    let sent;
    const env = roleEnv('admin', { onWrite: (body) => { sent = body; } });
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-compensation-plan-write', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ action: 'methods', return_page: 'plan', plan_year: '2027', comp_method: 'worksheet', worker_method_0: 'none', worker_override_0: '' }).toString(),
    }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?section=compensation&page=plan&plan_year=2027&status=ok');
    expect(sent.compMethod).toBe('worksheet');
    expect(sent.compPerWorkerMethod).toEqual({ 0: 'none', 1: 'none' });
    expect(sent.compOverrides).toEqual({});
    expect(sent.roster).toHaveLength(2);
    expect(sent.keepMe).toEqual({ untouched: true });
    expect(sent.healthPlanPremiumOverrides).toEqual(PLAN.healthPlanPremiumOverrides);
  });

  it('reports an invalid settings form without writing anything', async () => {
    let wrote = false;
    const env = roleEnv('admin', { onWrite: () => { wrote = true; } });
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-compensation-plan-write', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ action: 'reference', return_page: 'rates', ref_year: 'soon' }).toString(),
    }), env);
    expect(res.headers.get('location')).toBe('/?section=compensation&page=rates&status=error&reason=invalid_year');
    expect(wrote).toBe(false);
  });
});
