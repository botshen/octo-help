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

/** window.postMessage envelope source, so we ignore unrelated messages. */
export const MESSAGE_SOURCE = 'octo-recall';

/** Message types sent from content script -> injected main-world script. */
export const MESSAGE_TYPE = {
  master: 'master',
  toggle: 'toggle',
  theme: 'theme',
  globalTheme: 'globalTheme',
  kickStyle: 'kickStyle',
  playerWatermark: 'playerWatermark',
  ballCursor: 'ballCursor',
  qqSelfLeft: 'qqSelfLeft',
  composerEnhancement: 'composerEnhancement',
  desktopPet: 'desktopPet',
  desktopPetPosition: 'desktopPetPosition',
  requestKickScript: 'requestKickScript',
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

export type OctoMessage =
  | MasterMessage
  | ToggleMessage
  | ThemeMessage
  | GlobalThemeMessage
  | KickStyleMessage
  | PlayerWatermarkMessage
  | BallCursorMessage
  | QQSelfLeftMessage
  | ComposerEnhancementMessage
  | DesktopPetMessage
  | DesktopPetPositionMessage
  | RequestKickScriptMessage;
