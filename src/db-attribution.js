// ── Per-request D1 query-count attribution ──────────────────────────────────────
// Overhaul goal 5 (observability): the D1 usage spike that prompted this goal was hard to
// root-cause because nothing recorded which route ran how many queries. apps/finance's
// query-budget.js already solved this for the new Finance rewrite by *enforcing* a declared
// limit per named report. That pattern can't be retrofitted onto the old, much larger
// src/api-finance.js and src/api-chms.js without first knowing what each of their routes
// actually costs today — so this is the observational half: count, log, don't enforce.
//
// Wrapping env.DB once, at the single /admin/api/* dispatch chokepoint (see handleAdminApi in
// api-admin.js), means every handler downstream — old Finance, Reports, Giving, People,
// Households, Import, TuitionAid, Contracts, Users, and the admin-facing Scheduler routes —
// gets attributed for free through the env it already receives as a parameter. No handler file
// needs to change.

/** Wraps a D1Database so every prepare() call is counted. Never throws; a missing/undefined
 *  db passes through unwrapped with a counter that stays at zero.
 *
 *  Deliberately does NOT also wrap the returned prepared-statement objects (e.g. to time
 *  individual first()/all()/run() calls) — those are native Workers-runtime bindings, and at
 *  least one real call path (giving-rollups.js's ensureGivingYearRollups) passes several of
 *  them straight into db.batch([...]), which a proxied statement is not guaranteed to survive
 *  (native bindings that check internal/private state on the exact object can reject a Proxy
 *  standing in for it). Request-level duration (see handleAdminApi and its counterparts) gets
 *  the same "was this route slow" signal without touching statement objects at all. */
export function wrapDbForAttribution(db) {
  const counter = { queries: 0, elapsedMs: 0, names: [] };
  if (!db) return { db, counter };
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      // Lets namedQuery() below find this request's counter from the db/env it was handed,
      // without every call site needing to thread the counter through as its own parameter.
      if (prop === '__attributionCounter') return counter;
      if (prop === 'prepare') {
        return (...args) => {
          counter.queries += 1;
          return target.prepare(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { db: wrapped, counter };
}

/** Tags this request's attribution counter with a human name for a specific query, then
 *  prepares it as normal. Purely observational (adds to `counter.names`, changes nothing about
 *  execution) and safe to call with an unwrapped db (falls through to plain db.prepare(sql)) —
 *  so a call site can adopt it without knowing whether it's reachable through an attributed
 *  chokepoint today. Start with a route's known-heaviest query rather than every query: the
 *  goal is naming the query a future spike is likely to be, not tagging everything. */
export function namedQuery(db, name, sql) {
  const counter = db && db.__attributionCounter;
  if (counter) counter.names.push(name);
  return db.prepare(sql);
}

/** Wraps env so env.DB resolves to the counting proxy above; every other binding (KV, R2,
 *  secrets, service bindings) passes through untouched. */
export function wrapEnvForDbAttribution(env) {
  const { db, counter } = wrapDbForAttribution(env.DB);
  const wrapped = new Proxy(env, {
    get(target, prop, receiver) {
      return prop === 'DB' ? db : Reflect.get(target, prop, receiver);
    },
  });
  return { env: wrapped, counter };
}

// Chosen well above every route's normal usage — the heaviest budgeted report in the new
// Finance rewrite (apps/finance/query-budget.js) allows 4 SELECTs. This is observational, not
// enforced, so a route that legitimately needs more never breaks; it just becomes visible.
export const ADMIN_API_QUERY_LOG_THRESHOLD = 15;

// A duration signal independent of the count above — a route with one legitimately expensive
// full-table scan can clear this without ever approaching 15 queries, which is exactly the
// class of miss the query-count-only version of this wrapper had. 500ms is a first guess
// ("clearly not an indexed point lookup"), not a measured baseline; revisit once real
// Cloudflare Logs data accumulates against it the way the count threshold above was chosen
// against a real known-heaviest report (see architecture/evidence/2026-09-13-observability-
// inventory.md in the digital-architecture repo, recommendation 2).
export const ADMIN_API_DURATION_LOG_THRESHOLD_MS = 500;

/** Emits one structured, greppable Cloudflare Logs line for a route whose D1 usage this
 *  request was notable, so a future spike can be attributed to a route (and, where call sites
 *  have adopted namedQuery(), a specific query) without guesswork. counter.elapsedMs is the
 *  attributed chokepoint's own wall-clock duration, not isolated D1 time — see wrapDbForAttribution's
 *  comment for why per-query timing isn't done.
 *
 *  `thresholds` lets a caller whose normal shape doesn't look like a single web request (e.g.
 *  the once-daily cron, which legitimately runs more queries and takes longer than any admin
 *  route) override the two web-request-calibrated defaults above instead of being measured
 *  against them. */
export function logDbAttribution(seg, method, counter, thresholds = {}) {
  const queryThreshold = thresholds.queryThreshold ?? ADMIN_API_QUERY_LOG_THRESHOLD;
  const durationThresholdMs = thresholds.durationThresholdMs ?? ADMIN_API_DURATION_LOG_THRESHOLD_MS;
  const overCount = counter.queries > queryThreshold;
  const overDuration = (counter.elapsedMs || 0) > durationThresholdMs;
  if (!overCount && !overDuration) return;
  const payload = { route: seg, method, queries: counter.queries, elapsed_ms: counter.elapsedMs };
  if (counter.names && counter.names.length) payload.names = counter.names;
  console.log('d1_query_attribution', JSON.stringify(payload));
}
