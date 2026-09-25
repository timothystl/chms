// ── Giving analytics contracts, read by Finance's v3 Giving pages ────────────────────────────
// Giving stays authoritative here in Connect. Two reads and one write, split by what they reveal:
//
//   giving-analytics-v1         Trends, Year over year, Household bands, Pledges and the What-if
//                               baselines. Totals, counts and bands only: no name, no person id,
//                               no envelope. Council's anonymous Giving access ('anon') may read it,
//                               exactly like the anon-safe giving reports (isAnonSafeGivingSeg).
//   giving-analytics-people-v1  Giving statements and nudges. Names households and people, so it
//                               needs Giving view or edit (or admin); 'anon' is refused.
//   giving-followup-write-v1    Assigns a nudge or marks it done (giving_followups). Needs Giving
//                               edit or admin. Nothing here sends a message.
//
// Identity works like the Gift Entry batch contracts: the caller has already checked
// X-Contract-Key (the request came from Finance's Worker); the Cf-Access-Jwt-Assertion is
// re-verified here and the person's real Connect role decides access.
import { json } from './auth.js';
import { verifyAccessJwt } from './access-jwt.js';
import { getRolePermissions, permissionsForRole } from './api-utils.js';

const ONLINE_METHODS = "('online','card','ach')";
const HOUSEHOLD_KEY = `CASE WHEN p.household_id IS NOT NULL AND p.household_id != 0
                            THEN 'h:' || p.household_id ELSE 'p:' || p.id END`;
export const BANDS = [
  { label: 'Under $500', min: 1, max: 49999 },
  { label: '$500 – $999', min: 50000, max: 99999 },
  { label: '$1,000 – $2,499', min: 100000, max: 249999 },
  { label: '$2,500 – $4,999', min: 250000, max: 499999 },
  { label: '$5,000 – $9,999', min: 500000, max: 999999 },
  { label: '$10,000 and up', min: 1000000, max: Infinity },
];
export const NUDGE_KINDS = {
  first_time: 'First-time givers',
  stopped: 'Stopped giving',
  giving_down: 'Giving down',
  pledge_behind: 'Pledge behind',
  stepped_up: 'Stepped up',
};
const NUDGE_LIST_LIMIT = 25;

export async function authorizeGivingAnalyticsContract(req, env, { level }) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return { response: json({ error: 'Access verification not configured' }, 503) };
  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return { response: json({ error: 'Unauthorized' }, 401) };
  const user = await env.DB.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return { response: json({ error: 'No matching active Connect account for this identity' }, 403) };
  const giving = permissionsForRole(await getRolePermissions(env.DB), user.role).giving;
  const admin = user.role === 'admin';
  const allowed = admin || (level === 'aggregate' && ['anon', 'view', 'edit'].includes(giving))
    || (level === 'people' && ['view', 'edit'].includes(giving))
    || (level === 'write' && giving === 'edit');
  if (!allowed) {
    const message = level === 'write' ? 'Updating a giving follow-up requires Giving edit access'
      : level === 'people' ? 'Named giving detail requires Giving view access; council access is totals only'
        : 'Giving analytics requires Giving access';
    return { response: json({ error: message }, 403) };
  }
  return { email, user };
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// Dates are calendar days in UTC, matching how contribution_date is stored and how the rest of
// Connect's giving reports bucket a gift.
function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}

