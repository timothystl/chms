import { describe, it, expect } from 'vitest';
import { sanitizeLetterTemplateHtml, logoSizeWarning, LOGO_WARN_BYTES } from '../src/api-utils.js';

const B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const DATA_URI = 'data:image/jpeg;base64,' + B64;

describe('sanitizeLetterTemplateHtml', () => {
  it('returns unchanged text unmodified', () => {
    const html = '<p>Dear {{name}},</p><p>Thank you.</p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(cleaned).toBe(html);
    expect(changed).toBe(false);
  });

  it('handles empty/null input', () => {
    expect(sanitizeLetterTemplateHtml('')).toEqual({ cleaned: '', changed: false });
    expect(sanitizeLetterTemplateHtml(null)).toEqual({ cleaned: null, changed: false });
    expect(sanitizeLetterTemplateHtml(undefined)).toEqual({ cleaned: undefined, changed: false });
  });

  it('strips a base64 image dropped into the Link dialog (the exact reported bug)', () => {
    // Reproduces the live report: an image URI pasted into Insert Link instead of
    // Insert Image renders as <a href="data:...">data:...</a> — the whole payload
    // shows as literal visible link text in the sent email.
    const html = '<p>In Christ,</p><p>Timothy Lutheran Church</p><p><a href="' + DATA_URI + '">' + DATA_URI + '</a></p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(changed).toBe(true);
    expect(cleaned).not.toContain('base64');
    expect(cleaned).toBe('<p>In Christ,</p><p>Timothy Lutheran Church</p><p></p>');
  });

  it('strips a bare base64 string pasted as plain text with no wrapping tag', () => {
    const html = '<p>Thank you.</p><p>' + DATA_URI + '</p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(changed).toBe(true);
    expect(cleaned).toBe('<p>Thank you.</p><p></p>');
  });

  it('leaves a real <img src="data:..."> (inserted via the toolbar file picker) untouched', () => {
    const html = '<p>Header</p><img src="' + DATA_URI + '" alt="Logo"><p>Body</p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(changed).toBe(false);
    expect(cleaned).toBe(html);
  });

  it('strips a stray pasted base64 string while leaving a real embedded <img> alone', () => {
    const html = '<img src="' + DATA_URI + '" alt="Logo"><p>Signed,</p><p>' + DATA_URI + '</p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(changed).toBe(true);
    expect(cleaned).toContain('<img src="' + DATA_URI + '"');
    expect(cleaned).toBe('<img src="' + DATA_URI + '" alt="Logo"><p>Signed,</p><p></p>');
  });

  it('does not touch a normal http(s) link', () => {
    const html = '<p><a href="http://www.timothystl.org/give">give online</a></p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(changed).toBe(false);
    expect(cleaned).toBe(html);
  });

  it('does not false-positive on a short data: URI under the length threshold', () => {
    const html = '<p>data:text/plain,short</p>';
    const { cleaned, changed } = sanitizeLetterTemplateHtml(html);
    expect(changed).toBe(false);
    expect(cleaned).toBe(html);
  });
});

describe('logoSizeWarning', () => {
  it('returns empty for a small file', () => {
    expect(logoSizeWarning(50 * 1024)).toBe('');
  });

  it('returns empty for exactly the threshold', () => {
    expect(logoSizeWarning(LOGO_WARN_BYTES)).toBe('');
  });

  it('returns empty for falsy input', () => {
    expect(logoSizeWarning(0)).toBe('');
    expect(logoSizeWarning(null)).toBe('');
    expect(logoSizeWarning(undefined)).toBe('');
  });

  it('warns above the threshold, with the size in MB and the threshold in KB', () => {
    const warning = logoSizeWarning(2.5 * 1024 * 1024);
    expect(warning).toContain('2.5 MB');
    expect(warning).toContain(String(Math.round(LOGO_WARN_BYTES / 1024)) + ' KB');
    expect(warning.toLowerCase()).toContain('email');
  });
});
