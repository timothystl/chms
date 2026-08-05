import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { HTML_TABS_1, HTML_TABS_2 } from '../src/frontend/html-tabs.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { JS_GIVING } from '../src/frontend/js-giving.js';

const TABS = HTML_TABS_1 + HTML_TABS_2;
const GIVING_MARKUP = TABS.slice(TABS.indexOf('<div id="tab-giving"'), TABS.indexOf('<!-- ═══ REPORTS TAB ═══ -->'));

describe('Giving sub-nav consolidation (markup)', () => {
  it('has exactly the four consolidated views, each with a button and a panel', () => {
    for (const v of ['offerings', 'reports', 'comms', 'settings']) {
      expect(GIVING_MARKUP).toContain(`id="giv-view-${v}-btn"`);
      expect(GIVING_MARKUP).toContain(`id="giv-view-${v}"`);
    }
    const btns = [...GIVING_MARKUP.matchAll(/id="giv-view-([a-z]+)-btn"/g)].map((m) => m[1]);
    expect(btns).toEqual(['offerings', 'reports', 'comms', 'settings']);
  });

  it('retired the eight old top-level view panels', () => {
    for (const v of ['batches', 'transactions', 'deposits', 'board', 'letters', 'receipts']) {
      expect(GIVING_MARKUP).not.toContain(`id="giv-view-${v}"`);
    }
  });

  it('keeps every retired screen alive as a pane inside its new home', () => {
    for (const p of ['batches', 'transactions', 'deposits', 'letters', 'receipts']) {
      expect(GIVING_MARKUP).toContain(`id="giv-pane-${p}"`);
    }
  });

  it('mounts the work queue, fund lens, everything-else strip and analysis body', () => {
    expect(GIVING_MARKUP).toContain('id="giv-queue"');
    expect(GIVING_MARKUP).toContain('id="board-lens"');
    expect(GIVING_MARKUP).toContain('id="board-else-strip"');
    expect(GIVING_MARKUP).toContain('id="giv-analysis-body"');
    expect(GIVING_MARKUP).toContain('id="board-mode-analysis-btn"');
  });

  it('moved the Plateaus and Bands cards out of the board page into Analysis', () => {
    const analysisStart = GIVING_MARKUP.indexOf('id="giv-analysis-body"');
    const analysisEnd = GIVING_MARKUP.indexOf('/giv-analysis-body');
    const analysis = GIVING_MARKUP.slice(analysisStart, analysisEnd);
    expect(analysis).toContain('id="giv-plat-output"');
    expect(analysis).toContain('id="giv-bands-output"');
    // ...and the board body itself ends at the fund table, before them.
    const boardBody = GIVING_MARKUP.slice(GIVING_MARKUP.indexOf('id="board-body"'), analysisStart);
    expect(boardBody).not.toContain('giv-plat-output');
  });

  it('adds the Fund categories card the lens depends on', () => {
    expect(GIVING_MARKUP).toContain('id="giv-fundcat-root"');
    expect(GIVING_MARKUP).toContain('givSaveFundCategories()');
  });

  it('sends the Attendance tab\'s Giving x Attendance link to Analysis, not the board page', () => {
    // Before the consolidation `giv-view-reports` WAS the Analysis tile grid holding that
    // report; now it's the council dashboard, so the plain 'reports' name lands on the wrong
    // screen. The alias map exists for exactly this.
    expect(TABS).toContain("givSetView(&#39;analysis&#39;);\">Open</button>");
    expect(TABS).not.toContain("showTab(&#39;giving&#39;);givSetView(&#39;reports&#39;);");
  });

  it('does not promise gift/donor search from a box that only filters batches', () => {
    const box = GIVING_MARKUP.slice(GIVING_MARKUP.indexOf('id="batch-search-input"') - 200,
                                    GIVING_MARKUP.indexOf('id="batch-search-input"') + 300);
    expect(box).toContain('Search batches');
    expect(box).not.toContain('Search gifts, donors');
  });

  it('prints the Reports view, not the retired board panel id', () => {
    const style = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));
    expect(style).toContain('body.printing-board #giv-view-reports{display:block!important;}');
    expect(style).not.toContain('#giv-view-board');
    // Analysis tiles must never end up in a printed council packet.
    expect(style).toContain('body.printing-board #giv-analysis-body{display:none!important;}');
  });
});

