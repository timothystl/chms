// ── Real transport for Website's existing payroll proxy ─────────────────────
// Calls Website's already-hardened Supabase RPC proxy (tlc-admin-worker.js's
// /sb/* handler) via a Cloudflare service binding -- the same in-process,
// no-DNS pattern already used for CONNECT_SERVICE. Payroll's data and its 17
// SECURITY DEFINER Postgres functions stay exactly where they are (captured
// into version control in childcare-portal's payroll_proxy_functions_baseline_
// APPLIED.sql migration); this never talks to Supabase directly, and never
// sees Website's own PAYROLL_PROXY_SECRET -- that stays on Website's side,
// injected into the RPC body there, same as it already is for a browser call.
//
// Two things prove a call here is legitimate, same shape as the Giving relay:
// the shared X-Contract-Key secret (proves the call came from Finance's Worker
// at all) and the forwarded Cf-Access-Jwt-Assertion header (proves WHICH admin
// is acting -- Website independently verifies it and checks payroll_manage).
// Finance decides nothing about who is authorized; it only carries the
// identity through.
//
// Never throws. Every failure mode -- the binding/key not configured, no
// Access identity on the incoming request, a network error, a non-200
// response (which includes Website's own auth/permission refusals), or
// malformed JSON -- resolves to { ok: false, reason }. Only a genuine 200
// resolves to { ok: true, result }.
import { PAYROLL_RPC_FNS } from './payroll-rpc-fns.js';

const REQUEST_TIMEOUT_MS = 8000; // a year-totals or full-roster call is more than one gift entry

// The SAME anon-role Supabase key already public in website/admin/payroll.html's
// source (a browser downloads it on every visit to that page). Reusing the exact
// constant here is not a new exposure -- see childcare-portal's
// r26_complete_revoke_anon_staff_wages migration: anon carries zero table grants
// regardless of who holds this value. It identifies the Supabase project to
// PostgREST; the real gate is entirely server-side on Website's Worker.
const MDO_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhaGRzdG9wc3VteG5xdmRjbG15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzM3NDYsImV4cCI6MjA4NzcwOTc0Nn0.PGuSZcnwGaG0Tes6li04JeNBAKDP4oJ6eGwhuYYXO_E';

/**
 * Calls one of Website's existing payroll_* RPC functions through its proxy.
 * `fn` must be one of PAYROLL_RPC_FNS (checked here as a fail-fast local guard;
 * Website's own proxy is the real, authoritative allowlist either way).
 * `params` are the RPC's own named arguments -- never include p_secret, Website
 * adds that itself.
 */
export async function callPayrollProxy(env, accessJwt, fn, params) {
  const binding = env.PAYROLL_SERVICE;
  const key = env.FINANCE_PAYROLL_CONTRACT_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };
  if (!PAYROLL_RPC_FNS.includes(fn)) return { ok: false, reason: 'unknown_function' };

  const url = `https://admin.timothystl.org/sb/rest/v1/rpc/${fn}`;
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'X-Contract-Key': key,
        'Cf-Access-Jwt-Assertion': accessJwt,
        apikey: MDO_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${MDO_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params || {}),
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
    // A truncated preview of the real (non-JSON) body -- an HTML error page, a gateway
    // timeout, etc. -- is far more useful for diagnosing this than a bare "invalid_json"
    // with no other clue. Capped short since this is surfaced through a diagnostic route.
    return { ok: false, reason: 'invalid_json', status: res.status, bodyPreview: text.slice(0, 200) };
  }

  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status, message: payload?.message || payload?.error };
  return { ok: true, result: payload };
}
