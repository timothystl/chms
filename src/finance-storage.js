// Accounting storage cutover. Connect remains the authenticated compatibility API;
// accounting records have one selected database, while people/Giving/QuickBooks stay
// in Connect. Do not use this wrapper during Connect schema initialization.
export const FINANCE_TABLES = new Set([
  'finance_settings', 'finance_church_entries', 'finance_church_balances',
  'finance_daycare_entries', 'finance_budget_plan', 'finance_property_monthly',
  'finance_property_reserves', 'finance_property_budget_monthly', 'finance_property_repairs',
  'finance_property_capital_ledger', 'finance_property_distributions', 'finance_import_log',
  'finance_property_reserve_disbursements', 'finance_daycare_rooms',
]);
const cache = new WeakMap();

export function accountingQuery(sql) {
  // Strip values/comments so an account label never changes the selected database.
  const code = String(sql).replace(/'(?:''|[^'])*'/g, "''").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  const tables = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+["`\[]?([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase());
  const finance = tables.some(t => FINANCE_TABLES.has(t));
  // Never attempt a cross-database join. None of the current accounting queries
  // join an identity/Giving table; those independent reads use Connect's handle.
  if (finance && tables.some(t => /^(app_users|giving_|funds$|members$|households$|finance_qb_)/.test(t))) {
    throw new Error('Accounting query crosses database ownership');
  }
  return { finance, writes: /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|REINDEX)\b/i.test(code) };
}

export function financeStorageDb(env) {
  const mode = env.FINANCE_STORAGE_MODE || 'connect';
  if (mode === 'connect') return env.DB;
  if (!['copying', 'finance'].includes(mode)) throw new Error('Invalid Finance storage mode');
  if (mode === 'finance' && !env.FINANCE_DB) throw new Error('Finance database binding missing');
  let entries = cache.get(env.DB);
  if (!entries) cache.set(env.DB, entries = []);
  const previous = entries.find(e => e.mode === mode && e.target === env.FINANCE_DB);
  if (previous) return previous.db;
  const statements = new WeakMap();
  function wrap(statement, owner) {
    const value = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args) => wrap(target.bind(...args), owner);
      const member = target[key]; return typeof member === 'function' ? member.bind(target) : member;
    } });
    statements.set(value, {statement,owner}); return value;
  }
  const db = {
    prepare(sql) {
      const query = accountingQuery(sql);
      if (mode === 'copying' && query.finance && query.writes) throw new Error('Accounting maintenance: writes temporarily paused for verified migration');
      const owner = query.finance && mode === 'finance' ? env.FINANCE_DB : env.DB;
      return wrap(owner.prepare(sql), owner);
    },
    batch(items) {
      if (!items.length) return Promise.resolve([]);
      const mapped = items.map(item => {
        const value = statements.get(item);
        if (!value) throw new Error('Unrecognized accounting batch statement');
        return value;
      });
      const owner = mapped[0].owner;
      if (mapped.some(item => item.owner !== owner)) throw new Error('Batch crosses database ownership');
      return owner.batch(mapped.map(item => item.statement));
    },
  };
  entries.push({mode,target:env.FINANCE_DB,db}); return db;
}
