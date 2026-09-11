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
 *  db passes through unwrapped with a counter that stays at zero. */
export function wrapDbForAttribution(db) {
  const counter = { queries: 0 };
  if (!db) return { db, counter };
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
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

/** Emits one structured, greppable Cloudflare Logs line for a route whose D1 usage this
 *  request was notable, so a future spike can be attributed to a route without guesswork. */
export function logDbAttribution(seg, method, counter) {
  if (counter.queries > ADMIN_API_QUERY_LOG_THRESHOLD) {
    console.log('d1_query_attribution', JSON.stringify({ route: seg, method, queries: counter.queries }));
  }
}
