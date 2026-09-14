import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildQboTransactionUrl } from '../src/quickbooks.js';
import { parseQboTransactionListReport } from '../src/api-finance.js';
import { handleFinanceApi } from '../src/api-finance.js';

// Andrew's ask: see every QuickBooks transaction — what it is, what account/line it posted to,
// the amount, and the date — without QuickBooks' own confusing UI, plus a fast way back into
// QuickBooks to edit one. Three things get tested here: the deep-link URL builder (concrete
// input/output pairs per transaction type, per the explicit instruction that this is exactly the
// kind of thing that should be tested that way, not eyeballed), the TransactionList report
// parser (pure, no I/O), and the route itself with a mocked QuickBooks fetch.

describe('buildQboTransactionUrl — deep link per transaction type', () => {
  it('maps every known transaction type to its documented-by-convention slug', () => {
    const cases = [
      ['Invoice', 'invoice'],
      ['Estimate', 'estimate'],
      ['Sales Receipt', 'salesreceipt'],
      ['Refund Receipt', 'refundreceipt'],
      ['Credit Memo', 'creditmemo'],
      ['Payment', 'recvpayment'],
      ['Bill', 'bill'],
      ['Expense', 'expense'],
      ['Check', 'check'],
      ['Credit Card Credit', 'creditcardcredit'],
      ['Vendor Credit', 'vendorcredit'],
      ['Purchase Order', 'purchaseorder'],
      ['Bill Payment', 'billpaymentcheck'],
      ['Bill Payment (Check)', 'billpaymentcheck'],
      ['Bill Payment (Credit Card)', 'billpaymentcreditcard'],
      ['Journal Entry', 'journal'],
      ['Deposit', 'deposit'],
      ['Transfer', 'transfer'],
    ];
    for (const [type, slug] of cases) {
      expect(buildQboTransactionUrl(type, '204')).toBe('https://qbo.intuit.com/app/' + slug + '?txnId=204');
    }
  });

  it('is case- and whitespace-insensitive on the type label', () => {
    expect(buildQboTransactionUrl('  bill  ', '9')).toBe('https://qbo.intuit.com/app/bill?txnId=9');
    expect(buildQboTransactionUrl('BILL', '9')).toBe('https://qbo.intuit.com/app/bill?txnId=9');
  });

  it('URL-encodes an unusual txnId rather than interpolating it raw', () => {
    expect(buildQboTransactionUrl('Bill', '12/3')).toBe('https://qbo.intuit.com/app/bill?txnId=12%2F3');
  });

  it('returns null for an unrecognized transaction type — no link is safer than a wrong one', () => {
    expect(buildQboTransactionUrl('Some New QBO Thing', '1')).toBeNull();
  });

  it('returns null when either input is missing', () => {
    expect(buildQboTransactionUrl('Bill', null)).toBeNull();
    expect(buildQboTransactionUrl('Bill', '')).toBeNull();
    expect(buildQboTransactionUrl('', '1')).toBeNull();
    expect(buildQboTransactionUrl(null, '1')).toBeNull();
  });

  it('accepts a numeric txnId (QBO ids often arrive as numbers, not strings)', () => {
    expect(buildQboTransactionUrl('Deposit', 204)).toBe('https://qbo.intuit.com/app/deposit?txnId=204');
  });
});

