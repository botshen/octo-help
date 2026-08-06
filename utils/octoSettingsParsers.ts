import {
  BALL_CURSOR_STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  PLAYER_WATERMARK_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
  type BuiltInCompanionId,
  type DesktopPetPlacement,
  type DesktopPetPosition,
  type PlayerWatermarkId,
  type StoredDesktopPet,
} from './octoRecall';
import {
  DEFAULT_GLOBAL_THEME,
  DEFAULT_KICK_STYLE,
  DEFAULT_THEME,
} from './octoThemeCatalog';
import {
  isBuiltInCompanionId,
  isDesktopPetPosition,
  isStoredDesktopPet,
} from './octoPetState';

/**
 * Parsers that turn raw `storage.local` values into the typed settings the
 * content script relays to the page.
 *
 * These used to live inline in octo.content.ts, written twice per setting: once
 * against the initial snapshot and again inside the `storage.onChanged` handler.
 * Two copies of the same rule can disagree, and there was nothing to notice it —
 * this file exists so each rule has one home and can be tested, since this is
 * exactly the kind of defaulting logic where an off-by-one-condition is silent.
 *
 * Both call sites pass the same shape (`{ key: value }`), so most settings need
 * only one function. Three genuinely differ between the two paths, and those
 * differences are load-bearing — see `readDesktopPetEnabledFromChange` for the
 * case that makes this non-negotiable.
 */

/** Storage snapshot or an `onChanged` change set flattened to new values. */
export type SettingValues = Record<string, unknown>;

// ---- settings whose rule is identical on both paths -----------------------

/** Master switch. Missing means ON, so existing users are unaffected. */
export function readMaster(v: SettingValues): boolean {
  return v[MASTER_STORAGE_KEY] !== false;
}

/** Beautify + theme engine toggle. Missing means ON, so nothing changes on upgrade. */
export function readBeautifyEnabled(v: SettingValues): boolean {
  return v[BEAUTIFY_STORAGE_KEY] !== false;
}

/** "Show recalled messages" toggle. Missing means OFF. */
export function readRecallEnabled(v: SettingValues): boolean {
  return v[STORAGE_KEY] === true;
}

export function readTheme(v: SettingValues): string {
  const value = v[THEME_STORAGE_KEY];
  return typeof value === 'string' ? value : DEFAULT_THEME;
}

export function readGlobalTheme(v: SettingValues): string {
  const value = v[GLOBAL_THEME_STORAGE_KEY];
  return typeof value === 'string' ? value : DEFAULT_GLOBAL_THEME;
}

export function readKickStyle(v: SettingValues): string {
  const value = v[KICK_STYLE_STORAGE_KEY];
  return typeof value === 'string' ? value : DEFAULT_KICK_STYLE;
}

/** Football cursor. Missing means ON, so existing users keep it. */
export function readBallCursor(v: SettingValues): boolean {
  return v[BALL_CURSOR_STORAGE_KEY] !== false;
}

/** QQ 2014 "own messages on the left". Missing means OFF, like real QQ. */
export function readQQSelfLeft(v: SettingValues): boolean {
  return v[QQ_SELF_LEFT_STORAGE_KEY] === true;
}

/** Comfortable composer. Missing means ON. */
export function readComposerEnhancement(v: SettingValues): boolean {
  return v[COMPOSER_ENHANCEMENT_STORAGE_KEY] !== false;
}

export function readDesktopPet(v: SettingValues): StoredDesktopPet | null {
  const value = v[DESKTOP_PET_STORAGE_KEY];
  return isStoredDesktopPet(value) ? value : null;
}

export function readDesktopPetPosition(v: SettingValues): DesktopPetPosition | null {
  const value = v[DESKTOP_PET_POSITION_STORAGE_KEY];
  return isDesktopPetPosition(value) ? value : null;
}

export function readDesktopPetPlacement(v: SettingValues): DesktopPetPlacement {
  return v[DESKTOP_PET_PLACEMENT_STORAGE_KEY] === 'composer' ? 'composer' : 'desktop';
}

