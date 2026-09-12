import { describe, expect, it } from 'vitest';
import {
  escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable, renderUnavailablePage,
} from '../apps/finance/render-helpers.js';

describe('Finance shared render helpers', () => {
  it('formats cents as whole-dollar currency, signed cents with a real minus sign', () => {
    expect(formatCents(150000)).toBe('$1,500');
    expect(formatSignedCents(150000)).toBe('$1,500');
    expect(formatSignedCents(-150000)).toBe('−$1,500');
  });

  it('escapes the five HTML-significant characters and leaves everything else alone', () => {
    expect(escapeHtml(`<a href="x">O'Brien & Sons</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Sons&lt;/a&gt;');
  });

  it('renders KPI cards with an optional hint', () => {
    const html = renderKpiCards([
      { label: 'Total accounts', value: '12' },
      { label: 'Net result', value: '$1,000', hint: 'Budget $900' },
    ]);
    expect(html).toContain('<small>Total accounts</small><strong>12</strong>');
    expect(html).not.toContain('<span></span>');
    expect(html).toContain('<strong>$1,000</strong><span>Budget $900</span>');
  });

  it('renders a section heading with and without a badge or trend styling', () => {
    expect(renderSectionHeading({ eyebrow: 'Group', heading: 'Title', badge: 'Live' }))
      .toBe('<div class="section-heading"><div><div class="eyebrow">Group</div><h2>Title</h2></div><span class="badge">Live</span></div>');
    expect(renderSectionHeading({ eyebrow: 'Group', heading: 'Title', trend: true }))
      .toBe('<div class="section-heading trend-heading"><div><div class="eyebrow">Group</div><h2>Title</h2></div></div>');
  });

  it('renders a table from a head row and pre-built body rows', () => {
    const html = renderTable({ head: ['A', 'B'], rows: '<tr><td>1</td><td>2</td></tr>' });
    expect(html).toBe('<div class="table-wrap"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>');
  });

  it('renders an unavailable page with the badge and the given reason, escaping the heading', () => {
    const html = renderUnavailablePage({ eyebrow: 'Group', heading: 'Pledges', reason: 'No pledge table exists yet.' });
    expect(html).toContain('aria-label="Pledges (not yet available)"');
    expect(html).toContain('<span class="badge">Not yet available</span>');
    expect(html).toContain('No pledge table exists yet.');
  });
});
