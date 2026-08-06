// Shared constants between popup, content script (ISOLATED) and injected script (MAIN world).

/**
 * The Octo deployment this extension attaches to.
 *
 * Single source of truth: `wxt.config.ts` uses it for `host_permissions` /
 * `web_accessible_resources` and `octo.content.ts` uses it for the content
 * script's `matches`. Changing the deployment domain should only ever require
 * editing this one line.
 */
export const OCTO_MATCHES = ['https://im.deepminer.com.cn/*'] as const;

/** storage.local key holding the global master switch. Off => behaves like the
 *  extension is uninstalled (recall + beautify + themes + kick all torn down).
 *  Default ON (missing key => enabled). */
export const MASTER_STORAGE_KEY = 'octoMasterEnabled';

/** storage.local key holding the "show recalled messages" on/off state. Default OFF. */
export const STORAGE_KEY = 'octoRecallEnabled';

/**
 * storage.local key for the beautify + theme engine's own on/off switch.
 *
 * Separate from the master switch: the panel gives every feature its own toggle,
 * and message beautifying is a feature like any other. Missing means ON, so
 * existing users see no change.
 */
export const BEAUTIFY_STORAGE_KEY = 'octoBeautifyEnabled';

/** storage.local key holding the selected message theme/skin id. Default cyber-light. */
export const THEME_STORAGE_KEY = 'octoThemeId';

/** storage.local key holding the selected whole-site color theme id. */
export const GLOBAL_THEME_STORAGE_KEY = 'octoGlobalThemeId';

/** storage.local key holding the selected soccer-kick style id (worldcup skin). */
export const KICK_STYLE_STORAGE_KEY = 'octoKickStyle';

/** Legacy boolean key kept so existing Messi selections migrate cleanly. */
export const MESSI_WATERMARK_STORAGE_KEY = 'octoMessiWatermarkEnabled';

/** storage.local key holding the single selected player watermark. */
export const PLAYER_WATERMARK_STORAGE_KEY = 'octoPlayerWatermark';
export type PlayerWatermarkId = 'none' | 'messi' | 'mbappe';

/** storage.local key holding the "replace cursor with a football" on/off state. Default ON. */
export const BALL_CURSOR_STORAGE_KEY = 'octoBallCursorEnabled';

/**
 * storage.local key for the QQ 2014 skin's "keep my own messages on the left"
 * option. Default OFF (own messages sit on the right, like real QQ). Turning it
 * on keeps octo-web's native all-left layout while still using the QQ bubbles.
 */
export const QQ_SELF_LEFT_STORAGE_KEY = 'octoQQSelfLeft';

/** storage.local keys for the single imported desktop pet and its state. */
export const DESKTOP_PET_STORAGE_KEY = 'octoDesktopPet';
export const DESKTOP_PET_ENABLED_STORAGE_KEY = 'octoDesktopPetEnabled';
export const DESKTOP_PET_POSITION_STORAGE_KEY = 'octoDesktopPetPosition';
export const DESKTOP_PET_PLACEMENT_STORAGE_KEY = 'octoDesktopPetPlacement';
export type DesktopPetPlacement = 'desktop' | 'composer';
export const BUILT_IN_COMPANION_STORAGE_KEY = 'octoBuiltInCompanion';
export type BuiltInCompanionId = 'ant' | 'snail' | 'wizard' | 'zombie';

/** Comfortable three-line composer layout. Missing means enabled. */
export const COMPOSER_ENHANCEMENT_STORAGE_KEY = 'octoComposerEnhancementEnabled';

/**
 * storage.local key holding the last Octo DOM compatibility report.
 *
 * Octo is a moving target: when a redesign renames the classes we hook into, the
 * affected feature silently stops working. The MAIN world checks the
 * load-bearing selectors after boot and stores the verdict here so the Side
 * Panel can say which capability broke instead of leaving the user guessing.
 */
export const COMPAT_REPORT_STORAGE_KEY = 'octoCompatReport';

export interface DesktopPetAnimationManifest {
  row: number;
  /** A frame count starting at column 0, or an explicit list of column indexes. */
  frames: number | number[];
  fps?: number;
  frameDurationMs?: number;
  /** Optional per-frame timings for Codex-compatible and other variable-speed loops. */
  frameDurationsMs?: number[];
  loop?: boolean;
}

export interface DesktopPetStateAnimations {
  idle?: string;
  hover?: string;
  drag?: string;
  dragLeft?: string;
  dragRight?: string;
}

export interface DesktopPetManifest {
  id: string;
  displayName: string;
  description?: string;
  spritesheetPath: string;
  /** Codex v1/v2 atlas contract. Omitted Codex v1 packages are detected by dimensions. */
  spriteVersionNumber?: 1 | 2;
  columns?: number;
  rows?: number;
  frameDurationMs?: number;
  animations?: Record<string, DesktopPetAnimationManifest>;
  stateAnimations?: DesktopPetStateAnimations;
}