describe('parseQboTransactionListReport — pure parsing of the raw QBO report shape', () => {
  function report(columns, rows) {
    return { Columns: { Column: columns }, Rows: { Row: rows } };
  }
  const STANDARD_COLUMNS = [
    { ColTitle: 'Date', ColType: 'tx_date' },
    { ColTitle: 'Transaction Type', ColType: 'txn_type' },
    { ColTitle: 'Num', ColType: 'doc_num' },
    { ColTitle: 'Name', ColType: 'name' },
    { ColTitle: 'Memo/Description', ColType: 'memo' },
    { ColTitle: 'Account', ColType: 'account_name' },
    { ColTitle: 'Amount', ColType: 'amount' },
  ];

  it('extracts every field, the transaction id, and a working viewUrl from a normal Data row', () => {
    const rows = [{
      type: 'Data',
      ColData: [
        { value: '09/01/2026' },
        { value: 'Bill', id: '204' },
        { value: '1042' },
        { value: 'Ace Hardware' },
        { value: 'Fall mulch' },
        { value: '57160 MDO Supplies' },
        { value: '-125.40' },
      ],
    }];
    const out = parseQboTransactionListReport(report(STANDARD_COLUMNS, rows));
    expect(out).toEqual([{
      date: '09/01/2026', type: 'Bill', docNum: '1042', name: 'Ace Hardware', memo: 'Fall mulch',
      account: '57160 MDO Supplies', amount: '-125.40', txnId: '204',
      viewUrl: 'https://qbo.intuit.com/app/bill?txnId=204',
    }]);
  });

  it('still finds the transaction id when it is attached to a different cell than the type column', () => {
    const rows = [{
      type: 'Data',
      ColData: [
        { value: '09/02/2026', id: '99' },
        { value: 'Check' },
        { value: '' }, { value: 'Vendor' }, { value: '' }, { value: 'Checking' }, { value: '-40.00' },
      ],
    }];
    const out = parseQboTransactionListReport(report(STANDARD_COLUMNS, rows));
    expect(out[0].txnId).toBe('99');
    expect(out[0].viewUrl).toBe('https://qbo.intuit.com/app/check?txnId=99');
  });

  it('flattens nested Section/Rows (defensive — this app never requests a grouped report)', () => {
    const nested = [{
      Header: { ColData: [{ value: '09/2026' }] },
      Rows: { Row: [{
        type: 'Data',
        ColData: [
          { value: '09/03/2026' }, { value: 'Deposit', id: '55' }, { value: '' },
          { value: 'Front Desk' }, { value: '' }, { value: 'Checking' }, { value: '500.00' },
        ],
      }] },
      Summary: { ColData: [{ value: 'Total for 09/2026' }] },
    }];
    const out = parseQboTransactionListReport(report(STANDARD_COLUMNS, nested));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('Deposit');
    expect(out[0].viewUrl).toBe('https://qbo.intuit.com/app/deposit?txnId=55');
  });

  it('degrades gracefully when a column is missing entirely, instead of misreading another column', () => {
    const columnsNoMemo = STANDARD_COLUMNS.filter((c) => c.ColType !== 'memo');
    const rows = [{
      type: 'Data',
      ColData: [
        { value: '09/01/2026' }, { value: 'Bill', id: '1' }, { value: '1' },
        { value: 'Vendor' }, { value: '57 MDO' }, { value: '-10.00' },
      ],
    }];
    const out = parseQboTransactionListReport(report(columnsNoMemo, rows));
    expect(out[0].memo).toBe('');
    expect(out[0].account).toBe('57 MDO');
  });

  it('returns an empty array for an empty or malformed report rather than throwing', () => {
    expect(parseQboTransactionListReport(null)).toEqual([]);
    expect(parseQboTransactionListReport({})).toEqual([]);
    expect(parseQboTransactionListReport({ Columns: {}, Rows: {} })).toEqual([]);
  });

  it('carries no viewUrl for an unrecognized transaction type, without dropping the row', () => {
    const rows = [{
      type: 'Data',
      ColData: [
        { value: '09/01/2026' }, { value: 'Some New QBO Thing', id: '7' }, { value: '' },
        { value: 'X' }, { value: '' }, { value: 'Y' }, { value: '1.00' },
      ],
    }];
    const out = parseQboTransactionListReport(report(STANDARD_COLUMNS, rows));
    expect(out).toHaveLength(1);
    expect(out[0].viewUrl).toBeNull();
  });
});

