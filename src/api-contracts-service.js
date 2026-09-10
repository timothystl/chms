// ── Cross-Worker server-to-server contract endpoints ────────────────────────
// Called from the Finance application (staging today; production once Finance
// has its own Worker), not from a browser or a staff session directly. Every
// route here requires the X-Contract-Key header matching env.FINANCE_CONTRACT_API_KEY
// -- the same shared-secret pattern already used for the website's intake and
// Christmas Market calls into this Worker (see api-intake.js, api-scheduler.js).
// This stays a distinct, narrower grant from the human role/permission matrix in
// api-chms.js: it reaches nothing but the contracts named below.
import { json, timingSafeEqual } from './auth.js';
import { respondWithConnectGivingSummaryV1, respondWithFinanceDataStatusV1 } from './api-contracts.js';
import { verifyAccessJwt } from './access-jwt.js';
import { getRolePermissions, permissionsForRole } from './api-utils.js';
import { recordQuickGivingEntry } from './api-giving.js';

export async function handleContractsServiceApi(req, env, path) {
  const expectedKey = env.FINANCE_CONTRACT_API_KEY || '';
  if (!expectedKey) return json({ error: 'Contract service not configured' }, 503);
  const key = req.headers.get('X-Contract-Key') || '';
  if (!(await timingSafeEqual(key, expectedKey))) return json({ error: 'Unauthorized' }, 401);

  if (path === '/api/contracts/connect-giving-summary-v1' && req.method === 'GET') {
    return respondWithConnectGivingSummaryV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-data-status-v1' && req.method === 'GET') {
    return respondWithFinanceDataStatusV1(env.DB);
  }

  if (path === '/api/contracts/giving-quick-entry-v1' && req.method === 'POST') {
    return handleGivingQuickEntryContract(req, env);
  }

  return json({ error: 'Not found' }, 404);
}

// ── Giving quick-entry, relayed from Finance's own UI ───────────────────────
// The X-Contract-Key check above only proves the CALL came from Finance's Worker.
// This proves WHO Finance says is acting: Finance forwards the Cf-Access-Jwt-Assertion
// header Cloudflare Access already attached to the bookkeeper's own request, and
// Connect independently verifies that signature against Access's own published
// keys (access-jwt.js) rather than trusting whatever Finance forwards. The
// verified email is then checked against Connect's own app_users + role/permission
// matrix -- requiring edit-level `giving` permission specifically, since this is a
// write, not just any finance-role read access -- so someone who couldn't enter a
// gift in Connect directly can't do it through Finance either.
async function handleGivingQuickEntryContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, user.role);
  const canEnterGiving = user.role === 'admin' || rolePerms.giving === 'edit';
  if (!canEnterGiving) return json({ error: 'Access denied' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const result = await recordQuickGivingEntry(db, body);
  if (result.error) return json(result, 400);

  // Best-effort audit trail -- who entered this gift, and via which surface.
  // Reuses the existing generic audit_log table (same one people-record and
  // finance-clear actions already write to) rather than adding a new column to
  // giving_entries; never blocks the entry itself if this insert fails.
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('giving_quick_entry_via_finance','giving_entries',?,?,'entered_by','',?)`
  ).bind(result.id, '', email).run().catch(() => {});

  return json({ ...result, enteredBy: user.username });
}
