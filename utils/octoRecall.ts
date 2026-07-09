// Shared constants between popup, content script (ISOLATED) and injected script (MAIN world).

/** storage.local key holding the "show recalled messages" on/off state. Default OFF. */
export const STORAGE_KEY = 'octoRecallEnabled';

/** storage.local key holding the selected message theme/skin id. Default cyber-light. */
export const THEME_STORAGE_KEY = 'octoThemeId';

/** storage.local key holding the selected soccer-kick style id (worldcup skin). */
export const KICK_STYLE_STORAGE_KEY = 'octoKickStyle';

/** window.postMessage envelope source, so we ignore unrelated messages. */
export const MESSAGE_SOURCE = 'octo-recall';

/** Message types sent from content script -> injected main-world script. */
export const MESSAGE_TYPE = {
  toggle: 'toggle',
  theme: 'theme',
  kickStyle: 'kickStyle',
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

export interface KickStyleMessage {
  source: typeof MESSAGE_SOURCE;
  type: typeof MESSAGE_TYPE.kickStyle;
  styleId: string;
}

export type OctoMessage = ToggleMessage | ThemeMessage | KickStyleMessage;
