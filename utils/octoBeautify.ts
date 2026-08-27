import type { PlayerWatermarkId } from './octoShared';
import qrcode from 'qrcode-generator';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import BEAUTIFY_CSS from './octoBeautify.css?raw';
import { CLAMP_CANDIDATE_SELECTOR, OCTO_SELECTORS } from './octoSelectors';
import {
  DEFAULT_GLOBAL_THEME,
  DEFAULT_KICK_STYLE,
  DEFAULT_THEME,
  GLOBAL_THEMES,
  kickStyleById,
  themeById,
  type GlobalThemeDef,
} from './octoThemeCatalog';
import {
  EMPTY_SYNC_SCOPE,
  FULL_SYNC_SCOPE,
  classifyMutations,
  isEmptyScope,
  mergeScopes,
  type SyncScope,
} from './octoSyncScope';
import {
  CARD_TILT_NEUTRAL,
  cardTiltForPointer,
  interpolateCardTilt,
  isCardTiltSettled,
  type CardTilt,
  type CardTiltRect,
} from './octoCardTiltMath';
import {
  setFullscreenKickBallCursor,
  setFullscreenKickPlayer,
  setFullscreenKickStyle,
} from './octoFullscreenKickLazy';

// No catalog re-exports here on purpose: importing this module drags in the
// beautify stylesheet and the whole engine, so theme/style constants must be
// taken straight from `@/utils/octoThemeCatalog`.

// Message beautify + theme (skin) engine, ported from an9xyz/octo-script
// (Tampermonkey userscript) into our extension. Pure CSS/DOM overrides in the
// page MAIN world — no app source changes.
//
// Adapted from the original:
//   - theme selection is driven by the extension popup via browser.storage,
//     relayed here through postMessage, instead of localStorage + an in-page
//     NavRail menu (that button/menu UI is removed).
//   - everything else (three-tier bubbles, fold-session auto-expand, AI
//     continue marking, long-message clamp/expand, dark tokens, worldcup skin)
//     is kept verbatim from the source.
//
// Theme model: base -> body[theme-mode] (light/dark), skin -> body[data-octo-skin].


const CLAMP_HEIGHT = 240;
const STYLE_ID = "octo-ai-flatten-css";

// The stylesheet lives in octoBeautify.css and is imported verbatim.
// `?raw` (not `?inline`) is deliberate: it bypasses Vite's CSS pipeline entirely.
// The sheet contains 140 `:has()` rules and inline `data:image/svg+xml` URLs that
// themselves contain encoded `url(%23id)` fragment references — exactly the kind
// of thing a CSS transformer or url() resolver can silently rewrite or reject.


// ---- style injection ----------------------------------------------------

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BEAUTIFY_CSS;
  (document.head || document.documentElement).appendChild(style);
}

// ---- theme model ---------------------------------------------------------

let currentThemeId = DEFAULT_THEME;
let currentGlobalThemeId = DEFAULT_GLOBAL_THEME;
let selfWritingTheme = false;
let nativeThemeMode: string | null | undefined;

function globalThemeById(id: string): GlobalThemeDef {
  for (const t of GLOBAL_THEMES) if (t.id === id) return t;
  return GLOBAL_THEMES[0];
}

/** Reflect a theme id onto <body>: base -> [theme-mode], skin -> [data-octo-skin]. Idempotent. */
function reflectTheme(id: string): void {
  const body = document.body;
  if (!body) return;
  const t = themeById(id);
  // Suppress the theme observer while WE write, so our own attribute changes
  // can't feed back into a re-assert loop with the app.
  selfWritingTheme = true;
  try {
    if (t.base === 'dark') {
      if (body.getAttribute('theme-mode') !== 'dark') body.setAttribute('theme-mode', 'dark');
    } else if (body.getAttribute('theme-mode') === 'dark') {
      body.removeAttribute('theme-mode');
    }
    if (t.skin) {
      if (body.getAttribute('data-octo-skin') !== t.skin) body.setAttribute('data-octo-skin', t.skin);
    } else if (body.hasAttribute('data-octo-skin')) {
      body.removeAttribute('data-octo-skin');
    }
  } finally {
    selfWritingTheme = false;
  }
}

/** Reflect a whole-site color theme onto <body>. This is independent of message skin. */
function reflectGlobalTheme(id: string): void {
  const body = document.body;
  if (!body) return;
  const t = globalThemeById(id);
  if (t.id === 'none') {
    body.removeAttribute('data-octo-global-theme');
  } else if (body.getAttribute('data-octo-global-theme') !== t.id) {
    body.setAttribute('data-octo-global-theme', t.id);
  }
}

/**
 * Set the active theme (called on init and whenever the popup changes it).
 * The app forces light mode on startup (removes body[theme-mode]); a
 * MutationObserver below re-asserts our choice so we win that race.
 */
export function setTheme(id: string): void {
  currentThemeId = themeById(id).id;
  reflectTheme(currentThemeId);
  // Mount/unmount the worldcup soccer balls right away (don't wait for next sync).
  try { syncBalls(); } catch { /* noop */ }
}

export function setGlobalTheme(id: string): void {
  currentGlobalThemeId = globalThemeById(id).id;
  reflectGlobalTheme(currentGlobalThemeId);
}

/**
 * QQ 2014 skin option: keep own messages on the left (octo-web's native layout)
 * instead of flipping them to the right. Reflected as a <body> attribute the
 * skin CSS opts out on; harmless for every other theme.
 */
let qqSelfLeft = false;
function reflectQQSelfLeft(): void {
  const body = document.body;
  if (!body) return;
  if (qqSelfLeft) body.setAttribute('data-octo-qq-self-left', 'true');
  else body.removeAttribute('data-octo-qq-self-left');
}

export function setQQSelfLeft(enabled: boolean): void {
  qqSelfLeft = enabled;
  reflectQQSelfLeft();
}

function extensionAssetUrl(value: string, expectedPath: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const validProtocol =
    url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:';
  return validProtocol && url.pathname === expectedPath ? url : null;
}

export function setPlayerWatermark(
  playerId: PlayerWatermarkId,
  playerImageUrl: string,
  ballImageUrl: string,
): void {
  const body = document.body;
  if (!body) return;

  body.removeAttribute('data-octo-player-watermark');
  body.style.removeProperty('--octo-player-watermark-image');
  if (playerId === 'none') {
    setFullscreenKickPlayer('none', '');
    return;
  }
  if (playerId !== 'messi' && playerId !== 'mbappe') return;

  const playerUrl = extensionAssetUrl(
    playerImageUrl,
    `/player-animation/${playerId}-player.webp`,
  );
  const ballUrl = extensionAssetUrl(
    ballImageUrl,
    `/player-animation/${playerId}-ball.webp`,
  );
  if (!playerUrl || !ballUrl) {
    setFullscreenKickPlayer('none', '');
    return;
  }

  body.setAttribute('data-octo-player-watermark', playerId);
  body.style.setProperty(
    '--octo-player-watermark-image',
    `url(${JSON.stringify(playerUrl.href)})`,
  );
  setFullscreenKickPlayer(playerId, ballUrl.href);
}

let themeObserverBound = false;
let themeObserver: MutationObserver | null = null;
let reassertTimer: number | undefined;
function watchThemeAttr(): void {
  if (themeObserverBound || !document.body) return;
  themeObserverBound = true;
  const mo = new MutationObserver(() => {
    // Ignore attribute changes we made ourselves; debounce app-driven ones so
    // a fight with the app can't become a synchronous tight loop.
    if (selfWritingTheme) return;
    if (reassertTimer) clearTimeout(reassertTimer);
    reassertTimer = window.setTimeout(() => reflectTheme(currentThemeId), 60);
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['theme-mode'] });
  themeObserver = mo;
}

// ---- fold sessions: auto-expand + guard against re-collapse --------------

const TOGGLE_SEL = OCTO_SELECTORS.foldToggle;
let watchedToggles = new WeakSet<Element>();
const toggleObservers: MutationObserver[] = [];

