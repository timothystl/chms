import { isSyntheticUnavailable } from './synthetic-read-guard.js';

// Hoisted so shell.js can render the same, purely-static decision framing even when `summary` (and
// so the rest of this view) could not be read for this request (see synthetic-read-guard.js) --
// these three rows describe fixed board-authority boundaries, not fetched data, so there is nothing
// dishonest about still showing them while every data-backed card on the same page says "unavailable".
export const FINANCE_HEALTH_DECISIONS = Object.freeze([
  { stream: 'Donor income', authority: 'Full control', action: 'Set the ask and stewardship plan' },
  { stream: 'Earned income', authority: 'Reported, not managed', action: 'Review operating performance' },
  { stream: 'Passive income', authority: 'Timing decision', action: 'Decide distribution timing' },
]);

function isUsableSummary(summary) {
  return summary != null && !isSyntheticUnavailable(summary);
}

function isLiveResult(result) {
  return result != null && !isSyntheticUnavailable(result) && result.source === 'live';
}

// Prefers the real connect.finance-church-report.v1 result (resolveChurchReport, see
// church-report-service.js) when it actually came back live; otherwise falls back to the same
// synthetic `summary.church` fields this card has always used. `churchReportLive` may itself be
// SYNTHETIC_UNAVAILABLE (its own synthetic fallback read failed too, see synthetic-read-guard.js)
// or its non-live shape has no `totals` at all (just raw `rows`) -- neither is dereferenced here,
// so this never throws. Returns `null` (never a fabricated $0) only when there is truly nothing to
// show: no live result AND no usable synthetic `summary`.
function resolveOperating(summary, churchReportLive) {
  if (isLiveResult(churchReportLive)) {
    // `totals` here is connect.finance-church-report.v1's own raw contract shape (see
    // finance-church-report-consumer.js's TOTALS_KEYS) -- netIncomeActualCents/netIncomeBudgetCents,
    // not the actualNetCents/budgetNetCents names church-pages.js's buildLiveChurchReportView
    // reshapes them to for its own table rendering. Recomputing varianceCents here rather than
    // trusting a wire field keeps this consistent with the synthetic branch below either way.
    const t = churchReportLive.totals;
    const actualNetCents = Number(t.netIncomeActualCents || 0);
    const budgetNetCents = Number(t.netIncomeBudgetCents || 0);
    return {
      incomeActualCents: Number(t.incomeActualCents || 0),
      expenseActualCents: Number(t.expenseActualCents || 0),
      actualNetCents,
      budgetNetCents,
      varianceCents: actualNetCents - budgetNetCents,
      source: 'live',
    };
  }
  if (!isUsableSummary(summary)) return null;
  const incomeActualCents = Number(summary.church.income_actual_cents || 0);
  const expenseActualCents = Number(summary.church.expense_actual_cents || 0);
  const incomeBudgetCents = Number(summary.church.income_budget_cents || 0);
  const expenseBudgetCents = Number(summary.church.expense_budget_cents || 0);
  const actualNetCents = incomeActualCents - expenseActualCents;
  const budgetNetCents = incomeBudgetCents - expenseBudgetCents;
  return {
    incomeActualCents,
    expenseActualCents,
    actualNetCents,
    budgetNetCents,
    varianceCents: actualNetCents - budgetNetCents,
    source: 'synthetic-fallback',
  };
}

// Same live-first/independent-degradation shape as resolveOperating above, for
// connect.finance-balance-sheet.v1 (resolveBalanceSheet, see balance-sheet-service.js).
//
// "Net assets" on this card has always meant total Equity (Assets minus Liabilities) -- the
// synthetic fixture's own `summary.balanceSheet.equity_cents` is a flat sum of every row
// classified 'Equity'. The live contract's `totals.equityCents` is the direct equivalent: it is
// computed from the SAME Designated-Funds-as-Equity-reclassified rows as `accounts` (see
// finance-balance-sheet-consumer.js's header comment), and is guaranteed equal to
// `equityReclass.totalEquityCents` -- i.e. it already *is* the reclassified total Equity, matching
// what this card has always meant by "net assets", not merely one slice of it. `equityReclass`'s
// own donorRestrictedCents/unrestrictedCents/breakdown fields are a *decomposition* of that same
// total for the Balance Sheet page itself (out of scope here) -- using either alone here would
// under-report net assets, so `totals.equityCents` (the whole reclassified figure), not a component
// of equityReclass, is the correct live equivalent.
function resolvePosition(summary, balanceSheetLive) {
  if (isLiveResult(balanceSheetLive)) {
    const t = balanceSheetLive.totals;
    return {
      assetsCents: Number(t.assetsCents || 0),
      liabilitiesCents: Number(t.liabilitiesCents || 0),
      netAssetsCents: Number(t.equityCents || 0),
      source: 'live',
    };
  }
  if (!isUsableSummary(summary)) return null;
  return {
    assetsCents: Number(summary.balanceSheet.assets_cents || 0),
    liabilitiesCents: Number(summary.balanceSheet.liabilities_cents || 0),
    netAssetsCents: Number(summary.balanceSheet.equity_cents || 0),
    source: 'synthetic-fallback',
  };
}

// `live` carries this page's own already-fetched live-first resolver results -- churchReportLive
// (resolveChurchReport) for the Operating result card, balanceSheetLive (resolveBalanceSheet, the
// shell.js `balanceSheet` variable) for the Financial position card -- so this can prefer real
// Connect data over the synthetic `summary` fixture per-card, independently. Passing neither (or
// omitting `live` entirely) reproduces the previous, fully-synthetic behavior exactly. Giving is
// untouched: `giving`/its `source` were already resolved live-first by shell.js's own
// resolveGivingSummary before this is ever called, and never fail to at least the committed
// synthetic fixture, so this never needs to guard it the way operating/position must.
export function buildFinancialHealthView(summary, giving, live = {}) {
  const { churchReportLive = null, balanceSheetLive = null } = live;
  return {
    operating: resolveOperating(summary, churchReportLive),
    position: resolvePosition(summary, balanceSheetLive),
    giving: {
      grossCents: Number(giving.totals.grossCents || 0),
      refundCents: Number(giving.totals.refundCents || 0),
      netCents: Number(giving.totals.netCents || 0),
      sourceRecordCount: Number(giving.reconciliation.sourceRecordCount || 0),
      reconciled: giving.reconciliation.totalsMatch === true,
    },
    decisions: FINANCE_HEALTH_DECISIONS,
  };
}
