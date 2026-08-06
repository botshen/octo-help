import {
  KICK_GLOBAL_KEY,
  KICK_READY_EVENT,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  type KickScriptApi,
  type PlayerWatermarkId,
  type RequestKickScriptMessage,
} from './octoRecall';

/**
 * Lazy façade over the pixi.js-powered full-screen kick effect.
 *
 * The implementation lives in its own unlisted entrypoint
 * (`entrypoints/octo-kick-world.ts`) because pixi.js + pixi-filters are ~700 KB
 * minified, and only users who pick a player watermark ever need them. Bundling
 * them into `octo-main-world.js` meant every Octo page load parsed a WebGL
 * engine that almost never runs.
 *
 * Loading follows WXT's recommended main-world pattern: only a content script
 * may call `injectScript`, so we ask for the injection over postMessage and the
 * content script does it. The injected script registers its API on a page global
 * and fires `KICK_READY_EVENT`; we handle both orders (global already present, or
 * event arriving later) so there is no race.
 *
 * All three entry points keep their original synchronous signatures. While the
 * effect is unloaded every call is a cheap variable write, so turning it off
 * costs nothing and never triggers a download.
 */

let api: KickScriptApi | null = null;
let requested = false;
let readyListenerBound = false;

// Desired state, always authoritative — `applyAll` reads these rather than the
// arguments captured at call time, so a load that lands late still applies the
// newest settings instead of resurrecting a stale one.
let wantStyle = '';
let wantBallCursor = true;
let wantPlayer: PlayerWatermarkId = 'none';
let wantBallUrl = '';

function readGlobalApi(): KickScriptApi | null {
  const value = (window as unknown as Record<string, unknown>)[KICK_GLOBAL_KEY];
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<KickScriptApi>;
  return typeof candidate.setFullscreenKickPlayer === 'function' &&
    typeof candidate.setFullscreenKickStyle === 'function' &&
    typeof candidate.setFullscreenKickBallCursor === 'function'
    ? (candidate as KickScriptApi)
    : null;
}

function applyAll(target: KickScriptApi): void {
  if (wantStyle) target.setFullscreenKickStyle(wantStyle);
  target.setFullscreenKickBallCursor(wantBallCursor);
  target.setFullscreenKickPlayer(wantPlayer, wantBallUrl);
}

function adopt(next: KickScriptApi): void {
  api = next;
  // The user may have switched the effect back off while the script was in
  // flight; applyAll() reads the live desired state and handles that.
  applyAll(next);
}

function ensureLoaded(): void {
  if (api) {
    applyAll(api);
    return;
  }

  // The script may already be present from an earlier session on this page.
  const existing = readGlobalApi();
  if (existing) {
    adopt(existing);
    return;
  }

  if (!readyListenerBound) {
    readyListenerBound = true;
    window.addEventListener(KICK_READY_EVENT, () => {
      const loaded = readGlobalApi();
      if (loaded) adopt(loaded);
    });
  }

  if (requested) return;
  requested = true;
  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE.requestKickScript,
    } satisfies RequestKickScriptMessage,
    '*',
  );
}

export function setFullscreenKickStyle(styleId: string): void {
  wantStyle = styleId;
  api?.setFullscreenKickStyle(styleId);
}

/** Independent toggle: replace the OS cursor with a football (default on). */
export function setFullscreenKickBallCursor(enabled: boolean): void {
  wantBallCursor = enabled;
  api?.setFullscreenKickBallCursor(enabled);
}

export function setFullscreenKickPlayer(
  nextPlayerId: PlayerWatermarkId,
  nextBallImageUrl: string,
): void {
  wantPlayer = nextPlayerId;
  wantBallUrl = nextBallImageUrl;

  // 'none' is the teardown path: never pay for the chunk just to switch the
  // effect off. If it was never loaded there is nothing mounted to clean up.
  if (nextPlayerId === 'none') {
    api?.setFullscreenKickPlayer('none', '');
    return;
  }
  ensureLoaded();
}

/** Test/debug helper: whether the heavy pixi script has been pulled in yet. */
export function isFullscreenKickLoaded(): boolean {
  return api !== null;
}
