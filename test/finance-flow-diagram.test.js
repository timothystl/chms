import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_EXT_JS, CHMS_APP_CORE_JS } from '../src/html-chms.js';
import { computeFlowDiagram, classifyFlowExpense, FLOW_EXPENSE_KEYS } from '../src/api-finance.js';

// "How the money moves" — the four-column Sankey and its Share view (flow-diagram.md handoff).
//
// The layout is authored against one year's figures, where the nodes happen to be tall enough
// that the handoff's fixed gaps are sufficient. Real data is not that obliging, and the explicit
// ask on this work was that nothing overlap. So the bulk of this file is not "does it match the
// reference" (though the first block checks that too) — it is a geometric check that renders the
// REAL SVG across deliberately hostile data shapes, extracts every <text> element, and asserts no
// two of their boxes intersect. That is the property that matters; the coordinates are incidental.

function loadFlow() {
  const sandbox = { console, Math, Date, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat,
    document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(sandbox);
  // Take the flow block wholesale, from its first constant through the ribbon helper, rather than
  // extracting each declaration — the block is contiguous and this cannot silently miss one.
  const start = CHMS_APP_EXT_JS.indexOf('var FIN_FLOW_COLORS');
  const endMark = CHMS_APP_EXT_JS.indexOf('function finRenderSankey');
  const sankeyEnd = CHMS_APP_EXT_JS.indexOf('\nfunction finRenderFlowDonut');
  const donutEnd = CHMS_APP_EXT_JS.indexOf('\nvar _finFlowView');
  if (start < 0 || endMark < 0 || sankeyEnd < 0 || donutEnd < 0) throw new Error('flow block not found in built script');
  const helpers = ['esc', 'finFmtMoney', 'finFmtSigned', 'finMoney0'].map((f) => {
    const m = CHMS_APP_EXT_JS.match(new RegExp('\\nfunction ' + f + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))
      || CHMS_APP_CORE_JS.match(new RegExp('\\nfunction ' + f + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
    if (!m) throw new Error('missing helper ' + f);
    return m[0];
  }).join('\n');
  const src = helpers + '\n' + CHMS_APP_EXT_JS.slice(start, donutEnd);
  vm.runInContext(src + '\nglobalThis.__flow = { finFlowLayout, finRenderSankey, finFlowScale, finFlowTruncate, finRenderFlowDonut, FIN_FLOW_COLS };', sandbox);
  return sandbox.__flow;
}
const FLOW = loadFlow();

// The handoff's own FY2026 figures, in cents.
const REFERENCE = {
  sources: [
    { id: 'giving_unrestricted', label: 'Unrestricted giving', stream: 'donor', cents: 37200000 },
    { id: 'giving_restricted', label: 'Restricted giving', stream: 'donor', cents: 6300000 },
    { id: 'mdo_tuition', label: 'MDO tuition', stream: 'earned', cents: 60000000 },
    { id: 'facility_rentals', label: 'Facility rentals', stream: 'earned', cents: 1800000 },
    { id: 'fundraisers', label: 'Fundraisers', stream: 'earned', cents: 1200000 },
    { id: 'endowment', label: 'Endowment & investments', stream: 'passive', cents: 8000000 },
    { id: 'ivanhoe_dist', label: '3277 Ivanhoe distribution', stream: 'passive', cents: 2000000 },
  ],
  streams: [{ id: 'donor', cents: 43500000 }, { id: 'earned', cents: 63000000 }, { id: 'passive', cents: 10000000 }],
  expenses: [
    { id: 'mdo', label: 'MDO', note: 'staffing & operations', cents: 59100000 },
    { id: 'salaries', label: 'Salaries & Benefits', note: 'church staff', cents: 31800000 },
    { id: 'property', label: 'Property & Operations', note: '', cents: 13400000 },
    { id: 'education', label: 'Lutheran Education', note: '', cents: 7800000 },
    { id: 'programs', label: 'Programs', note: '', cents: 5000000 },
  ],
  totalRevenueCents: 116500000,
  totalExpenseCents: 117100000,
  netCents: -600000,
  unmappedExpenses: [],
};

// ── Text box extraction ─────────────────────────────────────────────────────────────────────
// Estimates each <text> element's box from its own attributes. Character width is deliberately
// OVER-estimated (0.62em, versus roughly 0.55em for DM Sans at these weights) so the test is
// stricter than the real rendering, not looser.
function textBoxes(svg) {
  const out = [];
  const re = /<text ([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1], inner = m[2];
    const num = (k) => { const a = attrs.match(new RegExp(k + '="([-\\d.]+)"')); return a ? Number(a[1]) : null; };
    const x = num('x'), y = num('y');
    const size = num('font-size') || 12;
    const anchor = /text-anchor="end"/.test(attrs) ? 'end' : /text-anchor="middle"/.test(attrs) ? 'middle' : 'start';
    // An HTML entity is one glyph, not five-to-seven characters — counting the raw source would
    // wildly over-state the width of anything containing "&" and turn a clean layout into a
    // phantom collision.
    const text = inner.replace(/<[^>]*>/g, '').replace(/&(#\d+|[a-zA-Z]+);/g, 'x');
    const w = text.length * size * 0.62;
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    // Baseline at y; ascender is roughly 0.78em above it, descender 0.22em below.
    out.push({ text, x0, x1: x0 + w, y0: y - size * 0.78, y1: y + size * 0.22 });
  }
  return out;
}
function overlaps(a, b) {
  return a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
}
function findCollisions(svg) {
  const boxes = textBoxes(svg);
  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) hits.push(boxes[i].text + '  ✕  ' + boxes[j].text);
    }
  }
  return hits;
}
function render(diagram) {
  const layout = FLOW.finFlowLayout(diagram);
  return { layout, svg: FLOW.finRenderSankey(diagram, layout) };
}

describe('Sankey — the handoff\'s reference geometry', () => {
  it('uses the authored scale of 0.40 px per $1,000 at the reference total', () => {
    expect(FLOW.finFlowScale(116500000)).toBe(0.4);
  });

  it('recomputes and clamps the scale once the total moves more than ~15%', () => {
    expect(FLOW.finFlowScale(116500000 * 1.1), 'inside the band, stays authored').toBe(0.4);
    const big = FLOW.finFlowScale(500000000); // $5M
    expect(big).toBeGreaterThanOrEqual(0.28);
    expect(big).toBeLessThanOrEqual(0.55);
    const small = FLOW.finFlowScale(10000000); // $100K
    expect(small).toBeLessThanOrEqual(0.55);
  });

  it('lays the reference columns out on the authored coordinates', () => {
    const { layout } = render(REFERENCE);
    expect(layout.sources[0].y).toBe(22);
    expect(layout.streams[0].y).toBe(44);
    expect(layout.total.y).toBe(60);
    expect(layout.expenses[0].y).toBe(30);
    // Unrestricted giving: $372,000 -> 372 * 0.40 = 148.8px
    expect(layout.sources[0].h).toBeCloseTo(148.8, 1);
    // The authored gap after it is 10, so the next node starts at 22 + 148.8 + 10.
    expect(layout.sources[1].y).toBeCloseTo(180.8, 1);
    // And the reference fits the authored canvas without needing to grow.
    expect(layout.canvasH).toBe(626);
  });

  it('scales the outflow ribbons so they exactly fill the revenue bar', () => {
    // Expenses ($1,171,000) exceed revenue ($1,165,000); drawing them at true scale on the left
    // edge would overrun the bar. The $6,000 belongs in the footer sentence, not in the geometry.
    const { layout, svg } = render(REFERENCE);
    const expenseSum = layout.expenses.reduce((s, n) => s + n.h, 0);
    expect(layout.total.h / expenseSum, 'the scale factor k').toBeCloseTo(0.99488, 4);

    // Assert the RENDERED paths, not just that k is computable: outflow ribbons leave x=620, and
    // their left edges must tile the total bar exactly — no gap at the top, no overrun at the
    // bottom. Checking k alone would pass even if the renderer ignored it.
    const spans = [...svg.matchAll(/M620,([\d.]+) C[^Z]*?620,([\d.]+) Z/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);
    expect(spans, 'one outflow ribbon per expense category').toHaveLength(REFERENCE.expenses.length);
    expect(spans[0][0], 'first ribbon starts at the top of the bar').toBeCloseTo(layout.total.y, 1);
    expect(spans[spans.length - 1][1], 'last ribbon ends at the bottom of the bar')
      .toBeCloseTo(layout.total.y + layout.total.h, 1);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][0], 'ribbons must stack contiguously, no gaps').toBeCloseTo(spans[i - 1][1], 1);
    }
    expect(svg).toContain('a $6,000 gap, before any one bad month');
  });

  it('states the delta in the footer with the sign it actually has', () => {
    expect(render(REFERENCE).svg).toContain('goes out against');
    const surplus = { ...REFERENCE, totalExpenseCents: 100000000, netCents: 16500000 };
    expect(render(surplus).svg).toContain('to the good');
  });
});

