// Breeze ChMS API client.
// Returns null when BREEZE_SUBDOMAIN or BREEZE_API_KEY are missing so callers
// can return a 503 without additional conditional logic.
// All methods return a raw fetch Response — callers retain their own .json() /
// .text() calls and error handling exactly as before.
export function makeBreezeClient(env) {
  const subdomain = env.BREEZE_SUBDOMAIN;
  const apiKey    = env.BREEZE_API_KEY;
  if (!subdomain || !apiKey) return null;

  const base = `https://${subdomain}.breezechms.com/api`;
  const hdrs = { 'Api-key': apiKey };

  // Core: build a full URL from a path + pre-built query string and fetch it.
  function get(pathWithQuery) {
    return fetch(`${base}/${pathWithQuery}`, { headers: hdrs });
  }

  // Build a query string from a plain params object.
  // Do NOT use this for any value that is already percent-encoded (e.g. filter_json) —
  // URLSearchParams would double-encode it. Use get() with a manually built string instead.
  function qs(params) {
    return new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
    ).toString();
  }

  return {
    // Exposed so handlers that pass hdrs inline still compile identically.
    hdrs,
    // Exposed for building non-API Breeze URLs (e.g. photo CDN paths).
    subdomain,

    // ── Giving ─────────────────────────────────────────────────────────────
    // Common params: start, end, details, limit, fund_id
    givingList: (params) => get(`giving/list?${qs(params)}`),

    // ── Audit log ──────────────────────────────────────────────────────────
    // Common params: details, limit, start, end, action
    // IMPORTANT: deletion events (contribution_deleted, bulk_contributions_deleted)
    // must use end=today (not the sync window end) so deletions made after the sync
    // window are still caught. The caller is responsible for passing the correct `end`.
    auditLog: (params) => get(`account/list_log?${qs(params)}`),

    // ── Funds ──────────────────────────────────────────────────────────────
    funds:    ()   => get('funds'),
    fund:     (id) => get(`funds/${id}`),

    // ── People ─────────────────────────────────────────────────────────────
    // `queryString` is a pre-built query string. Callers must build it manually
    // to avoid double-encoding issues with filter_json values.
    // Examples:
    //   breeze.people(`details=1&limit=${limit}&offset=${offset}`)
    //   breeze.people(`filter_json=${encodeURIComponent(...)}&limit=500&offset=0`)
    people: (queryString) => get(`people?${queryString}`),

    // Single person by Breeze ID — always requests details=1.
    // May return a single object, a wrapped {person:...}, or a one-element array
    // depending on Breeze API version. Callers normalise the response themselves.
    person: (id) => get(`people/${id}?details=1`),

    // ── Profile (field definitions) ────────────────────────────────────────
    // Returns an array of profile sections; each section has a `fields` array.
    // field_id (not id) is the key used in a person's `details` object.
    profile: () => get('profile'),

    // ── Tags ───────────────────────────────────────────────────────────────
    tags: () => get('tags/list_tags'),

    // ── Events / Attendance ────────────────────────────────────────────────
    // type=anonymous returns a headcount for the service instance.
    attendance: (instanceId) => get(`events/attendance/list?instance_id=${instanceId}&type=anonymous`),
  };
}
