// Stage 1 `finance_settings` translation pass. Deliberately NOT a table copy -- see
// architecture/evidence/2026-09-13-finance-schema-compatibility-diff.md's "settings layer" section
// and architecture/evidence/2026-09-17-finance-data-migration-stage0-reconciliation.md's "one real
// privacy-sensitive item" section (private digital-architecture repo) for why. Of the 16 real
// `finance_settings` rows, only two get a translation implemented here:
//
//   1. `finance_daycare_allocation_config` -> `daycare_utility_pct` / `daycare_insurance_pct`
//      (translateDaycareAllocationConfig). Clean, fully honest, fully implemented below.
//
//   2. `finance_salary_planner` / `finance_salary_planner_compensation` -> apps/finance's flat
//      `finance_compensation_plan` role summary. NOT a clean translation -- see
//      deriveCompensationSalaryByRole's own header comment below for exactly what is and is not
//      honestly derivable, and why this module stops at a read-only report rather than writing
//      anything into finance_compensation_plan.
//
// The other 14 keys (`finance_revenue_streams`, `finance_flow_expense_map`,
// `finance_planning_board_categories`, `finance_planning_purpose_tags`, `finance_cash_policy`,
// `finance_base_proj_overrides`, `finance_qb_selected_budget_id`, `daycare_last_synced_at`, the
// five `finance_property_ivanhoe_*_seeded` markers, and the three
// `finance_budget_council_<username>`/`finance_salary_planner_council_<username>`/
// `finance_property_<key>_meta` dynamic-prefix families) have no apps/finance consumer today and
// are out of scope for this pass -- they are not translated, and this module does not attempt a
// generic passthrough copy of them either, since "finance_settings needs a per-key translation
// pass, not a table copy" applies to the whole table, not just the two keys above.

