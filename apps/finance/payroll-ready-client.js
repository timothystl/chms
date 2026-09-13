// ── Real transport for Website's "payroll ready" push notification ──────────
// Same shape as payroll-email-client.js's postPayrollEmailReport, but for
// Website's /api/push/payroll-ready route: a one-way "notify the bookkeeper's
// subscribed devices" trigger, not a report-building/sending action. Website
// dedupes by period server-side (an INSERT into payroll_ready_notified that
// only the first caller for a given period wins), so calling this more than
// once for the same period is always a safe no-op, never a duplicate push.
//
// Same two-part proof as every other payroll contract-relay call: the shared
// X-Contract-Key secret (proves the call came from Finance's Worker) plus the
// forwarded Cf-Access-Jwt-Assertion header (proves WHICH admin is acting --
// Website independently verifies it and checks payroll_manage; see the
// website repo's payrollContractRelayUser, extended to this route the same
// way PRs #586/#587 taught /sb/* and /payroll/email to accept it).
//
// Never throws. Every failure mode -- not configured, no Access identity, a
// network error, malformed JSON, or Website's own refusal -- resolves to
// { ok: false, reason }.
const REQUEST_TIMEOUT_MS = 4000;

export async function postPayrollReadyNotification(env, accessJwt, { periodStart, periodLabel }) {
  const binding = env.PAYROLL_SERVICE;
  const key = env.FINANCE_PAYROLL_CONTRACT_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://admin.timothystl.org/api/push/payroll-ready';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'X-Contract-Key': key,
        'Cf-Access-Jwt-Assertion': accessJwt,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ periodStart, periodLabel }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!res.ok || payload.error) return { ok: false, reason: 'http_error', status: res.status, message: payload.error };
  return { ok: true };
}