// Cap auto-expand clicks per toggle so a toggle that re-collapses (app fights
// back) can't produce an infinite click loop.
let expandCounts = new WeakMap<Element, number>();
const MAX_EXPAND_CLICKS = 3;

function expandToggle(btn: Element | null): void {
  if (!btn || btn.getAttribute('aria-expanded') !== 'false') return;
  const n = expandCounts.get(btn) || 0;
  if (n >= MAX_EXPAND_CLICKS) return;
  expandCounts.set(btn, n + 1);
  (btn as HTMLElement).click();
}
function expandAllFoldSessions(roots?: Element[]): void {
  forEachInScope(roots, `${TOGGLE_SEL}[aria-expanded="false"]`, expandToggle);
}
function watchToggle(btn: Element): void {
  if (watchedToggles.has(btn)) return;
  watchedToggles.add(btn);
  const mo = new MutationObserver(() => {
    if (btn.getAttribute('aria-expanded') === 'false') expandToggle(btn);
  });
  mo.observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });
  toggleObservers.push(mo);
}
function watchAllToggles(roots?: Element[]): void {
  forEachInScope(roots, TOGGLE_SEL, watchToggle);
}

// ---- mark AI continue rows (inherit previous sender's AI state) ----------

function markAIContinueMessages(): void {
  const allRows = document.querySelectorAll(OCTO_SELECTORS.messageRow);
  let currentSenderIsAI = false;
  allRows.forEach((row) => {
    if (row.classList.contains('wk-msg-row--continue')) {
      if (currentSenderIsAI && row.getAttribute('data-ai-continue') !== 'true') {
        row.setAttribute('data-ai-continue', 'true');
      } else if (!currentSenderIsAI && row.getAttribute('data-ai-continue') === 'true') {
        row.removeAttribute('data-ai-continue');
      }
    } else {
      currentSenderIsAI = !!row.querySelector('.ai-badge');
    }
  });
}

// ---- TeX source -> rendered formulas --------------------------------------

const MATH_BODY_SEL = OCTO_SELECTORS.anyMessageBody;
const renderedMathSources = new WeakMap<HTMLElement, DocumentFragment>();
const renderedMathHosts = new Set<HTMLElement>();

const MATH_OPTIONS = {
  // Native MathML keeps the extension small: no KaTeX font bundle or 25 KB
  // stylesheet, and our supported Chrome/Firefox versions both render it.
  output: 'mathml' as const,
  throwOnError: false,
  trust: false,
  maxSize: 20,
};

interface WholeFormula {
  source: string;
  display: boolean;
}

/** Markdown consumes the TeX escape in `\left\{` / `\right\}` before we see it. */
export function repairMarkdownMath(source: string): string {
  return source.replace(/\\(left|right)\s*([{}])/g, '\\$1\\$2');
}

/**
 * Octo's Markdown renderer often turns a three-line `$$ / formula / $$` message
 * into three sibling paragraphs. KaTeX auto-render deliberately won't match
 * delimiters across elements, so recognize whole-message formulas first.
 *
 * Bare formulas are accepted only when they look unambiguously mathematical;
 * this covers pasted `a^2+b^2=c^2` and LaTeX code blocks without turning
 * ordinary source such as `const type=1` into maths.
 */
