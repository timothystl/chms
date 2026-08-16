import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleEsvPassage } from '../src/api-scheduler.js';

// The Worker-side ESV proxy. It exists so Crossway's API key stays on the
// server: the embedded scheduler runs under CSP connect-src 'self', which
// blocks a browser call to api.esv.org outright, and a client-side key would
// be readable by anyone with the page open.
//
// Crossway's terms (api.esv.org): free for non-commercial personal, church and
// ministry use; the text MAY be redistributed by email; 500 verses per query;
// 5,000 queries/day, 1,000/hour, 60/minute. Attribution is three things —
// "(ESV)" with each quotation, the full notice somewhere, and a link to
// www.esv.org. The first is requested here; the other two are the email's job.

const call = (env, q) =>
  handleEsvPassage({}, env, new URL('https://connect.timothystl.org/esv/passage?q=' + encodeURIComponent(q || '')));

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(impl) {
  const calls = [];
  vi.stubGlobal('fetch', (url, init) => { calls.push({ url: String(url), init }); return impl(String(url), init); });
  return calls;
}

const okResponse = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
});

describe('ESV passage proxy', () => {
  it('reports "not configured" rather than failing when no key is set', async () => {
    const calls = stubFetch(() => okResponse({}));
    const res = await call({}, 'Isaiah 2:1-5');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.configured).toBe(false);
    expect(body.passages).toEqual([]);
    // Never reaches the network — the caller just keeps using a link.
    expect(calls).toHaveLength(0);
  });

  it('sends the key as a header, never in the URL', async () => {
    const calls = stubFetch(() => okResponse({ passages: ['the words'], query: 'Isaiah 2:1-5' }));
    await call({ ESV_API_KEY: 'secret-key' }, 'Isaiah 2:1-5');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain('secret-key');
    expect(calls[0].init.headers.Authorization).toBe('Token secret-key');
  });

  it('calls the v3 text endpoint with the reference asked for', async () => {
    const calls = stubFetch(() => okResponse({ passages: ['x'] }));
    await call({ ESV_API_KEY: 'k' }, 'Romans 13:11-14');
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe('https://api.esv.org/v3/passage/text/');
    expect(u.searchParams.get('q')).toBe('Romans 13:11-14');
  });

  it('asks for the short copyright, which is the "(ESV)" on each quotation', async () => {
    const calls = stubFetch(() => okResponse({ passages: ['x'] }));
    await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5');
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('include-short-copyright')).toBe('true');
    // The FULL notice is printed once per email by the caller instead — asking
    // the API for it would repeat it after every passage.
    expect(u.searchParams.get('include-copyright')).toBe('false');
  });

  it('asks for verse numbers and headings, and drops footnote callouts', async () => {
    const calls = stubFetch(() => okResponse({ passages: ['x'] }));
    await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5');
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('include-verse-numbers')).toBe('true');
    expect(u.searchParams.get('include-headings')).toBe('true');
    // Callouts with no footnote text behind them are just noise in an email.
    expect(u.searchParams.get('include-footnotes')).toBe('false');
    // The email prints its own "OT: Isaiah 2:1-5" header.
    expect(u.searchParams.get('include-passage-references')).toBe('false');
  });

  it('returns the passages the API gave', async () => {
    stubFetch(() => okResponse({ passages: ['[1] The word that Isaiah...'], query: 'Isaiah 2:1-5' }));
    const body = await (await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5')).json();
    expect(body.configured).toBe(true);
    expect(body.passages).toEqual(['[1] The word that Isaiah...']);
    expect(body.query).toBe('Isaiah 2:1-5');
  });

  it('rejects an empty reference instead of querying for nothing', async () => {
    const calls = stubFetch(() => okResponse({}));
    const res = await call({ ESV_API_KEY: 'k' }, '');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects an absurdly long reference rather than forwarding it', async () => {
    const calls = stubFetch(() => okResponse({}));
    const res = await call({ ESV_API_KEY: 'k' }, 'x'.repeat(500));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a bad key as 401 rather than pretending it worked', async () => {
    stubFetch(() => Promise.resolve({
      ok: false, status: 401, json: () => Promise.resolve({ detail: 'Invalid API key' }),
    }));
    const res = await call({ ESV_API_KEY: 'wrong' }, 'Isaiah 2:1-5');
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toContain('Invalid API key');
  });

  it('surfaces an API error without claiming a passage', async () => {
    stubFetch(() => Promise.resolve({
      ok: false, status: 400, json: () => Promise.resolve({ detail: 'No results for x' }),
    }));
    const res = await call({ ESV_API_KEY: 'k' }, 'Hezekiah 4:12');
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toContain('No results');
    expect(body.passages).toBeUndefined();
  });

  it('turns a network failure into a 502, not an unhandled throw', async () => {
    stubFetch(() => Promise.reject(new Error('connect ETIMEDOUT')));
    const res = await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5');
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toContain('ETIMEDOUT');
  });

  it('survives a non-JSON response body', async () => {
    stubFetch(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.reject(new Error('not json')),
    }));
    const res = await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5');
    expect(res.status).toBe(502);
  });

  it('does not store the text — nothing is cached on our side', async () => {
    // Crossway does not document a caching allowance, and a church sending a
    // couple of dozen assignment emails a week is far under 5,000/day, so
    // there is nothing to buy by keeping their text. Two identical calls must
    // both reach the API rather than one being served from a store.
    const calls = stubFetch(() => okResponse({ passages: ['x'] }));
    await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5');
    await call({ ESV_API_KEY: 'k' }, 'Isaiah 2:1-5');
    expect(calls).toHaveLength(2);
  });
});