describe('Sankey — nothing overlaps, on any data', () => {
  it('the reference figures render with no colliding text', () => {
    expect(findCollisions(render(REFERENCE).svg)).toEqual([]);
  });

  // The shapes that break a fixed-gap layout: many tiny nodes whose labels are taller than the
  // nodes themselves, one node dwarfing everything, and totals far outside the authored band.
  const HOSTILE = {
    'twelve near-equal sources': { n: 12, mk: (i) => 800000 },
    'one giant plus eleven slivers': { n: 12, mk: (i) => (i === 0 ? 90000000 : 20000) },
    'ascending dust': { n: 14, mk: (i) => 5000 * (i + 1) },
    'two sources only': { n: 2, mk: () => 25000000 },
    'a single source': { n: 1, mk: () => 40000000 },
  };
  for (const [name, spec] of Object.entries(HOSTILE)) {
    for (const mult of [1, 0.05, 12]) {
      it(`${name}, at ${mult}x scale`, () => {
        const sources = Array.from({ length: spec.n }, (_, i) => ({
          id: 's' + i,
          label: ['Unrestricted giving', 'Restricted giving', 'MDO tuition', 'Facility rentals',
            'Fundraisers', 'Endowment & investments', '3277 Ivanhoe distribution',
            'A deliberately long account group name that would run into the next column'][i % 8],
          stream: ['donor', 'earned', 'passive'][i % 3],
          cents: Math.round(spec.mk(i) * mult),
        }));
        const streams = ['donor', 'earned', 'passive'].map((id) => ({
          id, cents: sources.filter((s) => s.stream === id).reduce((a, b) => a + b.cents, 0),
        })).filter((s) => s.cents > 0);
        const totalRevenueCents = sources.reduce((a, b) => a + b.cents, 0);
        const expenses = REFERENCE.expenses.map((e) => ({ ...e, cents: Math.round(e.cents * mult) }));
        const totalExpenseCents = expenses.reduce((a, b) => a + b.cents, 0);
        const diagram = { sources, streams, expenses, totalRevenueCents, totalExpenseCents,
          netCents: totalRevenueCents - totalExpenseCents, unmappedExpenses: [] };
        const { layout, svg } = render(diagram);

        expect(findCollisions(svg), 'colliding label text').toEqual([]);

        // Bars must not overlap either, and every label must sit above the footer rule.
        for (const col of [layout.sources, layout.streams, layout.expenses]) {
          for (let i = 1; i < col.length; i++) {
            expect(col[i].y, 'bars overlap').toBeGreaterThanOrEqual(col[i - 1].y + col[i - 1].h - 0.01);
          }
          for (const n of col) expect(n.labelBottom, 'label runs past the footer rule').toBeLessThanOrEqual(layout.footerRuleY);
        }
      });
    }
  }

  it('keeps every label inside its own column, so no column can bleed into the next', () => {
    // A long name is truncated rather than allowed to run right; this is what stops a source
    // label reaching the streams bar, and an expense label reaching the total's label.
    const diagram = {
      ...REFERENCE,
      sources: REFERENCE.sources.map((s) => ({ ...s, label: 'An extremely long revenue account group name that must be cut' })),
      expenses: REFERENCE.expenses.map((e) => ({ ...e, label: 'An extremely long board expense category name that must be cut' })),
    };
    const { svg } = render(diagram);
    const C = FLOW.FIN_FLOW_COLS;
    for (const b of textBoxes(svg)) {
      if (b.x0 >= C.sources.labelX - 1 && b.x0 < C.streams.labelX - 1) {
        expect(b.x1, 'a source label reached the streams column: ' + b.text).toBeLessThanOrEqual(C.streams.barX);
      }
    }
    // No text may straddle the middle gap between the total's label and the expense labels.
    const totalRight = C.total.labelX + C.total.maxLabelW;
    const expenseLeft = C.expenses.labelX - C.expenses.maxLabelW;
    expect(totalRight, 'total and expense label zones must not be able to meet').toBeLessThan(expenseLeft);
  });

  it('grows the canvas rather than letting a column run off it', () => {
    // 30 sources at the clamped minimum scale cannot fit 626 units; the canvas must grow.
    const sources = Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, label: 'Group ' + i, stream: ['donor', 'earned', 'passive'][i % 3], cents: 3000000 }));
    const totalRevenueCents = sources.reduce((a, b) => a + b.cents, 0);
    const diagram = { ...REFERENCE, sources, totalRevenueCents,
      streams: ['donor', 'earned', 'passive'].map((id) => ({ id, cents: sources.filter((s) => s.stream === id).reduce((a, b) => a + b.cents, 0) })) };
    const { layout, svg } = render(diagram);
    expect(layout.canvasH).toBeGreaterThan(626);
    expect(svg).toContain('viewBox="0 0 1080 ' + layout.canvasH + '"');
    expect(findCollisions(svg)).toEqual([]);
  });

  it('demotes a label to one line when its node is too short for two', () => {
    const { layout } = render(REFERENCE);
    const tiny = layout.sources.find((n) => n.ref.label === 'Fundraisers'); // $12,000 -> 4.8px
    expect(tiny.labelMode).toBe('one');
    const big = layout.sources.find((n) => n.ref.label === 'Unrestricted giving');
    expect(big.labelMode).toBe('two');
  });
});

