// ── Transports for the Data & Imports read contracts ────────────────────────────────────────
// Same shape as finance-classification-client.js: a service-binding GET to Connect's contract
// endpoint (answered from Finance's own database first when local contract reads are on -- see
// local-contract-reads.js), never throws, and resolves to { ok: false, reason } on any failure so
// the Data page can say what is unavailable instead of failing the whole page.
import {
  acceptFinanceBoardPacketV1, acceptFinanceDaycareChurchBudgetPreviewV1, acceptFinanceImportStatusV1,
} from '../../contracts/validators/finance-data-imports-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;
// The board packet reads five years of church entries and balances plus the daycare ledger.
const PACKET_TIMEOUT_MS = 15000;

async function getContract(env, path, accept, timeoutMs = REQUEST_TIMEOUT_MS) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let response;
  try {
    response = await binding.fetch(new Request(`https://connect.timothystl.org/api/contracts/${path}`, {
      headers: { 'X-Contract-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    }));
  } catch (error) {
    return { ok: false, reason: 'network_error', detail: error?.message || String(error) };
  }
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
  let payload;
  try { payload = await response.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  try { return { ok: true, value: accept(payload) }; }
  catch (error) { return { ok: false, reason: 'contract_validation_failed', detail: error?.message || String(error) }; }
}

export async function fetchFinanceImportStatus(env) {
  const result = await getContract(env, 'finance-import-status-v1', acceptFinanceImportStatusV1);
  return result.ok ? { ok: true, importers: result.value.importers, generatedAt: result.value.generatedAt } : result;
}

export async function fetchDaycareChurchBudgetPreview(env, fiscalYear) {
  const result = await getContract(env, `finance-daycare-church-budget-preview-v1?year=${encodeURIComponent(fiscalYear)}`, acceptFinanceDaycareChurchBudgetPreviewV1);
  return result.ok ? { ok: true, preview: result.value } : result;
}

export async function fetchFinanceBoardPacket(env, fiscalYear) {
  const result = await getContract(env, `finance-board-packet-v1?year=${encodeURIComponent(fiscalYear)}`, acceptFinanceBoardPacketV1, PACKET_TIMEOUT_MS);
  return result.ok ? { ok: true, packet: result.value.packet } : result;
}
