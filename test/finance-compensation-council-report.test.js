import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

// Council raise projections in Finance (Andrew, 2026-09-25): the Council page renders legacy's full
// Council report from the saved plan and the base year's church ledger, and the Plan page shows the
// projection under the editor or council draft. Synthetic people and figures only.

const PLAN = {
  roster: [
    { name: 'Pastor A', position: 'Senior Pastor', role: 'pastor', yearsExperience: 18, selfEmployedFica: true, hasDependents: true, accountCode: '58001', healthTier: 'family' },
    { name: 'Hidden B', position: 'Business Manager', role: 'other', trackKey: 'business_manager_music', yearsExperience: 4, accountCode: '58003', hideFromCouncil: true },
    { name: 'Music C', position: 'Director of Music', role: 'other', trackKey: 'business_manager_music', yearsExperience: 20, accountCode: '58004', healthTier: 'self',
      concordia: { churchLcmsLow: '50,000', churchLcmsMid: '55,000', churchLcmsHigh: '60,000' } },
    { name: 'MDO D', position: 'MDO Director', role: 'other', trackKey: 'childcare_director', yearsExperience: 6, externallyFunded: true, actualSalaryCents: 4000000 },
  ],
  compMethod: 'cola',
  compPerWorkerMethod: { 2: 'custom' },
  compCustomPct: 5,
  healthPlanOption: 'renewal',
};

function churchReport(fiscalYear) {
  const accounts = [
    { classification: 'Income', categoryPath: 'Income:40010 Offerings', accountName: '40010 Offerings', depth: 1, hasChildren: false, actualCents: 50000000, budgetCents: 52000000, source: 'import' },
    { classification: 'Expenses', categoryPath: 'Expenses:58001 Pastor Salary', accountName: '58001 Pastor Salary', depth: 1, hasChildren: false, actualCents: 7000000, budgetCents: 9800000, source: 'import' },
    { classification: 'Expenses', categoryPath: 'Expenses:58003 Business Salary', accountName: '58003 Business Salary', depth: 1, hasChildren: false, actualCents: 3000000, budgetCents: 4400000, source: 'import' },
    { classification: 'Expenses', categoryPath: 'Expenses:58004 Music Salary', accountName: '58004 Music Salary', depth: 1, hasChildren: false, actualCents: 4000000, budgetCents: 5600000, source: 'import' },
  ];
  const sum = (cls, key) => accounts.filter((a) => a.classification === cls).reduce((t, a) => t + a[key], 0);
  return {
    contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
    fiscalYear, generatedAt: '2026-09-25T12:00:00Z', accounts,
    totals: {
      incomeActualCents: sum('Income', 'actualCents'), incomeBudgetCents: sum('Income', 'budgetCents'),
      expenseActualCents: sum('Expenses', 'actualCents'), expenseBudgetCents: sum('Expenses', 'budgetCents'),
      netIncomeActualCents: sum('Income', 'actualCents') - sum('Expenses', 'actualCents'),
      netIncomeBudgetCents: sum('Income', 'budgetCents') - sum('Expenses', 'budgetCents'), hasBudgetData: true,
    },
    reconciliation: { accountCount: 4, incomeCount: 1, expenseCount: 3, otherIncomeCount: 0, otherExpenseCount: 0, costOfGoodsSoldCount: 0, accountsWithBudgetCount: 4, totalsMatch: true },
  };
}

// The aggregate roster contract the snapshot and Plan table read (one synthetic worker).
const LIVE_COMPENSATION = {
  contract: 'connect.finance-compensation.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  generatedAt: '2026-09-25T12:00:00Z',
  workers: [{ name: 'Test Worker A', position: 'Fictional Director', accountCode: '', role: 'other', trackKey: '', education: 'bachelors', yearsExperience: 3,
    responsibilityStipend: 0, attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthEnrolled: true, hideFromCouncil: false,
    currentPayCents: 5000000, currentPaySource: 'entered' }],
  totals: { workerCount: 1, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 5000000 },
  reconciliation: { workerCount: 1, totalsMatch: true },
};

