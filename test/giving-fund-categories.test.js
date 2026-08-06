import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  FUND_CATEGORIES, normalizeFundCategory, fundCategoryLabel, fundNumericPrefix,
  defaultFundCategories, buildBoardCategoryBlock,
} from '../src/api-utils.js';
import { handleReportsApi } from '../src/api-reports.js';

describe('normalizeFundCategory', () => {
  it('accepts every real category key', () => {
    for (const c of FUND_CATEGORIES) expect(normalizeFundCategory(c.key)).toBe(c.key);
  });

  it('falls back to restricted for anything unrecognized', () => {
    // Conservative on purpose: a designated gift wrongly counted as General Fund would
    // OVERSTATE the board's headline number; the reverse only understates it.
    for (const v of ['', null, undefined, 'GENERALFUND', 'operating', 42, {}]) {
      expect(normalizeFundCategory(v)).toBe('restricted');
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeFundCategory('  General  ')).toBe('general');
    expect(normalizeFundCategory('PASSIVE')).toBe('passive');
  });

  it('labels every key, and unknown keys as restricted', () => {
    expect(fundCategoryLabel('general')).toBe('General Fund');
    expect(fundCategoryLabel('earned')).toBe('Earned income');
    expect(fundCategoryLabel('nonsense')).toBe('Restricted & designated');
  });
});

describe('defaultFundCategories (the 0033 backfill)', () => {
  it('promotes the whole numeric-code family of the fund named "General Fund"', () => {
    const map = defaultFundCategories([
      { id: 1, name: '40085 General Fund' },
      { id: 2, name: '40085 Christmas Offering' },
      { id: 3, name: '40085 Advent Offering' },
      { id: 4, name: '25004 Building Fund' },
      { id: 5, name: 'Memorials' },
    ]);
    expect([...map.entries()].sort()).toEqual([[1, 'general'], [2, 'general'], [3, 'general']]);
  });

  it('promotes only the fund itself when it carries no numeric code', () => {
    const map = defaultFundCategories([
      { id: 1, name: 'General Fund' },
      { id: 2, name: 'Building Fund' },
    ]);
    expect([...map.entries()]).toEqual([[1, 'general']]);
  });

  it('promotes nothing when no fund is named General Fund', () => {
    expect(defaultFundCategories([{ id: 1, name: 'Memorials' }]).size).toBe(0);
    expect(defaultFundCategories([]).size).toBe(0);
    expect(defaultFundCategories(null).size).toBe(0);
  });

  it('reads a leading numeric code, and only a leading one', () => {
    expect(fundNumericPrefix('40085 General Fund')).toBe('40085');
    expect(fundNumericPrefix('General Fund 40085')).toBe(null);
    expect(fundNumericPrefix('40085General')).toBe(null); // needs the separating space
  });
});

describe('buildBoardCategoryBlock', () => {
  const base = {
    key: 'general', label: 'General Fund', hhLabel: 'Giving households',
    throughMonth: 6, sundaysElapsed: 26,
  };

  it('sums the category and derives its own budget, projection and averages', () => {
    const b = buildBoardCategoryBlock({
      ...base,
      // prior_cents is last year through the SAME NUMBER OF SUNDAYS (the query that produces
      // these rows is bound to that date), so it must agree with priorMonthly through the same
      // point — 6 x $100 = $600. It is now the single source for "vs last year at this point";
      // the block used to slice priorMonthly separately, which was a second, differently-bounded
      // answer to the same question.
      funds: [
        { actual_cents: 100000, prior_cents: 50000, annual_budget_cents: 240000 },
        { actual_cents: 20000, prior_cents: 10000, annual_budget_cents: 0 },
      ],
      curMonthly: [20000, 20000, 20000, 20000, 20000, 20000, 0, 0, 0, 0, 0, 0],
      priorMonthly: [...Array(12)].map(() => 10000), // $100/mo flat prior year
      householdTotals: [80000, 30000, 10000],
      householdsPrior: 2,
      methodBuckets: { check: 90000, ach: 30000, cash: 0, other: 0 },
    });
    expect(b.given_ytd_cents).toBe(120000);
    expect(b.given_ytd_prior_cents).toBe(60000); // 6 months x $100
    expect(b.given_ytd_delta_pct).toBe(100);
    expect(b.annual_budget_cents).toBe(240000);
    expect(b.budget_ytd_cents).toBe(120000);    // flat prior shape -> half the year
    expect(b.budget_variance_cents).toBe(0);
    expect(b.projection_cents).toBe(240000);    // seasonal: 120000 x (120000/60000)
    expect(b.projection_method).toBe('seasonal');
    expect(b.households).toBe(3);
    expect(b.households_prior).toBe(2);
    expect(b.avg_per_household_cents).toBe(40000);
    expect(b.method_mix.find(m => m.key === 'check').pct).toBe(75);
  });

  it('reports no budget as null, not $0 — "—" on the card, never a false 100% shortfall', () => {
    const b = buildBoardCategoryBlock({
      ...base, key: 'restricted', label: 'Restricted & designated',
      funds: [{ actual_cents: 5000, prior_cents: 0, annual_budget_cents: 0 }],
      curMonthly: new Array(12).fill(0), priorMonthly: new Array(12).fill(0),
      householdTotals: [5000], methodBuckets: {},
    });
    expect(b.annual_budget_cents).toBe(null);
    expect(b.budget_ytd_cents).toBe(null);
    expect(b.budget_variance_cents).toBe(null);
    expect(b.has_budget).toBe(false);
  });

  it('lets the Church Report budget override the funds own budgets, for General Fund only', () => {
    const funds = [{ actual_cents: 100000, prior_cents: 0, annual_budget_cents: 500000 }];
    const monthly = { curMonthly: new Array(12).fill(0), priorMonthly: new Array(12).fill(0) };
    const withOverride = buildBoardCategoryBlock({ ...base, funds, ...monthly, householdTotals: [], methodBuckets: {}, budgetAnnualOverride: 900000 });
    const without = buildBoardCategoryBlock({ ...base, funds, ...monthly, householdTotals: [], methodBuckets: {} });
    expect(withOverride.annual_budget_cents).toBe(900000);
    expect(without.annual_budget_cents).toBe(500000);
  });

  it('handles an empty category without dividing by zero', () => {
    const b = buildBoardCategoryBlock({
      ...base, key: 'passive', label: 'Passive income', funds: [],
      curMonthly: new Array(12).fill(0), priorMonthly: new Array(12).fill(0),
      householdTotals: [], methodBuckets: {},
    });
    expect(b.given_ytd_cents).toBe(0);
    expect(b.fund_count).toBe(0);
    expect(b.avg_per_household_cents).toBe(0);
    expect(b.method_mix.every(m => m.pct === 0)).toBe(true);
  });
});

