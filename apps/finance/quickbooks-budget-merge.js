// ── QuickBooks Budget vs Actual reconstruction — Finance-owned port (DESIGN + DARK CODE) ───────
//
// NOT WIRED. See quickbooks-oauth-client.js's header comment for the full "why a port, why dark"
// context. This is a faithful, line-for-line port of src/api-finance.js's
// mergeLeafCells/mergeSection/mergeTree/mergeProfitAndLossTree/mergeCurrentYearBudgetAndActual/
// fetchQboJson — the confirmed-working path AGENTS.md describes: "the working path is
// mergeCurrentYearBudgetAndActual()'s reconstruction from the Budget entity + a date-scoped
// ProfitAndLoss report, not the native report endpoint". QuickBooks' own native BudgetVsActuals
// report is called for its warnings only and its Rows/Columns are never trusted — see the legacy
// file's own comment history and AGENTS.md's FIN2 note; this module reproduces that same
// distrust, not just the report call.
//
// Every function below is pure (mergeLeafCells/mergeSection/mergeTree/mergeProfitAndLossTree) or
// takes its two HTTP calls as an already-constructed `client` (mergeCurrentYearBudgetAndActual —
// see quickbooks-oauth-client.js's makeQboClient), so tests exercise this with mocked
// Response-shaped objects (`{ ok, status, headers: { get() {} }, json() {} }`) built from fixture
// JSON payloads shaped like Intuit's real Budget/ProfitAndLoss responses, never a real network
// call.

// Merges a single leaf/subtotal row's budget amount in, by exact account-name match against the
// Budget entity, preferring QuickBooks' own account id when the report cell carries one. See
// src/api-finance.js's mergeLeafCells for the full account-id-vs-name-collision reasoning this
// reproduces verbatim.
export function mergeLeafCells(cells, ctx) {
  const name = cells[0]?.value || '';
  const acctId = cells[0]?.id;
  const actual = Number(cells[cells.length - 1]?.value);
  const actualAmt = Number.isFinite(actual) ? actual : 0;
  let budgetAmt = 0;
  let matchedById = false;
  if (acctId != null && ctx.budgetByAccountId && ctx.budgetByAccountId.has(acctId)) {
    budgetAmt = ctx.budgetByAccountId.get(acctId);
    matchedById = true;
  } else {
    const ids = ctx.budgetIdsByName.get(name);
    if (ids && ids.size > 1) ctx.ambiguousNames.add(name);
    else if (ctx.budgetByName.has(name)) budgetAmt = ctx.budgetByName.get(name);
  }
  if (ctx.unmatched && budgetAmt === 0 && Math.abs(actualAmt) >= 1 && !matchedById) {
    ctx.unmatched.push({ name, actualAmt, hadId: acctId != null });
  }
  return {
    cells: [{ value: name }, { value: actualAmt.toFixed(2) }, { value: budgetAmt.toFixed(2) }, { value: (actualAmt - budgetAmt).toFixed(2) }],
    budget: budgetAmt,
  };
}

// Merges one Section row (recursing into its children first), then derives the section's own
// subtotal as its own direct-posting amount plus every descendant's budget summed bottom-up.
export function mergeSection(row, ctx) {
  const child = mergeTree(row.Rows?.Row, ctx);
  let ownBudget = 0;
  let newHeaderCells = row.Header?.ColData;
  if (newHeaderCells && newHeaderCells.length >= 2) {
    const m = mergeLeafCells(newHeaderCells, ctx);
    newHeaderCells = m.cells;
    ownBudget = m.budget;
  }
  const sectionBudget = ownBudget + child.budgetSum;
  let newSummaryCells = row.Summary?.ColData;
  if (newSummaryCells && newSummaryCells.length >= 2) {
    const actual = Number(newSummaryCells[newSummaryCells.length - 1]?.value) || 0;
    newSummaryCells = [newSummaryCells[0], { value: actual.toFixed(2) }, { value: sectionBudget.toFixed(2) }, { value: (actual - sectionBudget).toFixed(2) }];
  }
  return {
    row: {
      type: 'Section',
      Header: newHeaderCells ? { ColData: newHeaderCells } : row.Header,
      Rows: { Row: child.rows },
      Summary: newSummaryCells ? { ColData: newSummaryCells } : row.Summary,
    },
    budget: sectionBudget,
  };
}