export function wholeMessageFormula(text: string): WholeFormula | null {
  const value = repairMarkdownMath(text.trim());
  for (const [left, right, display] of [
    ['$$', '$$', true],
    ['\\[', '\\]', true],
    ['\\(', '\\)', false],
    ['$', '$', false],
  ] as const) {
    if (!value.startsWith(left)) continue;
    // Do not reinterpret a broken display delimiter as a single-dollar pair.
    if (left === '$' && (value.startsWith('$$') || value.endsWith('$$'))) return null;
    if (!value.endsWith(right) || value.length <= left.length + right.length) return null;
    return { source: value.slice(left.length, -right.length).trim(), display };
  }

  const hasLatexCommand = /\\[A-Za-z]+/.test(value);
  const proseWords = value.replace(/\\[A-Za-z]+/g, '').match(/[A-Za-z]{4,}/g) || [];
  const bareLatex = hasLatexCommand && value.startsWith('\\');
  // `_` alone is common in identifiers, so accept it only on a one-symbol base.
  const hasMathOperator = /[=^]/.test(value) || /(?:^|[\s([{,+\-*/=])[A-Za-z]_[A-Za-z0-9{]/.test(value);
  const bareEquation = hasMathOperator && proseWords.length === 0 && /^[\sA-Za-z0-9\u0370-\u03ff{}()[\].,+\-*/=^_\\]+$/.test(value);
  if (!bareLatex && !bareEquation) return null;

  try {
    katex.renderToString(value, { ...MATH_OPTIONS, throwOnError: true });
    return { source: value, display: true };
  } catch {
    return null;
  }
}

/** Render standard Markdown/LaTeX delimiters and pasted formula-only messages. */
export function renderMessageMath(roots?: Element[]): void {
  forEachInScope<HTMLElement>(roots, MATH_BODY_SEL, (host) => {
    if (host.querySelector('.katex')) return;
    const text = host.textContent || '';
    const whole = wholeMessageFormula(text);
    if (!whole && !text.includes('$') && !text.includes('\\(') && !text.includes('\\[')) return;

    const source = document.createDocumentFragment();
    host.childNodes.forEach((node) => source.appendChild(node.cloneNode(true)));
    const before = host.querySelectorAll('.katex').length;
    if (whole) {
      katex.render(whole.source, host, { ...MATH_OPTIONS, displayMode: whole.display });
    } else {
      // Repair brace delimiters inside inline formulas too. The original nodes
      // are already cloned above, so teardown still restores exactly what Octo rendered.
      const walker = document.createTreeWalker(host, 4 /* NodeFilter.SHOW_TEXT */);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('code, pre, script, style, textarea')) continue;
        node.nodeValue = repairMarkdownMath(node.nodeValue || '');
      }
      renderMathInElement(host, {
        ...MATH_OPTIONS,
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        errorCallback: () => {},
      });
    }
    if (host.querySelectorAll('.katex').length > before && !renderedMathSources.has(host)) {
      renderedMathSources.set(host, source);
      renderedMathHosts.add(host);
    }
  });

  // Message virtualization detaches old rows; do not retain them for the tab's lifetime.
  renderedMathHosts.forEach((host) => {
    if (!host.isConnected) renderedMathHosts.delete(host);
  });
}

function restoreMessageMath(): void {
  renderedMathHosts.forEach((host) => {
    const source = renderedMathSources.get(host);
    if (source !== undefined && host.isConnected) host.replaceChildren(source.cloneNode(true));
  });
  renderedMathHosts.clear();
}

// ---- WeCom (企业微信) links -> inline card --------------------------------

/**
 * Tag links that point at 企业微信 so CSS can render them as a compact inline
 * card instead of a raw 60-char URL. `/webapp/ts/…` is the schedule (日程)
 * app; anything else on the host gets the generic label.
 *
 * Recognition only — the anchor keeps its href and its normal click behaviour
 * (still opens externally). We deliberately don't try to preview the content:
 * those pages 302 to a QR login, so an in-page iframe would show a login box,
 * and fetching one would mean routing the user's corp ticket through us.
 *
 * Attribute-only writes (no DOM injection) so React re-renders can't fight us,
 * and only changed values are written (idempotent under the sync loop).
 */
const WECOM_HOST = 'work.weixin.qq.com';
const WECOM_LINK_SEL = OCTO_SELECTORS.messageBodyLinks;

/**
 * Classify an href: '' when it isn't a 企业微信 link, otherwise which kind.
 *   /webapp/tm/<tm_code> → meeting  (会议；tm_code is the same value that shows
 *                          up as tm_code= in the app's wxwork://jump deep link)
 *   /webapp/ts/<code>    → schedule (日程)
 *   anything else on the host → link
 * Exported for unit tests; `base` lets tests avoid depending on location.
 */
export function wecomKind(
  href: string,
  base?: string,
): '' | 'meeting' | 'schedule' | 'link' {
  let url: URL;
  try {
    url = new URL(href, base ?? window.location.href);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.hostname !== WECOM_HOST && !url.hostname.endsWith(`.${WECOM_HOST}`)) return '';
  if (url.pathname.startsWith('/webapp/tm/')) return 'meeting';
  if (url.pathname.startsWith('/webapp/ts/')) return 'schedule';
  return 'link';
}

/**
 * Pull the Tencent Meeting code out of a WeCom meeting invite. WeCom's own
 * invite text carries it on a labelled line, e.g.
 *   #企业微信会议：446-153-273
 * and 企业微信 meetings are Tencent Meeting under the hood, so that code can be
 * handed straight to wemeet:// — no token exchange or signature needed (unlike
 * the wxwork://jump deep link, whose jump_code we cannot compute).
 *
 * Only labelled lines are accepted: a bare 9-digit run in chat is far more
 * likely to be a phone number, an order id, or a date range. Returns '' when
 * nothing usable is found.
 */
export function parseMeetingCode(text: string): string {
  if (!text) return '';
  const labelled =
    /(?:企业微信会议|腾讯会议|会议号码|会议号|会议\s*ID|入会号)\s*[:：]?\s*([0-9][0-9\s-]{7,20})/;
  const m = labelled.exec(text);
  if (!m) return '';
  const digits = m[1].replace(/\D/g, '');
  // Tencent Meeting codes are 9 digits today; allow 9–12 for personal/长号.
  return digits.length >= 9 && digits.length <= 12 ? digits : '';
}

/**
 * Deep link that joins a meeting in the local 腾讯会议 client.
 *
 * Must be `page/inmeeting`, not `page/premeeting/join`: both schemes exist and
 * both open the app, but `premeeting/join` only brings up the "enter a meeting
 * number" screen and ignores the code, so nothing is actually joined. The only
 * form observed carrying the code in the shipped client is
 * `wemeet://page/inmeeting?meeting_code=` (grepped out of WeMeetFramework).
 */
export function wemeetJoinUrl(meetingCode: string): string {
  return `wemeet://page/inmeeting?meeting_code=${encodeURIComponent(meetingCode)}`;
}

/**
 * Render the QR for `url` locally as a data URL. Nothing is sent anywhere —
 * these links carry a corp ticket, so a third-party QR service is out of the
 * question. Returns '' if encoding fails (e.g. url too long for the format).
 */
function wecomQrDataUrl(url: string, cellSize = 4): string {
  try {
    // typeNumber 0 = auto-size; 'M' = ~15% error correction (plenty on screen).
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createDataURL(cellSize, 2);
  } catch {
    return '';
  }
}

function clearWecomLinkState(anchor: HTMLAnchorElement): void {
  anchor.removeAttribute('data-octo-wecom');
  anchor.style.removeProperty('--octo-wecom-qr');
  delete anchor.dataset.octoWecomQrFor;
  if (anchor.dataset.octoWecomTitleAdded === 'true') anchor.removeAttribute('title');
  delete anchor.dataset.octoWecomTitleAdded;
}

function tagWecomLinks(roots?: Element[]): void {
  forEachInScope<HTMLAnchorElement>(roots, WECOM_LINK_SEL, (a) => {
    const kind = wecomKind(a.getAttribute('href') || '');
    const current = a.getAttribute('data-octo-wecom');
    if (!kind) {
      if (current !== null) clearWecomLinkState(a);
      return;
    }
    if (current !== kind) a.setAttribute('data-octo-wecom', kind);
    // Surface the real destination on hover, since the card shows a label.
    if (!a.getAttribute('title')) {
      a.setAttribute('title', a.href);
      a.dataset.octoWecomTitleAdded = 'true';
    }
    // Inline QR, painted by CSS from this custom property. Encode once per href
    // (dataset guard) — createDataURL is not free and sync() runs often.
    if (a.dataset.octoWecomQrFor !== a.href) {
      const src = wecomQrDataUrl(a.href);
      if (src) {
        a.style.setProperty('--octo-wecom-qr', `url("${src}")`);
        a.dataset.octoWecomQrFor = a.href;
      }
    }
  });
}

// ---- WeCom meeting card -> launch 腾讯会议 -----------------------------------

/**
 * The card renders everything inline (QR + labels), so there is no popover to
 * open. The only interaction left is the natural link click, and for a meeting
 * invite the useful destination is the local 腾讯会议 client rather than a
 * browser tab that would just show a login QR. Anything else keeps the default
 * behaviour (open the href normally).
 */
let wecomClickHandler: ((event: MouseEvent) => void) | null = null;
function bindWecomCardClicks(): void {
  if (wecomClickHandler) return;
  wecomClickHandler = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest) return;
    const card = target.closest('a[data-octo-wecom="meeting"]') as HTMLAnchorElement | null;
    if (!card) return;
    const host = card.closest(OCTO_SELECTORS.anyMessageBody);
    const code = parseMeetingCode(host?.textContent || '');
    if (!code) return; // no code to join with -> let the link open as usual
    event.preventDefault();
    event.stopPropagation();
    // Custom scheme: assigning location is the most reliable hand-off to the
    // OS handler (window.open can be popup-blocked).
    window.location.href = wemeetJoinUrl(code);
  };
  document.addEventListener('click', wecomClickHandler, true);
}

function removeWecomCardClicks(): void {
  if (wecomClickHandler) document.removeEventListener('click', wecomClickHandler, true);
  wecomClickHandler = null;
}

// ---- single-message height clamp + click to expand -----------------------

const CLAMP_SEL = CLAMP_CANDIDATE_SELECTOR;

/**
 * Run `visit` over every match of `selector`, restricted to the changed subtrees
 * when the sync was able to narrow them down.
 *
 * `root.querySelectorAll()` still evaluates ancestor conditions against the full
 * document, so descendant selectors like `.wk-msg-row--send .wk-markdown` stay
 * correct when scoped — only the *result set* is limited to the subtree.
 */
function forEachInScope<E extends Element>(
  roots: Element[] | undefined,
  selector: string,
  visit: (el: E) => void,
): void {
  if (!roots) {
    document.querySelectorAll<E>(selector).forEach(visit);
    return;
  }
  // A root can itself be a match (a row inserted directly), and roots can
  // overlap, so dedupe before visiting.
  const seen = new Set<Element>();
  for (const root of roots) {
    if (!root.isConnected) continue;
    if (root.matches(selector) && !seen.has(root)) {
      seen.add(root);
      visit(root as E);
    }
    root.querySelectorAll<E>(selector).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      visit(el);
    });
  }
}

/**
 * Message bodies whose height we have already judged. Measuring means reading
 * `scrollHeight`, which forces a synchronous layout, so we do it once per
 * element instead of re-measuring every message on every sync.
 *
 * A `WeakSet` is deliberate: the conversation list recycles and drops thousands
 * of rows over a long session, and anything holding strong references to them
 * (a `ResizeObserver`, a `Set`) would leak them for the lifetime of the tab.
 */
let clampMeasured = new WeakSet<Element>();
/** Elements whose size may have changed and need a fresh verdict. */
let clampDirty = new Set<Element>();
let clampInvalidatorsBound = false;
let clampMediaLoadHandler: ((event: Event) => void) | null = null;
let clampResizeHandler: (() => void) | null = null;

/**
 * Two things can change a message's height after we measured it: media inside it
 * finishing load, and the viewport changing width (which re-wraps text).
 *
 * Both are handled with a fixed number of listeners rather than per-element
 * observation, so cost and memory do not grow with conversation length.
 */
function bindClampInvalidators(): void {
  if (clampInvalidatorsBound) return;
  clampInvalidatorsBound = true;

  // `load` does not bubble, so capture it at the document.
  clampMediaLoadHandler = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    const host = target.closest<HTMLElement>(CLAMP_SEL);
    // An already-clamped message can only grow further, so its verdict stands;
    // re-dirtying it here would also spin against our own class writes.
    if (!host || host.classList.contains('octo-clamp')) return;
    clampDirty.add(host);
    scheduleSync();
  };
  document.addEventListener('load', clampMediaLoadHandler, true);

  // A width change re-wraps every message, so drop all verdicts and re-measure
  // the candidates once. Debounced by the sync itself.
  clampResizeHandler = () => {
    clampMeasured = new WeakSet<Element>();
    scheduleSync();
  };
  window.addEventListener('resize', clampResizeHandler);
}

