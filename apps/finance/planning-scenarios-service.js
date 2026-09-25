// Planning scenarios and the multi-year forecast (v3 design). The budget plan stays in Connect
// (connect.finance-planning-basis.v1 returns its lines, each sorted into a group); a scenario is a
// set of percentage changes applied to those groups, stored in Finance's own
// finance_planning_scenarios table. "Budget plan" is always the saved plan itself, unchanged.
import { FormValidationError, oneOf, text } from './form-fields.js';
import { runBudgetedReadBatch } from './query-budget.js';

export const SCENARIO_SLOTS = Object.freeze(['conservative', 'plan', 'hopeful']);
export const ADJUSTMENTS = Object.freeze([
  { key: 'giving_pct', label: 'Giving', groups: ['donor', 'restricted'], side: 'Income' },
  { key: 'earned_pct', label: 'Earned income', groups: ['earned'], side: 'Income', hint: 'Daycare, rentals, fees' },
  { key: 'passive_pct', label: 'Passive income', groups: ['passive'], side: 'Income', hint: 'Investments, property distributions' },
  { key: 'staff_pct', label: 'Staff costs', groups: ['salaries'], side: 'Expenses', hint: 'Salaries and benefits' },
  { key: 'other_pct', label: 'Other expenses', groups: ['mdo', 'property', 'education', 'programs'], side: 'Expenses' },
]);

export const DEFAULT_SCENARIOS = Object.freeze({
  conservative: { slot: 'conservative', name: 'Conservative', note: 'Plan for a soft year', giving_pct: -3, earned_pct: -2, passive_pct: -10, staff_pct: 0, other_pct: 0 },
  plan: { slot: 'plan', name: 'Budget plan', note: 'The saved plan, unchanged', giving_pct: 0, earned_pct: 0, passive_pct: 0, staff_pct: 0, other_pct: 0 },
  hopeful: { slot: 'hopeful', name: 'Hopeful', note: 'Giving grows beyond the plan', giving_pct: 2, earned_pct: 0, passive_pct: 0, staff_pct: 0, other_pct: 0 },
});

const PLANNING_READ_SQL = [
  'SELECT fiscal_year, slot, name, note, giving_pct, earned_pct, passive_pct, staff_pct, other_pct, updated_at, updated_by FROM finance_planning_scenarios',
  'SELECT fiscal_year, slot, chosen_at, chosen_by FROM finance_planning_basis',
];

export async function readPlanningScenarios(db, fiscalYear) {
  const { results } = await runBudgetedReadBatch(db, 'planning', PLANNING_READ_SQL);
  const rows = { results: (results[0]?.results || []).filter((r) => r.fiscal_year === fiscalYear) };
  const basis = { results: (results[1]?.results || []).filter((r) => r.fiscal_year === fiscalYear) };
  const saved = new Map((rows.results || []).map((r) => [r.slot, r]));
  const chosen = (basis.results || [])[0] || null;
  return {
    fiscalYear,
    scenarios: SCENARIO_SLOTS.map((slot) => ({ ...DEFAULT_SCENARIOS[slot], ...(slot === 'plan' ? {} : saved.get(slot) || {}), saved: saved.has(slot) })),
    basisSlot: chosen?.slot || 'plan',
    basisChosen: chosen,
  };
}

// Totals for the plan with a scenario's changes applied. Lines in a group no adjustment names
// (none today) pass through unchanged, so the scenario never silently drops a line.
export function applyScenario(lines, scenario) {
  const pctFor = (line) => {
    const adj = ADJUSTMENTS.find((a) => a.side === line.classification && a.groups.includes(line.group));
    return adj ? Number(scenario[adj.key]) || 0 : 0;
  };
  let incomeCents = 0;
  let expenseCents = 0;
  const byAdjustment = Object.fromEntries(ADJUSTMENTS.map((a) => [a.key, { planCents: 0, scenarioCents: 0 }]));
  for (const line of lines) {
    const cents = Math.round(line.plannedAmountCents * (1 + pctFor(line) / 100));
    if (line.classification === 'Income') incomeCents += cents; else expenseCents += cents;
    const adj = ADJUSTMENTS.find((a) => a.side === line.classification && a.groups.includes(line.group));
    if (adj) { byAdjustment[adj.key].planCents += line.plannedAmountCents; byAdjustment[adj.key].scenarioCents += cents; }
  }
  return { incomeCents, expenseCents, resultCents: incomeCents - expenseCents, byAdjustment };
}

