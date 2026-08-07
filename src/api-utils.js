// Shared utilities used across multiple api-*.js modules.
import { json, html } from './auth.js';

// ── Configurable role permissions ─────────────────────────────────────────
// The matrix below is the actual access-control definition threaded through the whole
// ChMS API. Each configurable role (finance/staff/office/member) gets, per feature ITEM,
// one of three LEVELS: 'none' (no access), 'view' (read-only) or 'edit' (read + write).
// handleChmsApi resolves this once and enforces it centrally (a per-item view+edit gate),
// so every downstream domain handler automatically respects an admin's changes.
//
//   admin  — always full access (edit on everything editable), never configurable, so an
//            admin can never lock themselves out.
//   member — a structurally different, filtered read-only directory view. It can never be
//            granted 'edit' anywhere and can only be toggled on the safe, read-only extras
//            (the general Reports tab); everything else is forced 'none'. clampMemberRow()
//            enforces this regardless of what's stored.
//
// People / Households editing is NOT one of these items — it stays governed by the blanket
// `canEdit` flag (true for every non-member role), exactly as before. These items are the
// feature areas layered on top of the baseline directory.
export const ROLE_PERMISSION_ROLES = ['finance', 'staff', 'office', 'member'];
export const ROLE_PERMISSION_LEVELS = ['none', 'view', 'edit'];
// editable:false items (Reports, Audit Log) are inherently read-only — their max level is
// 'view'; the UI still lets you pick none/view but never edit.
export const ROLE_PERMISSION_ITEMS = [
  { key: 'giving',     label: 'Giving',            editable: true  },
  { key: 'tuitionaid', label: 'Tuition Aid',       editable: true  },
  { key: 'finance',    label: 'Finance Overview',  editable: true  },
  { key: 'attendance', label: 'Attendance',        editable: true  },
  { key: 'followups',  label: 'Follow-ups',        editable: true  },
  { key: 'audit',      label: 'Audit Log',         editable: false },
  { key: 'register',   label: 'Register',          editable: true  },
  { key: 'reports',    label: 'Reports tab',       editable: false },
];
export const ROLE_PERMISSION_ITEM_KEYS = ROLE_PERMISSION_ITEMS.map(i => i.key);
// Per-item ceiling — read-only items cap at 'view'.
const ITEM_MAX_LEVEL = {};
for (const it of ROLE_PERMISSION_ITEMS) ITEM_MAX_LEVEL[it.key] = it.editable ? 'edit' : 'view';
// Which items a member may even be granted (view only), and to what ceiling. Everything
// not listed here is forced to 'none' for members.
const MEMBER_ALLOWED_ITEMS = { reports: 'view' };

export const DEFAULT_ROLE_PERMISSIONS = {
  // Matches the historical fixed behavior exactly: finance → giving/tuition/finance (edit)
  // + reports (view); staff → attendance/follow-ups/register (edit) + audit/reports (view);
  // office → register (edit) only; member → filtered directory, nothing extra.
  finance: { giving: 'edit', tuitionaid: 'edit', finance: 'edit', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' },
  staff:   { giving: 'none', tuitionaid: 'none', finance: 'none', attendance: 'edit', followups: 'edit', audit: 'view', register: 'edit', reports: 'view' },
  office:  { giving: 'none', tuitionaid: 'none', finance: 'none', attendance: 'none', followups: 'none', audit: 'none', register: 'edit', reports: 'none' },
  member:  { giving: 'none', tuitionaid: 'none', finance: 'none', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'none' },
};

function levelRank(l) { const i = ROLE_PERMISSION_LEVELS.indexOf(l); return i < 0 ? 0 : i; }
function clampLevel(level, maxLevel) {
  if (!ROLE_PERMISSION_LEVELS.includes(level)) return 'none';
  return levelRank(level) > levelRank(maxLevel) ? maxLevel : level;
}
function clampMemberRow(row) {
  const out = {};
  for (const item of ROLE_PERMISSION_ITEM_KEYS) {
    const ceil = MEMBER_ALLOWED_ITEMS[item];
    out[item] = ceil ? clampLevel(row[item], ceil) : 'none';
  }
  return out;
}

// A stored role object from before this change used boolean values keyed by the old coarse
// groups {finance,staff,register,reports}. Detect that shape (any boolean value) and map it
// forward to the granular tri-state model, preserving the old effective access (everything
// accessible was also editable, so old true → 'edit'; read-only groups → 'view').
function migrateLegacyRow(row) {
  const isLegacy = Object.values(row).some(v => typeof v === 'boolean');
  if (!isLegacy) return row;
  return {
    giving:     row.finance ? 'edit' : 'none',
    tuitionaid: row.finance ? 'edit' : 'none',
    finance:    row.finance ? 'edit' : 'none',
    attendance: row.staff ? 'edit' : 'none',
    followups:  row.staff ? 'edit' : 'none',
    audit:      row.staff ? 'view' : 'none',
    register:   row.register ? 'edit' : 'none',
    reports:    row.reports ? 'view' : 'none',
  };
}

// Pure — takes the raw stored JSON string (or null/undefined) and returns the full
// {finance:{...}, staff:{...}, office:{...}, member:{...}} matrix with every role/item
// defaulted and clamped, so a partially-edited, legacy, or missing config can never leave
// an item undefined or over-granted.
export function resolveRolePermissions(storedJson) {
  let overrides = {};
  if (storedJson) { try { overrides = JSON.parse(storedJson) || {}; } catch { overrides = {}; } }
  const result = {};
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
    const base = Object.assign({}, DEFAULT_ROLE_PERMISSIONS[role]);
    const ov = overrides[role];
    if (ov && typeof ov === 'object') {
      const migrated = migrateLegacyRow(ov);
      for (const item of ROLE_PERMISSION_ITEM_KEYS) {
        if (item in migrated) base[item] = clampLevel(migrated[item], ITEM_MAX_LEVEL[item]);
      }
    }
    result[role] = base;
  }
  result.member = clampMemberRow(result.member);
  return result;
}

export async function getRolePermissions(db) {
  const row = await db.prepare("SELECT value FROM chms_config WHERE key='role_permissions_json'").first();
  return resolveRolePermissions(row?.value);
}

// The per-item level map a given role actually gets, folding in admin's always-full-access.
// Returns { giving:'edit', ..., reports:'view' } — admin gets each item's ceiling, an
// unknown role gets all 'none'.
export function permissionsForRole(matrix, role) {
  const out = {};
  if (role === 'admin') {
    for (const item of ROLE_PERMISSION_ITEM_KEYS) out[item] = ITEM_MAX_LEVEL[item];
    return out;
  }
  const row = matrix[role] || {};
  for (const item of ROLE_PERMISSION_ITEM_KEYS) {
    out[item] = ROLE_PERMISSION_LEVELS.includes(row[item]) ? row[item] : 'none';
  }
  return out;
}

