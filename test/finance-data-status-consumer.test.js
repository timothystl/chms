import { describe, expect, it } from 'vitest';
import {
  acceptFinanceDataStatusV1,
  validateFinanceDataStatusV1,
} from '../apps/finance/finance-data-status-consumer.js';

const example = {
  contract: 'connect.finance-data-status.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  generatedAt: '2026-06-15T12:00:00Z',
  imports: { mostRecentImportAt: '2026-06-10T08:00:00Z', importerCount: 3 },
  quickbooks: { connected: true, lastSyncedAt: '2026-06-14T00:00:00Z' },
};

function changed(mutator) {
  const copy = structuredClone(example);
  mutator(copy);
  return copy;
}

describe('Finance consumer for connect.finance-data-status.v1', () => {
  it('accepts and normalizes a valid producer payload', () => {
    const accepted = acceptFinanceDataStatusV1(example);
    expect(accepted.contract).toBe('connect.finance-data-status.v1');
    expect(accepted.imports).toEqual({ mostRecentImportAt: '2026-06-10T08:00:00Z', importerCount: 3 });
    expect(accepted.quickbooks).toEqual({ connected: true, lastSyncedAt: '2026-06-14T00:00:00Z' });
  });

  it('accepts a never-connected, never-imported state (all nulls/zero)', () => {
    const empty = changed((v) => {
      v.imports = { mostRecentImportAt: null, importerCount: 0 };
      v.quickbooks = { connected: false, lastSyncedAt: null };
    });
    expect(validateFinanceDataStatusV1(empty).ok).toBe(true);
  });

  it.each([
    ['unknown major contract', (v) => { v.contract = 'connect.finance-data-status.v2'; }],
    ['wrong classification', (v) => { v.dataClassification = 'individual'; }],
    ['wrong producer', (v) => { v.sourceProduct = 'finance'; }],
    ['wrong consumer', (v) => { v.consumerProduct = 'website'; }],
    ['unknown root field', (v) => { v.qbSecret = 'nope'; }],
    ['unknown imports field', (v) => { v.imports.note = 'nope'; }],
    ['unknown quickbooks field', (v) => { v.quickbooks.accessToken = 'nope'; }],
    ['negative importer count', (v) => { v.imports.importerCount = -1; }],
    ['fractional importer count', (v) => { v.imports.importerCount = 1.5; }],
    ['non-boolean connected', (v) => { v.quickbooks.connected = 'yes'; }],
    ['lastSyncedAt set while not connected', (v) => { v.quickbooks.connected = false; }],
    ['malformed generatedAt', (v) => { v.generatedAt = 'not-a-date'; }],
    ['malformed mostRecentImportAt', (v) => { v.imports.mostRecentImportAt = 'not-a-date'; }],
  ])('fails closed on %s', (_label, mutate) => {
    const value = changed(mutate);
    expect(validateFinanceDataStatusV1(value).ok).toBe(false);
    expect(() => acceptFinanceDataStatusV1(value)).toThrow(/Rejected connect\.finance-data-status\.v1/);
  });

  it('returns detached data rather than retaining producer-owned objects', () => {
    const source = structuredClone(example);
    const accepted = acceptFinanceDataStatusV1(source);
    source.imports.importerCount = 999;
    source.quickbooks.connected = false;
    expect(accepted.imports.importerCount).toBe(3);
    expect(accepted.quickbooks.connected).toBe(true);
  });
});
