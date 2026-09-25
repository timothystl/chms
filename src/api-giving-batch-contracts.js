// ── Gift Entry batch contracts, relayed from Finance's v3 Gift Entry pages ──────────────────
// Giving stays authoritative here in Connect: Finance renders the batch screens, but every read of
// donor-level gifts and every write lands on Connect's own giving_* tables through these routes.
// Same identity model as handleGivingQuickEntryContract (api-contracts-service.js): the
// X-Contract-Key check (done by the caller) proves the request came from Finance's Worker; the
// Cf-Access-Jwt-Assertion is re-verified here against Access's own keys, and the verified
// person's real Connect role decides access. Reads show donor names, so they need Giving view or
// edit (council's anonymous-only Giving access is refused); writes need Giving edit, or admin.
import { json } from './auth.js';
import { verifyAccessJwt } from './access-jwt.js';
import { getRolePermissions, permissionsForRole, batchDepositStatusFromCounts, computeDepositTotals } from './api-utils.js';

const MAX_SPLITS = 4;
const METHODS = new Set(['cash', 'check', 'online', 'card', 'ach', 'stock', 'other']);

export async function authorizeGivingBatchContract(req, env, { write }) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return { response: json({ error: 'Access verification not configured' }, 503) };
  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return { response: json({ error: 'Unauthorized' }, 401) };
  const user = await env.DB.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return { response: json({ error: 'No matching active Connect account for this identity' }, 403) };
  const giving = permissionsForRole(await getRolePermissions(env.DB), user.role).giving;
  const allowed = user.role === 'admin' || giving === 'edit' || (!write && giving === 'view');
  if (!allowed) return { response: json({ error: write ? 'Entering gifts requires Giving edit access' : 'Batch detail requires Giving view access' }, 403) };
  return { email, user };
}

