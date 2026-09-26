import { json } from './auth.js';
import {
  FLOW_EXPENSE_CATEGORIES, REVENUE_STREAMS, classifyFlowExpense, computeRevenueStreams,
  expenseGroupLabel, readFlowExpenseOverrides, readRevenueStreamOverrides, resolveChurchYearPrecedence,
} from './api-finance.js';
import { validateFinanceClassificationV1 } from '../contracts/validators/finance-classification-consumer.js';

const REVENUE_LABELS = {
  donor: 'Donor income', earned: 'Earned income', passive: 'Passive income', restricted: 'Restricted giving',
};

export async function buildFinanceClassificationV1(db, { fiscalYear, now = new Date() }) {
  const [revenueOverrides, expenseOverrides, rowResult] = await Promise.all([
    readRevenueStreamOverrides(db),
    readFlowExpenseOverrides(db),
    db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0').bind(fiscalYear).all(),
  ]);
  const entries = resolveChurchYearPrecedence(rowResult.results || []);
  const revenue = computeRevenueStreams(entries, revenueOverrides);
  const revenueGroups = REVENUE_STREAMS.flatMap((stream) => revenue.streams[stream].groups.map((group) => ({
    label: group.label, actualCents: group.cents, budgetCents: group.budgetCents,
    stream, mapped: Object.prototype.hasOwnProperty.call(revenueOverrides, group.label),
  }))).sort((a, b) => b.actualCents - a.actualCents || a.label.localeCompare(b.label));

  const expenseGroups = new Map();
  for (const row of entries) {
    if (!['Expenses', 'Other Expenses', 'Cost of Goods Sold'].includes(row.classification)) continue;
    const label = expenseGroupLabel(row.category_path, row.account_name);
    if (!label) continue;
    if (!expenseGroups.has(label)) {
      const resolved = classifyFlowExpense(label, expenseOverrides);
      expenseGroups.set(label, { label, actualCents: 0, key: resolved.key, mapped: resolved.mapped });
    }
    expenseGroups.get(label).actualCents += row.own_actual_cents || 0;
  }

  return {
    contract: 'connect.finance-classification.v1', dataClassification: 'aggregate',
    sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    revenueStreams: {
      options: REVENUE_STREAMS.map((key) => ({ key, label: REVENUE_LABELS[key] })),
      groups: revenueGroups,
    },
    expenseCategories: {
      options: FLOW_EXPENSE_CATEGORIES.map(({ key, label }) => ({ key, label })),
      groups: [...expenseGroups.values()].sort((a, b) => b.actualCents - a.actualCents || a.label.localeCompare(b.label)),
    },
  };
}

export async function respondWithFinanceClassificationV1(url, db) {
  const year = Number(url.searchParams.get('fiscal_year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return json({ error: 'fiscal_year must be a 4-digit year' }, 400);
  const payload = await buildFinanceClassificationV1(db, { fiscalYear: year });
  const validation = validateFinanceClassificationV1(payload);
  if (!validation.ok) return json({ error: 'Internal: assembled classification failed contract validation', details: validation.errors }, 500);
  return json(payload);
}