// ---------------------------------------------------------------------------------------------
// 1. Daycare utility/insurance allocation -- clean 1:1 reshape, fully implemented.
// ---------------------------------------------------------------------------------------------
//
// Production (src/api-finance.js's finance/daycare/allocation handlers) stores ONE row, key
// `finance_daycare_allocation_config`, value a JSON blob `{"utilityPct":0.5,"insurancePct":0.5}`.
// apps/finance's daycare-report-service.js instead reads TWO rows, `daycare_utility_pct` and
// `daycare_insurance_pct`, each a bare numeric string. This function performs exactly that reshape
// and nothing else -- it does not invent a default; a missing or non-numeric field throws rather
// than silently falling back to production's own 0.5/0.5 default, so a genuinely broken source row
// is never mistaken for a real cost-share decision entered by staff.
export function translateDaycareAllocationConfig(sourceRow, { now } = {}) {
  if (!sourceRow || sourceRow.key !== 'finance_daycare_allocation_config') {
    throw new Error("translateDaycareAllocationConfig expects the 'finance_daycare_allocation_config' settings row");
  }
  let parsed;
  try {
    parsed = JSON.parse(sourceRow.value);
  } catch (err) {
    throw new Error(`finance_daycare_allocation_config value is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('finance_daycare_allocation_config value must be a JSON object');
  }
  const utilityPct = Number(parsed.utilityPct);
  const insurancePct = Number(parsed.insurancePct);
  if (!Number.isFinite(utilityPct) || !Number.isFinite(insurancePct)) {
    throw new Error('finance_daycare_allocation_config must contain numeric utilityPct and insurancePct');
  }
  const updatedAt = now || sourceRow.updated_at || new Date().toISOString();
  // Bare scalar strings, matching apps/finance/fixtures/0006_synthetic_daycare_budget_allocation.sql
  // and daycare-report-service.js's own `Number(pct.daycare_utility_pct)` read -- no JSON parsing
  // on the destination side, so the value must already be a plain number-as-string.
  return [
    { key: 'daycare_utility_pct', value: String(utilityPct), updated_at: updatedAt },
    { key: 'daycare_insurance_pct', value: String(insurancePct), updated_at: updatedAt },
  ];
}

// ---------------------------------------------------------------------------------------------
// 2. Compensation -- documented gap, partial honest read-only aggregation, NO writer.
// ---------------------------------------------------------------------------------------------
//
// Real shape (src/api-finance.js's SALARY_PLANNER_KEY handling; src/frontend/js-finance.js's
// worker-model functions): `finance_salary_planner`/`finance_salary_planner_compensation` hold one
// JSON blob with a `roster` array of individual workers. apps/finance's `finance_compensation_plan`
// (apps/finance/migrations/0002_finance_compensation_staging.sql) is a FLAT role-level summary:
// one row per (fiscal_year, role_label) with salary_cents, benefits_cents, adjustment_pct, basis,
// notes -- no per-worker identity at all. Reconstructing the second from the first loses
// information in both directions apps/finance/README.md already documents (no roster order, no
// per-worker override method, no council overlay) -- that reconstruction is out of scope here.
// What THIS module considers is the narrower question the task actually asks: can an honest
// ROLE-LEVEL SALARY TOTAL be derived from the real roster for a given fiscal year at all?
//
// Per-worker CURRENT pay (finCompCurrentPayCents in src/frontend/js-finance.js) resolves two ways,
// in priority order:
//   (a) a hand-typed `actualSalaryCents` on the worker row itself -- a real number that lives
//       entirely inside the settings blob apps/finance is given, so THIS is honestly derivable; or
//   (b) the linked `accountCode`'s full-year BUDGETED total, resolved by walking the live Chart of
//       Accounts / budget tree (finAccountBudgetCentsForCode against `_finPlanBaseTree`) -- data
//       that lives in `finance_church_entries`/`finance_budget_plan`, not in the settings blob, and
//       requires the exact same account-tree-walk logic the roster page uses at render time. This
//       settings-translation module does not have that tree and does not attempt to reimplement it.
// A real production roster is expected to mix both (see test/finance-compensation-planner.test.js's
// own worked example: every sample worker there uses (b), not (a)), so most real workers' current
// pay is NOT recoverable from the settings blob alone.
//
// benefits_cents and adjustment_pct are even less recoverable: benefits require the full
// pension/disability/employer-FICA rate model plus a per-worker health-plan lookup
// (finCompBenefits/finCompPensionRate/finCompDisabilityRate/finCompFicaRate/
// finCompWorkerHealthCents), none of which live in the roster blob either, and no single
// adjustment_pct exists per worker at all -- each worker instead carries a raise METHOD
// (compMethod/compPerWorkerMethod: none/worksheet/scalepct/cola/custom) plus optional per-worker
// dollar overrides. There is no honest way to collapse that into one role-level percentage.
//
// Given that, this module deliberately stops at a READ-ONLY report:
//   - deriveCompensationSalaryByRole groups workers by role/position and sums only the (a)-case
//     salary it can trust, and separately counts how many workers in that role fall into the
//     (b) case it cannot resolve, so a human reviewing the report can see exactly how incomplete
//     any given role's total is rather than mistaking a partial sum for the real total.
//   - It returns benefits_cents and adjustment_pct as `null` for every role, always -- it never
//     fabricates either figure. `finance_compensation_plan.benefits_cents` is `NOT NULL DEFAULT 0`
//     in the schema, and writing 0 for a role with a real staff member would misrepresent "no
//     benefits cost" for someone who has one, which is exactly the fabricated-zero this codebase's
//     own discipline forbids elsewhere (see apps/finance/README.md's board-packet section: "never
//     a fabricated $0"). So this module provides no function that writes into
//     `finance_compensation_plan` at all -- that decision (whether/how to hand-enter or otherwise
//     honestly source benefits and adjustment figures once real salary data is reviewed) is left to
//     a human, not automated here.
//   - It never returns or logs the raw roster blob, a worker's name, or any other individually-
//     identifying field -- only role_label and aggregate cent/count figures.
export const COMPENSATION_TRANSLATION_GAPS = Object.freeze({
  benefits_cents: 'Requires the full benefits calculation engine (pension/disability/employer-FICA ' +
    'rates plus a per-worker health-plan lookup) -- none of that lives in the roster JSON blob. ' +
    'Never fabricated; always null.',
  adjustment_pct: 'The real roster stores a per-worker raise METHOD plus optional dollar overrides, ' +
    'not one role-level percentage. Collapsing that to a single adjustment_pct would invent a ' +
    'number no real field backs. Never fabricated; always null.',
});

function resolveRoleLabel(worker) {
  const label = (worker && (worker.position || worker.role));
  return (typeof label === 'string' && label.trim()) ? label.trim() : 'Unspecified role';
}

// rosterJsonValue: the raw `value` string of the finance_settings row (never logged or returned).
export function deriveCompensationSalaryByRole(rosterJsonValue, { fiscalYear = null } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(rosterJsonValue);
  } catch (err) {
    throw new Error(`Compensation settings value is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.roster)) {
    throw new Error('Compensation settings value must be an object with a roster array');
  }
  const byRole = new Map();
  for (const worker of parsed.roster) {
    if (!worker || typeof worker !== 'object') continue;
    const roleLabel = resolveRoleLabel(worker);
    const bucket = byRole.get(roleLabel) || {
      roleLabel, workerCount: 0, knownSalaryCents: 0, workersWithUnresolvedSalary: 0,
    };
    bucket.workerCount += 1;
    const known = Number(worker.actualSalaryCents);
    if (Number.isFinite(known)) {
      bucket.knownSalaryCents += Math.round(known);
    } else {
      bucket.workersWithUnresolvedSalary += 1;
    }
    byRole.set(roleLabel, bucket);
  }
  return [...byRole.values()]
    .sort((a, b) => a.roleLabel.localeCompare(b.roleLabel))
    .map((bucket) => ({
      fiscalYear,
      roleLabel: bucket.roleLabel,
      workerCount: bucket.workerCount,
      // Only the sum of directly-stored actualSalaryCents figures -- see this file's header
      // comment for why account-code-linked pay cannot be included here.
      knownSalaryCents: bucket.knownSalaryCents,
      workersWithUnresolvedSalary: bucket.workersWithUnresolvedSalary,
      // True only when EVERY worker in this role had a directly-stored salary this module could
      // trust -- i.e. knownSalaryCents is the whole role's real total, not a partial sum.
      completeSalaryTotal: bucket.workersWithUnresolvedSalary === 0,
      // Deliberately never fabricated -- see COMPENSATION_TRANSLATION_GAPS.
      benefitsCents: null,
      adjustmentPct: null,
    }));
}