function env({ role = 'admin', permissions = { compensation: 'edit', finance: 'edit' }, plan = PLAN, planStatus = 200, ledgerStatus = 200, calls = [] } = {}) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        calls.push(url.pathname + url.search);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions, username: 'member1' }));
        if (url.pathname === '/api/contracts/finance-compensation-plan-v1') {
          return planStatus === 200 ? new Response(JSON.stringify({ data: plan })) : new Response(JSON.stringify({ error: 'nope' }), { status: planStatus });
        }
        if (url.pathname === '/api/contracts/finance-compensation-v1') return new Response(JSON.stringify(LIVE_COMPENSATION));
        if (url.pathname === '/api/contracts/finance-church-report-v1') {
          return ledgerStatus === 200 ? new Response(JSON.stringify(churchReport(Number(url.searchParams.get('fiscal_year'))))) : new Response('{}', { status: ledgerStatus });
        }
        return new Response('nf', { status: 404 });
      },
    },
  };
}

const get = async (path, e) => {
  const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' } }), e);
  return { status: res.status, html: await res.text() };
};

describe('Council page: the full council report', () => {
  it('renders the report from the saved plan and the base-year ledger, without hidden workers', async () => {
    const calls = [];
    const { status, html } = await get('/?section=compensation&page=council&plan_year=2027', env({ calls }));
    expect(status).toBe(200);
    expect(calls).toContain('/api/contracts/finance-church-report-v1?fiscal_year=2026');
    expect(html).toContain('Fiscal Year 2027 Compensation Plan');
    expect(html).toContain('Recommended motion');
    expect(html).toContain('That the Church Council approve FY2027 compensation of');
    expect(html).toContain('Salary plan by worker');
    expect(html).toContain('Pastor A');
    expect(html).not.toContain('Hidden B');
    // Current pay is the linked account's base-year budget.
    expect(html).toContain('$98,000');
    // The custom 5% raise stays with Music C after the hidden worker is removed.
    expect(html).toContain('Custom 5.0%');
    expect(html).toContain('Not counted in any figure above: MDO D (MDO Director)');
    expect(html).toContain('Group health plan');
    expect(html).toContain('Reference figures used');
    expect(html).toContain('name="plan_year"');
  });

  it('prints as one document with each worker on a new page', async () => {
    const { html } = await get('/?section=compensation&page=council&plan_year=2027&print=1', env());
    expect(html).toContain('class="print-doc"');
    expect(html).toContain('Fiscal Year 2027 Compensation Plan');
    expect(html.match(/class="report print-newpage"/g).length).toBe(2 + 2);
  });

  it('keeps working when the ledger cannot be read, and says what that affects', async () => {
    const { html } = await get('/?section=compensation&page=council&plan_year=2027', env({ ledgerStatus: 500 }));
    expect(html).toContain('The FY2026 church ledger could not be read');
    expect(html).toContain('Fiscal Year 2027 Compensation Plan');
  });

  it('falls back to the aggregate snapshot, with a note, when the plan cannot be read', async () => {
    const { html } = await get('/?section=compensation&page=council', env({ planStatus: 403 }));
    expect(html).toContain('The Council report needs the saved plan, which could not be read');
    expect(html).not.toContain('Recommended motion');
  });

  it('follows the chosen plan year', async () => {
    const calls = [];
    const { html } = await get('/?section=compensation&page=council&plan_year=2028', env({ calls }));
    expect(calls).toContain('/api/contracts/finance-church-report-v1?fiscal_year=2027');
    expect(html).toContain('Fiscal Year 2028 Compensation Plan');
  });
});

describe('Plan page projection', () => {
  it('shows admins the projection under the roster editor, noting hidden workers', async () => {
    const { html } = await get('/?section=compensation&page=plan&plan_year=2027', env());
    expect(html).toContain('Projected salaries');
    expect(html).toContain('Hidden B');
    expect(html).toContain('Includes 1 worker hidden from council');
  });

  it('shows a council member the projection under their draft', async () => {
    const councilPlan = { ...PLAN, roster: PLAN.roster.filter((w) => !w.hideFromCouncil), compPerWorkerMethod: { 1: 'custom' } };
    const { html } = await get('/?section=compensation&page=plan&plan_year=2027', env({ role: 'council', plan: councilPlan }));
    expect(html).toContain('Your raise-plan draft');
    expect(html).toContain('Projected salaries under your draft');
    expect(html).not.toContain('hidden from council');
  });
});
