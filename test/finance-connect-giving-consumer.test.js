import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  acceptConnectGivingSummaryV1,
  validateConnectGivingSummaryV1,
} from '../contracts/validators/connect-giving-consumer.js';

const example = JSON.parse(fs.readFileSync(
  new URL('../contracts/examples/giving-summary-v1.synthetic.json', import.meta.url),
  'utf8',
));

function changed(mutator) {
  const copy = structuredClone(example);
  mutator(copy);
  return copy;
}

describe('Finance consumer for connect.giving-summary.v1', () => {
  it('accepts and normalizes the approved synthetic producer fixture', () => {
    const accepted = acceptConnectGivingSummaryV1(example);
    expect(accepted.contract).toBe('connect.giving-summary.v1');
    expect(accepted.dataClassification).toBe('aggregate');
    expect(accepted.sourceProduct).toBe('connect');
    expect(accepted.consumerProduct).toBe('finance');
    expect(accepted.totals).toEqual({ grossCents: 150000, refundCents: 5000, netCents: 145000 });
    expect(accepted.funds).toHaveLength(2);
  });

  it.each([
    ['unknown major contract', (v) => { v.contract = 'connect.giving-summary.v2'; }],
    ['wrong classification', (v) => { v.dataClassification = 'individual'; }],
    ['wrong producer', (v) => { v.sourceProduct = 'finance'; }],
    ['wrong consumer', (v) => { v.consumerProduct = 'website'; }],
    ['unknown root field', (v) => { v.donors = []; }],
    ['unknown fund field', (v) => { v.funds[0].householdIds = ['not-allowed']; }],
    ['fractional cents', (v) => { v.funds[0].amounts.grossCents = 120000.5; }],
    ['negative refund', (v) => { v.funds[0].amounts.refundCents = -1; }],
    ['broken fund arithmetic', (v) => { v.funds[0].amounts.netCents += 1; }],
    ['broken aggregate total', (v) => { v.totals.netCents += 1; }],
    ['false producer reconciliation', (v) => { v.reconciliation.totalsMatch = false; }],
    ['wrong fund count', (v) => { v.reconciliation.fundCount = 3; }],
    ['wrong source count', (v) => { v.reconciliation.sourceRecordCount = 7; }],
    ['duplicate fund reference', (v) => { v.funds[1].fundRef = v.funds[0].fundRef; }],
    ['invalid calendar date', (v) => { v.period.endDate = '2026-02-30'; }],
    ['reversed period', (v) => { v.period.startDate = '2026-02-01'; }],
    ['source timestamp after generation', (v) => { v.sourceThrough = '2026-02-02T00:00:00Z'; }],
  ])('fails closed on %s', (_label, mutate) => {
    const value = changed(mutate);
    expect(validateConnectGivingSummaryV1(value).ok).toBe(false);
    expect(() => acceptConnectGivingSummaryV1(value)).toThrow(/Rejected connect\.giving-summary\.v1/);
  });

  it('returns detached data rather than retaining producer-owned objects', () => {
    const source = structuredClone(example);
    const accepted = acceptConnectGivingSummaryV1(source);
    source.funds[0].amounts.netCents = 0;
    source.period.startDate = '2099-01-01';
    expect(accepted.funds[0].amounts.netCents).toBe(115000);
    expect(accepted.period.startDate).toBe('2026-01-01');
  });
});
