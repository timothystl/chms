// Commercial Property → Acquisition model (v3 design). A what-if for buying 6707 Fyler Ave, adapted
// from the council presentation model: the assumptions are a GET form filled in with that
// presentation's figures, every submit recalculates, and nothing is saved. Amounts are whole dollars.
import { escapeHtml as e } from './render-helpers.js';

// Figures confirmed for the council presentation (LCEF rate and balance, the county tax bill).
export const ACQUISITION_FACTS = {
  rate: 0.06375,            // LCEF rate on the existing Ivanhoe loan
  existingBalance: 282595,  // Ivanhoe loan balance
  existingPayment: 3783,    // Ivanhoe monthly payment, matures March 2033
  termMonths: 300,
  annualTax: 4915,          // Fyler annual property tax
  backTaxes: 16782,         // delinquent taxes owed on Fyler
  brokerPct: 0.03,
};

export const PRICE_POINTS = [
  { price: 475000, label: 'Asking' },
  { price: 430000, label: 'Market value' },
  { price: 390000, label: 'Counter-offer' },
];

// Defaults that follow the unit count: the city record says 4 units, the building shows 6.
const UNIT_DEFAULTS = { 4: { rent: 1050, utilities: 900 }, 6: { rent: 950, utilities: 1200 } };

export const ACQUISITION_DEFAULTS = {
  price: 430000, units: 4, rent: 1050, vacancyPct: 8, maintenancePct: 8, managementPct: 6,
  utilities: 900, capitalReserve: 4800, finance: 'roll', downPct: 25, ratePct: 6.375,
  ivanhoeRent: 8150, ivanhoeManagementPct: 6, ivanhoeUtilitiesPct: 11.5, ivanhoeReserve: 4500, ivanhoeTax: 11400,
};

export function pmt(annualRate, months, principal) {
  const m = annualRate / 12;
  if (!m) return principal / months;
  const f = (1 + m) ** months;
  return principal * m * f / (f - 1);
}

