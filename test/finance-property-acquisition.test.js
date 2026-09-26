import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_FACTS, calcAcquisition, calcIvanhoe, calcPortfolio, pmt, readAcquisitionInputs, renderAcquisitionPage,
} from '../apps/finance/property-acquisition-pages.js';

const params = (query = '') => new URLSearchParams(query);

describe('Commercial Property acquisition model', () => {
  it('uses the council presentation figures by default', () => {
    const input = readAcquisitionInputs(params());
    expect(input).toMatchObject({ price: 430000, units: 4, rent: 1050, utilities: 900, finance: 'roll', ratePct: 6.375 });
  });

  it('computes the rolled-in pro forma the way the presentation did', () => {
    const input = readAcquisitionInputs(params());
    const r = calcAcquisition(input);
    const gri = 1050 * 4 * 12;
    const egi = gri * 0.92;
    const noi = egi - 4915 - egi * 0.08 - egi * 0.06 - 900 - 4800;
    expect(r.gri).toBe(gri);
    expect(r.noi).toBeCloseTo(noi, 6);
    const blended = pmt(0.06375, 300, ACQUISITION_FACTS.existingBalance + 430000);
    expect(r.monthlyPayment).toBeCloseTo(blended, 6);
    expect(r.annualDebtService).toBeCloseTo((blended - 3783) * 12, 6);
    expect(r.down).toBe(0);
    expect(r.cashOnCash).toBeNull();
    expect(r.netEffectivePrice).toBe(430000 - 16782);
  });

  it('computes a separate loan with a down payment', () => {
    const r = calcAcquisition(readAcquisitionInputs(params('finance=down&down_pct=25&price=400000')));
    expect(r.down).toBe(100000);
    expect(r.loan).toBe(300000);
    expect(r.annualDebtService).toBeCloseTo(pmt(0.06375, 300, 300000) * 12, 6);
    expect(r.cashOnCash).toBeCloseTo(r.cashFlow / 100000, 9);
  });

  it('combines Ivanhoe and Fyler under one blended payment when rolled in', () => {
    const input = readAcquisitionInputs(params());
    const r = calcAcquisition(input);
    const iv = calcIvanhoe(input);
    expect(iv.noi).toBeCloseTo(8150 * 12 * (1 - 0.06 - 0.115) - 4500 - 11400, 6);
    const port = calcPortfolio(input, r, iv);
    expect(port.debtService).toBeCloseTo(r.monthlyPayment * 12, 6);
    expect(port.cashFlow).toBeCloseTo(iv.noi + r.noi - r.monthlyPayment * 12, 6);
    const separate = readAcquisitionInputs(params('finance=down'));
    const rs = calcAcquisition(separate);
    expect(calcPortfolio(separate, rs, iv).debtService).toBeCloseTo(3783 * 12 + rs.annualDebtService, 6);
  });

  it('resets rent and utilities when the unit count changes, and ignores bad input', () => {
    expect(readAcquisitionInputs(params('units=6&prev_units=4&rent=1050&utilities=900'))).toMatchObject({ rent: 950, utilities: 1200 });
    expect(readAcquisitionInputs(params('units=6&prev_units=6&rent=1000'))).toMatchObject({ rent: 1000, utilities: 1200 });
    expect(readAcquisitionInputs(params('price=-5&vacancy=abc&rate=99'))).toMatchObject({ price: 430000, vacancyPct: 8, ratePct: 6.375 });
    expect(readAcquisitionInputs(params('price=%24410%2C000'))).toMatchObject({ price: 410000 });
  });

  it('renders a script-free page that escapes form values and mentions live Ivanhoe results when given', () => {
    const html = renderAcquisitionPage({ params: params('units=4'), propertyAnnual: { year: 2025, netIncomeCents: 5000000 } });
    expect(html).toContain('Price points');
    expect(html).toContain('4 units or 6?');
    expect(html).toContain('$50,000 net income for Ivanhoe in 2025');
    expect(html).toContain('method="GET"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
});
