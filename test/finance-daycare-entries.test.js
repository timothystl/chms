import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { buildFinanceDaycareEntriesV1 } from '../src/api-contracts.js';
import {
  acceptFinanceDaycareEntriesV1, validateFinanceDaycareEntriesV1,
} from '../contracts/validators/finance-daycare-entries-consumer.js';
import { fetchLiveFinanceDaycareEntries } from '../apps/finance/finance-daycare-entries-client.js';

// connect.finance-daycare-entries.v1 and the Daycare actuals list/edit/remove screens built on it.

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE finance_daycare_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    entry_type TEXT NOT NULL DEFAULT 'actual', amount_cents INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const insert = sqlite.prepare('INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes,source) VALUES (?,?,?,?,?,?)');
  insert.run('2026', 'Payroll', 'budget', 5000000, 'Board plan', 'church_budget_import');
  insert.run('2026-03', 'Tuition Income', 'actual', 1234500, 'room notes from sync', 'daycare_api');
  insert.run('2026-04', 'Supplies', 'actual', 4500, 'Costco run', 'manual');
  insert.run('2025-12', 'Supplies', 'actual', 999, 'prior year', 'manual');
  insert.run('20261', 'Supplies', 'actual', 1, 'not a period of 2026', 'manual');
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return { async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
        },
      };
    },
  };
}

const NOW = new Date('2026-09-25T12:00:00Z');

function validPayload(entries) {
  return {
    contract: 'connect.finance-daycare-entries.v1', dataClassification: 'aggregate',
    sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
    fiscalYear: 2026, generatedAt: '2026-09-25T12:00:00Z',
    entries: entries || [
      { id: 1, period: '2026', category: 'Payroll', entryType: 'budget', amountCents: 5000000, notes: 'Board plan', source: 'church_budget_import' },
      { id: 2, period: '2026-03', category: 'Tuition Income', entryType: 'actual', amountCents: 1234500, notes: '', source: 'daycare_api' },
      { id: 3, period: '2026-04', category: 'Supplies', entryType: 'actual', amountCents: 4500, notes: 'Costco run', source: 'manual' },
    ],
  };
}

describe('buildFinanceDaycareEntriesV1', () => {
  it('returns only the fiscal year and its months, blanks synced-row notes, and validates', async () => {
    const result = await buildFinanceDaycareEntriesV1(makeDb(), { fiscalYear: 2026, now: NOW });
    expect(validateFinanceDaycareEntriesV1(result)).toEqual({ ok: true, errors: [] });
    expect(result.entries.map((e) => e.period)).toEqual(['2026', '2026-03', '2026-04']);
    expect(result.entries.find((e) => e.source === 'daycare_api').notes).toBe('');
    expect(result.entries.find((e) => e.source === 'manual').notes).toBe('Costco run');
    expect(result).toEqual(validPayload());
  });
});

describe('validateFinanceDaycareEntriesV1', () => {
  it('rejects a period outside the fiscal year, a duplicate id, and unknown fields', () => {
    const payload = validPayload([
      { id: 1, period: '2025-12', category: 'X', entryType: 'actual', amountCents: 1, notes: '', source: 'manual' },
      { id: 1, period: '2026', category: 'X', entryType: 'actual', amountCents: 1, notes: '', source: 'manual', extra: true },
    ]);
    const { ok, errors } = validateFinanceDaycareEntriesV1(payload);
    expect(ok).toBe(false);
    expect(errors).toContain('entries[0].period must be the fiscal year (YYYY) or one of its months (YYYY-MM)');
    expect(errors).toContain('entries[1] must contain exactly the daycare entry fields');
    expect(errors).toContain('entries[1] repeats id 1');
  });

  it('accept returns a detached copy and throws on invalid input', () => {
    const payload = validPayload();
    const accepted = acceptFinanceDaycareEntriesV1(payload);
    accepted.entries[0].category = 'changed';
    expect(payload.entries[0].category).toBe('Payroll');
    expect(() => acceptFinanceDaycareEntriesV1({ ...payload, entries: 'nope' })).toThrow();
  });
});

