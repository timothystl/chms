import { json } from './auth.js';
import { validateFinancePropertyPolicyV1 } from '../contracts/validators/finance-property-policy-consumer.js';

function nonnegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

export async function buildFinancePropertyPolicyV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(`finance_property_${propertyKey}_meta`).first();
  let meta = {};
  try { meta = row?.value ? JSON.parse(row.value) : {}; } catch { meta = {}; }
  const reserves = meta?.reserves && typeof meta.reserves === 'object' ? meta.reserves : {};
  const capital = meta?.capital && typeof meta.capital === 'object' ? meta.capital : {};
  const method = ['ledger', 'flat', 'per_sqft', 'flat_plus_sqft'].includes(capital.method) ? capital.method : 'ledger';
  return {
    contract: 'connect.finance-property-policy.v1', dataClassification: 'aggregate',
    sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', propertyKey,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    reservePolicy: { baseMinimumCents: nonnegativeIntegerOrNull(reserves.base_minimum_cents) ?? 0 },
    capitalPolicy: {
      method,
      annualAllowanceCents: nonnegativeIntegerOrNull(capital.annual_allowance_cents),
      perSquareFootCents: nonnegativeIntegerOrNull(capital.per_sqft_cents),
    },
  };
}

export async function respondWithFinancePropertyPolicyV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  if (!/^[a-z0-9_-]+$/.test(propertyKey)) return json({ error: 'property_key is invalid' }, 400);
  const payload = await buildFinancePropertyPolicyV1(db, { propertyKey });
  const validation = validateFinancePropertyPolicyV1(payload);
  if (!validation.ok) return json({ error: 'Internal: assembled property policy failed contract validation', details: validation.errors }, 500);
  return json(payload);
}