function unbindClampInvalidators(): void {
  if (clampMediaLoadHandler) {
    document.removeEventListener('load', clampMediaLoadHandler, true);
    clampMediaLoadHandler = null;
  }
  if (clampResizeHandler) {
    window.removeEventListener('resize', clampResizeHandler);
    clampResizeHandler = null;
  }
  clampInvalidatorsBound = false;
}

/**
 * Decide which message bodies need the "展开全文" affordance.
 *
 * Reads and writes are split into two loops on purpose: interleaving a
 * `scrollHeight` read with a `classList` write forces one layout *per message*,
 * which is what made long conversations stutter. Batching gives a single layout
 * for the whole pass.
 */
function applyClamp(roots?: Element[]): void {
  bindClampInvalidators();

  // Pass 1 (read-only): measure just the elements we have never judged or whose
  // size changed, and record the verdict.
  const verdicts: Array<{ el: HTMLElement; tall: boolean; wecom: boolean }> = [];
  const consider = (el: HTMLElement) => {
    if (clampMeasured.has(el) && !clampDirty.has(el)) return;

    // Never clamp a message that carries a 企业微信 card: the 240px limit cuts the
    // QR in half and drops the "展开全文" gradient right on top of it, leaving a
    // code nobody can scan. These messages are short anyway — it is the card that
    // makes them tall, not a wall of text.
    const wecom = el.querySelector('a[data-octo-wecom]') != null;
    verdicts.push({ el, wecom, tall: !wecom && el.scrollHeight > CLAMP_HEIGHT + 8 });
  };

  forEachInScope<HTMLElement>(roots, CLAMP_SEL, consider);
  // Elements dirtied by a late image load may sit outside the changed subtrees.
  clampDirty.forEach((el) => {
    if (el.isConnected && el instanceof HTMLElement) consider(el);
  });

  clampDirty.clear();
  if (verdicts.length === 0) return;

  // Pass 2 (write-only): now that every measurement is done, mutate classes.
  for (const { el, tall, wecom } of verdicts) {
    if (tall) el.classList.add('octo-clamp');
    else el.classList.remove('octo-clamp', 'octo-expanded');

    // A WeCom card can be tagged after the first measurement, so keep such
    // elements re-checkable rather than marking them settled.
    if (wecom) clampMeasured.delete(el);
    else clampMeasured.add(el);
  }
}

/** Drop all clamp bookkeeping (used by teardown and on master switch off). */
function resetClampState(): void {
  unbindClampInvalidators();
  clampMeasured = new WeakSet<Element>();
  clampDirty = new Set<Element>();
}

let clickBound = false;
let clickHandler: ((e: Event) => void) | null = null;
function bindClicks(): void {
  if (clickBound) return;
  clickBound = true;
  clickHandler = (e: Event) => {
    const target = e.target as HTMLElement;
    const clamp = target.closest && target.closest('.octo-clamp');
    if (clamp && !target.closest('a, button, code, pre, img')) {
      clamp.classList.toggle('octo-expanded');
    }
  };
  document.addEventListener('click', clickHandler, true);
}
function removeClicks(): void {
  if (clickHandler) document.removeEventListener('click', clickHandler, true);
  clickHandler = null;
  clickBound = false;
}

// ---- bot profile card gacha: roll a rarity per open + reveal FX ------------

/**
 * Opening a bot's profile card is a Pokémon-style "draw": each time a card
 * mounts we roll a weighted-random rarity and stamp it on the shell + content
 * as `data-octo-rarity`. CSS then paints the foil frame, corner badge, and (for
 * SSR/UR) the glow pulse; a body-level overlay plays the reveal ceremony.
 *
 * The roll is per shell INSTANCE: a shell that already carries a rarity keeps
 * it (re-renders don't reroll), but closing and reopening the card mounts a
 * fresh shell, so it draws again. This is purely a read (Math.random) + our own
 * attribute writes — no source patching, no React state mutation.
 */
type Rarity = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

// Weighted tiers — rarer draws are scarcer (sum = 100).
const RARITY_TIERS: ReadonlyArray<{ key: Rarity; weight: number }> = [
  { key: 'N', weight: 40 }, // 普通 银
  { key: 'R', weight: 30 }, // 稀有 蓝
  { key: 'SR', weight: 18 }, // 超稀有 紫
  { key: 'SSR', weight: 9 }, // 特级 金
  { key: 'UR', weight: 3 }, // 极稀 彩虹
];

function pickRarity(): Rarity {
  const total = RARITY_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * total;
  for (const tier of RARITY_TIERS) {
    r -= tier.weight;
    if (r < 0) return tier.key;
  }
  return 'N';
}

/**
 * Reveal ceremony for a fresh draw. Injected into <body> (outside the modal's
 * React tree so reconciliation can't wipe it) and self-removed after it plays.
 * Only SR+ get a ceremony — keeping N/R silent makes the high tiers land. The
 * screen-blend flash/rays need the CSS dim backdrop to show on a light page.
 */
function playGachaReveal(rarity: Rarity): void {
  if (rarity !== 'SR' && rarity !== 'SSR' && rarity !== 'UR') return;
  if (prefersReducedMotion()) return;
  const fx = document.createElement('div');
  fx.className = 'octo-gacha-fx';
  fx.setAttribute('data-octo-rarity', rarity);
  // Built node-by-node rather than with innerHTML: this runs in the page MAIN
  // world, so an innerHTML template here becomes an injection sink the moment
  // any part of it stops being a literal.
  for (const part of ['flash', 'rays', 'spark']) {
    const layer = document.createElement('div');
    layer.className = `octo-gacha-${part}`;
    fx.appendChild(layer);
  }
  (document.body || document.documentElement).appendChild(fx);
  window.setTimeout(() => fx.remove(), 1300);
}

function isRarity(value: string | null): value is Rarity {
  return (
    value === 'N' ||
    value === 'R' ||
    value === 'SR' ||
    value === 'SSR' ||
    value === 'UR'
  );
}

function rollBotCardRarity(): void {
  document
    .querySelectorAll<HTMLElement>(OCTO_SELECTORS.botCardShell)
    .forEach((shell) => {
      const existing = shell.getAttribute('data-octo-rarity');
      let rarity: Rarity;
      if (isRarity(existing)) {
        rarity = existing;
      } else {
        rarity = pickRarity();
        shell.setAttribute('data-octo-rarity', rarity);
        try {
          playGachaReveal(rarity); // fresh draw → play the reveal
        } catch {
          /* noop */
        }
      }
      // Mirror onto the content node — the corner badge ::after reads it via attr().
      const content = shell.querySelector(OCTO_SELECTORS.botCardContent);
      if (content && content.getAttribute('data-octo-rarity') !== rarity) {
        content.setAttribute('data-octo-rarity', rarity);
      }
    });
}

// ---- bot profile card: 3D pointer tilt -------------------------------------
//
// 字段分组曾靠 tagBotDetailFields() 给 .wk-bot-detail-desc 打 data-octo-*，但
// octo-web #889/#891 profile 重构后已原生用 .wk-bot-detail-section 分组，CSS 直接
// 贴合新结构，无需再打标记 —— 该函数已随之移除。

/**
 * Trading-card feel: the shell tilts toward the pointer in 3D (CSS vars drive
 * its rotateX/Y) and a holographic glare follows the cursor. The frame, foil,
 * float, and glare surface are pure CSS; JS only feeds pointer position. Bound
 * once per shell (WeakSet); skipped under reduced-motion.
 */
const TILT_SMOOTHING = 0.22;

interface BotTiltState {
  current: CardTilt;
  target: CardTilt;
  rect: CardTiltRect | null;
  frame: number | null;
  controller: AbortController;
}

let botTiltBound = new WeakSet<HTMLElement>();
let botTiltStates = new WeakMap<HTMLElement, BotTiltState>();

