const CONTRACT = 'connect.giving-summary.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'period', 'generatedAt', 'sourceThrough', 'funds', 'totals', 'reconciliation'];
const PERIOD_KEYS = ['startDate', 'endDate'];
const FUND_KEYS = ['fundRef', 'fundLabel', 'giftCount', 'householdCount', 'amounts', 'isGeneralFund'];
const AMOUNT_KEYS = ['grossCents', 'refundCents', 'netCents'];
const RECONCILIATION_KEYS = ['sourceRecordCount', 'fundCount', 'totalsMatch'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validateAmounts(value, path, errors) {
  if (!hasExactKeys(value, AMOUNT_KEYS)) {
    errors.push(`${path} must contain only grossCents, refundCents, and netCents`);
    return;
  }
  for (const key of AMOUNT_KEYS) {
    if (!Number.isInteger(value[key])) errors.push(`${path}.${key} must be integer cents`);
  }
  if (Number.isInteger(value.refundCents) && value.refundCents < 0) {
    errors.push(`${path}.refundCents must be nonnegative`);
  }
  if (AMOUNT_KEYS.every((key) => Number.isInteger(value[key]))
      && value.grossCents - value.refundCents !== value.netCents) {
    errors.push(`${path} must satisfy grossCents - refundCents = netCents`);
  }
}

export function validateConnectGivingSummaryV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.giving-summary.v1 fields'] };
  }

  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');

  if (!hasExactKeys(value.period, PERIOD_KEYS)) {
    errors.push('period must contain only startDate and endDate');
  } else {
    if (!isDate(value.period.startDate)) errors.push('period.startDate must be a real ISO date');
    if (!isDate(value.period.endDate)) errors.push('period.endDate must be a real ISO date');
    if (isDate(value.period.startDate) && isDate(value.period.endDate)
        && value.period.startDate > value.period.endDate) {
      errors.push('period.startDate must not follow period.endDate');
    }
  }

  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');
  if (!isDateTime(value.sourceThrough)) errors.push('sourceThrough must be an RFC 3339 UTC timestamp');
  if (isDateTime(value.generatedAt) && isDateTime(value.sourceThrough)
      && Date.parse(value.sourceThrough) > Date.parse(value.generatedAt)) {
    errors.push('sourceThrough must not follow generatedAt');
  }

  if (!Array.isArray(value.funds)) {
    errors.push('funds must be an array');
  } else {
    const refs = new Set();
    value.funds.forEach((fund, index) => {
      const path = `funds[${index}]`;
      if (!hasExactKeys(fund, FUND_KEYS)) {
        errors.push(`${path} must contain exactly the approved aggregate fund fields`);
        return;
      }
      if (typeof fund.fundRef !== 'string' || fund.fundRef.length < 1 || fund.fundRef.length > 128) {
        errors.push(`${path}.fundRef must be 1-128 characters`);
      } else if (refs.has(fund.fundRef)) {
        errors.push(`${path}.fundRef must be unique within the period`);
      } else {
        refs.add(fund.fundRef);
      }
      if (typeof fund.fundLabel !== 'string' || fund.fundLabel.length < 1 || fund.fundLabel.length > 160) {
        errors.push(`${path}.fundLabel must be 1-160 characters`);
      }
      for (const key of ['giftCount', 'householdCount']) {
        if (!Number.isInteger(fund[key]) || fund[key] < 0) errors.push(`${path}.${key} must be a nonnegative integer`);
      }
      if (typeof fund.isGeneralFund !== 'boolean') errors.push(`${path}.isGeneralFund must be a boolean`);
      validateAmounts(fund.amounts, `${path}.amounts`, errors);
    });
  }

  validateAmounts(value.totals, 'totals', errors);

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain only sourceRecordCount, fundCount, and totalsMatch');
  } else {
    for (const key of ['sourceRecordCount', 'fundCount']) {
      if (!Number.isInteger(value.reconciliation[key]) || value.reconciliation[key] < 0) {
        errors.push(`reconciliation.${key} must be a nonnegative integer`);
      }
    }
    if (value.reconciliation.totalsMatch !== true) errors.push('reconciliation.totalsMatch must be true');
  }

  if (Array.isArray(value.funds) && hasExactKeys(value.totals, AMOUNT_KEYS)) {
    for (const key of AMOUNT_KEYS) {
      if (value.funds.every((fund) => hasExactKeys(fund, FUND_KEYS) && hasExactKeys(fund.amounts, AMOUNT_KEYS)
          && Number.isInteger(fund.amounts[key])) && Number.isInteger(value.totals[key])) {
        const sum = value.funds.reduce((total, fund) => total + fund.amounts[key], 0);
        if (sum !== value.totals[key]) errors.push(`totals.${key} must equal the fund sum`);
      }
    }
    if (hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
      if (value.reconciliation.fundCount !== value.funds.length) {
        errors.push('reconciliation.fundCount must equal funds.length');
      }
      if (value.funds.every((fund) => hasExactKeys(fund, FUND_KEYS) && Number.isInteger(fund.giftCount))) {
        const gifts = value.funds.reduce((total, fund) => total + fund.giftCount, 0);
        if (value.reconciliation.sourceRecordCount !== gifts) {
          errors.push('reconciliation.sourceRecordCount must equal the sum of fund giftCount values');
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptConnectGivingSummaryV1(value) {
  const validation = validateConnectGivingSummaryV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    period: { ...value.period },
    generatedAt: value.generatedAt,
    sourceThrough: value.sourceThrough,
    funds: value.funds.map((fund) => ({
      fundRef: fund.fundRef,
      fundLabel: fund.fundLabel,
      giftCount: fund.giftCount,
      householdCount: fund.householdCount,
      amounts: { ...fund.amounts },
      isGeneralFund: fund.isGeneralFund,
    })),
    totals: { ...value.totals },
    reconciliation: { ...value.reconciliation },
  };
}