// ── Behaviour, run against the real served script ────────────────────────────
function makeSandbox() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id, style: {}, innerHTML: '', textContent: '', value: '', dataset: {}, options: [],
        _classes: new Set(),
        classList: {
          add(c) { els.get(id)._classes.add(c); },
          remove(c) { els.get(id)._classes.delete(c); },
          toggle(c, on) { on ? els.get(id)._classes.add(c) : els.get(id)._classes.delete(c); },
          contains(c) { return els.get(id)._classes.has(c); },
        },
        appendChild() {}, removeChild() {}, querySelectorAll: () => [],
      });
    }
    return els.get(id);
  };
  const calls = [];
  const sandbox = {
    document: {
      getElementById: (id) => el(id),
      querySelectorAll: () => [],
      createElement: () => ({ innerHTML: '', parentNode: null }),
      body: { classList: { add() {}, remove() {} } },
    },
    window: { addEventListener() {}, removeEventListener() {}, print() {} },
    console,
    setTimeout: () => 0,
    api: (path) => { calls.push(path); return Promise.resolve({}); },
    esc: (s) => String(s == null ? '' : s),
    fmtMoney: (c) => '$' + ((c || 0) / 100).toFixed(2),
    fmtDate: (d) => String(d),
    showTab: () => {},
    allFunds: [], _batchSearch: '',
    // Downstream inits the giving views call; stubbed so switching views is observable
    // without dragging every other frontend module into the sandbox.
    loadGivingTransactions() {}, givTxnPopulateFundOptions() {}, loadDeposits() {},
    givLettersInit() {}, givReceiptsInit() {}, givAnalysisInit() {}, finInitGivingReports() {},
    loadGivingSettings() {}, givPopulateFundSelect() {}, initReportTrendYears() {},
    _churchConfig: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = JS_GIVING.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  vm.runInContext(src, sandbox);
  return { sandbox, el, calls, els };
}

describe('givSetView', () => {
  let s;
  beforeEach(() => { s = makeSandbox(); });

  it('shows only the requested view', () => {
    s.sandbox.givSetView('reports');
    expect(s.el('giv-view-reports').style.display).toBe('');
    expect(s.el('giv-view-offerings').style.display).toBe('none');
    expect(s.el('giv-view-comms').style.display).toBe('none');
    expect(s.el('giv-view-reports-btn')._classes.has('active')).toBe(true);
    expect(s.el('giv-view-offerings-btn')._classes.has('active')).toBe(false);
  });

  it('redirects every retired view name to its new home — no blank panel from a stale link', () => {
    const cases = {
      batches: 'offerings', transactions: 'offerings', deposits: 'offerings',
      board: 'reports', analysis: 'reports', letters: 'comms', receipts: 'comms',
    };
    for (const [old, home] of Object.entries(cases)) {
      const fresh = makeSandbox();
      fresh.sandbox.givSetView(old);
      expect(fresh.el('giv-view-' + home).style.display, old).toBe('');
    }
  });

  it('opens the specific pane the old name meant, not just the parent tab', () => {
    s.sandbox.givSetView('deposits');
    expect(s.el('giv-pane-deposits').style.display).toBe('');
    expect(s.el('giv-pane-batches').style.display).toBe('none');

    const c = makeSandbox();
    c.sandbox.givSetView('receipts');
    expect(c.el('giv-pane-receipts').style.display).toBe('');
    expect(c.el('giv-pane-letters').style.display).toBe('none');
  });

  it('lands "analysis" on the Analysis mode of Reports', () => {
    s.sandbox.givSetView('analysis');
    expect(s.el('giv-view-reports').style.display).toBe('');
    expect(s.el('giv-analysis-body').style.display).toBe('');
    expect(s.el('board-body').style.display).toBe('none');
    expect(s.el('board-mode-analysis-btn')._classes.has('active')).toBe(true);
  });

  it('falls back to Offerings for a name that means nothing', () => {
    s.sandbox.givSetView('nonsense');
    expect(s.el('giv-view-offerings').style.display).toBe('');
  });

  it('will not un-hide a finance-only view for a role that cannot see it', () => {
    // applyPermissionUI hides .require-finance panels with an inline display:none; the view
    // loop would otherwise undo that, parking an office-level user on an empty Reports panel.
    s.sandbox.permView = (item) => item !== 'giving';
    s.sandbox.givSetView('board');
    expect(s.el('giv-view-reports').style.display).toBe('none');
    expect(s.el('giv-view-offerings').style.display).toBe('');
    s.sandbox.givSetView('deposits');
    expect(s.el('giv-pane-deposits').style.display).toBe('none');
    expect(s.el('giv-pane-batches').style.display).toBe('');
  });
});