function writeBotCardTilt(el: HTMLElement, tilt: CardTilt): void {
  el.style.setProperty('--octo-card-ry', `${tilt.ry.toFixed(2)}deg`);
  el.style.setProperty('--octo-card-rx', `${tilt.rx.toFixed(2)}deg`);
  el.style.setProperty('--octo-card-mx', `${tilt.mx.toFixed(1)}%`);
  el.style.setProperty('--octo-card-my', `${tilt.my.toFixed(1)}%`);
}

function scheduleBotCardTilt(el: HTMLElement, state: BotTiltState): void {
  if (state.frame !== null) return;
  state.frame = window.requestAnimationFrame(() => {
    state.frame = null;
    state.current = interpolateCardTilt(state.current, state.target, TILT_SMOOTHING);
    writeBotCardTilt(el, state.current);
    if (isCardTiltSettled(state.current, state.target)) {
      state.current = { ...state.target };
      writeBotCardTilt(el, state.current);
      if (isCardTiltSettled(state.target, CARD_TILT_NEUTRAL)) {
        el.removeAttribute('data-octo-card-tilting');
      }
      return;
    }
    scheduleBotCardTilt(el, state);
  });
}

function resetBotCardTilt(el: HTMLElement): void {
  const state = botTiltStates.get(el);
  if (!state) return;
  state.rect = null;
  state.target = { ...CARD_TILT_NEUTRAL };
  scheduleBotCardTilt(el, state);
}

function removeBotCardTilt(): void {
  document.querySelectorAll<HTMLElement>(OCTO_SELECTORS.botCardShell).forEach((el) => {
    const state = botTiltStates.get(el);
    if (state) {
      if (state.frame !== null) window.cancelAnimationFrame(state.frame);
      state.controller.abort();
    }
    el.removeAttribute('data-octo-card-tilting');
  });
  botTiltBound = new WeakSet<HTMLElement>();
  botTiltStates = new WeakMap<HTMLElement, BotTiltState>();
}

function bindBotCardTilt(): void {
  if (prefersReducedMotion()) return;
  document
    .querySelectorAll<HTMLElement>(OCTO_SELECTORS.botCardShell)
    .forEach((el) => {
      if (botTiltBound.has(el)) return;
      botTiltBound.add(el);
      const state: BotTiltState = {
        current: { ...CARD_TILT_NEUTRAL },
        target: { ...CARD_TILT_NEUTRAL },
        rect: null,
        frame: null,
        controller: new AbortController(),
      };
      botTiltStates.set(el, state);
      const updateTarget = (event: PointerEvent) => {
        const rect = state.rect ?? el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        state.rect = rect;
        state.target = cardTiltForPointer(rect, event.clientX, event.clientY);
        el.setAttribute('data-octo-card-tilting', 'true');
        scheduleBotCardTilt(el, state);
      };
      el.addEventListener('pointerenter', updateTarget, { signal: state.controller.signal });
      el.addEventListener('pointermove', updateTarget, { signal: state.controller.signal });
      el.addEventListener('pointerleave', () => resetBotCardTilt(el), {
        signal: state.controller.signal,
      });
      el.addEventListener('pointercancel', () => resetBotCardTilt(el), {
        signal: state.controller.signal,
      });
    });
}

// ---- worldcup soccer ball: real DOM node + 5 selectable kick styles -------

// Bubbles that carry a corner ball under the worldcup skin.
// Same element set as the clamp: both hang off a message body. Previously this
// was a verbatim copy of the clamp selector, so the two could drift apart.
const BALL_HOST_SEL = CLAMP_CANDIDATE_SELECTOR;

const BALL_CLASS = 'octo-wc-ball';
const kickingBalls = new WeakSet<HTMLElement>();
let ballsMounted = false;


let currentKickStyle = DEFAULT_KICK_STYLE;
export function setKickStyle(id: string): void {
  currentKickStyle = kickStyleById(id).id;
  // Reflect onto <body> so the chat-area background CSS (per-style) can match.
  if (document.body) document.body.setAttribute('data-octo-kick-style', currentKickStyle);
  setFullscreenKickStyle(currentKickStyle);
}

