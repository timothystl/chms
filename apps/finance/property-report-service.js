import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinancePropertyValuation } from './finance-property-valuation-client.js';
import { fetchLiveFinancePropertyOperating } from './finance-property-operating-client.js';
import { fetchLiveFinancePropertyReserves } from './finance-property-reserves-client.js';
import { fetchLiveFinancePropertyLedgers } from './finance-property-ledgers-client.js';

const INTEGER_FIELDS = [
  'total_revenue_cents', 'total_expenses_cents', 'net_income_cents',
  'net_operating_income_cents', 'available_for_distribution_cents', 'reserve_balance_cents',
];

export async function readSyntheticPropertyReport(db) {
  const sql = "SELECT property_key, period, occupancy_pct, total_revenue_cents, total_expenses_cents, net_income_cents, net_operating_income_cents, available_for_distribution_cents, reserve_balance_cents FROM finance_property_monthly WHERE source_report='synthetic_fixture' ORDER BY period";
  const { results } = await runBudgetedReadBatch(db, 'propertyReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    row.property_key !== 'synthetic-property'
    || typeof row.period !== 'string'
    || !/^\d{4}-\d{2}$/.test(row.period)
    || typeof row.occupancy_pct !== 'number'
    || !Number.isFinite(row.occupancy_pct)
    || INTEGER_FIELDS.some((field) => !Number.isInteger(row[field]))
  )) throw new Error('Synthetic Commercial Property rows invalid');
  return rows.map((row) => ({ ...row }));
}

export async function readSyntheticPropertyReserves(db) {
  const sql = "SELECT reserve_key, report_month, tax_year, target_estimate_cents, reserve_before_cents, contribution_cents, reserve_after_cents, note FROM finance_property_reserves WHERE property_key='synthetic-property' ORDER BY reserve_key, report_month";
  const { results } = await runBudgetedReadBatch(db, 'propertyReserves', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row, index) =>
    row.reserve_key !== 'property_tax'
    || typeof row.report_month !== 'string'
    || !/^\d{4}-\d{2}$/.test(row.report_month)
    || !Number.isInteger(row.tax_year)
    || !Number.isInteger(row.target_estimate_cents)
    || !Number.isInteger(row.reserve_before_cents)
    || !Number.isInteger(row.contribution_cents)
    || !Number.isInteger(row.reserve_after_cents)
    || row.reserve_after_cents !== row.reserve_before_cents + row.contribution_cents
    || typeof row.note !== 'string'
    || (index > 0 && row.reserve_before_cents !== rows[index - 1].reserve_after_cents)
  )) throw new Error('Synthetic Commercial Property reserve rows invalid');
  return rows.map((row) => ({
    ...row,
    funded_pct: row.target_estimate_cents > 0 ? row.reserve_after_cents / row.target_estimate_cents * 100 : 0,
  }));
}

export async function readSyntheticPropertyLedgers(db) {
  const statements = [
    "SELECT entry_date, amount_cents, payee, description, project FROM finance_property_capital_ledger WHERE property_key='synthetic-property' ORDER BY entry_date, id",
    "SELECT entry_date, category, description, amount_cents, payee, capitalized FROM finance_property_repairs WHERE property_key='synthetic-property' ORDER BY entry_date, id",
  ];
  const { results } = await runBudgetedReadBatch(db, 'propertyLedgers', statements);
  const capital = results[0]?.results;
  const repairs = results[1]?.results;
  if (!Array.isArray(capital) || capital.length === 0 || capital.some((row) =>
    typeof row.entry_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date)
    || !Number.isInteger(row.amount_cents)
    || row.amount_cents < 0
    || ['payee', 'description', 'project'].some((field) => typeof row[field] !== 'string')
  )) throw new Error('Synthetic Commercial Property capital rows invalid');
  if (!Array.isArray(repairs) || repairs.length === 0 || repairs.some((row) =>
    typeof row.entry_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date)
    || !Number.isInteger(row.amount_cents)
    || row.amount_cents < 0
    || ![0, 1].includes(row.capitalized)
    || ['category', 'description', 'payee'].some((field) => typeof row[field] !== 'string')
  )) throw new Error('Synthetic Commercial Property repair rows invalid');
  return {
    capital: capital.map((row) => ({ ...row })),
    repairs: repairs.map((row) => ({ ...row })),
    totals: {
      capital_cents: capital.reduce((sum, row) => sum + row.amount_cents, 0),
      repairs_cents: repairs.reduce((sum, row) => sum + row.amount_cents, 0),
    },
  };
}