// Recursively merges budget amounts into an arbitrarily-nested Section/Data row tree.
export function mergeTree(rows, ctx) {
  let budgetSum = 0;
  const out = (rows || []).map((row) => {
    if (row.type === 'Section') {
      const { row: newRow, budget } = mergeSection(row, ctx);
      budgetSum += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row;
    const m = mergeLeafCells(cells, ctx);
    budgetSum += m.budget;
    return { ColData: m.cells };
  });
  return { rows: out, budgetSum };
}

// This company's live QuickBooks report uses "Revenue"/"Expenditures" wording, which extends to
// the bottom-line labels too ("Net Revenue" instead of "Net Income") — see AGENTS.md/FIN2 and
// src/api-finance.js's own comment on why both regexes below must match English "Income" AND
// "Revenue" wording.
const FINAL_NET_LABEL_RE = /^Net (Income|Revenue)$/i;
const OTHER_INCOME_SECTION_RE = /^Other (Income|Revenue)$/i;

// Top-level P&L rows alternate Sections (Income/Cost of Goods Sold/Expenses/Other Income/Other
// Expenses) with flat running-subtotal rows (Gross Profit/Net Operating Income/Net Other
// Income/Net Income) — "Other Income" starts a second, independent running total that only
// merges back in at "Net Income".
export function mergeProfitAndLossTree(rows, ctx) {
  let mainBudget = 0, otherBudget = 0, inOtherThread = false;
  return (rows || []).map((row) => {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      if (OTHER_INCOME_SECTION_RE.test(label)) inOtherThread = true;
      const { row: newRow, budget } = mergeSection(row, ctx);
      if (inOtherThread) otherBudget += budget; else mainBudget += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row;
    const label = cells[0]?.value || '';
    const actual = Number(cells[cells.length - 1]?.value) || 0;
    const budgetVal = FINAL_NET_LABEL_RE.test(label) ? (mainBudget + otherBudget) : (inOtherThread ? otherBudget : mainBudget);
    return { ColData: [{ value: label }, { value: actual.toFixed(2) }, { value: budgetVal.toFixed(2) }, { value: (actual - budgetVal).toFixed(2) }] };
  });
}

// Wraps a QuickBooks Accounting API call with the same error-handling src/api-finance.js's
// fetchQboJson applies: captures `intuit_tid`, parses the structured Fault.Error[] body, and
// returns null (pushing a human-readable warning) instead of throwing, so one failed call never
// takes down an entire sync. `resPromise` is expected to resolve to a Response-shaped object —
// tests pass a resolved value built from fixture JSON, never a real fetch() call.
export async function fetchQboJson(label, resPromise, warnings, hint) {
  let r;
  try { r = await resPromise; }
  catch (e) {
    warnings.push(`${label}: ${e.message}`);
    return null;
  }
  const tid = r.headers?.get ? (r.headers.get('intuit_tid') || '') : '';
  if (r.ok) return await r.json();
  const fault = await r.json().catch(() => null);
  const faultError = fault?.Fault?.Error?.[0];
  const detail = [faultError?.Message, faultError?.Detail].filter(Boolean).join(' — ');
  warnings.push(
    `${label} (HTTP ${r.status}${tid ? `, intuit_tid ${tid}` : ''}${faultError?.code ? `, error code ${faultError.code}` : ''})`
    + (detail ? `: ${detail}` : '')
    + (hint ? ` — ${hint}` : '')
  );
  return null;
}

// Fetches the Budget entity + a single current-year ProfitAndLoss report via `client` (see
// quickbooks-oauth-client.js's makeQboClient) and merges them into one tree via
// mergeProfitAndLossTree. This is the confirmed-working reconstruction AGENTS.md describes.
//
// ⚠ Same caveat the legacy function carries: the exact Budget entity field names
// (BudgetDetail/AccountRef/Amount) are based on Intuit's published schema. The legacy comment
// says this could not be confirmed against a live response while it was first written, but
// AGENTS.md now confirms the shape held up against a real production QuickBooks company on
// 2026-07-28 — this port trusts that same shape, unverified again since (no request has been
// made to the real API since building this).
export async function mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId) {
  const budgetsData = await fetchQboJson('Budget entity', client.budgets(), warnings);
  if (!budgetsData) return null;
  const budgetList = budgetsData?.QueryResponse?.Budget || [];
  const budget = (preferredBudgetId && budgetList.find((b) => b.Id === preferredBudgetId))
    || budgetList.find((b) => (b.StartDate || '').startsWith(String(year))) || budgetList[0];
  if (!budget) { warnings.push(`Budget entity: no Budget found for ${year}`); return null; }

  const plData = await fetchQboJson(
    'Profit and Loss (current year)',
    client.profitAndLoss({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
    warnings
  );
  if (!plData || !plData.Rows) return null;

  const budgetByName = new Map();
  const budgetIdsByName = new Map();
  const budgetByAccountId = new Map();
  for (const line of (budget.BudgetDetail || [])) {
    const name = line?.AccountRef?.name;
    const id = line?.AccountRef?.value;
    const amt = Number(line?.Amount);
    if (!Number.isFinite(amt)) continue;
    if (id != null) budgetByAccountId.set(id, (budgetByAccountId.get(id) || 0) + amt);
    if (!name) continue;
    budgetByName.set(name, (budgetByName.get(name) || 0) + amt);
    if (!budgetIdsByName.has(name)) budgetIdsByName.set(name, new Set());
    if (id != null) budgetIdsByName.get(name).add(id);
  }
  if (!budgetByName.size && !budgetByAccountId.size) { warnings.push('Budget entity: found a Budget but no usable BudgetDetail line items'); return null; }

  const ambiguousNames = new Set();
  const unmatched = [];
  const rows = mergeProfitAndLossTree(plData.Rows.Row, { budgetByName, budgetIdsByName, budgetByAccountId, ambiguousNames, unmatched });
  if (ambiguousNames.size) {
    warnings.push(
      `Budget vs Actual: ${ambiguousNames.size} account name(s) appear on more than one account in different categories (e.g. sub-accounts sharing a name across Income and Expenses) — shown as $0 budget rather than guessed which one: ${[...ambiguousNames].slice(0, 5).join(', ')}${ambiguousNames.size > 5 ? '…' : ''}`
    );
  }
  if (unmatched.length) {
    const withId = unmatched.filter((u) => u.hadId).length;
    const noId = unmatched.length - withId;
    const sample = unmatched.slice(0, 8).map((u) => `${u.name} ($${u.actualAmt.toFixed(2)}${u.hadId ? '' : ', no account id on this cell'})`).join('; ');
    warnings.push(
      `Budget vs Actual: ${unmatched.length} account(s) with real activity had no matching Budget line (${withId} had an account id that just wasn't in this Budget's BudgetDetail, ${noId} had no account id at all so only name-matching was possible) — showing $0 budget for these rather than guessing: ${sample}${unmatched.length > 8 ? '…' : ''}`
    );
  }
  return { rows };
}

// Wraps mergeCurrentYearBudgetAndActual()'s merged tree in the same Columns/Rows report shape a
// frontend renderer expects, for use when QuickBooks' own native BudgetVsActuals report call
// fails or (per AGENTS.md) is simply not trusted.
export async function buildBudgetVsActualFallback(client, year, warnings, preferredBudgetId) {
  const merged = await mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId);
  if (!merged) return null;
  return {
    Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
    Rows: { Row: merged.rows },
    _synthesized: true,
  };
}
