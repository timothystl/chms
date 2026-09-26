// ── Raw QuickBooks output, read from Finance's own report cache ─────────────────────────────
// Connect's legacy Data & Imports tab shows the cached Budget vs. Actual report and account
// balances (finance/overview in src/api-finance.js). Since QuickBooks moved to Finance
// (QBO_MANAGED_BY_FINANCE), that cache -- finance_qb_snapshot -- lives only in Finance's database:
// Finance's own sync writes 'budget_vs_actual' and 'accounts' (quickbooks-oauth-routes.js), and
// Connect's daycare-app sync writes 'daycare_accounts' there through its storage router. So this
// reads FINANCE_DB directly. It is a plain SELECT of the cache: it never reads a token, never calls
// QuickBooks, and never refreshes anything, so it cannot become a competing refresh-token writer.

export async function readQuickbooksSnapshot(db) {
  const rows = (await db.prepare('SELECT key, value, synced_at FROM finance_qb_snapshot').all()).results || [];
  const snaps = {};
  for (const row of rows) {
    try { snaps[row.key] = { data: JSON.parse(row.value), syncedAt: row.synced_at || '' }; } catch { /* skip a corrupt cache row */ }
  }
  return {
    budgetVsActual: snaps.budget_vs_actual?.data || null,
    budgetSyncedAt: snaps.budget_vs_actual?.syncedAt || '',
    accounts: snaps.accounts?.data || null,
    accountsSyncedAt: snaps.accounts?.syncedAt || '',
    daycareAccounts: snaps.daycare_accounts?.data || null,
    daycareAccountsSyncedAt: snaps.daycare_accounts?.syncedAt || '',
  };
}

// QuickBooks' Columns/Rows report shape, flattened the way legacy finRenderReportRows walks it:
// a Section contributes its Header row, its children one level deeper, then its bold Summary row;
// a Data row contributes its own ColData. The column set is whatever QuickBooks returned.
export function flattenQuickbooksReport(report) {
  const columns = ((report && report.Columns && report.Columns.Column) || []).map((column) => String(column.ColTitle || ''));
  const rows = [];
  const cells = (colData) => (colData || []).map((cell) => (cell && cell.value != null ? String(cell.value) : ''));
  (function walk(list, depth) {
    for (const row of list || []) {
      if (row.type === 'Section') {
        const header = row.Header && row.Header.ColData;
        if (header && header.length) rows.push({ cells: cells(header), depth, total: false });
        if (row.Rows && row.Rows.Row) walk(row.Rows.Row, depth + 1);
        const summary = row.Summary && row.Summary.ColData;
        if (summary && summary.length) rows.push({ cells: cells(summary), depth, total: true });
      } else if (row.ColData && row.ColData.length) {
        rows.push({ cells: cells(row.ColData), depth, total: false });
      }
    }
  }((report && report.Rows && report.Rows.Row) || [], 0));
  return { columns, rows, synthesized: !!(report && report._synthesized) };
}

// QuickBooks accounts (CurrentBalance, in dollars) merged with the daycare app's accounts
// (balance_cents), sorted by source then name -- legacy finRenderAccounts, in cents.
export function buildAccountBalances(snapshot) {
  const qbo = ((snapshot.accounts && snapshot.accounts.QueryResponse && snapshot.accounts.QueryResponse.Account) || [])
    .map((account) => ({
      name: String(account.Name || ''), type: String(account.AccountSubType || account.AccountType || ''),
      balanceCents: Math.round((Number(account.CurrentBalance) || 0) * 100), source: 'QuickBooks',
    }));
  const daycare = (Array.isArray(snapshot.daycareAccounts) ? snapshot.daycareAccounts : [])
    .map((account) => ({
      name: String(account.name || ''), type: 'Daycare',
      balanceCents: Math.round(Number(account.balance_cents) || 0), source: 'Daycare app',
    }));
  const accounts = [...qbo, ...daycare].sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  return {
    accounts,
    totalCents: accounts.reduce((sum, account) => sum + account.balanceCents, 0),
    hasDaycare: daycare.length > 0,
  };
}
