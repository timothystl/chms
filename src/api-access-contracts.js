// ── connect.finance-access-roles.v1 ───────────────────────────────────────────────────────────
// Finance's Accounts & Data → Access & roles page. Roles and permissions stay in Connect
// (app_users and the role-permission matrix); this contract only reports them. The caller's
// Cf-Access-Jwt-Assertion is re-verified here, as in the Gift Entry contracts. Anyone with Finance
// access may see the matrix and how many people hold each role; only an admin also sees names.
// No email address, password or login time ever crosses this contract.
import { json } from './auth.js';
import { verifyAccessJwt } from './access-jwt.js';
import { ROLE_PERMISSION_ITEMS, getRolePermissions, permissionsForRole } from './api-utils.js';

export const ACCESS_ROLES = ['admin', 'finance', 'council', 'compensation', 'staff', 'member'];

export async function respondWithFinanceAccessRolesV1(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);
  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);
  const caller = await env.DB.prepare(`SELECT role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!caller) return json({ error: 'No matching active Connect account for this identity' }, 403);
  const matrix = await getRolePermissions(env.DB);
  const callerPermissions = permissionsForRole(matrix, caller.role);
  if (caller.role !== 'admin' && !['view', 'edit'].includes(callerPermissions.finance)) {
    return json({ error: 'Access & roles requires Finance access' }, 403);
  }
  const isAdmin = caller.role === 'admin';
  const users = (await env.DB.prepare(
    `SELECT username, display_name, role FROM app_users WHERE active=1 ORDER BY display_name, username`
  ).all()).results || [];
  const roles = ACCESS_ROLES.map((role) => {
    const holders = users.filter((u) => u.role === role);
    return {
      role,
      permissions: permissionsForRole(matrix, role),
      people_count: holders.length,
      ...(isAdmin ? { people: holders.map((u) => u.display_name || u.username) } : {}),
    };
  });
  return json({
    contract: 'connect.finance-access-roles.v1',
    viewer_role: caller.role,
    names_included: isAdmin,
    items: ROLE_PERMISSION_ITEMS.map((i) => ({ key: i.key, label: i.label, editable: !!i.editable })),
    roles,
  });
}
