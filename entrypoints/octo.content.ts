import {
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
  type GlobalThemeMessage,
  type KickStyleMessage,
  type MessiWatermarkMessage,
  type ThemeMessage,
  type ToggleMessage,
} from '@/utils/octoRecall';
import { DEFAULT_GLOBAL_THEME, DEFAULT_KICK_STYLE, DEFAULT_THEME } from '@/utils/octoBeautify';

/**
 * ISOLATED-world content script.
 *
 * Bridges extension storage <-> the MAIN-world script (octo-main-world.ts),
 * which is the only place that can read the page's React fiber memory and
 * drive the beautify/theme engine. The content script cannot see page JS, so
 * all restore + beautify logic lives in the injected script; here we inject it
 * and relay storage-backed settings and extension asset URLs over postMessage.
 */
export default defineContentScript({
  matches: ['https://im.deepminer.com.cn/*'],
  runAt: 'document_idle',
  async main() {
    // Inject the MAIN-world script (runs in the page's JS context).
    await injectScript('/octo-main-world.js', { keepInDom: true });

    function postToggle(enabled: boolean) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.toggle, enabled } satisfies ToggleMessage,
        '*',
      );
    }

    function postTheme(themeId: string) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.theme, themeId } satisfies ThemeMessage,
        '*',
      );
    }

    function postGlobalTheme(themeId: string) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.globalTheme, themeId } satisfies GlobalThemeMessage,
        '*',
      );
    }

    function postKickStyle(styleId: string) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.kickStyle, styleId } satisfies KickStyleMessage,
        '*',
      );
    }

    function postMessiWatermark(enabled: boolean, imageUrl: string) {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: MESSAGE_TYPE.messiWatermark,
          enabled,
          imageUrl,
        } satisfies MessiWatermarkMessage,
        '*',
      );
    }

    // Push current state once the injected script is listening. It registers
    // its window 'message' listener synchronously on evaluation, but post twice
    // (now + next tick) to avoid a first-frame race.
    const stored = await browser.storage.local.get([
      STORAGE_KEY,
      THEME_STORAGE_KEY,
      GLOBAL_THEME_STORAGE_KEY,
      KICK_STYLE_STORAGE_KEY,
      MESSI_WATERMARK_STORAGE_KEY,
    ]);
    const initialEnabled = stored[STORAGE_KEY] === true;
    const initialTheme =
      typeof stored[THEME_STORAGE_KEY] === 'string'
        ? (stored[THEME_STORAGE_KEY] as string)
        : DEFAULT_THEME;
    const initialGlobalTheme =
      typeof stored[GLOBAL_THEME_STORAGE_KEY] === 'string'
        ? (stored[GLOBAL_THEME_STORAGE_KEY] as string)
        : DEFAULT_GLOBAL_THEME;
    const initialKick =
      typeof stored[KICK_STYLE_STORAGE_KEY] === 'string'
        ? (stored[KICK_STYLE_STORAGE_KEY] as string)
        : DEFAULT_KICK_STYLE;
    const initialMessiWatermark = stored[MESSI_WATERMARK_STORAGE_KEY] === true;
    const messiWatermarkUrl = browser.runtime.getURL('/messi-watermark.png');

    const pushAll = () => {
      postKickStyle(initialKick);
      postGlobalTheme(initialGlobalTheme);
      postTheme(initialTheme);
      postMessiWatermark(initialMessiWatermark, messiWatermarkUrl);
      postToggle(initialEnabled);
    };
    pushAll();
    setTimeout(pushAll, 0);

    // Relay later changes from the popup.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (STORAGE_KEY in changes) postToggle(changes[STORAGE_KEY].newValue === true);
      if (THEME_STORAGE_KEY in changes) {
        const next = changes[THEME_STORAGE_KEY].newValue;
        postTheme(typeof next === 'string' ? next : DEFAULT_THEME);
      }
      if (GLOBAL_THEME_STORAGE_KEY in changes) {
        const next = changes[GLOBAL_THEME_STORAGE_KEY].newValue;
        postGlobalTheme(typeof next === 'string' ? next : DEFAULT_GLOBAL_THEME);
      }
      if (KICK_STYLE_STORAGE_KEY in changes) {
        const next = changes[KICK_STYLE_STORAGE_KEY].newValue;
        postKickStyle(typeof next === 'string' ? next : DEFAULT_KICK_STYLE);
      }
      if (MESSI_WATERMARK_STORAGE_KEY in changes) {
        postMessiWatermark(changes[MESSI_WATERMARK_STORAGE_KEY].newValue === true, messiWatermarkUrl);
      }
    });
  },
});