// ---- settings whose rule differs between first read and later changes -----

/**
 * Player watermark, first read.
 *
 * Falls back to the legacy boolean key so an existing Messi selection migrates.
 * This is a one-time migration concern: the Side Panel only ever writes the new
 * key, so a later change must not consult the legacy one.
 */
export function readPlayerWatermarkInitial(v: SettingValues): PlayerWatermarkId {
  const value = v[PLAYER_WATERMARK_STORAGE_KEY];
  if (value === 'messi' || value === 'mbappe' || value === 'none') return value;
  return v[MESSI_WATERMARK_STORAGE_KEY] === true ? 'messi' : 'none';
}

/** Player watermark, later changes. No legacy fallback — see above. */
export function readPlayerWatermarkFromChange(v: SettingValues): PlayerWatermarkId {
  const value = v[PLAYER_WATERMARK_STORAGE_KEY];
  return value === 'messi' || value === 'mbappe' ? value : 'none';
}

/**
 * Built-in companion, first read.
 *
 * Defaults to the wizard for users who have never configured a pet at all, so
 * the feature is discoverable. Absence of the key is what marks "never
 * configured", which only means anything on the first read.
 */
export function readBuiltInCompanionInitial(v: SettingValues): BuiltInCompanionId | null {
  const value = v[BUILT_IN_COMPANION_STORAGE_KEY];
  if (isBuiltInCompanionId(value)) return value;
  return value === undefined && !readDesktopPet(v) ? 'wizard' : null;
}

/** Built-in companion, later changes. No default — an explicit clear means none. */
export function readBuiltInCompanionFromChange(v: SettingValues): BuiltInCompanionId | null {
  const value = v[BUILT_IN_COMPANION_STORAGE_KEY];
  return isBuiltInCompanionId(value) ? value : null;
}

/**
 * Desktop pet enabled, first read.
 *
 * A missing key means the user predates the setting, in which case having a
 * built-in companion configured implies enabled.
 */
export function readDesktopPetEnabledInitial(v: SettingValues): boolean {
  const value = v[DESKTOP_PET_ENABLED_STORAGE_KEY];
  return (
    value === true ||
    (value === undefined && readBuiltInCompanionInitial(v) !== null)
  );
}

/**
 * Desktop pet enabled, later changes. Strictly `=== true`, and that difference
 * matters: deleting a pet *removes* this key (see the Side Panel's delete flow),
 * so the change set carries `undefined`. Applying the initial rule there would
 * consult the companion default and re-enable the pet the user just deleted.
 */
export function readDesktopPetEnabledFromChange(v: SettingValues): boolean {
  return v[DESKTOP_PET_ENABLED_STORAGE_KEY] === true;
}

/** Every key the content script needs to read at startup. */
export const RELAYED_STORAGE_KEYS = [
  MASTER_STORAGE_KEY,
  STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
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
] as const;

/**
 * Settings that map one storage key to one page message, in the order the
 * change handler should process them.
 *
 * The content script keys its relay table off this union, so a `Record` makes
 * "every simple setting is handled" a compile-time property instead of something
 * you notice when a toggle silently stops working.
 */
export const SIMPLE_RELAY_KEYS = [
  STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  PLAYER_WATERMARK_STORAGE_KEY,
  BALL_CURSOR_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
] as const;

export type SimpleRelayKey = (typeof SIMPLE_RELAY_KEYS)[number];

/** Keys that all feed the single desktop-pet message. */
export const DESKTOP_PET_KEYS = [
  DESKTOP_PET_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
] as const;

export type DesktopPetKey = (typeof DESKTOP_PET_KEYS)[number];



/**
 * The legacy key is read once for migration and is never written, so it has no
 * relay of its own — it only participates in `readPlayerWatermarkInitial`.
 */
export const MIGRATION_ONLY_KEYS = [MESSI_WATERMARK_STORAGE_KEY] as const;
