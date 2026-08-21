/**
 * URL parsing for local link-action labels. The renderer never requests the
 * linked page, so this module stays dependency-free and side-effect free.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；：、)]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?，。！？；：、)\]}>]+$/;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return [...new Set(matches.map((url) => url.replace(TRAILING_PUNCTUATION, '')))];
}

function normalizedHttpUrl(raw: string): URL | null {
  const candidate = raw.replace(TRAILING_PUNCTUATION, '');
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') || url.hostname.length > 253) return null;
    return url;
  } catch {
    return null;
  }
}

function isGitHubHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'github.com' || host === 'www.github.com';
}

export function isGitHubUrl(raw: string): boolean {
  const url = normalizedHttpUrl(raw);
  return url != null && isGitHubHost(url.hostname);
}

/** @internal exported for testing */
export function isOpaqueSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8,}$/i.test(segment)) return true;
  return segment.length >= 16 && !/[-_\s]/.test(segment) && /\d/.test(segment) && /[a-z]/i.test(segment);
}

/** @internal exported for testing */
export function titleFromUrl(urlStr: string): string | null {
  let segments: string[];
  try {
    segments = new URL(urlStr).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }

  for (const segment of segments.reverse()) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      decoded = segment;
    }
    decoded = decoded.replace(/[-_][0-9a-f]{8,}$/i, '');
    decoded = decoded.replace(/\.(?:html?|php|aspx?|jsp)$/i, '');
    if (!decoded || isOpaqueSegment(decoded)) continue;
    const readable = decoded.replace(/[-_]+/g, ' ').trim();
    if (readable.length >= 2 && /\p{L}/u.test(readable)) return readable;
  }
  return null;
}

/** GitHub keeps its dedicated shortcut/card flow. */
export function extractExternalUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of extractUrls(text)) {
    const url = normalizedHttpUrl(raw);
    if (!url || isGitHubHost(url.hostname) || seen.has(url.href)) continue;
    seen.add(url.href);
    urls.push(url.href);
  }
  return urls;
}

/** Local fallback: its static web glyph makes no request to the linked site. */
export function externalLinkFallback(urlStr: string): { title: string; icon: string } {
  const url = normalizedHttpUrl(urlStr);
  if (!url) return { title: urlStr, icon: '' };
  const domain = url.hostname.replace(/^www\./i, '');
  return {
    title: titleFromUrl(url.href) ?? domain,
    icon: '',
  };
}