export async function readSyntheticPropertyValuation(db) {
  const statements = [
    "SELECT property_key, utility_reimbursement_cents, vacancy_rate_pct, management_fee_pct, cap_rate FROM finance_property_valuation_assumptions WHERE property_key='synthetic-property' AND source='synthetic_fixture'",
    "SELECT unit_key, tenant_label, square_feet, annual_rent_cents FROM finance_property_rent_roll WHERE property_key='synthetic-property' AND source='synthetic_fixture' ORDER BY unit_key",
    "SELECT cost_key, cost_label, annual_cost_cents FROM finance_property_operating_costs WHERE property_key='synthetic-property' AND source='synthetic_fixture' ORDER BY cost_key",
  ];
  const { results } = await runBudgetedReadBatch(db, 'propertyValuation', statements);
  const assumptionRows = results[0]?.results;
  const rentRoll = results[1]?.results;
  const operatingCosts = results[2]?.results;
  const assumptions = assumptionRows?.[0];
  if (!Array.isArray(assumptionRows) || assumptionRows.length !== 1
    || assumptions.property_key !== 'synthetic-property'
    || !Number.isInteger(assumptions.utility_reimbursement_cents)
    || assumptions.utility_reimbursement_cents < 0
    || ![assumptions.vacancy_rate_pct, assumptions.management_fee_pct, assumptions.cap_rate]
      .every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
    || assumptions.cap_rate === 0
    || !Array.isArray(rentRoll) || rentRoll.length === 0 || rentRoll.some((row) =>
      typeof row.unit_key !== 'string' || row.unit_key.trim() === ''
      || typeof row.tenant_label !== 'string' || row.tenant_label.trim() === ''
      || !Number.isInteger(row.square_feet) || row.square_feet < 0
      || !Number.isInteger(row.annual_rent_cents) || row.annual_rent_cents < 0)
    || !Array.isArray(operatingCosts) || operatingCosts.length === 0 || operatingCosts.some((row) =>
      typeof row.cost_key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.cost_key)
      || typeof row.cost_label !== 'string' || row.cost_label.trim() === ''
      || !Number.isInteger(row.annual_cost_cents) || row.annual_cost_cents < 0)
  ) throw new Error('Synthetic Commercial Property valuation rows invalid');
  return {
    assumptions: { ...assumptions },
    rentRoll: rentRoll.map((row) => ({ ...row })),
    operatingCosts: operatingCosts.map((row) => ({ ...row })),
  };
}

// Tries the real connect.finance-property-valuation.v1 endpoint for the default property
// (3277 Ivanhoe); falls back to the existing synthetic fixture whenever the live call isn't
// configured yet or fails for any reason -- same never-throws, always-labeled pattern as
// balance-sheet-service.js's resolveBalanceSheet. `db` here is Finance's own FINANCE_DB, used
// only for the synthetic fallback path. Returns the same {assumptions, rentRoll, operatingCosts}
// shape either way (property_key/tenant_label/cost_key etc., snake_case) so
// buildPropertyValuationView -- and both the 'rent-roll' and 'valuation' pages -- never need to
// know which source produced it.
export async function resolvePropertyValuation(env, db) {
  const result = await fetchLiveFinancePropertyValuation(env);
  if (result.ok) {
    const v = result.valuation;
    return {
      source: 'live',
      propertyKey: v.propertyKey,
      asOfDate: v.asOfDate,
      assumptions: {
        property_key: v.assumptions.propertyKey,
        utility_reimbursement_cents: v.assumptions.utilityReimbursementCents,
        vacancy_rate_pct: v.assumptions.vacancyRatePct,
        management_fee_pct: v.assumptions.managementFeePct,
        cap_rate: v.assumptions.capRate,
      },
      rentRoll: v.rentRoll.map((row) => ({
        unit_key: row.unitKey, tenant_label: row.tenantLabel,
        square_feet: row.squareFeet, annual_rent_cents: row.annualRentCents,
      })),
      operatingCosts: v.operatingCosts.map((row) => ({
        cost_key: row.costKey, cost_label: row.costLabel, annual_cost_cents: row.annualCostCents,
      })),
    };
  }
  const input = await readSyntheticPropertyValuation(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, ...input };
}

