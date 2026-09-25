import { describe, expect, it } from 'vitest';
import { collapseDuplicateHeading, identityInitials, roleLabel } from '../apps/finance/shell-layout.js';
import { renderSectionHeading } from '../apps/finance/render-helpers.js';

describe('Finance v3 shell layout helpers', () => {
  it('drops an opening heading that only repeats the page title, keeping its source badge', () => {
    const body = `<section class="report">${renderSectionHeading({ eyebrow: 'Gift entry', heading: 'Record a gift', badge: 'Relayed live to Connect' })}<p>Form</p></section>`;
    const out = collapseDuplicateHeading(body, 'Record a gift');
    expect(out).not.toContain('<h2>Record a gift</h2>');
    expect(out).toContain('<div class="source-tag"><span class="badge">Relayed live to Connect</span></div>');
    expect(out).toContain('<p>Form</p>');
  });

  it('leaves distinct or later headings alone', () => {
    const distinct = renderSectionHeading({ eyebrow: 'Church report', heading: 'Multi-year operating trend' });
    expect(collapseDuplicateHeading(distinct, 'Multi-year trend')).toBe(distinct);
    const later = `<h2>Intro</h2>${renderSectionHeading({ eyebrow: 'x', heading: 'Plan' })}`;
    expect(collapseDuplicateHeading(later, 'Plan')).toBe(later);
    const amp = renderSectionHeading({ eyebrow: 'x', heading: 'Income &amp; expense detail' });
    expect(collapseDuplicateHeading(amp, 'Income & expense detail')).toBe('');
  });

  it('derives initials and role labels without guessing names', () => {
    expect(identityInitials('mark.keller@example.org')).toBe('MK');
    expect(identityInitials('office@example.com')).toBe('OF');
    expect(identityInitials('')).toBe('');
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel(null)).toBe('Unverified');
  });
});