describe('Sankey — accessibility', () => {
  it('names the largest flows in the aria-label, from the data', () => {
    const label = render(REFERENCE).svg.match(/aria-label="([^"]+)"/)[1];
    expect(label).toContain('MDO tuition');   // largest source
    expect(label).toContain('MDO');           // largest expense
    expect(label).toContain('$1,165,000');
    expect(label, 'must not be a hard-coded string').toContain('$1,171,000');
  });

  it('carries data-om-raster for a PowerPoint export', () => {
    expect(render(REFERENCE).svg).toContain('data-om-raster');
  });
});

describe('Share view — donuts', () => {
  it('lays segments end to end around the circumference', () => {
    const html = FLOW.finRenderFlowDonut('Money in', [
      { label: 'Donor revenue', cents: 43500000, color: '#2E7EA6' },
      { label: 'Earned income', cents: 63000000, color: '#C9973A' },
      { label: 'Passive income', cents: 10000000, color: '#6B8F71' },
    ], 116500000, 'TOTAL REVENUE');
    const lens = [...html.matchAll(/stroke-dasharray="([\d.]+) /g)].map((m) => Number(m[1]));
    expect(lens.reduce((a, b) => a + b, 0), 'segments must close the circle').toBeCloseTo(414.69, 1);
    const offsets = [...html.matchAll(/stroke-dashoffset="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(offsets[0]).toBe(0);
    expect(-offsets[1]).toBeCloseTo(lens[0], 2);
    expect(-offsets[2]).toBeCloseTo(lens[0] + lens[1], 2);
  });

  it('abbreviates the centre total and shows a percent per row', () => {
    const html = FLOW.finRenderFlowDonut('Money in', [{ label: 'Donor revenue', cents: 43500000, color: '#2E7EA6' }], 116500000, 'TOTAL REVENUE');
    expect(html).toContain('$1.165M');
    expect(html).toContain('37%');
  });
});

describe('computeFlowDiagram', () => {
  const row = (o) => ({ classification: 'Income', category_path: '', account_name: '',
    own_actual_cents: 0, own_budget_cents: null, ...o });
  const entries = [
    row({ category_path: 'Income:40 Offerings', own_actual_cents: 43500000 }),
    row({ category_path: 'Income:57 MDO Tuition', own_actual_cents: 60000000 }),
    row({ classification: 'Other Income', category_path: 'Other Income:42 Passive Income', own_actual_cents: 10000000 }),
    row({ classification: 'Expenses', category_path: 'Expenses:58 Salaries & Benefits', own_actual_cents: 31800000 }),
    row({ classification: 'Expenses', category_path: 'Expenses:57 MDO Expenses', own_actual_cents: 59100000 }),
    row({ classification: 'Expenses', category_path: 'Expenses:60 Property & Utilities', own_actual_cents: 13400000 }),
  ];

  it('runs restricted giving into the donor node, counted once', () => {
    // Restricted income is a half of donor income, not a peer of earned and passive: it is a
    // gift, and unlike a 25xxx designated fund it does pay budgeted expenses — just ones the
    // donor named. So it keeps its OWN source node (the diagram still shows it arriving
    // separately) while its ribbon runs into the donor stream, matching the handoff's own
    // reference, whose middle column has three nodes and carries "Restricted giving" as a
    // donor-stream source.
    //
    // ⚠ What must never come back: carving a restricted slice back out of the donor node ON TOP
    // of this, which would draw the same dollars twice and inflate total revenue. The last
    // assertion is the one that catches it.
    const withRestricted = entries.concat([
      row({ category_path: 'Income:Altar Guild:Flowers', own_actual_cents: 200000 }),
    ]);
    const d = computeFlowDiagram(withRestricted, {});
    const donorSources = d.sources.filter((s) => s.stream === 'donor');
    expect(donorSources).toHaveLength(2);
    expect(donorSources.find((s) => /altar guild/i.test(s.label)).cents).toBe(200000);
    expect(d.sources.some((s) => s.stream === 'restricted'), 'no fourth stream').toBe(false);
    expect(d.streams.map((s) => s.id)).toEqual(['donor', 'earned', 'passive']);
    // The donor node is exactly as tall as the ribbons feeding it.
    expect(d.streams.find((s) => s.id === 'donor').cents).toBe(43500000 + 200000);
    expect(d.totalRevenueCents, 'restricted counted once, not twice')
      .toBe(43500000 + 60000000 + 10000000 + 200000);
  });

  it('always totals: sources sum to revenue, categories to expenses', () => {
    const d = computeFlowDiagram(entries, {});
    expect(d.sources.reduce((a, b) => a + b.cents, 0)).toBe(d.totalRevenueCents);
    expect(d.expenses.reduce((a, b) => a + b.cents, 0)).toBe(d.totalExpenseCents);
    expect(d.netCents).toBe(d.totalRevenueCents - d.totalExpenseCents);
  });

  it('reports the expense groups it had to guess at', () => {
    const d = computeFlowDiagram(entries, {});
    expect(d.unmappedExpenses.map((u) => u.label)).toContain('58 Salaries & Benefits');
    expect(d.unmappedExpenses.every((u) => FLOW_EXPENSE_KEYS.includes(u.defaultedTo))).toBe(true);
  });

  it('moves an account when an admin remaps it, and stops calling it a guess', () => {
    const d = computeFlowDiagram(entries, { expenseOverrides: { '60 Property & Utilities ': 'education' } });
    // The override key is the group label plus the account name, as classifyFlowExpense is called.
    const edu = d.expenses.find((e) => e.id === 'education');
    expect(edu && edu.cents).toBe(13400000);
    expect(d.unmappedExpenses.map((u) => u.label)).not.toContain('60 Property & Utilities');
  });
});

describe('classifyFlowExpense', () => {
  it('reads the obvious names', () => {
    expect(classifyFlowExpense('57 MDO Expenses').key).toBe('mdo');
    expect(classifyFlowExpense('58 Salaries & Benefits').key).toBe('salaries');
    expect(classifyFlowExpense('62 Utilities').key).toBe('property');
    expect(classifyFlowExpense('64 Lutheran Education').key).toBe('education');
    expect(classifyFlowExpense('66 Youth Program').key).toBe('programs');
  });

  it('puts an unrecognised account somewhere visible rather than dropping it', () => {
    // Every expense account has to land in exactly one category or the outflow stops matching
    // total expenses — a silently-dropped account is worse than a visibly-miscategorised one.
    const r = classifyFlowExpense('93 Sundry');
    expect(FLOW_EXPENSE_KEYS).toContain(r.key);
    expect(r.mapped).toBe(false);
  });

  it('ignores an override naming a category that does not exist', () => {
    expect(classifyFlowExpense('62 Utilities', { '62 Utilities': 'nonsense' }).key).toBe('property');
  });
});
