import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_EXT_JS, CHMS_APP_CORE_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
// P25-E: finance-only functions moved out of the ext bundle into their own lazily-loaded
// bundle (see html-chms.js). This file only extracts source by regex/string search, so the
// two are simply concatenated back together for that purpose.
const CHMS_APP_EXT_JS_ALL = CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS;
import { computeDesignatedFunds, designatedFundCode } from '../src/api-finance.js';

// Designated funds (25xxx) and the donor card that used to contradict itself.
//
// The live report this file exists for: the Health page printed
//
//   DONOR REVENUE  $239,876
//     Unrestricted   $247,060.56
//     Restricted      $80,308.17
//
// — parts visibly larger than the whole. The headline was the LEDGER's donor income stream; the
// two bars were ChMS giving split on funds.category, unfiltered, so they summed to every gift
// recorded that year including all the 25xxx designated funds. Those funds are balance-sheet
// liabilities and never appear as income at all, which is why no amount of arithmetic could have
// reconciled the card as built. The tests below pin both halves of the fix: designated money is
// separated by account number, and the donor card is built from one source so its parts sum to
// its own headline by construction.

function loadFinance() {
  const sandbox = {
    console, Math, Date, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat,
    document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} },
  };
  vm.createContext(sandbox);
  const grab = (name, kind) => {
    const re = new RegExp('\\n' + kind + ' ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
    const m = CHMS_APP_EXT_JS_ALL.match(re) || CHMS_APP_CORE_JS.match(re);
    if (!m) throw new Error('missing ' + name + ' in built script');
    return m[0];
  };
  const src = ['esc', 'finFmtMoney', 'finMoney0', 'finBar', 'finPctLabel']
    .map((f) => grab(f, 'function')).join('\n')
    + '\nvar REVENUE_STREAM_KEYS = ["donor","earned","passive","restricted"];'
    + '\nvar FIN_DISPLAY_STREAM_KEYS = ["donor","earned","passive"];'
    + grab('finDisplayStreams', 'function')
    + '\nfunction finNavGo() {}\nfunction showTab() {}'
    + '\nvar REVENUE_STREAM_SHORT = { donor: "Donor", earned: "Earned", passive: "Passive", restricted: "Restricted" };'
    + '\nvar REVENUE_STREAM_COLORS = { donor: "a", earned: "b", passive: "c", restricted: "d" };'
    + grab('finRenderStreamCards', 'function')
    + grab('finRenderRevenueMix', 'function')
    + grab('finRenderDesignatedFunds', 'function');
  vm.runInContext(src + '\nglobalThis.__fin = { finRenderStreamCards, finRenderDesignatedFunds, finRenderRevenueMix, finDisplayStreams };', sandbox);
  return sandbox.__fin;
}
const FIN = loadFinance();

// Shaped like the real church: one unrestricted offering line, restricted income lines that do
// fund the budget (Comfort Dog, Tuition Aid), and 25xxx funds that never can.
const GIVING_BY_FUND = [
  { fundName: '40085 General Fund', cents: 23987577 },
  { fundName: '40085 Christmas Offering', cents: 400000 },
  { fundName: '49094 Tuition Aid', cents: 500000 },
  { fundName: '25010 Concordia Children’s Services', cents: 3975882 },
  { fundName: '25033 PNG Mission Society', cents: 1200000 },
  { fundName: '25004 Building Fund', cents: 2500000 },
  { fundName: '25008 Christ Care', cents: 300000 },
];
const BALANCE_ROWS = [
  { account_name: '25000 Funds', own_balance_cents: 0, has_children: 1, as_of_date: 'As of Jun 30, 2026' },
  // A designated fund that itself has sub-accounts, carrying a rollup balance over them. The
  // 25000 header alone cannot test the has_children guard, since it is already excluded by code;
  // this row is the one that proves a nested rollup is not double-counted with its children.
  { account_name: '25019 Memorial', own_balance_cents: 400000, has_children: 1, as_of_date: 'As of Jun 30, 2026' },
  { account_name: '25019a Memorial — Music', own_balance_cents: 400000, has_children: 0, as_of_date: 'As of Jun 30, 2026' },
  { account_name: '25004 Building Fund', own_balance_cents: 6850000, has_children: 0, as_of_date: 'As of Jun 30, 2026' },
  { account_name: '25008 Christ Care', own_balance_cents: 5000, has_children: 0, as_of_date: 'As of Jun 30, 2026' },
  { account_name: '25016 Food Pantry', own_balance_cents: 581454, has_children: 0, as_of_date: 'As of Jun 30, 2026' },
  { account_name: '11027 Lindell Checking', own_balance_cents: 12000000, has_children: 0, as_of_date: 'As of Jun 30, 2026' },
];

