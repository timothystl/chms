import { describe, it, expect } from 'vitest';
import { scanForFeeFields } from '../src/api-utils.js';

describe('scanForFeeFields', () => {
  it('flags a top-level fee/net/deposit field', () => {
    const r = scanForFeeFields({ id: 1, amount: '100.00', fee: '3.20', net_amount: '96.80', deposit_date: '2026-07-01' });
    expect(r.fee_field_found).toBe(true);
    const keys = r.top_flagged.map(f => f.key);
    expect(keys).toContain('fee');
    expect(keys).toContain('net_amount');
    expect(keys).toContain('deposit_date');
  });

  it('flags a fee field nested in funds[0]', () => {
    const r = scanForFeeFields({ id: 1, amount: '100.00', funds: [{ name: 'General', amount: '100.00', processor_fee: '3.20' }] });
    expect(r.fee_field_found).toBe(true);
    expect(r.fund_flagged.map(f => f.key)).toContain('processor_fee');
  });

  it('returns fee_field_found false for a plain record with no fee-like keys', () => {
    const r = scanForFeeFields({ id: 1, amount: '100.00', date: '2026-07-01', person_id: 42, funds: [{ name: 'General', amount: '100.00' }] });
    expect(r.fee_field_found).toBe(false);
    expect(r.top_flagged).toEqual([]);
    expect(r.fund_flagged).toEqual([]);
    expect(r.top_keys).toContain('amount');
    expect(r.fund_keys).toContain('name');
  });

  it('handles null / non-object input without throwing', () => {
    expect(scanForFeeFields(null).fee_field_found).toBeUndefined();
    expect(scanForFeeFields(null).top_keys).toEqual([]);
    expect(scanForFeeFields('nope').top_keys).toEqual([]);
  });
});
