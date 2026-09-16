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

// A distinct message from renderUnavailablePage above: that one means "this workflow is not built
// yet" (a product-completeness fact); this one means "this is a real, built report, but its data
// could not be read for this request" (a transient/data-integrity fact -- see
// synthetic-read-guard.js). Keeping the wording and badge different so a future reader, or Andrew
// looking at a live page, never conflates "not built" with "temporarily unavailable."
export function renderDataUnavailablePage({ eyebrow, heading, reason }) {
  return `<section class="report unavailable" aria-label="${escapeHtml(heading)} (data unavailable)">
    ${renderSectionHeading({ eyebrow, heading: escapeHtml(heading), badge: 'Data unavailable' })}
    <p class="status status-error">${reason}</p>
  </section>`;
}

// One card-sized "this figure could not be read" placeholder for a page that otherwise renders
// fine -- used so a missing companion synthetic read (see synthetic-read-guard.js) never shows a
// blank or fabricated $0/0% in place of a real figure. The em dash is deliberately not a number.
export function renderUnavailableCard(label, note = 'Data temporarily unavailable.') {
  return `<div class="card"><small>${escapeHtml(label)}</small><strong>—</strong><span>${escapeHtml(note)}</span></div>`;
}
