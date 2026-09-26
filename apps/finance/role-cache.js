// Keeps Finance usable when Connect cannot answer the role check. Roles stay managed in Connect:
// every successful check saves the answer here, and when Connect times out, drops the connection or
// returns a 5xx, a page view may use the saved role for up to seven days. The person is identified
// by verifying the Cloudflare Access sign-in Finance itself receives. A refusal from Connect (401 or
// 403) is never overridden, and saves always require a live answer (they call fetchVerifiedRole).
import { fetchVerifiedRole } from './connect-role-client.js';
import { verifyAccessJwt } from './access-jwt.js';
import { ensureFinanceOwnedSchema } from './finance-owned-schema.js';

export const ROLE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isTransientRoleFailure(result) {
  return !result.ok && (result.reason === 'network_error' || (result.reason === 'http_error' && result.status >= 500));
}

async function saveRole(db, result) {
  if (!db || !result.identity) return;
  try {
    await ensureFinanceOwnedSchema(db, 'roleCache');
    await db.prepare(
      `INSERT INTO finance_role_cache (identity, role, permissions_json, username, verified_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(identity) DO UPDATE SET role=excluded.role, permissions_json=excluded.permissions_json,
         username=excluded.username, verified_at=excluded.verified_at`
    ).bind(result.identity, result.role, JSON.stringify(result.permissions || {}), result.username || '').run();
  } catch {
    // Saving is a convenience; the page already has a verified role.
  }
}

async function savedRole(db, identity, now) {
  try {
    await ensureFinanceOwnedSchema(db, 'roleCache');
    const row = await db.prepare('SELECT role, permissions_json, username, verified_at FROM finance_role_cache WHERE identity = ?').bind(identity).first();
    if (!row) return null;
    const verifiedAt = Date.parse(`${String(row.verified_at).replace(' ', 'T')}Z`);
    if (!Number.isFinite(verifiedAt) || now - verifiedAt > ROLE_CACHE_MAX_AGE_MS) return null;
    let permissions = {};
    try { permissions = JSON.parse(row.permissions_json) || {}; } catch { permissions = {}; }
    return { role: row.role, permissions, username: row.username || '', verifiedAt: new Date(verifiedAt).toISOString() };
  } catch {
    return null;
  }
}

// For page views only. Returns fetchVerifiedRole's result, or a saved role marked source: 'saved'.
export async function resolvePageRole(env, accessJwt, { now = Date.now(), fetchImpl } = {}) {
  const live = await fetchVerifiedRole(env, accessJwt);
  if (live.ok) {
    await saveRole(env.FINANCE_DB, live);
    return live;
  }
  if (!isTransientRoleFailure(live) || !env.FINANCE_DB || !env.FINANCE_ACCESS_TEAM_DOMAIN || !env.FINANCE_ACCESS_AUD) return live;
  const identity = await verifyAccessJwt(accessJwt, {
    teamDomain: env.FINANCE_ACCESS_TEAM_DOMAIN, audience: env.FINANCE_ACCESS_AUD,
    now: () => now, ...(fetchImpl ? { fetchImpl } : {}),
  });
  if (!identity) return live;
  const saved = await savedRole(env.FINANCE_DB, identity, now);
  if (!saved) return live;
  return { ok: true, role: saved.role, permissions: saved.permissions, identity, ...(saved.username ? { username: saved.username } : {}), source: 'saved', verifiedAt: saved.verifiedAt, liveFailure: live };
}
