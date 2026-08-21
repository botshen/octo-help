import { browser, defineContentScript, injectScript } from '#imports';
import {
  COMPAT_REPORT_STORAGE_KEY,
  CONV_FOLDED_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  EXPORT_REQUEST_KEY,
  EXPORT_RESULT_KEY,
  MASTER_STORAGE_KEY,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  OCTO_MATCHES,
  PLAYER_WATERMARK_STORAGE_KEY,
  type DesktopPetMessage,
  type ConvCompactLevel,
  type PageOutboundMessage,
  type PlayerWatermarkId,
  type StoredCompatReport,
} from '@/utils/octoShared';
import {
  BALL_CURSOR_STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
  CONV_COMPACT_STORAGE_KEY,
  CONV_FOLD_ENABLED_STORAGE_KEY,
  CONV_RECENT_ONLY_STORAGE_KEY,
  CONV_SORT_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  LINK_PREVIEW_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '@/utils/octoShared';
import {
  DESKTOP_PET_KEYS,
  RELAYED_STORAGE_KEYS,
  SIMPLE_RELAY_KEYS,
  readBallCursor,
  readBeautifyEnabled,
  readBuiltInCompanionFromChange,
  readBuiltInCompanionInitial,
  readComposerEnhancement,
  readConvCompactLevel,
  readConvFoldEnabled,
  readConvFoldMap,
  readConvRecentOnly,
  readConvSortEnabled,
  readDesktopPet,
  readDesktopPetEnabledFromChange,
  readDesktopPetEnabledInitial,
  readDesktopPetPlacement,
  readDesktopPetPosition,
  readGlobalTheme,
  readKickStyle,
  readLinkPreviewEnabled,
  readMaster,
  readPlayerWatermarkFromChange,
  readPlayerWatermarkInitial,
  readQQSelfLeft,
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
    let foldWriteQueue: Promise<unknown> = Promise.resolve();

    // Inject the MAIN-world script (runs in the page's JS context).
    await injectScript('/octo-main-world.js', { keepInDom: true });

    // ---- outgoing settings -------------------------------------------------

    const postMaster = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.master, enabled });
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
    const postConvSort = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.convSort, enabled });
    const postConvCompact = (level: ConvCompactLevel) =>
      postToPage({ type: MESSAGE_TYPE.convCompact, level });
    const postConvRecentOnly = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.convRecentOnly, enabled });
    const postConvFoldEnabled = (enabled: boolean) =>
      postToPage({ type: MESSAGE_TYPE.convFoldEnabled, enabled });
    const postConvFoldState = (foldedByScope: ReturnType<typeof readConvFoldMap>) =>
      postToPage({ type: MESSAGE_TYPE.convFoldState, foldedByScope });
    let linkPreviewEnabled = true;
    const postLinkPreview = (enabled: boolean) => {
      linkPreviewEnabled = enabled;
      postToPage({ type: MESSAGE_TYPE.linkPreview, enabled });
    };

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

    // ---- current state -----------------------------------------------------

    const stored = (await browser.storage.local.get([
      ...RELAYED_STORAGE_KEYS,
    ])) as SettingValues;

    let currentMaster = readMaster(stored);
    let beautifyEnabled = readBeautifyEnabled(stored);
    let currentTheme = readTheme(stored);
    let currentGlobalTheme = readGlobalTheme(stored);
    let currentKick = readKickStyle(stored);
    let currentPlayerWatermark = readPlayerWatermarkInitial(stored);
    let currentBallCursor = readBallCursor(stored);
    let currentQQSelfLeft = readQQSelfLeft(stored);
    let composerEnhancementEnabled = readComposerEnhancement(stored);
    let convSortEnabled = readConvSortEnabled(stored);
    let convCompactLevel = readConvCompactLevel(stored);
    let convRecentOnly = readConvRecentOnly(stored);
    let convFoldEnabled = readConvFoldEnabled(stored);
    let convFoldMap = readConvFoldMap(stored);
    let desktopPet = readDesktopPet(stored);
    let desktopPetPosition = readDesktopPetPosition(stored);
    let desktopPetPlacement = readDesktopPetPlacement(stored);
    let builtInCompanion = readBuiltInCompanionInitial(stored);
    let desktopPetEnabled = readDesktopPetEnabledInitial(stored);
    linkPreviewEnabled = readLinkPreviewEnabled(stored);

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
      postComposerEnhancement(composerEnhancementEnabled);
      postConvSort(convSortEnabled);
      postConvCompact(convCompactLevel);
      postConvRecentOnly(convRecentOnly);
      postConvFoldState(convFoldMap);
      postConvFoldEnabled(convFoldEnabled);
      postLinkPreview(linkPreviewEnabled);
      postDesktopPet();
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
      [CONV_SORT_STORAGE_KEY]: (v) =>
        postConvSort((convSortEnabled = readConvSortEnabled(v))),
      [CONV_COMPACT_STORAGE_KEY]: (v) =>
        postConvCompact((convCompactLevel = readConvCompactLevel(v))),
      [CONV_RECENT_ONLY_STORAGE_KEY]: (v) =>
        postConvRecentOnly((convRecentOnly = readConvRecentOnly(v))),
      [CONV_FOLD_ENABLED_STORAGE_KEY]: (v) =>
        postConvFoldEnabled((convFoldEnabled = readConvFoldEnabled(v))),
      [LINK_PREVIEW_STORAGE_KEY]: (v) => postLinkPreview(readLinkPreviewEnabled(v)),
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

      if (CONV_FOLDED_STORAGE_KEY in changes) {
        convFoldMap = readConvFoldMap(values);
        postConvFoldState(convFoldMap);
      }

      if (EXPORT_REQUEST_KEY in changes) {
        const req = changes[EXPORT_REQUEST_KEY].newValue as
          | { format?: unknown; requestId?: unknown }
          | undefined;
        if (req && req.format === 'markdown' && typeof req.requestId === 'string') {
          postToPage({
            type: MESSAGE_TYPE.exportRequest,
            format: req.format,
            requestId: req.requestId,
          });
        }
      }

      for (const key of DESKTOP_PET_KEYS) {
        if (key in changes) DESKTOP_PET_ABSORBERS[key](values);
      }
      if (touchesAny(changes, DESKTOP_PET_KEYS)) postDesktopPet();
    });

    // ---- incoming messages from the page ----------------------------------

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as PageOutboundMessage | undefined;
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

      if (data.type === MESSAGE_TYPE.convFoldChange) {
        if (!convFoldEnabled) return;
        const { scope, conversationKey, folded } = data;
        if (
          typeof scope !== 'string' || scope.length < 3 || scope.length > 220 ||
          typeof conversationKey !== 'string' || conversationKey.length < 3 || conversationKey.length > 260 ||
          typeof folded !== 'boolean'
        ) {
          return;
        }

        // Serialize read-modify-write so two quick row clicks cannot overwrite
        // each other with snapshots read from the same storage version.
        foldWriteQueue = foldWriteQueue.then(async () => {
          const latest = await browser.storage.local.get(CONV_FOLDED_STORAGE_KEY) as SettingValues;
          const map = readConvFoldMap(latest);
          const keys = new Set(map[scope] ?? []);
          if (folded) keys.add(conversationKey);
          else keys.delete(conversationKey);
          if (keys.size > 0) map[scope] = [...keys];
          else delete map[scope];
          await browser.storage.local.set({ [CONV_FOLDED_STORAGE_KEY]: map });
        }).catch(() => undefined);
        return;
      }

      if (data.type === MESSAGE_TYPE.exportResult) {
        if (
          typeof data.content === 'string' &&
          typeof data.fileName === 'string' &&
          typeof data.summary === 'string' &&
          typeof data.requestId === 'string'
        ) {
          void browser.storage.local.set({
            [EXPORT_RESULT_KEY]: {
              content: data.content,
              fileName: data.fileName,
              summary: data.summary,
              requestId: data.requestId,
            },
          });
        }
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

    // ---- incoming messages from the background/extension ----------------
    browser.runtime.onMessage.addListener((message) => {
      const msg = message as Record<string, unknown>;
      if (msg?.type === 'octo:focus-input') {
        window.postMessage(
          { source: MESSAGE_SOURCE, type: 'focusInput' },
          '*',
        );
        return;
      }
      if (msg?.type === 'octo:quick-mention' && typeof msg.index === 'number') {
        window.postMessage(
          { source: MESSAGE_SOURCE, type: 'quickMention', index: msg.index },
          '*',
        );
      }
    });
  },
});