function toCents(value) {
  const n = Math.round(parseFloat(String(value ?? '').replace(/[$,\s]/g, '')) * 100);
  return Number.isFinite(n) ? n : NaN;
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function audit(db, action, entityId, email) {
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES(?, 'giving_batches', ?, '', 'entered_by', '', ?)`
  ).bind(action, entityId ?? null, email).run().catch(() => {});
}

const BATCH_LIST_SQL = `SELECT gb.id, gb.batch_date, gb.description, gb.closed,
       COALESCE(bt.entry_count,0) AS entry_count, COALESCE(bt.total_cents,0) AS total_cents,
       COALESCE(dc.linked_cents,0) AS linked_cents, COALESCE(dc.deposit_count,0) AS deposit_count,
       COALESCE(dc.unreconciled_count,0) AS unreconciled_count
  FROM giving_batches gb
  LEFT JOIN giving_batch_totals bt ON bt.batch_id=gb.id
  LEFT JOIN (
    SELECT dl.batch_id, SUM(dl.amount_cents) AS linked_cents, COUNT(*) AS deposit_count,
           SUM(CASE WHEN d.id IS NOT NULL AND d.bank_cents IS NULL THEN 1 ELSE 0 END) AS unreconciled_count
      FROM giving_deposit_lines dl LEFT JOIN giving_deposits d ON d.id=dl.deposit_id
     GROUP BY dl.batch_id
  ) dc ON dc.batch_id=gb.id`;

function withDepositStatus(rows) {
  return rows.map((b) => ({
    ...b,
    deposit_status: batchDepositStatusFromCounts(b.total_cents, b.linked_cents, b.deposit_count, b.unreconciled_count),
  }));
}

// GET giving-batch-workspace-v1?batch_id=&q= — everything the Enter a batch page needs.
export async function respondWithGivingBatchWorkspaceV1(url, db) {
  const funds = (await db.prepare('SELECT id, name, description FROM funds WHERE active=1 ORDER BY sort_order, name').all()).results || [];
  const openBatches = withDepositStatus((await db.prepare(`${BATCH_LIST_SQL} WHERE gb.closed=0 ORDER BY gb.batch_date DESC, gb.id DESC LIMIT 25`).all()).results || []);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const week = await db.prepare(
    `SELECT COUNT(*) AS gift_count, COALESCE(SUM(ge.amount),0) AS total_cents
       FROM giving_entries ge JOIN giving_batches gb ON gb.id=ge.batch_id
      WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) >= ?`
  ).bind(weekAgo).first();

  const requested = parseInt(url.searchParams.get('batch_id') || '', 10);
  const batchId = Number.isInteger(requested) ? requested : (openBatches[0]?.id ?? null);
  let batch = null;
  if (batchId) {
    const row = await db.prepare('SELECT id, batch_date, description, closed FROM giving_batches WHERE id=?').bind(batchId).first();
    if (row) {
      const entries = (await db.prepare(
        `SELECT ge.id, ge.person_id, ge.fund_id, ge.amount, ge.method, ge.check_number, ge.notes,
                COALESCE(NULLIF(ge.contribution_date,''), ?) AS gift_date, f.name AS fund_name,
                COALESCE(NULLIF(TRIM(p.first_name||' '||p.last_name),''), '') AS person_name,
                COALESCE(p.envelope_number,'') AS envelope_number
           FROM giving_entries ge JOIN funds f ON f.id=ge.fund_id LEFT JOIN people p ON p.id=ge.person_id
          WHERE ge.batch_id=? ORDER BY ge.id`
      ).bind(row.batch_date, row.id).all()).results || [];
      const byFund = new Map();
      const byMethod = new Map();
      for (const e of entries) {
        byFund.set(e.fund_name, (byFund.get(e.fund_name) || 0) + e.amount);
        byMethod.set(e.method, (byMethod.get(e.method) || 0) + e.amount);
      }
      batch = {
        ...row,
        entries,
        total_cents: entries.reduce((s, e) => s + e.amount, 0),
        fund_totals: [...byFund].map(([fund_name, cents]) => ({ fund_name, cents })),
        method_totals: [...byMethod].map(([method, cents]) => ({ method, cents })),
      };
    }
  }

  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  let people = [];
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    people = (await db.prepare(
      `SELECT id, first_name, last_name, envelope_number FROM people
        WHERE COALESCE(status,'active')='active' AND COALESCE(deceased,0)=0
          AND (envelope_number=? OR (first_name||' '||last_name) LIKE ? OR last_name LIKE ?)
        ORDER BY (envelope_number=?) DESC, last_name, first_name LIMIT 20`
    ).bind(q, like, like, q).all()).results || [];
  }
  return json({ contract: 'connect.giving-batch-workspace.v1', funds, open_batches: openBatches, batch, people, week });
}

// GET giving-batch-ledger-v1 — recent batches with deposit coverage, and recent deposits, for the
// Reconciliation to bank and Batch reports pages. Totals only; no donor names.
export async function respondWithGivingBatchLedgerV1(db) {
  const batches = withDepositStatus((await db.prepare(`${BATCH_LIST_SQL} ORDER BY gb.batch_date DESC, gb.id DESC LIMIT 120`).all()).results || []);
  const deposits = (await db.prepare(
    `SELECT d.id, d.deposit_date, d.source, d.external_ref, d.bank_cents, d.status, d.reconciled_at, d.notes,
            (SELECT COALESCE(SUM(dl.amount_cents),0) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) AS line_cents,
            (SELECT COUNT(*) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) AS batch_count
       FROM giving_deposits d ORDER BY d.deposit_date DESC, d.id DESC LIMIT 120`
  ).all()).results || [];
  const lines = (await db.prepare(
    `SELECT dl.deposit_id, dl.batch_id, dl.amount_cents FROM giving_deposit_lines dl
      WHERE dl.deposit_id IN (SELECT id FROM giving_deposits ORDER BY deposit_date DESC, id DESC LIMIT 120)`
  ).all()).results || [];
  return json({ contract: 'connect.giving-batch-ledger.v1', batches, deposits, lines });
}

async function openBatch(db, batchId) {
  const batch = await db.prepare('SELECT id, closed, batch_date FROM giving_batches WHERE id=?').bind(batchId).first();
  if (!batch) return { error: 'That batch no longer exists.', status: 404 };
  if (batch.closed) return { error: 'That batch is closed. Reopen it to change its gifts.', status: 409 };
  return { batch };
}

// One gift, optionally split across up to four funds -- each split is its own giving_entries row
// (the same shape Connect's own batch screen writes), sharing giver, method, check and memo.
export async function addBatchGift(db, body) {
  const batchId = parseInt(body.batch_id, 10);
  const found = await openBatch(db, batchId);
  if (found.error) return found;
  const splits = (Array.isArray(body.splits) ? body.splits : []).slice(0, MAX_SPLITS)
    .map((s) => ({ fund_id: parseInt(s.fund_id, 10), cents: toCents(s.amount) }))
    .filter((s) => s.fund_id || s.cents);
  if (!splits.length) return { error: 'Enter an amount.', status: 400 };
  for (const s of splits) {
    if (!Number.isInteger(s.fund_id)) return { error: 'Choose a fund for every amount.', status: 400 };
    if (!Number.isInteger(s.cents) || s.cents <= 0) return { error: 'Every amount must be more than $0.', status: 400 };
    const fund = await db.prepare('SELECT id FROM funds WHERE id=? AND active=1').bind(s.fund_id).first();
    if (!fund) return { error: 'Choose an active fund.', status: 400 };
  }
  const method = METHODS.has(body.method) ? body.method : 'cash';
  const date = isDay(body.gift_date) ? body.gift_date : found.batch.batch_date;
  let personId = null;
  if (body.person_id !== undefined && body.person_id !== null && body.person_id !== '') {
    personId = parseInt(body.person_id, 10);
    const person = Number.isInteger(personId) ? await db.prepare('SELECT id FROM people WHERE id=?').bind(personId).first() : null;
    if (!person) return { error: 'That giver is no longer on record.', status: 400 };
  }
  const check = String(body.check_number || '').trim().slice(0, 40);
  const memo = String(body.notes || '').trim().slice(0, 300);
  const ids = [];
  for (const s of splits) {
    const r = await db.prepare(
      `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,contribution_date)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(batchId, personId, s.fund_id, s.cents, method, check, memo, date).run();
    ids.push(r.meta?.last_row_id);
  }
  return { ok: true, ids, batch_id: batchId };
}

