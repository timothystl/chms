import { describe, it, expect } from 'vitest';
import {
  applyDesignatedFundsAsEquity, computeBalanceSummary, computeEquityReclassification,
} from '../src/api-finance.js';

// Row shape mirrors makeBalanceRow()'s output — same convention as finance-equity-reclass.test.js.
function row(path, classification, dollars, hasChildren = false) {
  return {
    account_name: path[path.length - 1],
    category_path: path.join(':'),
    classification,
    depth: path.length - 1,
    own_balance_cents: Math.round(dollars * 100),
    has_children: hasChildren ? 1 : 0,
  };
}

// Real 2026 figures (Assets $1,157,339.80 / Liabilities $429,418.29 / Equity $727,921.51),
// trimmed to the accounts that matter for this reclassification: the "25000 Funds" branch under
// Liabilities, one unrelated Liability (Accounts Payable) that must NOT move, and Equity's two
// real lines (Retained Earnings, Net Revenue).
function realRows() {
  return [
    row(['Assets', '11027 Lindell Checking xx9105'], 'Assets', 82126.49),
    row(['Liabilities', 'Other Current Liabilities', 'Accounts Payable', '21000 Accounts Payable'], 'Liabilities', 11812.05),
    row(['Liabilities', 'Current Liabilities', 'Other Current Liabilities', '25000 Funds'], 'Liabilities', 0, true),
    row(['Liabilities', 'Current Liabilities', 'Other Current Liabilities', '25000 Funds', '25004 Building Fund'], 'Liabilities', 720),
    row(['Liabilities', 'Current Liabilities', 'Other Current Liabilities', '25000 Funds', '25027 Memorial Fund'], 'Liabilities', 2776.71),
    row(['Equity', '31000 Retained Earnings'], 'Equity', 739086.19),
    row(['Equity', 'Net Revenue'], 'Equity', -11164.68),
  ];
}

describe('applyDesignatedFundsAsEquity', () => {
  it('moves every row in the "25000 Funds" branch (header and leaves) to Equity', () => {
    const out = applyDesignatedFundsAsEquity(realRows());
    const fundsRows = out.filter(r => r.category_path.includes('25000 Funds'));
    expect(fundsRows).toHaveLength(3); // the group header + 2 funds
    expect(fundsRows.every(r => r.classification === 'Equity')).toBe(true);
  });

  it('rewrites category_path so the branch nests under Equity, dropping the old Liabilities-side ancestors', () => {
    const out = applyDesignatedFundsAsEquity(realRows());
    const header = out.find(r => r.account_name === '25000 Funds');
    const leaf = out.find(r => r.account_name === '25004 Building Fund');
    expect(header.category_path).toBe('Equity:25000 Funds');
    expect(leaf.category_path).toBe('Equity:25000 Funds:25004 Building Fund');
    expect(header.depth).toBe(1);
    expect(leaf.depth).toBe(2);
  });

  it('leaves every other Liability untouched', () => {
    const out = applyDesignatedFundsAsEquity(realRows());
    const ap = out.find(r => r.account_name === '21000 Accounts Payable');
    expect(ap.classification).toBe('Liabilities');
    expect(ap.category_path).toBe('Liabilities:Other Current Liabilities:Accounts Payable:21000 Accounts Payable');
  });

  it('leaves Assets and the original Equity lines untouched', () => {
    const out = applyDesignatedFundsAsEquity(realRows());
    const cash = out.find(r => r.account_name === '11027 Lindell Checking xx9105');
    const retained = out.find(r => r.account_name === '31000 Retained Earnings');
    expect(cash.classification).toBe('Assets');
    expect(cash.category_path).toBe('Assets:11027 Lindell Checking xx9105');
    expect(retained.classification).toBe('Equity');
    expect(retained.category_path).toBe('Equity:31000 Retained Earnings');
  });

  it('does not mutate the rows passed in', () => {
    const original = realRows();
    applyDesignatedFundsAsEquity(original);
    const fundLeaf = original.find(r => r.account_name === '25004 Building Fund');
    expect(fundLeaf.classification).toBe('Liabilities');
    expect(fundLeaf.category_path).toContain('Liabilities:');
  });

  it('never touches a Liability whose path has no "25000" segment, even if the account name starts with those digits elsewhere', () => {
    const rows = [row(['Liabilities', '250001 Unrelated Account'], 'Liabilities', 100)];
    const out = applyDesignatedFundsAsEquity(rows);
    expect(out[0].classification).toBe('Liabilities'); // "250001" fails the \b boundary against "25000"
  });

  it('moves Total Assets to Liabilities+Equity by exactly the Designated Funds total, leaving Total Assets and the combined bottom line unchanged', () => {
    const before = computeBalanceSummary(realRows());
    const after = computeBalanceSummary(applyDesignatedFundsAsEquity(realRows()));
    const fundsCents = 72000 + 277671; // 720 + 2776.71, in cents
    expect(after.assetsCents).toBe(before.assetsCents);
    expect(after.liabilitiesCents).toBe(before.liabilitiesCents - fundsCents);
    expect(after.equityCents).toBe(before.equityCents + fundsCents);
    expect(after.liabilitiesPlusEquityCents).toBe(before.liabilitiesPlusEquityCents);
    expect(after.balancedCents).toBe(before.balancedCents);
  });

  it('feeding the reclassified rows into computeEquityReclassification keeps it tying out to the NEW Total Equity (Donor-Restricted + Without Donor Restrictions == Total Equity)', () => {
    const displayRows = applyDesignatedFundsAsEquity(realRows());
    const summary = computeBalanceSummary(displayRows);
    const reclass = computeEquityReclassification(displayRows);
    expect(reclass.totalEquityCents).toBe(summary.equityCents);
    expect(reclass.donorRestrictedCents + reclass.unrestrictedCents).toBe(summary.equityCents);
    // The designated funds are the sole Donor-Restricted contributor in this fixture (no
    // endowment accounts included), so the restricted bucket is exactly their total.
    expect(reclass.donorRestrictedCents).toBe(72000 + 277671);
  });
});
