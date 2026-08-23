import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// finComputeAvailableForDistribution() lives inside the served (String.raw) frontend script, not
// as an exported module function. It used to be extractable on its own, but since FIN61 it also
// amortizes the loan to get the year-to-date mortgage principal, so load the whole bundle in a vm
// with a stub DOM and take the real function out of it — same technique used elsewhere in this
// project (see CLAUDE.md AT7 / FIN54 / FIN57).
function loadHelper() {
  const ctx = { console, document: { getElementById: () => null } };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx);
  if (typeof ctx.finComputeAvailableForDistribution !== 'function') throw new Error('finComputeAvailableForDistribution not found in built script');
  return ctx.finComputeAvailableForDistribution;
}

describe('finComputeAvailableForDistribution', () => {
  const finComputeAvailableForDistribution = loadHelper();
  const thisYear = new Date().getFullYear();

  it('subtracts this year\'s reserve contributions and capital spend from annual net income', () => {
    const d = {
      annualSummary: [{ year: thisYear, net_income_cents: 5000000 }, { year: thisYear - 1, net_income_cents: 999999 }],
      reserves: {
        property_tax: [
          { report_month: `${thisYear}-01`, contribution_cents: 100000 },
          { report_month: `${thisYear}-02`, contribution_cents: 100000 },
          { report_month: `${thisYear - 1}-12`, contribution_cents: 999999 }, // prior year — excluded
        ],
      },
      capitalLedger: [
        { entry_date: `${thisYear}-03-01`, amount_cents: 500000 },
        { entry_date: `${thisYear - 1}-11-01`, amount_cents: 999999 }, // prior year — excluded
      ],
    };
    const result = finComputeAvailableForDistribution(d);
    expect(result.year).toBe(thisYear);
    expect(result.annualNetCents).toBe(5000000);
    expect(result.reserveContribCents).toBe(200000);
    expect(result.capitalCents).toBe(500000);
    expect(result.availableCents).toBe(5000000 - 200000 - 500000);
  });

  it('handles no data for the current year gracefully', () => {
    const result = finComputeAvailableForDistribution({ annualSummary: [], reserves: {}, capitalLedger: [] });
    expect(result.annualNetCents).toBe(0);
    expect(result.reserveContribCents).toBe(0);
    expect(result.capitalCents).toBe(0);
    expect(result.availableCents).toBe(0);
  });
});

function loadDistributedHelper() {
  const m = CHMS_APP_FINANCE_JS.match(/function finComputeDistributedThisYear\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeDistributedThisYear not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeDistributedThisYear; })()`);
}

describe('finComputeDistributedThisYear', () => {
  const finComputeDistributedThisYear = loadDistributedHelper();
  const thisYear = new Date().getFullYear();

  it('sums only this calendar year\'s confirmed distributions', () => {
    const d = {
      distributions: [
        { period: `${thisYear}-01`, amount_cents: 300000 },
        { period: `${thisYear}-04`, amount_cents: 450000 },
        { period: `${thisYear - 1}-11`, amount_cents: 999999 }, // prior year — excluded
      ],
    };
    const result = finComputeDistributedThisYear(d);
    expect(result.year).toBe(thisYear);
    expect(result.cents).toBe(750000);
  });

  it('handles no distributions gracefully', () => {
    const result = finComputeDistributedThisYear({ distributions: [] });
    expect(result.cents).toBe(0);
  });
});

function loadMortgageHelper() {
  const m = CHMS_APP_FINANCE_JS.match(/function finComputeMortgageRemainingCents\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeMortgageRemainingCents not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeMortgageRemainingCents; })()`);
}

