import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { BOARD_PACKET_ITEMS, printHref } from '../apps/finance/print-pages.js';

// Server-built print versions (Andrew, 2026-09-25): any page with print=1, and the board packet print.

const LIVE_LEDGERS = {
  contract: 'connect.finance-property-ledgers.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  capital: [{ entryDate: '2024-10-07', amountCents: 540000, payee: 'Vail Contracting LLC', description: 'Contracting work', checkRef: '', project: 'Renovation', sortOrder: 1, id: 7 }],
  repairs: [],
  totals: { capitalCents: 540000, repairsCents: 0 },
};

function env({ role = 'admin', permissions = { finance: 'edit', budget: 'edit', compensation: 'view' }, environment = 'staging', roleStatus = 200 } = {}) {
  return {
    ENVIRONMENT: environment, RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/api/contracts/staff-role-v1') {
          return roleStatus === 200 ? new Response(JSON.stringify({ role, permissions })) : new Response('{}', { status: roleStatus });
        }
        if (pathname === '/api/contracts/finance-property-ledgers-v1') return new Response(JSON.stringify(LIVE_LEDGERS));
        return new Response('nf', { status: 404 });
      },
    },
  };
}

const get = async (path, e = env()) => {
  const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' } }), e);
  return { status: res.status, html: await res.text() };
};

describe('printHref', () => {
  it('keeps the page, adds print=1, and drops one-off status parameters', () => {
    expect(printHref(new URLSearchParams('section=property&page=capital&status=ok&message=Saved&edit=4'))).toBe('/?section=property&page=capital&print=1');
  });
});

describe('print version of a page', () => {
  it('offers a Print link in the page head', async () => {
    const { html } = await get('/?section=property&page=capital');
    expect(html).toContain('class="print-link" href="/?section=property&amp;page=capital&amp;print=1"');
  });

  it('renders the report as a print document without the app chrome, hiding forms', async () => {
    const { status, html } = await get('/?section=property&page=capital&print=1');
    expect(status).toBe(200);
    expect(html).toContain('class="print-doc"');
    expect(html).toContain('Timothy Lutheran Church · Finance');
    expect(html).toContain('<h1 class="print-title">Capital improvements</h1>');
    expect(html).toContain('Vail Contracting LLC');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('href="/?section=property&amp;page=capital"');
    expect(html).not.toContain('app-sidebar');
    expect(html).toMatch(/\.print-doc form[^{]*\{ display: none !important; \}/);
    expect(html).toContain('thead { display: table-header-group; }');
  });

  it('still applies the section permission check', async () => {
    const { status } = await get('/?section=compensation&page=council&print=1', env({ role: 'finance', permissions: { finance: 'view' } }));
    expect(status).toBe(403);
  });

  it('returns just the titled fragment when composing', async () => {
    const { html } = await get('/?section=property&page=capital&print=1&fragment=1');
    expect(html.startsWith('<article class="print-section">')).toBe(true);
    expect(html).not.toContain('<!doctype html>');
  });
});

describe('board packet print', () => {
  it('shows a picker limited to reports the viewer may see', async () => {
    const { html } = await get('/print/board-packet', env({ role: 'finance', permissions: { finance: 'view' } }));
    expect(html).toContain('Print the board packet');
    expect(html).toContain('value="church" checked');
    expect(html).not.toContain('value="budget"');
    expect(html).not.toContain('value="council"');
    expect(html).toContain('name="note"');
  });

  it('composes a cover page, the escaped cover note, and each chosen report on a new page', async () => {
    const { status, html } = await get(`/print/board-packet?include=property&note=${encodeURIComponent('Council: <b>see Q3</b>')}`);
    expect(status).toBe(200);
    expect(html).toContain('<h1 class="print-title">Board packet</h1>');
    expect(html).toContain('<div class="print-cover-note">Council: &lt;b&gt;see Q3&lt;/b&gt;</div>');
    const item = BOARD_PACKET_ITEMS.find((entry) => entry.key === 'property');
    expect(html.match(/class="print-newpage"/g)).toHaveLength(item.pages.length);
    expect(html).toContain('Vail Contracting LLC');
    expect(html.match(/<!doctype html>/g)).toHaveLength(1);
  });

  it('ignores reports the viewer may not include', async () => {
    const { html } = await get('/print/board-packet?include=budget', env({ role: 'finance', permissions: { finance: 'view' } }));
    expect(html).toContain('Choose at least one report you have access to.');
  });

  it('refuses when production role verification fails', async () => {
    const { status } = await get('/print/board-packet', env({ environment: 'production', roleStatus: 500 }));
    expect(status).toBe(403);
  });
});