describe('designatedFundCode', () => {
  it('matches the 25xxx family', () => {
    expect(designatedFundCode('25004 Building Fund')).toBe('25004');
    expect(designatedFundCode('25033 PNG Mission Society')).toBe('25033');
    expect(designatedFundCode('25010 Concordia Children’s Services')).toBe('25010');
  });

  it('accepts the lettered codes the equity list carries', () => {
    // 25019a / 25023x / 25031a are real codes in EQUITY_RECLASS_ACCOUNTS; a digits-only rule
    // would silently treat them as operating revenue.
    expect(designatedFundCode('25019a Memorial')).toBe('25019a');
    expect(designatedFundCode('25031A Mission')).toBe('25031a');
  });

  it('leaves budget-funding lines alone', () => {
    // The distinction the whole feature rests on: Comfort Dog and Tuition Aid are donor-directed
    // but DO fund the budget, and they are not numbered 25xxx.
    expect(designatedFundCode('49094 Tuition Aid')).toBeNull();
    expect(designatedFundCode('40085 General Fund')).toBeNull();
    expect(designatedFundCode('47020 MDO Tuition')).toBeNull();
    expect(designatedFundCode('Comfort Dog')).toBeNull();
  });

  it('never counts the 25000 group header as a fund', () => {
    // It is a rollup over every fund beneath it; counting it would double the whole block.
    expect(designatedFundCode('25000 Funds')).toBeNull();
  });

  it('does not match a code that merely contains 25', () => {
    expect(designatedFundCode('12500 Something')).toBeNull();
    expect(designatedFundCode('52500 Insurance')).toBeNull();
  });
});

describe('computeDesignatedFunds', () => {
  const d = computeDesignatedFunds(GIVING_BY_FUND, BALANCE_ROWS);

  it('splits giving into what funds the budget and what does not', () => {
    expect(d.designatedGivenCents).toBe(3975882 + 1200000 + 2500000 + 300000);
    expect(d.operatingGivenCents).toBe(23987577 + 400000 + 500000);
  });

  it('the two halves always sum back to total recorded giving', () => {
    const total = GIVING_BY_FUND.reduce((s, g) => s + g.cents, 0);
    expect(d.designatedGivenCents + d.operatingGivenCents).toBe(total);
  });

  it('keeps restricted-but-operational giving on the budget side', () => {
    // Tuition Aid is the case that motivated the account-number rule over funds.category.
    expect(d.funds.map((f) => f.code)).not.toContain('49094');
  });

  it('pairs each fund with its balance-sheet balance', () => {
    const building = d.funds.find((f) => f.code === '25004');
    expect(building.givenCents).toBe(2500000);
    expect(building.balanceCents).toBe(6850000);
  });

  it('keeps a fund with a balance but no giving this year', () => {
    const pantry = d.funds.find((f) => f.code === '25016');
    expect(pantry.givenCents).toBe(0);
    expect(pantry.balanceCents).toBe(581454);
  });

  it('keeps a fund given to with no balance row', () => {
    const png = d.funds.find((f) => f.code === '25033');
    expect(png.givenCents).toBe(1200000);
    expect(png.balanceCents).toBeNull();
  });

  it('excludes non-designated accounts from the balance total', () => {
    // The operating checking account is on the same statement and must not be read as designated.
    expect(d.balanceCents).toBe(6850000 + 5000 + 581454 + 400000);
  });

  it('counts a nested rollup once, not twice', () => {
    // 25019 Memorial rolls up 25019a; counting both would report $8,000 of memorial money on a
    // fund holding $4,000.
    expect(d.funds.find((f) => f.code === '25019a').balanceCents).toBe(400000);
    expect(d.funds.find((f) => f.code === '25019')).toBeUndefined();
  });

  it('ignores rollup rows', () => {
    expect(d.funds.map((f) => f.code)).not.toContain('25000');
  });

  it('reports no balance rather than zero when no statement is on file', () => {
    // $0 on hand and "we have not imported a balance sheet" are different claims.
    expect(computeDesignatedFunds(GIVING_BY_FUND, []).balanceCents).toBeNull();
  });

  it('survives empty input', () => {
    const empty = computeDesignatedFunds([], []);
    expect(empty.funds).toEqual([]);
    expect(empty.designatedGivenCents).toBe(0);
    expect(empty.operatingGivenCents).toBe(0);
  });
});

