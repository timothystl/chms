import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import {
  fetchGivingPlateauRows, computeGivingPlateaus, classifyGivingCadence, cadenceAmountCents,
  plateauWeeksElapsed, LETTER_TYPES, GIVING_CADENCES,
} from '../src/api-utils.js';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Cover for the Giving Nudges workspace (Giving -> Communications -> Giving nudges), which turns
// the Plateaus & Nudges analysis into sendable mail.
//
// The thing most worth protecting here is that a recipient's figures are stated in the rhythm they
// actually give in. The analysis normalizes everyone to a weekly-equivalent figure so a weekly
// regular and a single annual gift are comparable — correct for the analysis, and wrong for the
// letter. Someone who gives exactly $200 a month is $46.15/wk; going out through the rounded
// weekly figure brings them back as "$199 a month", which reads as though nobody looked at their
// record. Several assertions below pin that specific arithmetic.

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const st = raw.prepare(sql);
      let binds = [];
      const api = {
        bind(...a) { binds = a; return api; },
        all() { return Promise.resolve({ results: st.all(...binds) }); },
        first() { return Promise.resolve(st.get(...binds) ?? null); },
        run() { st.run(...binds); return Promise.resolve({}); },
      };
      return api;
    },
  };
  raw.exec(`
    CREATE TABLE households(id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE people(id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
      household_id INTEGER, family_role TEXT, member_type TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE giving_batches(id INTEGER PRIMARY KEY, batch_date TEXT);
    CREATE TABLE giving_entries(id INTEGER PRIMARY KEY, person_id INTEGER, batch_id INTEGER,
      amount INTEGER, fund_id INTEGER, method TEXT, contribution_date TEXT);
    INSERT INTO households VALUES (1,'Alder Household'),(2,'Brook Household');
    INSERT INTO people VALUES
     (1,'Ann','Alder','ann@example.org',1,'head','member',1),
     (2,'Al','Alder','',1,'spouse','member',1),
     (3,'Bea','Brook','bea@example.org',2,'head','member',1),
     (4,'Cal','Cole','cal@example.org',NULL,NULL,'member',1),
     (5,'Schwab','Brokerage','',NULL,NULL,'organization',1);
    INSERT INTO giving_batches VALUES (1,'2024-06-01');
  `);
  let id = 1;
  const add = (pid, cents, date, method) =>
    raw.prepare('INSERT INTO giving_entries VALUES (?,?,1,?,1,?,?)').run(id++, pid, cents, method || 'check', date);
  // Alder: 48 weekly $25 gifts split across the two spouses.
  for (let w = 0; w < 48; w++) add(w % 2 ? 1 : 2, 2500, '2024-' + String(1 + (w % 12)).padStart(2, '0') + '-05');
  // Brook: 12 monthly $200 gifts, all by an automatic method.
  for (let m = 1; m <= 12; m++) add(3, 20000, '2024-' + String(m).padStart(2, '0') + '-10', 'ach');
  // Cole: one $2,600 gift, no household.
  add(4, 260000, '2024-12-20');
  // An organization record — a brokerage a stock gift was filed under.
  add(5, 500000, '2024-03-01');
  return db;
}

async function analyze(scope = 'household') {
  const db = makeDb();
  const rows = await fetchGivingPlateauRows(db, { year: 2024, scope, fundId: 0 });
  const res = computeGivingPlateaus(rows, { periodsElapsed: 52, impactStatements: [], lowFrequencyMax: 3 });
  const by = {};
  for (const g of res.givers) by[g.name] = g;
  return { res, by };
}

describe('classifyGivingCadence', () => {
  it('reads the rhythm from gifts per YEAR, not raw count', () => {
    // Six gifts halfway through a year is a monthly giver; six across a whole year is quarterly.
    // Judging on raw count would call a mid-year monthly giver "quarterly" and write them the
    // wrong letter.
    expect(classifyGivingCadence(6, 26).key).toBe('monthly');
    expect(classifyGivingCadence(6, 52).key).toBe('quarterly');
  });

  it('classifies each real rhythm', () => {
    expect(classifyGivingCadence(50, 52).key).toBe('weekly');
    expect(classifyGivingCadence(12, 52).key).toBe('monthly');
    expect(classifyGivingCadence(4, 52).key).toBe('quarterly');
    expect(classifyGivingCadence(2, 52).key).toBe('occasional');
    expect(classifyGivingCadence(1, 52).key).toBe('annual');
  });

  it('never returns undefined, whatever it is handed', () => {
    for (const args of [[0, 52], [null, null], [undefined, 0], [-5, 999], ['x', 'y']]) {
      const c = classifyGivingCadence(args[0], args[1]);
      expect(GIVING_CADENCES.some(x => x.key === c.key)).toBe(true);
    }
  });
});