export function buildPropertyValuationView(input) {
  const totalAnnualRentCents = input.rentRoll.reduce((sum, row) => sum + row.annual_rent_cents, 0);
  const grossRentalIncomeCents = totalAnnualRentCents + input.assumptions.utility_reimbursement_cents;
  const vacancyCents = Math.round(grossRentalIncomeCents * input.assumptions.vacancy_rate_pct);
  const effectiveRentalIncomeCents = grossRentalIncomeCents - vacancyCents;
  const itemizedOperatingCostsCents = input.operatingCosts.reduce((sum, row) => sum + row.annual_cost_cents, 0);
  const managementFeeCents = Math.round(effectiveRentalIncomeCents * input.assumptions.management_fee_pct);
  const totalOperatingCostsCents = itemizedOperatingCostsCents + managementFeeCents;
  const noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
  const capitalizedValueCents = Math.round(noiCents / input.assumptions.cap_rate);
  return {
    ...input,
    totals: {
      totalAnnualRentCents, grossRentalIncomeCents, vacancyCents, effectiveRentalIncomeCents,
      itemizedOperatingCostsCents, managementFeeCents, totalOperatingCostsCents, noiCents,
      capitalizedValueCents,
      reconciled: effectiveRentalIncomeCents - itemizedOperatingCostsCents - managementFeeCents === noiCents,
    },
  };
}

// Tries the real connect.finance-property-operating.v1 endpoint for the default property (3277
// Ivanhoe); falls back to the caller's own already-fetched synthetic readSyntheticPropertyReport
// rows whenever the live call isn't configured yet or fails for any reason -- same never-throws,
// always-labeled pattern as resolvePropertyValuation above. Takes the synthetic rows as a
// parameter, rather than re-reading them itself, so a 'property'-section page load that ends up
// on the synthetic fallback still only runs the query-budgeted synthetic read once (it's already
// unconditionally fetched into the top-level `propertyReport` variable every 'property'/'health'
// page needs) -- see query-budget.js's own per-request statement-count discipline. Only the
// 'property' section's 'operating-results' page uses the result of this resolver;
// 'overview'/'health' keep reading the plain synthetic rows directly, unchanged and out of scope
// for this contract.
//
// Real finding confirmed against production on 2026-09-15 (see src/api-contracts.js's
// buildFinancePropertyOperatingV1 header comment): occupancy_pct is a 0-1 fraction in real data,
// not the synthetic fixture's 0-100 scale -- the *100 here is what keeps renderPropertyRows()
// (which expects 0-100, matching what the synthetic fixture happens to store) correct for both
// sources without renderPropertyRows itself needing to know which one produced its input.
export async function resolvePropertyReport(env, syntheticRows) {
  const result = await fetchLiveFinancePropertyOperating(env);
  if (result.ok) {
    return {
      source: 'live',
      rows: result.operating.periods.map((p) => ({
        property_key: result.operating.propertyKey,
        period: p.period,
        occupancy_pct: p.occupancyPct * 100,
        total_revenue_cents: p.totalRevenueCents,
        total_expenses_cents: p.totalExpensesCents,
        net_income_cents: p.netIncomeCents,
        net_operating_income_cents: p.netOperatingIncomeCents,
        available_for_distribution_cents: p.availableForDistributionCents,
        reserve_balance_cents: p.reserveBalanceCents,
      })),
      annualSummary: result.operating.annualSummary,
    };
  }
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows: syntheticRows };
}

