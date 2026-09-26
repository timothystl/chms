import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeBreezeClient, BreezeTimeoutError } from '../src/breeze.js';

const env = { BREEZE_SUBDOMAIN: 'example', BREEZE_API_KEY: 'test-key' };

// A fetch that never resolves unless its AbortSignal fires — models a Breeze call that hangs.
function hangingFetch() {
  return vi.fn((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Breeze client timeouts', () => {
  it('rejects a hanging giving request with a named timeout instead of waiting forever', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const breeze = makeBreezeClient(env, { timeoutMs: 20 });
    const err = await breeze.auditLog({ start: '2026-01-01', end: '2026-09-26', action: 'contribution_added' }).catch(e => e);
    expect(err).toBeInstanceOf(BreezeTimeoutError);
    expect(err.message).toBe('Breeze did not respond within 0s (account/list_log)');
    expect(err.message).not.toContain('test-key');
  });

  it('applies the timeout to writes too', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const breeze = makeBreezeClient(env, { timeoutMs: 20 });
    await expect(breeze.addPerson('A', 'B')).rejects.toThrow('(people/add)');
  });

  it('passes normal responses through unchanged', async () => {
    const res = new Response('[]', { status: 200 });
    const f = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', f);
    const breeze = makeBreezeClient(env);
    expect(await breeze.givingList({ start: '2026-01-01', limit: 5 })).toBe(res);
    expect(f.mock.calls[0][0]).toBe('https://example.breezechms.com/api/giving/list?start=2026-01-01&limit=5');
    expect(f.mock.calls[0][1].headers).toEqual({ 'Api-key': 'test-key' });
    expect(f.mock.calls[0][1].signal).toBeDefined();
  });
});

describe('Breeze giving sync does not fail silently', () => {
  const source = readFileSync(new URL('../src/api-import.js', import.meta.url), 'utf8');
  const sync = source.slice(
    source.indexOf("if (seg === 'import/breeze-giving' && method === 'POST')"),
    source.indexOf("if (seg === 'import/breeze-giving-csv'"),
  );

  it('reports a giving/list failure instead of swallowing it', () => {
    expect(sync).not.toContain('/* giving/list is best-effort');
    expect(sync).toContain('diag.givingListOk = givingListOk');
    expect(sync).toMatch(/catch \(e\) \{ logWarnings\.push\(`giving\/list:/);
  });

  it('skips orphan cleanup when giving/list did not load', () => {
    expect(sync).toContain('const safetyAbort = !givingListOk ||');
  });

  it('returns diagnostics even when nothing was found to import', () => {
    expect(sync).toMatch(/allEntries\.length === 0\) return json\(\{[^}]*\}, diagnostics: diag \}\)/);
  });

  it('the UI shows elapsed time and has a backstop timeout', () => {
    const ui = readFileSync(new URL('../src/frontend/js-export-import.js', import.meta.url), 'utf8');
    expect(ui).toContain('function breezeGivingRequest(');
    expect(ui).toContain('still waiting on Breeze');
    expect(ui).toContain('givingListOk === false');
  });
});