describe('finComputeMortgageRemainingCents', () => {
  const finComputeMortgageRemainingCents = loadMortgageHelper();
  const loan = { balance_cents: 27969113, balance_as_of_date: '2026-07-20' };

  it('reproduces the real June 2026 reconciliation exactly ($2,830.98 principal)', () => {
    const monthly = [{ period: '2026-06', loan_payment_cents: 378303, interest_expense_cents: 95205 }];
    // June predates the confirmed as-of date (2026-07-20) — already reflected in the anchor, not subtracted
    const result = finComputeMortgageRemainingCents(loan, monthly);
    expect(result.cents).toBe(27969113);
    expect(result.asOf).toBe('2026-07-20');
    expect(result.monthsApplied).toEqual([]);
  });

  it('rolls the balance forward using a real month after the confirmed as-of date', () => {
    const monthly = [{ period: '2026-08', loan_payment_cents: 378303, interest_expense_cents: 95000 }];
    const result = finComputeMortgageRemainingCents(loan, monthly);
    const principal = 378303 - 95000;
    expect(result.cents).toBe(27969113 - principal);
    expect(result.asOf).toBe('2026-08');
    expect(result.monthsApplied).toEqual(['2026-08']);
  });

  it('applies multiple months after the anchor in chronological order', () => {
    const monthly = [
      { period: '2026-09', loan_payment_cents: 378303, interest_expense_cents: 94000 },
      { period: '2026-08', loan_payment_cents: 378303, interest_expense_cents: 95000 },
    ];
    const result = finComputeMortgageRemainingCents(loan, monthly);
    const expected = 27969113 - (378303 - 95000) - (378303 - 94000);
    expect(result.cents).toBe(expected);
    expect(result.asOf).toBe('2026-09');
    expect(result.monthsApplied).toEqual(['2026-08', '2026-09']);
  });

  it('ignores months missing either loan_payment_cents or interest_expense_cents', () => {
    const monthly = [{ period: '2026-08', loan_payment_cents: 378303, interest_expense_cents: null }];
    const result = finComputeMortgageRemainingCents(loan, monthly);
    expect(result.cents).toBe(27969113);
    expect(result.monthsApplied).toEqual([]);
  });

  it('falls back to the raw balance when there is no confirmed as-of date', () => {
    const result = finComputeMortgageRemainingCents({ balance_cents: 5000000 }, []);
    expect(result.cents).toBe(5000000);
    expect(result.monthsApplied).toEqual([]);
  });
});

// finComputePropertyReservesOnHandCents shares its "which month carries the authoritative
// reserve figure" check with finPropertyReservesChip via finPropertyLatestReserveMonth, so all
// three come out of the built script together.
function loadReservesOnHandHelpers() {
  const names = ['finPropertyLatestReserveMonth', 'finComputePropertyReservesOnHandCents', 'finPropertyReservesChip'];
  const srcs = names.map((n) => {
    const m = CHMS_APP_FINANCE_JS.match(new RegExp(`function ${n}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${n} not found in built script`);
    return m[0];
  });
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${srcs.join('\n')} return { ${names.join(', ')} }; })()`);
}

describe('finComputePropertyReservesOnHandCents', () => {
  const { finComputePropertyReservesOnHandCents, finPropertyReservesChip } = loadReservesOnHandHelpers();

  // The KPI chip must describe what the number actually contains: AHRA's own Total Property
  // Reserve is tax + base minimum and carries no capital bucket, so the old fixed
  // "tax + capital + base minimum" caption was wrong on the path that figure comes from.
  it('captions the AHRA-figure path with that report period, and the reconstructed path as ledger + base minimum', () => {
    expect(finPropertyReservesChip({ monthly: [{ period: '2026-06', reserve_balance_cents: 1035833 }] })).toBe('AHRA total, 2026-06');
    expect(finPropertyReservesChip({ monthly: [{ period: '2026-06', reserve_balance_cents: null }] })).toBe('reserve ledger + base minimum');
    expect(finPropertyReservesChip({})).toBe('reserve ledger + base minimum');
  });

  it('prefers the latest month\'s reserve_balance_cents (AHRA\'s own verbatim "Total Property Reserve" figure) when one has been recorded, per the real July 2026 report ($10,358.33)', () => {
    const d = {
      monthly: [
        { period: '2026-05', reserve_balance_cents: 900000 },
        { period: '2026-06', reserve_balance_cents: 1035833 },
      ],
      // A stale/incomplete reserve ledger sitting alongside it should NOT be used once a real
      // monthly reserve_balance_cents exists — the report's own figure always wins.
      reserves: { property_tax: [{ report_month: '2026-06', reserve_after_cents: 1 }] },
      meta: { reserves: { base_minimum_cents: 1 } },
    };
    expect(finComputePropertyReservesOnHandCents(d)).toBe(1035833);
  });

  it('falls back to reconstructing from the reserve-schedule ledger + base minimum when no month has a recorded reserve_balance_cents yet', () => {
    const d = {
      monthly: [{ period: '2026-06', reserve_balance_cents: null }],
      reserves: {
        property_tax: [
          { report_month: '2026-06', reserve_after_cents: 475000 },
          { report_month: '2026-07', reserve_after_cents: 585833 },
        ],
      },
      meta: { reserves: { base_minimum_cents: 450000 } },
    };
    expect(finComputePropertyReservesOnHandCents(d)).toBe(1035833);
  });

  it('falls back to the ledger + base minimum when there is no monthly data at all', () => {
    const d = {
      reserves: {
        property_tax: [{ report_month: '2026-06', reserve_after_cents: 100000 }],
        capital: [{ report_month: '2026-05', reserve_after_cents: 20000 }, { report_month: '2026-06', reserve_after_cents: 30000 }],
      },
      meta: {},
    };
    expect(finComputePropertyReservesOnHandCents(d)).toBe(130000);
  });

  it('handles no reserves, monthly, or meta at all', () => {
    expect(finComputePropertyReservesOnHandCents({})).toBe(0);
  });
});

function loadLatestDistributionHelper() {
  const m = CHMS_APP_FINANCE_JS.match(/function finComputeLatestDistributionAmount\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeLatestDistributionAmount not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeLatestDistributionAmount; })()`);
}

