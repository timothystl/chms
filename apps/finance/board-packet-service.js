import { isSyntheticUnavailable } from './synthetic-read-guard.js';
import { buildChurchReportView } from './church-report-service.js';
import { buildBalanceSheetView } from './balance-sheet-service.js';

export function buildSyntheticBoardPacket({ summary, churchReport, churchTrends, giving }) {
  if (!summary?.balanceSheet || !churchReport?.totals || !Array.isArray(churchTrends) || churchTrends.length < 2
    || !giving?.totals || !giving?.reconciliation || giving.reconciliation.totalsMatch !== true
    || !Number.isInteger(churchReport.fiscalYear)
    || !Number.isInteger(churchReport.totals.actualNetCents)
    || !Number.isInteger(churchReport.totals.budgetNetCents)
    || !Number.isInteger(giving.reconciliation.sourceRecordCount)
    || giving.reconciliation.sourceRecordCount < 0) {
    throw new Error('Synthetic board packet inputs invalid');
  }
  const currentTrend = churchTrends.at(-1);
  const priorTrend = churchTrends.at(-2);
  if (currentTrend.fiscal_year !== churchReport.fiscalYear
    || ![currentTrend.net_cents, priorTrend.net_cents].every(Number.isInteger)) {
    throw new Error('Synthetic board packet periods invalid');
  }
  const integerOrNull = (value) => Number.isInteger(value) ? value : null;
  const assetsCents = integerOrNull(summary.balanceSheet.assets_cents);
  const liabilitiesCents = integerOrNull(summary.balanceSheet.liabilities_cents);
  const netAssetsCents = integerOrNull(summary.balanceSheet.equity_cents);
  const givingNetCents = integerOrNull(giving.totals.netCents);
  if ([assetsCents, liabilitiesCents, netAssetsCents, givingNetCents].includes(null)) {
    throw new Error('Synthetic board packet amounts invalid');
  }
  const equationDifferenceCents = assetsCents - liabilitiesCents - netAssetsCents;
  if (equationDifferenceCents !== 0) throw new Error('Synthetic board packet position unreconciled');
  const operatingVarianceCents = churchReport.totals.actualNetCents - churchReport.totals.budgetNetCents;
  return {
    fiscalYear: churchReport.fiscalYear,
    operating: {
      actualNetCents: churchReport.totals.actualNetCents,
      budgetNetCents: churchReport.totals.budgetNetCents,
      varianceCents: operatingVarianceCents,
      disposition: operatingVarianceCents === 0
        ? 'on budget'
        : operatingVarianceCents > 0 ? 'favorable' : 'unfavorable',
    },
    position: { assetsCents, liabilitiesCents, netAssetsCents, equationDifferenceCents },
    giving: {
      netCents: givingNetCents,
      sourceRecordCount: giving.reconciliation.sourceRecordCount,
      reconciled: true,
    },
    trend: {
      priorFiscalYear: priorTrend.fiscal_year,
      currentFiscalYear: currentTrend.fiscal_year,
      priorNetCents: priorTrend.net_cents,
      currentNetCents: currentTrend.net_cents,
      changeCents: currentTrend.net_cents - priorTrend.net_cents,
    },
    ready: true,
  };
}

// ── Live-first Board packet: each card independently degrades ─────────────────────────────────
// buildSyntheticBoardPacket above is all-or-nothing by design (it throws when any one of four
// unrelated inputs is missing or unreconciled) and stays exactly as-is; nothing here changes its
// behavior or its own test coverage. buildLiveBoardPacket below is a genuinely different function
// for a genuinely different situation: production's real Finance D1 starts with zero
// `source='synthetic_fixture'` rows and a live contract can independently be configured, missing,
// or failing per card (see synthetic-read-guard.js's header comment), so a single missing/invalid
// piece must never take down the other three -- the same standard shell.js's Financial Health
// block and health-view-model.js's resolveOperating/resolvePosition already apply. Each resolver
// below returns a fully-formed card or `null` (never a fabricated $0/blank); it is never called
// with a value that can throw its own way out to the caller.
function isLiveResult(result) {
  return result != null && !isSyntheticUnavailable(result) && result.source === 'live';
}

function isUsableFallbackRows(result) {
  return result != null && !isSyntheticUnavailable(result) && Array.isArray(result.rows) && result.rows.length > 0;
}

