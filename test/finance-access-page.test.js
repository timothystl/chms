import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import { financeChanges, financeSections } from '../apps/finance/access-pages.js';

const perms = (over) => ({ giving: 'none', tuitionaid: 'none', finance: 'none', compensation: 'none', budget: 'none', directory: 'none', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'none', ...over });
const ROLES = {
  contract: 'connect.finance-access-roles.v1', viewer_role: 'admin', names_included: true,
  items: [{ key: 'giving', label: 'Giving', editable: true }, { key: 'finance', label: 'Finance Overview', editable: true }, { key: 'budget', label: 'Budget', editable: true }],
  roles: [
    { role: 'admin', permissions: perms({ giving: 'edit', finance: 'edit', budget: 'edit', compensation: 'edit' }), people_count: 2, people: ['Business Administrator', 'Pastor Dinger'] },
    { role: 'finance', permissions: perms({ giving: 'edit', finance: 'edit', budget: 'edit', compensation: 'edit' }), people_count: 1, people: ['Treasurer'] },
    { role: 'council', permissions: perms({ giving: 'anon', compensation: 'edit' }), people_count: 0, people: [] },
  ],
};

function makeEnv(body = ROLES, status = 200) {
  const calls = [];
  return {
    calls,
    env: {
      ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: { prepare: (sql) => ({ sql }) }, FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: {
        async fetch(req) {
          const url = new URL(req.url);
          calls.push({ path: url.pathname, jwt: req.headers.get('Cf-Access-Jwt-Assertion') });
          if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role: 'admin', permissions: perms({ finance: 'edit', giving: 'edit' }) }));
          if (url.pathname.endsWith('/finance-access-roles-v1')) return new Response(JSON.stringify(body), { status });
          return new Response('{}', { status: 404 });
        },
      },
    },
  };
}
const get = (env) => worker.fetch(new Request('https://finance.test/?section=accounts&page=access', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);

describe('Access & roles (Finance v3)', () => {
  it('works out what each role can see and change with Finance’s own checks', () => {
    expect(financeSections('admin', {})).toEqual(['Everything']);
    const council = financeSections('council', perms({ giving: 'anon', compensation: 'edit' }));
    expect(council).toContain('Giving');
    expect(council).toContain('Compensation');
    expect(council).not.toContain('Church');
    expect(financeChanges('council', perms({ giving: 'anon', compensation: 'edit' }))).toEqual(['Their own compensation draft']);
    expect(financeChanges('finance', perms({ giving: 'edit', finance: 'edit', budget: 'edit' }))).toEqual(['Gift entry and giving nudges', 'Planning scenarios', 'Facilities records']);
    expect(financeChanges('member', perms({}))).toEqual(['Nothing']);
  });

  it('renders roles, people and the Connect permission matrix live from Connect', async () => {
    const { env, calls } = makeEnv();
    const html = await (await get(env)).text();
    expect(html).toContain('<h1 class="page-title">Access &amp; roles</h1>');
    expect(calls.find((c) => c.path.endsWith('/finance-access-roles-v1'))).toMatchObject({ jwt: 'jwt' });
    expect(html).toContain('Business Administrator, Pastor Dinger');
    expect(html).toContain('<td class="acc-level acc-anon">Totals only</td>');
    expect(html).toContain('href="https://connect.timothystl.org/#settings"');
    expect(html).toContain('<span class="tone-muted">Nobody</span>');
  });

  it('shows counts when Connect withholds names, and Connect’s refusal when it refuses', async () => {
    const countsOnly = { ...ROLES, names_included: false, roles: ROLES.roles.map(({ people, ...r }) => r) };
    const html = await (await get(makeEnv(countsOnly).env)).text();
    expect(html).toContain('2 people');
    expect(html).not.toContain('Pastor Dinger');
    expect(html).toContain('shown to admins only');
    const refused = await (await get(makeEnv({ error: 'Access & roles requires Finance access' }, 403).env)).text();
    expect(refused).toContain('Roles could not be read from Connect: Access &amp; roles requires Finance access');
  });
});
