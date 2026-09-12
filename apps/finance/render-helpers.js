// Shared HTML-rendering primitives used by shell.js and every apps/finance/*-pages.js module.
// Kept dependency-free (no D1, no view-model imports) so every page module can import it without
// creating a cycle back into shell.js.

export function formatCents(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

export function formatSignedCents(value) {
  const amount = formatCents(Math.abs(value));
  return value < 0 ? `−${amount}` : amount;
}

export function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return [...String(value)].map((character) => entities[character] || character).join('');
}

export function renderKpiCards(cards) {
  return `<div class="grid">${cards.map((card) => `<div class="card"><small>${escapeHtml(card.label)}</small><strong>${card.value}</strong>${card.hint ? `<span>${card.hint}</span>` : ''}</div>`).join('')}</div>`;
}

export function renderSectionHeading({ eyebrow, heading, badge, trend }) {
  return `<div class="section-heading${trend ? ' trend-heading' : ''}"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h2>${heading}</h2></div>${badge ? `<span class="badge">${badge}</span>` : ''}</div>`;
}

export function renderTable({ head, rows }) {
  return `<div class="table-wrap"><table><thead><tr>${head.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// A single unavailable sub-page: used for every nav entry the redesign calls for that has no
// real backing table/service yet. Named per-reason rather than one generic string so it stays
// honest about *why* (contract limits vs. no schema vs. product decision pending) rather than
// reading as a bug.
export function renderUnavailablePage({ eyebrow, heading, reason }) {
  return `<section class="report unavailable" aria-label="${escapeHtml(heading)} (not yet available)">
    ${renderSectionHeading({ eyebrow, heading: escapeHtml(heading), badge: 'Not yet available' })}
    <p class="status status-pending">${reason}</p>
  </section>`;
}
