// ── connect.finance-planning-basis.v1 ─────────────────────────────────────────────────────────
// Finance's v3 Planning pages (Scenarios, Multi-year forecast) start from the same fiscal-year
// budget plan the Budget builder shows (finance_budget_plan, see buildFinanceBudgetV1), with each
// line sorted into the groups a scenario adjusts: income by revenue stream (donor, earned, passive,
// restricted) and expenses by the flow categories (salaries, mdo, property, education, programs).
// The sorting is Connect's own -- classifyRevenueStream/classifyFlowExpense with the admin's saved
// overrides -- so a line counts the same way here as on the Health page. Aggregate budget lines
// only; no person or gift crosses this contract. Guarded by X-Contract-Key like finance-budget-v1.
import { json } from './auth.js';
import { classifyFlowExpense, classifyRevenueStream } from './api-finance.js';

async function readOverrides(db, key) {
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(key).first();
  try { return row ? (JSON.parse(row.value).map || {}) : {}; } catch { return {}; }
}

// A plan category may be a full path ("Income:Offerings"); the classifiers work on group labels.
function lastSegment(category) {
  const parts = String(category || '').split(':').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(category || '');
}

export async function buildFinancePlanningBasisV1(db, { fiscalYear, now = new Date() }) {
  const [plan, revenueOverrides, expenseOverrides] = await Promise.all([
    db.prepare(
      `SELECT category, classification, planned_amount_cents FROM finance_budget_plan
        WHERE fiscal_year = ? ORDER BY classification, category`
    ).bind(fiscalYear).all(),
    readOverrides(db, 'finance_revenue_streams'),
    readOverrides(db, 'finance_flow_expense_map'),
  ]);
  const lines = (plan.results || []).map((row) => {
    const label = lastSegment(row.category);
    const income = row.classification === 'Income';
    const group = income
      ? (revenueOverrides[row.category] ? classifyRevenueStream(row.category, revenueOverrides) : classifyRevenueStream(label, revenueOverrides)).stream
      : classifyFlowExpense(expenseOverrides[row.category] ? row.category : label, expenseOverrides).key;
    return { category: row.category, classification: income ? 'Income' : 'Expenses', plannedAmountCents: row.planned_amount_cents || 0, group };
  });
  const sum = (c) => lines.filter((l) => l.classification === c).reduce((s, l) => s + l.plannedAmountCents, 0);
  return {
    contract: 'connect.finance-planning-basis.v1',
    dataClassification: 'aggregate',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    lines,
    totals: { plannedIncomeCents: sum('Income'), plannedExpenseCents: sum('Expenses') },
  };
}

export async function respondWithFinancePlanningBasisV1(url, db) {
  const fiscalYear = Number(url.searchParams.get('fiscal_year'));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  }
  return json(await buildFinancePlanningBasisV1(db, { fiscalYear }));
}
