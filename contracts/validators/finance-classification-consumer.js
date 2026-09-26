const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'fiscalYear', 'generatedAt', 'revenueStreams', 'expenseCategories'];
const SECTION_KEYS = ['options', 'groups'];
const OPTION_KEYS = ['key', 'label'];
const REVENUE_GROUP_KEYS = ['label', 'actualCents', 'budgetCents', 'stream', 'mapped'];
const EXPENSE_GROUP_KEYS = ['label', 'actualCents', 'key', 'mapped'];

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function validOptions(options) {
  return Array.isArray(options) && options.length > 0 && options.every((option) => exact(option, OPTION_KEYS) && text(option.key) && text(option.label))
    && new Set(options.map((option) => option.key)).size === options.length;
}
function validGroups(groups, keys, allowed, categoryField) {
  return Array.isArray(groups) && groups.every((group) => exact(group, keys) && text(group.label)
    && Number.isInteger(group.actualCents) && (keys.includes('budgetCents') ? Number.isInteger(group.budgetCents) : true)
    && typeof group.mapped === 'boolean' && allowed.has(group[categoryField]))
    && new Set(groups.map((group) => group.label)).size === groups.length;
}

export function validateFinanceClassificationV1(value) {
  const errors = [];
  if (!exact(value, ROOT_KEYS)) return { ok: false, errors: ['root must contain exactly the classification fields'] };
  if (value.contract !== 'connect.finance-classification.v1') errors.push('contract mismatch');
  if (value.dataClassification !== 'aggregate' || value.sourceProduct !== 'connect' || value.consumerProduct !== 'finance' || value.currency !== 'USD') errors.push('contract identity mismatch');
  if (!Number.isInteger(value.fiscalYear) || value.fiscalYear < 2000 || value.fiscalYear > 2100) errors.push('fiscalYear invalid');
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) errors.push('generatedAt invalid');
  for (const name of ['revenueStreams', 'expenseCategories']) if (!exact(value[name], SECTION_KEYS)) errors.push(`${name} shape invalid`);
  if (!errors.length) {
    if (!validOptions(value.revenueStreams.options)) errors.push('revenue options invalid');
    if (!validOptions(value.expenseCategories.options)) errors.push('expense options invalid');
    const revenueKeys = new Set(value.revenueStreams.options.map((option) => option.key));
    const expenseKeys = new Set(value.expenseCategories.options.map((option) => option.key));
    if (!validGroups(value.revenueStreams.groups, REVENUE_GROUP_KEYS, revenueKeys, 'stream')) errors.push('revenue groups invalid');
    if (!validGroups(value.expenseCategories.groups, EXPENSE_GROUP_KEYS, expenseKeys, 'key')) errors.push('expense groups invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinanceClassificationV1(value) {
  const result = validateFinanceClassificationV1(value);
  if (!result.ok) throw new Error(`Invalid connect.finance-classification.v1: ${result.errors.join('; ')}`);
  return structuredClone(value);
}
