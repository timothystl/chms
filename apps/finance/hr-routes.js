// HR & Staff form posts (see hr-service.js) through the shared Finance form handler. HR holds
// personnel records, so only a verified admin may edit, matching the section's admin-only read.
import { HR_WRITERS } from './hr-service.js';
import { ensureFinanceOwnedSchema } from './finance-owned-schema.js';
import { describeFormStatus, handleFinanceFormWrite } from './form-post.js';

export function canEditHr(roleResult) {
  return Boolean(roleResult && roleResult.ok && roleResult.role === 'admin');
}

export async function handleHrWrite(request, env, routeId, url) {
  await ensureFinanceOwnedSchema(env.FINANCE_DB, 'hr');
  return handleFinanceFormWrite({ request, env, url, section: 'hr', writer: HR_WRITERS[routeId], canEdit: canEditHr });
}

export function describeHrStatus(params) {
  return describeFormStatus(params, 'HR');
}
