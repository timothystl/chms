import { describe, expect, it } from 'vitest';
import {
  findTransactionExceptions, parseTransactionList, resolveTransactionDates,
  summarizeExpenseAccounts, summarizeVendorSpend,
} from '../apps/finance/quickbooks-transactions-service.js';

const report = {
  Columns: { Column: [
    { ColTitle: 'Name', ColType: 'vend_name' },
    { ColTitle: 'Amount', ColType: 'subt_nat_amount' },
    { ColTitle: 'Date', ColType: 'tx_date' },
    { ColTitle: 'Transaction Type', ColType: 'txn_type' },
    { ColTitle: 'Account', ColType: 'account_name' },
    { ColTitle: 'Num', ColType: 'doc_num' },
  ] },
  Rows: { Row: [
    { type: 'Data', ColData: [
      { value: 'Acme' }, { value: '$1,200.50' }, { value: '2026-09-03' },
      { value: 'Bill', id: '42' }, { value: 'Facilities:Repairs' }, { value: 'B-4' },
    ] },
    { type: 'Section', Rows: { Row: [{ type: 'Data', ColData: [
      { value: '' }, { value: '(15.25)' }, { value: '2026-09-04' },
      { value: 'Check', id: '43' }, { value: '' }, { value: '1001' },
    ] }] } },
  ] },
};

describe('Finance QuickBooks transaction reporting', () => {
  it('reads reordered report columns and nested rows by metadata', () => {
    const rows = parseTransactionList(report);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-09-03', type: 'Bill', name: 'Acme', account: 'Facilities:Repairs', amountCents: 120050, transactionId: '42' });
    expect(rows[0].viewUrl).toBe('https://qbo.intuit.com/app/bill?txnId=42');
    expect(rows[1].amountCents).toBe(-1525);
  });

  it('bounds and validates the live report range', () => {
    expect(resolveTransactionDates(new URLSearchParams('start_date=2026-09-01&end_date=2026-09-30')).ok).toBe(true);
    expect(resolveTransactionDates(new URLSearchParams('start_date=2026-10-01&end_date=2026-09-30')).ok).toBe(false);
    expect(resolveTransactionDates(new URLSearchParams('start_date=2024-01-01&end_date=2026-09-30')).error).toContain('one year');
  });

  it('builds vendor, account, and transparent data-quality views', () => {
    const rows = parseTransactionList(report);
    expect(summarizeVendorSpend(rows)).toEqual([{ name: 'Acme', transactionCount: 1, amountCents: 120050 }]);
    expect(summarizeExpenseAccounts(rows)).toEqual([{ account: 'Facilities:Repairs', transactionCount: 1, amountCents: 120050 }]);
    expect(findTransactionExceptions(rows)).toMatchObject([{ name: '', account: '', reasons: ['Missing account', 'Missing name'] }]);
  });
});