describe('cadenceAmountCents', () => {
  it('restates an annual figure in a rhythm, rounded to whole dollars in THAT rhythm', () => {
    expect(cadenceAmountCents(240000, 12)).toBe(20000); // $2,400/yr -> $200 a month
    expect(cadenceAmountCents(240000, 52)).toBe(4600);  // -> $46 a week
    expect(cadenceAmountCents(240000, 1)).toBe(240000); // -> $2,400 a year
  });

  it('clamps a zero or missing period count instead of dividing by zero', () => {
    expect(cadenceAmountCents(240000, 0)).toBe(240000);
    expect(cadenceAmountCents(240000, null)).toBe(240000);
  });
});

describe('a giver is shown the figure they would recognize', () => {
  it('tells a $200-a-month giver they give $200 a month, not $199', () => {
    // The bug this pins: $2,400/yr is $46.15/wk, which rounds to $46/wk, which comes back out as
    // $199.33 -> $199 a month if the cadence figure is derived from the rounded weekly one.
    return analyze().then(({ by }) => {
      const bea = by['Brook Household'];
      expect(bea.cadence).toBe('monthly');
      expect(bea.cadence_amount_cents).toBe(20000);
      // ...and the weekly-equivalent the analysis works in is genuinely a different number, so
      // this is not passing by coincidence.
      expect(bea.weekly_cents).toBe(4600);
    });
  });

  it('gives every figure in one letter a shared arithmetic, so none can contradict another', () => {
    return analyze().then(({ res }) => {
      for (const g of res.givers) {
        for (const o of g.options) {
          expect(o.cadence_target_cents - g.cadence_amount_cents).toBe(o.cadence_delta_cents);
          expect(o.cadence_delta_cents * g.cadence_periods_per_year).toBe(o.cadence_annual_delta_cents);
        }
      }
    });
  });

  it('carries a rhythm and its wording for every giver', () => {
    return analyze().then(({ by }) => {
      expect(by['Alder Household'].cadence_adverb).toBe('a week');
      expect(by['Brook Household'].cadence_adverb).toBe('a month');
      expect(by['Cal Cole'].cadence_adverb).toBe('a year');
    });
  });

  it('annualises a part-year figure rather than reporting it as a full year', () => {
    const rows = [{ person_id: 1, name: 'Half Year', link_id: 1, link_kind: 'person', total_cents: 120000, gifts: 6 }];
    const res = computeGivingPlateaus(rows, { periodsElapsed: 26 });
    // $1,200 over half a year is a $200-a-month giver, not a $100-a-month one.
    expect(res.givers[0].cadence).toBe('monthly');
    expect(res.givers[0].cadence_amount_cents).toBe(20000);
  });
});

describe('who the nudge list addresses', () => {
  it('combines spouses into one household so a couple gets one letter', () => {
    return analyze().then(({ by }) => {
      expect(by['Alder Household'].total_cents).toBe(48 * 2500);
    });
  });

  it('splits them again in person scope', async () => {
    const { res } = await analyze('person');
    expect(res.givers.length).toBe(4);
  });

  it('never writes to an organization record', async () => {
    const { res } = await analyze();
    expect(res.givers.map(g => g.name)).not.toContain('Schwab Brokerage');
    expect(res.givers.length).toBe(3);
  });

  it('exposes the flat giver list the letters are addressed from', () => {
    // computeGivingPlateaus originally returned only tiers/distribution/summary; the workspace
    // reads one row per giver, and without this it silently rendered an empty recipient list.
    return analyze().then(({ res }) => {
      expect(Array.isArray(res.givers)).toBe(true);
      expect(res.givers.length).toBeGreaterThan(0);
      expect(res.givers[0]).toHaveProperty('link_kind');
      expect(res.givers[0]).toHaveProperty('cadence_amount_cents');
    });
  });

  it('flags an occasional giver who has never used an automatic method', () => {
    return analyze().then(({ by }) => {
      expect(by['Cal Cole'].low_frequency).toBe(true);
      expect(by['Cal Cole'].all_manual_methods).toBe(true);
      // Brook gives monthly by ACH — neither flag applies.
      expect(by['Brook Household'].low_frequency).toBe(false);
      expect(by['Brook Household'].all_manual_methods).toBe(false);
    });
  });
});

