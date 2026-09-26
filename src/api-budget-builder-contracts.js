// ── connect.finance-budget-builder.v1 ─────────────────────────────────────────────────────────
// Finance's v3 Budget builder table: every line of the target year's plan beside the two years it
// is built from. For target year Y it returns, per category, the FY(Y-2) actual, the FY(Y-1)
// budget, the FY(Y-1) projection, and the FY(Y) plan row. The projection follows the same rules as
// Connect's own planner and generate-all: the base year's actual annualized by weeks elapsed while
// that year is in progress (the full actual once it is over, the budget when there is no actual),
// with any hand-typed correction from finance_base_proj_overrides winning. Years are resolved with
// resolveChurchYearPrecedence, exactly like Church Report. Aggregate account lines only; guarded by
// X-Contract-Key like finance-budget-v1.
import { json } from './auth.js';
import { resolveChurchYearPrecedence, weeksElapsedInYear } from './api-finance.js';

const PLAN_SIDE = { Income: 'Income', 'Other Income': 'Income', Expenses: 'Expenses', 'Other Expenses': 'Expenses', 'Cost of Goods Sold': 'Expenses' };

async function resolvedYear(db, year) {
  const rows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(year).all()).results || [];
  return resolveChurchYearPrecedence(rows).filter((r) => !r.has_children && PLAN_SIDE[r.classification]);
}

function lastSegment(path) {
  const parts = String(path || '').split(':').filter(Boolean);
  return parts.length ? parts[parts.length - 1].trim() : String(path || '');
}

export async function buildFinanceBudgetBuilderV1(db, { targetYear, now = new Date() }) {
  const baseYear = targetYear - 1;
  const priorYear = targetYear - 2;
  const [base, prior, planResult, overrideRow] = await Promise.all([
    resolvedYear(db, baseYear),
    resolvedYear(db, priorYear),
    db.prepare(
      `SELECT category, classification, planned_amount_cents, basis, growth_pct, base_amount_cents, notes
         FROM finance_budget_plan WHERE fiscal_year=?`
    ).bind(targetYear).all(),
    db.prepare("SELECT value FROM finance_settings WHERE key='finance_base_proj_overrides'").first(),
  ]);
  let overrides = {};
  try { overrides = (JSON.parse(overrideRow?.value || '{}') || {})[String(baseYear)] || {}; } catch { overrides = {}; }
  const throughWeek = baseYear === now.getFullYear() ? weeksElapsedInYear(now) : 52;
  const prorated = throughWeek < 52;

  const lines = new Map();
  const line = (category, classification, name) => {
    if (!lines.has(category)) {
      lines.set(category, {
        category, classification: PLAN_SIDE[classification] || 'Expenses', name: name || lastSegment(category),
        priorActualCents: null, baseBudgetCents: null, baseActualCents: null, projectedCents: null, projectedOverridden: false, plan: null,
      });
    }
    return lines.get(category);
  };
  for (const r of prior) line(r.category_path, r.classification, r.account_name).priorActualCents = r.own_actual_cents || 0;
  for (const r of base) {
    const l = line(r.category_path, r.classification, r.account_name);
    l.baseBudgetCents = r.own_budget_cents == null ? null : r.own_budget_cents;
    l.baseActualCents = r.own_actual_cents || 0;
  }
  for (const p of planResult.results || []) {
    const l = line(p.category, p.classification);
    l.plan = {
      plannedAmountCents: p.planned_amount_cents, basis: p.basis,
      growthPct: p.growth_pct == null ? null : p.growth_pct,
      baseAmountCents: p.base_amount_cents == null ? null : p.base_amount_cents,
      notes: p.notes || '',
    };
  }
  for (const l of lines.values()) {
    if (overrides[l.category] != null) { l.projectedCents = overrides[l.category]; l.projectedOverridden = true; continue; }
    const actual = l.baseActualCents || 0;
    l.projectedCents = actual && prorated ? Math.round(actual * (52 / throughWeek)) : (actual || l.baseBudgetCents || null);
  }
  const ordered = [...lines.values()].sort((a, b) => (a.classification === b.classification
    ? a.category.localeCompare(b.category) : a.classification === 'Income' ? -1 : 1));
  return {
    contract: 'connect.finance-budget-builder.v1',
    dataClassification: 'aggregate',
    targetYear, baseYear, priorYear,
    throughWeek: Math.round(throughWeek * 10) / 10,
    prorated,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    lines: ordered,
  };
}

export async function respondWithFinanceBudgetBuilderV1(url, db) {
  const targetYear = Number(url.searchParams.get('target_year'));
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2100) {
    return json({ error: 'target_year is required as a 4-digit year' }, 400);
  }
  return json(await buildFinanceBudgetBuilderV1(db, { targetYear }));
}