function sameDayLastYear(day) {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function resolveAsOf(url, now = new Date()) {
  const requested = url.searchParams.get('as_of');
  return isDay(requested) ? requested : now.toISOString().slice(0, 10);
}

// One row per giving household (or single person without a household) with its totals in each
// window the pages compare. Organizations are left out, as in Connect's household rollups.
// Returned to this Worker only; the aggregate contract reduces it to counts and bands.
async function readHouseholdWindows(db, asOf) {
  const year = Number(asOf.slice(0, 4));
  const priorSameDay = sameDayLastYear(asOf);
  const t12Start = shiftDay(asOf, -364);
  const rows = (await db.prepare(
    `SELECT ${HOUSEHOLD_KEY} AS hk,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS y2,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS y1,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS prior_ytd,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS ytd,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS t12
       FROM giving_entries ge JOIN people p ON p.id=ge.person_id
      WHERE ge.contribution_date BETWEEN ? AND ?
        AND LOWER(COALESCE(p.member_type,'')) != 'organization'
      GROUP BY hk`
  ).bind(
    `${year - 2}-01-01`, `${year - 2}-12-31`,
    `${year - 1}-01-01`, `${year - 1}-12-31`,
    `${year - 1}-01-01`, priorSameDay,
    `${year}-01-01`, asOf,
    t12Start, asOf,
    `${year - 2}-01-01`, asOf,
  ).all()).results || [];
  return rows.map((r) => ({ hk: r.hk, y2: r.y2 || 0, y1: r.y1 || 0, prior_ytd: r.prior_ytd || 0, ytd: r.ytd || 0, t12: r.t12 || 0 }));
}

export function summarizeHouseholds(rows) {
  const count = (fn) => rows.filter(fn).length;
  const sum = (list, key) => list.reduce((s, r) => s + r[key], 0);
  const t12 = rows.filter((r) => r.t12 > 0);
  const y1 = rows.filter((r) => r.y1 > 0);
  const y2 = rows.filter((r) => r.y2 > 0);
  const newLastYear = y1.filter((r) => r.y2 <= 0);
  const bands = BANDS.map((b) => {
    const inBand = t12.filter((r) => r.t12 >= b.min && r.t12 <= b.max);
    return { label: b.label, households: inBand.length, cents: sum(inBand, 't12') };
  });
  const y1Avg = y1.length ? sum(y1, 'y1') / y1.length : 0;
  return {
    ytd_households: count((r) => r.ytd > 0),
    prior_ytd_households: count((r) => r.prior_ytd > 0),
    last_year_households: y1.length,
    both_years_households: count((r) => r.y1 > 0 && r.ytd > 0),
    bands,
    t12_households: t12.length,
    t12_cents: sum(t12, 't12'),
    // What-if baselines, from the last two complete years so a partial year never skews them.
    retained_households: count((r) => r.y2 > 0 && r.y1 > 0),
    two_years_ago_households: y2.length,
    new_last_year_households: newLastYear.length,
    new_last_year_avg_cents: newLastYear.length ? Math.round(sum(newLastYear, 'y1') / newLastYear.length) : 0,
    last_year_avg_cents: Math.round(y1Avg),
    concentration: concentrationOf(t12.map((r) => r.t12), y1.map((r) => r.y1)),
  };
}

// How much of household giving depends on a few households: each tenth of households (largest
// givers first) and its share, the ten largest households' share now and last year, and the
// median. Shares and counts only, like the bands above -- never an amount tied to a household.
export function concentrationOf(t12Cents, lastYearCents) {
  const desc = (list) => [...list].sort((a, b) => b - a);
  const total = (list) => list.reduce((s, v) => s + v, 0);
  const now = desc(t12Cents);
  const nowTotal = total(now);
  const n = now.length;
  const deciles = Array.from({ length: 10 }, (_, i) => {
    const slice = now.slice(Math.floor((i * n) / 10), Math.floor(((i + 1) * n) / 10));
    return { households: slice.length, share: nowTotal ? total(slice) / nowTotal : 0 };
  });
  const topTenShare = (list) => { const t = total(list); return t ? total(desc(list).slice(0, 10)) / t : null; };
  const mid = Math.floor(n / 2);
  const median = n ? (n % 2 ? now[mid] : Math.round((now[mid - 1] + now[mid]) / 2)) : 0;
  return {
    households: n,
    deciles,
    top_ten_share: topTenShare(now),
    top_ten_share_last_year: topTenShare(lastYearCents),
    median_cents: median,
    households_1000_plus: now.filter((v) => v >= 100000).length,
  };
}

// GET giving-analytics-v1?as_of=YYYY-MM-DD — aggregate only.
export async function respondWithGivingAnalyticsV1(url, db) {
  const asOf = resolveAsOf(url);
  const year = Number(asOf.slice(0, 4));
  const priorSameDay = sameDayLastYear(asOf);
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const priorMonthStart = `${priorSameDay.slice(0, 7)}-01`;
  const lastSunday = shiftDay(asOf, -new Date(`${asOf}T00:00:00Z`).getUTCDay());
  const weeksFrom = shiftDay(lastSunday, -90);

  const [totals, months, funds, weeks, firstTime, pledges, householdRows] = await Promise.all([
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN contribution_date BETWEEN ? AND ? THEN amount END),0) AS ytd_cents,
         COALESCE(SUM(CASE WHEN contribution_date BETWEEN ? AND ? THEN amount END),0) AS prior_ytd_cents,
         COALESCE(SUM(CASE WHEN contribution_date BETWEEN ? AND ? THEN amount END),0) AS mtd_cents,
         COALESCE(SUM(CASE WHEN contribution_date BETWEEN ? AND ? THEN amount END),0) AS prior_mtd_cents,
         COALESCE(SUM(CASE WHEN contribution_date BETWEEN ? AND ? AND method IN ${ONLINE_METHODS} THEN amount END),0) AS ytd_online_cents,
         COALESCE(SUM(CASE WHEN contribution_date BETWEEN ? AND ? AND method IN ${ONLINE_METHODS} THEN amount END),0) AS prior_ytd_online_cents,
         COUNT(CASE WHEN contribution_date BETWEEN ? AND ? THEN 1 END) AS ytd_gifts
       FROM giving_entries WHERE contribution_date BETWEEN ? AND ?`
    ).bind(
      `${year}-01-01`, asOf, `${year - 1}-01-01`, priorSameDay,
      monthStart, asOf, priorMonthStart, priorSameDay,
      `${year}-01-01`, asOf, `${year - 1}-01-01`, priorSameDay,
      `${year}-01-01`, asOf, `${year - 1}-01-01`, asOf,
    ).first(),
    db.prepare(
      `SELECT month, COALESCE(SUM(total_cents),0) AS cents, COALESCE(SUM(gift_count),0) AS gifts
         FROM giving_monthly_fund_totals WHERE month BETWEEN ? AND ? GROUP BY month ORDER BY month`
    ).bind(`${year - 1}-01`, `${year}-12`).all(),
    db.prepare(
      `SELECT f.name AS fund_name, SUM(ge.amount) AS cents
         FROM giving_entries ge JOIN funds f ON f.id=ge.fund_id
        WHERE ge.contribution_date BETWEEN ? AND ?
        GROUP BY f.id ORDER BY cents DESC`
    ).bind(`${year}-01-01`, asOf).all(),
    // Weeks end on Sunday (Monday–Sunday), so each bar is "the Sunday" and the gifts around it.
    db.prepare(
      `SELECT date(contribution_date, 'weekday 0') AS week_ending, SUM(amount) AS cents, COUNT(*) AS gifts
         FROM giving_entries WHERE contribution_date BETWEEN ? AND ?
        GROUP BY week_ending ORDER BY week_ending`
    ).bind(shiftDay(weeksFrom, -6), lastSunday).all(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT person_id, MIN(contribution_date) AS first_day FROM giving_entries
          WHERE person_id IS NOT NULL AND contribution_date != '' GROUP BY person_id
       ) f JOIN people p ON p.id=f.person_id
        WHERE f.first_day BETWEEN ? AND ? AND LOWER(COALESCE(p.member_type,'')) != 'organization'`
    ).bind(`${year}-01-01`, asOf).first(),
    db.prepare(
      `SELECT pl.amount_cents,
              COALESCE((SELECT SUM(ge.amount) FROM giving_entries ge
                         WHERE ge.person_id=pl.person_id AND ge.contribution_date BETWEEN ? AND ?),0) AS received_cents
         FROM pledges pl WHERE pl.fiscal_year=? AND pl.amount_cents > 0`
    ).bind(`${year}-01-01`, asOf, year).all(),
    readHouseholdWindows(db, asOf),
  ]);

  const elapsed = yearElapsedShare(asOf);
  const pledgeRows = pledges.results || [];
  const pledgeSummary = {
    pledgers: pledgeRows.length,
    pledged_cents: pledgeRows.reduce((s, r) => s + (r.amount_cents || 0), 0),
    received_cents: pledgeRows.reduce((s, r) => s + Math.min(r.received_cents || 0, r.amount_cents || 0), 0),
    given_cents: pledgeRows.reduce((s, r) => s + (r.received_cents || 0), 0),
    fulfilled: pledgeRows.filter((r) => r.received_cents >= r.amount_cents).length,
    on_pace: pledgeRows.filter((r) => r.received_cents < r.amount_cents && r.received_cents >= r.amount_cents * elapsed * 0.9).length,
    behind: pledgeRows.filter((r) => r.received_cents > 0 && r.received_cents < r.amount_cents * elapsed * 0.9).length,
    not_started: pledgeRows.filter((r) => !r.received_cents).length,
  };

  const weekMap = new Map((weeks.results || []).map((w) => [w.week_ending, w]));
  const weekSeries = [];
  for (let i = 12; i >= 0; i -= 1) {
    const day = shiftDay(lastSunday, -7 * i);
    const w = weekMap.get(day);
    weekSeries.push({ week_ending: day, cents: w?.cents || 0, gifts: w?.gifts || 0 });
  }

  return json({
    contract: 'connect.giving-analytics.v1',
    as_of: asOf,
    year,
    year_elapsed: elapsed,
    totals: { ...totals, first_time_givers: firstTime?.n || 0 },
    months: months.results || [],
    funds: funds.results || [],
    weeks: weekSeries,
    households: summarizeHouseholds(householdRows),
    pledges: pledgeSummary,
  });
}

