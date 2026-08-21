/**
 * Link actions — rich GitHub cards plus compact actions for other message URLs.
 *
 * Non-GitHub URLs get one button each with a locally derived label and static
 * web icon. DOM methods (not innerHTML) avoid Chrome's
 * `about:blank#blocked` navigation restriction.
 */

import { OCTO_SELECTORS } from './octoSelectors';
import {
  externalLinkFallback,
  extractExternalUrls,
  extractUrls,
  isGitHubUrl,
} from './octoLinkMetadata';

export {
  externalLinkFallback,
  extractExternalUrls,
  extractUrls,
  isOpaqueSegment,
  titleFromUrl,
} from './octoLinkMetadata';

// ─── Constants ─────────────────────────────────────────────────────────────

const ROOT_CLASS = 'octo-link-preview';
const ACTION_ROOT_CLASS = 'octo-link-actions';
const STYLE_ID = 'octo-link-preview-style';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LinkPreviewData {
  url: string;
  title: string;
  state?: string;
  description?: string;
  labels?: Array<{ name: string; color: string }>;
  /** Large preview image (OG image). Only set when the site actually gave us one. */
  image?: string;
  /** Small icon for the meta row — an avatar or a favicon. Never a preview image. */
  authorAvatar?: string;
  authorName?: string;
  source: string;
}

interface CacheEntry {
  data: LinkPreviewData;
  fetchedAt: number;
}

interface ExternalLinkAction {
  url: string;
  title: string;
  icon: string;
}

// ─── Cache ─────────────────────────────────────────────────────────────────

const previewCache = new Map<string, CacheEntry>();

function getCached(url: string): LinkPreviewData | null {
  const entry = previewCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    previewCache.delete(url);
    return null;
  }
  return entry.data;
}

function setCache(url: string, data: LinkPreviewData): void {
  if (previewCache.size >= 100) {
    const oldest = previewCache.entries().next().value;
    if (oldest) previewCache.delete(oldest[0]);
  }
  previewCache.set(url, { data, fetchedAt: Date.now() });
}

// ─── Handlers ──────────────────────────────────────────────────────────────

interface PreviewHandler {
  pattern: RegExp;
  fetch: (match: RegExpExecArray) => Promise<LinkPreviewData | null>;
}

// ─── Generic OG tag fetcher ───────────────────────────────────────────────

interface OGTags {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  icon?: string;
}

