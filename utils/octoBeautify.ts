import type { PlayerWatermarkId } from './octoRecall';
import qrcode from 'qrcode-generator';
import BEAUTIFY_CSS from './octoBeautify.css?raw';
import {
  DEFAULT_GLOBAL_THEME,
  DEFAULT_KICK_STYLE,
  DEFAULT_THEME,
  GLOBAL_THEMES,
  KICK_STYLES,
  THEMES,
  kickStyleById,
  themeById,
  type GlobalThemeDef,
  type KickStyleDef,
  type ThemeCategory,
  type ThemeDef,
  type ThemePresentation,
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
  setFullscreenKickBallCursor,
  setFullscreenKickPlayer,
  setFullscreenKickStyle,
} from './octoFullscreenKickLazy';

// Re-exported for existing consumers. New code should import the catalog
// directly (`@/utils/octoThemeCatalog`) so it does not pull in this engine.
export {
  DEFAULT_GLOBAL_THEME,
  DEFAULT_KICK_STYLE,
  DEFAULT_THEME,
  GLOBAL_THEMES,
  KICK_STYLES,
  THEMES,
  type GlobalThemeDef,
  type KickStyleDef,
  type ThemeCategory,
  type ThemeDef,
  type ThemePresentation,
};

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

const TOGGLE_SEL = '.wk-fold-session-card-toggle';
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
  const allRows = document.querySelectorAll('.wk-msg-row');
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
const WECOM_LINK_SEL = '.wk-markdown a[href], .wk-fold-msg-text a[href]';

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
    const host = card.closest('.wk-markdown, .wk-fold-msg-text');
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

const CLAMP_SEL = [
  '.wk-msg-row:has(.ai-badge) .wk-markdown',
  '.wk-msg-row--continue[data-ai-continue="true"] .wk-markdown',
  '.wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown',
  '.wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown',
  '.wk-fold-msg-text',
].join(',');

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
  fx.innerHTML =
    '<div class="octo-gacha-flash"></div><div class="octo-gacha-rays"></div><div class="octo-gacha-spark"></div>';
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
    .querySelectorAll<HTMLElement>('.wk-bot-detail-modal .wk-modal-shell')
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
      const content = shell.querySelector('.wk-bot-detail-content');
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
const botTiltBound = new WeakSet<HTMLElement>();
function bindBotCardTilt(): void {
  if (prefersReducedMotion()) return;
  document
    .querySelectorAll<HTMLElement>('.wk-bot-detail-modal .wk-modal-shell')
    .forEach((el) => {
      if (botTiltBound.has(el)) return;
      botTiltBound.add(el);
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const px = (e.clientX - r.left) / r.width - 0.5; // -0.5 ~ 0.5
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--octo-card-ry', (px * 11).toFixed(2) + 'deg'); // 左右 → rotateY
        el.style.setProperty('--octo-card-rx', (-py * 11).toFixed(2) + 'deg'); // 上下 → rotateX
        el.style.setProperty('--octo-card-mx', (px * 100 + 50).toFixed(1) + '%'); // 光标 X% → 跟手高光
        el.style.setProperty('--octo-card-my', (py * 100 + 50).toFixed(1) + '%');
      });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--octo-card-ry', '0deg');
        el.style.setProperty('--octo-card-rx', '0deg');
      });
    });
}

// ---- worldcup soccer ball: real DOM node + 5 selectable kick styles -------

// Bubbles that carry a corner ball under the worldcup skin.
const BALL_HOST_SEL = [
  '.wk-msg-row:has(.ai-badge) .wk-markdown',
  '.wk-msg-row--continue[data-ai-continue="true"] .wk-markdown',
  '.wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown',
  '.wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown',
  '.wk-fold-msg-text',
].join(',');

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
      // Must precede applyClamp(): the clamp skips messages carrying a 企业微信
      // card, and it can only see them once the anchors are tagged. Tagging after
      // clamping would clamp the card for one frame and un-clamp on the next.
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
  try { setFullscreenKickPlayer('none', ''); } catch { /* noop */ }

  // Stop listening for page-side interactions.
  removeClicks();
  removeWecomCardClicks();

  // Strip every attribute / inline var / class we ever wrote to the page.
  const body = document.body;
  if (body) {
    body.removeAttribute('data-octo-skin');
    body.removeAttribute('data-octo-global-theme');
    body.removeAttribute('data-octo-kick-style');
    body.removeAttribute('data-octo-player-watermark');
    body.removeAttribute('data-octo-player-kicking');
    body.removeAttribute('data-octo-qq-self-left');
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
