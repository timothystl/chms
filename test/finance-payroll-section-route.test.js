import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const statements = [];
const baseEnv = {
  ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha',
  FINANCE_DB: { prepare(sql) { statements.push(sql); return { sql }; } },
};

function liveEnv(fetchImpl) {
  return { ...baseEnv, PAYROLL_SERVICE: { fetch: fetchImpl }, FINANCE_PAYROLL_CONTRACT_KEY: 'test-secret' };
}

// A fake Access JWT (unsigned; nothing here verifies it, mirroring the diagnostic route's own
// test convention) so describeIncomingAccessJwt() has a real email to read for p_approved_by.
function fakeAccessJwt(email) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc({ email, iss: 'https://timothystl.cloudflareaccess.com', aud: 'x', exp: 9999999999 })}.sig`;
}
const JWT = fakeAccessJwt('bookkeeper@timothystl.org');

function get(env, path, accessJwt = JWT) {
  return worker.fetch(new Request(`https://finance.test${path}`, {
    headers: accessJwt ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {},
  }), env);
}
function post(env, path, formFields, accessJwt = JWT) {
  const body = new URLSearchParams(formFields);
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(accessJwt ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}) },
    body: body.toString(),
  }), env);
}
// The route handlers redirect with a site-relative Location (matching giving-quick-entry-v1's
// existing convention) -- resolve it against the same origin the request was made to.
function location(res) {
  return new URL(res.headers.get('Location'), 'https://finance.test');
}

const CHURCH_STAFF = [
  { id: 1, name: 'Sarah Salary', role: 'Pastor', pay_type: 'salary', base_salary_biweekly: 2000, hourly_rate: 0, housing_allowance_biweekly: 200, insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0, retirement_403b_type: 'fixed', retirement_403b_amount: 0, active: 1 },
  { id: 2, name: 'James Hourly', role: 'Office', pay_type: 'hourly', hourly_rate: 20, base_salary_biweekly: 0, housing_allowance_biweekly: 0, insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0, retirement_403b_type: 'fixed', retirement_403b_amount: 0, active: 1 },
];

// A routed fetch stub: every payroll_* RPC path maps to a canned response, so a GET or POST
// through the section only ever depends on the query string / form fields under test, not on
// accidentally matching every relay call to the same generic response.
function rpcEnv(overrides = {}) {
  return liveEnv(async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/payroll/email') {
      if (overrides['/payroll/email']) return overrides['/payroll/email'](await req.json().catch(() => ({})));
      return new Response(JSON.stringify({ ok: true, to: 'books@example.com' }), { status: 200 });
    }
    const fn = path.replace('/sb/rest/v1/rpc/', '');
    if (overrides[fn]) return overrides[fn](await req.json().catch(() => ({})));
    if (fn === 'payroll_get_staff') return new Response(JSON.stringify(CHURCH_STAFF), { status: 200 });
    return new Response('[]', { status: 200 });
  });
}

