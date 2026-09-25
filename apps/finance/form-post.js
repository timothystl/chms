// Shared handler for Finance-owned form writers (Facilities, HR). A post must come from this
// app's own pages, carry a verified Connect identity, and pass the writer's own role check before
// any database work. The result redirects back to the page with a short status it can show.
import { fetchVerifiedRole } from './connect-role-client.js';
import { FormValidationError } from './form-fields.js';

// Browsers send Sec-Fetch-Site and Origin on form posts; a cross-site post is refused before any
// identity check. Sec-Fetch-Site is browser-controlled and decides on its own when present:
// under a no-referrer policy a genuine same-origin post carries `Origin: null`, which must not be
// read as cross-site. Origin is the fallback for browsers without Fetch Metadata. Requests
// without either header (non-browser tools) still need a verified Access identity.
export function isSameOriginPost(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return ['same-origin', 'none'].includes(site);
  const origin = request.headers.get('Origin');
  if (origin === 'null') return false;
  if (origin) {
    try { if (new URL(origin).host !== url.host) return false; } catch { return false; }
  }
  return true;
}

function back(section, page, params) {
  const search = new URLSearchParams({ section, page, ...params });
  return new Response(null, { status: 303, headers: { Location: `/?${search.toString()}` } });
}

export async function handleFinanceFormWrite({ request, env, url, section, writer, canEdit }) {
  if (!isSameOriginPost(request, url)) return back(section, writer.page, { status: 'error', reason: 'cross_site' });
  const roleResult = await fetchVerifiedRole(env, request.headers.get('Cf-Access-Jwt-Assertion') || '');
  if (!canEdit(roleResult)) return back(section, writer.page, { status: 'error', reason: 'access_denied' });
  // Writers that accept file uploads set maxBytes; everything else is ordinary form text.
  const declaredBytes = Number(request.headers.get('Content-Length') || 0);
  if (declaredBytes > (writer.maxBytes || MAX_FORM_BYTES)) return back(section, writer.page, { status: 'error', reason: 'too_large' });
  let formData;
  let form;
  try {
    formData = await request.formData();
    form = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === 'string'));
  } catch {
    return back(section, writer.page, { status: 'error', reason: 'invalid_form' });
  }
  // A writer may name the page to return to (e.g. the record a file was attached to).
  const failPage = String(form.return_page || '') && /^[a-z-]{1,40}$/.test(form.return_page) ? form.return_page : writer.page;
  try {
    const result = await writer.run(env.FINANCE_DB, form, roleResult.identity || roleResult.role, { formData, bucket: env.FACILITY_FILES });
    const extra = writer.returnParam && result?.id ? { [writer.returnParam]: String(result.id) } : {};
    const keep = Object.fromEntries((writer.keepParams || []).filter((key) => form[key]).map((key) => [key, String(form[key])]));
    return back(section, result?.page || writer.page, { status: 'ok', ...keep, ...extra, ...(result?.params || {}) });
  } catch (error) {
    if (error instanceof FormValidationError) return back(section, failPage, { status: 'error', reason: 'invalid', message: error.message, ...returnParams(form) });
    return back(section, failPage, { status: 'error', reason: 'write_failed', ...returnParams(form) });
  }
}

const MAX_FORM_BYTES = 1024 * 1024;

// Keeps the person on the record they were working on when a save fails.
function returnParams(form) {
  const out = {};
  for (const key of ['asset', 'task', 'entry', 'project']) {
    if (/^\d{1,12}$/.test(String(form[`return_${key}`] || ''))) out[key] = String(form[`return_${key}`]);
  }
  return out;
}

export function describeFormStatus(params, what) {
  const status = params.get('status');
  if (status === 'ok') return { ok: true, message: 'Saved.' };
  if (status !== 'error') return null;
  switch (params.get('reason')) {
    case 'access_denied': return { ok: false, message: `Your verified role cannot edit ${what} records. Nothing was saved.` };
    case 'cross_site': return { ok: false, message: 'That form did not come from Timothy Finance. Nothing was saved.' };
    case 'invalid': return { ok: false, message: `${String(params.get('message') || 'Check the form and try again.').slice(0, 200)} Nothing was saved.` };
    case 'invalid_form': return { ok: false, message: 'The form could not be read. Nothing was saved.' };
    case 'too_large': return { ok: false, message: 'Those files are too large to send at once. Attach fewer or smaller files. Nothing was saved.' };
    default: return { ok: false, message: 'The save failed. Nothing was changed — please try again.' };
  }
}