/** @internal exported for testing */
export function parseOGFromHTML(html: string, baseUrl: string): OGTags {
  function getAttr(property: string): string | undefined {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m) {
        // DOMParser decodes HTML entities (&amp; → &, etc.) without executing
        // scripts or assigning innerHTML — required by the MAIN-world lint rule.
        const doc = new DOMParser().parseFromString(`<textarea>${m[1]}</textarea>`, 'text/html');
        return (doc.querySelector('textarea') as HTMLTextAreaElement)?.value ?? m[1];
      }
    }
    return undefined;
  }

  function getTagAttribute(tag: string, name: string): string | undefined {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}=["']([^"']*)["']`, 'i').exec(tag)?.[1];
  }

  function resolveSameOriginIcon(): string | undefined {
    if (!baseUrl) return undefined;
    let base: URL;
    try {
      base = new URL(baseUrl);
    } catch {
      return undefined;
    }
    const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of linkTags) {
      const rel = getTagAttribute(tag, 'rel')?.toLowerCase();
      const href = getTagAttribute(tag, 'href');
      if (!rel || !href || !/(^|\s)(shortcut\s+)?icon(\s|$)|apple-touch-icon/.test(rel)) continue;
      try {
        const icon = new URL(href, base);
        if (icon.protocol === 'https:' && icon.origin === base.origin) return icon.href;
      } catch {
        // Ignore malformed icon declarations and fall back to /favicon.ico.
      }
    }
    return undefined;
  }

  const title = getAttr('og:title') || getAttr('twitter:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const description = getAttr('og:description') || getAttr('twitter:description') || getAttr('description');
  const image = getAttr('og:image') || getAttr('twitter:image');
  const siteName = getAttr('og:site_name');

  let resolvedImage = image;
  if (resolvedImage && !resolvedImage.startsWith('http')) {
    try { resolvedImage = new URL(resolvedImage, baseUrl).href; } catch { resolvedImage = undefined; }
  }

  return {
    title: title?.trim(),
    description: description?.trim(),
    image: resolvedImage,
    siteName: siteName?.trim(),
    icon: resolveSameOriginIcon(),
  };
}

/**
 * Whether an OG title/description tells the reader something the link itself
 * does not already say.
 *
 * Login walls, redirect stubs and SPA shells hand back a bare URL, the raw
 * domain, or a one-word placeholder. Rendering any of those produces a card
 * that repeats the visible link — the failure the domain-only fallback used to
 * ship. Treat them as "no metadata" so the caller can decline to draw a card.
 */
/** @internal exported for testing */
export function isMeaningfulTitle(value: string, domain?: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;
  // A bare URL or scheme ("https://", "https://x.com/a").
  if (/^https?:\/\/?\S*$/i.test(trimmed)) return false;
  // Just the host, with or without "www.".
  if (domain && trimmed.replace(/^www\./i, '').toLowerCase() === domain.toLowerCase()) return false;
  return true;
}

// ─── Label colours ─────────────────────────────────────────────────

/** @internal exported for testing */
export function parseHexColor(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, '');
  const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Pick a readable text colour to sit on a solid `hex` background.
 *
 * GitHub label colours are authored as *background* colours and span the whole
 * range from near-white (`ededed`) to near-black. Using one as the text colour
 * — which this card used to do — makes pale labels invisible: a
 * `needs-human-review` label came out as light grey on a white card. Choosing
 * black or white by luminance is the rule GitHub itself applies, and it holds
 * for any label colour and in both themes.
 */
/** @internal exported for testing */
export function readableTextColor(hex: string): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return '#1f2328';
  // WCAG relative luminance.
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#1f2328' : '#ffffff';
}

/** @internal exported for testing */
export function domainLabel(urlStr: string): { domain: string; path: string; favicon: string } {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname.replace(/^www\./, '');
    const path = url.pathname.length > 1 ? url.pathname : '';
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    return { domain, path, favicon };
  } catch {
    return { domain: urlStr, path: '', favicon: '' };
  }
}

// ─── GitHub handler ────────────────────────────────────────────────────────

const GITHUB_PR_ISSUE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/;

interface GitHubPR { title: string; state: string; html_url: string; user?: { login: string; avatar_url: string }; labels?: Array<{ name: string; color: string }>; merged?: boolean; draft?: boolean; }
interface GitHubIssue { title: string; state: string; html_url: string; user?: { login: string; avatar_url: string }; labels?: Array<{ name: string; color: string }>; pull_request?: unknown; }

async function isPullRequest(owner: string, repo: string, number: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'OctoHelp/1.0' },
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch { return false; }
}

// ─── All handlers ──────────────────────────────────────────────────────────

//
// Add a per-site handler only when the site exposes facts that neither the URL
// nor its OG tags can carry — GitHub's live open/merged state and labels are
// the justifying case. "This site keeps its title in the path" is NOT a reason:
// the generic fallback below already does that for every site at once.

const handlers: PreviewHandler[] = [
  {
    // 1. GitHub PR or Issue
    pattern: GITHUB_PR_ISSUE_RE,
    async fetch(match) {
      const [, owner, repo, number] = match;
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
          headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'OctoHelp/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as GitHubIssue | GitHubPR;
        const isPR = 'pull_request' in data || (await isPullRequest(owner, repo, number));
        let state = data.state === 'open' ? 'open' : 'closed';
        let draft = false;

        if (isPR) {
          try {
            const prResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
              headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'OctoHelp/1.0' },
              signal: AbortSignal.timeout(3000),
            });
            if (prResp.ok) {
              const prData = (await prResp.json()) as GitHubPR;
              if (prData.merged) state = 'merged';
              draft = !!prData.draft;
            }
          } catch { /* fallback */ }
        }

        const labels = (data.labels ?? []).filter((l): l is { name: string; color: string } => typeof l.name === 'string').slice(0, 5);
        return {
          url: data.html_url,
          title: data.title || `#${number}`,
          state: draft ? 'draft' : state,
          // No description: the state badge in the header already says
          // open/merged/closed, and repeating it here just printed
          // "an9xyz  Closed" next to a "✕ Closed" chip.
          labels: labels.length > 0 ? labels : undefined,
          authorAvatar: data.user?.avatar_url,
          authorName: data.user?.login,
          source: 'github',
        };
      } catch { return null; }
    },
  },
];

