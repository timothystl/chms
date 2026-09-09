// ── Cross-Worker server-to-server contract endpoint ─────────────────────────
// Called from the Finance application (staging today; production once Finance
// has its own Worker), not from a browser or a staff session. Auth is via the
// X-Contract-Key header matching env.FINANCE_CONTRACT_API_KEY — the same
// shared-secret pattern already used for the website's intake and Christmas
// Market calls into this Worker (see api-intake.js, api-scheduler.js). This
// stays a distinct, narrower grant from the human role/permission matrix in
// api-chms.js: it reaches nothing but this one read-only aggregate contract.
import { json, timingSafeEqual } from './auth.js';
import { respondWithConnectGivingSummaryV1 } from './api-contracts.js';

export async function handleContractsServiceApi(req, env, path) {
  const expectedKey = env.FINANCE_CONTRACT_API_KEY || '';
  if (!expectedKey) return json({ error: 'Contract service not configured' }, 503);
  const key = req.headers.get('X-Contract-Key') || '';
  if (!(await timingSafeEqual(key, expectedKey))) return json({ error: 'Unauthorized' }, 401);

  if (path === '/api/contracts/connect-giving-summary-v1' && req.method === 'GET') {
    return respondWithConnectGivingSummaryV1(new URL(req.url), env.DB);
  }
  return json({ error: 'Not found' }, 404);
}
