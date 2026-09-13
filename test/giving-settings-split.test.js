import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleImportApi } from '../src/api-import.js';

// config/church and config/giving-impact read/write a mix of genuinely-shared chms_config keys
// (church_ein, church_name, ...) and Giving-domain keys now split into their own giving_settings
// table (see migrateNonFinanceSettingsFromConfig in src/db.js). This proves the split is
// transparent to callers: the same response shape, keyed the same way, regardless of which
// table a given field actually lives in.

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  raw.exec(`CREATE TABLE giving_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return {
    prepare(sql) {
      const st = raw.prepare(sql);
      let binds = [];
      const api = {
        bind(...a) { binds = a; return api; },
        all() { return Promise.resolve({ results: st.all(...binds) }); },
        first() { return Promise.resolve(st.get(...binds) ?? null); },
        run() { const r = st.run(...binds); return Promise.resolve({ meta: { last_row_id: r.lastInsertRowid, changes: r.changes } }); },
      };
      return api;
    },
    _raw: raw,
  };
}

const ADMIN = [true, false, false, false];

describe('config/church reads and writes span chms_config and giving_settings transparently', () => {
  it('PUT saves shared fields to chms_config and Giving fields to giving_settings', async () => {
    const db = makeDb();
    const body = {
      church_name: 'Timothy Lutheran Church',
      giving_letter_template: '<p>Dear {{name}}</p>',
      online_giving_url: 'https://give.example.org',
    };
    const req = { json: async () => body };
    const res = await handleImportApi(req, {}, new URL('http://x/config/church'), 'PUT', 'config/church', db, ...ADMIN);
    expect(res.status).toBe(200);

    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='church_name'").get().value).toBe('Timothy Lutheran Church');
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='giving_letter_template'").get()).toBeUndefined();

    expect(db._raw.prepare("SELECT value FROM giving_settings WHERE key='giving_letter_template'").get().value).toBe('<p>Dear {{name}}</p>');
    expect(db._raw.prepare("SELECT value FROM giving_settings WHERE key='online_giving_url'").get().value).toBe('https://give.example.org');
  });

  it('GET merges both tables into one flat config object', async () => {
    const db = makeDb();
    db._raw.prepare("INSERT INTO chms_config (key,value) VALUES ('church_name',?)").run('Timothy Lutheran Church');
    db._raw.prepare("INSERT INTO giving_settings (key,value) VALUES ('online_giving_url',?)").run('https://give.example.org');

    const res = await handleImportApi({}, {}, new URL('http://x/config/church'), 'GET', 'config/church', db, ...ADMIN);
    const body = await res.json();
    expect(body.church_name).toBe('Timothy Lutheran Church');
    expect(body.online_giving_url).toBe('https://give.example.org');
  });

  it('the stale-template self-heal reads and writes giving_settings, not chms_config', async () => {
    const db = makeDb();
    const OLD_DEFAULT = 'Dear {{name}},\n\nThank you for your generous contributions to Timothy Lutheran Church during {{year}}. Your gifts make a difference in our ministry and community.\n\nBelow is a summary of your giving for {{year}}:\n\n{{gift_table}}\n\nTotal Contributions: {{total}}\n\n{{#if_ein}}Our EIN/Tax ID is {{ein}}. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.{{/if_ein}}\n\nWith gratitude,\n\nTimothy Lutheran Church\n\nDate: {{date}}';
    db._raw.prepare("INSERT INTO giving_settings (key,value) VALUES ('giving_letter_template',?)").run(OLD_DEFAULT);

    const res = await handleImportApi({}, {}, new URL('http://x/config/church'), 'GET', 'config/church', db, ...ADMIN);
    const body = await res.json();
    expect(body.giving_letter_template).not.toBe(OLD_DEFAULT);
    expect(body.giving_letter_template).toContain('<p>Dear {{name}},</p>');
    // Persisted back, so this only heals once.
    expect(db._raw.prepare("SELECT value FROM giving_settings WHERE key='giving_letter_template'").get().value)
      .toBe(body.giving_letter_template);
  });
});

describe('config/giving-impact reads and writes giving_settings', () => {
  it('PUT saves to giving_settings, not chms_config', async () => {
    const db = makeDb();
    const req = { json: async () => ({ statements: [{ monthly_cents: 5000, label: 'feeds a family for a week' }] }) };
    const res = await handleImportApi(req, {}, new URL('http://x/config/giving-impact'), 'PUT', 'config/giving-impact', db, ...ADMIN);
    expect(res.status).toBe(200);

    const row = db._raw.prepare("SELECT value FROM giving_settings WHERE key='giving_impact_statements_json'").get();
    expect(row).toBeTruthy();
    expect(JSON.parse(row.value)).toEqual([{ monthly_cents: 5000, label: 'feeds a family for a week' }]);
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='giving_impact_statements_json'").get()).toBeUndefined();
  });

  it('GET reads back what PUT saved', async () => {
    const db = makeDb();
    db._raw.prepare("INSERT INTO giving_settings (key,value) VALUES ('giving_impact_statements_json',?)")
      .run(JSON.stringify([{ monthly_cents: 2500, label: 'a meal' }]));
    const res = await handleImportApi({}, {}, new URL('http://x/config/giving-impact'), 'GET', 'config/giving-impact', db, ...ADMIN);
    const body = await res.json();
    expect(body.statements).toEqual([{ monthly_cents: 2500, label: 'a meal' }]);
  });
});
