// ── Data & Imports read contracts (Finance's Accounts & Data -> Data page) ───────────────────
// Three reads that let standalone Finance offer what Connect's legacy Data & Imports tab offers.
// Each reuses the exact function behind the legacy finance/* route (src/api-finance.js), so the
// contract and the legacy screen can never disagree:
//   finance-import-status-v1                 <- finance/import-status (buildImportStatus)
//   finance-daycare-church-budget-preview-v1 <- finance/daycare/church-budget-preview
//   finance-board-packet-v1                  <- finance/board-packet (buildBoardPacket)
// All are GET-only and gated by the X-Contract-Key check in api-contracts-service.js, like every
// other finance-* read. The first two read only Finance-owned accounting tables, so Finance also
// answers them from its own database (apps/finance/local-contract-reads.js). The board packet
// also reads Giving's fund totals, which stay in Connect, so it is always answered here.
import { json } from './auth.js';
import { buildBoardPacket, buildImportStatus, previewDaycareFromChurchBudget } from './api-finance.js';
import {
  validateFinanceBoardPacketV1, validateFinanceDaycareChurchBudgetPreviewV1, validateFinanceImportStatusV1,
} from '../contracts/validators/finance-data-imports-consumer.js';

function identity(contract, now) {
  return {
    contract, dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function readYear(url, name) {
  const raw = url.searchParams.get(name);
  const year = Number(raw);
  return raw && Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function validated(payload, validate, label) {
  const validation = validate(payload);
  if (!validation.ok) return json({ error: `Internal: assembled ${label} failed contract validation`, details: validation.errors }, 500);
  return json(payload);
}

export async function buildFinanceImportStatusV1(db, { now = new Date() } = {}) {
  const importers = await buildImportStatus(db);
  return {
    ...identity('connect.finance-import-status.v1', now),
    importers: importers.map((i) => ({
      key: i.key, label: i.label, group: i.group,
      lastImportedAt: i.lastImportedAt ? String(i.lastImportedAt) : '',
      note: i.note ? String(i.note) : '', derived: !!i.derived,
    })),
  };
}

export async function respondWithFinanceImportStatusV1(db) {
  return validated(await buildFinanceImportStatusV1(db), validateFinanceImportStatusV1, 'import status');
}

export async function buildFinanceDaycareChurchBudgetPreviewV1(db, { fiscalYear, now = new Date() }) {
  const result = await previewDaycareFromChurchBudget(db, fiscalYear);
  const base = { ...identity('connect.finance-daycare-church-budget-preview.v1', now), currency: 'USD', fiscalYear };
  if (result.error) return { ...base, available: false, message: result.error, found: 0, byCategory: [], entries: [] };
  return {
    ...base,
    available: true,
    message: result.found ? '' : `No MDO-tagged accounts found in the imported budget for ${fiscalYear}.`,
    found: result.found,
    byCategory: Object.entries(result.by_category).map(([category, totals]) => ({
      category, actualCents: totals.actual_cents, budgetCents: totals.budget_cents,
    })).sort((a, b) => a.category.localeCompare(b.category)),
    entries: result.entries.map((e) => ({
      period: e.period, category: e.category, entryType: e.entry_type, amountCents: e.amount_cents, notes: e.notes,
    })),
  };
}

export async function respondWithFinanceDaycareChurchBudgetPreviewV1(url, db) {
  const fiscalYear = readYear(url, 'year');
  if (fiscalYear === null) return json({ error: 'year must be a 4-digit year' }, 400);
  return validated(await buildFinanceDaycareChurchBudgetPreviewV1(db, { fiscalYear }), validateFinanceDaycareChurchBudgetPreviewV1, 'daycare church-budget preview');
}

export async function buildFinanceBoardPacketV1(db, { fiscalYear, now = new Date() }) {
  return {
    ...identity('connect.finance-board-packet.v1', now), currency: 'USD', fiscalYear,
    packet: await buildBoardPacket(db, fiscalYear),
  };
}

export async function respondWithFinanceBoardPacketV1(url, db) {
  const fiscalYear = readYear(url, 'year');
  if (fiscalYear === null) return json({ error: 'year must be a 4-digit year' }, 400);
  return validated(await buildFinanceBoardPacketV1(db, { fiscalYear }), validateFinanceBoardPacketV1, 'board packet');
}