function num(params, key, fallback, { min = 0, max = Infinity } = {}) {
  const raw = params?.get?.(key);
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function readAcquisitionInputs(params) {
  const d = ACQUISITION_DEFAULTS;
  const units = num(params, 'units', d.units, { min: 1, max: 40 });
  const unitDefaults = UNIT_DEFAULTS[units] || UNIT_DEFAULTS[4];
  // Switching the unit count resets rent and utilities to that count's figures.
  const unitsChanged = params?.get?.('prev_units') && Number(params.get('prev_units')) !== units;
  const unitParam = (key, fallback, opts) => (unitsChanged ? fallback : num(params, key, fallback, opts));
  return {
    price: num(params, 'price', d.price, { min: 1, max: 10_000_000 }),
    units,
    rent: unitParam('rent', unitDefaults.rent, { max: 20000 }),
    vacancyPct: num(params, 'vacancy', d.vacancyPct, { max: 100 }),
    maintenancePct: num(params, 'maintenance', d.maintenancePct, { max: 100 }),
    managementPct: num(params, 'management', d.managementPct, { max: 100 }),
    utilities: unitParam('utilities', unitDefaults.utilities, { max: 1_000_000 }),
    capitalReserve: num(params, 'reserve', d.capitalReserve, { max: 1_000_000 }),
    finance: params?.get?.('finance') === 'down' ? 'down' : 'roll',
    downPct: num(params, 'down_pct', d.downPct, { max: 100 }),
    ratePct: num(params, 'rate', d.ratePct, { max: 30 }),
    ivanhoeRent: num(params, 'iv_rent', d.ivanhoeRent, { max: 1_000_000 }),
    ivanhoeManagementPct: d.ivanhoeManagementPct,
    ivanhoeUtilitiesPct: d.ivanhoeUtilitiesPct,
    ivanhoeReserve: d.ivanhoeReserve,
    ivanhoeTax: d.ivanhoeTax,
  };
}

// One Fyler pro forma at a price/unit count, under the chosen financing.
export function calcAcquisition(input, overrides = {}) {
  const i = { ...input, ...overrides };
  const f = ACQUISITION_FACTS;
  const rate = i.ratePct / 100;
  const gri = i.rent * i.units * 12;
  const vacancy = gri * i.vacancyPct / 100;
  const egi = gri - vacancy;
  const maintenance = egi * i.maintenancePct / 100;
  const management = egi * i.managementPct / 100;
  const noi = egi - f.annualTax - maintenance - management - i.utilities - i.capitalReserve;
  let loan; let monthlyPayment; let paymentChange; let annualDebtService; let down;
  if (i.finance === 'roll') {
    loan = f.existingBalance + i.price;
    monthlyPayment = pmt(rate, f.termMonths, loan);
    paymentChange = monthlyPayment - f.existingPayment;
    annualDebtService = paymentChange * 12;
    down = 0;
  } else {
    down = i.price * i.downPct / 100;
    loan = i.price - down;
    monthlyPayment = pmt(rate, f.termMonths, loan);
    paymentChange = monthlyPayment;
    annualDebtService = monthlyPayment * 12;
  }
  const cashFlow = noi - annualDebtService;
  return {
    gri, vacancy, egi, maintenance, management, utilities: i.utilities, capitalReserve: i.capitalReserve, tax: f.annualTax,
    noi, loan, monthlyPayment, paymentChange, annualDebtService, down, cashFlow,
    capRate: noi / i.price,
    dscr: annualDebtService > 0 ? noi / annualDebtService : null,
    cashOnCash: down > 0 ? cashFlow / down : null,
    netEffectivePrice: i.price - f.backTaxes,
    brokerSavings: i.price * f.brokerPct,
  };
}

export function calcIvanhoe(input) {
  const gross = input.ivanhoeRent * 12;
  const management = gross * input.ivanhoeManagementPct / 100;
  const utilities = gross * input.ivanhoeUtilitiesPct / 100;
  const noi = gross - management - utilities - input.ivanhoeReserve - input.ivanhoeTax;
  return { gross, management, utilities, reserve: input.ivanhoeReserve, tax: input.ivanhoeTax, noi };
}

// Ivanhoe + Fyler together. Rolled in, the whole blended LCEF payment carries both; with a down
// payment Ivanhoe keeps its own loan and Fyler adds a second one.
export function calcPortfolio(input, fyler, ivanhoe) {
  const f = ACQUISITION_FACTS;
  const debtService = input.finance === 'roll' ? fyler.monthlyPayment * 12 : f.existingPayment * 12 + fyler.annualDebtService;
  const noi = ivanhoe.noi + fyler.noi;
  return { gross: ivanhoe.gross + fyler.gri, noi, debtService, dscr: debtService > 0 ? noi / debtService : null, cashFlow: noi - debtService };
}

const money = (v) => `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
const signed = (v) => `${v < 0 ? '−' : '+'}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const tone = (ok) => (ok ? 'aq-good' : 'aq-bad');
const dscrText = (v) => (v === null ? '—' : `${v.toFixed(2)}×`);

function field(name, label, value, hint = '') {
  return `<label class="field"><span>${label}</span><input name="${name}" inputmode="decimal" value="${e(String(value))}">${hint ? `<small>${hint}</small>` : ''}</label>`;
}

export function renderAcquisitionPage({ params, propertyAnnual = null } = {}) {
  const input = readAcquisitionInputs(params);
  const facts = ACQUISITION_FACTS;
  const r = calcAcquisition(input);
  const iv = calcIvanhoe(input);
  const port = calcPortfolio(input, r, iv);
  const rolled = input.finance === 'roll';

  const form = `<form method="GET" action="/" class="panel panel-spaced aq-form">
      <input type="hidden" name="section" value="property"><input type="hidden" name="page" value="acquisition"><input type="hidden" name="prev_units" value="${input.units}">
      <h2>Assumptions</h2>
      <div class="form-grid">
        ${field('price', 'Purchase price ($)', input.price)}
        <label class="field"><span>Units</span><select name="units">${[4, 6].map((u) => `<option value="${u}"${u === input.units ? ' selected' : ''}>${u} units${u === 4 ? ' (city record)' : ' (observed)'}</option>`).join('')}${[4, 6].includes(input.units) ? '' : `<option value="${input.units}" selected>${input.units} units</option>`}</select></label>
        ${field('rent', 'Rent per unit ($/mo)', input.rent, 'Changing the unit count resets this to $1,050 (4 units) or $950 (6).')}
        ${field('vacancy', 'Vacancy (%)', input.vacancyPct)}
        ${field('maintenance', 'Maintenance (% of effective income)', input.maintenancePct)}
        ${field('management', 'Management (% of effective income)', input.managementPct)}
        ${field('utilities', 'Owner-paid utilities ($/yr)', input.utilities, 'Changing the unit count resets this to $900 (4 units) or $1,200 (6).')}
        ${field('reserve', 'Capital reserve ($/yr)', input.capitalReserve)}
        <label class="field"><span>Financing</span><select name="finance"><option value="roll"${rolled ? ' selected' : ''}>Blend into the LCEF loan, nothing down</option><option value="down"${rolled ? '' : ' selected'}>Separate loan with a down payment</option></select></label>
        ${field('down_pct', 'Down payment (%, separate loan)', input.downPct)}
        ${field('rate', 'Interest rate (%)', input.ratePct)}
        ${field('iv_rent', 'Ivanhoe rent, all tenants ($/mo)', input.ivanhoeRent)}
      </div>
      <div class="form-actions"><button type="submit">Recalculate</button> <a class="aq-reset" href="/?section=property&amp;page=acquisition">Reset to the presentation figures</a></div>
    </form>`;

  const cards = `<div class="grid">
      <div class="card"><small>Fyler net operating income</small><strong>${money(r.noi)}</strong><span>${pct(r.capRate, 2)} cap rate</span></div>
      <div class="card"><small>${rolled ? 'Added to the LCEF payment' : 'New loan payment'}</small><strong>${money(r.paymentChange)}/mo</strong><span>${rolled ? `Blended payment ${money(r.monthlyPayment)}/mo` : `${money(r.down)} down`}</span></div>
      <div class="card"><small>Fyler cash flow</small><strong class="${tone(r.cashFlow >= 0)}">${signed(r.cashFlow)}/yr</strong><span>${signed(r.cashFlow / 12)}/mo</span></div>
      <div class="card"><small>Debt coverage</small><strong class="${tone(r.dscr !== null && r.dscr >= 1.25)}">${dscrText(r.dscr)}</strong><span>Lenders look for 1.25× or better</span></div>
    </div>`;

  const proForma = `<div class="panel panel-spaced list-panel"><h2>6707 Fyler pro forma</h2><div class="table-scroll"><table class="pm-table aq-num"><tbody>
      <tr><td>Gross rent (${input.units} units × ${money(input.rent)} × 12)</td><td>${money(r.gri)}</td></tr>
      <tr><td>Vacancy (${input.vacancyPct}%)</td><td>${money(-r.vacancy)}</td></tr>
      <tr class="aq-sub"><td>Effective gross income</td><td>${money(r.egi)}</td></tr>
      <tr><td>Property tax (county bill)</td><td>${money(-r.tax)}</td></tr>
      <tr><td>Maintenance (${input.maintenancePct}%)</td><td>${money(-r.maintenance)}</td></tr>
      <tr><td>Management (${input.managementPct}%)</td><td>${money(-r.management)}</td></tr>
      <tr><td>Owner-paid utilities</td><td>${money(-r.utilities)}</td></tr>
      <tr><td>Capital reserve (1926 building)</td><td>${money(-r.capitalReserve)}</td></tr>
      <tr><td>Insurance <small>Covered by the church umbrella policy</small></td><td>$0</td></tr>
      <tr class="aq-sub"><td>Net operating income</td><td>${money(r.noi)}</td></tr>
      <tr><td>${rolled ? 'Added debt service (blended payment less today’s Ivanhoe payment)' : 'Debt service on the new loan'}</td><td>${money(-r.annualDebtService)}</td></tr>
      <tr class="total-row"><td>Cash flow</td><td class="${tone(r.cashFlow >= 0)}">${signed(r.cashFlow)}</td></tr>
    </tbody></table></div>
    <dl class="aq-facts">
      <div><dt>Loan amount</dt><dd>${money(r.loan)}${rolled ? ` <small>${money(facts.existingBalance)} existing + ${money(input.price)}</small>` : ''}</dd></div>
      <div><dt>Term and rate</dt><dd>${facts.termMonths / 12} years at ${input.ratePct}%</dd></div>
      <div><dt>Cash down</dt><dd>${money(r.down)}</dd></div>
      <div><dt>Cash-on-cash return</dt><dd>${r.cashOnCash === null ? 'Not applicable — nothing down' : pct(r.cashOnCash)}</dd></div>
      <div><dt>Net effective price</dt><dd>${money(r.netEffectivePrice)} <small>after ${money(facts.backTaxes)} back taxes</small></dd></div>
    </dl></div>`;

  const priceRows = PRICE_POINTS.map((p) => {
    const at = calcAcquisition(input, { price: p.price });
    return `<tr${p.price === input.price ? ' class="aq-current"' : ''}><td>${p.label}</td><td>${money(p.price)}</td><td>${money(at.paymentChange)}</td><td class="${tone(at.cashFlow >= 0)}">${signed(at.cashFlow)}</td><td>${pct(at.capRate)}</td><td class="${tone(at.dscr !== null && at.dscr >= 1.25)}">${dscrText(at.dscr)}</td></tr>`;
  }).join('');
  const prices = `<div class="panel panel-spaced list-panel"><h2>Price points</h2><div class="table-scroll"><table class="pm-table aq-num"><thead><tr><th>Price</th><th></th><th>${rolled ? 'Payment increase/mo' : 'Monthly payment'}</th><th>Cash flow/yr</th><th>Cap rate</th><th>Debt coverage</th></tr></thead><tbody>${priceRows}</tbody></table></div>
      <p class="muted-line">Each row uses the assumptions above at that price.</p></div>`;

  const unitRows = [4, 6].map((u) => {
    const d = UNIT_DEFAULTS[u];
    const at = calcAcquisition(input, { units: u, rent: d.rent, utilities: d.utilities });
    return `<tr${u === input.units ? ' class="aq-current"' : ''}><td>${u} units ${u === 4 ? '<small>City record</small>' : '<small>Observed from the street</small>'}</td><td>${money(d.rent)}</td><td>${money(at.gri)}</td><td>${money(at.noi)}</td><td>${pct(at.capRate, 2)}</td><td class="${tone(at.cashFlow >= 0)}">${signed(at.cashFlow / 12)}/mo</td></tr>`;
  }).join('');
  const unitCompare = `<div class="panel panel-spaced list-panel"><h2>4 units or 6?</h2><div class="table-scroll"><table class="pm-table aq-num"><thead><tr><th>Scenario</th><th>Rent/unit</th><th>Gross rent</th><th>NOI</th><th>Cap rate</th><th>Cash flow</th></tr></thead><tbody>${unitRows}</tbody></table></div>
      <p class="muted-line">At ${money(input.price)} with the financing chosen above. A walkthrough settles the unit count.</p></div>`;

  const liveNote = propertyAnnual && Number.isFinite(propertyAnnual.netIncomeCents)
    ? `<p class="muted-line">For comparison, Connect records ${money(propertyAnnual.netIncomeCents / 100)} net income for Ivanhoe in ${e(String(propertyAnnual.year))}${propertyAnnual.year === new Date().getFullYear() ? ' so far' : ''} (after the manager’s reported expenses).</p>` : '';
  const portfolio = `<div class="panel panel-spaced list-panel"><h2>Ivanhoe and Fyler together</h2><div class="table-scroll"><table class="pm-table aq-num"><thead><tr><th></th><th>3277 Ivanhoe</th><th>6707 Fyler</th><th>Together</th></tr></thead><tbody>
      <tr><td>Gross rent</td><td>${money(iv.gross)}</td><td>${money(r.gri)}</td><td>${money(port.gross)}</td></tr>
      <tr><td>Net operating income</td><td>${money(iv.noi)}</td><td>${money(r.noi)}</td><td>${money(port.noi)}</td></tr>
      <tr><td>Debt service</td><td>${money(facts.existingPayment * 12)}</td><td>${money(rolled ? r.monthlyPayment * 12 - facts.existingPayment * 12 : r.annualDebtService)}</td><td>${money(port.debtService)}</td></tr>
      <tr><td>Debt coverage</td><td>${dscrText(iv.noi / (facts.existingPayment * 12))}</td><td>${dscrText(r.dscr)}</td><td class="${tone(port.dscr !== null && port.dscr >= 1.25)}">${dscrText(port.dscr)}</td></tr>
      <tr class="total-row"><td>Cash flow</td><td>${signed(iv.noi - facts.existingPayment * 12)}</td><td>${signed(r.cashFlow)}</td><td class="${tone(port.cashFlow >= 0)}">${signed(port.cashFlow)}</td></tr>
    </tbody></table></div>
    <p class="muted-line">Ivanhoe NOI here: ${money(iv.gross)} rent less ${input.ivanhoeManagementPct}% management, ${input.ivanhoeUtilitiesPct}% utilities and upkeep, a ${money(iv.reserve)} reserve and ${money(iv.tax)} property tax. The existing LCEF loan (${money(facts.existingBalance)} at ${money(facts.existingPayment)}/mo) matures March 2033.</p>
    ${liveNote}</div>`;

  const leverage = `<div class="panel panel-spaced list-panel"><h2>Negotiating leverage</h2><ul class="aq-list">
      <li><b>Back taxes of ${money(facts.backTaxes)}.</b> Ask the seller to clear them at closing, in writing; otherwise take them off the price.</li>
      <li><b>No broker.</b> A direct sale saves the seller about ${money(r.brokerSavings)} (3%) that can come off the price.</li>
      <li><b>Unit count.</b> The city lists 4 units; 6 are visible. Uncertainty about legal occupancy is a reason to price at 4.</li>
      <li><b>Inspection contingency.</b> A 1926 building; make the offer subject to inspection.</li>
    </ul></div>
    <div class="panel panel-spaced list-panel"><h2>Before the council decides</h2><ol class="aq-list">
      <li>A walkthrough to confirm the unit count and condition.</li>
      <li>LCEF confirms it will blend the existing loan with the purchase at the current rate with nothing down.</li>
      <li>The seller’s rent roll and current leases.</li>
      <li>Back taxes paid at closing as a written condition of sale.</li>
    </ol><p class="muted-line">This page is a model. It saves nothing and changes no records.</p></div>`;

  return `<p class="lede">A model for buying 6707 Fyler Ave, across Fyler from the church campus. The figures start from the council presentation; change any assumption and recalculate.</p>
    ${cards}${form}${proForma}${prices}${unitCompare}${portfolio}${leverage}`;
}

export const ACQUISITION_STYLES = `
    .aq-form .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px 18px; }
    .aq-form .field small { color:#6B7280; font-size:12px; font-weight:400; }
    .aq-reset { font-size:14px; margin-left:12px; }
    .aq-num td:not(:first-child), .aq-num th:not(:first-child) { text-align:right; white-space:nowrap; }
    .aq-num td small { display:block; color:#6B7280; font-size:12px; }
    .aq-sub td { font-weight:600; background:#F4F6F9; }
    .aq-current td { background:#EEF3FA; font-weight:600; }
    .aq-good { color:#1F6F43; }
    .aq-bad { color:#B42318; }
    .aq-facts { margin:14px 0 0; }
    .aq-facts div { display:flex; justify-content:space-between; gap:12px; padding:6px 0; border-bottom:1px solid #EEF0F4; font-size:14px; }
    .aq-facts dt { color:#4B5563; }
    .aq-facts dd { margin:0; text-align:right; }
    .aq-facts small { color:#6B7280; }
    .aq-list { margin:8px 0; padding-left:20px; line-height:1.6; }
`;
