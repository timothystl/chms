// Daycare app finance API client — a separate Claude-Code-built app with its own bookkeeping.
// Mirrors makeBreezeClient's null-when-unconfigured convention. See SECRETS.md for the
// response contract. DAYCARE_API_URL is the COMPLETE endpoint URL (not a base domain to
// append a path to) — the daycare app's actual implementation is a Supabase Edge Function
// at its own specific path (e.g. https://<project>.supabase.co/functions/v1/finance-summary),
// not a fixed /api/finance/summary route on a conventional host.
export function daycareConfigured(env) {
  return !!(env.DAYCARE_API_URL && env.DAYCARE_API_KEY);
}

// DAYCARE_ROOMS_API_URL is a SECOND complete endpoint URL, separate from the summary one above,
// for the room-level monthly aggregates the rebuilt Daycare Report reads (capacity/day, average
// daily enrolled, billed revenue, labor cost, waitlist count — see DAYCARE_API.md in the design
// handoff). It does not exist in the daycare app yet; until it is built and the secret is set,
// `rooms` is simply absent from the client and the report degrades to its category-by-year table.
export function daycareRoomsConfigured(env) {
  return !!(env.DAYCARE_ROOMS_API_URL && env.DAYCARE_API_KEY);
}

export function makeDaycareClient(env) {
  if (!daycareConfigured(env) && !daycareRoomsConfigured(env)) return null;
  const headers = { 'X-Api-Key': env.DAYCARE_API_KEY, 'Accept': 'application/json' };
  const client = {};
  if (daycareConfigured(env)) client.summary = () => fetch(env.DAYCARE_API_URL, { headers });
  if (daycareRoomsConfigured(env)) client.rooms = () => fetch(env.DAYCARE_ROOMS_API_URL, { headers });
  return client;
}
