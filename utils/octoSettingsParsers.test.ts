import { describe, expect, it } from 'vitest';
import {
  AI_BALANCE_PAGE_STORAGE_KEY,
  BALL_CURSOR_STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  PLAYER_WATERMARK_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
} from './octoRecall';
import { DEFAULT_THEME } from './octoThemeCatalog';
import {
  DESKTOP_PET_KEYS,
  MIGRATION_ONLY_KEYS,
  RELAYED_STORAGE_KEYS,
  SIMPLE_RELAY_KEYS,
  readAiBalancePage,
  readBallCursor,
  readBeautifyEnabled,
  readBuiltInCompanionFromChange,
  readBuiltInCompanionInitial,
  readComposerEnhancement,
  readDesktopPetEnabledFromChange,
  readDesktopPetEnabledInitial,
  readDesktopPetPlacement,
  readMaster,
  readPlayerWatermarkFromChange,
  readPlayerWatermarkInitial,
  readQQSelfLeft,
  readRecallEnabled,
  readTheme,
} from './octoSettingsParsers';
import { postToPage, toNewValues, touchesAny } from './octoSettingsRelay';

/**
 * These defaulting rules used to be written twice per setting — once for the
 * initial storage snapshot and once inside the onChanged handler — with no test
 * coverage at all. The pair that must NOT be unified is pinned explicitly below,
 * because unifying it silently resurrects a deleted pet.
 */

describe('defaults that keep existing users unaffected', () => {
  it.each([
    ['master', readMaster, MASTER_STORAGE_KEY, true],
    ['ball cursor', readBallCursor, BALL_CURSOR_STORAGE_KEY, true],
    ['composer enhancement', readComposerEnhancement, COMPOSER_ENHANCEMENT_STORAGE_KEY, true],
  ] as const)('%s defaults ON when the key is missing', (_l, read, key, expected) => {
    expect(read({})).toBe(expected);
    expect(read({ [key]: false })).toBe(false);
    expect(read({ [key]: true })).toBe(true);
    // Anything that is not an explicit `false` counts as enabled.
    expect(read({ [key]: 'nonsense' })).toBe(true);
  });

  it.each([
    ['recall', readRecallEnabled, STORAGE_KEY],
    ['qq self-left', readQQSelfLeft, QQ_SELF_LEFT_STORAGE_KEY],
  ] as const)('%s defaults OFF when the key is missing', (_l, read, key) => {
    expect(read({})).toBe(false);
    expect(read({ [key]: true })).toBe(true);
    // Only an explicit `true` enables it.
    expect(read({ [key]: 'true' })).toBe(false);
  });

  it('falls back to the default theme for a non-string value', () => {
    expect(readTheme({})).toBe(DEFAULT_THEME);
    expect(readTheme({ [THEME_STORAGE_KEY]: 42 })).toBe(DEFAULT_THEME);
    // Unknown ids pass through; the page resolves them against its whitelist.
    expect(readTheme({ [THEME_STORAGE_KEY]: 'anything' })).toBe('anything');
  });

  it('treats any non-composer placement as desktop', () => {
    expect(readDesktopPetPlacement({})).toBe('desktop');
    expect(readDesktopPetPlacement({ [DESKTOP_PET_PLACEMENT_STORAGE_KEY]: 'composer' })).toBe(
      'composer',
    );
    expect(readDesktopPetPlacement({ [DESKTOP_PET_PLACEMENT_STORAGE_KEY]: 'floating' })).toBe(
      'desktop',
    );
  });
});

