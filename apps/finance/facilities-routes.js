// Facilities form posts (see facilities-service.js) through the shared Finance form handler.
// Editing needs a verified admin, or a finance/staff role whose Finance permission is "edit".
import { FACILITIES_WRITERS } from './facilities-service.js';
import { ensureFinanceOwnedSchema } from './finance-owned-schema.js';
import { describeFormStatus, handleFinanceFormWrite, isSameOriginPost } from './form-post.js';

export { isSameOriginPost };

export function canEditFacilities(roleResult) {
  if (!roleResult || !roleResult.ok) return false;
  if (roleResult.role === 'admin') return true;
  return ['finance', 'staff'].includes(roleResult.role) && roleResult.permissions?.finance === 'edit';
}

// The register and its attached-files index are created together.
export async function ensureFacilitiesSchema(db) {
  const register = await ensureFinanceOwnedSchema(db, 'facilities');
  const files = await ensureFinanceOwnedSchema(db, 'facilityFiles');
  return register && files;
}

export async function handleFacilitiesWrite(request, env, routeId, url) {
  await ensureFacilitiesSchema(env.FINANCE_DB);
  return handleFinanceFormWrite({ request, env, url, section: 'facilities', writer: FACILITIES_WRITERS[routeId], canEdit: canEditFacilities });
}

export function describeFacilitiesStatus(params) {
  return describeFormStatus(params, 'Facilities');
}
