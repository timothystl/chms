import { buildSyntheticBoardPacket } from './board-packet-service.js';
import { buildChurchReportView } from './church-report-service.js';
import { formatCents, formatSignedCents, renderKpiCards, renderSectionHeading } from './render-helpers.js';

export function renderPacketPage({ summary, churchReport, churchTrends, giving }) {
  const church = buildChurchReportView(churchReport);
  const packet = buildSyntheticBoardPacket({ summary, churchReport: church, churchTrends, giving });
  return `<section class="report" aria-label="Board packet">
    ${renderSectionHeading({ eyebrow: 'Board packet', heading: `Decision-ready FY${packet.fiscalYear} summary`, badge: packet.ready ? 'Reconciled' : 'Review required' })}
    ${renderKpiCards([
      { label: 'Operating result', value: formatSignedCents(packet.operating.actualNetCents), hint: `Budget ${formatSignedCents(packet.operating.budgetNetCents)} · ${packet.operating.disposition} ${formatSignedCents(packet.operating.varianceCents)}` },
      { label: 'Financial position', value: formatCents(packet.position.netAssetsCents), hint: `Assets ${formatCents(packet.position.assetsCents)} · liabilities ${formatCents(packet.position.liabilitiesCents)}` },
      { label: 'Operating trend', value: formatSignedCents(packet.trend.changeCents), hint: `FY${packet.trend.priorFiscalYear} to FY${packet.trend.currentFiscalYear}` },
      { label: 'Giving evidence', value: formatCents(packet.giving.netCents), hint: `${packet.giving.sourceRecordCount} aggregate records · totals reconcile` },
    ])}
    <p>Prepared from the same bounded synthetic reads shown across Church Report, Balance Sheet, and Giving Entry -- no separate board-packet query or writer is used.</p>
    ${renderSectionHeading({ eyebrow: 'Cover note & export', heading: 'Preparing this for the board', badge: 'Not saved', trend: true })}
    <p>Use your browser's print dialog to export this page as a PDF for the packet. There is no cover-note editor, pinned-report picker, template chooser, or publish history yet -- those need real authoring/versioning storage that does not exist in Finance today, so this page shows the packet content itself rather than a save workflow that wouldn't actually save anything.</p>
  </section>`;
}
