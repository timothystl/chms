import { describe, it, expect } from 'vitest';
import {
  computeEquityReclassification, extractAccountCode, detectBalanceSheetBasis,
  EQUITY_RECLASS_ACCOUNTS, EQUITY_RECLASS_IGNORE_CODES,
} from '../src/api-finance.js';

// Row shape mirrors makeBalanceRow()'s output — the same shape both parseBalanceSheetGrid() and
// parseFinancialPositionMultiYearGrid() produce, and what's persisted in finance_church_balances.
function row(path, classification, dollars, hasChildren = false) {
  return {
    account_name: path[path.length - 1],
    category_path: path.join(':'),
    classification,
    own_balance_cents: Math.round(dollars * 100),
    has_children: hasChildren ? 1 : 0,
  };
}

describe('extractAccountCode', () => {
  it('extracts the leading numeric code, ignoring description drift', () => {
    expect(extractAccountCode('12010 95-8633 Thriv.- Iris Guen.')).toBe('12010');
    expect(extractAccountCode('25015 Extending His Gate')).toBe('25015');
    expect(extractAccountCode('31000 Unrestricted Net Assets')).toBe('31000');
  });
  it('keeps a trailing letter suffix as part of the code', () => {
    expect(extractAccountCode('25019a Hodimont Ministry')).toBe('25019a');
    expect(extractAccountCode('25023x 25022x James Gayeyon')).toBe('25023x'); // stable key is the FIRST token
  });
  it('returns null for labels with no leading code (e.g. "Net Revenue")', () => {
    expect(extractAccountCode('Net Revenue')).toBe(null);
    expect(extractAccountCode('Assets')).toBe(null);
    expect(extractAccountCode('')).toBe(null);
    expect(extractAccountCode(null)).toBe(null);
  });
});

describe('detectBalanceSheetBasis', () => {
  it('finds a Cash Basis footer line', () => {
    const grid = [['Timothy Evangelical Lutheran Church'], ['Statement of Financial Position'], ['As of July 28, 2026'], [null], [null, 'Total'], ['Assets'], [null], ['Cash Basis Tuesday, July 28, 2026 03:11 PM GMT-05:00']];
    expect(detectBalanceSheetBasis(grid)).toBe('Cash');
  });
  it('finds an Accrual Basis footer line', () => {
    const grid = [['Statement of Financial Position'], ['Accrual Basis Monday, January 5, 2026 09:00 AM GMT-06:00']];
    expect(detectBalanceSheetBasis(grid)).toBe('Accrual');
  });
  it('returns null when no basis footer is present', () => {
    expect(detectBalanceSheetBasis([['Assets'], ['Liabilities']])).toBe(null);
  });
});