describe('board fund lens', () => {
  const DATA = {
    year: 2026, prior_year: 2025, through_month: 8,
    period_label: 'August 2026', through_label: 'Through August 31, 2026',
    fund_categories: [
      { key: 'general', label: 'General Fund', hh_label: 'Giving households' },
      { key: 'earned', label: 'Earned income', hh_label: 'Paying households' },
      { key: 'passive', label: 'Passive income', hh_label: 'Income sources' },
      { key: 'restricted', label: 'Restricted & designated', hh_label: 'Giving households' },
    ],
    categories: {
      general: { key: 'general', label: 'General Fund', hh_label: 'Giving households', fund_count: 3, given_ytd_cents: 21113100, given_ytd_prior_cents: 27068100, given_ytd_delta_pct: -22, budget_ytd_cents: null, budget_variance_cents: null, households: 180, households_prior: 190, avg_per_household_cents: 117295, projection_cents: 30000000, projection_method: 'seasonal', projection_vs_budget_cents: null, annual_budget_cents: null, has_budget: false, funds: [{ name: '40085 General Fund', actual_cents: 21113100, prior_cents: 27068100, budget_ytd_cents: null, variance_cents: null }], monthly: { current: new Array(12).fill(100000), prior: new Array(12).fill(90000) }, method_mix: [{ key: 'check', label: 'Check', cents: 1, pct: 100 }, { key: 'ach', label: 'ACH / online', cents: 0, pct: 0 }, { key: 'cash', label: 'Cash / loose plate', cents: 0, pct: 0 }, { key: 'other', label: 'Stock, IRA, other', cents: 0, pct: 0 }], concentration: { top10_pct: 41, half_households: 22, segments: [{ label: 'Top 10', pct: 41 }] } },
      earned: { key: 'earned', label: 'Earned income', hh_label: 'Paying households', fund_count: 1, given_ytd_cents: 4200000, given_ytd_prior_cents: 3900000, given_ytd_delta_pct: 8, budget_ytd_cents: null, budget_variance_cents: null, households: 6, households_prior: 5, avg_per_household_cents: 700000, projection_cents: 6000000, projection_method: 'linear', projection_vs_budget_cents: null, annual_budget_cents: null, has_budget: false, funds: [], monthly: { current: new Array(12).fill(0), prior: new Array(12).fill(0) }, method_mix: [{ key: 'check', label: 'Check', cents: 1, pct: 100 }, { key: 'ach', label: 'ACH / online', cents: 0, pct: 0 }, { key: 'cash', label: 'Cash / loose plate', cents: 0, pct: 0 }, { key: 'other', label: 'Stock, IRA, other', cents: 0, pct: 0 }], concentration: { top10_pct: 100, half_households: 1, segments: [] } },
      passive: { key: 'passive', label: 'Passive income', hh_label: 'Income sources', fund_count: 1, given_ytd_cents: 180000, given_ytd_prior_cents: 150000, given_ytd_delta_pct: 8, budget_ytd_cents: null, budget_variance_cents: null, households: 2, households_prior: 2, avg_per_household_cents: 90000, projection_cents: 240000, projection_method: 'linear', projection_vs_budget_cents: null, annual_budget_cents: null, has_budget: false, funds: [], monthly: { current: new Array(12).fill(15000), prior: new Array(12).fill(12000) }, method_mix: [{ key: 'check', label: 'Check', cents: 1, pct: 100 }, { key: 'ach', label: 'ACH / online', cents: 0, pct: 0 }, { key: 'cash', label: 'Cash / loose plate', cents: 0, pct: 0 }, { key: 'other', label: 'Stock, IRA, other', cents: 0, pct: 0 }], concentration: { top10_pct: 88, half_households: 1, segments: [] } },
      restricted: { key: 'restricted', label: 'Restricted & designated', hh_label: 'Giving households', fund_count: 4, given_ytd_cents: 900000, given_ytd_prior_cents: 800000, given_ytd_delta_pct: 8, budget_ytd_cents: null, budget_variance_cents: null, households: 40, households_prior: 38, avg_per_household_cents: 22500, projection_cents: 1200000, projection_method: 'linear', projection_vs_budget_cents: null, annual_budget_cents: null, has_budget: false, funds: [], monthly: { current: new Array(12).fill(0), prior: new Array(12).fill(0) }, method_mix: [{ key: 'check', label: 'Check', cents: 1, pct: 100 }, { key: 'ach', label: 'ACH / online', cents: 0, pct: 0 }, { key: 'cash', label: 'Cash / loose plate', cents: 0, pct: 0 }, { key: 'other', label: 'Stock, IRA, other', cents: 0, pct: 0 }], concentration: { top10_pct: 60, half_households: 4, segments: [] } },
      all: { key: 'all', label: 'All giving', hh_label: 'Giving households', fund_count: 9, given_ytd_cents: 26393100, given_ytd_prior_cents: 31918100, given_ytd_delta_pct: 8, budget_ytd_cents: null, budget_variance_cents: null, households: 200, households_prior: 205, avg_per_household_cents: 131965, projection_cents: 37000000, projection_method: 'seasonal', projection_vs_budget_cents: null, annual_budget_cents: null, has_budget: false, funds: [], monthly: { current: new Array(12).fill(0), prior: new Array(12).fill(0) }, method_mix: [{ key: 'check', label: 'Check', cents: 1, pct: 100 }, { key: 'ach', label: 'ACH / online', cents: 0, pct: 0 }, { key: 'cash', label: 'Cash / loose plate', cents: 0, pct: 0 }, { key: 'other', label: 'Stock, IRA, other', cents: 0, pct: 0 }], concentration: { top10_pct: 38, half_households: 25, segments: [] } },
    },
    funds: [], monthly: { current: new Array(12).fill(0), prior: new Array(12).fill(0) },
    method_mix: [], concentration: { top10_pct: 0, half_households: 0, segments: [] },
    kpis: {}, totals: {}, has_budget: false,
  };

  function withData() {
    const s = makeSandbox();
    s.sandbox._boardData = DATA;
    s.sandbox.boardBuildLensSelect(DATA);
    return s;
  }

  it('defaults to the General Fund — the council question, not an all-funds lump', () => {
    const s = withData();
    expect(s.sandbox._boardLens).toBe('general');
    expect(s.sandbox.boardLensBlock(DATA).label).toBe('General Fund');
  });

  it('rescopes the subtitle, KPIs and fund table when the lens changes', () => {
    const s = withData();
    s.sandbox.boardSetLens('passive');
    expect(s.el('board-subtitle').textContent).toContain('Passive income only');
    const html = s.el('board-body').innerHTML;
    expect(html).toContain('Passive income YTD');
    expect(html).toContain('$1,800');               // boardMoney, whole dollars
    expect(html).toContain('Funds inside Passive income');
    expect(html).not.toContain('General Fund YTD');
  });

  it('labels the households card for what the category actually counts', () => {
    const s = withData();
    s.sandbox.boardSetLens('earned');
    expect(s.el('board-body').innerHTML).toContain('Paying households');
    s.sandbox.boardSetLens('passive');
    expect(s.el('board-body').innerHTML).toContain('Income sources');
  });

  it('says "accounts", not "households", for passive income concentration', () => {
    const s = withData();
    s.sandbox.boardSetLens('passive');
    expect(s.el('board-body').innerHTML).toContain('ten largest accounts');
  });

  it('lists every OTHER category in the Everything else strip, and only those', () => {
    const s = withData();
    s.sandbox.boardSetLens('general');
    const strip = s.el('board-else-strip').innerHTML;
    expect(strip).toContain('Earned income');
    expect(strip).toContain('Passive income');
    expect(strip).toContain('All giving');
    expect(strip).not.toContain('>General Fund');
  });

  it('lists the categories as rows under the All giving lens, funds under a category lens', () => {
    const s = withData();
    s.sandbox.boardSetLens('all');
    expect(s.el('board-body').innerHTML).toContain('By category');
    s.sandbox.boardSetLens('general');
    expect(s.el('board-body').innerHTML).toContain('Funds inside General Fund');
  });

  it('scales the chart axis to a small category instead of flattening it against 100k', () => {
    const s = withData();
    // Passive peaks at $150/mo; on the old fixed 100k-minimum axis every bar would be 0-height.
    const svg = s.sandbox.boardMonthChart(DATA, DATA.categories.passive);
    const heights = [...svg.matchAll(/height="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
    expect(Math.max(...heights)).toBeGreaterThan(20);
  });

  it('keeps the lens when the mode changes', () => {
    const s = withData();
    s.sandbox.boardSetLens('restricted');
    s.sandbox.boardSetMode('narrative');
    expect(s.sandbox._boardLens).toBe('restricted');
    expect(s.el('board-body').innerHTML).toContain('restricted & designated');
    s.sandbox.boardSetMode('dashboard');
    // (this sandbox's esc() is a passthrough; the real one entity-encodes the ampersand)
    expect(s.el('board-body').innerHTML).toContain('Restricted & designated YTD');
  });

  it('writes the narrative about the lens, closing with the other categories', () => {
    const s = withData();
    s.sandbox.boardSetLens('general');
    s.sandbox.boardSetMode('narrative');
    const html = s.el('board-body').innerHTML;
    expect(html).toContain('to general fund');
    expect(html).toContain('Everything else');
    expect(html).toContain('earned income');
  });

  it('drops out of Analysis before printing, so the packet is never a blank sheet', () => {
    const s = withData();
    s.sandbox.boardSetMode('analysis');
    expect(s.el('board-body').style.display).toBe('none');
    s.sandbox.printBoardPage();
    expect(s.sandbox._boardMode).toBe('dashboard');
    expect(s.el('board-body').style.display).toBe('');
    expect(s.el('board-body').innerHTML).toContain('General Fund YTD');
  });

  it('points an empty category at Settings instead of showing a bare zero', () => {
    const s = withData();
    s.sandbox._boardData = { ...DATA, categories: { ...DATA.categories, passive: { ...DATA.categories.passive, fund_count: 0, given_ytd_cents: 0 } } };
    s.sandbox.boardSetLens('passive');
    expect(s.el('board-body').innerHTML).toContain('Fund categories');
  });
});

describe('batch deposit panel', () => {
  const BATCH = {
    id: 7, description: 'Sunday offering', batch_date: '2026-08-09', closed: 1,
    total_cents: 598800,
    entries: [{ id: 1, amount: 598800, fund_name: 'General Fund', method: 'check', person_name: 'A' }],
    deposit_status: { key: 'split', tone: 'warn', label: 'Split', linked_cents: 450000, remaining_cents: 148800 },
    deposits: [
      { deposit_id: 31, amount_cents: 300000, deposit_date: '2026-08-12', external_ref: 'D-2026-32', bank_cents: 299000, status: 'open', deposit_given_cents: 712000, other_batches: [{ deposit_id: 31, batch_id: 8, amount_cents: 412000, batch_date: '2026-08-11', description: 'Online (ACH batch)' }] },
      { deposit_id: 33, amount_cents: 150000, deposit_date: '2026-08-14', external_ref: 'D-2026-33', bank_cents: null, status: 'open', deposit_given_cents: 150000, other_batches: [] },
    ],
  };

  it('renders one card per linked deposit, with the reverse direction of each link', () => {
    const s = makeSandbox();
    s.sandbox._currentBatch = BATCH;
    s.sandbox.renderBatchDepositPanel(BATCH);
    const html = s.el('giv-dep-panel-mount').innerHTML;
    expect(html).toContain('D-2026-32');
    expect(html).toContain('D-2026-33');
    expect(html).toContain('Also in this deposit');
    expect(html).toContain('Online (ACH batch)');
    expect(html).toContain('This deposit holds only this batch.');
  });

  it('shows fees only for the deposit whose bank amount is known', () => {
    const s = makeSandbox();
    s.sandbox._currentBatch = BATCH;
    s.sandbox.renderBatchDepositPanel(BATCH);
    const html = s.el('giv-dep-panel-mount').innerHTML;
    expect(html).toContain('$4130.00');            // $7,120 given on that slip − $2,990 banked
    expect(html).toContain('Bank amount missing');
    expect(html).toContain('Reconciled');
  });

  it('draws a coverage segment per deposit and names the shortfall', () => {
    const s = makeSandbox();
    s.sandbox._currentBatch = BATCH;
    s.sandbox.renderBatchDepositPanel(BATCH);
    const html = s.el('giv-dep-panel-mount').innerHTML;
    expect([...html.matchAll(/giv-cover-seg/g)]).toHaveLength(2);
    expect(html).toContain('not yet deposited');
    expect(html).toContain('Assign the rest to a new deposit');
  });

  it('prefills a new link with what is still undeposited, not the whole batch', () => {
    const s = makeSandbox();
    s.sandbox._currentBatch = BATCH;
    expect(s.sandbox.givBatchRemainingCents()).toBe(148800);
  });

  it('drops the shortfall strip once the batch is fully covered', () => {
    const s = makeSandbox();
    const covered = { ...BATCH, deposit_status: { key: 'deposited', tone: 'ok', label: 'Deposited', linked_cents: 598800, remaining_cents: 0 } };
    s.sandbox._currentBatch = covered;
    s.sandbox.renderBatchDepositPanel(covered);
    expect(s.el('giv-dep-panel-mount').innerHTML).not.toContain('Assign the rest');
  });

  it('reads a lines-built deposit from given_cents, not the per-gift total', () => {
    // The Offerings workflow links whole batches and never sets giving_entries.deposit_id, so
    // gross_cents is 0 there — reading it showed "$0.00 given" and a fee of minus the bank
    // amount on the very screen a bookkeeper reconciles from.
    const s = makeSandbox();
    s.sandbox.depRenderList([{
      id: 5, deposit_date: '2026-08-10', source: 'check', status: 'open',
      gift_count: 0, gross_cents: 0, given_cents: 710000, batch_count: 1, bank_cents: 709000,
    }]);
    const html = s.el('giv-deposits-list').innerHTML;
    expect(html).toContain('$7100.00');
    expect(html).toContain('1 batch');
    expect(html).not.toContain('-$7090.00');
    expect(html).toContain('Fees $10.00');
  });

  it('parses amounts typed as plain numbers, with or without $ and commas', () => {
    const s = makeSandbox();
    expect(s.sandbox.givParseMoneyCents('7100')).toBe(710000);
    expect(s.sandbox.givParseMoneyCents('$7,100.00')).toBe(710000);
    expect(s.sandbox.givParseMoneyCents(' 1,488.50 ')).toBe(148850);
    expect(s.sandbox.givParseMoneyCents('')).toBe(null);
    expect(s.sandbox.givParseMoneyCents('abc')).toBe(null);
  });
});