describe('finComputeLatestDistributionAmount', () => {
  const finComputeLatestDistributionAmount = loadLatestDistributionHelper();

  it('returns the latest month\'s AHRA "distribution amount (cash minus reserves)" figure, per the real July 2026 report ($9,321.77)', () => {
    const d = {
      monthly: [
        { period: '2026-05', available_for_distribution_cents: 800000 },
        { period: '2026-06', available_for_distribution_cents: 932177 },
      ],
    };
    expect(finComputeLatestDistributionAmount(d)).toEqual({ period: '2026-06', cents: 932177 });
  });

  it('skips back to the most recent month that actually has a distribution figure recorded', () => {
    const d = {
      monthly: [
        { period: '2026-05', available_for_distribution_cents: 800000 },
        { period: '2026-06', available_for_distribution_cents: null },
      ],
    };
    expect(finComputeLatestDistributionAmount(d)).toEqual({ period: '2026-05', cents: 800000 });
  });

  it('returns null when no month has a distribution figure', () => {
    expect(finComputeLatestDistributionAmount({ monthly: [{ period: '2026-06', available_for_distribution_cents: null }] })).toBeNull();
    expect(finComputeLatestDistributionAmount({})).toBeNull();
  });
});

// AHRA's "available to distribute" is cash in the bank at the report date. A distribution paid
// BEFORE that date has already left the account, so deducting it again charges the church twice
// for the same money — the reported bug: $9,321.77 (a 2026-06 report) less a $4,000 payment made
// in 2026-04, shown as $5,321.77 "still available".
describe('finComputeDistributionsAfter', () => {
  // Both bundles: the hero renderer calls esc(), which lives in the core file. Loading ext alone
  // would exercise a state the browser never runs in.
  function loadBundle() {
    const ctx = { console, document: { getElementById: () => null },
      Math, JSON, Date, parseFloat, parseInt, isFinite, Number, String, Object, Array,
      setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} },
      fetch: () => Promise.reject(new Error('no network in tests')),
      navigator: {}, location: { href: '', hash: '' },
      addEventListener() {}, removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
    ctx.document.querySelectorAll = () => [];
    ctx.document.querySelector = () => null;
    ctx.document.addEventListener = () => {};
    ctx.document.body = { classList: { add() {}, remove() {}, contains() { return false; } } };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
    vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
    vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
    return ctx;
  }
  const fin = loadBundle();
  // The real seeded distribution history (src/db.js), with the real 2026 payment.
  const DISTS = [
    { period: '2024-05', amount_cents: 700000 },
    { period: '2025-05', amount_cents: 800000 },
    { period: '2026-04', amount_cents: 400000 },
  ];

  it('ignores a distribution paid before the report — it is already out of the cash figure', () => {
    const out = fin.finComputeDistributionsAfter({ distributions: DISTS }, '2026-06');
    expect(out.cents).toBe(0);
    expect(out.periods).toEqual([]);
  });

  it('ignores a distribution paid in the report month itself', () => {
    expect(fin.finComputeDistributionsAfter({ distributions: DISTS }, '2026-04').cents).toBe(0);
  });

  it('still subtracts a distribution paid after the report, which the figure cannot know about', () => {
    const later = DISTS.concat([{ period: '2026-08', amount_cents: 250000 }]);
    const out = fin.finComputeDistributionsAfter({ distributions: later }, '2026-06');
    expect(out.cents).toBe(250000);
    expect(out.periods).toEqual(['2026-08']);
  });

  it('handles no distributions and no period without throwing', () => {
    expect(fin.finComputeDistributionsAfter({}, '2026-06').cents).toBe(0);
    expect(fin.finComputeDistributionsAfter({ distributions: DISTS }, null).cents).toBe(1900000);
  });

  it('the hero shows the full AHRA figure as still available, not the double-counted figure', () => {
    const d = {
      distributions: DISTS,
      monthly: [{ period: '2026-06', available_for_distribution_cents: 932177 }],
      reserves: {}, capitalLedger: [], meta: {}, annualSummary: [],
    };
    const html = fin.finRenderPropertyDistributionHero(d, false);
    expect(html).toContain('$9,321.77');       // AHRA's figure
    expect(html).toContain('$4,000.00');       // still reported as already taken
    expect(html).not.toContain('$5,321.77');   // ...but never deducted a second time
    // And it says so, so a reader is not left to wonder.
    expect(html).toContain('not deducted again');
  });
});