export function randHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function escLite(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Shared small-card page shell used by unauthenticated, token-driven single-form flows
// (password reset, Connect member invite setup).
export function authCardPage(title, bodyInner) {
  return html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${title} — Connect</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <style>:root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'DM Sans',sans-serif;background:var(--cream);display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .card{background:#fff;border-radius:16px;padding:2.5rem;max-width:380px;width:100%;box-shadow:0 4px 24px rgba(30,45,74,.12);}
      .wm-display{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:2.6rem;color:var(--navy);text-align:center;margin-bottom:.5rem;}
      .wm-sub{font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);text-align:center;margin-bottom:1.75rem;}
      .field{margin-bottom:1rem;} label{display:block;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.2em;color:var(--navy);margin-bottom:.4rem;}
      input{width:100%;padding:.7rem 1rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;font-size:.95rem;font-family:inherit;outline:none;}
      input:focus{border-color:var(--teal);}
      .btn{width:100%;background:var(--navy);color:#fff;border:none;padding:.85rem;border-radius:8px;font-size:1rem;font-weight:500;cursor:pointer;margin-top:.5rem;}
      .btn:hover{background:var(--teal);} .btn:disabled{opacity:.6;cursor:wait;}
      .msg{padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.9rem;}
      .msg.err{background:#fceae8;color:#c0392b;} .msg.ok{background:#e8f6ed;color:#1d6b3a;}
      a{color:var(--teal);font-size:.85rem;text-decoration:none;} a:hover{text-decoration:underline;}
    </style></head><body><div class="card">${bodyInner}</div></body></html>`);
}

// Disambiguate household display names when multiple households share the same name.
// "Smith Family" + "John" → "John Smith Family"; "Smith" + "John" → "John Smith"
export function disambiguateHHName(name, headFirst) {
  if (!headFirst) return name;
  const m = name.match(/^(.*?)\s*Family\s*$/i);
  return m ? (headFirst + ' ' + m[1].trim() + ' Family') : (headFirst + ' ' + name);
}

// Returns the ISO date string (YYYY-MM-DD) of the Monday of the current UTC week.
export function isoWeekKey() {
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun
  const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mon = new Date();
  mon.setUTCDate(mon.getUTCDate() + daysToMon);
  return mon.toISOString().slice(0, 10);
}

// ── CSV GIVING IMPORT HELPERS ─────────────────────────────────────────────────

// Parse Breeze fund strings into per-fund splits.
// Handles:
//   "40085 General Fund"
//   "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
//   "General Fund: $160.00, Tuition Aid: $40.00"
//   "" or "nan"  → General Fund
export function parseFundSplits(fundStr, totalCents) {
  const s = (fundStr || '').trim();
  if (!s || s.toLowerCase() === 'nan') return [{ name: 'General Fund', cents: totalCents }];
  // Breeze CSV format: starts with numeric fund ID prefix e.g. "40085 General Fund (160.00)"
  if (/^\d+\s/.test(s)) {
    const parts = s.split(/,\s*(?=\d)/);
    const splits = parts.map(p => {
      const m = p.trim().match(/^(.+?)(?:\s+\(([0-9.]+)\))?\s*$/);
      return m ? { name: m[1].trim(), cents: m[2] ? Math.round(parseFloat(m[2]) * 100) : null } : null;
    }).filter(Boolean);
    if (splits.length > 1) return splits.map(f => ({ name: f.name, cents: f.cents ?? 0 }));
    if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
  }
  // Colon format: "General Fund: $160.00, Tuition Aid: $40.00"
  if (/:\s*\$?[0-9]/.test(s)) {
    const parts = s.split(/,\s*(?=\S)/);
    const splits = [];
    for (const p of parts) {
      const m = p.trim().match(/^([^:]+?):\s*\$?([0-9.]+)\s*$/);
      if (m) splits.push({ name: m[1].trim(), cents: Math.round(parseFloat(m[2]) * 100) });
    }
    if (splits.length > 1) return splits;
    if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
  }
  return [{ name: s, cents: totalCents }];
}

// Compute the breeze_id / entry key for a CSV giving row.
//   splitIdx: 0-based index within a parseFundSplits multi-fund single row (-1 if not multi-fund)
//   nthOcc:   how many times this payment ID has appeared in the CSV so far (1-indexed)
export function givingEntryId(pid, nthOcc, splitIdx) {
  if (splitIdx >= 0) return pid + '-' + (splitIdx + 1);  // parseFundSplits multi-fund row
  return nthOcc === 1 ? pid : pid + '-' + nthOcc;         // Breeze per-fund multi-row
}

// Returns true if this giving row is already present in existingIds (dedup check).
export function isGivingDup(pid, nthOcc, existingIds) {
  return nthOcc === 1
    ? (existingIds.has(pid) || existingIds.has(pid + '-1'))
    : existingIds.has(pid + '-' + nthOcc);
}

// ── BOARD REPORT HELPERS ──────────────────────────────────────────────────
// Pure functions backing GET /admin/api/reports/giving-board. Kept out of the endpoint
// so they can be unit-tested without a DB (test/giving-board.test.js).

// Bucket a raw giving_entries.method value into the four board-report categories.
// Returns one of: 'check' | 'ach' | 'cash' | 'other'.
export function bucketGivingMethod(method) {
  const m = String(method || '').trim().toLowerCase();
  if (m === 'check' || m === 'cheque' || m === 'checks') return 'check';
  if (m === 'cash' || m === 'loose' || m === 'loose plate' || m === 'plate') return 'cash';
  if (m === 'ach' || m === 'online' || m === 'card' || m === 'credit' || m === 'credit card' ||
      m === 'debit' || m === 'eft' || m === 'bank' || m === 'auto' || m === 'recurring' ||
      m === 'paypal' || m === 'venmo' || m === 'zelle') return 'ach';
  // Everything else — stock, IRA, QCD, in-kind, gift-in-kind, blank, unknown — rolls up as "other".
  return 'other';
}

// Project a full-year total from year-to-date giving. When prior-year data covers the same
// window, extrapolate by the prior year's own seasonal shape ("if the second half behaves like
// last year's second half"); otherwise fall back to a straight-line estimate off Sundays elapsed
// (giving is a weekly rhythm, not a monthly one — YTD / Sundays-so-far * 52), or a month fraction
// when the caller has no Sunday count to give it. Returns { projected, method } where method is a
// human string naming which path was used, so the UI can state the projection method (a
// data-consistency rule from the handoff).
// Projects a full year from giving so far, on a WEEK basis rather than a month one.
//
// The month basis it replaced had a real flaw: it compared this year's giving through an
// in-progress month against last year's giving through that month COMPLETE, and counted the
// current month's not-yet-happened Sundays as elapsed. Both errors pull the same way, so on any
// date that isn't a month end the projection came out low — and a council report that quietly
// understates year-end giving is the wrong kind of wrong.
//
// The unit here is Sundays, not calendar weeks, because that is when this congregation actually
// gives. "Through 31 Sundays" against "last year's first 31 Sundays" is like-for-like in a way
// that "through July" against "through July" is not: the two Julys can hold four Sundays or five.
//
//   ytdCents            giving so far this year
//   priorSamePointCents last year's giving through the SAME NUMBER OF SUNDAYS (see nthSundayOfYear)
//   priorFullYearCents  last year's complete total
//   sundaysElapsed      Sundays from Jan 1 through the as-of date, inclusive
//   sundaysInYear       52 or 53, for this specific year
export function projectYearEnd(opts = {}) {
  const ytd = Math.max(0, Math.round(opts.ytdCents || 0));
  const total = Math.max(1, Math.round(opts.sundaysInYear || 52));
  const elapsed = Math.min(total, Math.max(0, Math.round(opts.sundaysElapsed || 0)));
  const basis = { sundays_elapsed: elapsed, sundays_in_year: total, sundays_remaining: total - elapsed };
  if (elapsed >= total) return { projected: ytd, method: 'actual', ...basis };
  if (elapsed <= 0) return { projected: ytd, method: 'actual', ...basis };
  const priorSame = Math.max(0, Math.round(opts.priorSamePointCents || 0));
  const priorFull = Math.max(0, Math.round(opts.priorFullYearCents || 0));
  // Seasonal: carry last year's remaining-weeks shape forward, scaled by how this year is
  // actually tracking against last year at the same point. Algebraically ytd x (full/same), which
  // is the same as ytd + (last year's remaining weeks) x (this year's pace vs last year's) — so a
  // year running behind is projected to stay behind rather than to catch up by December.
  if (priorSame > 0 && priorFull >= priorSame) {
    return { projected: Math.round(ytd * (priorFull / priorSame)), method: 'seasonal', ...basis };
  }
  // No usable prior year: this year's own average Sunday, carried across the ones left.
  return { projected: Math.round(ytd * (total / elapsed)), method: 'linear-weekly', ...basis };
}

// Total Sundays in a calendar year — 52, or 53 when the year starts on a Sunday (or on a Saturday
// in a leap year). Assuming 52 drops a real week of giving from the projection in those years.
export function sundaysInYear(year) {
  return sundaysElapsedThroughDate(year, year + '-12-31');
}
// Sundays from Jan 1 through asOf (inclusive). asOf is an ISO yyyy-mm-dd string.
export function sundaysElapsedThroughDate(year, asOfISO) {
  const end = Date.parse(String(asOfISO) + 'T00:00:00Z');
  if (!isFinite(end)) return 0;
  let t = Date.UTC(year, 0, 1);
  t += ((7 - new Date(t).getUTCDay()) % 7) * 86400000; // first Sunday on/after Jan 1
  let count = 0;
  while (t <= end) { count++; t += 7 * 86400000; }
  return count;
}
// The date of the nth Sunday of a year, as yyyy-mm-dd — the like-for-like upper bound for the
// prior-year comparison window. Past the last Sunday it returns Dec 31, so a full year stays full.
export function nthSundayOfYear(year, n) {
  const wanted = Math.max(1, Math.round(n || 1));
  let t = Date.UTC(year, 0, 1);
  t += ((7 - new Date(t).getUTCDay()) % 7) * 86400000;
  const at = t + (wanted - 1) * 7 * 86400000;
  const yearEnd = Date.UTC(year, 11, 31);
  return new Date(Math.min(at, yearEnd)).toISOString().slice(0, 10);
}
// The real as-of date for a selected reporting period: the end of the chosen month, or today if
// that month is still running. This is the value the whole week basis hangs off — passing the
// month end for an in-progress month is exactly the bug described above.
export function periodAsOfDate(year, throughMonth, now = new Date()) {
  const tm = Math.min(12, Math.max(1, Math.round(throughMonth || 12)));
  const monthEnd = new Date(Date.UTC(year, tm, 0)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return today < monthEnd ? today : monthEnd;
}
// How much of `throughMonth` has actually elapsed as of asOf, 0..1 — so a budget-to-date figure
// charges a part-month rather than the whole thing.
export function monthElapsedFraction(year, throughMonth, asOfISO) {
  const tm = Math.min(12, Math.max(1, Math.round(throughMonth || 12)));
  const daysInMonth = new Date(Date.UTC(year, tm, 0)).getUTCDate();
  const asOf = String(asOfISO || '');
  const m = asOf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 1;
  const asOfYear = +m[1], asOfMonth = +m[2], asOfDay = +m[3];
  if (asOfYear !== year || asOfMonth !== tm) return 1; // asOf is past this month — it's complete
  return Math.min(1, Math.max(0, asOfDay / daysInMonth));
}

// Spread an annual budget across the year and return the portion due through `throughMonth`.
// priorMonthly is a 12-element array (index 0 = Jan) of the prior year's actual monthly cents;
// when it sums to > 0 the budget follows that seasonal shape (so December carries its real share),
// otherwise it falls back to an even month/12 spread. Returns cents through the month.
// finalMonthFraction (0..1) is how much of `throughMonth` has actually elapsed. It defaults to 1
// (a completed month). Passing the real fraction is what stops a mid-month report from charging
// the congregation a whole month of budget it has not reached yet, and then reporting the
// resulting gap as a shortfall — the same partial-period error projectYearEnd used to make.
export function spreadBudgetYtd(annualCents, priorMonthly, throughMonth, finalMonthFraction = 1) {
  const annual = Math.max(0, Math.round(annualCents || 0));
  if (!annual) return 0;
  const tm = Math.min(12, Math.max(1, Math.round(throughMonth || 12)));
  const frac = Math.min(1, Math.max(0, Number(finalMonthFraction) == null ? 1 : Number(finalMonthFraction)));
  const monthly = Array.isArray(priorMonthly) ? priorMonthly : [];
  const priorTotal = monthly.reduce((s, v) => s + (Number(v) || 0), 0);
  if (priorTotal > 0) {
    let cum = 0;
    for (let i = 0; i < tm - 1 && i < 12; i++) cum += Number(monthly[i]) || 0;
    cum += (Number(monthly[tm - 1]) || 0) * frac;
    return Math.round(annual * (cum / priorTotal));
  }
  return Math.round(annual * ((tm - 1 + frac) / 12));
}

// Given an array of per-household total-cents figures, compute donor concentration:
// top-10 share, the count of households that make up half of all giving, and the four
// stacked-bar segments (Top 10 / Next 20 / Next 40 / everyone else). All shares are
// derived from the same sorted totals so the board figures can never disagree.
export function computeConcentration(householdTotals) {
  const totals = (householdTotals || []).map(v => Math.max(0, Math.round(Number(v) || 0)))
    .filter(v => v > 0).sort((a, b) => b - a);
  const n = totals.length;
  const grand = totals.reduce((s, v) => s + v, 0);
  const sumRange = (start, end) => {
    let s = 0;
    for (let i = start; i < end && i < n; i++) s += totals[i];
    return s;
  };
  const top10 = sumRange(0, 10);
  const next20 = sumRange(10, 30);
  const next40 = sumRange(30, 70);
  const rest = Math.max(0, grand - top10 - next20 - next40);
  const restCount = Math.max(0, n - 70);
  // households making up (at least) half of all giving
  let half = 0, acc = 0;
  const target = grand / 2;
  for (let i = 0; i < n; i++) { acc += totals[i]; half = i + 1; if (acc >= target) break; }
  const pct = (part) => grand > 0 ? Math.round((part / grand) * 100) : 0;
  return {
    households: n,
    grand_total_cents: grand,
    top10_cents: top10, top10_pct: pct(top10),
    half_households: grand > 0 ? half : 0,
    segments: [
      { key: 'top10',  label: 'Top 10',  count: Math.min(10, n),  cents: top10,  pct: pct(top10) },
      { key: 'next20', label: 'Next 20', count: Math.max(0, Math.min(20, n - 10)), cents: next20, pct: pct(next20) },
      { key: 'next40', label: 'Next 40', count: Math.max(0, Math.min(40, n - 30)), cents: next40, pct: pct(next40) },
      { key: 'rest',   label: 'Other ' + restCount, count: restCount, cents: rest, pct: pct(rest) },
    ],
  };
}

// ── FUND CATEGORIES (Reports fund lens) ────────────────────────────────────
// Every fund carries exactly one category. The board report's lens switches between them,
// and the council packet summarizes the ones that aren't the lens. Stored on funds.category
// (migration 0033) rather than derived from the fund's name, so a rename can't silently move
// money between categories mid-year.
export const FUND_CATEGORIES = [
  { key: 'general',    label: 'General Fund',            hh_label: 'Giving households' },
  { key: 'earned',     label: 'Earned income',           hh_label: 'Paying households' },
  { key: 'passive',    label: 'Passive income',          hh_label: 'Income sources' },
  { key: 'restricted', label: 'Restricted & designated', hh_label: 'Giving households' },
];
const FUND_CATEGORY_KEYS = new Set(FUND_CATEGORIES.map(c => c.key));

// Coerce any stored/submitted value to a real category key. Anything unrecognized (including
// '' on a fund that predates the column) reads as 'restricted' — the conservative default:
// a designated gift wrongly counted as General Fund would overstate the board's headline
// number, while the reverse only understates it.
export function normalizeFundCategory(value) {
  const v = String(value || '').trim().toLowerCase();
  return FUND_CATEGORY_KEYS.has(v) ? v : 'restricted';
}

export function fundCategoryLabel(key) {
  const c = FUND_CATEGORIES.find(x => x.key === normalizeFundCategory(key));
  return c ? c.label : 'Restricted & designated';
}

// The leading numeric account code on a fund name ("40085 General Fund" → "40085"), or null.
// Used only for the one-time backfill and the legacy General-Fund-family fallback.
export function fundNumericPrefix(name) {
  const m = String(name || '').match(/^(\d+)\s/);
  return m ? m[1] : null;
}

// One-time default categories for a set of existing funds, used by the 0033 backfill: every
// fund sharing the leading numeric code of the fund literally named "General Fund" becomes
// 'general' (matching what the board report already treated as the General Fund family);
// everything else stays 'restricted' for a human to sort out in Settings → Fund categories.
// Returns a Map of fund id → category for only the funds that should change.
export function defaultFundCategories(funds) {
  const rows = Array.isArray(funds) ? funds : [];
  const gen = rows.find(f => /general\s*fund/i.test(String(f.name || '')));
  const prefix = gen ? fundNumericPrefix(gen.name) : null;
  const out = new Map();
  for (const f of rows) {
    const isGeneral = gen && (prefix ? fundNumericPrefix(f.name) === prefix : f.id === gen.id);
    if (isGeneral) out.set(f.id, 'general');
  }
  return out;
}

// Which funds are the General Fund, as one rule shared by every page that needs to answer it.
// Primary source is funds.category (migration 0033, edited in Settings → Fund categories); the
// legacy fallback — every fund sharing the leading numeric code of the fund literally named
// "General Fund" — applies only on a database where nothing has been categorised 'general' yet,
// so the board's headline number doesn't read $0 until someone visits Settings.
//
// Extracted from the giving-board handler so the Financial Health page's giving-pace chart asks
// the same question the board report does. A second copy of this rule is the shape of bug where
// two screens quote different "General Fund giving" totals and both look right.
export function resolveGeneralFundIds(fundRows) {
  const rows = Array.isArray(fundRows) ? fundRows : [];
  const catOf = new Map(rows.map(f => [f.id, normalizeFundCategory(f.category)]));
  const genFundRow = rows.find(f => /general\s*fund/i.test(String(f.name || '')));
  const prefix = genFundRow ? fundNumericPrefix(genFundRow.name) : null;
  if (![...catOf.values()].includes('general')) {
    for (const f of rows) {
      if (prefix ? fundNumericPrefix(f.name) === prefix : (genFundRow && f.id === genFundRow.id)) catOf.set(f.id, 'general');
    }
  }
  return { catOf, prefix, ids: new Set(rows.filter(f => catOf.get(f.id) === 'general').map(f => f.id)) };
}

// One lens's worth of board report: every KPI, the chart arrays, the method mix and the
// concentration panel, all scoped to one fund category (or to all funds, for the "All giving"
// lens). Pure so the same math backs each of the five lens positions with no chance of one
// drifting from another — the whole point of the lens is that the four categories add up.
//
// budgetAnnualOverride: for the General Fund the council's real plan lives in Finance → Church
// Report (the "40085 Sunday Offering" account), not in a per-fund budget in Settings; pass it
// and it wins over the sum of the category's own fund budgets. null/undefined = use the funds.
export function buildBoardCategoryBlock(opts) {
  const {
    key, label, hhLabel, funds = [], curMonthly = [], priorMonthly = [],
    throughMonth = 12, sundaysElapsed = 0, sundaysInYear: yearSundays = 52,
    finalMonthFraction = 1, householdTotals = [], householdsPrior = 0,
    methodBuckets = {}, budgetAnnualOverride = null,
  } = opts || {};

  const ytd   = funds.reduce((s, f) => s + (f.actual_cents || 0), 0);
  const prior = funds.reduce((s, f) => s + (f.prior_cents || 0), 0);
  const fundBudgetAnnual = funds.reduce((s, f) => s + (f.annual_budget_cents || 0), 0);
  const annualBudget = (budgetAnnualOverride != null && budgetAnnualOverride > 0)
    ? budgetAnnualOverride
    : (fundBudgetAnnual > 0 ? fundBudgetAnnual : null);

  const priorFull = priorMonthly.reduce((s, v) => s + (v || 0), 0);
  // `prior` is this category's giving through the SAME NUMBER OF SUNDAYS last year (the fund query
  // that produced these rows is bound to that date), so it is the like-for-like comparison point —
  // unlike a whole-month slice of the monthly chart array, which was what this used to take.
  const proj = projectYearEnd({
    ytdCents: ytd, priorSamePointCents: prior, priorFullYearCents: priorFull,
    sundaysElapsed, sundaysInYear: yearSundays,
  });

  const budgetYtd = annualBudget != null ? spreadBudgetYtd(annualBudget, priorMonthly, throughMonth, finalMonthFraction) : null;
  const variance  = budgetYtd != null ? ytd - budgetYtd : null;

  const concentration = computeConcentration(householdTotals);
  const households = concentration.households;

  const methodTotal = ['check', 'ach', 'cash', 'other'].reduce((s, k) => s + (methodBuckets[k] || 0), 0);
  const methodMix = [
    { key: 'check', label: 'Check',              cents: methodBuckets.check || 0 },
    { key: 'ach',   label: 'ACH / online',       cents: methodBuckets.ach || 0 },
    { key: 'cash',  label: 'Cash / loose plate', cents: methodBuckets.cash || 0 },
    { key: 'other', label: 'Stock, IRA, other',  cents: methodBuckets.other || 0 },
  ].map(x => ({ ...x, pct: methodTotal > 0 ? Math.round((x.cents / methodTotal) * 100) : 0 }));

  return {
    key, label, hh_label: hhLabel,
    fund_count: funds.length,
    funds,
    given_ytd_cents: ytd,
    given_ytd_prior_cents: prior,
    prior_ytd_fund_cents: prior,
    given_ytd_delta_pct: prior > 0 ? +(((ytd - prior) / prior) * 100).toFixed(1) : null,
    annual_budget_cents: annualBudget,
    budget_ytd_cents: budgetYtd,
    budget_variance_cents: variance,
    budget_variance_pct: (budgetYtd != null && budgetYtd > 0) ? +(((ytd - budgetYtd) / budgetYtd) * 100).toFixed(1) : null,
    has_budget: annualBudget != null && annualBudget > 0,
    projection_cents: proj.projected,
    projection_method: proj.method,
    sundays_elapsed: proj.sundays_elapsed,
    sundays_in_year: proj.sundays_in_year,
    sundays_remaining: proj.sundays_remaining,
    projection_vs_budget_cents: annualBudget != null ? proj.projected - annualBudget : null,
    households,
    households_prior: householdsPrior,
    avg_per_household_cents: households > 0 ? Math.round(ytd / households) : 0,
    monthly: { current: curMonthly, prior: priorMonthly },
    method_mix: methodMix,
    concentration,
  };
}

// ── GIVING PLATEAUS / NUDGE OPTIONS ────────────────────────────────────────
// Three increase options (Modest/Standard/Generous), each a genuinely FIXED,
// familiar round number — not a percentage-derived figure. The ladder below
// starts with the same hand-picked round numbers as the original design
// (10, 15, 20 … 1000, validated against real asks: 43→50, 83→100) and then
// DENSIFIES from $1,000 up — $100 steps to $5,000, $250 to $10,000, $500 to
// $25,000, $1,000 above — so the "next rung" stays a modest ask even at high
// giving levels, without ever landing on an odd non-round number the way a
// percentage-scaled target could.
const GIVING_NUDGE_LADDER = (() => {
  const ladder = [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000];
  for (let v = 1100; v <= 5000; v += 100) ladder.push(v);
  for (let v = 5250; v <= 10000; v += 250) ladder.push(v);
  for (let v = 10500; v <= 25000; v += 500) ladder.push(v);
  for (let v = 26000; v <= 50000; v += 1000) ladder.push(v);
  return ladder;
})();
export const NUDGE_OPTION_LABELS = ['Modest', 'Standard', 'Generous'];

// Returns the next 3 ladder rungs strictly above `baseDollars`, e.g. for
// base=43: Modest $50, Standard $60, Generous $75 — the same "43→50" a
// board member would recognize, plus two clearly bigger (but still round)
// asks. For base=2500: $2,600 / $2,700 / $2,800 — gentle at the top because
// the ladder itself is dense there, not because of any percentage formula.
export function computeNudgeOptions(baseDollars) {
  const base = Math.max(0, Number(baseDollars) || 0);
  if (base <= 0) return [];
  const above = [];
  for (const rung of GIVING_NUDGE_LADDER) {
    if (rung > base) { above.push(rung); if (above.length === 3) break; }
  }
  // Base is beyond the ladder's top (an unusually large weekly-equivalent
  // giver) — extend in flat $1,000 steps rather than leave options short.
  while (above.length < 3) {
    const last = above.length ? above[above.length - 1] : Math.max(base, GIVING_NUDGE_LADDER[GIVING_NUDGE_LADDER.length - 1]);
    above.push(last + 1000);
  }
  return above.map((target, i) => ({
    label: NUDGE_OPTION_LABELS[i],
    target_dollars: target,
    delta_dollars: target - base,
    pct_increase: Math.round(((target - base) / base) * 1000) / 10,
  }));
}

// Admin-configured "if you gave $X more a month, that could provide Y"
// statements — [{ monthly_cents, label }], e.g. { monthly_cents: 1800,
// label: "one more week of Tuition Aid support" }. Picks the richest
// statement the giver's monthly increase actually clears (largest threshold
// <= the delta); returns null rather than guessing when nothing qualifies or
// none are configured — this app never fabricates ministry-cost figures. The
// plain annualized dollar amount (computed alongside this, not by it) is
// always shown regardless, so every increase — even a modest one — is tied
// to a concrete number even when no custom phrase is configured.
export function pickImpactPhrase(monthlyDeltaCents, statements) {
  if (!Array.isArray(statements) || !statements.length) return null;
  const sorted = statements
    .filter(s => s && Number(s.monthly_cents) > 0 && s.label)
    .slice().sort((a, b) => a.monthly_cents - b.monthly_cents);
  let best = null;
  for (const s of sorted) {
    if (monthlyDeltaCents >= s.monthly_cents) best = s; else break;
  }
  return best ? best.label : null;
}

// Given one row per giver — { person_id, name, link_id, link_kind,
// total_cents, gifts } where total_cents is EVERY gift they made in the
// period, across EVERY fund (no fund discounted) — this gives every giver a
// single "weekly-equivalent" figure: their total ÷ periodsElapsed (default
// 52, i.e. their whole year's giving spread evenly across the year). This
// applies uniformly whether someone gives every Sunday, once a month, or as
// a single stock/IRA (QCD) transfer in December — a one-time $2,600 gift and
// 52 weekly $50 gifts both read as "$50/wk" here, so nobody (including
// occasional/major givers, who previously fell into a separate "variable"
// bucket) is silently excluded from a nudge. `gifts` (their actual count of
// distinct contributions) is carried through so the UI can still frame an
// infrequent giver's ask narratively ("you gave $X last year — about $Y/wk")
// rather than implying they should literally write 52 checks.
// ── Shared giver-rows query for the plateau analysis ──────────────────────
// One row per giver with their whole-year total and gift count. Used by BOTH
// reports/giving-plateaus (the analysis) and giving/nudges/status (the letters built from it) —
// shared rather than copied, because two versions of this query drifting apart would mean the
// letter quietly addressing a different set of people than the report you approved.
//
// In household scope the "giver" is the household, so spouses' gifts combine; givers with no
// household stand alone as link_kind='person'.
export function plateauWeeksElapsed(year, now = new Date()) {
  if (year !== now.getUTCFullYear()) return 52;
  const days = Math.floor((now.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1;
  return Math.max(1, Math.min(52, Math.ceil(days / 7)));
}
export async function fetchGivingPlateauRows(db, { year, scope, fundId }) {
  const start = year + '-01-01', end = year + '-12-31';
  const effDate = "COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date)";
  const fundClause = fundId ? ' AND ge.fund_id = ?' : '';
  const fundBind = fundId ? [fundId] : [];
  // Same automatic/recurring method set as bucketGivingMethod()'s 'ach' bucket — used only to
  // flag whether a low-frequency giver already gives via some form of autopay.
  const autoMethodClause = "LOWER(ge.method) IN ('ach','online','card','credit','credit card','debit','eft','bank','auto','recurring','paypal','venmo','zelle')";
  if (scope === 'household') {
    const housed = "p.household_id IS NOT NULL AND p.household_id != 0";
    // Group key as an expression (NOT aliased "person_id" — that would collide with the
    // ge.person_id column and SQLite would group by the person, not the household, so spouses'
    // gifts wouldn't merge).
    const keyExpr = `CASE WHEN ${housed} THEN 'h:' || p.household_id ELSE 'p:' || p.id END`;
    return (await db.prepare(
      `SELECT ${keyExpr} AS person_id,
              CASE WHEN ${housed}
                   THEN COALESCE(NULLIF(h.name,''),
                        (SELECT hp.last_name || ' Household' FROM people hp
                          WHERE hp.household_id = p.household_id AND hp.last_name != '' LIMIT 1),
                        'Household #' || p.household_id)
                   ELSE (p.first_name || ' ' || p.last_name) END AS name,
              CASE WHEN ${housed} THEN p.household_id ELSE p.id END AS link_id,
              CASE WHEN ${housed} THEN 'household' ELSE 'person' END AS link_kind,
              SUM(ge.amount) AS total_cents,
              COUNT(*) AS gifts,
              SUM(CASE WHEN ${autoMethodClause} THEN 1 ELSE 0 END) AS auto_gifts
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       JOIN people p ON p.id = ge.person_id
       LEFT JOIN households h ON h.id = p.household_id
       WHERE ${effDate} >= ? AND ${effDate} <= ?
         AND ge.person_id IS NOT NULL
         AND LOWER(COALESCE(p.member_type,'')) != 'organization'${fundClause}
       GROUP BY ${keyExpr}`
    ).bind(start, end, ...fundBind).all()).results || [];
  }
  return (await db.prepare(
    `SELECT ge.person_id AS person_id,
            (p.first_name || ' ' || p.last_name) AS name,
            p.id AS link_id, 'person' AS link_kind,
            SUM(ge.amount) AS total_cents,
            COUNT(*) AS gifts,
            SUM(CASE WHEN ${autoMethodClause} THEN 1 ELSE 0 END) AS auto_gifts
     FROM giving_entries ge
     JOIN giving_batches gb ON gb.id = ge.batch_id
     JOIN people p ON p.id = ge.person_id
     WHERE ${effDate} >= ? AND ${effDate} <= ?
       AND ge.person_id IS NOT NULL
       AND LOWER(COALESCE(p.member_type,'')) != 'organization'${fundClause}
     GROUP BY ge.person_id`
  ).bind(start, end, ...fundBind).all()).results || [];
}

// ── Giving cadence ────────────────────────────────────────────────────────
// The plateau analysis deliberately normalises everyone to a weekly-equivalent figure, so a
// weekly regular, a monthly giver and a single annual gift are all comparable. That is right for
// the ANALYSIS and wrong for the LETTER: telling someone who writes one cheque a month that they
// "give $43 a week" reads as though we haven't looked at their record. So each giver also carries
// the rhythm they actually give in, and every figure shown to them is expressed in it.
//
// Classified on gifts-per-year annualised from the elapsed window, not raw count, so a giver
// analysed halfway through a year isn't mistaken for a less frequent one.
export const GIVING_CADENCES = [
  { key: 'weekly',    label: 'Weekly',      adverb: 'a week',    periodsPerYear: 52, minAnnualGifts: 30 },
  { key: 'monthly',   label: 'Monthly',     adverb: 'a month',   periodsPerYear: 12, minAnnualGifts: 9 },
  { key: 'quarterly', label: 'Quarterly',   adverb: 'a quarter', periodsPerYear: 4,  minAnnualGifts: 3 },
  { key: 'occasional',label: 'Occasional',  adverb: 'a year',    periodsPerYear: 1,  minAnnualGifts: 2 },
  { key: 'annual',    label: 'Once a year', adverb: 'a year',    periodsPerYear: 1,  minAnnualGifts: 0 },
];
export function classifyGivingCadence(gifts, periodsElapsed) {
  const weeks = Math.max(1, Math.min(52, Number(periodsElapsed) || 52));
  const n = Math.max(0, Math.round(Number(gifts) || 0));
  const annualGifts = n * (52 / weeks);
  for (const c of GIVING_CADENCES) {
    if (annualGifts >= c.minAnnualGifts) return c;
  }
  return GIVING_CADENCES[GIVING_CADENCES.length - 1];
}
// An ANNUAL figure restated in the giver's own rhythm, rounded to whole dollars in that rhythm —
// so a monthly giver is nudged from $185 to $215, not to $214.67.
//
// Deliberately takes the annual figure, not the weekly-equivalent one. Going via the weekly figure
// rounds twice, and the error is not academic: someone giving exactly $200 a month is $2,400/yr,
// which is $46.15/wk, which rounds to $46/wk, which comes back out as $199 a month. A letter that
// tells a giver they give $199 a month when they give $200 reads as though nobody looked at their
// record — the exact failure the whole cadence idea exists to avoid.
export function cadenceAmountCents(annualCents, periodsPerYear) {
  const per = Math.max(1, Number(periodsPerYear) || 1);
  return Math.round((Number(annualCents) || 0) / per / 100) * 100;
}
export function computeGivingPlateaus(rows, opts = {}) {
  const periodsElapsed = Math.max(1, Math.min(52, opts.periodsElapsed || 52));
  const peopleCap = opts.peopleCap || 500;
  const impactStatements = opts.impactStatements || [];
  const lowFrequencyMax = opts.lowFrequencyMax || 3;

  const byPerson = new Map();
  for (const r of rows || []) {
    const pid = r.person_id;
    if (pid == null) continue;
    const cents = Math.round(Number(r.total_cents) || 0);
    if (cents <= 0) continue;
    byPerson.set(pid, {
      id: pid, name: r.name || '',
      // Where a row in this tier should link. Defaults to the person; the
      // household-scope caller passes link_kind='household' + a household id.
      link_id: r.link_id != null ? r.link_id : pid,
      link_kind: r.link_kind || 'person',
      total_cents: cents,
      gifts: Math.max(0, Math.round(Number(r.gifts) || 0)),
      // Gifts recorded under an automatic/recurring method (ACH, card, auto-
      // draft, etc. — see bucketGivingMethod) — used only to flag whether a
      // low-frequency giver is already on some form of autopay.
      auto_gifts: Math.max(0, Math.round(Number(r.auto_gifts) || 0)),
    });
  }

  const givers = [];
  for (const p of byPerson.values()) {
    const weeklyDollars = Math.round(p.total_cents / periodsElapsed / 100);
    if (weeklyDollars <= 0) continue;
    const weeklyCents = weeklyDollars * 100;
    const cadence = classifyGivingCadence(p.gifts, periodsElapsed);
    // Annualised from the elapsed window so a part-year figure isn't reported as a full year's
    // giving, and taken from the raw total rather than the rounded weekly figure (see
    // cadenceAmountCents). This is the number the giver themselves would recognise.
    const annualisedCents = Math.round(p.total_cents * 52 / periodsElapsed);
    const cadenceNowCents = cadenceAmountCents(annualisedCents, cadence.periodsPerYear);
    const options = computeNudgeOptions(weeklyDollars).map(o => {
      const deltaCents = o.delta_dollars * 100;
      const annualDeltaCents = deltaCents * 52;
      const monthlyDeltaCents = Math.round(deltaCents * 52 / 12);
      const targetCents = o.target_dollars * 100;
      // The same option restated in the giver's own rhythm — what the letter actually says. The
      // delta is the difference of the two ROUNDED cadence figures, not the rounded weekly delta
      // rescaled, so "from $185 to $215" always reads as exactly +$30 rather than +$29.67. The
      // annual figure is then rebuilt FROM that delta, so every number in one letter reconciles
      // against the others — "+$30 a month" and "about $360 over a year" can never disagree.
      const cadenceTargetCents = cadenceAmountCents(targetCents * 52, cadence.periodsPerYear);
      const cadenceDeltaCents = cadenceTargetCents - cadenceNowCents;
      return {
        label: o.label,
        target_cents: targetCents,
        delta_cents: deltaCents,
        pct_increase: o.pct_increase,
        // Always a concrete annual dollar figure — the baseline "impact" —
        // whether or not a custom ministry phrase is configured below.
        annual_delta_cents: annualDeltaCents,
        new_annual_total_cents: o.target_dollars * 100 * 52,
        impact_text: pickImpactPhrase(monthlyDeltaCents, impactStatements),
        cadence_target_cents: cadenceTargetCents,
        cadence_delta_cents: cadenceDeltaCents,
        cadence_annual_delta_cents: cadenceDeltaCents * cadence.periodsPerYear,
      };
    });
    const standard = options[1] || options[options.length - 1];
    givers.push({
      id: p.id, name: p.name,
      link_id: p.link_id, link_kind: p.link_kind,
      weekly_cents: weeklyCents,
      total_cents: p.total_cents,
      gifts: p.gifts,
      // The rhythm this giver actually gives in, and their current level expressed in it — what
      // a letter addressed to them should say instead of the weekly-equivalent figure.
      cadence: cadence.key,
      cadence_label: cadence.label,
      cadence_adverb: cadence.adverb,
      cadence_periods_per_year: cadence.periodsPerYear,
      cadence_amount_cents: cadenceNowCents,
      low_frequency: p.gifts > 0 && p.gifts <= lowFrequencyMax,
      all_manual_methods: p.gifts > 0 && p.auto_gifts === 0,
      options,
      // Backward-compatible "primary" fields — the Standard option — used
      // for tier grouping and the summary headline.
      target_cents: standard ? standard.target_cents : weeklyCents,
      weekly_increase_cents: standard ? standard.delta_cents : 0,
      upside_annual_cents: standard ? standard.annual_delta_cents : 0,
    });
  }

  // Fine histogram: how many givers land at each weekly-equivalent dollar amount.
  const distMap = new Map();
  for (const g of givers) {
    const d = g.weekly_cents / 100;
    distMap.set(d, (distMap.get(d) || 0) + 1);
  }
  const distribution = [...distMap.entries()]
    .map(([plateau_dollars, n]) => ({ plateau_dollars, n }))
    .sort((a, b) => a.plateau_dollars - b.plateau_dollars);

  // Tiers grouped by the Standard option's target.
  const tierMap = new Map();
  for (const g of givers) {
    let t = tierMap.get(g.target_cents);
    if (!t) {
      t = { target_cents: g.target_cents, people: [], num_people: 0,
            upside_annual_cents: 0, upside_modest_annual_cents: 0, upside_generous_annual_cents: 0,
            plateau_min_cents: Infinity, plateau_max_cents: 0, sum_plateau_cents: 0, sum_weekly_inc: 0 };
      tierMap.set(g.target_cents, t);
    }
    t.people.push(g);
    t.num_people++;
    t.upside_annual_cents += g.upside_annual_cents;
    t.upside_modest_annual_cents += (g.options[0] || g.options[g.options.length - 1]).annual_delta_cents;
    t.upside_generous_annual_cents += (g.options[g.options.length - 1]).annual_delta_cents;
    t.plateau_min_cents = Math.min(t.plateau_min_cents, g.weekly_cents);
    t.plateau_max_cents = Math.max(t.plateau_max_cents, g.weekly_cents);
    t.sum_plateau_cents += g.weekly_cents;
    t.sum_weekly_inc += g.weekly_increase_cents;
  }
  const tiers = [...tierMap.values()].map(t => {
    t.people.sort((a, b) => b.upside_annual_cents - a.upside_annual_cents);
    return {
      target_cents: t.target_cents,
      num_people: t.num_people,
      plateau_min_cents: t.plateau_min_cents === Infinity ? 0 : t.plateau_min_cents,
      plateau_max_cents: t.plateau_max_cents,
      avg_plateau_cents: t.num_people ? Math.round(t.sum_plateau_cents / t.num_people) : 0,
      avg_weekly_increase_cents: t.num_people ? Math.round(t.sum_weekly_inc / t.num_people) : 0,
      upside_annual_cents: t.upside_annual_cents,
      upside_modest_annual_cents: t.upside_modest_annual_cents,
      upside_generous_annual_cents: t.upside_generous_annual_cents,
      people: t.people.slice(0, peopleCap),
    };
  }).sort((a, b) => a.target_cents - b.target_cents);

  // Low-frequency givers — a dedicated, staff-facing list (not a correction
  // list; nobody here needs to change anything). Sorted by total given, so a
  // one-time LARGE gift (e.g. stock/IRA transfer) surfaces at the top, not
  // buried under smaller occasional givers. Still included in `tiers` above
  // like everyone else — this is a convenience view for spotting who gives
  // occasionally, e.g. as a starting point for someone who might want to ask
  // about setting up recurring/automatic giving, never a suggestion that an
  // occasional or one-time giver is doing something that needs fixing.
  const lowFrequencyGivers = givers
    .filter(g => g.low_frequency)
    .map(g => ({
      id: g.id, name: g.name, link_id: g.link_id, link_kind: g.link_kind,
      total_cents: g.total_cents, gifts: g.gifts,
      avg_gift_cents: g.gifts ? Math.round(g.total_cents / g.gifts) : 0,
      all_manual_methods: g.all_manual_methods,
    }))
    .sort((a, b) => b.total_cents - a.total_cents)
    .slice(0, peopleCap);

  return {
    summary: {
      total_givers: givers.length,
      low_frequency_givers: givers.filter(g => g.low_frequency).length,
      total_weekly_cents: givers.reduce((s, g) => s + g.weekly_cents, 0),
      total_upside_annual_cents: givers.reduce((s, g) => s + g.upside_annual_cents, 0),
      total_upside_modest_annual_cents: tiers.reduce((s, t) => s + t.upside_modest_annual_cents, 0),
      total_upside_generous_annual_cents: tiers.reduce((s, t) => s + t.upside_generous_annual_cents, 0),
    },
    tiers,
    distribution,
    low_frequency_givers_list: lowFrequencyGivers,
    // The flat per-giver list behind every tier. The report doesn't serialize this (it renders
    // from `tiers`, and shipping every giver twice would double a 500-person payload) — it exists
    // for giving/nudges/status, which needs one row per person to address a letter to.
    givers,
  };
}

// ── GIVING BANDS (weekly/monthly distribution + flat uplift) ──────────────
// Band floors in cents. A giver's per-period figure = their giving in the
// period ÷ periods elapsed (frequency-agnostic — a monthly giver still lands
// in the right weekly band). Two floor sets so the bands read naturally in
// whichever cadence is chosen. Open-ended top band (high = null).
export const GIVING_BAND_FLOORS_WEEKLY_CENTS  = [0, 2500, 5000, 7500, 10000, 15000, 20000, 30000, 50000];
export const GIVING_BAND_FLOORS_MONTHLY_CENTS = [0, 10000, 20000, 30000, 40000, 60000, 80000, 120000, 200000];

// rows: [{ total_cents }] one row per giver (household or person) with their
// TOTAL giving over the period. opts:
//   freq            'weekly' | 'monthly'
//   periodsElapsed  weeks/months of giving so far (52/12 for a complete past
//                   year; fewer for the current in-progress year) — used to
//                   turn a total into a current per-period pace.
//   upliftCents     a flat per-period increase to model ("+$10/wk") — its
//                   annual impact uses a FULL year (52/12), not elapsed, since
//                   it's a going-forward change.
export function computeGivingBands(rows, opts = {}) {
  const freq = opts.freq === 'monthly' ? 'monthly' : 'weekly';
  const periodsPerYear = freq === 'monthly' ? 12 : 52;
  const periodsElapsed = Math.max(1, Math.min(periodsPerYear, opts.periodsElapsed || periodsPerYear));
  const upliftCents = Math.max(0, Math.round(opts.upliftCents || 0));
  const floors = freq === 'monthly' ? GIVING_BAND_FLOORS_MONTHLY_CENTS : GIVING_BAND_FLOORS_WEEKLY_CENTS;

  const bands = floors.map((low, i) => ({
    low_cents: low,
    high_cents: i + 1 < floors.length ? floors[i + 1] : null,
    n: 0, total_cents: 0, per_period_sum_cents: 0,
  }));
  let givers = 0, totalCents = 0, perPeriodSum = 0;
  for (const r of rows || []) {
    const total = Number(r.total_cents) || 0;
    if (total <= 0) continue;
    const perPeriod = total / periodsElapsed;
    givers++; totalCents += total; perPeriodSum += perPeriod;
    let bi = 0;
    for (let i = 0; i < bands.length; i++) {
      if (perPeriod >= bands[i].low_cents && (bands[i].high_cents == null || perPeriod < bands[i].high_cents)) { bi = i; break; }
    }
    const b = bands[bi];
    b.n++; b.total_cents += total; b.per_period_sum_cents += perPeriod;
  }
  const bandOut = bands.map(b => ({
    low_cents: b.low_cents,
    high_cents: b.high_cents,
    n: b.n,
    total_cents: Math.round(b.total_cents),
    avg_per_period_cents: b.n ? Math.round(b.per_period_sum_cents / b.n) : 0,
    current_annualized_cents: Math.round(b.per_period_sum_cents * periodsPerYear),
    uplift_annual_cents: b.n * upliftCents * periodsPerYear,
  }));
  return {
    freq, periods_elapsed: periodsElapsed, periods_per_year: periodsPerYear,
    uplift_cents: upliftCents,
    summary: {
      givers,
      total_cents: Math.round(totalCents),
      current_annualized_cents: Math.round(perPeriodSum * periodsPerYear),
      uplift_annual_cents: givers * upliftCents * periodsPerYear,
    },
    bands: bandOut,
  };
}

// ── Breeze fee-field probe (native giving, does-Breeze-hand-us-the-fee) ────────
// Pure. Given one sample record from Breeze's giving/list (or an audit-log entry),
// report its top-level keys and flag any that look like a processor fee / net / deposit /
// payout field — plus the same scan of a nested funds[] entry (fees can be per-fund). Turns
// the raw diagnostic dump into a plain yes/no on "does the Breeze API carry the fee?".
const FEE_FIELD_RE = /fee|net|processor|deposit|payout|gross|charge/i;
export function scanForFeeFields(sample) {
  const out = { top_keys: [], top_flagged: [], fund_keys: [], fund_flagged: [] };
  if (!sample || typeof sample !== 'object') return out;
  out.top_keys = Object.keys(sample);
  for (const k of out.top_keys) {
    if (FEE_FIELD_RE.test(k)) out.top_flagged.push({ key: k, value: sample[k] });
  }
  const funds = sample.funds || sample.fund;
  const f0 = Array.isArray(funds) ? funds[0] : null;
  if (f0 && typeof f0 === 'object') {
    out.fund_keys = Object.keys(f0);
    for (const k of out.fund_keys) {
      if (FEE_FIELD_RE.test(k)) out.fund_flagged.push({ key: k, value: f0[k] });
    }
  }
  out.fee_field_found = out.top_flagged.length > 0 || out.fund_flagged.length > 0;
  return out;
}

// ── Giving deposits: reconciliation (GIV-DEP, native giving Phase 1) ───────────
// Pure. Roll up a deposit's assigned gifts. gross = what donors gave, fee = processor fees,
// net = what actually reaches the bank (gross - fee). `bankCents` (if provided) is the amount
// actually seen in the bank; variance = bank - net (should be 0 when reconciled; a non-zero
// variance is surfaced, never silently absorbed).
export function computeDepositTotals(gifts, bankCents) {
  let gross = 0, fee = 0, count = 0;
  for (const g of gifts || []) {
    gross += Number(g.amount) || 0;
    fee   += Number(g.fee_cents) || 0;
    count += 1;
  }
  const net = gross - fee;
  const out = { count, gross_cents: gross, fee_cents: fee, net_cents: net };
  if (bankCents != null && bankCents !== '') {
    out.bank_cents = Number(bankCents) || 0;
    out.variance_cents = out.bank_cents - net; // + = bank has more than expected, - = short
    out.balanced = out.variance_cents === 0;
  }
  return out;
}

// ── Batch ↔ deposit coverage (Offerings tab) ──────────────────────────────────
// Derives the one status a counted batch carries in the Offerings list — the piece of state
// that makes the count sheet and the bank slip impossible to drift apart. Nothing is stored:
// the badge is always recomputed from the batch total and its deposit lines, so editing a line
// amount or entering a bank figure moves the badge with no separate bookkeeping step.
//
// links: [{ deposit_id, amount_cents, bank_cents }] — bank_cents null/undefined = not yet
// reconciled against the bank statement.
export function batchDepositStatus(batchTotalCents, links) {
  const rows = Array.isArray(links) ? links : [];
  const linked = rows.reduce((s, l) => s + (Math.round(Number(l.amount_cents) || 0)), 0);
  const unreconciled = rows.filter(l => l.bank_cents === null || l.bank_cents === undefined || l.bank_cents === '').length;
  return batchDepositStatusFromCounts(batchTotalCents, linked, rows.length, unreconciled);
}

// Same derivation from pre-aggregated counts, so the batch LIST can badge 100 rows without
// fetching every row's individual deposit links.
export function batchDepositStatusFromCounts(batchTotalCents, linkedCents, depositCount, unreconciledCount) {
  const total = Math.max(0, Math.round(Number(batchTotalCents) || 0));
  const linked = Math.round(Number(linkedCents) || 0);
  const nLinks = Math.max(0, Math.round(Number(depositCount) || 0));
  const nUnrec = Math.max(0, Math.round(Number(unreconciledCount) || 0));
  const remaining = total - linked;
  if (!nLinks) {
    return { key: 'needs_deposit', tone: 'warn', label: 'Needs deposit', linked_cents: 0, remaining_cents: total };
  }
  // A rounding-scale tolerance: 50c of slack keeps a hand-split batch from reading "Split · $0"
  // forever because two halves of an odd cent total don't add back exactly.
  if (remaining > 50) {
    return { key: 'split', tone: 'warn', label: 'Split', linked_cents: linked, remaining_cents: remaining };
  }
  if (nUnrec > 0) {
    return { key: 'unreconciled', tone: 'bad', label: 'Unreconciled', linked_cents: linked, remaining_cents: Math.max(0, remaining) };
  }
  return { key: 'deposited', tone: 'ok', label: 'Deposited', linked_cents: linked, remaining_cents: Math.max(0, remaining) };
}

// ── Giving distribution analysis (GIV-R3 / 2A) ────────────────────────────────
// Annual-total tiers a giver's full-year contribution falls into. Dollar figures
// (converted to cents) — chosen to be legible on a board slide, not statistically
// optimal. low inclusive, high exclusive (null = open-ended top tier).
export const GIVING_TIER_FLOORS_CENTS = [
  0, 10000, 50000, 100000, 250000, 500000, 1000000, 2500000,
]; // $0, $100, $500, $1k, $2.5k, $5k, $10k, $25k+

function tierLabel(lowCents, highCents) {
  const d = c => '$' + Math.round(c / 100).toLocaleString('en-US');
  if (highCents == null) return d(lowCents) + '+';
  if (lowCents === 0) return 'Under ' + d(highCents);
  return d(lowCents) + '–' + d(highCents - 1);
}

// Pure. Given an array of per-giver annual totals (rows with total_cents), return
// distribution stats a board actually asks about: how many givers, mean vs median
// (the median is the honest "typical gift" when a few large gifts pull the mean up),
// what share the top 10% of givers contribute, and a tier table. No individuals named.
export function computeGivingDistribution(rows) {
  const totals = (rows || [])
    .map(r => Number(r.total_cents) || 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  const count = totals.length;
  const totalCents = totals.reduce((s, v) => s + v, 0);
  const mean = count ? Math.round(totalCents / count) : 0;
  let median = 0;
  if (count) {
    const mid = Math.floor(count / 2);
    median = count % 2 ? totals[mid] : Math.round((totals[mid - 1] + totals[mid]) / 2);
  }
  // Share of the total given by the top 10% of givers (min 1 giver).
  const topN = count ? Math.max(1, Math.round(count * 0.1)) : 0;
  const topCents = totals.slice(count - topN).reduce((s, v) => s + v, 0);
  const top10SharePct = totalCents ? Math.round((topCents / totalCents) * 1000) / 10 : 0;

  const floors = GIVING_TIER_FLOORS_CENTS;
  const tiers = floors.map((low, i) => {
    const high = i + 1 < floors.length ? floors[i + 1] : null;
    return { low_cents: low, high_cents: high, label: tierLabel(low, high), givers: 0, total_cents: 0 };
  });
  for (const v of totals) {
    let ti = 0;
    for (let i = 0; i < tiers.length; i++) {
      if (v >= tiers[i].low_cents && (tiers[i].high_cents == null || v < tiers[i].high_cents)) { ti = i; break; }
    }
    tiers[ti].givers++;
    tiers[ti].total_cents += v;
  }
  const tierOut = tiers.map(t => ({
    ...t,
    givers_pct: count ? Math.round((t.givers / count) * 1000) / 10 : 0,
    total_pct: totalCents ? Math.round((t.total_cents / totalCents) * 1000) / 10 : 0,
  }));
  return {
    givers: count,
    total_cents: totalCents,
    mean_cents: mean,
    median_cents: median,
    top10_givers: topN,
    top10_share_pct: top10SharePct,
    tiers: tierOut,
  };
}

// ── Envelope numbers (GIV-R4 / B) ─────────────────────────────────────────────
// Envelope numbers are reassigned yearly, but old envelopes stay in circulation, so a
// superseded number must still resolve to its person. This keeps a most-recent-first,
// de-duplicated JSON list of a person's prior numbers. A blank old number is a no-op.
export function archiveEnvelope(historyJson, oldNumber) {
  const old = String(oldNumber || '').trim();
  let arr = [];
  if (historyJson) {
    try { const p = JSON.parse(historyJson); if (Array.isArray(p)) arr = p.map(x => String(x)); } catch { arr = []; }
  }
  if (!old || arr.includes(old)) return JSON.stringify(arr);
  return JSON.stringify([old, ...arr]);
}

// Parse the stored history JSON into a plain string array (never throws).
export function parseEnvelopeHistory(historyJson) {
  if (!historyJson) return [];
  try { const p = JSON.parse(historyJson); return Array.isArray(p) ? p.map(x => String(x)) : []; } catch { return []; }
}

// ── Thank-you receipts (GIV-R4 / A) ───────────────────────────────────────────
// Clean monthly figures we're willing to suggest as a recurring-giving nudge.
export const MONTHLY_SUGGESTION_LADDER_CENTS = [
  1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000,
]; // $10 … $500

// Pure. Suggest a clean monthly recurring amount to nudge toward, given a one-time
// gift. Aims at roughly a quarter of the gift (so a $100 gift suggests ~$25/mo, an
// aspirational-but-reachable ask) then snaps to the nearest clean ladder rung, floored
// at $10. Returns 0 for a non-positive gift.
export function suggestMonthlyFromGift(giftCents) {
  const target = (Number(giftCents) || 0) / 4;
  if (target <= 0) return 0;
  let best = MONTHLY_SUGGESTION_LADDER_CENTS[0], bestD = Infinity;
  for (const rung of MONTHLY_SUGGESTION_LADDER_CENTS) {
    const d = Math.abs(rung - target);
    if (d < bestD) { bestD = d; best = rung; }
  }
  return best;
}

// Pure. Given per-donation rows and the qualifying rules, return the receipt queue:
// each donation flagged with why it qualifies (>= threshold and/or the donor's first
// ever gift) plus a suggested monthly nudge. `rows` are donation events already grouped
// per person+date (amount_cents summed across split funds). `firstGiftDateByPerson` maps
// person_id -> their earliest-ever gift date (YYYY-MM-DD). `sentKeys` is the set of
// recipient_keys already thanked. Non-qualifying donations are dropped.
export function computeReceiptQueue(rows, opts = {}) {
  const threshold = Math.max(0, Math.round(opts.thresholdCents != null ? opts.thresholdCents : 25000));
  const includeFirst = opts.includeFirstGift !== false;
  const firstByPerson = opts.firstGiftDateByPerson || {};
  const sentKeys = opts.sentKeys || new Set();
  const out = [];
  for (const r of rows || []) {
    const amt = Number(r.amount_cents) || 0;
    if (amt <= 0) continue;
    const overThreshold = amt >= threshold;
    const isFirst = includeFirst && r.person_id != null
      && firstByPerson[r.person_id] && r.gift_date && firstByPerson[r.person_id] === r.gift_date;
    if (!overThreshold && !isFirst) continue;
    const reasons = [];
    if (overThreshold) reasons.push('over_threshold');
    if (isFirst) reasons.push('first_gift');
    const key = 'ge' + r.person_id + ':' + r.gift_date;
    out.push({
      person_id: r.person_id,
      household_id: r.household_id || null,
      name: r.name || '(anonymous)',
      email: r.email || '',
      amount_cents: amt,
      gift_date: r.gift_date,
      funds: r.funds || '',
      reasons,
      suggested_monthly_cents: suggestMonthlyFromGift(amt),
      recipient_key: key,
      has_email: !!(r.email && r.email.trim()),
      sent: sentKeys.has(key),
    });
  }
  // Largest gifts first — the ones most worth a personal thank-you.
  out.sort((a, b) => b.amount_cents - a.amount_cents);
  const counts = {
    total: out.length,
    sent: out.filter(r => r.sent).length,
    unsent: out.filter(r => !r.sent).length,
    no_email: out.filter(r => !r.has_email).length,
  };
  return { receipts: out, counts };
}

// ── Inflation adjustment (GIV-R3 / 3A five-year trend) ────────────────────────
// CPI-U (U.S. all-items, annual average, 1982-84=100). Update once a year when
// the BLS annual average is published; the current/next year are estimates until
// then (flagged as such in the trend caption). Used to restate prior-year giving
// in the most recent year's dollars, so a "flat" nominal trend that's actually
// losing ground to inflation is visible on the board report.
export const CPI_U_ANNUAL = {
  2015: 237.017, 2016: 240.007, 2017: 245.120, 2018: 251.107, 2019: 255.657,
  2020: 258.811, 2021: 270.970, 2022: 292.655, 2023: 304.702, 2024: 313.689,
  2025: 322.100, 2026: 330.200, // 2025-26 estimated until BLS annual averages post
};

// Restate `cents` from `fromYear` dollars into `toYear` dollars. Returns the input
// unchanged if either year's CPI isn't known (so a missing year never zeroes data).
export function inflationAdjustCents(cents, fromYear, toYear, cpi = CPI_U_ANNUAL) {
  const a = cpi[fromYear], b = cpi[toYear];
  if (!a || !b) return Math.round(cents);
  return Math.round((Number(cents) || 0) * (b / a));
}

// ── PHONE NORMALIZATION ───────────────────────────────────────────────────
// Strips formatting and returns (XXX) XXX-XXXX for 10-digit US numbers.
// Returns original string unchanged for international or unusual formats.
// ── Giving Letters & Statements workspace (GIV-R2) ────────────────────────────
// The letter types the Letters workspace can send/track, each with a default recipient
// scope. 'givers' = everyone who gave in the period (per person). 'member_households' =
// every member household (one recipient each), whether or not they've given. 'none' =
// no auto-resolved list (memorial letters are composed ad-hoc against a chosen person).
export const LETTER_TYPES = {
  year_end:  { label: 'Year-End Statement',   defaultScope: 'givers',            hasTemplate: true  },
  midyear:   { label: 'Mid-Year Update',      defaultScope: 'givers',            hasTemplate: true  },
  quarterly: { label: 'Quarterly Statement',  defaultScope: 'givers',            hasTemplate: false },
  thank_you: { label: 'Thank-You Letter',     defaultScope: 'givers',            hasTemplate: false },
  appeal:    { label: 'Giving Appeal',        defaultScope: 'member_households', hasTemplate: false },
  memorial:  { label: 'Memorial Letter',      defaultScope: 'none',              hasTemplate: false },
  // Recipients come from the plateau analysis, not from a scope query — see giving/nudges/status.
  // defaultScope 'none' keeps it out of the generic letters workspace, which has no way to
  // resolve them, while still letting giving/letters/mark record a send against it.
  nudge:     { label: 'Giving Nudge',         defaultScope: 'none',              hasTemplate: false },
};

// Stable dedup identity for a recorded send, independent of which person inside a household
// was the actual recipient. 'p<id>' for a person-scoped send, 'h<id>' for a household one.
export function letterRecipientKey(kind, id) {
  return (kind === 'household' ? 'h' : 'p') + String(id);
}

// Merge the two server-resolved candidate pools (people who gave, member households) into a
// single recipient list for a given scope, annotate each with whether it's already been sent
// on this channel, and tally counts. Pure — takes plain rows, returns plain data — so it can
// be unit-tested without a DB. For scope 'both' the design's rule is "gave OR member household,
// deduped per household": every member household is one recipient, plus any giver who is NOT in
// a member household (household_id null or not in the member-household set) as their own person
// recipient — so a couple in a member household is never counted twice.
export function mergeLetterRecipients(givers, households, scope, sentKeys, channel) {
  sentKeys = sentKeys || new Set();
  const memberHhIds = new Set((households || []).map(h => h.id));
  const out = [];
  const pushPerson = g => {
    const key = letterRecipientKey('person', g.id);
    out.push({
      kind: 'person', id: g.id, household_id: g.household_id || null,
      name: ((g.first_name || '') + ' ' + (g.last_name || '')).trim() || '(no name)',
      email: g.email || '', total_cents: g.total_cents || 0,
      recipient_key: key, has_email: !!(g.email && g.email.trim()),
      sent: sentKeys.has(channel === 'print' ? key : key),
    });
  };
  const pushHousehold = h => {
    const key = letterRecipientKey('household', h.id);
    out.push({
      kind: 'household', id: h.id, household_id: h.id,
      name: h.name || '(household)',
      email: h.recipient_email || '', recipient_name: h.recipient_name || '',
      total_cents: h.total_cents || 0,
      recipient_key: key, has_email: !!(h.recipient_email && h.recipient_email.trim()),
      sent: sentKeys.has(key),
    });
  };
  if (scope === 'member_households') {
    (households || []).forEach(pushHousehold);
  } else if (scope === 'both') {
    (households || []).forEach(pushHousehold);
    (givers || []).forEach(g => {
      if (!g.household_id || !memberHhIds.has(g.household_id)) pushPerson(g);
    });
  } else { // 'givers' (default)
    (givers || []).forEach(pushPerson);
  }
  // Recompute each row's sent flag against the channel-specific key set the caller passed.
  out.forEach(r => { r.sent = sentKeys.has(r.recipient_key); });
  const counts = {
    total: out.length,
    sent: out.filter(r => r.sent).length,
    unsent: out.filter(r => !r.sent).length,
    no_email: out.filter(r => !r.has_email).length,
  };
  return { recipients: out, counts };
}

export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return '(' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return raw;
}

// Giving-letter templates are hand-authored HTML (TinyMCE, see js-settings.js
// initLetterEditor()). Two real ways a base64 image payload can end up mangled
// in there, both reported live: (1) an image accidentally dropped into the
// Insert Link dialog instead of Insert Image, producing `<a href="data:...">`
// whose visible link text defaults to the href itself — the whole base64
// string renders as literal text; (2) a raw base64 string pasted directly as
// plain text (e.g. copied from an EXIF/base64-conversion tool) with no
// surrounding tag at all. Neither is recoverable as "the image the admin
// meant" — there's no way to tell where it was meant to go — so this strips
// both forms out entirely rather than leaving garbage text in a donor's inbox.
// A legitimate `<img src="data:...">` (inserted via the toolbar's file picker)
// is left untouched by protecting `src="..."` attributes before the sweep.
export function sanitizeLetterTemplateHtml(html) {
  if (!html || typeof html !== 'string') return { cleaned: html, changed: false };
  let cleaned = html;
  let changed = false;

  // 1. A whole <a href="data:...">...</a> — the link text is always the
  // leaked base64 payload, so the entire anchor is dropped, not just unwrapped.
  const dataLinkRe = /<a\b[^>]*\bhref\s*=\s*(["'])data:[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
  if (dataLinkRe.test(cleaned)) {
    cleaned = cleaned.replace(dataLinkRe, '');
    changed = true;
  }

  // 2. A bare data: URI sitting in the text itself, outside any tag attribute
  // (pasted as plain text). Protect real `src="data:..."` occurrences first
  // so a legitimate embedded <img> survives the sweep.
  const placeholders = [];
  const marker = 'LTRPLACEHOLDERMARKER';
  const protectedHtml = cleaned.replace(/\bsrc\s*=\s*(["'])data:[\s\S]*?\1/gi, (m) => {
    placeholders.push(m);
    return marker + (placeholders.length - 1) + marker;
  });
  const strayRe = /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/g;
  let swept = protectedHtml;
  if (strayRe.test(swept)) {
    swept = swept.replace(strayRe, '');
    changed = true;
  }
  const markerRe = new RegExp(marker + '(\\d+)' + marker, 'g');
  cleaned = swept.replace(markerRe, (_, i) => placeholders[Number(i)]);

  return { cleaned, changed };
}

// The letterhead logo (see letterheadImgHtml(), js-reports.js) is shown at a tiny fixed
// height (44px) in giving letters, with no server-side resizing anywhere in its upload
// path. An oversized/EXIF-heavy source photo is a confirmed cause of the logo rendering
// as a blank "blob" in email clients (see GIV-BUG1) — most clients size a blocked-remote-
// image placeholder off the byte size / dimensions of the source, not the display CSS.
// This is a soft warning, not a hard cap: a large-but-otherwise-fine image still uploads.
export const LOGO_WARN_BYTES = 300 * 1024; // 300 KB
export function logoSizeWarning(fileBytes) {
  if (!fileBytes || fileBytes <= LOGO_WARN_BYTES) return '';
  const mb = (fileBytes / 1024 / 1024).toFixed(1);
  const kb = Math.round(LOGO_WARN_BYTES / 1024);
  return `This image is ${mb} MB — large for a logo shown at a small size in emails. Some email clients may render it as a blank box instead of a small crisp logo. Consider cropping/resizing to a smaller image (under ${kb} KB) before uploading.`;
}

// ── ADDRESS VALIDATION HELPERS ───────────────────────────────────────────
// Service priority:
//   1. Google Address Validation (GOOGLE_ADDRESS_API_KEY) — no rate-limit ceiling, best for bulk
//   2. USPS OAuth API  (USPS_CLIENT_ID + USPS_CLIENT_SECRET) — new REST API, 60 req/hour cap
//   3. USPS Web Tools  (USPS_USER_ID)                        — legacy XML API
//   4. Lob             (LOB_API_KEY)
//   5. Census Bureau   (free fallback, no key needed)
// All helpers return a plain object: { ok, address1, address2, city, state, zip, zip4, dpvConfirmation, deliverable }
// or { ok: false, error } on failure.

function escXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strip HTML tags and normalize whitespace from an address field
function cleanAddrField(s) {
  return (s || '').replace(/<[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
}
// Return a copy of addr with HTML stripped from address1/address2
function cleanAddr(addr) {
  return { ...addr, address1: cleanAddrField(addr.address1), address2: cleanAddrField(addr.address2) };
}

// Fetch a USPS OAuth token (call once per bulk operation, share across addresses)
async function getUspsToken(clientId, clientSecret) {
  const tokenRes = await fetch('https://apis.usps.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error('USPS token error: ' + (err.error_description || tokenRes.status));
  }
  const { access_token } = await tokenRes.json();
  return access_token;
}

// New USPS OAuth 2.0 API — accepts a pre-fetched token to avoid re-authing per address
async function validateUspsOAuth(addr, clientId, clientSecret, token) {
  const access_token = token || await getUspsToken(clientId, clientSecret);

  // Step 2: validate address
  const params = new URLSearchParams();
  params.set('streetAddress', (addr.address1 || '').trim());
  if ((addr.address2 || '').trim()) params.set('secondaryAddress', addr.address2.trim());
  if ((addr.city    || '').trim()) params.set('city',  addr.city.trim());
  if ((addr.state   || '').trim()) params.set('state', addr.state.trim());
  if ((addr.zip     || '').trim()) params.set('ZIPCode', addr.zip.replace(/[^0-9]/g, '').slice(0, 5));

  const addrRes = await fetch('https://apis.usps.com/addresses/v3/address?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  if (!addrRes.ok) {
    const err = await addrRes.json().catch(() => ({}));
    const msg = err.apiMessage || err.detail || ('USPS error ' + addrRes.status);
    return { ok: false, error: msg };
  }
  const data = await addrRes.json();
  const addr2 = data.address || {};
  const addInfo = data.additionalInfo || {};
  const dpvMap = { Y: 'Y', S: 'S', D: 'D', N: 'N' };
  const dpv = dpvMap[addInfo.DPVConfirmation] || (data.firm ? 'Y' : 'N');
  return {
    ok: true,
    address1: addr2.streetAddress || (addr.address1 || ''),
    address2: addr2.secondaryAddress || (addr.address2 || ''),
    city: addr2.city || (addr.city || ''),
    state: addr2.state || (addr.state || ''),
    zip: addr2.ZIPCode || (addr.zip || ''),
    zip4: addr2.ZIPPlus4 || '',
    dpvConfirmation: dpv,
    deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: dpv === 'Y' ? 'deliverable' : dpv === 'S' ? 'deliverable_missing_unit'
                  : dpv === 'D' ? 'deliverable_incorrect_unit' : 'undeliverable',
  };
}

// Legacy USPS Web Tools XML API (single user ID)
async function validateUspsWebTools(addr, userId) {
  const street = (addr.address1 || '').trim();
  const unit   = (addr.address2 || '').trim();
  const city   = (addr.city    || '').trim();
  const state  = (addr.state   || '').trim();
  const zip    = (addr.zip     || '').replace(/[^0-9]/g, '').slice(0, 5);
  // USPS quirk: Address1 = apt/unit, Address2 = street number + name
  const xml = `<AddressValidateRequest USERID="${escXml(userId)}"><Revision>1</Revision><Address>`
    + `<Address1>${escXml(unit)}</Address1><Address2>${escXml(street)}</Address2>`
    + `<City>${escXml(city)}</City><State>${escXml(state)}</State>`
    + `<Zip5>${zip}</Zip5><Zip4></Zip4></Address></AddressValidateRequest>`;
  const res = await fetch('https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=' + encodeURIComponent(xml));
  if (!res.ok) return { ok: false, error: 'USPS service error ' + res.status };
  const text = await res.text();
  const get = tag => { const m = text.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')); return m ? m[1] : ''; };
  if (text.includes('<Error>')) return { ok: false, error: get('Description') || 'USPS error' };
  const dpv = get('DPVConfirmation') || 'N';
  return {
    ok: true,
    address1: get('Address2'),  // USPS response: street is Address2
    address2: get('Address1'),  // USPS response: unit is Address1
    city: get('City'), state: get('State'),
    zip: get('Zip5'), zip4: get('Zip4'),
    dpvConfirmation: dpv,
    deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: dpv === 'Y' ? 'deliverable' : dpv === 'S' ? 'deliverable_missing_unit'
                  : dpv === 'D' ? 'deliverable_incorrect_unit' : 'undeliverable',
  };
}

async function validateLob(addr, lobKey) {
  const body = { primary_line: (addr.address1 || '').trim() };
  if (addr.address2?.trim()) body.secondary_line = addr.address2.trim();
  if (addr.city?.trim())     body.city = addr.city.trim();
  if (addr.state?.trim())    body.state = addr.state.trim();
  if (addr.zip?.trim())      body.zip_code = addr.zip.replace(/[^0-9]/g, '').slice(0, 5);
  const res = await fetch('https://api.lob.com/v1/us_verifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(lobKey + ':') },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message || ('Lob error ' + res.status) };
  }
  const data = await res.json();
  const c = data.components || {};
  const lobDpv = { deliverable: 'Y', deliverable_unnecessary_unit: 'Y',
                   deliverable_missing_unit: 'S', deliverable_incorrect_unit: 'D', undeliverable: 'N' };
  const dpv = lobDpv[data.deliverability] || 'N';
  return {
    ok: true,
    address1: data.primary_line || '', address2: data.secondary_line || '',
    city: c.city || '', state: c.state || '', zip: c.zip_code || '', zip4: c.zip_code_plus_4 || '',
    dpvConfirmation: dpv, deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: data.deliverability || '',
  };
}

async function validateCensus(addr) {
  const parts = [addr.address1, addr.address2, addr.city, addr.state, addr.zip]
    .map(s => (s || '').trim()).filter(Boolean);
  const res = await fetch(
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address='
    + encodeURIComponent(parts.join(', ')) + '&benchmark=2020&format=json'
  );
  if (!res.ok) return { ok: false, error: 'Census geocoding service error ' + res.status };
  const data = await res.json();
  const matches = data?.result?.addressMatches || [];
  if (matches.length === 0) {
    return { ok: true, address1: addr.address1 || '', address2: addr.address2 || '',
             city: addr.city || '', state: addr.state || '', zip: addr.zip || '', zip4: '',
             dpvConfirmation: 'N', deliverable: false, deliverability: 'undeliverable' };
  }
  const match = matches[0];
  const c = match.addressComponents || {};
  const streetMatch = (match.matchedAddress || '').match(/^([^,]+)/);
  return {
    ok: true,
    address1: streetMatch ? streetMatch[1].trim() : (addr.address1 || ''),
    address2: addr.address2 || '',
    city: c.city || addr.city || '', state: c.state || addr.state || '',
    zip: c.zip || addr.zip || '', zip4: '',
    dpvConfirmation: 'Y', deliverable: true, deliverability: 'deliverable', source: 'census',
  };
}

async function validateGoogle(addr, apiKey) {
  const addressLines = [(addr.address1 || '').trim(), (addr.address2 || '').trim()].filter(Boolean);
  const body = {
    address: {
      regionCode: 'US',
      addressLines,
      locality: (addr.city || '').trim() || undefined,
      administrativeArea: (addr.state || '').trim() || undefined,
      postalCode: (addr.zip || '').trim() || undefined,
    },
  };
  const res = await fetch('https://addressvalidation.googleapis.com/v1:validateAddress?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message || ('Google error ' + res.status) };
  }
  const data = await res.json();
  const result = data.result || {};
  const postal = result.address?.postalAddress || {};
  const usps = result.uspsData || {};
  const dpvMap = { CONFIRMED: 'Y', UNCONFIRMED_BUT_MATCHABLE: 'S', UNCONFIRMED: 'N' };
  const dpv = dpvMap[usps.dpvConfirmation] || (result.verdict?.addressComplete ? 'Y' : 'N');
  return {
    ok: true,
    address1: (postal.addressLines || [])[0] || (addr.address1 || ''),
    address2: (postal.addressLines || [])[1] || (addr.address2 || ''),
    city: postal.locality || (addr.city || ''),
    state: postal.administrativeArea || (addr.state || ''),
    zip: (postal.postalCode || (addr.zip || '')).split('-')[0],
    zip4: usps.zipPlus4 || '',
    dpvConfirmation: dpv,
    deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: dpv === 'Y' ? 'deliverable' : dpv === 'S' ? 'deliverable_missing_unit' : 'undeliverable',
    source: 'google',
  };
}

async function validateAddressCore(addr, env, uspsToken) {
  const a = cleanAddr(addr);
  if (env.GOOGLE_ADDRESS_API_KEY) return validateGoogle(a, env.GOOGLE_ADDRESS_API_KEY);
  if (env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET)
    return validateUspsOAuth(a, env.USPS_CLIENT_ID, env.USPS_CLIENT_SECRET, uspsToken);
  if (env.USPS_USER_ID)  return validateUspsWebTools(a, env.USPS_USER_ID);
  if (env.LOB_API_KEY)   return validateLob(a, env.LOB_API_KEY);
  return validateCensus(a);
}

// ── UTILS API HANDLER ─────────────────────────────────────────────────────
export async function handleUtilsApi(req, env, url, method, seg, db, isAdmin, canEdit) {

  // POST /admin/api/utils/validate-address
  if (seg === 'utils/validate-address' && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!(b.address1 || '').trim()) return json({ error: 'address1 is required' }, 400);
    try {
      const result = await validateAddressCore(b, env);
      return result.ok ? json(result) : json({ error: result.error }, 422);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  // GET /admin/api/utils/static-map?address=... — server-side Google Static Maps proxy.
  // Keeps the key off the client entirely (it's a server-side key with no HTTP-referrer
  // restriction, unlike a typical embed/JS-API key, so it must never be exposed in page
  // source). Returns the map image bytes directly.
  //
  // NOTE: this hits the Maps *Static* API, which is a DIFFERENT Google product than the
  // Address Validation API. A key restricted to Address Validation (per SECRETS.md) will be
  // rejected here with 403 unless "Maps Static API" is also enabled on the project and the
  // key's API restrictions allow it. Prefer a dedicated GOOGLE_MAPS_API_KEY; fall back to the
  // address key only for backwards compatibility.
  if (seg === 'utils/static-map' && method === 'GET') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const mapKey = env.GOOGLE_MAPS_API_KEY || env.GOOGLE_ADDRESS_API_KEY;
    if (!mapKey) return json({ error: 'Maps not configured' }, 501);
    const address = (url.searchParams.get('address') || '').trim();
    if (!address) return json({ error: 'address is required' }, 400);
    const mapUrl = 'https://maps.googleapis.com/maps/api/staticmap?' + new URLSearchParams({
      center: address,
      zoom: '15',
      size: '600x260',
      scale: '2',
      markers: 'color:0x1E2D4A|' + address,
      key: mapKey,
    });
    const r = await fetch(mapUrl);
    if (!r.ok) {
      // Surface Google's own reason (e.g. "API keys with referer restrictions cannot be used
      // with this API", "The Maps Static API must be enabled") so this is diagnosable from the
      // Network tab instead of a generic failure.
      let reason = '';
      try { reason = (await r.text()).slice(0, 300).trim(); } catch {}
      return json({ error: 'Map lookup failed', status: r.status, google: reason }, 502);
    }
    return new Response(r.body, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'image/png', 'Cache-Control': 'private, max-age=3600' } });
  }

  // POST /admin/api/utils/bulk-validate-addresses — validate + standardize active people with an address.
  // Processes 45 addresses per call to stay under Cloudflare's 50-subrequest limit
  // (1 USPS token fetch + up to 45 address calls = 46 max per invocation).
  // Frontend loops until hasMore=false.
  if (seg === 'utils/bulk-validate-addresses' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    let body = {}; try { body = await req.json(); } catch {}
    const offset = parseInt(body.offset || 0);
    const PAGE = 45;

    const totalRow = await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE address1 != '' AND status = 'active'`
    ).first();
    const total = totalRow?.n || 0;

    const rows = (await db.prepare(
      `SELECT id, first_name, last_name, address1, address2, city, state, zip
       FROM people WHERE address1 != '' AND status = 'active'
       ORDER BY id LIMIT ? OFFSET ?`
    ).bind(PAGE, offset).all()).results || [];

    // Fetch USPS token once for the whole page (avoids one token request per address)
    let uspsToken = null;
    if (env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET) {
      try { uspsToken = await getUspsToken(env.USPS_CLIENT_ID, env.USPS_CLIENT_SECRET); }
      catch (e) { return json({ error: 'USPS auth failed: ' + e.message }, 502); }
    }

    // Missouri cities that commonly appear with a missing state field
    const MO_CITIES = new Set(['st. louis','saint louis','st louis','wentzville','fenton','crestwood',
      'kirkwood','ballwin','arnold','florissant','hazelwood','manchester','chesterfield','wildwood',
      'webster groves','richmond heights','brentwood','maplewood','affton','mehlville','oakville',
      'lemay','sunset hills','des peres','ellisville','eureka','pacific','valley park','high ridge',
      'imperial','festus','crystal city','house springs','barnhart','jefferson city','columbia',
      'springfield','kansas city','independence','st. charles','saint charles','o\'fallon','st peters']);

    let validated = 0, updated = 0, failed = 0;
    const failures = [];

    // 5 concurrent per mini-batch within the page
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      await Promise.all(batch.map(async row => {
        try {
          // ── Step 1: skip placeholder "unknown" streets ──────────────
          if (/^unknown$/i.test((row.address1 || '').trim())) return;

          // ── Step 2: strip HTML tags (e.g. <BR> from Breeze) ─────────
          let a1 = cleanAddrField(row.address1);
          let a2 = cleanAddrField(row.address2 || '');

          // ── Step 3: split pipe-separated facility names ──────────────
          // "Facility Name|123 Main St" → address2=facility, address1=street
          if (a1.includes('|')) {
            const [facility, street] = a1.split('|');
            a2 = facility.trim();
            a1 = street.trim();
          }

          // ── Step 4: split care facility prefix from street ───────────
          // "Facility Name 123 Main St" — everything before first digit is facility
          // Only applies when address2 is empty, address1 starts with non-digit text,
          // and it's NOT a PO Box (which legitimately starts with non-digit text)
          if (!a2 && /^[^0-9]/.test(a1) && !/^p\.?o\.?\s*box/i.test(a1)) {
            const m = a1.match(/^(.*?)\s+(\d+.*)$/);
            if (m && m[1].trim().length > 0) {
              a2 = m[1].trim();
              a1 = m[2].trim();
            }
          }

          // ── Step 5: split apt/unit suffix out of street field ────────
          // "3615 Jamieson Ave Apt. 1S" or "2405 Hampton Ave 3A" → address2
          const aptMatch = a1.match(/^(.+?)\s+((?:Apt\.?|Unit|Suite|#)\s*\S+)$/i);
          if (aptMatch && !a2) {
            a1 = aptMatch[1].trim();
            a2 = aptMatch[2].trim();
          }

          // ── Step 6: infer missing state from known MO city names ─────
          let city  = (row.city  || '').trim();
          let state = (row.state || '').trim();
          if (!state && MO_CITIES.has(city.toLowerCase())) state = 'MO';

          const workRow = { ...row, address1: a1, address2: a2, city, state };

          // Save any structural changes to DB immediately (facility split, apt split, state)
          const structChanged = a1 !== (row.address1 || '') || a2 !== (row.address2 || '')
                             || city !== (row.city || '') || state !== (row.state || '');
          if (structChanged) {
            await db.prepare('UPDATE people SET address1=?,address2=?,city=?,state=? WHERE id=?')
              .bind(a1, a2, city, state, row.id).run();
          }

          // ── Step 7: USPS validation ──────────────────────────────────
          const r = await validateAddressCore(workRow, env, uspsToken);
          validated++;
          if (!r.ok) {
            if (structChanged) updated++; // count structural cleanup as an update even if USPS fails
            failed++;
            failures.push({ id: row.id, name: (row.first_name + ' ' + row.last_name).trim(), address: [a1, city, state].filter(Boolean).join(', '), error: r.error });
            return;
          }
          if (!r.deliverable) {
            if (structChanged) updated++;
            return;
          }
          const newZip = r.zip + (r.zip4 ? '-' + r.zip4 : '');
          const uspsChanged = r.address1 !== a1 || r.address2 !== a2
                           || r.city !== city || r.state !== state
                           || newZip !== (row.zip || '');
          if (structChanged || uspsChanged) {
            await db.prepare('UPDATE people SET address1=?,address2=?,city=?,state=?,zip=? WHERE id=?')
              .bind(r.address1, r.address2 || '', r.city, r.state, newZip, row.id).run();
            updated++;
          }
        } catch (e) {
          failed++;
          failures.push({ id: row.id, name: (row.first_name + ' ' + row.last_name).trim(), address: [row.address1, row.city, row.state].filter(Boolean).join(', '), error: e.message });
        }
      }));
    }

    const nextOffset = offset + rows.length;
    return json({ ok: true, total, offset, validated, updated, failed,
                  hasMore: nextOffset < total, nextOffset,
                  failures });
  }

  // POST /admin/api/utils/normalize-phones — one-time bulk phone cleanup (admin only)
  if (seg === 'utils/normalize-phones' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const rows = (await db.prepare(`SELECT id, phone FROM people WHERE phone != ''`).all()).results || [];
    const toUpdate = rows
      .map(r => ({ id: r.id, norm: normalizePhone(r.phone), orig: r.phone }))
      .filter(r => r.norm !== r.orig);
    if (toUpdate.length) {
      const CHUNK = 99;
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        await db.batch(toUpdate.slice(i, i + CHUNK).map(row =>
          db.prepare('UPDATE people SET phone=? WHERE id=?').bind(row.norm, row.id)
        ));
      }
    }
    return json({ ok: true, updated: toUpdate.length, total_with_phone: rows.length });
  }

  return null;
}
