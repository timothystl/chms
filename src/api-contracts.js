// ── Versioned cross-product contract endpoints ──────────────────────────────
// First real slice of Finance separation: Connect actually producing the
// connect.giving-summary.v1 aggregate it has only ever emitted to a committed
// synthetic fixture in Finance staging. This file has one job — assemble that
// exact contract shape from real Giving data — so it stays reviewable
// independent of the much larger People/Giving/Reports handlers.
import { json } from './auth.js';
import { validateConnectGivingSummaryV1 } from '../apps/finance/connect-giving-consumer.js';

function isValidDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A household is the giving household, not the People-directory household: someone with no
// household_id gives as themselves. Matches the convention already established for Giving
// household rollups (see giving_year_household_totals in migrations/0044).
const HOUSEHOLD_KEY_SQL = `CASE
  WHEN p.household_id IS NOT NULL AND p.household_id != 0 THEN 'h:' || p.household_id
  WHEN ge.person_id IS NOT NULL THEN 'p:' || ge.person_id
  ELSE NULL
END`;

// Pure and independently testable: takes a bound period and an injected "now", queries nothing
// beyond one bounded SELECT, and returns the exact connect.giving-summary.v1 shape. giving_entries
// has no separate refund table or flag — a negative amount IS a refund/correction row (see
// api-utils.js's comment on rendering negative amounts), so gross/refund/net are split on sign
// rather than read from a dedicated column.
export async function buildConnectGivingSummaryV1(db, { startDate, endDate, now = new Date() }) {
  const rows = (await db.prepare(
    `SELECT f.id AS fund_id, f.name AS fund_name,
            COUNT(*) AS gift_count,
            COUNT(DISTINCT ${HOUSEHOLD_KEY_SQL}) AS household_count,
            SUM(CASE WHEN ge.amount > 0 THEN ge.amount ELSE 0 END) AS gross_cents,
            SUM(CASE WHEN ge.amount < 0 THEN -ge.amount ELSE 0 END) AS refund_cents,
            SUM(ge.amount) AS net_cents
       FROM giving_entries ge
       JOIN funds f ON f.id = ge.fund_id
       LEFT JOIN people p ON p.id = ge.person_id
      WHERE ge.contribution_date >= ? AND ge.contribution_date <= ?
      GROUP BY f.id, f.name
      ORDER BY f.id ASC`
  ).bind(startDate, endDate).all()).results || [];

  const funds = rows.map((row) => ({
    fundRef: String(row.fund_id),
    fundLabel: row.fund_name,
    giftCount: row.gift_count,
    householdCount: row.household_count,
    amounts: {
      grossCents: row.gross_cents,
      refundCents: row.refund_cents,
      netCents: row.net_cents,
    },
  }));

  const totals = funds.reduce((acc, fund) => ({
    grossCents: acc.grossCents + fund.amounts.grossCents,
    refundCents: acc.refundCents + fund.amounts.refundCents,
    netCents: acc.netCents + fund.amounts.netCents,
  }), { grossCents: 0, refundCents: 0, netCents: 0 });

  const generatedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    contract: 'connect.giving-summary.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    period: { startDate, endDate },
    generatedAt,
    sourceThrough: `${endDate}T23:59:59Z`,
    funds,
    totals,
    reconciliation: {
      sourceRecordCount: funds.reduce((total, fund) => total + fund.giftCount, 0),
      fundCount: funds.length,
      totalsMatch: true,
    },
  };
}

export async function handleContractsApi(req, env, url, method, seg, db) {
  if (seg === 'contracts/connect-giving-summary-v1' && method === 'GET') {
    const startDate = url.searchParams.get('from');
    const endDate = url.searchParams.get('to');
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return json({ error: 'from and to are required as YYYY-MM-DD dates' }, 400);
    }
    if (startDate > endDate) {
      return json({ error: 'from must not be after to' }, 400);
    }
    const now = new Date();
    // The contract requires sourceThrough (end of the requested period) to never be later than
    // generatedAt (now) — a future-dated period would violate that by construction, so this is
    // refused here rather than emitted and rejected downstream by Finance's consumer.
    if (`${endDate}T23:59:59Z` > now.toISOString()) {
      return json({ error: 'to must not be in the future' }, 400);
    }

    const summary = await buildConnectGivingSummaryV1(db, { startDate, endDate, now });

    // Fail closed: this reuses Finance's own consumer validator, so producer and consumer can
    // never silently drift apart. This should never fire from real data — if it does, something
    // is wrong with this endpoint, and Finance must not see a malformed contract.
    const validation = validateConnectGivingSummaryV1(summary);
    if (!validation.ok) {
      return json({ error: 'Internal: assembled summary failed contract validation', details: validation.errors }, 500);
    }

    return json(summary);
  }
  return null;
}