describe('the shared giver query', () => {
  it('is the same one the Plateaus report runs, so the two lists cannot diverge', async () => {
    // The report and the letters both call fetchGivingPlateauRows. Two copies of this query
    // drifting apart would mean writing to a different set of people than the one reviewed.
    const fs = await import('node:fs');
    const reports = fs.readFileSync('src/api-reports.js', 'utf8');
    const giving = fs.readFileSync('src/api-giving.js', 'utf8');
    expect(reports).toContain('fetchGivingPlateauRows');
    expect(giving).toContain('fetchGivingPlateauRows');
    // ...and neither has kept a private copy of the household GROUP BY. Scoped to the plateaus
    // handler: reports/giving-bands legitimately has its own household query with a different
    // periods-elapsed convention, and is not what the nudge letters are built from.
    const plateauHandler = reports.slice(
      reports.indexOf("if (seg === 'reports/giving-plateaus'"),
      reports.indexOf("if (seg === 'reports/giving-bands'"),
    );
    expect(plateauHandler.length).toBeGreaterThan(200);
    expect(plateauHandler).not.toContain("'h:' || p.household_id");
    expect(giving).not.toContain("'h:' || p.household_id");
  });

  it('counts elapsed weeks for an in-progress year and a full 52 for a finished one', () => {
    expect(plateauWeeksElapsed(2024, new Date('2026-08-06T00:00:00Z'))).toBe(52);
    expect(plateauWeeksElapsed(2026, new Date('2026-01-08T00:00:00Z'))).toBe(2);
    expect(plateauWeeksElapsed(2026, new Date('2026-12-31T00:00:00Z'))).toBe(52);
  });
});

describe('nudge sends are recorded like any other letter', () => {
  it('is a real letter type, so giving/letters/mark accepts it', () => {
    expect(LETTER_TYPES.nudge).toBeTruthy();
    expect(LETTER_TYPES.nudge.label).toBe('Giving Nudge');
  });

  it('stays out of the generic letters workspace, which cannot resolve its recipients', () => {
    expect(LETTER_TYPES.nudge.defaultScope).toBe('none');
  });
});

