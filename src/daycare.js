// Daycare app finance API client — a separate Claude-Code-built app with its own bookkeeping.
// Mirrors makeBreezeClient's null-when-unconfigured convention. See SECRETS.md for the
// response contract. DAYCARE_API_URL is the COMPLETE endpoint URL (not a base domain to
// append a path to) — the daycare app's actual implementation is a Supabase Edge Function
// at its own specific path (e.g. https://<project>.supabase.co/functions/v1/finance-summary),
// not a fixed /api/finance/summary route on a conventional host.
export function daycareConfigured(env) {
  return !!(env.DAYCARE_API_URL && env.DAYCARE_API_KEY);
}

export function makeDaycareClient(env) {
  if (!daycareConfigured(env)) return null;
  return {
    summary: () => fetch(env.DAYCARE_API_URL, {
      headers: { 'X-Api-Key': env.DAYCARE_API_KEY, 'Accept': 'application/json' },
    }),
  };
}