describe('player watermark: legacy migration is first-read only', () => {
  it('migrates the legacy Messi boolean on first read', () => {
    expect(readPlayerWatermarkInitial({ [MESSI_WATERMARK_STORAGE_KEY]: true })).toBe('messi');
  });

  it('prefers the new key over the legacy one', () => {
    expect(
      readPlayerWatermarkInitial({
        [PLAYER_WATERMARK_STORAGE_KEY]: 'mbappe',
        [MESSI_WATERMARK_STORAGE_KEY]: true,
      }),
    ).toBe('mbappe');
  });

  it('honours an explicit none over the legacy key', () => {
    expect(
      readPlayerWatermarkInitial({
        [PLAYER_WATERMARK_STORAGE_KEY]: 'none',
        [MESSI_WATERMARK_STORAGE_KEY]: true,
      }),
    ).toBe('none');
  });

  it('ignores the legacy key on later changes', () => {
    // The Side Panel only ever writes the new key, so consulting the legacy one
    // here would resurrect a selection the user has since cleared.
    expect(
      readPlayerWatermarkFromChange({ [MESSI_WATERMARK_STORAGE_KEY]: true }),
    ).toBe('none');
  });
});

describe('built-in companion: the wizard default is first-read only', () => {
  it('defaults to the wizard for a user who has never configured a pet', () => {
    expect(readBuiltInCompanionInitial({})).toBe('wizard');
  });

  it('does not default when an imported pet exists', () => {
    expect(readBuiltInCompanionInitial({ [DESKTOP_PET_STORAGE_KEY]: validPet() })).toBeNull();
  });

  it('treats an explicit null as "no companion", not "unconfigured"', () => {
    expect(readBuiltInCompanionInitial({ [BUILT_IN_COMPANION_STORAGE_KEY]: null })).toBeNull();
  });

  it('passes through a known companion id', () => {
    expect(readBuiltInCompanionInitial({ [BUILT_IN_COMPANION_STORAGE_KEY]: 'snail' })).toBe(
      'snail',
    );
  });

  it('never defaults on a later change', () => {
    expect(readBuiltInCompanionFromChange({})).toBeNull();
    expect(readBuiltInCompanionFromChange({ [BUILT_IN_COMPANION_STORAGE_KEY]: 'ant' })).toBe(
      'ant',
    );
  });
});

describe('desktop pet enabled: the two rules must stay separate', () => {
  it('infers enabled from a configured companion on first read', () => {
    // Predates the setting: a companion being configured implies enabled.
    expect(readDesktopPetEnabledInitial({})).toBe(true);
  });

  it('respects an explicit false on first read', () => {
    expect(readDesktopPetEnabledInitial({ [DESKTOP_PET_ENABLED_STORAGE_KEY]: false })).toBe(
      false,
    );
  });

  it('does not infer enabled when an imported pet exists but no companion', () => {
    expect(
      readDesktopPetEnabledInitial({ [DESKTOP_PET_STORAGE_KEY]: validPet() }),
    ).toBe(false);
  });

  it('reports disabled when the key is removed, e.g. after deleting a pet', () => {
    // THIS is why the initial rule cannot be reused for changes. Deleting a pet
    // removes this key, so the change set carries `undefined`. Applying the
    // initial rule would consult the companion default and re-enable the pet the
    // user just deleted.
    const deletion = {
      [DESKTOP_PET_STORAGE_KEY]: undefined,
      [DESKTOP_PET_ENABLED_STORAGE_KEY]: undefined,
    };
    expect(readDesktopPetEnabledFromChange(deletion)).toBe(false);
    // Demonstrate the divergence explicitly, so unifying them breaks this test.
    expect(readDesktopPetEnabledInitial(deletion)).toBe(true);
  });
});

