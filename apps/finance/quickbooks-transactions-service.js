import { makeQboClient, refreshTokens } from './quickbooks-oauth-client.js';
import { ensureFreshAccessToken } from './quickbooks-token-service.js';
import { getConnection } from './quickbooks-oauth-routes.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const EXPENSE_TRANSACTION_TYPES = new Set(['bill', 'expense', 'check', 'credit card credit', 'vendor credit', 'bill payment', 'bill payment (check)', 'bill payment (credit card)']);

const COLUMN_ALIASES = {
  date: { types: ['tx_date'], titles: ['date'] },
  type: { types: ['txn_type'], titles: ['transaction type'] },
  docNum: { types: ['doc_num'], titles: ['num'] },
  name: { types: ['name', 'cust_name', 'vend_name', 'emp_name'], titles: ['name'] },
  memo: { types: ['memo'], titles: ['memo/description', 'memo'] },
  account: { types: ['account_name', 'split_acc', 'split'], titles: ['account', 'split'] },
  amount: { types: ['subt_nat_amount', 'amount'], titles: ['amount'] },
};

const QBO_TRANSACTION_SLUGS = {
  invoice: 'invoice', estimate: 'estimate', 'sales receipt': 'salesreceipt',
  'refund receipt': 'refundreceipt', 'credit memo': 'creditmemo', payment: 'recvpayment',
  bill: 'bill', expense: 'expense', check: 'check', 'credit card credit': 'creditcardcredit',
  'vendor credit': 'vendorcredit', 'purchase order': 'purchaseorder',
  'bill payment': 'billpaymentcheck', 'bill payment (check)': 'billpaymentcheck',
  'bill payment (credit card)': 'billpaymentcreditcard', 'journal entry': 'journal',
  deposit: 'deposit', transfer: 'transfer',
};

function transactionUrl(type, id) {
  const slug = QBO_TRANSACTION_SLUGS[String(type || '').trim().toLowerCase()];
  return slug && id ? `https://qbo.intuit.com/app/${slug}?txnId=${encodeURIComponent(String(id))}` : null;
}

function columnIndexes(columns) {
  const result = {};
  for (const [index, column] of (columns || []).entries()) {
    const type = String(column.ColType || '').toLowerCase();
    const title = String(column.ColTitle || '').toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (result[field] == null && (aliases.types.includes(type) || aliases.titles.includes(title))) result[field] = index;
    }
  }
  return result;
}

function flattenRows(rows, output) {
  for (const row of rows || []) {
    if (row.type === 'Data' && Array.isArray(row.ColData)) output.push(row.ColData);
    if (row.Rows?.Row) flattenRows(row.Rows.Row, output);
  }
}

function parseAmount(value) {
  const normalized = String(value || '').replace(/[$,]/g, '').trim();
  if (!normalized) return null;
  const number = Number(normalized.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

export function parseTransactionList(report) {
  const indexes = columnIndexes(report?.Columns?.Column);
  const rows = [];
  flattenRows(report?.Rows?.Row, rows);
  return rows.map((cells) => {
    const cell = (field) => indexes[field] == null ? null : cells[indexes[field]];
    const type = cell('type')?.value || '';
    const id = cell('type')?.id || cells.find((entry) => entry?.id)?.id || null;
    const amount = cell('amount')?.value || '';
    return {
      date: cell('date')?.value || '', type, docNum: cell('docNum')?.value || '',
      name: cell('name')?.value || '', memo: cell('memo')?.value || '',
      account: cell('account')?.value || '', amount, amountCents: parseAmount(amount),
      transactionId: id, viewUrl: transactionUrl(type, id),
    };
  });
}

function defaultDates(now) {
  const date = new Date(now);
  return {
    startDate: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10),
    endDate: date.toISOString().slice(0, 10),
  };
}

export function resolveTransactionDates(searchParams, now = Date.now()) {
  const defaults = defaultDates(now);
  const startDate = searchParams?.get('start_date') || defaults.startDate;
  const endDate = searchParams?.get('end_date') || defaults.endDate;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return { ok: false, error: 'Dates must use YYYY-MM-DD.' };
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (start > end) return { ok: false, error: 'The start date must not be after the end date.' };
  if ((end - start) / 86400000 > MAX_RANGE_DAYS) return { ok: false, error: 'Choose a date range of one year or less.' };
  return { ok: true, startDate, endDate };
}

export async function loadQuickbooksTransactions(env, searchParams, { now = Date.now(), fetchImpl = fetch } = {}) {
  const dates = resolveTransactionDates(searchParams, now);
  if (!dates.ok) return dates;
  const connection = await getConnection(env.FINANCE_DB);
  if (!connection?.realm_id) return { ok: false, ...dates, error: 'QuickBooks is not connected yet.' };
  let fresh;
  try {
    fresh = await ensureFreshAccessToken(env, env.FINANCE_DB, connection, {
      now: () => now,
      refreshTokensFn: (targetEnv, token) => refreshTokens(targetEnv, token, fetchImpl),
    });
  } catch {
    return { ok: false, ...dates, error: 'QuickBooks needs to be reconnected before transactions can be loaded.' };
  }
  const response = await makeQboClient(env, fresh, fetchImpl).transactionList({
    start_date: dates.startDate, end_date: dates.endDate, sort_by: 'tx_date', sort_order: 'descend',
  });
  if (!response.ok) return { ok: false, ...dates, error: `QuickBooks could not load the transaction report (HTTP ${response.status}).` };
  const transactions = parseTransactionList(await response.json());
  return { ok: true, ...dates, transactions, syncedAt: new Date(now).toISOString() };
}

export function summarizeVendorSpend(transactions) {
  const totals = new Map();
  for (const row of transactions || []) {
    if (!EXPENSE_TRANSACTION_TYPES.has(row.type.toLowerCase()) || !row.name || row.amountCents == null) continue;
    const current = totals.get(row.name) || { name: row.name, transactionCount: 0, amountCents: 0 };
    current.transactionCount += 1;
    current.amountCents += Math.abs(row.amountCents);
    totals.set(row.name, current);
  }
  return [...totals.values()].sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
}

export function summarizeExpenseAccounts(transactions) {
  const totals = new Map();
  for (const row of transactions || []) {
    if (!EXPENSE_TRANSACTION_TYPES.has(row.type.toLowerCase()) || !row.account || row.amountCents == null || row.amountCents === 0) continue;
    const current = totals.get(row.account) || { account: row.account, transactionCount: 0, amountCents: 0 };
    current.transactionCount += 1;
    current.amountCents += Math.abs(row.amountCents);
    totals.set(row.account, current);
  }
  return [...totals.values()].sort((a, b) => b.amountCents - a.amountCents || a.account.localeCompare(b.account));
}

export function findTransactionExceptions(transactions) {
  const exceptions = [];
  for (const row of transactions || []) {
    const reasons = [];
    if (!row.account) reasons.push('Missing account');
    if (!row.name) reasons.push('Missing name');
    if (row.amountCents == null) reasons.push('Invalid or missing amount');
    if (!row.date) reasons.push('Missing date');
    if (reasons.length) exceptions.push({ ...row, reasons });
  }
  return exceptions;
}
