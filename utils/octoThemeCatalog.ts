/**
 * Pure theme/skin catalog — data only, ZERO imports.
 *
 * This module exists so that consumers who only need the *list* of themes and
 * the default ids (the ISOLATED content script and the Side Panel) never have
 * to import `octoBeautify`. Importing the engine drags in its ~4300-line CSS
 * payload and, through `octoFullscreenKickPixi`, the whole of pixi.js — which
 * used to end up inside the content script bundle as dead code.
 *
 * Keep this file free of imports and side effects.
 */

export type ThemeCategory = 'light' | 'dark' | 'classic' | 'special';

export interface ThemePresentation {
  description: string;
  category: ThemeCategory;
  colors: [string, string, string];
  keywords?: string[];
}

export interface ThemeDef extends ThemePresentation {
  id: string;
  label: string;
  icon: string;
  base: 'light' | 'dark';
  skin: string;
}

export interface GlobalThemeDef extends ThemePresentation {
  id: string;
  label: string;
  icon: string;
}

/** Selectable soccer-kick styles (worldcup skin). Shown in the Side Panel. */
export interface KickStyleDef {
  id: string;
  label: string;
  icon: string;
  /** total animation duration in ms (for cleanup safety) */
  dur: number;
  /** extra trail/effect child nodes this style needs */
  fx: string[];
  /** whether the goal net + bubble shake on impact */
  shake?: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: "cyber-light", label: "赛博紫 · 亮", icon: "☀️", base: "light", skin: "", description: "明亮、清爽的默认紫色界面", category: "light", colors: ["#f7f7ff", "#7c6bf0", "#55d6be"], keywords: ["默认", "紫色", "明亮"] },
  { id: "cyber-dark", label: "赛博紫 · 暗", icon: "\u{1F319}", base: "dark", skin: "", description: "深色背景与霓虹紫的夜间模式", category: "dark", colors: ["#171822", "#8d7cff", "#42d3bd"], keywords: ["黑色", "夜间", "暗色"] },
  { id: "worldcup", label: "美加墨世界杯", icon: "\u{1F3C6}", base: "light", skin: "worldcup", description: "球场绿、海军蓝与金色赛事元素", category: "special", colors: ["#f7f3ea", "#0b6e4f", "#c6a04a"], keywords: ["足球", "世界杯", "运动"] },
  { id: "qq2012", label: "QQ 2012 经典", icon: "\u{1F427}", base: "light", skin: "qq2012", description: "经典 QQ 会话列表与清透气泡", category: "classic", colors: ["#eaf7ff", "#56b8e9", "#8ed667"], keywords: ["怀旧", "QQ", "经典"] },
  { id: "qq2014", label: "QQ 2014 气泡", icon: "\u{1F4AC}", base: "light", skin: "qq2014", description: "熟悉的彩色气泡与紧凑对话", category: "classic", colors: ["#f3fbff", "#73c7f0", "#b9e77b"], keywords: ["怀旧", "QQ", "气泡"] },
];
export const DEFAULT_THEME = "cyber-light";

export const GLOBAL_THEMES: GlobalThemeDef[] = [
  { id: "none", label: "跟随原站", icon: "▫️", description: "保留 Octo 原本的导航和工作区配色", category: "light", colors: ["#ffffff", "#f2f3f5", "#3370ff"], keywords: ["原生", "默认", "Octo"] },
  { id: "cyber-light", label: "赛博紫 · 亮", icon: "☀️", description: "浅色工作区搭配低饱和赛博紫", category: "light", colors: ["#fafaff", "#ece9ff", "#7c6bf0"], keywords: ["紫色", "明亮", "工作台"] },
  { id: "cyber-dark", label: "赛博紫 · 暗", icon: "\u{1F319}", description: "适合夜间使用的暗色工作区", category: "dark", colors: ["#151720", "#242735", "#8d7cff"], keywords: ["暗色", "夜间", "黑色"] },
  { id: "mist", label: "雾青工作台", icon: "◈", description: "安静的雾青与灰蓝色工作台", category: "light", colors: ["#f4f8f8", "#dce9e8", "#5d8583"], keywords: ["青色", "灰色", "极简"] },
  { id: "worldcup", label: "美加墨世界杯", icon: "\u{1F3C6}", description: "以海军蓝、球场绿点缀整个 Octo", category: "special", colors: ["#f7f3ea", "#13294b", "#0b6e4f"], keywords: ["足球", "世界杯", "运动"] },
];
export const DEFAULT_GLOBAL_THEME = "none";

export const KICK_STYLES: KickStyleDef[] = [
  { id: 'lightning', label: '闪电爆射', icon: '⚡', dur: 620, fx: ['bolt'], shake: true },
  { id: 'fire', label: '火焰弹道', icon: '🔥', dur: 700, fx: ['flame'], shake: true },
  { id: 'bullet', label: '子弹时间', icon: '🎬', dur: 950, fx: ['ghost', 'ghost', 'ghost'] },
  { id: 'comet', label: '彗星光轨', icon: '☄️', dur: 800, fx: ['trail'] },
  { id: 'cannon', label: '重炮轰门', icon: '💥', dur: 620, fx: ['shock'], shake: true },
];
export const DEFAULT_KICK_STYLE = 'lightning';

/** Resolve a stored/incoming theme id, falling back to the default entry. */
export function themeById(id: string): ThemeDef {
  for (const t of THEMES) if (t.id === id) return t;
  return THEMES[0];
}

/** Resolve a stored/incoming kick style id, falling back to the first entry. */
export function kickStyleById(id: string): KickStyleDef {
  for (const s of KICK_STYLES) if (s.id === id) return s;
  return KICK_STYLES[0];
}