/** Toggle the football-cursor replacement (independent of the kick/watermark). */
export function setBallCursor(enabled: boolean): void {
  setFullscreenKickBallCursor(enabled);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Kick a ball with the currently-selected style. The trajectory + effects are
 * CSS `@keyframes` (see BEAUTIFY_CSS, ported from the design preview); JS just
 * sets the travel distance, arms the effect nodes, retriggers the animation,
 * fires the goal/bubble shake, and cleans up on animationend (+ a safety
 * timeout so a backgrounded tab can never leave a ball stuck "live").
 */
function kickBall(ball: HTMLElement): void {
  if (kickingBalls.has(ball)) return; // one kick at a time per ball
  if (prefersReducedMotion()) return;
  const host = ball.parentElement as HTMLElement | null;
  if (!host) return;
  const style = kickStyleById(currentKickStyle);

  kickingBalls.add(ball);

  // Travel distance = bubble inner width minus the ball and both corner insets.
  const dist = Math.max(70, Math.min(560, host.clientWidth - 26 - 24));
  host.style.setProperty('--octo-go', dist + 'px');
  host.setAttribute('data-octo-kick', style.id);

  // (Re)build effect nodes for this style (bolt/flame/ghost.../trail/shock).
  host.querySelectorAll(`.${BALL_CLASS}-fx`).forEach((n) => n.remove());
  style.fx.forEach((fx, i) => {
    const el = document.createElement('span');
    el.className = `${BALL_CLASS}-fx octo-fx-${fx}${fx === 'ghost' ? ' octo-fx-ghost' + (i + 1) : ''}`;
    el.setAttribute('aria-hidden', 'true');
    host.insertBefore(el, ball); // behind the ball
  });

  // Retrigger the CSS animation from the start.
  ball.classList.add('octo-wc-live');
  ball.style.animation = 'none';
  // force reflow so removing+re-adding animation restarts it
  void ball.offsetWidth;
  ball.style.animation = '';

  // Goal net + bubble shake on impact styles.
  if (style.shake) {
    const goal = host.querySelector('.octo-wc-goal');
    if (goal) { goal.classList.remove('octo-shake'); void (goal as HTMLElement).offsetWidth; goal.classList.add('octo-shake'); }
    if (style.id === 'cannon') {
      host.classList.remove('octo-boom'); void host.offsetWidth; host.classList.add('octo-boom');
    }
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(safety);
    ball.removeEventListener('animationend', onEnd);
    ball.classList.remove('octo-wc-live');
    ball.style.animation = '';
    host.classList.remove('octo-boom');
    host.removeAttribute('data-octo-kick');
    host.querySelectorAll(`.${BALL_CLASS}-fx`).forEach((n) => n.remove());
    kickingBalls.delete(ball);
  };
  const onEnd = (e: AnimationEvent) => { if (e.target === ball) finish(); };
  ball.addEventListener('animationend', onEnd);
  // Safety: backgrounded tabs pause CSS anims + this timer, but on return the
  // timer resumes and force-cleans; also covers browsers that drop animationend.
  const safety = window.setTimeout(finish, style.dur + 400);
}

function ensureBall(host: HTMLElement): void {
  if (host.querySelector(`:scope > .${BALL_CLASS}`)) return;
  // goal (right-side net) — target of the shot
  const goal = document.createElement('span');
  goal.className = 'octo-wc-goal';
  goal.setAttribute('aria-hidden', 'true');
  host.appendChild(goal);
  // the ball
  const ball = document.createElement('span');
  ball.className = BALL_CLASS;
  ball.setAttribute('aria-hidden', 'true');
  host.appendChild(ball);
  // Hover the bubble -> kick this bubble's ball.
  host.addEventListener('mouseenter', () => {
    const b = host.querySelector<HTMLElement>(`:scope > .${BALL_CLASS}`);
    if (b) kickBall(b);
  });
}

function mountBalls(): void {
  ballsMounted = true;
  document.querySelectorAll<HTMLElement>(BALL_HOST_SEL).forEach(ensureBall);
}

function unmountBalls(): void {
  ballsMounted = false;
  document.querySelectorAll<HTMLElement>(`.${BALL_CLASS}, .octo-wc-goal, .${BALL_CLASS}-fx`).forEach((b) => b.remove());
}

/** Called from sync(): keep balls in step with the active skin. */
function syncBalls(): void {
  const worldcup = themeById(currentThemeId).skin === 'worldcup';
  if (worldcup) mountBalls();
  else if (ballsMounted) unmountBalls();
}

// ---- pixel skin: hover-to-bump ------------------------------------------
// The scene is injected into <body> — outside the message's React tree, so
// reconciliation cannot wipe it mid-animation — and removes itself when done.
//
// Delegation on document rather than a node per bubble is deliberate: this pass
// must not get more expensive as a conversation grows. Mounting a sprite per
// message (the way the worldcup ball does) costs nothing at 20 messages and
// wrecks sync at 3000.

const PIXEL_HIT_CLASS = 'octo-pixel-hit';
/** Must outlast the slowest pearl: 1.15s base + up to 0.13s duration jitter +
 *  up to 0.09s start delay. The pearls outlast the jump on purpose — they have to
 *  sit on the bubble for a beat, otherwise they read as flying past. */
const PIXEL_HIT_MS = 1550;
const PIXEL_HIT_COOLDOWN_MS = 1700;
/** 48 = 24px 精灵的 2 倍。整数倍是硬要求：1.33 倍这种会让 pixelated
 *  把一个源像素切成宽窄不一的块，边缘立刻变脏。 */
const PIXEL_SPRITE_PX = 48;
const PIXEL_HIT_W = PIXEL_SPRITE_PX + 8;
/**
 * 起跳距离的下限。气泡矮到装不下一次完整起跳时（48px 的角色 + 48px 的箱子
 * 本就比一条单行消息高），角色会顶穿箱子一点 —— 这比让箱子飘到上一条消息
 * 旁边好：宁可跳得浅，也要让人看出这套动画属于哪条消息。
 */
const PIXEL_RISE_MIN = 28;
/**
 * 起跳距离的上限，两个身高。
 * 场景本来是严格贴着气泡的（箱子压顶沿、角色站底沿），高气泡就意味着高跳：
 * 一条折叠的长消息足有 240px，算下来要跳 192px —— 四个身高，而时长还是那
 * 0.75s，看着就是嗖地飞出去。超过上限后箱子不再贴顶沿，改为悬在角色上方两个
 * 身高处，仍在气泡范围内，归属一样看得出来。
 */
const PIXEL_RISE_MAX = PIXEL_SPRITE_PX * 2;
/** Must match `.oph-pearl { top }` in BEAUTIFY_CSS. */
const PEARL_TOP_PX = 4;
/** Where the pearl's art ends inside its 48px box (the sprite has empty rows
 *  below it), i.e. how far down its visible bottom edge sits. */
const PEARL_ART_BOTTOM_PX = 34;
/**
 * How far a pearl may fall. The chest occupies the scene's top PIXEL_SPRITE_PX,
 * so that line is also the bubble's top edge — and a pearl must never cross it.
 * Pearls are opaque sprites: landing one *on* the bubble means covering the
 * message with decoration, and a message being obscured while someone reads it
 * matters far more than how the animation looks. So they pile up along the
 * bubble's top edge instead of scattering across its face.
 */
const PEARL_LAND_MAX_PX = PIXEL_SPRITE_PX - PEARL_ART_BOTTOM_PX - PEARL_TOP_PX;
/** How many pearls a bump can throw. Rolled per hit. */
const PEARL_MIN = 1;
const PEARL_MAX = 10;
/**
 * Distance from the scene to where the nearest pearl may land, in px.
 * The scene sits 8px off the bubble and a pearl's art is centred in its 48px box,
 * so anything closer than this drops into the gap between the two instead of
 * onto the message.
 */
const PEARL_INSET_PX = 44;
/** Cap on how far a pearl is thrown, so a very wide bubble does not fling one
 *  across the whole conversation. */
const PEARL_REACH_MAX_PX = 420;

/**
 * Arc shape per pearl: low lob for the ones landing short, high lob for the ones
 * thrown far. Tying the arc to the distance is what keeps a ten-pearl burst from
 * looking like ten copies of the same throw.
 */
function pearlArc(index: number, count: number): 'a' | 'b' | 'c' {
  const at = count <= 1 ? 0.5 : index / (count - 1);
  if (at < 0.34) return 'c';
  return at < 0.67 ? 'a' : 'b';
}

/**
 * 悬停多久才认为是"停在这条消息上"。
 * 没有这段延迟时，视线沿列表往下走、鼠标顺带扫过，每条消息都会炸出一套动画 ——
 * 正在读的东西旁边不停有东西在跳，这是最伤可读性的一点。
 */
const PIXEL_HOVER_DELAY_MS = 350;

/**
 * 滚动停下多久才重新允许触发。
 * 滚动时指针虽然没动，新的气泡却会滑到它下面，pointerover 照样在报 —— 没有这个
 * 静默期，翻记录的过程中会一路弹动画。
 */
const PIXEL_SCROLL_QUIET_MS = 300;
/** 滚动期间挂在 <body> 上，让皮肤把气泡的 hover 反馈整个停掉。 */
const PIXEL_SCROLLING_ATTR = 'data-octo-px-scrolling';

let pixelHoverBound = false;
let pixelHitCooldown = new WeakSet<Element>();
let pixelHoverTimer: number | undefined;
let pixelHoverTarget: Element | null = null;
let pixelSceneLive = false;
let pixelScrolledAt = 0;
let pixelScrolling = false;
let pixelScrollTimer: number | undefined;

/**
 * AI 消息派章鱼，其它派潜水员。
 * 判据跟着皮肤的三档气泡走：带 ai-badge 的行、标记了 AI 连续的行，以及折叠的
 * AI 会话块。判不出来时按"人"算 —— 把人错当成 AI 比反过来更容易让人误会。
 */
function isAiMessage(bubble: Element): boolean {
  if (bubble.matches(OCTO_SELECTORS.foldMessageBody)) return true;
  const row = bubble.closest(OCTO_SELECTORS.messageRow);
  if (!row) return false;
  return (
    row.querySelector(OCTO_SELECTORS.aiBadge) != null ||
    row.getAttribute('data-ai-continue') === 'true'
  );
}

function spawnPixelHit(bubble: Element): void {
  const r = bubble.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // The scene spans the bubble: the chest's bottom edge sits on the bubble's
  // top edge, the character stands on its bottom edge. The previous fixed 144px
  // box floated the chest ~80px above a one-line message — right next to the
  // message above it, which is the one it appeared to belong to.
  //
  // Capped, though: past PIXEL_RISE_MAX the chest stops tracking the top edge
  // and just hangs two character-heights up. A clamped long message is 240px
  // tall and would otherwise ask for a 192px leap in the same 0.75s.
  const height = Math.min(
    Math.round(r.height) + PIXEL_SPRITE_PX,
    PIXEL_SPRITE_PX * 2 + PIXEL_RISE_MAX,
  );
  // Prefer the gutter to the right of the bubble; fall back to the left; if
  // neither side fits, skip it.
  let left = r.right + 8;
  let flipped = false;
  if (left + PIXEL_HIT_W > window.innerWidth - 6) {
    left = r.left - 8 - PIXEL_HIT_W;
    flipped = true;
  }
  if (left < 6) return;
  const top = Math.max(6, Math.min(Math.round(r.bottom) - height, window.innerHeight - height - 6));

  const fx = document.createElement('div');
  fx.className = PIXEL_HIT_CLASS;
  fx.setAttribute('aria-hidden', 'true');
  fx.setAttribute('data-octo-actor', isAiMessage(bubble) ? 'ai' : 'human');
  fx.style.left = `${Math.round(left)}px`;
  fx.style.top = `${Math.round(top)}px`;
  fx.style.height = `${height}px`;
  // Character sits at the bottom, chest at the top — the rise is whatever is
  // left between them, so the jump always lands on the chest's underside.
  fx.style.setProperty('--oph-rise', `${Math.max(PIXEL_RISE_MIN, height - PIXEL_SPRITE_PX * 2)}px`);
  // Pearls are thrown *at the bubble* and settle on it, rather than looping
  // inside the gutter: signed so they fly toward the message whichever side the
  // scene ended up on, capped so a very wide bubble does not fling them across
  // the whole conversation.
  // Pearls are spread from the bubble's near edge to its far edge. The reach is
  // measured from PEARL_INSET_PX, not from the scene, so ratio 0 already lands
  // inside the bubble rather than in the 8px gap beside it.
  const span = Math.min(Math.round(r.width) + 8, PEARL_REACH_MAX_PX);
  const reach = Math.max(48, span - PEARL_INSET_PX);

  const pearlCount = PEARL_MIN + Math.floor(Math.random() * (PEARL_MAX - PEARL_MIN + 1));
  // Built node by node rather than with innerHTML: this runs in the page MAIN
  // world, where an innerHTML template becomes an injection sink the moment any
  // part of it stops being a literal (same reasoning as playGachaReveal).
  const chest = document.createElement('div');
  chest.className = 'oph-chest';
  fx.appendChild(chest);

  // Each pearl gets its own slice of the spread and rolls inside it. Pure
  // randomness would let them pile onto one spot; fixed positions gave the
  // trick away after two bumps.
  for (let i = 0; i < pearlCount; i++) {
    const pearl = document.createElement('div');
    pearl.className = `oph-pearl oph-pearl-${pearlArc(i, pearlCount)}`;
    const ratio = (i + Math.random()) / pearlCount;
    const dist = PEARL_INSET_PX + reach * ratio;
    pearl.style.setProperty('--oph-x', `${Math.round(flipped ? dist : -dist)}px`);
    pearl.style.setProperty('--oph-y', `${Math.round(Math.random() * PEARL_LAND_MAX_PX)}px`);
    // Stagger duration and start so a burst scatters instead of marching in step.
    pearl.style.animationDuration = `${(1.02 + Math.random() * 0.26).toFixed(2)}s`;
    pearl.style.animationDelay = `${Math.round(Math.random() * 90)}ms`;
    fx.appendChild(pearl);
  }

  const hero = document.createElement('div');
  hero.className = 'oph-hero';
  fx.appendChild(hero);
  (document.body || document.documentElement).appendChild(fx);
  pixelSceneLive = true;
  window.setTimeout(() => {
    fx.remove();
    pixelSceneLive = false;
  }, PIXEL_HIT_MS);
}

function onPixelHover(e: Event): void {
  if (!started) return;
  if (themeById(currentThemeId).skin !== 'pixel') return;
  if (prefersReducedMotion()) return;
  const target = e.target;
  const bubble =
    target instanceof Element ? target.closest(OCTO_SELECTORS.anyMessageBody) : null;
  // pointerover fires for every descendant; only a change of bubble matters.
  if (bubble === pixelHoverTarget) return;
  pixelHoverTarget = bubble;
  if (pixelHoverTimer !== undefined) {
    window.clearTimeout(pixelHoverTimer);
    pixelHoverTimer = undefined;
  }
  if (!bubble || pixelHitCooldown.has(bubble)) return;

  pixelHoverTimer = window.setTimeout(() => {
    pixelHoverTimer = undefined;
    // The pointer may have moved on while we waited.
    if (pixelHoverTarget !== bubble) return;
    if (Date.now() - pixelScrolledAt < PIXEL_SCROLL_QUIET_MS) return;
    // One scene at a time. The per-bubble cooldown alone does not stop a pointer
    // swept down the list from arming ten of them at once — each on a different
    // bubble, all still on screen — which is a shower of pearls, not an effect.
    // Queried from the DOM rather than tracked in a flag so a scene removed by
    // anything else (teardown, the user's own extension) cannot wedge it shut.
    if (document.querySelector(`.${PIXEL_HIT_CLASS}`)) return;
    pixelHitCooldown.add(bubble);
    window.setTimeout(() => pixelHitCooldown.delete(bubble), PIXEL_HIT_COOLDOWN_MS);
    try {
      spawnPixelHit(bubble);
    } catch {
      /* noop — a decorative animation is never worth breaking a hover. */
    }
  }, PIXEL_HOVER_DELAY_MS);
}

/**
 * Scrolling kills the scene outright.
 *
 * It is `position: fixed` at coordinates taken from getBoundingClientRect() the
 * moment it spawned, so the instant the list moves it is pinned to a spot its
 * message has left — a chest and a fistful of pearls hanging over nothing. There
 * is no cheap fix for that: following the bubble would mean repositioning every
 * frame. Since nobody is watching a hover flourish while scrolling anyway,
 * dropping it is both the honest and the cheap answer.
 */
function onPixelScroll(): void {
  pixelScrolledAt = Date.now();
  // 停掉气泡的 hover 反馈。指针并没有动，是消息从它底下滑过 —— 每条经过的
  // 都会被 hover 一次、上浮 2px 再落回，整列表跟着起伏。那不是交互，是抖动。
  // 只在本皮肤内关：这个 hover 是基础层的，改它会波及所有主题。
  if (!pixelScrolling) {
    pixelScrolling = true;
    document.body?.setAttribute(PIXEL_SCROLLING_ATTR, '');
  }
  if (pixelScrollTimer !== undefined) window.clearTimeout(pixelScrollTimer);
  pixelScrollTimer = window.setTimeout(() => {
    pixelScrollTimer = undefined;
    pixelScrolling = false;
    document.body?.removeAttribute(PIXEL_SCROLLING_ATTR);
  }, PIXEL_SCROLL_QUIET_MS);
  if (pixelHoverTimer !== undefined) {
    window.clearTimeout(pixelHoverTimer);
    pixelHoverTimer = undefined;
  }
  // Forget the hovered bubble too: after a scroll the pointer sits over
  // whatever slid under it, and that is not a hover the user performed.
  pixelHoverTarget = null;
  if (!pixelSceneLive) return;
  pixelSceneLive = false;
  document.querySelectorAll(`.${PIXEL_HIT_CLASS}`).forEach((el) => el.remove());
}

function bindPixelHover(): void {
  if (pixelHoverBound) return;
  pixelHoverBound = true;
  document.addEventListener('pointerover', onPixelHover, true);
  // Capture phase: scroll does not bubble, and the list scrolls in its own
  // container rather than on the document.
  document.addEventListener('scroll', onPixelScroll, true);
}

/** Must stay callable when the feature never started — see PAGE_FEATURES. */
function unbindPixelHover(): void {
  if (!pixelHoverBound) return;
  pixelHoverBound = false;
  document.removeEventListener('pointerover', onPixelHover, true);
  document.removeEventListener('scroll', onPixelScroll, true);
  pixelSceneLive = false;
  if (pixelScrollTimer !== undefined) {
    window.clearTimeout(pixelScrollTimer);
    pixelScrollTimer = undefined;
  }
  pixelScrolling = false;
  document.body?.removeAttribute(PIXEL_SCROLLING_ATTR);
  if (pixelHoverTimer !== undefined) {
    window.clearTimeout(pixelHoverTimer);
    pixelHoverTimer = undefined;
  }
  pixelHoverTarget = null;
  pixelHitCooldown = new WeakSet<Element>();
}

// ---- unified debounced DOM sync ------------------------------------------

function debounce(fn: () => void, wait: number): () => void {
  let t: number | undefined;
  return function () {
    if (t) clearTimeout(t);
    t = window.setTimeout(fn, wait);
  };
}

let bodyObserver: MutationObserver | null = null;
let syncing = false;
/** Work the next debounced sync has to do, accumulated across mutation batches. */
let pendingScope: SyncScope<Element> = EMPTY_SYNC_SCOPE;

/**
 * Apply everything the current settings imply.
 *
 * `scope` narrows the work to what the observed mutations actually require. The
 * theme reflections are always cheap attribute writes so they run
 * unconditionally; the message passes walk every row in the conversation, so
 * they only run when rows were added or removed. That is the difference between
 * "unrelated DOM churn is free" and "every tooltip costs an O(messages) rescan".
 *
 * Passing a fully-populated scope (the default) forces a complete pass, which is
 * what boot, theme switches and re-enable need.
 */
function sync(scope: SyncScope<Element> = FULL_SYNC_SCOPE): void {
  if (!started) return;
  // Re-entrancy + self-mutation guard: our own DOM writes below (attributes,
  // clamp classes, fold-expand clicks) would otherwise retrigger the body
  // observer and spin. Disconnect while we mutate, reconnect after.
  if (syncing) return;
  syncing = true;
  if (bodyObserver) bodyObserver.disconnect();
  try {
    try { reflectTheme(currentThemeId); } catch { /* noop */ }
    try { reflectGlobalTheme(currentGlobalThemeId); } catch { /* noop */ }
    try { syncBalls(); } catch { /* noop */ }

    if (scope.messages) {
      const roots = scope.roots;
      try { watchAllToggles(roots); } catch { /* noop */ }
      try { expandAllFoldSessions(roots); } catch { /* noop */ }
      // Deliberately NOT scoped: the AI-continue chain is sequential over the
      // whole list, so inserting one row can change the flag on rows after it.
      try { markAIContinueMessages(); } catch { /* noop */ }
      // Formula rendering and link tagging both affect the final message height,
      // so they must happen before the clamp measures it.
      try { renderMessageMath(roots); } catch { /* noop */ }
      // The clamp skips messages carrying a 企业微信 card, and it can only see
      // them once the anchors are tagged.
      try { tagWecomLinks(roots); } catch { /* noop */ }
      try { applyClamp(roots); } catch { /* noop */ }
    } else {
      // No structural change, but a late image load may still have dirtied a
      // measured element; the pass early-exits when there is nothing to do.
      try { applyClamp([]); } catch { /* noop */ }
    }

    if (scope.botCard) {
      try { rollBotCardRarity(); } catch { /* noop */ }
      try { bindBotCardTilt(); } catch { /* noop */ }
    }
  } finally {
    if (bodyObserver && document.body) {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
    syncing = false;
  }
}

const runPendingSync = (): void => {
  const scope = pendingScope;
  pendingScope = EMPTY_SYNC_SCOPE;
  sync(scope);
};

const scheduleDebouncedSync = debounce(runPendingSync, 120);

/**
 * Queue a full document-wide sync. Used by settings changes and by the clamp
 * invalidators, where we have no useful subtree to narrow to.
 */
function scheduleSync(): void {
  pendingScope = FULL_SYNC_SCOPE;
  scheduleDebouncedSync();
}

/** Queue only the work a mutation batch implies, over only the subtrees it touched. */
function scheduleScopedSync(scope: SyncScope<Element>): void {
  pendingScope = mergeScopes(pendingScope, scope);
  scheduleDebouncedSync();
}

function onBodyMutations(records: MutationRecord[]): void {
  const scope = classifyMutations<Node>(records);
  // A bot card mounting must be stamped SYNCHRONOUSLY (before the next paint),
  // otherwise the card renders bare for ~120ms and the foil frame / corner badge
  // pop in afterwards. Everything else rides the debounce.
  if (scope.botCard) {
    try { rollBotCardRarity(); } catch { /* noop */ }
  }
  // Unrelated churn (tooltips, hover states, our own overlays) lands here with
  // an empty scope and is dropped without touching the conversation.
  if (isEmptyScope(scope)) return;
  scheduleScopedSync({
    messages: scope.messages,
    botCard: scope.botCard,
    roots: scope.roots as Element[] | undefined,
  });
}

let started = false;

/**
 * Initialize the beautify engine once. `initialThemeId` is the theme resolved
 * from extension storage; later changes come via setTheme().
 */
export function initBeautify(initialThemeId: string): void {
  if (started) {
    setTheme(initialThemeId);
    return;
  }
  started = true;
  currentThemeId = themeById(initialThemeId).id;

  const boot = () => {
    if (!started) return;
    nativeThemeMode = document.body.getAttribute('theme-mode');
    injectStyles();
    setTheme(currentThemeId);
    setGlobalTheme(currentGlobalThemeId);
    setKickStyle(currentKickStyle); // reflect default kick style onto <body> for bg CSS
    reflectQQSelfLeft(); // re-apply if the option arrived before <body> existed
    watchThemeAttr();
    bindClicks();
    bindWecomCardClicks();
    bindPixelHover();
    bodyObserver = new MutationObserver(onBodyMutations);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    sync();
    window.setTimeout(sync, 500);
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
}

/**
 * Fully tear the beautify + theme + kick engine back down so the page looks
 * exactly as it would with the extension uninstalled. Called when the side panel's
 * global master switch is turned off. `initBeautify` can be called again
 * afterwards to bring everything back (the `started` guard is reset here).
 */
export function teardownBeautify(): void {
  if (!started) return;
  started = false;

  // Stop all observers/timers we own.
  if (bodyObserver) {
    bodyObserver.disconnect();
    bodyObserver = null;
  }
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
  themeObserverBound = false;
  toggleObservers.forEach((o) => o.disconnect());
  toggleObservers.length = 0;
  watchedToggles = new WeakSet<Element>();
  expandCounts = new WeakMap<Element, number>();
  resetClampState();
  pendingScope = EMPTY_SYNC_SCOPE;
  if (reassertTimer) {
    clearTimeout(reassertTimer);
    reassertTimer = undefined;
  }

  // Remove the worldcup corner balls and tear down the full-screen kick canvas.
  try { unmountBalls(); } catch { /* noop */ }
  try { removeBotCardTilt(); } catch { /* noop */ }
  try { setFullscreenKickPlayer('none', ''); } catch { /* noop */ }

  // Stop listening for page-side interactions.
  removeClicks();
  removeWecomCardClicks();
  unbindPixelHover();

  // Put the original TeX source back when the enhancement is turned off.
  restoreMessageMath();

  // Strip every attribute / inline var / class we ever wrote to the page.
  const body = document.body;
  if (body) {
    body.removeAttribute('data-octo-skin');
    body.removeAttribute('data-octo-global-theme');
    body.removeAttribute('data-octo-kick-style');
    body.removeAttribute('data-octo-player-watermark');
    body.removeAttribute('data-octo-player-kicking');
    body.removeAttribute('data-octo-qq-self-left');
    body.removeAttribute('data-octo-px-scrolling');
    body.style.removeProperty('--octo-player-watermark-image');
    if (nativeThemeMode !== undefined) {
      selfWritingTheme = true;
      try {
        if (nativeThemeMode === null) body.removeAttribute('theme-mode');
        else body.setAttribute('theme-mode', nativeThemeMode);
      } finally {
        selfWritingTheme = false;
      }
      nativeThemeMode = undefined;
    }
  }
  document
    .querySelectorAll('.octo-clamp, .octo-expanded')
    .forEach((el) => el.classList.remove('octo-clamp', 'octo-expanded'));
  document
    .querySelectorAll('[data-ai-continue]')
    .forEach((el) => el.removeAttribute('data-ai-continue'));
  document
    .querySelectorAll<HTMLAnchorElement>('[data-octo-wecom]')
    .forEach(clearWecomLinkState);
  document.querySelectorAll('.octo-gacha-fx').forEach((el) => el.remove());
  document.querySelectorAll('.octo-pixel-hit').forEach((el) => el.remove());
  document.querySelectorAll<HTMLElement>('[data-octo-rarity]').forEach((el) => {
    el.removeAttribute('data-octo-rarity');
    el.style.removeProperty('--octo-card-rx');
    el.style.removeProperty('--octo-card-ry');
    el.style.removeProperty('--octo-card-mx');
    el.style.removeProperty('--octo-card-my');
  });
  document.querySelectorAll<HTMLElement>('[data-octo-kick]').forEach((el) => {
    el.removeAttribute('data-octo-kick');
    el.classList.remove('octo-boom');
    el.style.removeProperty('--octo-go');
  });

  // Finally drop the injected stylesheet so all color/layout overrides vanish.
  document.getElementById(STYLE_ID)?.remove();
}