export interface StoredDesktopPet {
  manifest: DesktopPetManifest;
  spritesheetDataUrl: string;
  importedAt: number;
}

export interface DesktopPetPosition {
  x: number;
  y: number;
}

/**
 * storage.local keys for the AI balance widget.
 *
 * Deliberately two keys: the *config* is user input (endpoint + API key) and
 * only the Side Panel writes it, while the *cache* is the last fetch result and
 * only the background writes it. Splitting them means a refresh never rewrites
 * the secret, and the panel can render a value instantly without waiting for a
 * network round trip.
 */
export const AI_BALANCE_CONFIG_STORAGE_KEY = 'octoAiBalanceConfig';
export const AI_BALANCE_CACHE_STORAGE_KEY = 'octoAiBalanceCache';

/**
 * Page-facing projection of the two keys above, written by the background.
 *
 * A third key rather than letting the content script derive it: the content
 * script would then have to read the config — i.e. the API key — to decide what
 * to show, and it would need the formatting code, which its 15 KB budget cannot
 * afford. Precomputing here means the always-injected script relays an opaque
 * string and never touches the secret.
 */
export const AI_BALANCE_PAGE_STORAGE_KEY = 'octoAiBalancePage';

/** Everything the Octo page may know about the balance. */
export interface AiBalancePageState {
  /** Empty means "show nothing". */
  text: string;
  low: boolean;
}

/**
 * How to reach a balance endpoint and where the number sits in its response.
 *
 * Note what is NOT here: a user-supplied extractor function. Reading the value
 * is a declarative `path` instead, because evaluating pasted JS would need
 * `unsafe-eval` (impossible for MV3 extension pages) or a sandbox frame, and
 * would hand arbitrary code both the extension's cross-origin fetch ability and
 * the stored API key. A path covers every balance API shape we have seen.
 */
export interface AiBalanceConfig {
  /**
   * Feature switch. Off keeps the configuration but stops the polling, the badge
   * and the page pill — so turning it back on does not mean re-typing the key.
   */
  enabled: boolean;
  /** Preset the user picked, or 'custom'. Kept so the panel can re-render the form. */
  presetId: string;
  /** Absolute https URL, already carrying the key when the API expects it in the query. */
  url: string;
  method: 'GET' | 'POST';
  /** Extra request headers, e.g. `Authorization: Bearer …`. */
  headers: Record<string, string>;
  /** Dotted path into the JSON response, e.g. `data.remain_quota_usd`. */
  path: string;
  /**
   * Where the total quota sits, so the icon badge can show a percentage.
   *
   * Empty means auto-detect: most gateways report either a total or a "used"
   * figure next to the remainder, and guessing from a short candidate list beats
   * asking every user to go find the field name. Percentage is simply skipped
   * when neither is present — four digits do not fit in a toolbar badge, but a
   * wrong percentage would be worse than none.
   */
  totalPath: string;
  /** Displayed after the number, e.g. `美元💵`. */
  unit: string;
  /** Applied to the raw value, for APIs that report cents or token quota. */
  multiplier: number;
  decimals: number;
  refreshMinutes: number;
  /**
   * Show the remaining percentage on the toolbar icon instead of the amount.
   * Only possible when a total is known; falls back to the amount otherwise.
   */
  badgePercent: boolean;
  /** Below this the badge turns red. `null` disables the warning. */
  lowThreshold: number | null;
  /** Also show the balance next to the Octo composer. */
  showInPage: boolean;
}

/** Last fetch result. A failure keeps the previous value so the panel can still show it. */
export interface AiBalanceCache {
  value: number | null;
  /** Total quota, when the API reports one (or one could be derived). */
  total: number | null;
  /** 0-100, or null when no total is known. */
  percent: number | null;
  unit: string;
  /** Epoch ms of the last *successful* fetch. */
  fetchedAt: number;
  /** Human-readable reason of the last failure, '' when the last fetch worked. */
  error: string;
  erroredAt: number;
}

/** window.postMessage envelope source, so we ignore unrelated messages. */
export const MESSAGE_SOURCE = 'octo-recall';

/**
 * runtime.sendMessage types for Side Panel -> background.
 *
 * The fetch lives in the background on purpose: the API key must never reach the
 * Octo tab (MAIN world shares a realm with the page), and only the background
 * can keep refreshing on an alarm after the panel is closed.
 */
export const RUNTIME_MESSAGE_TYPE = {
  aiBalanceRefresh: 'octoAiBalanceRefresh',
  aiBalanceTest: 'octoAiBalanceTest',
} as const;

export interface AiBalanceRefreshRequest {
  type: typeof RUNTIME_MESSAGE_TYPE.aiBalanceRefresh;
}

/** Try a config without persisting it, so 「测试」 cannot corrupt a working setup. */
export interface AiBalanceTestRequest {
  type: typeof RUNTIME_MESSAGE_TYPE.aiBalanceTest;
  config: AiBalanceConfig;
}

export type RuntimeRequest = AiBalanceRefreshRequest | AiBalanceTestRequest;