describe('Finance Payroll section — entry view', () => {
  it('appears in the workspace navigation', async () => {
    const res = await get(rpcEnv(), '/?section=payroll');
    const html = await res.text();
    expect(html).toContain('href="/?section=payroll"');
    expect(html).toContain('>Payroll<');
  });

  it('renders the church and MDO roster with an editable hours/PTO form when the period is open', async () => {
    const env = rpcEnv({
      payroll_get_mdo_staff: async () => new Response(JSON.stringify([{ id: 'm1', name: 'Childcare Carla', role: 'Teacher', pay_type: 'hourly', hourly_rate: 15 }]), { status: 200 }),
      payroll_get_mdo_hours: async () => new Response(JSON.stringify([{ staff_id: 'm1', work_date: '2026-06-08', hours_worked: '10' }]), { status: 200 }),
    });
    const res = await get(env, '/?section=payroll&period=2026-06-08');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sarah Salary');
    expect(html).toContain('James Hourly');
    expect(html).toContain('Childcare Carla');
    expect(html).toContain('name="hours_2"');
    expect(html).toContain('name="pto_2"');
    expect(html).not.toContain('name="hours_1"'); // salaried: n/a, no input
    expect(html).toContain('<button type="submit">Save hours</button>');
    expect(html).not.toMatch(/<input[^>]*readonly/);
  });

  it('locks the hours inputs and hides Save hours once the period is approved', async () => {
    const env = rpcEnv({
      payroll_get_period_approval: async () => new Response(JSON.stringify([{ approved_at: '2026-06-15T00:00:00Z', approved_by: 'office@timothystl.org', total_gross_cents: 220000 }]), { status: 200 }),
    });
    const res = await get(env, '/?section=payroll&period=2026-06-08');
    const html = await res.text();
    expect(html).toContain('readonly');
    expect(html).not.toContain('<button type="submit">Save hours</button>');
    expect(html).toContain('Take back approval');
    expect(html).toContain('Approved by office@timothystl.org');
  });

  it('shows a missing-hours confirm banner only when needs_confirm=1 is present', async () => {
    const env = rpcEnv();
    const withoutConfirm = await (await get(env, '/?section=payroll&period=2026-06-08')).text();
    expect(withoutConfirm).not.toContain('Approve the period anyway');
    const withConfirm = await (await get(env, '/?section=payroll&period=2026-06-08&needs_confirm=1')).text();
    expect(withConfirm).toContain('James Hourly'); // the person actually missing hours
    expect(withConfirm).toContain('Approve the period anyway');
  });

  it('shows a status banner from a prior write redirect', async () => {
    const html = await (await get(rpcEnv(), '/?section=payroll&period=2026-06-08&status=saved')).text();
    expect(html).toContain('Hours saved.');
  });

  it('surfaces a church-staff read failure without blanking the whole page', async () => {
    const env = rpcEnv({ payroll_get_staff: async () => new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 }) });
    const html = await (await get(env, '/?section=payroll&period=2026-06-08')).text();
    expect(html).toContain('Church staff could not be read');
  });
});

describe('Finance Payroll section — report view', () => {
  it('excludes a zero-gross person and shows the combined total', async () => {
    const env = rpcEnv({
      payroll_get_period_entries: async () => new Response(JSON.stringify([{ staff_id: 2, hours_worked: 10, pto_hours_used: 0 }]), { status: 200 }),
    });
    const html = await (await get(env, '/?section=payroll&period=2026-06-08&view=report')).text();
    expect(html).toContain('Sarah Salary');
    expect(html).toContain('James Hourly');
    expect(html).toContain('$2,200.00'); // Sarah's own gross: 2000 salary + 200 housing
    expect(html).toMatch(/pay-combined[\s\S]*?\$2,400\.00/); // combined total: 2200 + (10*20)
  });

  it('switches layout via the layout query param', async () => {
    const env = rpcEnv();
    const table = await (await get(env, '/?section=payroll&period=2026-06-08&view=report&layout=table')).text();
    expect(table).toContain('One line each');
    const summary = await (await get(env, '/?section=payroll&period=2026-06-08&view=report&layout=summary')).text();
    expect(summary).toContain('Totals only');
  });

  it('carries a hidden print table built from the same figures', async () => {
    const html = await (await get(rpcEnv(), '/?section=payroll&period=2026-06-08&view=report')).text();
    expect(html).toContain('id="pay-print"');
    expect(html).toContain('Timothy Lutheran — Combined Payroll');
  });
});

describe('Finance Payroll section — staff add/edit view', () => {
  it('renders a blank form for "new"', async () => {
    const html = await (await get(rpcEnv(), '/?section=payroll&view=staff-form&id=new')).text();
    expect(html).toContain('Add a person');
    expect(html).not.toContain('Remove');
  });

  it('prefills an existing person and offers Remove', async () => {
    const html = await (await get(rpcEnv(), '/?section=payroll&view=staff-form&id=2')).text();
    expect(html).toContain('value="James Hourly"');
    expect(html).toContain('value="20"');
    expect(html).toContain('Remove');
  });
});