// ── The workspace itself, rendered out of the real built bundle ──────────────
function makeCtx() {
  const store = {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    options: { length: 1 },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  });
  const document = {
    getElementById(id) { return store[id] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx.__store = store;
  ctx.__el = el;
  return ctx;
}

const RECIPIENT = {
  recipient_key: 'h2', kind: 'household', id: 2, name: 'Brook Household',
  email: 'bea@example.org', has_email: true, recipient_name: 'Bea Brook', recipient_person_id: 3,
  sent: false, gifts: 12, total_cents: 240000, weekly_cents: 4600,
  cadence: 'monthly', cadence_label: 'Monthly', cadence_adverb: 'a month', cadence_amount_cents: 20000,
  low_frequency: false, all_manual_methods: false,
  option: { label: 'Standard', target_cents: 6000, cadence_target_cents: 26000,
            cadence_delta_cents: 6000, cadence_annual_delta_cents: 72000,
            annual_delta_cents: 72800, impact_text: '' },
};

describe('the nudge letter', () => {
  it('states the giver\'s own rhythm, never the weekly-equivalent', () => {
    const ctx = makeCtx();
    ctx._churchConfig = { church_name: 'Timothy Lutheran Church' };
    const html = ctx.givNudgesLetterHtml(RECIPIENT, 'Timothy Lutheran Church');
    expect(html).toContain('$200 a month');
    expect(html).toContain('$260 a month');
    expect(html).not.toContain('a week');
    expect(html).not.toContain('$46');
  });

  it('quotes an annual figure that reconciles with the per-period one it just gave', () => {
    const ctx = makeCtx();
    ctx._churchConfig = { church_name: 'Timothy Lutheran Church' };
    const html = ctx.givNudgesLetterHtml(RECIPIENT, 'Timothy Lutheran Church');
    // +$60 a month is $720 a year. The analysis-side figure ($728, derived from the rounded
    // weekly delta) must not be the one the reader sees next to "$60 a month".
    expect(html).toContain('$720');
    expect(html).not.toContain('$728');
  });

  it('links to online giving only when a URL is actually configured', () => {
    // _churchConfig.giving_url is a key that has never existed — the real one is
    // online_giving_url, and reading the wrong one silently drops the link (see G30).
    const ctx = makeCtx();
    ctx._churchConfig = { church_name: 'TLC', online_giving_url: 'https://give.example.org' };
    expect(ctx.givNudgesLetterHtml(RECIPIENT, 'TLC')).toContain('https://give.example.org');
    const bare = makeCtx();
    bare._churchConfig = { church_name: 'TLC' };
    expect(bare.givNudgesLetterHtml(RECIPIENT, 'TLC')).not.toContain('href="http');
  });

  it('frames the ask as an invitation, not an expectation', () => {
    const ctx = makeCtx();
    ctx._churchConfig = { church_name: 'TLC' };
    const html = ctx.givNudgesLetterHtml(RECIPIENT, 'TLC');
    expect(html).toContain('invitation and never an expectation');
  });

  it('escapes a name rather than interpolating it raw', () => {
    const ctx = makeCtx();
    ctx._churchConfig = { church_name: 'TLC' };
    const evil = Object.assign({}, RECIPIENT, { name: '<script>alert(1)</script>' });
    const html = ctx.givNudgesLetterHtml(evil, 'TLC');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the nudges pane', () => {
  it('renders a recipient row without throwing, and shows the cadence figures', () => {
    const ctx = makeCtx();
    ctx.__store['giv-nudges-root'] = ctx.__el();
    ctx.__store['giv-nudge-body'] = ctx.__el();
    ctx.__store['giv-nudge-totals'] = ctx.__el();
    ctx._givNudgesState = Object.assign({}, ctx._givNudgesState, {
      year: 2024, recipients: [RECIPIENT], selected: { 0: true },
      counts: { total: 1, sent: 0, unsent: 1, no_email: 0 },
    });
    ctx.givNudgesRenderRecipients();
    const html = ctx.__store['giv-nudge-body'].innerHTML;
    expect(html).toContain('Brook Household');
    expect(html).toContain('Monthly');
    expect(html).toContain('$200');
    expect(html).toContain('$260');
    expect(html).toContain('Preview');
  });

  it('offers Print rather than Email when the print channel is chosen', () => {
    const ctx = makeCtx();
    ctx.__store['giv-nudge-body'] = ctx.__el();
    ctx.__store['giv-nudge-totals'] = ctx.__el();
    const base = { year: 2024, recipients: [RECIPIENT], selected: { 0: true }, counts: { total: 1, sent: 0, unsent: 1, no_email: 0 } };
    ctx._givNudgesState = Object.assign({}, ctx._givNudgesState, base, { channel: 'email' });
    ctx.givNudgesRenderRecipients();
    expect(ctx.__store['giv-nudge-body'].innerHTML).toContain('Email selected');
    ctx._givNudgesState = Object.assign({}, ctx._givNudgesState, base, { channel: 'print' });
    ctx.givNudgesRenderRecipients();
    expect(ctx.__store['giv-nudge-body'].innerHTML).toContain('Print selected');
  });

  it('cannot select an emailable-channel recipient who has no email', () => {
    const ctx = makeCtx();
    ctx.__store['giv-nudge-body'] = ctx.__el();
    ctx.__store['giv-nudge-totals'] = ctx.__el();
    const noEmail = Object.assign({}, RECIPIENT, { has_email: false, email: '' });
    ctx._givNudgesState = Object.assign({}, ctx._givNudgesState, {
      year: 2024, channel: 'email', recipients: [noEmail], selected: {},
      counts: { total: 1, sent: 0, unsent: 1, no_email: 1 },
    });
    ctx.givNudgesSelectAll('all');
    expect(ctx.givNudgesSelected().length).toBe(0);
    expect(ctx.__store['giv-nudge-body'].innerHTML).toContain('no email on file');
  });

  it('is reachable as its own Communications pane and by deep link', () => {
    const ctx = makeCtx();
    expect(ctx._GIV_COMMS_PANES).toContain('nudges');
    expect(ctx._GIV_VIEW_ALIASES.nudges).toBe('comms');
    expect(ctx._GIV_ALIAS_PANE.nudges).toBe('nudges');
  });
});