describe('the donor card', () => {
  const D = {
    givingHouseholds: 129,
    givingCents: GIVING_BY_FUND.reduce((s, g) => s + g.cents, 0),
    designatedFunds: computeDesignatedFunds(GIVING_BY_FUND, BALANCE_ROWS),
    revenueStreams: {
      totalCents: 61966226,
      streams: {
        donor: { cents: 23987577, groups: [{ label: '40 Donor Income (Unrestricted)', cents: 23987577 }] },
        restricted: { cents: 800000, groups: [{ label: '48 Restricted Income', cents: 800000 }] },
        earned: { cents: 32192237, groups: [{ label: '47 Mother’s Day Out', cents: 31348408 }] },
        passive: { cents: 4963400, groups: [{ label: '42 Passive Income', cents: 4963400 }] },
      },
    },
  };
  const html = FIN.finRenderStreamCards(D);

  it('reports donor income as unrestricted plus restricted', () => {
    // The reported bug, inverted: the headline is now the sum of the two bars beneath it.
    expect(html).toContain(finMoney0Str(23987577 + 800000));
  });

  it('never prints a part larger than the headline', () => {
    const headline = 23987577 + 800000;
    expect(D.revenueStreams.streams.donor.cents).toBeLessThanOrEqual(headline);
    expect(D.revenueStreams.streams.restricted.cents).toBeLessThanOrEqual(headline);
  });

  it('sources both bars from the ledger, not from giving records', () => {
    // $247,060.56 / $80,308.17 were the ChMS figures on the live card. Neither may appear.
    expect(html).toContain('$239,875.77');
    expect(html).toContain('$8,000.00');
    expect(html).not.toContain('$80,308');
    expect(html).not.toContain('$247,060');
  });

  it('drops the claim that restricted money cannot be spent', () => {
    // Comfort Dog and Tuition Aid are restricted AND operational; the old copy said otherwise.
    expect(html).not.toContain('truly spendable');
  });

  it('renders three stream cards, not four', () => {
    // A separate restricted card would draw the same dollars twice — once inside donor income
    // and once beside it.
    expect(html.match(/fin-stream-card/g)).toHaveLength(3);
    expect(html).not.toContain('Restricted income</span>');
  });

  it('still labels the streams it keeps', () => {
    expect(html).toContain('Donor income');
    expect(html).toContain('Earned income');
    expect(html).toContain('Passive income');
  });

  it('balances its tags', () => {
    expect(countTag(html, 'div')).toBe(0);
  });
});

describe('the designated funds card', () => {
  const D = {
    givingCents: GIVING_BY_FUND.reduce((s, g) => s + g.cents, 0),
    designatedFunds: computeDesignatedFunds(GIVING_BY_FUND, BALANCE_ROWS),
    revenueStreams: { streams: { donor: { cents: 23987577 }, restricted: { cents: 800000 } } },
  };
  const html = FIN.finRenderDesignatedFunds(D);

  it('lists every designated fund', () => {
    for (const code of ['25010', '25033', '25004', '25008', '25016']) expect(html).toContain(code);
  });

  it('shows both what was given and what is on hand', () => {
    expect(html).toContain('Given this year');
    expect(html).toContain('Balance on hand');
  });

  it('reconciles giving against booked donor income', () => {
    // recorded giving − designated should land near ledger donor income; the card states the gap.
    expect(html).toContain('Does this tie out?');
    expect(html).toContain(finMoney0Str(D.designatedFunds.operatingGivenCents));
  });

  it('flags a gap too wide to be timing', () => {
    const wide = FIN.finRenderDesignatedFunds({
      ...D,
      revenueStreams: { streams: { donor: { cents: 1000000 }, restricted: { cents: 0 } } },
    });
    expect(wide).toContain('likely classified differently');
  });

  it('calls a small gap normal', () => {
    const close = FIN.finRenderDesignatedFunds({
      ...D,
      revenueStreams: { streams: { donor: { cents: D.designatedFunds.operatingGivenCents }, restricted: { cents: 0 } } },
    });
    expect(close).toContain('Small differences are normal');
  });

  it('says so when no balance sheet is on file', () => {
    const noBal = FIN.finRenderDesignatedFunds({
      ...D, designatedFunds: computeDesignatedFunds(GIVING_BY_FUND, []),
    });
    expect(noBal).toContain('No balance sheet is on file');
    // The header's "$X on hand" summary must be gone — not merely the column header, which is
    // still a legitimate part of the table. Paired with the positive case below so neither
    // assertion can pass vacuously.
    expect(noBal).not.toMatch(/\$[\d,]+ on hand/);
  });

  it('shows the total on hand when a statement is on file', () => {
    expect(html).toMatch(/\$[\d,]+ on hand/);
    expect(html).toContain('As of Jun 30, 2026');
  });

  it('renders nothing at all when there are no designated funds', () => {
    // A church with none should not be shown an empty block implying it is missing something.
    expect(FIN.finRenderDesignatedFunds({ ...D, designatedFunds: computeDesignatedFunds([], []) })).toBe('');
  });

  it('balances its tags', () => {
    expect(countTag(html, 'div')).toBe(0);
    expect(countTag(html, 'table')).toBe(0);
    expect(countTag(html, 'tr')).toBe(0);
    expect(countTag(html, 'details')).toBe(0);
  });
});