describe('computeEquityReclassification', () => {
  // Reproduces the real 2026 figures from the combined multi-year workbook
  // (Timothy_Statement_of_Financial_Position_by_Year.xlsx) referenced by the spec — the
  // designated-funds total below matches that file's own "Total for 25000 Funds" line
  // ($119,049.51) and the spec's own stated historical-baseline figure to the penny.
  function real2026Rows() {
    return [
      row(['Assets', '12010 95-8633 Thriv.- Iris Guen.'], 'Assets', 109518),
      row(['Assets', '12011 95-8632 Thriv.- Min. End'], 'Assets', 99426.74),
      row(['Assets', '12013 91-8633 Thriv. Ir Gu MM'], 'Assets', 373.82),
      row(['Assets', '12014 91-8632 Thriv.- Mi En MM'], 'Assets', 339.38),
      row(['Assets', '12019 5244306 Thrivent-Bequests'], 'Assets', 119461.15),
      row(['Assets', '12020 6022642018 Edward Jones'], 'Assets', 236388.18),
      row(['Assets', '12021 Reserve for Caring Ministry'], 'Assets', 0),
      row(['Liabilities', '25000 Funds'], 'Liabilities', 0, true),
      row(['Liabilities', '25000 Funds', '25001 Adopt a Seminarian - Concordia'], 'Liabilities', 0),
      row(['Liabilities', '25000 Funds', '25004 Building Fund'], 'Liabilities', 685),
      row(['Liabilities', '25000 Funds', '25008 Christ Care'], 'Liabilities', 50),
      row(['Liabilities', '25000 Funds', '25015 Extending His Gate'], 'Liabilities', 91422.02),
      row(['Liabilities', '25000 Funds', '25016 Food Pantry'], 'Liabilities', 5814.54),
      row(['Liabilities', '25000 Funds', '25027 Memorial Fund'], 'Liabilities', 2776.71),
      row(['Liabilities', '25000 Funds', '25029 Mission Outreach'], 'Liabilities', 668.16),
      row(['Liabilities', '25000 Funds', '25030 Music'], 'Liabilities', 5523.29),
      row(['Liabilities', '25000 Funds', '25033 PNG Mission Society'], 'Liabilities', 3452.29),
      row(['Liabilities', '25000 Funds', '25034 LCFF Building Feasability Study'], 'Liabilities', 21079.4),
      row(['Liabilities', '25000 Funds', '25041 Vietnamese'], 'Liabilities', 3897.55),
      row(['Liabilities', '25000 Funds', '25044 Kaleo Coffee'], 'Liabilities', 10.55),
      row(['Liabilities', '25000 Funds', '25099 WOL Tution to be paid over 12 m'], 'Liabilities', -16330),
      row(['Equity', '31500 Temp. Restricted Net Assets'], 'Equity', 281532.53),
      row(['Equity', '32000 Perm. Restricted Net Assets'], 'Equity', 223828.47),
      row(['Equity', '33000 Board Restricted Net Assets'], 'Equity', -4859.54),
      row(['Equity', '31000 Unrestricted Net Assets'], 'Equity', 236391.47),
      row(['Equity', 'Net Revenue'], 'Equity', -6635.14),
    ];
  }

  it('matches the spec-stated 2026 designated-funds baseline exactly ($119,049.51)', () => {
    const result = computeEquityReclassification(real2026Rows());
    expect(result.breakdown.designated.cents).toBe(11904951);
  });

  it('matches the real 2026 Total for Equity ($730,257.79) via the classification sum, not a printed cell', () => {
    const result = computeEquityReclassification(real2026Rows());
    expect(result.totalEquityCents).toBe(73025779);
  });

  it('derives Unrestricted as the residual against Total Equity, never a direct sum of legacy lines', () => {
    const result = computeEquityReclassification(real2026Rows());
    expect(result.donorRestrictedCents + result.unrestrictedCents).toBe(result.totalEquityCents);
    // Confirms this is NOT 31000 + 33000 + Net Revenue (236391.47 - 4859.54 - 6635.14 = 224896.79) —
    // that legacy-plug sum is a different, wrong number; the residual against real Total Equity is not.
    expect(result.unrestrictedCents).not.toBe(22489679);
  });

  it('ignores the four legacy QuickBooks equity plug lines and the Net Revenue plug', () => {
    const result = computeEquityReclassification(real2026Rows());
    expect(result.unclassified).toEqual([]); // none of 31000/31500/32000/33000/Net Revenue should be flagged
  });

  it('never double-counts a "has_children" group row alongside its own leaf children', () => {
    // "25000 Funds" itself carries has_children:1 with own_balance_cents 0 in every real export —
    // asserting the leaf-only skip actually fires, not just that the fixture happens to be $0.
    const rows = real2026Rows();
    const groupRow = rows.find(r => r.account_name === '25000 Funds');
    expect(groupRow.has_children).toBe(1);
    const withNonZeroGroup = rows.map(r => r.account_name === '25000 Funds' ? { ...r, own_balance_cents: 999999 } : r);
    const result = computeEquityReclassification(withNonZeroGroup);
    expect(result.breakdown.designated.cents).toBe(11904951); // unchanged — the group row must be skipped
  });

  it('flags a new investment sub-account under "12000 Investment Accounts" as unclassified, not silently included or excluded', () => {
    const rows = real2026Rows().concat([
      row(['Assets', 'Current Assets', 'Bank Accounts', '12000 Investment Accounts', '120001 Endowment Funds', '12012 95-3285 Thriv. Manu'], 'Assets', 34802.56),
    ]);
    const result = computeEquityReclassification(rows);
    expect(result.unclassified).toHaveLength(1);
    expect(result.unclassified[0].account_name).toBe('12012 95-3285 Thriv. Manu');
    // Not counted toward either bucket until a human classifies it.
    expect(result.breakdown.perpetual.cents + result.breakdown.purpose_time.cents + result.breakdown.designated.cents).toBe(
      real2026Rows().filter(r => !r.has_children).reduce((sum, r) => {
        const code = extractAccountCode(r.account_name);
        return EQUITY_RECLASS_ACCOUNTS[code] ? sum + r.own_balance_cents : sum;
      }, 0)
    );
  });

  it('flags a new leaf under the "25000 Funds" group as unclassified (e.g. a brand-new fund)', () => {
    const rows = real2026Rows().concat([row(['Liabilities', '25000 Funds', '25045 New Fund Just Created'], 'Liabilities', 500)]);
    const result = computeEquityReclassification(rows);
    expect(result.unclassified.map(u => u.account_name)).toContain('25045 New Fund Just Created');
  });

  it('does NOT flag unrelated 120xx-numbered operational accounts outside the Investment Accounts group', () => {
    // Real false-positive risk found against the actual combined workbook: these three sit under
    // "Other Current Assets"/"Other Assets", not "12000 Investment Accounts" — narrowly excluded.
    const rows = real2026Rows().concat([
      row(['Assets', 'Current Assets', 'Other Current Assets', '12001 Undeposited Funds'], 'Assets', 7146),
      row(['Assets', 'Other Assets', '12200 Employee Loan'], 'Assets', 0),
      row(['Assets', 'Current Assets', 'Other Current Assets', '12400 Prepaid Expense'], 'Assets', 5457.14),
    ]);
    const result = computeEquityReclassification(rows);
    expect(result.unclassified).toEqual([]);
  });

  it('flags an unrecognized Equity-classified leaf (a renamed or brand-new legacy-style line)', () => {
    const rows = real2026Rows().concat([row(['Equity', '34000 Some New Equity Line'], 'Equity', 1000)]);
    const result = computeEquityReclassification(rows);
    expect(result.unclassified.map(u => u.account_name)).toContain('34000 Some New Equity Line');
  });

  it('every code in the classification table is Donor-Restricted (no board-designated bucket)', () => {
    const buckets = new Set(Object.values(EQUITY_RECLASS_ACCOUNTS));
    expect(buckets).toEqual(new Set(['perpetual', 'purpose_time', 'designated']));
  });

  it('the ignore set covers exactly the four legacy plug lines plus the opening-balance line', () => {
    expect(EQUITY_RECLASS_IGNORE_CODES).toEqual(new Set(['30000', '31000', '31500', '32000', '33000']));
  });
});