export function yearElapsedShare(asOf) {
  const year = Number(asOf.slice(0, 4));
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return Math.min(1, Math.max(0, (Date.parse(`${asOf}T00:00:00Z`) + 864e5 - start) / (end - start)));
}

// ── Named detail: statements and nudges ──────────────────────────────────────────────────────

async function readNamedWindows(db, asOf) {
  const recentStart = shiftDay(asOf, -181);
  const priorStart = shiftDay(asOf, -364);
  const quietStart = shiftDay(asOf, -89);
  const regularStart = shiftDay(asOf, -454);
  return (await db.prepare(
    `SELECT ${HOUSEHOLD_KEY} AS hk,
            MAX(CASE WHEN p.household_id IS NOT NULL AND p.household_id != 0 THEN h.name ELSE p.first_name || ' ' || p.last_name END) AS name,
            MAX(ge.contribution_date) AS last_day,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS recent_cents,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS prior_cents,
            COUNT(DISTINCT CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN substr(ge.contribution_date,1,7) END) AS regular_months,
            SUM(CASE WHEN ge.contribution_date BETWEEN ? AND ? THEN ge.amount ELSE 0 END) AS regular_cents
       FROM giving_entries ge
       JOIN people p ON p.id=ge.person_id
       LEFT JOIN households h ON h.id=p.household_id
      WHERE ge.contribution_date BETWEEN ? AND ?
        AND LOWER(COALESCE(p.member_type,'')) != 'organization'
      GROUP BY hk`
  ).bind(
    recentStart, asOf,
    priorStart, shiftDay(recentStart, -1),
    regularStart, shiftDay(quietStart, -1),
    regularStart, shiftDay(quietStart, -1),
    regularStart, asOf,
  ).all()).results || [];
}