export async function applyGivingBatchWrite(db, body, email) {
  const op = String(body.op || '');
  if (op === 'create_batch') {
    if (!isDay(body.batch_date)) return { error: 'Choose the batch date.', status: 400 };
    const description = String(body.description || '').trim().slice(0, 120) || 'Plate & envelopes';
    const r = await db.prepare('INSERT INTO giving_batches (batch_date, description) VALUES (?,?)').bind(body.batch_date, description).run();
    await audit(db, 'giving_batch_created_via_finance', r.meta?.last_row_id, email);
    return { ok: true, batch_id: r.meta?.last_row_id };
  }
  if (op === 'add_gift') {
    const result = await addBatchGift(db, body);
    if (result.ok) await audit(db, 'giving_batch_gift_via_finance', result.batch_id, email);
    return result;
  }
  if (op === 'remove_gift') {
    const entryId = parseInt(body.entry_id, 10);
    const entry = await db.prepare(
      'SELECT ge.id, ge.batch_id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON gb.id=ge.batch_id WHERE ge.id=?'
    ).bind(entryId).first();
    if (!entry) return { error: 'That gift no longer exists.', status: 404 };
    if (entry.closed) return { error: 'That batch is closed. Reopen it to change its gifts.', status: 409 };
    await db.prepare('DELETE FROM giving_entries WHERE id=?').bind(entryId).run();
    await audit(db, 'giving_batch_gift_removed_via_finance', entry.batch_id, email);
    return { ok: true, batch_id: entry.batch_id };
  }
  if (op === 'close_batch' || op === 'reopen_batch') {
    const batchId = parseInt(body.batch_id, 10);
    const batch = await db.prepare('SELECT id FROM giving_batches WHERE id=?').bind(batchId).first();
    if (!batch) return { error: 'That batch no longer exists.', status: 404 };
    await db.prepare('UPDATE giving_batches SET closed=? WHERE id=?').bind(op === 'close_batch' ? 1 : 0, batchId).run();
    await audit(db, op === 'close_batch' ? 'giving_batch_closed_via_finance' : 'giving_batch_reopened_via_finance', batchId, email);
    return { ok: true, batch_id: batchId };
  }
  if (op === 'deposit_batch') {
    // Put the rest of a closed batch on a new bank deposit, the same way Connect's own batch
    // detail "Assign the rest to a new deposit" does.
    const batchId = parseInt(body.batch_id, 10);
    const row = (await db.prepare(`${BATCH_LIST_SQL} WHERE gb.id=?`).bind(batchId).all()).results?.[0];
    if (!row) return { error: 'That batch no longer exists.', status: 404 };
    if (!row.closed) return { error: 'Close the batch before depositing it.', status: 409 };
    const remaining = row.total_cents - row.linked_cents;
    if (remaining <= 0) return { error: 'This batch is already fully on a deposit.', status: 409 };
    if (!isDay(body.deposit_date)) return { error: 'Choose the deposit date.', status: 400 };
    const source = ['check', 'cash', 'online', 'mixed'].includes(body.source) ? body.source : 'mixed';
    const ref = String(body.external_ref || '').trim().slice(0, 80);
    const r = await db.prepare(
      'INSERT INTO giving_deposits (deposit_date, source, processor, external_ref, notes) VALUES (?,?,?,?,?)'
    ).bind(body.deposit_date, source, '', ref, '').run();
    await db.prepare('INSERT INTO giving_deposit_lines (deposit_id, batch_id, amount_cents) VALUES (?,?,?)')
      .bind(r.meta?.last_row_id, batchId, remaining).run();
    await audit(db, 'giving_batch_deposited_via_finance', batchId, email);
    return { ok: true, deposit_id: r.meta?.last_row_id };
  }
  if (op === 'reconcile_deposit' || op === 'reopen_deposit') {
    const depositId = parseInt(body.deposit_id, 10);
    const dep = await db.prepare('SELECT id FROM giving_deposits WHERE id=?').bind(depositId).first();
    if (!dep) return { error: 'That deposit no longer exists.', status: 404 };
    if (op === 'reopen_deposit') {
      await db.prepare("UPDATE giving_deposits SET status='open', reconciled_at=NULL WHERE id=?").bind(depositId).run();
      await db.prepare("UPDATE giving_entries SET reconcile_status='deposited' WHERE deposit_id=?").bind(depositId).run();
      await audit(db, 'giving_deposit_reopened_via_finance', depositId, email);
      return { ok: true };
    }
    const bankCents = toCents(body.bank_amount);
    if (!Number.isInteger(bankCents) || bankCents < 0) return { error: 'Enter the amount on the bank statement.', status: 400 };
    // Same two writes as Connect's own giving/deposits/:id/reconcile route.
    await db.prepare("UPDATE giving_deposits SET status='reconciled', bank_cents=?, reconciled_at=datetime('now'), reconciled_by=? WHERE id=?")
      .bind(bankCents, email, depositId).run();
    await db.prepare("UPDATE giving_entries SET reconcile_status='reconciled' WHERE deposit_id=?").bind(depositId).run();
    await audit(db, 'giving_deposit_reconciled_via_finance', depositId, email);
    const gifts = (await db.prepare('SELECT amount, fee_cents FROM giving_entries WHERE deposit_id=?').bind(depositId).all()).results || [];
    return { ok: true, totals: computeDepositTotals(gifts, bankCents) };
  }
  return { error: 'Unknown operation.', status: 400 };
}

export async function handleGivingBatchContracts(req, env, path) {
  const url = new URL(req.url);
  if (path === '/api/contracts/giving-batch-workspace-v1' && req.method === 'GET') {
    const auth = await authorizeGivingBatchContract(req, env, { write: false });
    if (auth.response) return auth.response;
    return respondWithGivingBatchWorkspaceV1(url, env.DB);
  }
  if (path === '/api/contracts/giving-batch-ledger-v1' && req.method === 'GET') {
    const auth = await authorizeGivingBatchContract(req, env, { write: false });
    if (auth.response) return auth.response;
    return respondWithGivingBatchLedgerV1(env.DB);
  }
  if (path === '/api/contracts/giving-batch-write-v1' && req.method === 'POST') {
    const auth = await authorizeGivingBatchContract(req, env, { write: true });
    if (auth.response) return auth.response;
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    const result = await applyGivingBatchWrite(env.DB, body || {}, auth.email);
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json({ ...result, enteredBy: auth.user.username });
  }
  return null;
}