// ─── Preview resolution ────────────────────────────────────────────────────

async function resolvePreview(url: string): Promise<LinkPreviewData | null> {
  const cached = getCached(url);
  if (cached) return cached;
  for (const handler of handlers) {
    const match = handler.pattern.exec(url);
    if (match) {
      const data = await handler.fetch(match);
      if (data) { setCache(url, data); return data; }
    }
  }
  return null;
}

// ─── Styles ────────────────────────────────────────────────────────────────

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${ROOT_CLASS} { margin-top: 6px; max-width: 420px; }
    .${ACTION_ROOT_CLASS} { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    body[data-octo-skin="qq2014"]:not([data-octo-qq-self-left]) .wk-msg-row--send:not(:has(.ai-badge)) .octo-link-actions,
    body[data-octo-skin="qq2014"]:not([data-octo-qq-self-left]) .wk-msg-row--send:not(:has(.ai-badge)) .octo-github-links {
      justify-content: flex-end;
    }
    .${ACTION_ROOT_CLASS} .octo-link-action {
      display: inline-flex; min-width: 0; max-width: min(100%, 340px); align-items: center; gap: 6px;
      min-height: 28px; box-sizing: border-box; padding: 4px 9px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 7px; background: color-mix(in srgb, currentColor 6%, transparent); color: inherit;
      font: 600 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; text-decoration: none;
    }
    .${ACTION_ROOT_CLASS} .octo-link-action:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
    .${ACTION_ROOT_CLASS} .octo-link-action-icon { width: 15px; height: 15px; flex: none; border-radius: 3px; object-fit: contain; }
    .${ACTION_ROOT_CLASS} .octo-link-action-icon.is-fallback { display: grid; place-items: center; font-size: 12px; line-height: 1; }
    .${ACTION_ROOT_CLASS} .octo-link-action-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .${ACTION_ROOT_CLASS} .octo-link-action-external { flex: none; opacity: .72; }
    .${ROOT_CLASS} .octo-lp-card {
      display: block; border: 1px solid rgba(31,35,40,0.15); border-radius: 8px;
      background: rgba(246,248,250,0.96); color: #24292f !important;
      text-decoration: none !important; overflow: hidden; transition: border-color .15s;
    }
    .${ROOT_CLASS} .octo-lp-card:hover { border-color: rgba(31,35,40,0.3); box-shadow: 0 2px 8px rgba(31,35,40,0.08); }
    .${ROOT_CLASS} .octo-lp-image { width: 100%; max-height: 200px; overflow: hidden; background: #f0f0f0; }
    .${ROOT_CLASS} .octo-lp-image img { width: 100%; height: auto; display: block; object-fit: cover; }
    .${ROOT_CLASS} .octo-lp-body { padding: 10px 12px; }
    .${ROOT_CLASS} .octo-lp-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .${ROOT_CLASS} .octo-lp-source-icon {
      width: 16px; height: 16px; border-radius: 50%; background: #24292f; color: #fff;
      font: 700 7px/16px sans-serif; text-align: center; flex: none;
    }
    .${ROOT_CLASS} .octo-lp-source-icon.is-web { background: transparent; font-size: 12px; line-height: 1; }
    .${ROOT_CLASS} .octo-lp-source-icon.is-favicon { background: transparent; border-radius: 3px; }
    .${ROOT_CLASS} .octo-lp-state {
      display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 10px;
      font-size: 10px; font-weight: 600; line-height: 16px;
    }
    .${ROOT_CLASS} .octo-lp-state--open { background: #dafbe1; color: #1a7f37; }
    .${ROOT_CLASS} .octo-lp-state--closed { background: #ffebe9; color: #cf222e; }
    .${ROOT_CLASS} .octo-lp-state--merged { background: #d8b4fe; color: #8250df; }
    .${ROOT_CLASS} .octo-lp-state--draft { background: #f6f8fa; color: #656d76; }
    .${ROOT_CLASS} .octo-lp-title { font-size: 13px; font-weight: 600; line-height: 1.4; margin: 0 0 4px; color: #24292f; }
    .${ROOT_CLASS} .octo-lp-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #656d76; }
    .${ROOT_CLASS} .octo-lp-author { display: flex; align-items: center; gap: 4px; }
    .${ROOT_CLASS} .octo-lp-author-img { width: 16px; height: 16px; border-radius: 50%; }
    .${ROOT_CLASS} .octo-lp-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .${ROOT_CLASS} .octo-lp-label { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 500; line-height: 16px; }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-card { border-color: rgba(240,246,252,0.2); background: rgba(33,38,45,0.96); color: #f0f6fc !important; }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-card:hover { border-color: rgba(240,246,252,0.4); }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-title { color: #f0f6fc; }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-meta { color: #8b949e; }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-state--open { background: #1a7f37; color: #dafbe1; }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-state--closed { background: #cf222e; color: #ffebe9; }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-lp-state--merged { background: #8250df; color: #d8b4fe; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// ─── DOM helpers (no innerHTML for links — avoids about:blank#blocked) ────

function el(tag: string, attrs: Record<string, string | undefined> = {}, children?: (string | HTMLElement)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v != null) e.setAttribute(k, v); }
  if (children) {
    for (const child of children) {
      if (typeof child === 'string') e.appendChild(document.createTextNode(child));
      else e.appendChild(child);
    }
  }
  return e;
}

function linkActionIcon(icon: string): HTMLElement {
  if (!icon) {
    return el('span', { class: 'octo-link-action-icon is-fallback', 'aria-hidden': 'true' }, ['🌐']);
  }
  const image = el('img', {
    class: 'octo-link-action-icon',
    src: icon,
    alt: '',
    loading: 'lazy',
  }) as HTMLImageElement;
  image.addEventListener(
    'error',
    () => image.replaceWith(linkActionIcon('')),
    { once: true },
  );
  return image;
}

function renderExternalLinkAction(data: ExternalLinkAction): HTMLAnchorElement {
  const label = el('span', { class: 'octo-link-action-label' }, [data.title]);
  const action = el(
    'a',
    {
      class: 'octo-link-action',
      href: data.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: data.url,
      'data-octo-link-url': data.url,
    },
    [linkActionIcon(data.icon), label, el('span', { class: 'octo-link-action-external', 'aria-hidden': 'true' }, ['↗'])],
  ) as HTMLAnchorElement;
  return action;
}

function renderExternalLinkActions(host: HTMLElement, item: HTMLElement, urls: string[]): void {
  const existing = item.querySelector<HTMLElement>(`.${ACTION_ROOT_CLASS}`);
  if (!urls.length) {
    existing?.remove();
    return;
  }

  const signature = urls.join('\n');
  if (existing?.dataset.signature === signature) return;

  const root = document.createElement('div');
  root.className = ACTION_ROOT_CLASS;
  root.dataset.signature = signature;
  for (const url of urls) {
    const fallback = externalLinkFallback(url);
    root.appendChild(renderExternalLinkAction({ url, ...fallback }));
  }
  if (existing) existing.replaceWith(root);
  else host.appendChild(root);
}

function renderCardNode(data: LinkPreviewData): HTMLElement {
  const isGH = data.source === 'github';

  // Source icon: GitHub keeps its wordmark chip; every other host gets its own
  // favicon, which beats a generic globe and needs no per-site code.
  const sourceIcon = isGH
    ? el('span', { class: 'octo-lp-source-icon' }, ['GH'])
    : data.authorAvatar
      ? el('img', { class: 'octo-lp-source-icon is-favicon', src: data.authorAvatar, alt: '' })
      : el('span', { class: 'octo-lp-source-icon is-web' }, ['🌐']);

  // Header row
  const header = el('div', { class: 'octo-lp-header' }, [sourceIcon]);
  if (isGH && data.state) {
    const icon = data.state === 'open' ? '◉' : data.state === 'merged' ? '⏺' : data.state === 'draft' ? '◌' : '✕';
    const label = data.state === 'open' ? 'Open'
      : data.state === 'merged' ? 'Merged'
      : data.state === 'draft' ? 'Draft'
      : 'Closed';
    header.appendChild(el('span', { class: `octo-lp-state octo-lp-state--${data.state}` }, [`${icon} ${label}`]));
  }

  // Title
  const title = el('p', { class: 'octo-lp-title' }, [data.title]);

  // Meta row. GitHub shows the author with their avatar; for web links the
  // favicon is already the source icon above, so repeating it here is noise.
  const meta = el('div', { class: 'octo-lp-meta' });
  if (data.authorName) {
    if (isGH && data.authorAvatar && /^https?:\/\//.test(data.authorAvatar)) {
      meta.appendChild(el('span', { class: 'octo-lp-author' }, [
        el('img', { src: data.authorAvatar, alt: '', class: 'octo-lp-author-img' }),
        ` ${data.authorName}`,
      ]));
    } else {
      meta.appendChild(el('span', {}, [data.authorName]));
    }
  }
  if (data.description) meta.appendChild(el('span', {}, [data.description]));

  // Body
  const body = el('div', { class: 'octo-lp-body' }, [header, title, meta]);

  // Preview image — only a real OG image, never the favicon. Feeding a 32px
  // favicon into this block stretched it across the whole 420px card.
  let imageEl: HTMLElement | null = null;
  if (data.image && /^https?:\/\//.test(data.image)) {
    imageEl = el('div', { class: 'octo-lp-image' }, [el('img', { src: data.image, alt: '', loading: 'lazy' })]);
  }

  // GitHub labels
  if (isGH && data.labels && data.labels.length > 0) {
    const container = el('div', { class: 'octo-lp-labels' });
    for (const l of data.labels) {
      const background = parseHexColor(l.color) ? `#${l.color.replace(/^#/, '')}` : '#e1e4e8';
      container.appendChild(
        el(
          'span',
          {
            class: 'octo-lp-label',
            style: `background:${background};color:${readableTextColor(background)}`,
          },
          [l.name],
        ),
      );
    }
    body.appendChild(container);
  }

  const children: HTMLElement[] = [];
  if (imageEl) children.push(imageEl);
  children.push(body);

  return el('a', { class: 'octo-lp-card', href: data.url, target: '_blank', rel: 'noopener noreferrer' }, children);
}

// ─── Scan & render ─────────────────────────────────────────────────────────

async function renderMessagePreview(item: HTMLElement): Promise<void> {
  const host = item.querySelector<HTMLElement>(OCTO_SELECTORS.linkShortcutHost);
  if (!host) return;

  const existing = item.querySelector<HTMLElement>(`.${ROOT_CLASS}`);
  const content = item.querySelector<HTMLElement>(OCTO_SELECTORS.anyMessageBody);
  if (!content) { existing?.remove(); return; }

  const text = content.textContent || '';
  const anchorLinks: string[] = [];
  content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href) anchorLinks.push(href);
  });

  // Anchor hrefs FIRST: Octo truncates the *visible text* of long links with an
  // ellipsis ("https://www.figma.com/design/D...t=um2w3"), so the text-scraped
  // URL is a broken string that no handler matches and no browser can open.
  // The href attribute is the authoritative full URL.
  const urls = [...new Set([...anchorLinks, ...extractUrls(text)])].filter(isUsableUrl);
  renderExternalLinkActions(host, item, extractExternalUrls([...anchorLinks, text].join('\n')));

  // GitHub remains on the existing rich-card path. Every other HTTP(S) URL is
  // rendered as its own compact action above, so a message with several links
  // gets several buttons without replacing GitHub's dedicated handling.
  const previewUrl = urls.find(isGitHubUrl);
  if (!previewUrl) { existing?.remove(); return; }
  if (existing?.dataset.previewUrl === previewUrl) return;

  // Already resolved to "nothing worth showing" for this exact URL. Remembered
  // on the item because a null result is not cached, and the MutationObserver
  // would otherwise re-fire the same doomed fetch on every DOM change.
  if (item.dataset.octoLpEmpty === previewUrl) return;
  // Already in flight for this URL.
  if (item.dataset.octoLpPending === previewUrl) return;
  item.dataset.octoLpPending = previewUrl;

  // Nothing is inserted yet, on purpose: a "loading" box that later vanishes is
  // its own kind of wrong output, and plenty of these resolve to nothing. The
  // card appears only once there is something real to put in it.
  const data = await resolvePreview(previewUrl);

  // A newer pass for a different URL took over while we awaited.
  if (item.dataset.octoLpPending !== previewUrl) return;
  delete item.dataset.octoLpPending;
  if (!item.isConnected) return;

  const current = item.querySelector<HTMLElement>(`.${ROOT_CLASS}`);

  if (!data) {
    item.dataset.octoLpEmpty = previewUrl;
    current?.remove();
    return;
  }

  delete item.dataset.octoLpEmpty;
  const wrapper = document.createElement('div');
  wrapper.className = ROOT_CLASS;
  wrapper.dataset.previewUrl = previewUrl;
  wrapper.appendChild(renderCardNode(data));
  if (current) current.replaceWith(wrapper);
  else host.appendChild(wrapper);
}

/**
 * Reject anything that is not a real, openable URL.
 *
 * Two failure modes this guards against, both observed:
 *  - Octo's own display truncation leaks `…` / `...` into the scraped text, which
 *    parses as a URL but points nowhere (and rendered a "https://" card).
 *  - A bare scheme (`https://`) has no hostname at all.
 */
/** @internal exported for testing */
export function isUsableUrl(raw: string): boolean {
  if (!/^https?:\/\//i.test(raw)) return false;
  if (raw.includes('…') || raw.includes('...')) return false;
  try {
    const url = new URL(raw);
    // A real host always has a dot ("figma.com"); "https://" yields an empty one.
    return url.hostname.includes('.') && url.hostname.length > 3;
  } catch {
    return false;
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

let observer: MutationObserver | null = null;
let scanTimer: number | null = null;
const pendingFetches = new Set<HTMLElement>();

function scan(): void {
  scanTimer = null;
  const items = document.querySelectorAll<HTMLElement>(OCTO_SELECTORS.messageItem);
  for (const item of items) {
    if (pendingFetches.has(item)) continue;
    pendingFetches.add(item);
    setTimeout(() => { pendingFetches.delete(item); void renderMessagePreview(item); }, 50);
  }
}

function scheduleScan(): void {
  if (scanTimer != null) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, 300);
}

export function startOctoLinkPreview(): () => void {
  ensureStyle();
  scan();
  observer?.disconnect();
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  return stopOctoLinkPreview;
}

export function stopOctoLinkPreview(): void {
  observer?.disconnect();
  observer = null;
  if (scanTimer != null) window.clearTimeout(scanTimer);
  scanTimer = null;
  pendingFetches.clear();
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach((node) => node.remove());
  document.querySelectorAll(`.${ACTION_ROOT_CLASS}`).forEach((node) => node.remove());
  // The bookkeeping attributes are ours too, so they have to go with the nodes:
  // leaving `octoLpEmpty` behind would make a re-enable permanently skip every
  // link that had failed once.
  document
    .querySelectorAll<HTMLElement>('[data-octo-lp-empty], [data-octo-lp-pending]')
    .forEach((node) => {
      delete node.dataset.octoLpEmpty;
      delete node.dataset.octoLpPending;
    });
  document.getElementById(STYLE_ID)?.remove();
}
