const ROOT_CLASS = 'octo-github-links';
const STYLE_ID = 'octo-github-links-style';
import { OCTO_SELECTORS } from './octoSelectors';

const MESSAGE_SELECTOR = OCTO_SELECTORS.messageItem;
const CONTENT_SELECTOR = OCTO_SELECTORS.anyMessageBody;
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s<>"'，。！？；：、]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?，。！？；：、)\]}>]+$/;

export type GitHubLinkKind =
  | 'pull'
  | 'issue'
  | 'discussion'
  | 'commit'
  | 'action'
  | 'release'
  | 'compare'
  | 'file'
  | 'repository'
  | 'github';

export interface GitHubLink {
  url: string;
  kind: GitHubLinkKind;
  label: string;
}

function normalizedBase(raw: string): URL | null {
  const candidate = raw.replace(TRAILING_PUNCTUATION, '');
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname.toLowerCase() !== 'github.com' && url.hostname.toLowerCase() !== 'www.github.com') {
      return null;
    }
    url.protocol = 'https:';
    url.hostname = 'github.com';
    return url;
  } catch {
    return null;
  }
}

function structuredPath(url: URL): { pathname: string; kind: GitHubLinkKind; label: string } | null {
  const path = url.pathname;
  let match = /^\/([^/]+)\/([^/]+)\/(pull|issues|discussions)\/(\d+)(?:\/(files|commits|checks)(?=\/|$))?/.exec(path);
  if (match) {
    const [, owner, repo, route, id, suffix] = match;
    const kind = route === 'pull' ? 'pull' : route === 'issues' ? 'issue' : 'discussion';
    const title = kind === 'pull' ? 'PR' : kind === 'issue' ? 'Issue' : 'Discussion';
    return {
      pathname: `/${owner}/${repo}/${route}/${id}${suffix ? `/${suffix}` : ''}`,
      kind,
      label: `${title} #${id}`,
    };
  }

  match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(path);
  if (match) {
    const [, owner, repo, runId, jobId] = match;
    return {
      pathname: `/${owner}/${repo}/actions/runs/${runId}${jobId ? `/job/${jobId}` : ''}`,
      kind: 'action',
      label: jobId ? `Action job #${jobId}` : `Action run #${runId}`,
    };
  }

  match = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{40}|[0-9a-f]{7})/i.exec(path);
  if (match) {
    const [, owner, repo, sha] = match;
    return {
      pathname: `/${owner}/${repo}/commit/${sha}`,
      kind: 'commit',
      label: `Commit ${sha.slice(0, 7)}`,
    };
  }
  return null;
}

export function normalizeGitHubUrl(raw: string): GitHubLink | null {
  const url = normalizedBase(raw);
  if (!url) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    return { url: url.href, kind: 'github', label: 'GitHub' };
  }

  const structured = structuredPath(url);
  if (structured) {
    const pathWasExact = url.pathname === structured.pathname;
    url.pathname = structured.pathname;
    if (!pathWasExact) {
      url.search = '';
      url.hash = '';
    }
    return { url: url.href, kind: structured.kind, label: structured.label };
  }

  const route = parts[2];
  let kind: GitHubLinkKind = 'repository';
  let label = `${parts[0]}/${parts[1]}`;
  if (route === 'releases') {
    kind = 'release';
    label = 'GitHub Release';
  } else if (route === 'compare') {
    kind = 'compare';
    label = 'GitHub Compare';
  } else if (route === 'blob' || route === 'tree' || route === 'raw') {
    kind = 'file';
    label = route === 'tree' ? 'GitHub directory' : 'GitHub file';
  } else if (route) {
    kind = 'github';
    label = 'Open in GitHub';
  }
  return { url: url.href, kind, label };
}

export function extractGitHubLinks(text: string): GitHubLink[] {
  if (!text) return [];
  const matches = text.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const links: GitHubLink[] = [];
  for (const raw of matches) {
    const link = normalizeGitHubUrl(raw);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }
  return links;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${ROOT_CLASS} {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 5px;
      align-items: center;
    }
    .${ROOT_CLASS} a {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 26px;
      box-sizing: border-box;
      padding: 3px 8px;
      border: 1px solid rgba(31, 35, 40, 0.18);
      border-radius: 6px;
      background: rgba(246, 248, 250, 0.96);
      color: #24292f !important;
      font: 600 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      text-decoration: none !important;
      white-space: nowrap;
    }
    .${ROOT_CLASS} a:hover {
      border-color: rgba(31, 35, 40, 0.34);
      background: #ffffff;
      box-shadow: 0 2px 7px rgba(31, 35, 40, 0.12);
    }
    .${ROOT_CLASS} .octo-github-mark {
      width: 16px;
      height: 16px;
      flex: none;
      border-radius: 50%;
      background: #24292f;
      color: #fff;
      font: 700 8px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
    }
    body[theme-mode='dark'] .${ROOT_CLASS} a {
      border-color: rgba(240, 246, 252, 0.22);
      background: rgba(33, 38, 45, 0.96);
      color: #f0f6fc !important;
    }
    body[theme-mode='dark'] .${ROOT_CLASS} a:hover {
      border-color: rgba(240, 246, 252, 0.42);
      background: #2d333b;
    }
    body[theme-mode='dark'] .${ROOT_CLASS} .octo-github-mark {
      background: #f0f6fc;
      color: #24292f;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function renderMessageLinks(item: HTMLElement): void {
  const content = item.querySelector<HTMLElement>(CONTENT_SELECTOR);
  const target = item.querySelector<HTMLElement>('.wk-msg-row-content, .wk-fold-msg-body');
  const existing = item.querySelector<HTMLElement>(`.${ROOT_CLASS}`);
  if (!content || !target) {
    existing?.remove();
    return;
  }
  const sources = [content.textContent || ''];
  content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    sources.push(anchor.getAttribute('href') || '');
  });
  const links = extractGitHubLinks(sources.join('\n'));
  if (!links.length) {
    existing?.remove();
    return;
  }
  const signature = links.map((link) => link.url).join('\n');
  if (existing?.dataset.signature === signature) return;
  const root = existing ?? document.createElement('div');
  root.className = ROOT_CLASS;
  root.dataset.signature = signature;
  root.replaceChildren();
  for (const link of links) {
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.title = link.url;
    anchor.dataset.githubKind = link.kind;
    const mark = document.createElement('span');
    mark.className = 'octo-github-mark';
    mark.textContent = 'GH';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = link.label;
    const external = document.createElement('span');
    external.textContent = '↗';
    external.setAttribute('aria-hidden', 'true');
    anchor.append(mark, label, external);
    root.appendChild(anchor);
  }
  if (!existing) target.appendChild(root);
}

let observer: MutationObserver | null = null;
let scanTimer: number | null = null;

function scan(): void {
  scanTimer = null;
  document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR).forEach(renderMessageLinks);
}

function scheduleScan(): void {
  if (scanTimer != null) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, 100);
}

export function startOctoGithubLinks(): () => void {
  ensureStyle();
  scan();
  observer?.disconnect();
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  return stopOctoGithubLinks;
}

export function stopOctoGithubLinks(): void {
  observer?.disconnect();
  observer = null;
  if (scanTimer != null) window.clearTimeout(scanTimer);
  scanTimer = null;
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach((node) => node.remove());
  document.getElementById(STYLE_ID)?.remove();
}
