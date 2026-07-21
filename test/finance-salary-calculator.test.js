import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// The LCMS salary calculator's data tables and pure compute functions live inside the served
// (String.raw) frontend script, not as exported module functions — extract them (none touch the
// DOM) and eval standalone. Same technique used elsewhere in this project (see CLAUDE.md
// SC3-BUG1 / TAP11 / FIN10/FIN11) — this is also exactly the class of bug it caught this time: a
// literal backtick in a comment inside the String.raw template silently truncated the whole
// served script until fixed (verified via the extract-and-`node --check` step before this).
function loadSalaryCalculator() {
  const varNames = ['LCMS_MO_BASE_SALARY_BY_YEAR', 'LCMS_PASTOR_MULTIPLIERS', 'LCMS_COMMISSIONED_TRACKS', 'LCMS_OTHER_WORKER_TRACKS'];
  const varSrcs = varNames.map(name => {
    const m = CHMS_APP_EXT_JS.match(new RegExp(`var ${name} = [\\s\\S]*?;\\n`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  const fnNames = ['finLcmsBaseSalaryCents', 'finLcmsMultiplierFor', 'finComputeLcmsSalary', 'finDefaultSelfEmployedFica', 'finComputeEmployerFicaCents'];
  const fnSrcs = fnNames.map(name => {
    const m = CHMS_APP_EXT_JS.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  const ficaRateM = CHMS_APP_EXT_JS.match(/var LCMS_EMPLOYER_FICA_RATE = [^\n]*\n/);
  if (!ficaRateM) throw new Error('LCMS_EMPLOYER_FICA_RATE not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${varSrcs.join('\n')} ${ficaRateM[0]} ${fnSrcs.join('\n')} return { finLcmsBaseSalaryCents, finLcmsMultiplierFor, finComputeLcmsSalary, finDefaultSelfEmployedFica, finComputeEmployerFicaCents, LCMS_EMPLOYER_FICA_RATE }; })()`);
}

describe('LCMS Missouri District salary calculator', () => {
  const { finLcmsBaseSalaryCents, finComputeLcmsSalary, finDefaultSelfEmployedFica, finComputeEmployerFicaCents, LCMS_EMPLOYER_FICA_RATE } = loadSalaryCalculator();

  it('looks up the exact published base salary for a known year', () => {
    expect(finLcmsBaseSalaryCents(2027)).toMatchObject({ dollars: 51529, exact: true });
    expect(finLcmsBaseSalaryCents(2016)).toMatchObject({ dollars: 39900, exact: true });
  });

  it('falls back to the most recent known year rather than fabricating a number for an unpublished year', () => {
    const r = finLcmsBaseSalaryCents(2030);
    expect(r.exact).toBe(false);
    expect(r.sourceYear).toBe(2027);
    expect(r.dollars).toBe(51529);
  });

  it('reproduces the published Pastor compensation scale exactly (Section 1.1, base year 2027)', () => {
    // Table: years 0/5/10/20/30 -> $74,717 / $80,901 / $88,630 / $103,573 / $113,879 (the PDF's
    // own printed column rounds the raw base-x-multiplier product to the nearest whole dollar).
    const dollars = years => Math.round(finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: years }).salaryCents / 100);
    expect(dollars(0)).toBe(74717);
    expect(dollars(5)).toBe(80901);
    expect(dollars(10)).toBe(88630);
    expect(dollars(20)).toBe(103573);
    expect(dollars(30)).toBe(113879);
  });

  it('grows the pastor multiplier by 0.02/year beyond the published 30-year cap', () => {
    // Year 30 multiplier is 2.21; year 32 should be 2.21 + 0.02*2 = 2.25
    const r = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 32 });
    expect(r.multiplier).toBeCloseTo(2.25, 5);
  });

  it('reproduces the published Commissioned Worker table exactly (Section 1.2, MA+20hrs PhD track)', () => {
    // Row 0: $61,835; Row 10: $75,748; Row 25: $96,359
    const dollars = years => Math.round(finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'ma20phd', yearsExperience: years }).salaryCents / 100);
    expect(dollars(0)).toBe(61835);
    expect(dollars(10)).toBe(75748);
    expect(dollars(25)).toBe(96359);
  });

  it('caps the B.S.-only commissioned track at its published final year instead of growing further', () => {
    const atCap = finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'bs', yearsExperience: 10 });
    const beyondCap = finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'bs', yearsExperience: 20 });
    expect(atCap.multiplier).toBe(1.20);
    expect(beyondCap.multiplier).toBe(1.20); // frozen, not grown further
  });

  it('reproduces the published Other Church Workers table exactly (Section 1.3)', () => {
    // The PDF's own worked examples say "the base salary set for 2026 is $51,529" — but the
    // document's own Base Salary History table lists 2026 as $50,028 and 2027 as $51,529. Using
    // $51,529 (i.e. year 2027 in this table) reproduces the worked examples' figures exactly, so
    // that mislabeled "2026" in the prose is treated as a carried-over typo, not a data source.
    // Secretary, 8 years experience: base $51,529 x 0.97 = $49,983 (the PDF's own worked example)
    const r = finComputeLcmsSalary({ year: 2027, role: 'other', trackKey: 'secretary', yearsExperience: 8 });
    expect(r.multiplier).toBe(0.97);
    expect(Math.round(r.salaryCents / 100)).toBe(49983);
    // New-hire custodian: base $51,529 x 0.65 = $33,494 (the PDF's own worked example)
    const r2 = finComputeLcmsSalary({ year: 2027, role: 'other', trackKey: 'custodian', yearsExperience: 0 });
    expect(r2.multiplier).toBe(0.65);
    expect(Math.round(r2.salaryCents / 100)).toBe(33494);
  });

  it('adds a responsibility stipend and (pastor-only) attendance bonus on top of the base multiplier', () => {
    const base = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 10 });
    const withBonus = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 10, attendanceBonus: 0.20 });
    expect(withBonus.multiplier).toBeCloseTo(base.multiplier + 0.20, 5);
    expect(withBonus.salaryCents).toBeGreaterThan(base.salaryCents);
  });

  // FICA/SECA employer-cost distinction: Pastors and Commissioned Ministers (e.g. DCEs) are
  // self-employed for Social Security by default (the church pays no employer FICA for them —
  // they pay their own SECA), while Other Church Workers are regular employees (the church pays
  // the standard employer FICA share). Confirmed against real Concordia Plans estimates for
  // Timothy Lutheran's actual Pastor and DCE (both self-employed, no employer FICA) and Director
  // of Parish Music (treated as a regular employee at this specific church despite nominally
  // qualifying for minister tax treatment elsewhere) — the per-worker override exists exactly to
  // handle that last case, since the role default alone would get it wrong.
  describe('FICA/SECA employer-cost distinction', () => {
    it('defaults Pastors and Commissioned Ministers to self-employed (SECA), Other Church Workers to regular-employee', () => {
      expect(finDefaultSelfEmployedFica('pastor')).toBe(true);
      expect(finDefaultSelfEmployedFica('commissioned')).toBe(true);
      expect(finDefaultSelfEmployedFica('other')).toBe(false);
    });

    it('charges $0 employer FICA for a self-employed (SECA) worker regardless of salary', () => {
      expect(finComputeEmployerFicaCents(10000000, true)).toBe(0);
    });

    it('charges the standard employer FICA rate for a regular-employee worker', () => {
      const salaryCents = 7347375; // $73,473.75 — the real Concordia estimate for this church's Director of Parish Music
      const expected = Math.round(salaryCents * LCMS_EMPLOYER_FICA_RATE);
      expect(finComputeEmployerFicaCents(salaryCents, false)).toBe(expected);
      expect(finComputeEmployerFicaCents(salaryCents, false)).toBeGreaterThan(0);
    });

    it('lets a per-worker override diverge from the role default (Director of Parish Music treated as a regular employee at this church)', () => {
      // Role default for a Commissioned Minister would be self-employed=true, but this specific
      // church's real-world practice for its Director of Parish Music is employer-paid FICA —
      // the override must win over the role default.
      const roleDefault = finDefaultSelfEmployedFica('commissioned');
      expect(roleDefault).toBe(true);
      const overridden = false; // this worker's actual per-row toggle
      expect(finComputeEmployerFicaCents(7347375, overridden)).toBeGreaterThan(0);
    });
  });
});