describe('Finance Payroll writes', () => {
  it('saves hours for every church staff row present in the form, preserving pto_hours_earned', async () => {
    const captured = [];
    const env = rpcEnv({
      payroll_get_period_entries: async () => new Response(JSON.stringify([{ staff_id: 2, hours_worked: 5, pto_hours_used: 0, pto_hours_earned: 3.5 }]), { status: 200 }),
      payroll_save_hours: async (body) => { captured.push(body); return new Response('{}', { status: 200 }); },
    });
    const res = await post(env, '/api/v1/payroll-hours-save', { period: '2026-06-08', hours_2: '12', pto_2: '1' });
    expect(res.status).toBe(303);
    expect(location(res).search).toContain('status=saved');
    expect(captured).toEqual([{ p_staff_id: 2, p_period_start: '2026-06-08', p_hours_worked: 12, p_pto_used: 1, p_pto_earned: 3.5 }]);
  });

  it('redirects with an error status when Website refuses the write (e.g. a locked period)', async () => {
    const env = rpcEnv({ payroll_save_hours: async () => new Response(JSON.stringify({ message: 'This period is approved and locked.' }), { status: 409 }) });
    const res = await post(env, '/api/v1/payroll-hours-save', { period: '2026-06-08', hours_2: '12' });
    const loc = location(res);
    expect(loc.searchParams.get('status')).toBe('error');
    expect(loc.searchParams.get('message')).toContain('locked');
  });

  it('approving with missing hours redirects to a confirm step instead of writing', async () => {
    let approveCalled = false;
    const env = rpcEnv({ payroll_approve_period: async () => { approveCalled = true; return new Response('{}', { status: 200 }); } });
    const res = await post(env, '/api/v1/payroll-period-approve', { period: '2026-06-08', action: 'approve' });
    expect(approveCalled).toBe(false);
    expect(location(res).search).toContain('needs_confirm=1');
  });

  it('approves once confirm_missing=1 is present, freezing the total from the live figures', async () => {
    let captured;
    const env = rpcEnv({
      payroll_get_period_entries: async () => new Response(JSON.stringify([{ staff_id: 2, hours_worked: 10, pto_hours_used: 0 }]), { status: 200 }),
      payroll_approve_period: async (body) => { captured = body; return new Response('{}', { status: 200 }); },
    });
    const res = await post(env, '/api/v1/payroll-period-approve', { period: '2026-06-08', action: 'approve', confirm_missing: '1' });
    expect(location(res).search).toContain('status=approved');
    expect(captured.p_period_start).toBe('2026-06-08');
    expect(captured.p_approved_by).toBe('bookkeeper@timothystl.org');
    expect(captured.p_total_gross_cents).toBe(240000); // (2000 salary + 200 housing) + 10*20 hourly, in cents
  });

  it('unapproving requires confirm_unapprove=1 and is a no-op without it', async () => {
    let called = false;
    const env = rpcEnv({
      payroll_get_period_approval: async () => new Response(JSON.stringify([{ approved_at: '2026-06-15T00:00:00Z', approved_by: 'x' }]), { status: 200 }),
      payroll_unapprove_period: async () => { called = true; return new Response('{}', { status: 200 }); },
    });
    const res = await post(env, '/api/v1/payroll-period-approve', { period: '2026-06-08', action: 'unapprove' });
    expect(called).toBe(false);
    expect(res.status).toBe(303);
  });

  it('unapproves once confirmed', async () => {
    let called = false;
    const env = rpcEnv({
      payroll_get_period_approval: async () => new Response(JSON.stringify([{ approved_at: '2026-06-15T00:00:00Z', approved_by: 'x' }]), { status: 200 }),
      payroll_unapprove_period: async () => { called = true; return new Response('{}', { status: 200 }); },
    });
    const res = await post(env, '/api/v1/payroll-period-approve', { period: '2026-06-08', action: 'unapprove', confirm_unapprove: '1' });
    expect(called).toBe(true);
    expect(location(res).search).toContain('status=unapproved');
  });

  it('saves a new church staff person and redirects to the roster', async () => {
    let captured;
    const env = rpcEnv({ payroll_save_staff: async (body) => { captured = body; return new Response('{}', { status: 200 }); } });
    const res = await post(env, '/api/v1/payroll-staff-save', {
      id: '', name: 'New Person', role: 'Custodian', pay_type: 'hourly', hourly_rate: '18.5',
      housing_allowance_biweekly: '', retirement_403b_type: 'fixed', retirement_403b_amount: '',
    });
    expect(location(res).search).toContain('status=staff_saved');
    expect(captured.p_name).toBe('New Person');
    expect(captured.p_pay_type).toBe('hourly');
    expect(captured.p_hourly_rate).toBe(18.5);
    expect(captured.p_base_salary_biweekly).toBe(0);
  });

  it('rejects a blank name without calling the relay', async () => {
    let called = false;
    const env = rpcEnv({ payroll_save_staff: async () => { called = true; return new Response('{}', { status: 200 }); } });
    const res = await post(env, '/api/v1/payroll-staff-save', { id: '', name: '  ', pay_type: 'salary' });
    expect(called).toBe(false);
    const loc = location(res);
    expect(loc.searchParams.get('status')).toBe('error');
    expect(loc.pathname + loc.search).toContain('view=staff-form');
  });

  it('deactivates a church staff person', async () => {
    let captured;
    const env = rpcEnv({ payroll_deactivate_staff: async (body) => { captured = body; return new Response('{}', { status: 200 }); } });
    const res = await post(env, '/api/v1/payroll-staff-deactivate', { id: '2', confirm: '1' });
    expect(location(res).search).toContain('status=staff_removed');
    expect(captured.p_id).toBe('2');
  });
});

