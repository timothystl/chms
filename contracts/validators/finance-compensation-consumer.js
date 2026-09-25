// ── Fail-closed parser for connect.finance-compensation.v1 ─────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// This contract is structurally unlike every other one in this directory. Every prior contract
// (Giving, Data Status, Chart of Accounts, Budget, Church Report, Balance Sheet, Daycare Report)
// is a church-wide or role-level AGGREGATE -- no row is traceable to one named person. This one
// is not: per Andrew's explicit decision (2026-09-14), it carries the real per-person compensation
// roster production's own Salary & Benefits Calculator already stores (finance_settings key
// 'finance_salary_planner' in the shared tlc-volunteer-db) -- name, position, and current pay,
// individually. `dataClassification` stays 'aggregate' per this file's existing convention (it
// still carries real money, like Budget/Church Report/Balance Sheet), but that convention was
// never meant to imply anonymity, and this is the one contract here where the distinction matters:
// it is why this contract is gated by the dedicated 'compensation' ACCESS_GATE item alone (see
// src/api-chms.js), never the blanket 'finance' item every other contract in this file uses, and
// why apps/finance's own consumer (compensation-report-service.js's resolveCompensationReport)
// refuses to even attempt the live fetch unless the caller has independently confirmed the
// viewer's Connect role was verified AND is admin/council/compensation.
//
// Field set is deliberately narrow: exactly the "worker seed facts" production's own code already
// calls out as the sensitive, council-restricted core of this feature (see api-finance.js's
// finance/planning/salary handler comment: "a worker's seed facts (name, position, current pay,
// District Worksheet inputs)") plus the small set of other stored roster fields confirmed present
// in the real DEFAULT_ROSTER shape in src/frontend/js-finance.js. It does NOT include the derived
// District Worksheet DOLLAR figure (finCompWorksheetCents) -- that is a live computation off LCMS
// pay-scale tables that exists only in the frontend calculator, not stored data; reproducing it
// here would duplicate business logic this contract has no way to keep in sync with. It also does
// NOT include the raise-plan/method fields (compMethod, compPerWorkerMethod, compOverrides,
// health-plan settings) -- those are planning-tool UI state scoped to whoever is currently working
// the calculator (and, for council, forked per-username), not a "compensation record" of a person.
const CONTRACT = 'connect.finance-compensation.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'generatedAt', 'workers', 'totals', 'reconciliation'];
const WORKER_KEYS = [
  'name', 'position', 'accountCode', 'role', 'trackKey', 'education', 'yearsExperience',
  'responsibilityStipend', 'attendanceBonus', 'selfEmployedFica', 'hasDependents', 'healthEnrolled',
  'hideFromCouncil', 'currentPayCents', 'currentPaySource',
];
const TOTALS_KEYS = ['workerCount', 'enteredCurrentPayCount', 'unenteredCurrentPayCount', 'enteredCurrentPayCents'];
const RECONCILIATION_KEYS = ['workerCount', 'totalsMatch'];
const CURRENT_PAY_SOURCES = new Set(['entered', 'budget_line', 'unset']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function isDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validateWorker(row, errors, index) {
  const label = `workers[${index}]`;
  if (!hasExactKeys(row, WORKER_KEYS)) {
    errors.push(`${label} must contain exactly the compensation worker fields`);
    return;
  }
  for (const field of ['name', 'position', 'accountCode', 'role', 'trackKey', 'education']) {
    if (typeof row[field] !== 'string') errors.push(`${label}.${field} must be a string (may be empty)`);
  }
  for (const field of ['yearsExperience', 'responsibilityStipend', 'attendanceBonus']) {
    if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) errors.push(`${label}.${field} must be a finite number`);
  }
  for (const field of ['selfEmployedFica', 'hasDependents', 'healthEnrolled', 'hideFromCouncil']) {
    if (typeof row[field] !== 'boolean') errors.push(`${label}.${field} must be a boolean`);
  }
  if (!CURRENT_PAY_SOURCES.has(row.currentPaySource)) {
    errors.push(`${label}.currentPaySource must be entered, budget_line, or unset`);
  }
  if (row.currentPaySource === 'entered') {
    if (!Number.isInteger(row.currentPayCents)) errors.push(`${label}.currentPayCents must be integer cents when currentPaySource is entered`);
  } else if (row.currentPayCents !== null) {
    errors.push(`${label}.currentPayCents must be null unless currentPaySource is entered`);
  }
  if (row.currentPaySource === 'unset' && typeof row.accountCode === 'string' && row.accountCode !== '') {
    errors.push(`${label}.currentPaySource must be budget_line, not unset, when accountCode is set`);
  }
  if (row.currentPaySource === 'budget_line' && typeof row.accountCode === 'string' && row.accountCode === '') {
    errors.push(`${label}.currentPaySource must be unset, not budget_line, when accountCode is empty`);
  }
}

export function validateFinanceCompensationV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-compensation.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  let workersValid = false;
  if (!Array.isArray(value.workers)) {
    errors.push('workers must be an array');
  } else {
    workersValid = true;
    value.workers.forEach((row, index) => {
      const before = errors.length;
      validateWorker(row, errors, index);
      if (errors.length !== before) workersValid = false;
    });
  }

  if (!hasExactKeys(value.totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly the compensation totals fields');
  } else {
    for (const key of TOTALS_KEYS) {
      if (!Number.isInteger(value.totals[key]) || value.totals[key] < 0) errors.push(`totals.${key} must be a nonnegative integer`);
    }
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly the compensation reconciliation fields');
  } else {
    if (!Number.isInteger(value.reconciliation.workerCount) || value.reconciliation.workerCount < 0) {
      errors.push('reconciliation.workerCount must be a nonnegative integer');
    }
    if (value.reconciliation.totalsMatch !== true) errors.push('reconciliation.totalsMatch must be true');
  }

  // Cross-checks against the workers array itself -- the same "never trust the arithmetic
  // without re-deriving it" discipline the other contract consumers apply.
  if (workersValid && hasExactKeys(value.totals, TOTALS_KEYS)) {
    const enteredWorkers = value.workers.filter((w) => w.currentPaySource === 'entered');
    const enteredCount = enteredWorkers.length;
    const enteredCents = enteredWorkers.reduce((total, w) => total + w.currentPayCents, 0);
    if (value.totals.workerCount !== value.workers.length) errors.push('totals.workerCount must equal workers.length');
    if (value.totals.enteredCurrentPayCount !== enteredCount) errors.push('totals.enteredCurrentPayCount does not match workers');
    if (value.totals.unenteredCurrentPayCount !== value.workers.length - enteredCount) errors.push('totals.unenteredCurrentPayCount does not match workers');
    if (value.totals.enteredCurrentPayCents !== enteredCents) errors.push('totals.enteredCurrentPayCents does not match the sum of entered current pay');
    if (hasExactKeys(value.reconciliation, RECONCILIATION_KEYS) && value.reconciliation.workerCount !== value.workers.length) {
      errors.push('reconciliation.workerCount must equal workers.length');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceCompensationV1(value) {
  const validation = validateFinanceCompensationV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    generatedAt: value.generatedAt,
    workers: value.workers.map((row) => ({ ...row })),
    totals: { ...value.totals },
    reconciliation: { ...value.reconciliation },
  };
}
