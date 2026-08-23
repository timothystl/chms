import { describe, it, expect } from 'vitest';
import { CHMS_HTML, chmsHtmlForRole } from '../src/html-chms.js';

// P25-F. The served shell never closed </body></html> (harmless — browsers auto-close — but not
// what the served bytes should say), and its script tags carried no `defer` (blocking the parser
// at the point they appear, even though they already sit at the very end of the document, right
// before the eventual </body>).
describe('P25-F: the shell closes its own tags and defers its scripts', () => {
  it('closes </body></html> for every role', () => {
    for (const role of ['admin', 'finance', 'staff', 'council', 'member', null, undefined, 'future-role']) {
      const html = chmsHtmlForRole(role);
      expect(html.trimEnd().endsWith('</html>'), String(role)).toBe(true);
      expect(html, String(role)).toContain('</body>');
      // </body> must come before </html>, not after.
      expect(html.indexOf('</body>'), String(role)).toBeLessThan(html.lastIndexOf('</html>'));
    }
  });

  it('never emits a second </body> or </html> — the shell itself must not already have one', () => {
    // If HTML_HEAD/HTML_TABS ever grew their own closing tags, appending ours would duplicate
    // them rather than fixing anything.
    expect((CHMS_HTML.match(/<\/body>/g) || []).length).toBe(1);
    expect((CHMS_HTML.match(/<\/html>/g) || []).length).toBe(1);
  });

  it('marks every app bundle script tag defer', () => {
    for (const role of ['admin', 'member']) {
      const tags = chmsHtmlForRole(role).match(/<script src="\/admin\/app-[a-z]+\.js[^>]*><\/script>/g) || [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, tag).toMatch(/\sdefer(\s|>)/);
    }
  });
});
