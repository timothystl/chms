// Daycare app finance API client — a separate Claude-Code-built app with its own bookkeeping.
// Mirrors makeBreezeClient's null-when-unconfigured convention. See SECRETS.md for the
// contract the daycare app's /api/finance/summary endpoint must implement.
export function daycareConfigured(env) {
  return !!(env.DAYCARE_API_URL && env.DAYCARE_API_KEY);
}

export function makeDaycareClient(env) {
  if (!daycareConfigured(env)) return null;
  const base = env.DAYCARE_API_URL.replace(/\/$/, '');
  return {
    summary: () => fetch(`${base}/api/finance/summary`, {
      headers: { 'X-Api-Key': env.DAYCARE_API_KEY, 'Accept': 'application/json' },
    }),
  };
}
