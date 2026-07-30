// Shared constants between popup, content script (ISOLATED) and injected script (MAIN world).

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

/** storage.local keys for the single imported desktop pet and its state. */
export const DESKTOP_PET_STORAGE_KEY = 'octoDesktopPet';
export const DESKTOP_PET_ENABLED_STORAGE_KEY = 'octoDesktopPetEnabled';
export const DESKTOP_PET_POSITION_STORAGE_KEY = 'octoDesktopPetPosition';

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
  toggle: 'toggle',
  theme: 'theme',
  globalTheme: 'globalTheme',
  kickStyle: 'kickStyle',
  playerWatermark: 'playerWatermark',
  ballCursor: 'ballCursor',
  desktopPet: 'desktopPet',
  desktopPetPosition: 'desktopPetPosition',
} as const;

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
  /** Legacy complete player+ball image, retained for compatibility. */
  imageUrl: string;
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

/** Complete storage-backed pet state sent from the isolated content script. */
export interface DesktopPetMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.desktopPet;
  enabled: boolean;
  pet: StoredDesktopPet | null;
  position: DesktopPetPosition | null;
}

/** Drag result sent from the MAIN world back to the content script for storage. */
export interface DesktopPetPositionMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.desktopPetPosition;
  position: DesktopPetPosition;
}

export type OctoMessage =
  | ToggleMessage
  | ThemeMessage
  | GlobalThemeMessage
  | KickStyleMessage
  | PlayerWatermarkMessage
  | BallCursorMessage
  | DesktopPetMessage
  | DesktopPetPositionMessage;