// Operating result: prefers resolveChurchReport's live connect.finance-church-report.v1 result
// (church-report-service.js), using the SAME netIncomeActualCents/netIncomeBudgetCents bottom line
// health-view-model.js's resolveOperating and church-pages.js's buildLiveChurchReportView already
// use for this exact card elsewhere -- not a naive incomeActualCents-minus-expenseActualCents
// figure, which real production data has already been found to disagree with when Other Income/
// Other Expenses/COGS are nonzero (see finance-church-report-trend-consumer.js's header comment).
// Falls back to the same synthetic fixture rows churchReportLive's own fallback re-reads, run
// through the existing buildChurchReportView so the arithmetic is identical to before this change.
export function resolveBoardPacketOperating(churchReportLive) {
  if (isLiveResult(churchReportLive)) {
    const t = churchReportLive.totals || {};
    const actualNetCents = Number(t.netIncomeActualCents);
    const budgetNetCents = Number(t.netIncomeBudgetCents);
    if (!Number.isInteger(actualNetCents) || !Number.isInteger(budgetNetCents) || !Number.isInteger(churchReportLive.fiscalYear)) return null;
    const varianceCents = actualNetCents - budgetNetCents;
    return {
      fiscalYear: churchReportLive.fiscalYear,
      actualNetCents,
      budgetNetCents,
      varianceCents,
      disposition: varianceCents === 0 ? 'on budget' : varianceCents > 0 ? 'favorable' : 'unfavorable',
      source: 'live',
    };
  }
  if (!isUsableFallbackRows(churchReportLive)) return null;
  let view;
  try {
    view = buildChurchReportView(churchReportLive.rows);
  } catch {
    return null;
  }
  if (!Number.isInteger(view.fiscalYear) || !Number.isInteger(view.totals.actualNetCents) || !Number.isInteger(view.totals.budgetNetCents)) return null;
  const varianceCents = view.totals.actualNetCents - view.totals.budgetNetCents;
  return {
    fiscalYear: view.fiscalYear,
    actualNetCents: view.totals.actualNetCents,
    budgetNetCents: view.totals.budgetNetCents,
    varianceCents,
    disposition: varianceCents === 0 ? 'on budget' : varianceCents > 0 ? 'favorable' : 'unfavorable',
    source: 'synthetic-fallback',
  };
}

// Financial position: prefers resolveBalanceSheet's live connect.finance-balance-sheet.v1 result
// (balance-sheet-service.js). `totals.equityCents` is "net assets" here for the exact same reason
// health-view-model.js's resolvePosition uses it -- the whole Designated-Funds-reclassified Equity
// total, guaranteed equal to `equityReclass.totalEquityCents`, not a slice of it. An imbalance
// (equationDifferenceCents !== 0) is shown, not hidden -- the same way the Balance Sheet page
// itself always shows its own "Equation difference" figure even when nonzero; buildLiveBoardPacket
// below folds that into whether the whole packet reads as reconciled.
export function resolveBoardPacketPosition(balanceSheetLive) {
  if (isLiveResult(balanceSheetLive)) {
    const t = balanceSheetLive.totals || {};
    const assetsCents = Number(t.assetsCents);
    const liabilitiesCents = Number(t.liabilitiesCents);
    const netAssetsCents = Number(t.equityCents);
    if (![assetsCents, liabilitiesCents, netAssetsCents].every(Number.isInteger)) return null;
    return {
      assetsCents,
      liabilitiesCents,
      netAssetsCents,
      equationDifferenceCents: assetsCents - liabilitiesCents - netAssetsCents,
      source: 'live',
    };
  }
  if (!isUsableFallbackRows(balanceSheetLive)) return null;
  let view;
  try {
    view = buildBalanceSheetView(balanceSheetLive.rows);
  } catch {
    return null;
  }
  const { assetsCents, liabilitiesCents, equityCents, equationDifferenceCents } = view.totals;
  if (![assetsCents, liabilitiesCents, equityCents].every(Number.isInteger)) return null;
  return {
    assetsCents,
    liabilitiesCents,
    netAssetsCents: equityCents,
    equationDifferenceCents,
    source: 'synthetic-fallback',
  };
}