// Five fiscal years: the first is the scenario-adjusted plan; each later year grows income and
// expenses by the given annual rates. Cash starts from today's operating cash and adds each
// year's result; months of reserve divide year-end cash by that year's monthly expenses.
export function buildForecast({ firstYear, first, incomeGrowthPct, expenseGrowthPct, startCashCents, years = 5 }) {
  const rows = [];
  let income = first.incomeCents;
  let expense = first.expenseCents;
  let cash = Number.isFinite(startCashCents) ? startCashCents : null;
  for (let i = 0; i < years; i += 1) {
    if (i > 0) {
      income = Math.round(income * (1 + incomeGrowthPct / 100));
      expense = Math.round(expense * (1 + expenseGrowthPct / 100));
    }
    const result = income - expense;
    if (cash !== null) cash += result;
    rows.push({
      fiscalYear: firstYear + i, incomeCents: income, expenseCents: expense, resultCents: result,
      cashCents: cash, reserveMonths: cash !== null && expense > 0 ? cash / (expense / 12) : null,
    });
  }
  return rows;
}

export function readGrowth(params, key, fallback) {
  const raw = params?.get(key);
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(String(raw).replace(/[%\s+]/g, ''));
  return Number.isFinite(n) ? Math.min(15, Math.max(-15, Math.round(n * 10) / 10)) : fallback;
}

function percent(value, label) {
  const v = String(value ?? '').replace(/[%\s+]/g, '');
  if (!/^-?\d{1,2}(\.\d)?$/.test(v) || Math.abs(Number(v)) > 50) throw new FormValidationError(`${label} must be a percentage between -50 and 50, like -2.5.`);
  return Number(v);
}

function fiscalYearField(value) {
  const v = String(value ?? '').trim();
  if (!/^\d{4}$/.test(v) || Number(v) < 2000 || Number(v) > 2100) throw new FormValidationError('Unknown fiscal year.');
  return Number(v);
}

async function saveScenario(db, form, actor) {
  const fiscalYear = fiscalYearField(form.fiscal_year);
  const slot = oneOf(form.slot, ['conservative', 'hopeful'], 'scenario');
  const name = text(form.name, 40, 'Name', { required: true });
  const note = text(form.note, 80, 'Note');
  const values = ADJUSTMENTS.map((a) => percent(form[a.key], a.label));
  await db.prepare(
    `INSERT INTO finance_planning_scenarios (fiscal_year, slot, name, note, giving_pct, earned_pct, passive_pct, staff_pct, other_pct, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fiscal_year, slot) DO UPDATE SET name=excluded.name, note=excluded.note, giving_pct=excluded.giving_pct,
       earned_pct=excluded.earned_pct, passive_pct=excluded.passive_pct, staff_pct=excluded.staff_pct, other_pct=excluded.other_pct,
       updated_by=excluded.updated_by, updated_at=datetime('now')`
  ).bind(fiscalYear, slot, name, note, ...values, String(actor || '')).run();
  return {};
}

async function chooseBasis(db, form, actor) {
  const fiscalYear = fiscalYearField(form.fiscal_year);
  const slot = oneOf(form.slot, SCENARIO_SLOTS, 'scenario');
  await db.prepare(
    `INSERT INTO finance_planning_basis (fiscal_year, slot, chosen_by) VALUES (?, ?, ?)
     ON CONFLICT(fiscal_year) DO UPDATE SET slot=excluded.slot, chosen_by=excluded.chosen_by, chosen_at=datetime('now')`
  ).bind(fiscalYear, slot, String(actor || '')).run();
  return {};
}

export const PLANNING_WRITERS = Object.freeze({
  'planning-scenario-save-v1': { run: saveScenario, page: 'scenarios' },
  'planning-scenario-basis-v1': { run: chooseBasis, page: 'scenarios' },
});

export function canEditPlanning(roleResult) {
  if (!roleResult || !roleResult.ok) return false;
  return roleResult.role === 'admin' || roleResult.permissions?.budget === 'edit';
}