describe('Finance Payroll CSV export', () => {
  it('downloads a CSV attachment with the expected columns and total', async () => {
    const env = rpcEnv({
      payroll_get_period_entries: async () => new Response(JSON.stringify([{ staff_id: 2, hours_worked: 10, pto_hours_used: 0 }]), { status: 200 }),
    });
    const res = await get(env, '/api/v1/payroll-csv?period=2026-06-08');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('payroll-2026-06-08.csv');
    const csv = await res.text();
    expect(csv).toContain('Church Staff');
    expect(csv).toContain('Sarah Salary');
    expect(csv).toContain('James Hourly');
    expect(csv).toContain('TOTAL GROSS PAY');
    expect(csv).toContain('"2400.00"'); // (2000 salary + 200 housing) + 10*20 hourly
  });
});

describe('Finance Payroll email relay', () => {
  it('relays to Website\'s /payroll/email with the same shape exportReport() produces', async () => {
    let captured;
    const env = rpcEnv({
      payroll_get_period_entries: async () => new Response(JSON.stringify([{ staff_id: 2, hours_worked: 10, pto_hours_used: 0 }]), { status: 200 }),
      payroll_get_period_approval: async () => new Response(JSON.stringify([{ approved_at: '2026-06-15T00:00:00Z', approved_by: 'bookkeeper@timothystl.org' }]), { status: 200 }),
      '/payroll/email': async (body) => { captured = body; return new Response(JSON.stringify({ ok: true, to: 'books@example.com' }), { status: 200 }); },
    });
    const res = await post(env, '/api/v1/payroll-email', { period: '2026-06-08' });
    expect(location(res).search).toContain('status=emailed');
    expect(location(res).search).toContain('to=books%40example.com');
    expect(captured.periodStart).toBe('2026-06-08');
    expect(captured.approved).toBe(true);
    expect(captured.approvedBy).toBe('bookkeeper@timothystl.org');
    expect(captured.total).toBe(2400);
    expect(captured.church.rows.map((r) => r.name)).toEqual(['Sarah Salary', 'James Hourly']);
    expect(captured.force).toBe(false);
  });

  it('surfaces an already_sent answer as a confirm banner, not an error', async () => {
    const env = rpcEnv({
      '/payroll/email': async () => new Response(JSON.stringify({ already_sent: true, last_sent_at: '2026-06-08T10:00:00Z', last_sent_to: 'books@example.com' }), { status: 200 }),
    });
    const res = await post(env, '/api/v1/payroll-email', { period: '2026-06-08' });
    const loc = location(res);
    expect(loc.searchParams.get('status')).toBe('already_sent');
    expect(loc.searchParams.get('to')).toBe('books@example.com');
    const html = await (await get(env, loc.pathname + loc.search)).text();
    expect(html).toContain('already emailed to books@example.com');
    expect(html).toContain('Send it again');
    expect(html).not.toMatch(/<p class="status status-error"/);
  });

  it('a confirmed resend carries force=1 through to the relay', async () => {
    let captured;
    const env = rpcEnv({ '/payroll/email': async (body) => { captured = body; return new Response(JSON.stringify({ ok: true, to: 'books@example.com' }), { status: 200 }); } });
    await post(env, '/api/v1/payroll-email', { period: '2026-06-08', force: '1' });
    expect(captured.force).toBe(true);
  });

  it('redirects with an error status when Website refuses the relay', async () => {
    const env = rpcEnv({ '/payroll/email': async () => new Response(JSON.stringify({ error: 'No bookkeeper address is set.' }), { status: 400 }) });
    const res = await post(env, '/api/v1/payroll-email', { period: '2026-06-08' });
    const loc = location(res);
    expect(loc.searchParams.get('status')).toBe('error');
    expect(loc.searchParams.get('message')).toContain('bookkeeper address');
  });
});
