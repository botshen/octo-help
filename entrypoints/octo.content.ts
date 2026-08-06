import { browser, defineContentScript, injectScript } from '#imports';
import {
  AI_BALANCE_PAGE_STORAGE_KEY,
  COMPAT_REPORT_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  OCTO_MATCHES,
  PLAYER_WATERMARK_STORAGE_KEY,
  type AiBalanceMessage,
  type CompatReportMessage,
  type DesktopPetMessage,
  type DesktopPetPositionMessage,
  type PlayerWatermarkId,
  type RequestKickScriptMessage,
  type StoredCompatReport,
} from '@/utils/octoRecall';
import {
  BALL_CURSOR_STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '@/utils/octoRecall';
import {
  DESKTOP_PET_KEYS,
  RELAYED_STORAGE_KEYS,
  SIMPLE_RELAY_KEYS,
  readAiBalancePage,
  readBallCursor,
  readBeautifyEnabled,
  readBuiltInCompanionFromChange,
  readBuiltInCompanionInitial,
  readComposerEnhancement,
  readDesktopPet,
  readDesktopPetEnabledFromChange,
  readDesktopPetEnabledInitial,
  readDesktopPetPlacement,
  readDesktopPetPosition,
  readGlobalTheme,
  readKickStyle,
  readMaster,
  readPlayerWatermarkFromChange,
  readPlayerWatermarkInitial,
  readQQSelfLeft,
  readRecallEnabled,
  readTheme,
  type DesktopPetKey,
  type SettingValues,
  type SimpleRelayKey,
} from '@/utils/octoSettingsParsers';
import { postToPage, toNewValues, touchesAny } from '@/utils/octoSettingsRelay';
import { isDesktopPetPosition } from '@/utils/octoPetState';

/**
 * ISOLATED-world content script.
 *
 * Bridges extension storage <-> the MAIN-world script (octo-main-world.ts),
 * which is the only place that can read the page's React fiber memory and
 * drive the beautify/theme engine. The content script cannot see page JS, so
 * all restore + beautify logic lives in the injected script; here we inject it
 * and relay storage-backed settings and extension asset URLs over postMessage.
 *
 * Keep this file small: it must not import the beautify engine (see the size
 * constraints in README). Settings parsing lives in utils/octoSettingsParsers.ts
 * so each defaulting rule has one home and is unit tested.
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

    // ---- outgoing settings -------------------------------------------------

    const postMaster = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.master, enabled });
    const postToggle = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.toggle, enabled });
    const postBeautify = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.beautify, enabled });
    const postTheme = (themeId: string) =>
      postToPage({ type: MESSAGE_TYPE.theme, themeId });
    const postGlobalTheme = (themeId: string) =>
      postToPage({ type: MESSAGE_TYPE.globalTheme, themeId });
    const postKickStyle = (styleId: string) =>
      postToPage({ type: MESSAGE_TYPE.kickStyle, styleId });
    const postBallCursor = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.ballCursor, enabled });
    const postQQSelfLeft = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.qqSelfLeft, enabled });
    const postComposerEnhancement = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.composerEnhancement, enabled });

    /**
     * The page cannot resolve extension URLs itself, so the asset paths are
     * resolved here. The MAIN world re-validates them (protocol + pathname)
     * because the message channel is not trustworthy.
     */
    function postPlayerWatermark(playerId: PlayerWatermarkId) {
      const asset = (kind: 'player' | 'ball') =>
        playerId === 'none'
          ? ''
          : browser.runtime.getURL(`/player-animation/${playerId}-${kind}.webp`);
      postToPage({
        type: MESSAGE_TYPE.playerWatermark,
        playerId,
        playerImageUrl: asset('player'),
        ballImageUrl: asset('ball'),
      });
    }

    /** Five storage keys collapse into this one message. */
    function postDesktopPet() {
      postToPage({
        type: MESSAGE_TYPE.desktopPet,
        pet: desktopPet,
        enabled: desktopPetEnabled,
        position: desktopPetPosition,
        placement: desktopPetPlacement,
        builtInCompanion,
      } satisfies Omit<DesktopPetMessage, 'source'>);
    }

    /**
     * AI balance: only the formatted string and the low flag are sent.
     *
     * The endpoint and the API key live in a storage key this script does not
     * even read — the MAIN world shares a realm with Octo, so anything relayed
     * here is effectively public. The background precomputes the display state.
     */
    function postAiBalance(state = aiBalancePage) {
      postToPage({
        type: MESSAGE_TYPE.aiBalance,
        text: state.text,
        low: state.low,
      } satisfies Omit<AiBalanceMessage, 'source'>);
    }

    // ---- current state -----------------------------------------------------

    const stored = (await browser.storage.local.get([
      ...RELAYED_STORAGE_KEYS,
    ])) as SettingValues;

    let currentMaster = readMaster(stored);
    let currentEnabled = readRecallEnabled(stored);
    let beautifyEnabled = readBeautifyEnabled(stored);
    let currentTheme = readTheme(stored);
    let currentGlobalTheme = readGlobalTheme(stored);
    let currentKick = readKickStyle(stored);
    let currentPlayerWatermark = readPlayerWatermarkInitial(stored);
    let currentBallCursor = readBallCursor(stored);
    let currentQQSelfLeft = readQQSelfLeft(stored);
    let composerEnhancementEnabled = readComposerEnhancement(stored);
    let desktopPet = readDesktopPet(stored);
    let desktopPetPosition = readDesktopPetPosition(stored);
    let desktopPetPlacement = readDesktopPetPlacement(stored);
    let builtInCompanion = readBuiltInCompanionInitial(stored);
    let desktopPetEnabled = readDesktopPetEnabledInitial(stored);
    let aiBalancePage = readAiBalancePage(stored);

    // MAIN world ignores settings while suspended. Keep the latest values here
    // and replay them after the master switch reboots the page-side engines.
    // Order is preserved from the original implementation.
    const pushSettings = () => {
      // Beautify first: while it is off the page-side engine drops theme, kick,
      // watermark and cursor messages, so its state has to be known before them.
      postBeautify(beautifyEnabled);
      postKickStyle(currentKick);
      postGlobalTheme(currentGlobalTheme);
      postTheme(currentTheme);
      postPlayerWatermark(currentPlayerWatermark);
      postBallCursor(currentBallCursor);
      postQQSelfLeft(currentQQSelfLeft);
      postToggle(currentEnabled);
      postComposerEnhancement(composerEnhancementEnabled);
      postDesktopPet();
      postAiBalance();
    };

    // Push current state once the injected script is listening. It registers
    // its window 'message' listener synchronously on evaluation, but post twice
    // (now + next tick) to avoid a first-frame race.
    const pushAll = () => {
      postMaster(currentMaster);
      pushSettings();
    };
    pushAll();
    setTimeout(pushAll, 0);

    // ---- incoming storage changes -----------------------------------------

    /**
     * Simple settings: one key, one parser, one message.
     *
     * A `Record` keyed by the union, not an array: TypeScript then refuses to
     * compile if a simple setting is added without a relay, replacing the old
     * hand-written `if (KEY in changes)` chain where an omission was silent.
     * Processing order comes from SIMPLE_RELAY_KEYS.
     */
    const SIMPLE_RELAYS: Record<SimpleRelayKey, (values: SettingValues) => void> = {
      [STORAGE_KEY]: (v) => postToggle((currentEnabled = readRecallEnabled(v))),
      [BEAUTIFY_STORAGE_KEY]: (v) => {
        beautifyEnabled = readBeautifyEnabled(v);
        postBeautify(beautifyEnabled);
        // Turning it back on has to replay the theme family, which the page
        // dropped while the engine was down — same reason master replays.
        if (beautifyEnabled) pushSettings();
      },
      [THEME_STORAGE_KEY]: (v) => postTheme((currentTheme = readTheme(v))),
      [GLOBAL_THEME_STORAGE_KEY]: (v) =>
        postGlobalTheme((currentGlobalTheme = readGlobalTheme(v))),
      [KICK_STYLE_STORAGE_KEY]: (v) => postKickStyle((currentKick = readKickStyle(v))),
      [PLAYER_WATERMARK_STORAGE_KEY]: (v) =>
        postPlayerWatermark((currentPlayerWatermark = readPlayerWatermarkFromChange(v))),
      [BALL_CURSOR_STORAGE_KEY]: (v) => postBallCursor((currentBallCursor = readBallCursor(v))),
      [QQ_SELF_LEFT_STORAGE_KEY]: (v) => postQQSelfLeft((currentQQSelfLeft = readQQSelfLeft(v))),
      [COMPOSER_ENHANCEMENT_STORAGE_KEY]: (v) =>
        postComposerEnhancement((composerEnhancementEnabled = readComposerEnhancement(v))),
      [AI_BALANCE_PAGE_STORAGE_KEY]: (v) => postAiBalance((aiBalancePage = readAiBalancePage(v))),
    };

    /**
     * Desktop pet: five keys feeding one message, so values are absorbed first
     * and the message is sent once at the end. Same exhaustiveness guarantee.
     */
    const DESKTOP_PET_ABSORBERS: Record<DesktopPetKey, (values: SettingValues) => void> = {
      [DESKTOP_PET_STORAGE_KEY]: (v) => {
        desktopPet = readDesktopPet(v);
      },
      [DESKTOP_PET_ENABLED_STORAGE_KEY]: (v) => {
        desktopPetEnabled = readDesktopPetEnabledFromChange(v);
      },
      [DESKTOP_PET_POSITION_STORAGE_KEY]: (v) => {
        desktopPetPosition = readDesktopPetPosition(v);
      },
      [DESKTOP_PET_PLACEMENT_STORAGE_KEY]: (v) => {
        desktopPetPlacement = readDesktopPetPlacement(v);
      },
      [BUILT_IN_COMPANION_STORAGE_KEY]: (v) => {
        builtInCompanion = readBuiltInCompanionFromChange(v);
      },
    };

    // Relay later changes from the side panel.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const values = toNewValues(changes);

      // Master first: turning it back on has to replay every setting, since the
      // page dropped them all while suspended.
      if (MASTER_STORAGE_KEY in changes) {
        currentMaster = readMaster(values);
        postMaster(currentMaster);
        if (currentMaster) pushSettings();
      }

      for (const key of SIMPLE_RELAY_KEYS) {
        if (key in changes) SIMPLE_RELAYS[key](values);
      }

      for (const key of DESKTOP_PET_KEYS) {
        if (key in changes) DESKTOP_PET_ABSORBERS[key](values);
      }
      if (touchesAny(changes, DESKTOP_PET_KEYS)) postDesktopPet();
    });

    // ---- incoming messages from the page ----------------------------------

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | DesktopPetPositionMessage
        | RequestKickScriptMessage
        | CompatReportMessage
        | undefined;
      if (!data || data.source !== MESSAGE_SOURCE) return;

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

      // The page owns drag interaction; persist only the bounded coordinate
      // message emitted by our MAIN-world renderer.
      if (
        data.type !== MESSAGE_TYPE.desktopPetPosition ||
        !isDesktopPetPosition(data.position)
      ) {
        return;
      }
      void browser.storage.local.set({
        [DESKTOP_PET_POSITION_STORAGE_KEY]: data.position,
      });
    });
  },
});