// ── The lens against a real database ─────────────────────────────────────────
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of ['0001_baseline', '0018_finance_church_entries', '0028_fund_budget', '0033_fund_category']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), 'utf8'));
  }
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
    _raw: sqlite,
  };
}

function fund(db, name, category, budget = 0) {
  db._raw.prepare('INSERT INTO funds (name, category, budget_annual_cents) VALUES (?,?,?)').run(name, category, budget);
  return db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function gift(db, { fundId, amount, date, personId = null, method = 'check' }) {
  db._raw.prepare('INSERT INTO giving_batches (batch_date) VALUES (?)').run(date);
  const batchId = db._raw.prepare('SELECT last_insert_rowid() AS id').get().id;
  db._raw.prepare(
    'INSERT INTO giving_entries (batch_id, fund_id, person_id, amount, method, contribution_date) VALUES (?,?,?,?,?,?)'
  ).run(batchId, fundId, personId, amount, method, date);
}
async function board(db, period) {
  const res = await handleReportsApi({}, {}, new URL(`https://x/a?period=${period}`), 'GET', 'reports/giving-board', db, true, true, true, true);
  return res.json();
}

describe('giving-board fund lens', () => {
  it('scopes YTD to the selected category, and the categories add back up to All giving', async () => {
    const db = makeTestDb();
    const gen = fund(db, '40085 General Fund', 'general');
    const rent = fund(db, '46000 Facility Rental', 'earned');
    const interest = fund(db, '42000 Interest Income', 'passive');
    const memorial = fund(db, 'Memorials', 'restricted');
    db._raw.prepare('INSERT INTO people (id, first_name, last_name) VALUES (1,?,?)').run('A', 'One');
    db._raw.prepare('INSERT INTO people (id, first_name, last_name) VALUES (2,?,?)').run('B', 'Two');
    gift(db, { fundId: gen, amount: 500000, date: '2026-02-01', personId: 1 });
    gift(db, { fundId: gen, amount: 200000, date: '2026-02-08', personId: 2 });
    gift(db, { fundId: rent, amount: 80000, date: '2026-02-10', personId: 2 });
    gift(db, { fundId: interest, amount: 1200, date: '2026-02-11', personId: 1 });
    gift(db, { fundId: memorial, amount: 30000, date: '2026-02-12', personId: 1 });

    const b = await board(db, '2026-02');
    expect(b.categories.general.given_ytd_cents).toBe(700000);
    expect(b.categories.earned.given_ytd_cents).toBe(80000);
    expect(b.categories.passive.given_ytd_cents).toBe(1200);
    expect(b.categories.restricted.given_ytd_cents).toBe(30000);
    // The whole point of the lens: the four positions reconcile to the fifth.
    const sum = ['general', 'earned', 'passive', 'restricted']
      .reduce((s, k) => s + b.categories[k].given_ytd_cents, 0);
    expect(sum).toBe(b.categories.all.given_ytd_cents);
    expect(b.categories.all.given_ytd_cents).toBe(811200);
  });

  it('counts households per category, and never double-counts one in the all-funds total', async () => {
    const db = makeTestDb();
    const gen = fund(db, 'General Fund', 'general');
    const rent = fund(db, 'Rental', 'earned');
    db._raw.prepare('INSERT INTO people (id, first_name, last_name) VALUES (1,?,?)').run('A', 'One');
    // One person giving to two categories is one household overall, one in each category.
    gift(db, { fundId: gen, amount: 10000, date: '2026-03-01', personId: 1 });
    gift(db, { fundId: rent, amount: 5000, date: '2026-03-02', personId: 1 });
    const b = await board(db, '2026-03');
    expect(b.categories.general.households).toBe(1);
    expect(b.categories.earned.households).toBe(1);
    expect(b.categories.all.households).toBe(1);
    expect(b.categories.all.given_ytd_cents).toBe(15000);
  });

  it('gives each category its own monthly arrays, so a small one is not flattened by a big one', async () => {
    const db = makeTestDb();
    const gen = fund(db, 'General Fund', 'general');
    const interest = fund(db, 'Interest', 'passive');
    gift(db, { fundId: gen, amount: 500000, date: '2026-01-15' });
    gift(db, { fundId: interest, amount: 900, date: '2026-02-15' });
    const b = await board(db, '2026-02');
    expect(b.categories.general.monthly.current[0]).toBe(500000);
    expect(b.categories.general.monthly.current[1]).toBe(0);
    expect(b.categories.passive.monthly.current[0]).toBe(0);
    expect(b.categories.passive.monthly.current[1]).toBe(900);
  });

  it('falls back to the old name-prefix rule when nothing has been categorized general yet', async () => {
    // A database that has the column but has never been backfilled must not suddenly report a
    // $0 General Fund — the headline number the council reads.
    const db = makeTestDb();
    const gen = fund(db, '40085 General Fund', 'restricted');
    const xmas = fund(db, '40085 Christmas Offering', 'restricted');
    const building = fund(db, '25004 Building Fund', 'restricted');
    gift(db, { fundId: gen, amount: 100000, date: '2026-02-01' });
    gift(db, { fundId: xmas, amount: 5000, date: '2026-02-02' });
    gift(db, { fundId: building, amount: 20000, date: '2026-02-03' });
    const b = await board(db, '2026-02');
    expect(b.categories.general.given_ytd_cents).toBe(105000);
    expect(b.categories.restricted.given_ytd_cents).toBe(20000);
    expect(b.general_fund.given_ytd_cents).toBe(105000); // legacy key still agrees
  });

  it('keeps households and method mix WITH the fallback general fund, not in restricted', async () => {
    // The fallback lives in JS, so anything the SQL groups by f.category would land in the
    // wrong bucket: a General Fund YTD of $1,000 sitting next to zero households and a blank
    // navy panel, with the real figures filed under Restricted.
    const db = makeTestDb();
    const gen = fund(db, '40085 General Fund', 'restricted'); // never backfilled
    db._raw.prepare('INSERT INTO people (id, first_name, last_name, household_id) VALUES (1,?,?,7)').run('A', 'One');
    gift(db, { fundId: gen, amount: 100000, date: '2026-02-01', personId: 1, method: 'check' });
    const b = await board(db, '2026-02');
    expect(b.categories.general.given_ytd_cents).toBe(100000);
    expect(b.categories.general.households).toBe(1);
    expect(b.categories.general.method_mix.find(m => m.key === 'check').cents).toBe(100000);
    expect(b.categories.restricted.households).toBe(0);
    expect(b.categories.restricted.method_mix.find(m => m.key === 'check').cents).toBe(0);
  });

  it('reports a category with no funds as empty rather than erroring', async () => {
    const db = makeTestDb();
    const gen = fund(db, 'General Fund', 'general');
    gift(db, { fundId: gen, amount: 10000, date: '2026-04-01' });
    const b = await board(db, '2026-04');
    expect(b.categories.passive.fund_count).toBe(0);
    expect(b.categories.passive.given_ytd_cents).toBe(0);
    expect(b.categories.passive.budget_ytd_cents).toBe(null);
  });

  it('carries each fund row category through, and labels the lens options', async () => {
    const db = makeTestDb();
    fund(db, 'General Fund', 'general');
    fund(db, 'Rental', 'earned');
    const b = await board(db, '2026-05');
    const byName = Object.fromEntries(b.funds.map(f => [f.name, f]));
    expect(byName['General Fund'].category).toBe('general');
    expect(byName['Rental'].category).toBe('earned');
    expect(b.fund_categories.map(c => c.key)).toEqual(['general', 'earned', 'passive', 'restricted']);
  });
});
