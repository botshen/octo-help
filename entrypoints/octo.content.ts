import {
  BALL_CURSOR_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
  COMPAT_REPORT_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  OCTO_MATCHES,
  PLAYER_WATERMARK_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
  type BallCursorMessage,
  type BuiltInCompanionId,
  type CompatReportMessage,
  type ComposerEnhancementMessage,
  type DesktopPetMessage,
  type DesktopPetPlacement,
  type DesktopPetPosition,
  type DesktopPetPositionMessage,
  type GlobalThemeMessage,
  type KickStyleMessage,
  type MasterMessage,
  type PlayerWatermarkId,
  type PlayerWatermarkMessage,
  type QQSelfLeftMessage,
  type RequestKickScriptMessage,
  type StoredCompatReport,
  type ThemeMessage,
  type ToggleMessage,
} from '@/utils/octoRecall';
import { DEFAULT_GLOBAL_THEME, DEFAULT_KICK_STYLE, DEFAULT_THEME } from '@/utils/octoThemeCatalog';
import {
  isBuiltInCompanionId,
  isDesktopPetPosition,
  isStoredDesktopPet,
} from '@/utils/octoPetState';

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
  matches: [...OCTO_MATCHES],
  runAt: 'document_idle',
  async main() {
    // Injected on demand from the MAIN world (see octoFullscreenKickLazy):
    // guarded here so repeated toggles never inject twice.
    let kickScriptInjected = false;

    // Inject the MAIN-world script (runs in the page's JS context).
    await injectScript('/octo-main-world.js', { keepInDom: true });

    function postToggle(enabled: boolean) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.toggle, enabled } satisfies ToggleMessage,
        '*',
      );
    }

    function postMaster(enabled: boolean) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.master, enabled } satisfies MasterMessage,
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

    function postQQSelfLeft(enabled: boolean) {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: MESSAGE_TYPE.qqSelfLeft, enabled } satisfies QQSelfLeftMessage,
        '*',
      );
    }

    function postPlayerWatermark(playerId: PlayerWatermarkId) {
      const playerImageUrl =
        playerId === 'none'
          ? ''
          : browser.runtime.getURL(`/player-animation/${playerId}-player.webp`);
      const ballImageUrl =
        playerId === 'none'
          ? ''
          : browser.runtime.getURL(`/player-animation/${playerId}-ball.webp`);
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: MESSAGE_TYPE.playerWatermark,
          playerId,
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
      placement: DesktopPetPlacement,
      builtInCompanion: BuiltInCompanionId | null,
    ) {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: MESSAGE_TYPE.desktopPet,
          pet,
          enabled,
          position,
          placement,
          builtInCompanion,
        } satisfies DesktopPetMessage,
        '*',
      );
    }

    function postComposerEnhancement(enabled: boolean) {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: MESSAGE_TYPE.composerEnhancement,
          enabled,
        } satisfies ComposerEnhancementMessage,
        '*',
      );
    }

    // Push current state once the injected script is listening. It registers
    // its window 'message' listener synchronously on evaluation, but post twice
    // (now + next tick) to avoid a first-frame race.
    const stored = await browser.storage.local.get([
      MASTER_STORAGE_KEY,
      STORAGE_KEY,
      THEME_STORAGE_KEY,
      GLOBAL_THEME_STORAGE_KEY,
      KICK_STYLE_STORAGE_KEY,
      PLAYER_WATERMARK_STORAGE_KEY,
      MESSI_WATERMARK_STORAGE_KEY,
      BALL_CURSOR_STORAGE_KEY,
      QQ_SELF_LEFT_STORAGE_KEY,
      DESKTOP_PET_STORAGE_KEY,
      DESKTOP_PET_ENABLED_STORAGE_KEY,
      DESKTOP_PET_POSITION_STORAGE_KEY,
      DESKTOP_PET_PLACEMENT_STORAGE_KEY,
      COMPOSER_ENHANCEMENT_STORAGE_KEY,
      BUILT_IN_COMPANION_STORAGE_KEY,
    ]);
    // Master defaults ON (missing key => enabled) so existing users are
    // unaffected until they explicitly turn everything off.
    let currentMaster = stored[MASTER_STORAGE_KEY] !== false;
    let currentEnabled = stored[STORAGE_KEY] === true;
    let currentTheme =
      typeof stored[THEME_STORAGE_KEY] === 'string'
        ? (stored[THEME_STORAGE_KEY] as string)
        : DEFAULT_THEME;
    let currentGlobalTheme =
      typeof stored[GLOBAL_THEME_STORAGE_KEY] === 'string'
        ? (stored[GLOBAL_THEME_STORAGE_KEY] as string)
        : DEFAULT_GLOBAL_THEME;
    let currentKick =
      typeof stored[KICK_STYLE_STORAGE_KEY] === 'string'
        ? (stored[KICK_STYLE_STORAGE_KEY] as string)
        : DEFAULT_KICK_STYLE;
    const storedPlayer = stored[PLAYER_WATERMARK_STORAGE_KEY];
    let currentPlayerWatermark: PlayerWatermarkId =
      storedPlayer === 'messi' || storedPlayer === 'mbappe' || storedPlayer === 'none'
        ? storedPlayer
        : stored[MESSI_WATERMARK_STORAGE_KEY] === true
          ? 'messi'
          : 'none';
    // Default ON so existing users keep the football cursor.
    let currentBallCursor = stored[BALL_CURSOR_STORAGE_KEY] !== false;
    // Default OFF: own messages sit on the right, like real QQ.
    let currentQQSelfLeft = stored[QQ_SELF_LEFT_STORAGE_KEY] === true;
    let desktopPet = isStoredDesktopPet(stored[DESKTOP_PET_STORAGE_KEY])
      ? stored[DESKTOP_PET_STORAGE_KEY]
      : null;
    let desktopPetPosition = isDesktopPetPosition(stored[DESKTOP_PET_POSITION_STORAGE_KEY])
      ? stored[DESKTOP_PET_POSITION_STORAGE_KEY]
      : null;
    let desktopPetPlacement: DesktopPetPlacement =
      stored[DESKTOP_PET_PLACEMENT_STORAGE_KEY] === 'composer' ? 'composer' : 'desktop';
    let composerEnhancementEnabled = stored[COMPOSER_ENHANCEMENT_STORAGE_KEY] !== false;
    const storedBuiltInCompanion = stored[BUILT_IN_COMPANION_STORAGE_KEY];
    let builtInCompanion: BuiltInCompanionId | null = isBuiltInCompanionId(storedBuiltInCompanion)
      ? storedBuiltInCompanion
      : storedBuiltInCompanion === undefined && !desktopPet
        ? 'wizard'
        : null;
    let desktopPetEnabled =
      stored[DESKTOP_PET_ENABLED_STORAGE_KEY] === true ||
      (stored[DESKTOP_PET_ENABLED_STORAGE_KEY] === undefined && builtInCompanion !== null);

    // MAIN world ignores settings while suspended. Keep the latest values here
    // and replay them after the master switch reboots the page-side engines.
    const pushSettings = () => {
      postKickStyle(currentKick);
      postGlobalTheme(currentGlobalTheme);
      postTheme(currentTheme);
      postPlayerWatermark(currentPlayerWatermark);
      postBallCursor(currentBallCursor);
      postQQSelfLeft(currentQQSelfLeft);
      postToggle(currentEnabled);
      postComposerEnhancement(composerEnhancementEnabled);
      postDesktopPet(
        desktopPet,
        desktopPetEnabled,
        desktopPetPosition,
        desktopPetPlacement,
        builtInCompanion,
      );
    };

    const pushAll = () => {
      postMaster(currentMaster);
      pushSettings();
    };
    pushAll();
    setTimeout(pushAll, 0);

    // Relay later changes from the side panel.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (MASTER_STORAGE_KEY in changes) {
        currentMaster = changes[MASTER_STORAGE_KEY].newValue !== false;
        postMaster(currentMaster);
        if (currentMaster) pushSettings();
      }
      if (STORAGE_KEY in changes) {
        currentEnabled = changes[STORAGE_KEY].newValue === true;
        postToggle(currentEnabled);
      }
      if (THEME_STORAGE_KEY in changes) {
        const next = changes[THEME_STORAGE_KEY].newValue;
        currentTheme = typeof next === 'string' ? next : DEFAULT_THEME;
        postTheme(currentTheme);
      }
      if (GLOBAL_THEME_STORAGE_KEY in changes) {
        const next = changes[GLOBAL_THEME_STORAGE_KEY].newValue;
        currentGlobalTheme = typeof next === 'string' ? next : DEFAULT_GLOBAL_THEME;
        postGlobalTheme(currentGlobalTheme);
      }
      if (KICK_STYLE_STORAGE_KEY in changes) {
        const next = changes[KICK_STYLE_STORAGE_KEY].newValue;
        currentKick = typeof next === 'string' ? next : DEFAULT_KICK_STYLE;
        postKickStyle(currentKick);
      }
      if (PLAYER_WATERMARK_STORAGE_KEY in changes) {
        const next = changes[PLAYER_WATERMARK_STORAGE_KEY].newValue;
        currentPlayerWatermark = next === 'messi' || next === 'mbappe' ? next : 'none';
        postPlayerWatermark(currentPlayerWatermark);
      }
      if (BALL_CURSOR_STORAGE_KEY in changes) {
        currentBallCursor = changes[BALL_CURSOR_STORAGE_KEY].newValue !== false;
        postBallCursor(currentBallCursor);
      }
      if (QQ_SELF_LEFT_STORAGE_KEY in changes) {
        currentQQSelfLeft = changes[QQ_SELF_LEFT_STORAGE_KEY].newValue === true;
        postQQSelfLeft(currentQQSelfLeft);
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
      if (DESKTOP_PET_PLACEMENT_STORAGE_KEY in changes) {
        desktopPetPlacement =
          changes[DESKTOP_PET_PLACEMENT_STORAGE_KEY].newValue === 'composer'
            ? 'composer'
            : 'desktop';
      }
      if (BUILT_IN_COMPANION_STORAGE_KEY in changes) {
        const next = changes[BUILT_IN_COMPANION_STORAGE_KEY].newValue;
        builtInCompanion = isBuiltInCompanionId(next) ? next : null;
      }
      if (
        DESKTOP_PET_STORAGE_KEY in changes ||
        DESKTOP_PET_ENABLED_STORAGE_KEY in changes ||
        DESKTOP_PET_POSITION_STORAGE_KEY in changes ||
        DESKTOP_PET_PLACEMENT_STORAGE_KEY in changes ||
        BUILT_IN_COMPANION_STORAGE_KEY in changes
      ) {
        postDesktopPet(
          desktopPet,
          desktopPetEnabled,
          desktopPetPosition,
          desktopPetPlacement,
          builtInCompanion,
        );
      }
      if (COMPOSER_ENHANCEMENT_STORAGE_KEY in changes) {
        composerEnhancementEnabled =
          changes[COMPOSER_ENHANCEMENT_STORAGE_KEY].newValue !== false;
        postComposerEnhancement(composerEnhancementEnabled);
      }
    });

    // The page owns drag interaction; persist only the bounded coordinate
    // message emitted by our MAIN-world renderer.
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | DesktopPetPositionMessage
        | RequestKickScriptMessage
        | CompatReportMessage
        | undefined;
      if (!data || data.source !== MESSAGE_SOURCE) return;

      // Octo DOM compatibility verdict from the MAIN world. Persist it so the
      // Side Panel can name the broken capability instead of the user only
      // seeing that "the extension stopped working".
      if (data.type === MESSAGE_TYPE.compatReport) {
        const report = data.report;
        if (
          !report ||
          !Array.isArray(report.brokenFeatures) ||
          !Array.isArray(report.brokenKeys) ||
          typeof report.checkedAt !== 'number'
        ) {
          return;
        }
        void browser.storage.local.set({
          [COMPAT_REPORT_STORAGE_KEY]: {
            brokenFeatures: report.brokenFeatures.slice(0, 12).map(String),
            brokenKeys: report.brokenKeys.slice(0, 12).map(String),
            checkedAt: report.checkedAt,
          } satisfies StoredCompatReport,
        });
        return;
      }

      // Lazy load of the pixi.js kick effect. Only a content script can call
      // injectScript, so the MAIN world asks us to do it the first time a
      // player watermark is switched on. Injecting once per page is enough —
      // the script registers a page global that survives later toggles.
      if (data.type === MESSAGE_TYPE.requestKickScript) {
        // MAIN world shares a realm with the page, so this request could have
        // been forged by any page script. Gate it on the setting the effect
        // actually needs: without a watermark selected there is nothing to
        // render, and honouring the request would just be a way to make us
        // fetch and parse ~540 KB of WebGL engine on demand.
        if (currentPlayerWatermark === 'none') return;
        if (kickScriptInjected) return;
        kickScriptInjected = true;
        void injectScript('/octo-kick-world.js', { keepInDom: true }).catch(() => {
          // Allow a retry if the resource failed to load.
          kickScriptInjected = false;
        });
        return;
      }

      if (
        data.type !== MESSAGE_TYPE.desktopPetPosition ||
        !isDesktopPetPosition(data.position)
      ) {
        return;
      }
      void browser.storage.local.set({ [DESKTOP_PET_POSITION_STORAGE_KEY]: data.position });
    });
  },
});