/** Result of a fetch attempt, shared by the refresh and test paths. */
export interface AiBalanceProbeResult {
  ok: boolean;
  value: number | null;
  total: number | null;
  percent: number | null;
  unit: string;
  error: string;
  fetchedAt: number;
}

/** Message types sent from content script -> injected main-world script. */
export const MESSAGE_TYPE = {
  master: 'master',
  toggle: 'toggle',
  beautify: 'beautify',
  theme: 'theme',
  globalTheme: 'globalTheme',
  kickStyle: 'kickStyle',
  playerWatermark: 'playerWatermark',
  ballCursor: 'ballCursor',
  qqSelfLeft: 'qqSelfLeft',
  composerEnhancement: 'composerEnhancement',
  desktopPet: 'desktopPet',
  desktopPetPosition: 'desktopPetPosition',
  aiBalance: 'aiBalance',
  requestKickScript: 'requestKickScript',
  compatReport: 'compatReport',
} as const;

export interface MasterMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.master;
  enabled: boolean;
}

export interface ToggleMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.toggle;
  enabled: boolean;
}

/** Beautify + theme engine on/off, independent of the master switch. */
export interface BeautifyMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.beautify;
  enabled: boolean;
}

export interface ThemeMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.theme;
  themeId: string;
}

export interface GlobalThemeMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.globalTheme;
  themeId: string;
}

export interface KickStyleMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.kickStyle;
  styleId: string;
}

export interface PlayerWatermarkMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.playerWatermark;
  playerId: PlayerWatermarkId;
  /** Player cutout with the stationary ball removed. */
  playerImageUrl: string;
  /** Detached ball used by the full-screen kick canvas. */
  ballImageUrl: string;
}

export interface BallCursorMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.ballCursor;
  enabled: boolean;
}

/** QQ 2014 skin: keep own messages left-aligned instead of flipping them right. */
export interface QQSelfLeftMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.qqSelfLeft;
  enabled: boolean;
}

/** Complete storage-backed pet state sent from the isolated content script. */
export interface DesktopPetMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.desktopPet;
  enabled: boolean;
  pet: StoredDesktopPet | null;
  position: DesktopPetPosition | null;
  placement: DesktopPetPlacement;
  builtInCompanion: BuiltInCompanionId | null;
}

export interface ComposerEnhancementMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.composerEnhancement;
  enabled: boolean;
}

/**
 * AI balance shown next to the composer.
 *
 * Only the already-formatted string crosses into the page — never the URL, the
 * headers or the key. The MAIN world runs with the page's privileges, so
 * anything sent here is effectively public to Octo's own scripts.
 */
export interface AiBalanceMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.aiBalance;
  /** Empty string means "show nothing" (disabled, unconfigured or never fetched). */
  text: string;
  /** Below the configured threshold, so the pill can warn. */
  low: boolean;
}

/** Drag result sent from the MAIN world back to the content script for storage. */
export interface DesktopPetPositionMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.desktopPetPosition;
  position: DesktopPetPosition;
}

/**
 * MAIN world -> content script: pull in the pixi.js kick effect on demand.
 *
 * The effect lives in its own unlisted entrypoint (`octo-kick-world.js`) so the
 * ~700 KB WebGL engine is never part of the always-injected main-world bundle.
 * Only the content script can call `injectScript`, hence the round trip.
 */
export interface RequestKickScriptMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.requestKickScript;
}

/** Page global the on-demand kick script registers itself under. */
export const KICK_GLOBAL_KEY = '__octoFullscreenKick';

/** Event the kick script dispatches on `window` once its API is registered. */
export const KICK_READY_EVENT = 'octo:kick-ready';

/** Shape registered on `window[KICK_GLOBAL_KEY]` by the kick script. */
export interface KickScriptApi {
  setFullscreenKickStyle(styleId: string): void;
  setFullscreenKickBallCursor(enabled: boolean): void;
  setFullscreenKickPlayer(playerId: PlayerWatermarkId, ballImageUrl: string): void;
}

/** Persisted form of a compatibility report (see COMPAT_REPORT_STORAGE_KEY). */
export interface StoredCompatReport {
  /** Features whose selector no longer matches anything in Octo's DOM. */
  brokenFeatures: string[];
  /** Selector keys behind those features, for logs and bug reports. */
  brokenKeys: string[];
  /** Epoch ms of the check, so the panel can ignore stale reports. */
  checkedAt: number;
}

/** MAIN world -> content script: persist the latest compatibility verdict. */
export interface CompatReportMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.compatReport;
  report: StoredCompatReport;
}

export type OctoMessage =
  | MasterMessage
  | ToggleMessage
  | BeautifyMessage
  | ThemeMessage
  | GlobalThemeMessage
  | KickStyleMessage
  | PlayerWatermarkMessage
  | BallCursorMessage
  | QQSelfLeftMessage
  | ComposerEnhancementMessage
  | AiBalanceMessage
  | DesktopPetMessage
  | DesktopPetPositionMessage
  | RequestKickScriptMessage
  | CompatReportMessage;