// Operating trend: prefers resolveChurchTrend's live connect.finance-church-report-trend.v1 result
// (church-report-service.js). Uses each year's own netIncomeActualCents -- the trend contract's
// already-reconciled Income - COGS - Expenses +/- Other Income/Expenses bottom line (see
// finance-church-report-trend-consumer.js's header comment and its 2026-09-15 production finding
// that three of eight fiscal years on file disagree with a naive incomeActualCents minus
// expenseActualCents figure) -- rather than inventing a third, packet-only definition of "net."
// This is the SAME figure Operating result above and health-view-model.js's resolveOperating both
// already use for their own "net" language, so Board packet cannot silently mean something
// different by "Operating trend" than "Operating result" means on the very same page. Unlike
// buildSyntheticBoardPacket's synthetic-only path, the current trend year is not required to equal
// Operating result's own fiscal year -- each card here is independently sourced (possibly live vs.
// synthetic-fallback) and stands on its own, the same way Financial Health's Operating result and
// Financial position cards already degrade independently of each other.
export function resolveBoardPacketTrend(churchTrendLive) {
  if (isLiveResult(churchTrendLive)) {
    const years = churchTrendLive.years;
    if (!Array.isArray(years) || years.length < 2) return null;
    const current = years.at(-1);
    const prior = years.at(-2);
    if (!Number.isInteger(current?.fiscalYear) || !Number.isInteger(prior?.fiscalYear)
      || !Number.isInteger(current?.netIncomeActualCents) || !Number.isInteger(prior?.netIncomeActualCents)) return null;
    return {
      priorFiscalYear: prior.fiscalYear,
      currentFiscalYear: current.fiscalYear,
      priorNetCents: prior.netIncomeActualCents,
      currentNetCents: current.netIncomeActualCents,
      changeCents: current.netIncomeActualCents - prior.netIncomeActualCents,
      source: 'live',
    };
  }
  if (!isUsableFallbackRows(churchTrendLive) || churchTrendLive.rows.length < 2) return null;
  const rows = churchTrendLive.rows;
  const current = rows.at(-1);
  const prior = rows.at(-2);
  if (!Number.isInteger(current?.fiscal_year) || !Number.isInteger(prior?.fiscal_year)
    || !Number.isInteger(current?.net_cents) || !Number.isInteger(prior?.net_cents)) return null;
  return {
    priorFiscalYear: prior.fiscal_year,
    currentFiscalYear: current.fiscal_year,
    priorNetCents: prior.net_cents,
    currentNetCents: current.net_cents,
    changeCents: current.net_cents - prior.net_cents,
    source: 'synthetic-fallback',
  };
}

// Giving evidence: `giving`/`givingSource` here are shell.js's own already-resolved
// resolveGivingSummary result -- already live-first and unconditional for the 'packet' section
// before this change (see shell.js's own comment above its `giving`/`givingSource` line). This
// just makes that existing live capability visible on this card with the same label convention,
// and degrades honestly (returns `null`) in the extremely unlikely case its shape is unusable,
// rather than trusting it blindly the way buildSyntheticBoardPacket's throw-on-anything-wrong
// version did.
export function resolveBoardPacketGiving(giving, givingSource) {
  if (giving == null || isSyntheticUnavailable(giving) || !giving.totals || !giving.reconciliation) return null;
  const netCents = Number(giving.totals.netCents);
  const sourceRecordCount = Number(giving.reconciliation.sourceRecordCount);
  if (!Number.isInteger(netCents) || !Number.isInteger(sourceRecordCount) || sourceRecordCount < 0) return null;
  return {
    netCents,
    sourceRecordCount,
    reconciled: giving.reconciliation.totalsMatch === true,
    source: givingSource === 'live' ? 'live' : 'synthetic-fallback',
  };
}

// Composes the four independently-sourced cards above. `ready` means all four cards have data at
// all (regardless of source mix); `reconciled` additionally requires the position card's
// accounting equation to balance and the giving card's own reconciliation to hold -- the same two
// conditions buildSyntheticBoardPacket used to require before it would return anything at all, now
// checked without ever throwing. Passing every input as `null`/`undefined` degrades every card to
// `null` and `ready`/`reconciled` to `false`, never a crash.
export function buildLiveBoardPacket({ churchReportLive, balanceSheetLive, churchTrendLive, giving, givingSource } = {}) {
  const operating = resolveBoardPacketOperating(churchReportLive);
  const position = resolveBoardPacketPosition(balanceSheetLive);
  const trend = resolveBoardPacketTrend(churchTrendLive);
  const givingCard = resolveBoardPacketGiving(giving, givingSource);
  const fiscalYear = operating?.fiscalYear ?? trend?.currentFiscalYear ?? null;
  const ready = Boolean(operating && position && trend && givingCard);
  const reconciled = ready && position.equationDifferenceCents === 0 && givingCard.reconciled === true;
  return {
    fiscalYear,
    operating,
    position,
    trend,
    giving: givingCard,
    ready,
    reconciled,
  };
}
