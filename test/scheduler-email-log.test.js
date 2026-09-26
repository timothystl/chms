import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleSchedEmailSend, handleSchedEmailLog, handleSchedEmailLogStatus } from '../src/api-scheduler.js';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// A volunteer said they never get Scheduler emails, and nothing in Connect could say whether
// one had gone out. /email/send now writes one row per email to scheduler_email_log, and
// /email/log/status asks Resend for that email's latest delivery event.

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0058_scheduler_email_log.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => stmt(sql), _raw: sqlite };
}

const ENV = () => ({ RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Timothy <noreply@example.org>', DB: makeDb() });
const post = (path, body) => new Request('https://connect.example.org' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

let outbound, reply, realFetch;
beforeEach(() => {
  outbound = [];
  reply = () => new Response(JSON.stringify({ id: 'resend-123' }), { status: 200 });
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { outbound.push({ url: String(u), init: o || {} }); return reply(String(u), o); };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('scheduler email log', () => {
  it('records each accepted send with both recipients and never forwards the log fields to Resend', async () => {
    const env = ENV();
    const r = await handleSchedEmailSend(post('/email/send', {
      to: ['kid@example.org', 'parent@example.org'], subject: 'Reminder', text: 'secret body',
      log_kind: 'reminder', log_name: 'Sam Volunteer',
    }), env);
    expect(r.status).toBe(200);
    const sent = JSON.parse(outbound[0].init.body);
    expect(sent.log_kind).toBeUndefined();
    expect(sent.log_name).toBeUndefined();

    const row = env.DB._raw.prepare('SELECT * FROM scheduler_email_log').get();
    expect(row.recipients).toBe('kid@example.org, parent@example.org');
    expect(row.volunteer_name).toBe('Sam Volunteer');
    expect(row.kind).toBe('reminder');
    expect(row.accepted).toBe(1);
    expect(row.resend_id).toBe('resend-123');
    // The message body is never stored.
    expect(JSON.stringify(row)).not.toContain('secret body');
  });

  it('records a rejected send with Resend\'s reason', async () => {
    const env = ENV();
    reply = () => new Response(JSON.stringify({ name: 'validation_error', message: 'Invalid `to` field' }), { status: 422 });
    const r = await handleSchedEmailSend(post('/email/send', { to: 'bad', subject: 's', text: 't' }), env);
    expect(r.status).toBe(422);
    const row = env.DB._raw.prepare('SELECT * FROM scheduler_email_log').get();
    expect(row.accepted).toBe(0);
    expect(row.error).toBe('Invalid `to` field');
  });

  it('searches by recipient or name', async () => {
    const env = ENV();
    await handleSchedEmailSend(post('/email/send', { to: 'a@example.org', subject: 's', log_name: 'Ann' }), env);
    await handleSchedEmailSend(post('/email/send', { to: 'b@example.org', subject: 's', log_name: 'Bob' }), env);
    const byEmail = await (await handleSchedEmailLog(env, new URL('https://x/email/log?q=B@EXAMPLE'))).json();
    expect(byEmail.rows.map((x) => x.volunteer_name)).toEqual(['Bob']);
    const byName = await (await handleSchedEmailLog(env, new URL('https://x/email/log?q=ann'))).json();
    expect(byName.rows.map((x) => x.recipients)).toEqual(['a@example.org']);
  });

  it('stores Resend\'s last delivery event when checked', async () => {
    const env = ENV();
    await handleSchedEmailSend(post('/email/send', { to: 'a@example.org', subject: 's' }), env);
    reply = () => new Response(JSON.stringify({ id: 'resend-123', last_event: 'bounced' }), { status: 200 });
    const body = await (await handleSchedEmailLogStatus(post('/email/log/status', { id: 1 }), env)).json();
    expect(outbound[1].url).toBe('https://api.resend.com/emails/resend-123');
    expect(body.delivery_status).toBe('bounced');
    expect(env.DB._raw.prepare('SELECT delivery_status FROM scheduler_email_log').get().delivery_status).toBe('bounced');
  });

  it('reports a send-only Resend key as restricted rather than as a failure', async () => {
    const env = ENV();
    await handleSchedEmailSend(post('/email/send', { to: 'a@example.org', subject: 's' }), env);
    reply = () => new Response(JSON.stringify({ name: 'restricted_api_key' }), { status: 401 });
    const body = await (await handleSchedEmailLogStatus(post('/email/log/status', { id: 1 }), env)).json();
    expect(body.error).toBe('restricted_key');
  });

  it('every Scheduler send site labels its email for the log', () => {
    const js = SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
    const sends = js.split("'/email/send'").length - 1;
    const kinds = (js.match(/log_kind:\s*'/g) || []).length;
    expect(sends).toBeGreaterThan(0);
    expect(kinds).toBe(sends);
  });
});