describe('GET finance/qb/transactions — route with a mocked QuickBooks Reports API', () => {
  let realFetch;
  let outboundUrls;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    outboundUrls = [];
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  function makeDb(conn) {
    return {
      prepare(sql) {
        return {
          bind() { return this; },
          first: async () => (/FROM finance_qb_connection/.test(sql) ? conn : null),
          run: async () => ({ meta: {} }),
        };
      },
    };
  }
  const CONN = {
    id: 1, realm_id: '999', company_name: 'Timothy Lutheran', environment: 'production',
    access_token: 'good-token', refresh_token: 'refresh-token',
    access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const ENV = { QB_CLIENT_ID: 'id', QB_CLIENT_SECRET: 'secret' };

  function mockQboReportFetch(reportJson) {
    globalThis.fetch = async (u) => {
      outboundUrls.push(String(u));
      return new Response(JSON.stringify(reportJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }

  it('calls the TransactionList report with the requested date range and returns parsed rows with view links', async () => {
    mockQboReportFetch({
      Columns: { Column: [
        { ColTitle: 'Date', ColType: 'tx_date' }, { ColTitle: 'Transaction Type', ColType: 'txn_type' },
        { ColTitle: 'Num', ColType: 'doc_num' }, { ColTitle: 'Name', ColType: 'name' },
        { ColTitle: 'Memo/Description', ColType: 'memo' }, { ColTitle: 'Account', ColType: 'account_name' },
        { ColTitle: 'Amount', ColType: 'amount' },
      ] },
      Rows: { Row: [{
        type: 'Data',
        ColData: [
          { value: '09/10/2026' }, { value: 'Check', id: '42' }, { value: '' },
          { value: 'Ace Hardware' }, { value: 'mulch' }, { value: 'Checking' }, { value: '-88.20' },
        ],
      }] },
    });
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions?start_date=2026-09-01&end_date=2026-09-30');
    const res = await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(CONN), false, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.startDate).toBe('2026-09-01');
    expect(body.endDate).toBe('2026-09-30');
    expect(body.realmId).toBe('999');
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({
      date: '09/10/2026', type: 'Check', name: 'Ace Hardware', account: 'Checking', amount: '-88.20',
      viewUrl: 'https://qbo.intuit.com/app/check?txnId=42',
    });
    expect(outboundUrls[0]).toContain('/reports/TransactionList?');
    expect(outboundUrls[0]).toContain('start_date=2026-09-01');
    expect(outboundUrls[0]).toContain('end_date=2026-09-30');
  });

  it('applies a "this month so far" default when no dates are given', async () => {
    mockQboReportFetch({ Columns: { Column: [] }, Rows: { Row: [] } });
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions');
    const res = await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(CONN), false, true);
    const body = await res.json();
    expect(res.status).toBe(200);
    const now = new Date();
    const expectedStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    expect(body.startDate).toBe(expectedStart);
    expect(body.transactions).toEqual([]);
  });

  it('rejects a malformed date rather than passing it through to QuickBooks', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions?start_date=not-a-date&end_date=2026-09-30');
    const res = await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(CONN), false, true);
    expect(res.status).toBe(400);
    expect(outboundUrls).toHaveLength(0);
  });

  it('rejects a range where start is after end', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions?start_date=2026-09-30&end_date=2026-09-01');
    const res = await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(CONN), false, true);
    expect(res.status).toBe(400);
  });

  it('refuses when QuickBooks is not connected yet', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions');
    const res = await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(null), false, true);
    expect(res.status).toBe(400);
    expect(outboundUrls).toHaveLength(0);
  });

  it('surfaces a QuickBooks API failure as a warning with an empty transaction list, not a hard error', async () => {
    globalThis.fetch = async (u) => {
      outboundUrls.push(String(u));
      return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Permission Denied', code: '5020' }] } }), { status: 403 });
    };
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions?start_date=2026-09-01&end_date=2026-09-30');
    const res = await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(CONN), false, true);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.transactions).toEqual([]);
    expect(body.warnings.join(' ')).toMatch(/Permission Denied/);
  });

  it('never calls anything but a GET-style report fetch — no write/post to QuickBooks from this route', async () => {
    mockQboReportFetch({ Columns: { Column: [] }, Rows: { Row: [] } });
    let methodsUsed = [];
    globalThis.fetch = async (u, opts) => { methodsUsed.push((opts && opts.method) || 'GET'); return new Response('{}', { status: 200 }); };
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/transactions?start_date=2026-09-01&end_date=2026-09-30');
    await handleFinanceApi(new Request(url), ENV, url, 'GET', 'finance/qb/transactions', makeDb(CONN), false, true);
    expect(methodsUsed.every((m) => m === 'GET')).toBe(true);
  });
});