function half(asOf) {
  return `${asOf.slice(0, 4)}-H${Number(asOf.slice(5, 7)) <= 6 ? 1 : 2}`;
}

function quarter(asOf) {
  return `${asOf.slice(0, 4)}-Q${Math.ceil(Number(asOf.slice(5, 7)) / 3)}`;
}

export function buildNudges({ asOf, households, firstGifts, pledges }) {
  const out = { first_time: [], stopped: [], giving_down: [], pledge_behind: [], stepped_up: [] };
  for (const g of firstGifts) {
    out.first_time.push({
      subject_key: `ge${g.person_id}:${g.first_day}`, episode: g.first_day, name: g.name,
      detail: `First gift ${humanDay(g.first_day)} · ${g.funds || 'gift'}`, cents: g.cents, method: g.methods || '',
      sort: g.first_day,
    });
  }
  const quietStart = shiftDay(asOf, -89);
  const halfKey = half(asOf);
  for (const h of households) {
    const recent = h.recent_cents || 0;
    const prior = h.prior_cents || 0;
    // Four or more giving months, so a quarterly giver between gifts is not flagged.
    if (h.regular_months >= 4 && h.last_day < quietStart) {
      out.stopped.push({
        subject_key: h.hk, episode: h.last_day, name: h.name,
        detail: `Last gift ${humanDay(h.last_day)} · gave in ${h.regular_months} of the 12 months before that quiet spell`,
        cents: h.regular_cents || 0, sort: h.regular_cents || 0,
      });
    } else if (prior >= 50000 && recent > 0 && recent < prior * 0.5) {
      out.giving_down.push({
        subject_key: h.hk, episode: halfKey, name: h.name,
        detail: `Last 6 months ${dollars(recent)} · the 6 before ${dollars(prior)}`,
        cents: prior - recent, sort: prior - recent,
      });
    } else if (prior > 0 && recent >= prior * 1.5 && recent - prior >= 50000) {
      out.stepped_up.push({
        subject_key: h.hk, episode: halfKey, name: h.name,
        detail: `Last 6 months ${dollars(recent)} · the 6 before ${dollars(prior)}`,
        cents: recent - prior, sort: recent - prior,
      });
    }
  }
  const elapsed = yearElapsedShare(asOf);
  if (elapsed >= 0.25) {
    for (const p of pledges) {
      const expected = Math.round(p.amount_cents * elapsed);
      if (p.received_cents < expected * 0.75) {
        out.pledge_behind.push({
          subject_key: `p:${p.person_id}`, episode: quarter(asOf), name: p.name,
          detail: `Pledged ${dollars(p.amount_cents)} · received ${dollars(p.received_cents)} (${Math.round(elapsed * 100)}% of the year gone)`,
          cents: expected - p.received_cents, sort: expected - p.received_cents,
        });
      }
    }
  }
  for (const kind of Object.keys(out)) {
    out[kind].sort((a, b) => (kind === 'first_time' ? String(b.sort).localeCompare(String(a.sort)) : b.sort - a.sort));
    out[kind] = out[kind].map(({ sort, ...rest }) => rest);
  }
  return out;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function humanDay(day) {
  const [y, m, d] = String(day || '').split('-').map(Number);
  return y ? `${MONTH_NAMES[m - 1]} ${d}, ${y}` : '';
}

function dollars(cents) {
  return `$${Math.round((cents || 0) / 100).toLocaleString('en-US')}`;
}

// GET giving-analytics-people-v1?as_of=YYYY-MM-DD — statements status and nudges, named.
export async function respondWithGivingAnalyticsPeopleV1(url, db) {
  const asOf = resolveAsOf(url);
  const year = Number(asOf.slice(0, 4));
  const firstFrom = shiftDay(asOf, -59);
  const [households, firstGifts, pledges, followups, thanked, sends, staff, givingHouseholds] = await Promise.all([
    readNamedWindows(db, asOf),
    db.prepare(
      `SELECT f.person_id, f.first_day, p.first_name || ' ' || p.last_name AS name,
              (SELECT SUM(ge.amount) FROM giving_entries ge WHERE ge.person_id=f.person_id AND ge.contribution_date=f.first_day) AS cents,
              (SELECT GROUP_CONCAT(DISTINCT fu.name) FROM giving_entries ge JOIN funds fu ON fu.id=ge.fund_id
                WHERE ge.person_id=f.person_id AND ge.contribution_date=f.first_day) AS funds,
              (SELECT GROUP_CONCAT(DISTINCT ge.method) FROM giving_entries ge
                WHERE ge.person_id=f.person_id AND ge.contribution_date=f.first_day) AS methods
         FROM (SELECT person_id, MIN(contribution_date) AS first_day FROM giving_entries
                WHERE person_id IS NOT NULL AND contribution_date != '' GROUP BY person_id) f
         JOIN people p ON p.id=f.person_id
        WHERE f.first_day BETWEEN ? AND ?
          AND LOWER(COALESCE(p.member_type,'')) != 'organization'
        ORDER BY f.first_day DESC LIMIT 60`
    ).bind(firstFrom, asOf).all(),
    db.prepare(
      `SELECT pl.person_id, pl.amount_cents, p.first_name || ' ' || p.last_name AS name,
              COALESCE((SELECT SUM(ge.amount) FROM giving_entries ge
                         WHERE ge.person_id=pl.person_id AND ge.contribution_date BETWEEN ? AND ?),0) AS received_cents
         FROM pledges pl JOIN people p ON p.id=pl.person_id
        WHERE pl.fiscal_year=? AND pl.amount_cents > 0`
    ).bind(`${year}-01-01`, asOf, year).all(),
    db.prepare(`SELECT kind, subject_key, episode, assigned_to, status, done_at, done_by FROM giving_followups`).all(),
    // A first gift thanked from Connect's receipt queue is already done: same recipient key.
    db.prepare(`SELECT recipient_key FROM giving_letter_sends WHERE letter_type='thank_you' AND recipient_key LIKE 'ge%'`).all(),
    db.prepare(
      `SELECT year, letter_type, channel, COUNT(*) AS n, MAX(sent_at) AS last_sent
         FROM giving_letter_sends WHERE letter_type IN ('year_end','midyear','quarterly')
        GROUP BY year, letter_type, channel ORDER BY last_sent DESC LIMIT 40`
    ).all(),
    db.prepare(
      `SELECT username, display_name FROM app_users
        WHERE active=1 AND role IN ('admin','staff','finance') ORDER BY display_name, username`
    ).all(),
    db.prepare(
      `SELECT COUNT(DISTINCT ${HOUSEHOLD_KEY}) AS n FROM giving_entries ge JOIN people p ON p.id=ge.person_id
        WHERE ge.contribution_date BETWEEN ? AND ? AND LOWER(COALESCE(p.member_type,'')) != 'organization'`
    ).bind(`${year}-01-01`, asOf).first(),
  ]);

  const state = new Map((followups.results || []).map((f) => [`${f.kind}|${f.subject_key}|${f.episode}`, f]));
  const thankedKeys = new Set((thanked.results || []).map((r) => r.recipient_key));
  const nudges = buildNudges({ asOf, households, firstGifts: firstGifts.results || [], pledges: pledges.results || [] });
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const kinds = Object.entries(NUDGE_KINDS).map(([key, label]) => {
    const items = nudges[key].map((n) => {
      const f = state.get(`${key}|${n.subject_key}|${n.episode}`);
      const thankedInConnect = key === 'first_time' && thankedKeys.has(n.subject_key);
      return { ...n, assigned_to: f?.assigned_to || '', done: f?.status === 'done' || thankedInConnect, thanked_in_connect: thankedInConnect };
    });
    const open = items.filter((i) => !i.done);
    return { key, label, open_count: open.length, items: open.slice(0, NUDGE_LIST_LIMIT) };
  });
  const doneThisMonth = (followups.results || []).filter((f) => f.status === 'done' && f.done_at >= monthStart).length;

  const runs = new Map();
  for (const s of sends.results || []) {
    const key = `${s.year}|${s.letter_type}`;
    const run = runs.get(key) || { year: s.year, letter_type: s.letter_type, email: 0, print: 0, last_sent: '' };
    run[s.channel === 'print' ? 'print' : 'email'] += s.n;
    if (s.last_sent > run.last_sent) run.last_sent = s.last_sent;
    runs.set(key, run);
  }

  return json({
    contract: 'connect.giving-analytics-people.v1',
    as_of: asOf,
    year,
    nudges: { kinds, done_this_month: doneThisMonth },
    statements: {
      runs: [...runs.values()].sort((a, b) => b.last_sent.localeCompare(a.last_sent)).slice(0, 12),
      giving_households_ytd: givingHouseholds?.n || 0,
    },
    staff: (staff.results || []).map((u) => ({ username: u.username, name: u.display_name || u.username })),
  });
}

// ── Follow-up write ──────────────────────────────────────────────────────────────────────────
const SUBJECT_RE = /^(?:h:\d{1,9}|p:\d{1,9}|ge\d{1,9}:\d{4}-\d{2}-\d{2})$/;
const EPISODE_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{4}-H[12]|\d{4}-Q[1-4])$/;