describe('the revenue mix bar', () => {
  const STREAMS = {
    donor: { cents: 23987577, groups: [{ label: '40 Donor Income (Unrestricted)', cents: 23987577 }] },
    restricted: { cents: 800000, groups: [{ label: '48 Restricted Income', cents: 800000 }] },
    earned: { cents: 32192237, groups: [{ label: '47 Mother’s Day Out', cents: 32192237 }] },
    passive: { cents: 4963400, groups: [{ label: '42 Passive Income', cents: 4963400 }] },
  };
  const TOTAL = 23987577 + 800000 + 32192237 + 4963400;
  const html = FIN.finRenderRevenueMix(STREAMS, TOTAL);

  it('draws three segments, with restricted inside donor', () => {
    // Drawn beside donor, restricted implies a fourth independent lever the board does not have,
    // and makes donor income read smaller than the giving that produced it.
    expect(html.match(/fin-stream-seg"/g)).toHaveLength(3);
    expect(html).not.toContain('>Restricted<');
  });

  it('sizes the donor segment as unrestricted plus restricted', () => {
    const pct = ((23987577 + 800000) / TOTAL * 100).toFixed(1);
    expect(html).toContain('width:' + pct + '%');
  });

  it('says how much of donor income is restricted', () => {
    // Merging must not make the distinction disappear — it is still donor-directed money.
    expect(html).toContain('$8,000 of restricted gifts');
  });

  it('segments still sum to the whole bar', () => {
    const widths = [...html.matchAll(/fin-stream-seg" style="width:([\d.]+)%/g)].map((m) => parseFloat(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it('says nothing about restricted when there is none', () => {
    const noRestricted = FIN.finRenderRevenueMix({ ...STREAMS, restricted: { cents: 0, groups: [] } }, TOTAL - 800000);
    expect(noRestricted).not.toContain('restricted gifts');
    expect(noRestricted.match(/fin-stream-seg"/g)).toHaveLength(3);
  });
});

describe('finDisplayStreams', () => {
  it('folds restricted into donor and drops it as a key', () => {
    const out = FIN.finDisplayStreams({
      donor: { cents: 100, groups: [{ label: 'a', cents: 100 }] },
      restricted: { cents: 30, groups: [{ label: 'b', cents: 30 }] },
      earned: { cents: 50, groups: [] }, passive: { cents: 20, groups: [] },
    });
    expect(out.donor.cents).toBe(130);
    expect(out.donor.groups.map((g) => g.label)).toEqual(['a', 'b']);
    expect(out.restricted).toBeUndefined();
  });

  it('preserves the grand total', () => {
    const raw = { donor: { cents: 100 }, restricted: { cents: 30 }, earned: { cents: 50 }, passive: { cents: 20 } };
    const out = FIN.finDisplayStreams(raw);
    const sum = (o) => Object.values(o).reduce((a, s) => a + (s.cents || 0), 0);
    expect(sum(out)).toBe(sum(raw));
  });

  it('does not mutate the streams it was given', () => {
    const raw = {
      donor: { cents: 100, groups: [{ label: 'a', cents: 100 }] },
      restricted: { cents: 30, groups: [{ label: 'b', cents: 30 }] },
    };
    FIN.finDisplayStreams(raw);
    expect(raw.donor.cents).toBe(100);
    expect(raw.donor.groups).toHaveLength(1);
  });
});

function countTag(html, tag) {
  const open = (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
  const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  return open - close;
}
function finMoney0Str(cents) {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}
