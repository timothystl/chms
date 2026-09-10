// ── Real transport for Website's payroll email route ────────────────────────
// Unlike payroll-proxy-client.js's callPayrollProxy (which reaches Website's
// generic /sb/* Supabase RPC proxy), this calls one specific, non-Supabase
// Website Worker route -- /payroll/email -- that builds and sends the
// bookkeeper's report itself (Brevo, CSV/PDF attachments, the 12-hour
// already-sent dedup). No Supabase apikey/Authorization headers belong here;
// this never reaches PostgREST at all.
//
// Same two-part proof as the RPC relay: the shared X-Contract-Key secret
// (proves the call came from Finance's Worker) plus the forwarded
// Cf-Access-Jwt-Assertion header (proves WHICH admin is acting -- Website
// independently verifies it and checks payroll_manage; see PR #587 in the
// website repo, which taught /payroll/email to accept this identity the same
// way /sb/* already did).
//
// Never throws. Every failure mode -- not configured, no Access identity, a
// network error, malformed JSON, or Website's own refusal -- resolves to
// { ok: false, reason }. An "already emailed today" answer is its own
// reason (not an error): the caller decides whether to show a resend
// confirmation, matching Website's own confirm()-before-resend behavior.
const REQUEST_TIMEOUT_MS = 15000; // the report attaches a CSV and a PDF; give Brevo real time

export async function postPayrollEmailReport(env, accessJwt, body) {
  const binding = env.PAYROLL_SERVICE;
  const key = env.FINANCE_PAYROLL_CONTRACT_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://admin.timothystl.org/payroll/email';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'X-Contract-Key': key,
        'Cf-Access-Jwt-Assertion': accessJwt,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }

  let text;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_json', status: res.status, bodyPreview: text.slice(0, 200) };
  }

  // A real question, not a refusal -- Website answers this as a 200 the
  // browser client reads specially, and a resend needs force:true, never a
  // second distinct route.
  if (payload.already_sent) {
    return { ok: false, reason: 'already_sent', alreadySentAt: payload.last_sent_at || null, alreadySentTo: payload.last_sent_to || null };
  }
  if (!res.ok || payload.error) return { ok: false, reason: 'http_error', status: res.status, message: payload.error };
  return { ok: true, to: payload.to };
}