export async function applyGivingFollowupWrite(db, body, email) {
  const op = String(body?.op || '');
  const kind = String(body?.kind || '');
  const subjectKey = String(body?.subject_key || '');
  const episode = String(body?.episode || '');
  if (!['assign', 'done', 'reopen'].includes(op)) return { status: 400, error: 'Unknown action' };
  if (!NUDGE_KINDS[kind]) return { status: 400, error: 'Unknown nudge kind' };
  if (!SUBJECT_RE.test(subjectKey) || !EPISODE_RE.test(episode)) return { status: 400, error: 'That nudge could not be identified' };

  let assignedTo = null;
  if (op === 'assign') {
    assignedTo = String(body?.assigned_to || '').trim();
    if (assignedTo) {
      const user = await db.prepare(`SELECT username FROM app_users WHERE username=? AND active=1`).bind(assignedTo).first();
      if (!user) return { status: 400, error: 'Choose an active staff account' };
    }
  }
  await db.prepare(
    `INSERT INTO giving_followups (kind, subject_key, episode, assigned_to, status, done_at, done_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, subject_key, episode) DO UPDATE SET
       assigned_to = CASE WHEN ? THEN excluded.assigned_to ELSE giving_followups.assigned_to END,
       status = CASE WHEN ? THEN excluded.status ELSE giving_followups.status END,
       done_at = CASE WHEN ? THEN excluded.done_at ELSE giving_followups.done_at END,
       done_by = CASE WHEN ? THEN excluded.done_by ELSE giving_followups.done_by END,
       updated_at = datetime('now')`
  ).bind(
    kind, subjectKey, episode, assignedTo || '',
    op === 'done' ? 'done' : 'open',
    op === 'done' ? new Date().toISOString().slice(0, 10) : '',
    op === 'done' ? email : '',
    op === 'assign' ? 1 : 0,
    op === 'assign' ? 0 : 1,
    op === 'assign' ? 0 : 1,
    op === 'assign' ? 0 : 1,
  ).run();
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES(?, 'giving_followups', NULL, '', ?, '', ?)`
  ).bind(`giving_followup_${op}_via_finance`, `${kind}:${subjectKey}:${episode}`, email).run().catch(() => {});
  return { status: 200, ok: true };
}

export async function handleGivingAnalyticsContracts(req, env, path) {
  if (path === '/api/contracts/giving-analytics-v1' && req.method === 'GET') {
    const auth = await authorizeGivingAnalyticsContract(req, env, { level: 'aggregate' });
    if (auth.response) return auth.response;
    return respondWithGivingAnalyticsV1(new URL(req.url), env.DB);
  }
  if (path === '/api/contracts/giving-analytics-people-v1' && req.method === 'GET') {
    const auth = await authorizeGivingAnalyticsContract(req, env, { level: 'people' });
    if (auth.response) return auth.response;
    return respondWithGivingAnalyticsPeopleV1(new URL(req.url), env.DB);
  }
  if (path === '/api/contracts/giving-followup-write-v1' && req.method === 'POST') {
    const auth = await authorizeGivingAnalyticsContract(req, env, { level: 'write' });
    if (auth.response) return auth.response;
    let body = {};
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const result = await applyGivingFollowupWrite(env.DB, body, auth.email);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
  }
  return null;
}
