import { describe, expect, it, vi } from 'vitest';

// DOMParser is a browser API not available in Node. Stub it so parseOGFromHTML
// can decode HTML entities during unit tests.
vi.hoisted(() => {
  class MockDOMParser {
    parseFromString(html: string, _type: string) {
      const match = /<textarea>([^]*)<\/textarea>/i.exec(html);
      const value = match?.[1] ?? '';
      // Decode common HTML entities to match DOMParser behaviour
      const decoded = value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return {
        querySelector: (_sel: string) => ({ value: decoded, textContent: decoded }),
      };
    }
  }
  (globalThis as any).DOMParser = MockDOMParser;
});
import {
  domainLabel,
  externalLinkFallback,
  extractExternalUrls,
  extractUrls,
  isMeaningfulTitle,
  isOpaqueSegment,
  isUsableUrl,
  parseHexColor,
  parseOGFromHTML,
  readableTextColor,
  titleFromUrl,
} from './octoLinkPreview';

// ─── parseOGFromHTML ─────────────────────────────────────────────────────

describe('parseOGFromHTML', () => {
  it('extracts og:title and og:description', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Hello World">
        <meta property="og:description" content="A test page">
        <meta property="og:image" content="https://example.com/img.jpg">
      </head></html>
    `;
    const result = parseOGFromHTML(html, 'https://example.com');
    expect(result.title).toBe('Hello World');
    expect(result.description).toBe('A test page');
    expect(result.image).toBe('https://example.com/img.jpg');
  });

  it('falls back to twitter:title when og:title is absent', () => {
    const html = '<meta name="twitter:title" content="Tweet Title">';
    expect(parseOGFromHTML(html, '').title).toBe('Tweet Title');
  });

  it('falls back to <title> when meta tags are absent', () => {
    const html = '<html><head><title>Page Title</title></head></html>';
    expect(parseOGFromHTML(html, '').title).toBe('Page Title');
  });

  it('decodes HTML entities in meta content', () => {
    const html = '<meta property="og:title" content="Hello &amp; World &lt;3">';
    expect(parseOGFromHTML(html, '').title).toBe('Hello & World <3');
  });

  it('resolves relative og:image against baseUrl', () => {
    const html = '<meta property="og:image" content="/images/hero.png">';
    const result = parseOGFromHTML(html, 'https://site.com/blog/');
    expect(result.image).toBe('https://site.com/images/hero.png');
  });

  it('uses a same-origin declared favicon for compact link actions', () => {
    const html = '<link rel="icon" href="/assets/favicon.svg">';
    expect(parseOGFromHTML(html, 'https://site.com/docs/guide').icon)
      .toBe('https://site.com/assets/favicon.svg');
  });

  it('does not load an icon from a third-party origin', () => {
    const html = '<link rel="icon" href="https://tracking.example/favicon.svg">';
    expect(parseOGFromHTML(html, 'https://site.com/docs/guide').icon).toBeUndefined();
  });

  it('returns undefined for missing properties', () => {
    const result = parseOGFromHTML('<html></html>', '');
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('handles name= syntax as well as property=', () => {
    const html = '<meta name="description" content="Meta desc">';
    expect(parseOGFromHTML(html, '').description).toBe('Meta desc');
  });

  it('trims whitespace from values', () => {
    const html = '<meta property="og:title" content="  Spaced Title  ">';
    expect(parseOGFromHTML(html, '').title).toBe('Spaced Title');
  });
});

// ─── isMeaningfulTitle ───────────────────────────────────────────────────

describe('isMeaningfulTitle', () => {
  it('rejects titles shorter than 3 characters', () => {
    expect(isMeaningfulTitle('ab')).toBe(false);
    expect(isMeaningfulTitle('')).toBe(false);
  });

  it('rejects bare URLs', () => {
    expect(isMeaningfulTitle('https://example.com')).toBe(false);
    expect(isMeaningfulTitle('http://test.org/page')).toBe(false);
  });

  it('rejects titles that are just the domain', () => {
    expect(isMeaningfulTitle('Example.com', 'example.com')).toBe(false);
    expect(isMeaningfulTitle('www.example.com', 'example.com')).toBe(false);
  });

  it('accepts meaningful titles', () => {
    expect(isMeaningfulTitle('Hello World')).toBe(true);
    expect(isMeaningfulTitle('A Guide to Testing')).toBe(true);
  });

  it('accepts short but meaningful titles (3+ chars)', () => {
    expect(isMeaningfulTitle('Yes')).toBe(true);
  });
});

// ─── isOpaqueSegment ─────────────────────────────────────────────────────

describe('isOpaqueSegment', () => {
  it('detects numeric segments', () => {
    expect(isOpaqueSegment('12345')).toBe(true);
  });

  it('detects hex hashes', () => {
    expect(isOpaqueSegment('abc123def456')).toBe(true);
    expect(isOpaqueSegment('a1b2c3d4')).toBe(true);
  });

  it('detects long mixed alphanumeric keys', () => {
    expect(isOpaqueSegment('Dlbb92GOXdv9PGTSVQBsCg')).toBe(true);
  });

  it('accepts short or meaningful segments', () => {
    expect(isOpaqueSegment('hello-world')).toBe(false);
    expect(isOpaqueSegment('design')).toBe(false);
    expect(isOpaqueSegment('octo设计稿')).toBe(false);
  });
});

// ─── titleFromUrl ────────────────────────────────────────────────────────

describe('titleFromUrl', () => {
  it('extracts a readable name from the last path segment', () => {
    expect(titleFromUrl('https://example.com/articles/hello-world')).toBe('hello world');
  });

  it('decodes percent-encoded segments', () => {
    expect(titleFromUrl('https://example.com/path/octo%E8%AE%BE%E8%AE%A1%E7%A8%BF')).toContain('octo');
  });

  it('drops trailing hex id suffixes', () => {
    // Notion/Medium style
    const result = titleFromUrl('https://medium.com/p/Page-Title-abc123def');
    if (result) expect(result).not.toContain('abc123def');
  });

  it('strips file extensions', () => {
    expect(titleFromUrl('https://example.com/page.html')).toBe('page');
  });

  it('replaces hyphens and underscores with spaces', () => {
    expect(titleFromUrl('https://example.com/my-great-article')).toBe('my great article');
  });

  it('returns null when no segment is readable', () => {
    expect(titleFromUrl('https://example.com')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(titleFromUrl('not-a-url')).toBeNull();
  });
});

// ─── parseHexColor ───────────────────────────────────────────────────────

describe('parseHexColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseHexColor('#ff0000')).toEqual([255, 0, 0]);
  });

  it('parses 3-digit shorthand', () => {
    // #f00 expands to #ff0000
    expect(parseHexColor('#f00')).toEqual([255, 0, 0]);
  });

  it('handles missing hash prefix', () => {
    expect(parseHexColor('ff0000')).toEqual([255, 0, 0]);
  });

  it('returns null for invalid hex', () => {
    expect(parseHexColor('#xyz')).toBeNull();
    expect(parseHexColor('#ffff')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });
});

// ─── readableTextColor ───────────────────────────────────────────────────

describe('readableTextColor', () => {
  it('returns dark text on light backgrounds', () => {
    // Light grey
    expect(readableTextColor('#ededed')).toBe('#1f2328');
    // White
    expect(readableTextColor('#ffffff')).toBe('#1f2328');
  });

  it('returns white text on dark backgrounds', () => {
    // Near black
    expect(readableTextColor('#111111')).toBe('#ffffff');
    // Dark blue
    expect(readableTextColor('#0000ff')).toBe('#ffffff');
  });

  it('returns white text on medium-dark backgrounds', () => {
    // #888888 has ~0.27 luminance, below the 0.4 threshold → white text
    expect(readableTextColor('#888888')).toBe('#ffffff');
  });

  it('returns default for invalid input', () => {
    expect(readableTextColor('invalid')).toBe('#1f2328');
  });
});

// ─── domainLabel ─────────────────────────────────────────────────────────

describe('domainLabel', () => {
  it('strips www. from domain', () => {
    const result = domainLabel('https://www.example.com/page');
    expect(result.domain).toBe('example.com');
  });

  it('extracts path for non-root URLs', () => {
    const result = domainLabel('https://example.com/blog/post');
    expect(result.domain).toBe('example.com');
    expect(result.path).toBe('/blog/post');
  });

  it('returns empty path for root URLs', () => {
    const result = domainLabel('https://example.com/');
    expect(result.path).toBe('');
  });

  it('generates a favicon URL', () => {
    const result = domainLabel('https://example.com');
    expect(result.favicon).toContain('example.com');
  });

  it('handles malformed URLs gracefully', () => {
    const result = domainLabel('not-a-url');
    expect(result.domain).toBe('not-a-url');
  });
});

// ─── extractUrls ─────────────────────────────────────────────────────────

describe('extractUrls', () => {
  it('extracts http and https URLs from text', () => {
    const urls = extractUrls('Visit https://example.com and http://test.org');
    expect(urls).toContain('https://example.com');
    expect(urls).toContain('http://test.org');
  });

  it('handles URLs with trailing punctuation', () => {
    const urls = extractUrls('See https://example.com.');
    expect(urls).toContain('https://example.com');
  });

  it('returns empty array for text without URLs', () => {
    expect(extractUrls('hello world')).toEqual([]);
  });

  it('handles URLs with paths and query strings', () => {
    const urls = extractUrls('Check https://example.com/path?a=1&b=2');
    expect(urls).toContain('https://example.com/path?a=1&b=2');
  });
});

// ─── external link actions ───────────────────────────────────────────────

describe('extractExternalUrls', () => {
  it('keeps distinct non-GitHub URLs in message order', () => {
    expect(
      extractExternalUrls(
        '文档 https://docs.example.com/guide ，看板 https://linear.app/acme/issue/ABC-1',
      ),
    ).toEqual([
      'https://docs.example.com/guide',
      'https://linear.app/acme/issue/ABC-1',
    ]);
  });

  it('deduplicates URLs and leaves GitHub handling to the existing shortcut feature', () => {
    expect(
      extractExternalUrls(
        [
          'https://github.com/octo-help/octo-help/pull/42',
          'https://docs.example.com/guide',
          'https://docs.example.com/guide。',
          'https://www.github.com/octo-help/octo-help/issues/7',
        ].join(' '),
      ),
    ).toEqual(['https://docs.example.com/guide']);
  });
});

describe('externalLinkFallback', () => {
  it('uses a readable path title and a local web-icon fallback without a network request', () => {
    expect(externalLinkFallback('https://www.example.com/guides/hello-world?token=secret')).toEqual({
      title: 'hello world',
      icon: '',
    });
  });

  it('falls back to the domain when the path contains no readable name', () => {
    expect(externalLinkFallback('https://www.example.com/')).toEqual({
      title: 'example.com',
      icon: '',
    });
  });
});

// ─── isUsableUrl ─────────────────────────────────────────────────────────

describe('isUsableUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isUsableUrl('http://example.com')).toBe(true);
    expect(isUsableUrl('https://example.com')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isUsableUrl('ftp://example.com')).toBe(false);
    expect(isUsableUrl('file:///tmp/test')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isUsableUrl('')).toBe(false);
  });
});
