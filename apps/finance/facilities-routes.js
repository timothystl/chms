// Form-post handler for the Facilities writers (see facilities-service.js). Every request must
// come from this app's own pages (same-origin), carry a verified Connect identity, and belong to
// a role allowed to edit Finance records: admin, or a role whose Finance permission is "edit".
// Results redirect back to the page with a short status the page shows.
import { fetchVerifiedRole } from './connect-role-client.js';
import { FACILITIES_WRITERS, FacilitiesValidationError } from './facilities-service.js';

export function canEditFacilities(roleResult) {
  if (!roleResult || !roleResult.ok) return false;
  if (roleResult.role === 'admin') return true;
  return ['finance', 'staff'].includes(roleResult.role) && roleResult.permissions?.finance === 'edit';
}

// Browsers send Sec-Fetch-Site and Origin on form posts; a cross-site post is refused before any
// identity check or database work. Requests without either header (non-browser tools) still need
// a verified Access identity below.
export function isSameOriginPost(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null') {
    try { if (new URL(origin).host !== url.host) return false; } catch { return false; }
  } else if (origin === 'null') return false;
  return true;
}

function back(page, params) {
  const search = new URLSearchParams({ section: 'facilities', page, ...params });
  return new Response(null, { status: 303, headers: { Location: `/?${search.toString()}` } });
}

export async function handleFacilitiesWrite(request, env, routeId, url) {
  const writer = FACILITIES_WRITERS[routeId];
  if (!isSameOriginPost(request, url)) return back(writer.page, { status: 'error', reason: 'cross_site' });
  const roleResult = await fetchVerifiedRole(env, request.headers.get('Cf-Access-Jwt-Assertion') || '');
  if (!canEditFacilities(roleResult)) return back(writer.page, { status: 'error', reason: 'access_denied' });
  let form;
  try {
    form = Object.fromEntries((await request.formData()).entries());
  } catch {
    return back(writer.page, { status: 'error', reason: 'invalid_form' });
  }
  try {
    const result = await writer.run(env.FINANCE_DB, form, roleResult.identity || roleResult.role);
    const extra = routeId === 'facilities-asset-save-v1' && result.id ? { asset: String(result.id) } : {};
    return back(writer.page, { status: 'ok', ...extra });
  } catch (error) {
    if (error instanceof FacilitiesValidationError) return back(writer.page, { status: 'error', reason: 'invalid', message: error.message });
    return back(writer.page, { status: 'error', reason: 'write_failed' });
  }
}

export function describeFacilitiesStatus(params) {
  const status = params.get('status');
  if (status === 'ok') return { ok: true, message: 'Saved.' };
  if (status !== 'error') return null;
  switch (params.get('reason')) {
    case 'access_denied': return { ok: false, message: 'Your verified role cannot edit Facilities records. Nothing was saved.' };
    case 'cross_site': return { ok: false, message: 'That form did not come from Timothy Finance. Nothing was saved.' };
    case 'invalid': return { ok: false, message: `${String(params.get('message') || 'Check the form and try again.').slice(0, 200)} Nothing was saved.` };
    case 'invalid_form': return { ok: false, message: 'The form could not be read. Nothing was saved.' };
    default: return { ok: false, message: 'The save failed. Nothing was changed — please try again.' };
  }
}
