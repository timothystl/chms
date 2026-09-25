import { buildLiveBoardPacket } from './board-packet-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderSectionHeading, renderUnavailableCard } from './render-helpers.js';

function sourceLabel(source) {
  return source === 'live' ? 'live from Connect' : 'synthetic fixture';
}

function renderPacketCard(label, card, valueFn, hintFn) {
  if (!card) return renderUnavailableCard(label);
  return `<div class="card"><small>${escapeHtml(label)}</small><strong>${valueFn(card)}</strong><span>${hintFn(card)}</span></div>`;
}

// Each of the four cards below independently prefers the same live-first resolver result its own
// full page already uses -- churchReportLive (Church Report), balanceSheetLive (Balance Sheet,
// shell.js's `balanceSheet` variable), churchTrendLive (Church Report's multi-year trend), and
// giving/givingSource (already live-first and unconditional for this section before this change) --
// via buildLiveBoardPacket (see board-packet-service.js). Unlike the retired all-or-nothing
// buildSyntheticBoardPacket this replaced here, a missing/invalid input degrades only its own card
// to an honest "unavailable" placeholder (renderUnavailableCard) rather than throwing the whole
// page into shell.js's generic 503 -- the same standard Financial Health's own cards already apply.
// buildSyntheticBoardPacket itself is untouched and keeps its own dedicated test coverage; nothing
// here calls it anymore.
export function renderPacketPage({ churchReportLive, balanceSheetLive, churchTrendLive, giving, givingSource }) {
  const packet = buildLiveBoardPacket({ churchReportLive, balanceSheetLive, churchTrendLive, giving, givingSource });
  const heading = Number.isInteger(packet.fiscalYear) ? `Decision-ready FY${packet.fiscalYear} summary` : 'Decision-ready summary';
  const badge = !packet.ready ? 'Partial data' : packet.reconciled ? 'Reconciled' : 'Review required';
  const cardsHtml = [
    renderPacketCard('Operating result', packet.operating,
      (c) => formatSignedCents(c.actualNetCents),
      (c) => `Budget ${formatSignedCents(c.budgetNetCents)} · ${c.disposition} ${formatSignedCents(c.varianceCents)} · ${sourceLabel(c.source)}`),
    renderPacketCard('Financial position', packet.position,
      (c) => formatCents(c.netAssetsCents),
      (c) => `Assets ${formatCents(c.assetsCents)} · liabilities ${formatCents(c.liabilitiesCents)} · ${sourceLabel(c.source)}`),
    renderPacketCard('Operating trend', packet.trend,
      (c) => formatSignedCents(c.changeCents),
      (c) => `FY${c.priorFiscalYear} to FY${c.currentFiscalYear} · ${sourceLabel(c.source)}`),
    renderPacketCard('Giving evidence', packet.giving,
      (c) => formatCents(c.netCents),
      (c) => `${c.sourceRecordCount} aggregate records · ${c.reconciled ? 'totals reconcile' : 'review required'} · ${sourceLabel(c.source)}`),
  ].join('');
  return `<section class="report" aria-label="Board packet">
    ${renderSectionHeading({ eyebrow: 'Board packet', heading, badge })}
    <div class="grid">${cardsHtml}</div>
    <div class="no-print">
    <p>Prepared from the same bounded reads shown across Church Report, Balance Sheet, and Giving Entry -- no separate board-packet query or writer is used. Each card above independently prefers live Connect data when its own page's live resolver has it, and falls back to the same synthetic fixture, labeled, when it doesn't.</p>
    ${renderSectionHeading({ eyebrow: 'Cover note & export', heading: 'Preparing this for the board', badge: 'Not saved', trend: true })}
    <p>Use Print the board packet below for a combined document with a one-time cover note. There is no saved cover-note editor, template chooser, or publish history yet -- those need real authoring/versioning storage that does not exist in Finance today, so this page shows the packet content itself rather than a save workflow that wouldn't actually save anything.</p>
    <p><a href="/print/board-packet">Print the board packet</a> to choose reports, add a cover note, and get one document with each report on its own page.</p>
    </div>
  </section>`;
}
