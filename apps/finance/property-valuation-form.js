import { buildPropertyValuationView } from './property-report-service.js';

// The valuation section legacy's finValSave (src/frontend/js-finance.js) writes: the inputs, plus
// the computed outputs its equity figure reads from the stored record. Operating-cost keys are the
// fixed set connect.finance-property-valuation.v1 exposes, so no arbitrary key reaches Connect.
const PROPERTY_VALUATION_COST_KEYS = ['utilities', 'trash', 'maintenance_repairs', 'landscaping_snow', 'legal', 'taxes', 'insurance'];

export function buildPropertyValuationMetaFromForm(form, today = new Date()) {
  const number = (name) => {
    const raw = String(form.get(name) ?? '').trim();
    if (raw === '') return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : NaN;
  };
  const cents = (name) => Math.round(number(name) * 100);
  const tenants = form.getAll('tenant');
  const sqfts = form.getAll('sqft');
  const rents = form.getAll('annual_rent');
  const rentRoll = [];
  for (let i = 0; i < tenants.length; i += 1) {
    const tenant = String(tenants[i] || '').trim();
    if (!tenant) continue;
    const sqft = Math.round(Number(sqfts[i] || 0));
    const rent = Math.round(Number(rents[i] || 0) * 100);
    if (!Number.isFinite(sqft) || sqft < 0 || !Number.isFinite(rent) || rent < 0) return { error: `Rent roll row for ${tenant.slice(0, 60)} needs non-negative numbers` };
    rentRoll.push({ tenant: tenant.slice(0, 120), sqft, annual_rent_cents: rent });
  }
  const operatingCosts = {};
  for (const key of PROPERTY_VALUATION_COST_KEYS) operatingCosts[`${key}_cents`] = cents(`oc_${key}`);
  const inputs = {
    utility_reimbursement_cents: cents('utility_reimbursement'),
    vacancy_rate_pct: number('vacancy_rate_pct') / 100,
    management_fee_pct: number('management_fee_pct') / 100,
    cap_rate: number('cap_rate_pct') / 100,
  };
  if ([...Object.values(operatingCosts), ...Object.values(inputs)].some((value) => !Number.isFinite(value))) {
    return { error: 'Amounts and percentages must be non-negative numbers' };
  }
  if (inputs.vacancy_rate_pct > 1 || inputs.management_fee_pct > 1) return { error: 'Percentages must be 100 or less' };
  if (!(inputs.cap_rate > 0 && inputs.cap_rate <= 1)) return { error: 'Enter a cap rate between 0 and 100 percent' };
  const { totals } = buildPropertyValuationView({
    assumptions: inputs,
    rentRoll: rentRoll.map((row) => ({ annual_rent_cents: row.annual_rent_cents })),
    operatingCosts: Object.values(operatingCosts).map((value) => ({ annual_cost_cents: value })),
  });
  return {
    rent_roll: rentRoll,
    ...inputs,
    operating_costs: operatingCosts,
    gross_rental_income_cents: totals.grossRentalIncomeCents,
    total_operating_costs_incl_mgmt_fee_cents: totals.totalOperatingCostsCents,
    net_operating_income_cents: totals.noiCents,
    capitalized_value_cents: totals.capitalizedValueCents,
    as_of_date: today.toISOString().slice(0, 10),
  };
}
