import { describe, it, expect } from 'vitest';
import { isConnectHost, appRootPath, CONNECT_HOST } from '../src/auth.js';

// Regression coverage for the post-login redirect bug (reported 2026-08-03):
// handleAdminLogin hardcoded `Location: '/chms'`, the pre-CONN6 path. On
// connect.timothystl.org the app is served at the ROOT, so every successful login
// bounced the user to /chms — which still works, so nothing errored, but it meant
// /chms was what accumulated in everyone's history and bookmarks and the bare
// domain never stuck.

describe('isConnectHost', () => {
  it('is true for the Connect hostname', () => {
    expect(isConnectHost('https://connect.timothystl.org/')).toBe(true);
    expect(isConnectHost('https://connect.timothystl.org/chms')).toBe(true);
  });

  it('is false for the legacy, public, and staging hostnames', () => {
    expect(isConnectHost('https://chms.timothystl.org/')).toBe(false);
    expect(isConnectHost('https://serve.timothystl.org/')).toBe(false);
    expect(isConnectHost('https://tlc-chms.workers.dev/chms')).toBe(false);
  });

  it('does not match a lookalike host that merely ends with the Connect hostname', () => {
    expect(isConnectHost('https://evilconnect.timothystl.org/')).toBe(false);
    expect(isConnectHost('https://connect.timothystl.org.example.com/')).toBe(false);
  });

  it('accepts a Request-like object and a URL, not just a string', () => {
    expect(isConnectHost({ url: 'https://connect.timothystl.org/' })).toBe(true);
    expect(isConnectHost(new URL('https://connect.timothystl.org/'))).toBe(true);
    expect(isConnectHost({ url: 'https://serve.timothystl.org/' })).toBe(false);
  });

  it('returns false rather than throwing on unparseable input', () => {
    expect(isConnectHost('not a url')).toBe(false);
    expect(isConnectHost({})).toBe(false);
    expect(isConnectHost(null)).toBe(false);
  });

  it('ignores port and path when matching the host', () => {
    expect(isConnectHost('https://connect.timothystl.org:443/admin/api/me')).toBe(true);
  });
});

describe('appRootPath', () => {
  // The actual bug: this returned '/chms' on Connect.
  it('is the root path on Connect, where the app is served at /', () => {
    expect(appRootPath('https://connect.timothystl.org/')).toBe('/');
    expect(appRootPath({ url: 'https://' + CONNECT_HOST + '/admin' })).toBe('/');
  });

  it('is /chms on every other host, where the app is served under that path', () => {
    expect(appRootPath('https://tlc-chms.workers.dev/admin')).toBe('/chms');
    expect(appRootPath('https://serve.timothystl.org/admin')).toBe('/chms');
  });

  it('falls back to /chms on unparseable input rather than throwing mid-login', () => {
    expect(appRootPath('not a url')).toBe('/chms');
  });
});
