import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_COMPANIONS,
  getCompanionFacing,
  getCompanionPassDurationMs,
} from './octoBuiltInCompanion';

describe('getCompanionFacing', () => {
  it('mirrors the ant, whose glyph is drawn facing left', () => {
    // Without the mirror the squad marches left → right while every ant points
    // the other way, which reads as walking backwards.
    expect(getCompanionFacing('ant')).toBe(-1);
  });

  it('leaves companions that already face the march untouched', () => {
    expect(getCompanionFacing('snail')).toBe(1);
    expect(getCompanionFacing('wizard')).toBe(1);
    expect(getCompanionFacing('zombie')).toBe(1);
  });
});

describe('getCompanionPassDurationMs', () => {
  it('stays awake for one complete crossing per companion', () => {
    // The wake timer is derived from the CSS pass duration; if they drift apart
    // the companion freezes mid-parade.
    expect(getCompanionPassDurationMs('ant')).toBe(13_000);
    expect(getCompanionPassDurationMs('snail')).toBe(34_000);
    expect(getCompanionPassDurationMs('wizard')).toBe(15_000);
    expect(getCompanionPassDurationMs('zombie')).toBe(18_000);
  });

  it('keeps the snail the slowest of the parade', () => {
    const snail = getCompanionPassDurationMs('snail');
    const others = (['ant', 'wizard', 'zombie'] as const).map(getCompanionPassDurationMs);
    expect(Math.max(...others)).toBeLessThan(snail);
  });

  it('crawls the snail at less than half the ant speed', () => {
    expect(getCompanionPassDurationMs('snail')).toBeGreaterThanOrEqual(
      getCompanionPassDurationMs('ant') * 2,
    );
  });

  it('gives every companion a pass duration', () => {
    for (const id of Object.keys(BUILT_IN_COMPANIONS) as (keyof typeof BUILT_IN_COMPANIONS)[]) {
      expect(getCompanionPassDurationMs(id)).toBeGreaterThan(0);
    }
  });
});
