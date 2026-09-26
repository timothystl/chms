// ── Board layout (Chart of Accounts presentation) ────────────────────────────────────────────
// Legacy Budget Planner's Board view (finBuildBoardTree and its helpers in src/frontend/
// js-finance.js), ported for Finance's server-rendered Budget builder and Chart of Accounts editor.
// Every account is placed in one board category: its saved assignment from Chart of Accounts, or,
// with none saved, legacy's default matched against the account's own QuickBooks name. Categories
// appear in legacy's fixed order under their saved or default headings; Unrestricted and
// Restricted gifts nest under one "Donor Income" wrapper. Account display names are the saved
// renames, else the QuickBooks name. The saved settings come from connect.finance-board-layout.v1;
// Connect's applyBoardCategoryMerge (src/api-finance.js) remains the authoritative allowlist.

// Legacy FIN_BOARD_REV_RULES / FIN_BOARD_EXP_RULES, verbatim and in the same order (a rule must be
// tested before the narrower catch-all it was carved out of).
const REV_RULES = [
  { key: 'restricted', re: /\brestricted\b|altar guild|designated/i },
  { key: 'passive', re: /passive|endowment|investment|interest|dividend|ivanhoe|bequest|trust/i },
  { key: 'earned', re: /mdo|mother'?s day out|daycare|tuition|rental|rent\b|lease|fundrais|facility|program fee|earned/i },
  { key: 'donor', re: /offering|contribution|donor|donation|gift|pledge|tithe|memorial/i },
];
const EXP_RULES = [
  { key: 'mdo', re: /mdo|mother'?s day out/i },
  { key: 'salaries', re: /salar|payroll|wage|compensation/i },
  { key: 'benefits', re: /benefit|pension|fica|health insurance|disability/i },
  { key: 'worship', re: /worship|music|choir|organist|liturg|hymn/i },
  { key: 'education', re: /educat|school|lutheran high|scholarship|tuition aid|seminar/i },
  { key: 'property', re: /propert|facilit|utilit|maintenance|building|grounds|janitor|custodial|repair|mortgage|insuranc/i },
  { key: 'youth_family', re: /youth|family ministr|family life/i },
  { key: 'district_synod', re: /district|synod/i },
  { key: 'programs', re: /program|children|mission|outreach|fellowship|evangel/i },
];
export const BOARD_REVENUE_ORDER = ['donor', 'earned', 'passive', 'restricted'];
export const BOARD_EXPENSE_ORDER = ['mdo', 'salaries', 'benefits', 'worship', 'property', 'education', 'youth_family', 'district_synod', 'programs'];
export const BOARD_REVENUE_DEFAULT_LABELS = { donor: 'Unrestricted Gifts', earned: 'Earned Income', passive: 'Passive Income', restricted: 'Restricted Gifts' };
export const BOARD_EXPENSE_DEFAULT_LABELS = {
  mdo: 'MDO', salaries: 'Salaries', benefits: 'Benefits', worship: 'Worship & Music', property: 'Property & Operations',
  education: 'Lutheran Education', youth_family: 'Youth & Family', district_synod: 'District & Synod Support', programs: 'Programs',
};
export const DONOR_WRAPPER_DEFAULT_LABEL = 'Donor Income';

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// The contract payload (or nothing) as one plain settings object; every map is present.
export function normalizeBoardLayout(payload) {
  const c = isObject(payload && payload.boardCategories) ? payload.boardCategories : {};
  const t = isObject(payload && payload.purposeTags) ? payload.purposeTags : {};
  return {
    revenue: isObject(c.revenue) ? c.revenue : {},
    expense: isObject(c.expense) ? c.expense : {},
    revenueLabels: isObject(c.revenueLabels) ? c.revenueLabels : {},
    expenseLabels: isObject(c.expenseLabels) ? c.expenseLabels : {},
    donorWrapperLabel: typeof c.donorWrapperLabel === 'string' ? c.donorWrapperLabel : '',
    accountLabels: isObject(c.accountLabels) ? c.accountLabels : {},
    tags: Array.isArray(t.tags) ? t.tags.filter((x) => x && typeof x.id === 'string' && typeof x.label === 'string') : [],
    tagCategories: isObject(t.categories) ? t.categories : {},
  };
}

export function defaultBoardCategory(name, isRevenue) {
  for (const rule of (isRevenue ? REV_RULES : EXP_RULES)) if (rule.re.test(name || '')) return rule.key;
  // Unmatched revenue defaults to earned, not donor: overstating donor revenue overstates what the
  // board can redirect (legacy's own reasoning).
  return isRevenue ? 'earned' : 'programs';
}

export function boardCategoryFor(layout, path, name, isRevenue) {
  const saved = (isRevenue ? layout.revenue : layout.expense)[path];
  const order = isRevenue ? BOARD_REVENUE_ORDER : BOARD_EXPENSE_ORDER;
  if (saved && order.includes(saved)) return { key: saved, assigned: true };
  return { key: defaultBoardCategory(name, isRevenue), assigned: false };
}

export function boardLabelFor(layout, key, isRevenue) {
  const custom = (isRevenue ? layout.revenueLabels : layout.expenseLabels)[key];
  return custom || (isRevenue ? BOARD_REVENUE_DEFAULT_LABELS : BOARD_EXPENSE_DEFAULT_LABELS)[key] || key;
}

export function donorWrapperLabel(layout) {
  return layout.donorWrapperLabel || DONOR_WRAPPER_DEFAULT_LABEL;
}

export function accountDisplayName(layout, path, name) {
  return layout.accountLabels[path] || name;
}

// Lays out items (budget lines or accounts) the way legacy's Board view does. `pick` reads an item's
// path, QuickBooks name and side. Returns { revenue, expense }: each a list of sections, where a
// section is { kind: 'group', key, label, items } or, for revenue, one { kind: 'wrapper', label,
// groups } holding the Unrestricted and Restricted groups. Empty categories are left out, as legacy
// does; items keep their incoming order within a category.
export function buildBoardSections(items, layout, pick) {
  const buckets = { revenue: {}, expense: {} };
  for (const item of items) {
    const { path, name, isRevenue } = pick(item);
    const side = isRevenue ? 'revenue' : 'expense';
    const { key } = boardCategoryFor(layout, path, name, isRevenue);
    (buckets[side][key] = buckets[side][key] || []).push(item);
  }
  const group = (side, key) => {
    const members = buckets[side][key];
    return members && members.length ? { kind: 'group', key, isRevenue: side === 'revenue', label: boardLabelFor(layout, key, side === 'revenue'), items: members } : null;
  };
  const revenue = [];
  const donorGroups = ['donor', 'restricted'].map((k) => group('revenue', k)).filter(Boolean);
  if (donorGroups.length) revenue.push({ kind: 'wrapper', label: donorWrapperLabel(layout), groups: donorGroups });
  for (const key of ['earned', 'passive']) { const g = group('revenue', key); if (g) revenue.push(g); }
  const expense = BOARD_EXPENSE_ORDER.map((k) => group('expense', k)).filter(Boolean);
  return { revenue, expense };
}

// The Chart of Accounts Budget layout editor's two forms, turned into merge bodies for Connect's
// finance-board-categories-write-v1 and finance-purpose-tags-write-v1 contracts. Headings send all
// fifteen names (a blank one resets that heading). The account table sends only rows whose
// category, display name or tag differs from what the page was rendered with, so an account on its
// automatic category is not pinned to it by saving a neighbor. A bulk move applies to selected rows
// on its own side only. Returns null for a body with nothing to send.
export function buildBoardLayoutWrites(form, kind) {
  if (kind === 'headings') {
    const revenueLabels = Object.fromEntries(BOARD_REVENUE_ORDER.map((k) => [k, String(form.get(`label_revenue_${k}`) || '').trim()]));
    const expenseLabels = Object.fromEntries(BOARD_EXPENSE_ORDER.map((k) => [k, String(form.get(`label_expense_${k}`) || '').trim()]));
    return { boardBody: { revenueLabels, expenseLabels, donorWrapperLabel: String(form.get('donor_wrapper_label') || '').trim() }, tagsBody: null };
  }
  const [bulkSide, bulkKey] = String(form.get('bulk_category') || '').split(':');
  const revenue = {}, expense = {}, accountLabels = {}, categories = {};
  for (let i = 0; form.has(`path_${i}`); i++) {
    const path = String(form.get(`path_${i}`) || '');
    if (!path) continue;
    const side = form.get(`side_${i}`) === 'revenue' ? 'revenue' : 'expense';
    const allowed = side === 'revenue' ? BOARD_REVENUE_ORDER : BOARD_EXPENSE_ORDER;
    let cat = String(form.get(`cat_${i}`) || '');
    if (form.get(`select_${i}`) === '1' && bulkSide === side && (bulkKey === '' || allowed.includes(bulkKey))) cat = bulkKey;
    if (cat !== '' && !allowed.includes(cat)) continue;
    if (cat !== String(form.get(`orig_cat_${i}`) || '')) (side === 'revenue' ? revenue : expense)[path] = cat;
    const name = String(form.get(`name_${i}`) || '').trim();
    if (name !== String(form.get(`orig_name_${i}`) || '').trim()) accountLabels[path] = name;
    const tag = String(form.get(`tag_${i}`) || '');
    if (tag !== String(form.get(`orig_tag_${i}`) || '')) categories[path] = tag;
  }
  const boardBody = {};
  if (Object.keys(revenue).length) boardBody.revenue = revenue;
  if (Object.keys(expense).length) boardBody.expense = expense;
  if (Object.keys(accountLabels).length) boardBody.accountLabels = accountLabels;
  return {
    boardBody: Object.keys(boardBody).length ? boardBody : null,
    tagsBody: Object.keys(categories).length ? { categories } : null,
  };
}
