import { defineUnlistedScript } from '#imports';
import {
  KICK_GLOBAL_KEY,
  KICK_READY_EVENT,
  type KickScriptApi,
} from '@/utils/octoRecall';
import {
  setFullscreenKickBallCursor,
  setFullscreenKickPlayer,
  setFullscreenKickStyle,
} from '@/utils/octoFullscreenKickPixi';

/**
 * On-demand MAIN-world entrypoint for the pixi.js full-screen kick effect.
 *
 * This is a *separate* unlisted script purely for bundle size: pixi.js +
 * pixi-filters are ~700 KB minified, and only users who pick a player watermark
 * ever need them. `octo-main-world.js` therefore stays lean and this file is
 * injected (by the content script, on request from `octoFullscreenKickLazy`)
 * the first time a watermark is switched on.
 *
 * It registers its API on a page global and announces itself with an event, so
 * the lazy façade works whether it starts listening before or after load.
 */
export default defineUnlistedScript(() => {
  const api: KickScriptApi = {
    setFullscreenKickStyle,
    setFullscreenKickBallCursor,
    setFullscreenKickPlayer,
  };

  (window as unknown as Record<string, unknown>)[KICK_GLOBAL_KEY] = api;
  window.dispatchEvent(new CustomEvent(KICK_READY_EVENT));
});