describe('key lists', () => {
  it('includes every desktop-pet key in the startup read', () => {
    for (const key of DESKTOP_PET_KEYS) {
      expect(RELAYED_STORAGE_KEYS).toContain(key);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(RELAYED_STORAGE_KEYS).size).toBe(RELAYED_STORAGE_KEYS.length);
  });

  it('accounts for every relayed key exactly once', () => {
    // A key read at startup but wired to no relay would be a setting that only
    // applies after a page reload — the kind of half-working behaviour this
    // partition is meant to make impossible.
    const accounted = [
      MASTER_STORAGE_KEY,
      ...SIMPLE_RELAY_KEYS,
      ...DESKTOP_PET_KEYS,
      ...MIGRATION_ONLY_KEYS,
    ];
    expect([...accounted].sort()).toEqual([...RELAYED_STORAGE_KEYS].sort());
  });

  it('keeps the relay groups disjoint', () => {
    const simple = new Set<string>(SIMPLE_RELAY_KEYS);
    for (const key of DESKTOP_PET_KEYS) expect(simple.has(key)).toBe(false);
    expect(simple.has(MASTER_STORAGE_KEY)).toBe(false);
  });
});

describe('relay helpers', () => {
  it('flattens a change set, keeping removals as undefined', () => {
    expect(toNewValues({ a: { newValue: 1 }, b: {} })).toEqual({ a: 1, b: undefined });
    // A removed key must still be *present*, since some parsers branch on it.
    expect('b' in toNewValues({ b: {} })).toBe(true);
  });

  it('detects whether a change set touched any of a key group', () => {
    expect(touchesAny({ x: 1 }, ['x', 'y'])).toBe(true);
    expect(touchesAny({ z: 1 }, ['x', 'y'])).toBe(false);
    // Presence counts even when the value was removed.
    expect(touchesAny({ x: undefined }, ['x'])).toBe(true);
  });

  it('tags outgoing messages with the shared source', () => {
    const posted: unknown[] = [];
    const original = globalThis.window;
    // @ts-expect-error minimal stand-in for the page window
    globalThis.window = { postMessage: (m: unknown) => posted.push(m) };
    postToPage({ type: 'theme', themeId: 'cyber-dark' });
    globalThis.window = original;
    expect(posted).toEqual([
      { source: 'octo-recall', type: 'theme', themeId: 'cyber-dark' },
    ]);
  });
});

function validPet() {
  return {
    manifest: {
      id: 'p',
      displayName: 'P',
      spritesheetPath: 's.webp',
      columns: 1,
      rows: 1,
      frameDurationMs: 100,
      animations: { idle: { row: 0, frames: 1 } },
      stateAnimations: { idle: 'idle' },
    },
    spritesheetDataUrl: 'data:image/webp;base64,AAAA',
    importedAt: 1,
  };
}

describe('readAiBalancePage', () => {
  it('defaults to showing nothing', () => {
    expect(readAiBalancePage({})).toEqual({ text: '', low: false });
    expect(readAiBalancePage({ [AI_BALANCE_PAGE_STORAGE_KEY]: 'nope' })).toEqual({
      text: '',
      low: false,
    });
  });

  it('relays the precomputed string and the low flag', () => {
    expect(
      readAiBalancePage({ [AI_BALANCE_PAGE_STORAGE_KEY]: { text: '12.35 美元💵', low: true } }),
    ).toEqual({ text: '12.35 美元💵', low: true });
  });

  it('bounds the text, since it ends up in the page DOM', () => {
    const long = 'x'.repeat(200);
    expect(readAiBalancePage({ [AI_BALANCE_PAGE_STORAGE_KEY]: { text: long } }).text).toHaveLength(
      40,
    );
  });
});

describe('readBeautifyEnabled', () => {
  it('defaults to on so upgrading does not turn the themes off', () => {
    expect(readBeautifyEnabled({})).toBe(true);
    expect(readBeautifyEnabled({ [BEAUTIFY_STORAGE_KEY]: true })).toBe(true);
  });

  it('is off only when explicitly false', () => {
    expect(readBeautifyEnabled({ [BEAUTIFY_STORAGE_KEY]: false })).toBe(false);
    // A removed key means "back to default", not "off".
    expect(readBeautifyEnabled({ [BEAUTIFY_STORAGE_KEY]: undefined })).toBe(true);
  });
});