describe('fetchLiveFinanceDaycareEntries', () => {
  it('requests the fiscal year with the contract key and returns validated entries', async () => {
    let seen;
    const env = {
      FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: { async fetch(req) { seen = req; return new Response(JSON.stringify(validPayload())); } },
    };
    const result = await fetchLiveFinanceDaycareEntries(env, 2026);
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(3);
    expect(new URL(seen.url).pathname).toBe('/api/contracts/finance-daycare-entries-v1');
    expect(new URL(seen.url).searchParams.get('fiscal_year')).toBe('2026');
    expect(seen.headers.get('X-Contract-Key')).toBe('k');
  });

  it('never throws: missing config, older Connect (404), and invalid payloads resolve to reasons', async () => {
    expect(await fetchLiveFinanceDaycareEntries({}, 2026)).toEqual({ ok: false, reason: 'not_configured' });
    const env = (res) => ({ FINANCE_CONTRACT_API_KEY: 'k', CONNECT_SERVICE: { fetch: async () => res } });
    expect((await fetchLiveFinanceDaycareEntries(env(new Response('nf', { status: 404 })), 2026)).reason).toBe('http_error');
    expect((await fetchLiveFinanceDaycareEntries(env(new Response('{"contract":"x"}')), 2026)).reason).toBe('contract_validation_failed');
  });
});

// ── Daycare actuals page ────────────────────────────────────────────────────────────────────
const LIVE_REPORT = {
  contract: 'connect.finance-daycare-report.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  generatedAt: '2026-09-25T12:00:00Z',
  categories: [{ category: 'Tuition Income', classification: 'Income', actualCents: 0, budgetCents: 0 }],
  allocation: { utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 0, churchInsuranceActualCents: 0, mdoUtilityCents: 0, mdoInsuranceCents: 0 },
  totals: { incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0, netActualCents: 0, netBudgetCents: 0 },
  reconciliation: { categoryCount: 1, incomeCategoryCount: 1, expenseCategoryCount: 0, totalsMatch: true },
};

function pageEnv({ entriesResponse } = {}) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 'test', FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role: 'finance', permissions: { finance: 'edit' } }));
        if (url.pathname === '/api/contracts/finance-daycare-report-v1') {
          return new Response(JSON.stringify({ ...LIVE_REPORT, fiscalYear: Number(url.searchParams.get('fiscal_year')) }));
        }
        if (url.pathname === '/api/contracts/finance-daycare-entries-v1') {
          if (entriesResponse) return entriesResponse;
          return new Response(JSON.stringify({
            ...validPayload(),
            fiscalYear: Number(url.searchParams.get('fiscal_year')),
            entries: validPayload().entries.map((e) => ({ ...e, period: e.period.replace('2026', url.searchParams.get('fiscal_year')) })),
          }));
        }
        return new Response('nf', { status: 404 });
      },
    },
  };
}

async function actuals(env, query = '') {
  const res = await worker.fetch(new Request(`https://finance.test/?section=daycare&page=actuals${query}`, {
    headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' },
  }), env);
  expect(res.status).toBe(200);
  return res.text();
}

describe('Daycare actuals entry list', () => {
  it('lists entries with Edit on every row and Delete except on daycare-app rows', async () => {
    const html = await actuals(pageEnv());
    expect(html).toContain('Costco run');
    expect(html).toContain('Daycare app');
    expect(html).toContain('edit=2#daycare-edit');
    expect(html).toContain('edit=3#daycare-edit');
    expect(html).toContain('<input type="hidden" name="id" value="3">');
    expect(html).not.toContain('<input type="hidden" name="id" value="2">');
  });

  it('opens a pre-filled edit form for ?edit=<id> that posts to the edit relay', async () => {
    const html = await actuals(pageEnv(), '&edit=3');
    expect(html).toContain('action="/api/v1/connect-daycare-entry-edit"');
    expect(html).toContain('name="category" value="Supplies"');
    expect(html).toContain('name="amount" step="0.01" value="45.00"');
  });

  it('keeps the page working when an older Connect has no entries endpoint', async () => {
    const html = await actuals(pageEnv({ entriesResponse: new Response('nf', { status: 404 }) }));
    expect(html).toContain('individual entry list is unavailable right now (http_error)');
    expect(html).toContain('Record an entry');
  });
});
