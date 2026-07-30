import {
  BALL_CURSOR_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  PLAYER_WATERMARK_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
  type BallCursorMessage,
  type DesktopPetMessage,
  type DesktopPetPosition,
  type DesktopPetPositionMessage,
  type GlobalThemeMessage,
  type KickStyleMessage,
  type PlayerWatermarkId,
  type PlayerWatermarkMessage,
  type ThemeMessage,
  type ToggleMessage,
} from '@/utils/octoRecall';
import { DEFAULT_GLOBAL_THEME, DEFAULT_KICK_STYLE, DEFAULT_THEME } from '@/utils/octoBeautify';
import { isDesktopPetPosition, isStoredDesktopPet } from '@/utils/octoPetState';

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

    function postBallCursor(enabled: boolean) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.ballCursor, enabled } satisfies BallCursorMessage,
        '*',
      );
    }

    function postPlayerWatermark(playerId: PlayerWatermarkId) {
      const imageUrl =
        playerId === 'none' ? '' : browser.runtime.getURL(`/${playerId}-watermark.png`);
      const playerImageUrl =
        playerId === 'none'
          ? ''
          : browser.runtime.getURL(`/player-animation/${playerId}-player.png`);
      const ballImageUrl =
        playerId === 'none'
          ? ''
          : browser.runtime.getURL(`/player-animation/${playerId}-ball.png`);
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: MESSAGE_TYPE.playerWatermark,
          playerId,
          imageUrl,
          playerImageUrl,
          ballImageUrl,
        } satisfies PlayerWatermarkMessage,
        '*',
      );
    }

    function postDesktopPet(
      pet: DesktopPetMessage['pet'],
      enabled: boolean,
      position: DesktopPetPosition | null,
    ) {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: MESSAGE_TYPE.desktopPet,
          pet,
          enabled,
          position,
        } satisfies DesktopPetMessage,
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
      PLAYER_WATERMARK_STORAGE_KEY,
      MESSI_WATERMARK_STORAGE_KEY,
      BALL_CURSOR_STORAGE_KEY,
      DESKTOP_PET_STORAGE_KEY,
      DESKTOP_PET_ENABLED_STORAGE_KEY,
      DESKTOP_PET_POSITION_STORAGE_KEY,
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
    const storedPlayer = stored[PLAYER_WATERMARK_STORAGE_KEY];
    const initialPlayerWatermark: PlayerWatermarkId =
      storedPlayer === 'messi' || storedPlayer === 'mbappe' || storedPlayer === 'none'
        ? storedPlayer
        : stored[MESSI_WATERMARK_STORAGE_KEY] === true
          ? 'messi'
          : 'none';
    // Default ON so existing users keep the football cursor.
    const initialBallCursor = stored[BALL_CURSOR_STORAGE_KEY] !== false;
    let desktopPet = isStoredDesktopPet(stored[DESKTOP_PET_STORAGE_KEY])
      ? stored[DESKTOP_PET_STORAGE_KEY]
      : null;
    let desktopPetEnabled = stored[DESKTOP_PET_ENABLED_STORAGE_KEY] === true;
    let desktopPetPosition = isDesktopPetPosition(stored[DESKTOP_PET_POSITION_STORAGE_KEY])
      ? stored[DESKTOP_PET_POSITION_STORAGE_KEY]
      : null;

    const pushAll = () => {
      postKickStyle(initialKick);
      postGlobalTheme(initialGlobalTheme);
      postTheme(initialTheme);
      postPlayerWatermark(initialPlayerWatermark);
      postBallCursor(initialBallCursor);
      postToggle(initialEnabled);
      postDesktopPet(desktopPet, desktopPetEnabled, desktopPetPosition);
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
      if (PLAYER_WATERMARK_STORAGE_KEY in changes) {
        const next = changes[PLAYER_WATERMARK_STORAGE_KEY].newValue;
        postPlayerWatermark(next === 'messi' || next === 'mbappe' ? next : 'none');
      }
      if (BALL_CURSOR_STORAGE_KEY in changes) {
        postBallCursor(changes[BALL_CURSOR_STORAGE_KEY].newValue !== false);
      }
      if (DESKTOP_PET_STORAGE_KEY in changes) {
        const next = changes[DESKTOP_PET_STORAGE_KEY].newValue;
        desktopPet = isStoredDesktopPet(next) ? next : null;
      }
      if (DESKTOP_PET_ENABLED_STORAGE_KEY in changes) {
        desktopPetEnabled = changes[DESKTOP_PET_ENABLED_STORAGE_KEY].newValue === true;
      }
      if (DESKTOP_PET_POSITION_STORAGE_KEY in changes) {
        const next = changes[DESKTOP_PET_POSITION_STORAGE_KEY].newValue;
        desktopPetPosition = isDesktopPetPosition(next) ? next : null;
      }
      if (
        DESKTOP_PET_STORAGE_KEY in changes ||
        DESKTOP_PET_ENABLED_STORAGE_KEY in changes ||
        DESKTOP_PET_POSITION_STORAGE_KEY in changes
      ) {
        postDesktopPet(desktopPet, desktopPetEnabled, desktopPetPosition);
      }
    });

    // The page owns drag interaction; persist only the bounded coordinate
    // message emitted by our MAIN-world renderer.
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as DesktopPetPositionMessage | undefined;
      if (
        !data ||
        data.source !== MESSAGE_SOURCE ||
        data.type !== MESSAGE_TYPE.desktopPetPosition ||
        !isDesktopPetPosition(data.position)
      ) {
        return;
      }
      void browser.storage.local.set({ [DESKTOP_PET_POSITION_STORAGE_KEY]: data.position });
    });
  },
});