// Tries the real connect.finance-property-reserves.v1 endpoint for the default property; falls
// back to the caller's own already-fetched synthetic readSyntheticPropertyReserves rows whenever
// the live call isn't configured yet or fails for any reason -- same never-throws, always-labeled
// pattern as resolvePropertyValuation/resolvePropertyReport above. Only the 'property' section's
// 'reserve-distribution' page uses this; the 'charts' section keeps reading the plain synthetic
// propertyReserves array directly (unchanged, out of scope for this contract -- that section
// never displays a live/synthetic distinction for any of its inputs today).
//
// reserveDisbursements is reshaped into `disbursements` for Reserve & distribution's disbursement
// log, paired with the schedule the same way legacy's finRenderPropertyTaxReserve
// (src/frontend/js-finance.js) pairs them.
export async function resolvePropertyReserves(env) {
  const result = await fetchLiveFinancePropertyReserves(env);
  if (result.ok) {
    return {
      source: 'live',
      rows: result.reserves.reserves.map((r) => ({
        reserve_key: r.reserveKey,
        report_month: r.reportMonth,
        tax_year: r.taxYear,
        target_estimate_cents: r.targetEstimateCents,
        reserve_before_cents: r.reserveBeforeCents,
        contribution_cents: r.contributionCents,
        reserve_after_cents: r.reserveAfterCents,
        funded_pct: r.fundedPct,
        note: r.note,
      })),
      distributions: result.reserves.distributions.map((d) => ({ period: d.period, amount_cents: d.amountCents })),
      disbursements: result.reserves.reserveDisbursements.map((d) => ({
        reserve_key: d.reserveKey, period_key: d.periodKey, amount_cents: d.amountCents,
        paid_via_report_month: d.paidViaReportMonth, note: d.note,
      })),
    };
  }
  return { source: 'synthetic-fallback', fallbackReason: result.reason };
}

// Tries the real connect.finance-property-ledgers.v1 endpoint for the default property; falls
// back to the caller's own already-fetched synthetic readSyntheticPropertyLedgers result whenever
// the live call isn't configured yet or fails for any reason -- same never-throws, always-labeled
// pattern as the resolvers above. Reshaped into the same snake_case row shape
// readSyntheticPropertyLedgers already returns so renderPropertyCapitalRows/
// renderPropertyRepairRows never need to know which source produced their input.
export async function resolvePropertyLedgers(env) {
  const result = await fetchLiveFinancePropertyLedgers(env);
  if (result.ok) {
    return {
      source: 'live',
      capital: result.ledgers.capital.map((c) => ({
        entry_date: c.entryDate, amount_cents: c.amountCents, payee: c.payee,
        description: c.description, project: c.project, id: c.id ?? null,
      })),
      repairs: result.ledgers.repairs.map((r) => ({
        entry_date: r.entryDate, category: r.category, description: r.description,
        amount_cents: r.amountCents, payee: r.payee, capitalized: r.capitalized ? 1 : 0, id: r.id ?? null,
      })),
      totals: { capital_cents: result.ledgers.totals.capitalCents, repairs_cents: result.ledgers.totals.repairsCents },
    };
  }
  return { source: 'synthetic-fallback', fallbackReason: result.reason };
}

export function buildPropertyReportView(rows) {
  const totals = (field) => rows.reduce((sum, row) => sum + row[field], 0);
  return {
    propertyKey: rows[0].property_key,
    periodStart: rows[0].period,
    periodEnd: rows.at(-1).period,
    averageOccupancyPct: rows.reduce((sum, row) => sum + row.occupancy_pct, 0) / rows.length,
    rows,
    totals: {
      revenueCents: totals('total_revenue_cents'),
      expenseCents: totals('total_expenses_cents'),
      netIncomeCents: totals('net_income_cents'),
      distributableCents: totals('available_for_distribution_cents'),
      latestReserveCents: rows.at(-1).reserve_balance_cents,
    },
  };
}
