import { describe, expect, it } from 'vitest';
import {
  parseDesktopPetManifest,
  resolveDesktopPetAnimations,
  selectDesktopPetAnimation,
  validateDesktopPetSpritesheetDimensions,
} from './octoPetManifest';

const baseManifest = {
  id: 'jade-regent',
  displayName: 'Jade Regent',
  spritesheetPath: 'spritesheet.webp',
};

describe('desktop pet animation manifests', () => {
  it('keeps generic old packages on the legacy 12x13 first-row animation', () => {
    const manifest = parseDesktopPetManifest(baseManifest);
    const config = resolveDesktopPetAnimations(manifest, 1200, 1300);

    expect(config.format).toBe('legacy');
    expect([config.columns, config.rows]).toEqual([12, 13]);
    expect(config.animations.idle.frames).toHaveLength(12);
    expect(selectDesktopPetAnimation(config, 'hover')).toBe('idle');
    expect(selectDesktopPetAnimation(config, 'drag', 1)).toBe('idle');
  });

  it('recognizes the attached 1536x1872 package as Codex v1', () => {
    const manifest = parseDesktopPetManifest(baseManifest);
    const config = resolveDesktopPetAnimations(manifest, 1536, 1872);

    expect(config.format).toBe('codex-v1');
    expect([config.columns, config.rows]).toEqual([8, 9]);
    expect(Object.keys(config.animations)).toEqual([
      'idle',
      'running-right',
      'running-left',
      'waving',
      'jumping',
      'failed',
      'waiting',
      'running',
      'review',
    ]);
    expect(config.animations.idle.frameDurationsMs).toEqual([280, 110, 110, 140, 140, 320]);
    expect(selectDesktopPetAnimation(config, 'idle')).toBe('idle');
    expect(selectDesktopPetAnimation(config, 'hover')).toBe('waving');
    expect(selectDesktopPetAnimation(config, 'drag', -1)).toBe('running-left');
    expect(selectDesktopPetAnimation(config, 'drag', 1)).toBe('running-right');
  });

  it('supports the Codex v2 grid and all 16 look cells', () => {
    const manifest = parseDesktopPetManifest({ ...baseManifest, spriteVersionNumber: 2 });
    const config = resolveDesktopPetAnimations(manifest, 1536, 2288);

    expect(config.format).toBe('codex-v2');
    expect([config.columns, config.rows]).toEqual([8, 11]);
    expect(config.animations['look-000']).toMatchObject({ row: 9, frames: [0], loop: false });
    expect(config.animations['look-337.5']).toMatchObject({ row: 10, frames: [7], loop: false });
  });

  it('uses explicit custom state actions and per-action timing', () => {
    const manifest = parseDesktopPetManifest({
      ...baseManifest,
      columns: 5,
      rows: 3,
      frameDurationMs: 200,
      animations: {
        resting: { row: 0, frames: 5 },
        happy: { row: 1, frames: [1, 3, 4], fps: 10 },
        grabbed: { row: 2, frames: 2, frameDurationMs: 80, loop: false },
      },
      stateAnimations: { idle: 'resting', hover: 'happy', drag: 'grabbed' },
    });
    const config = resolveDesktopPetAnimations(manifest, 500, 300);

    expect(config.format).toBe('custom');
    expect(config.animations.resting.frameDurationsMs).toEqual([200, 200, 200, 200, 200]);
    expect(config.animations.happy.frameDurationsMs).toEqual([100, 100, 100]);
    expect(config.animations.grabbed.loop).toBe(false);
    expect(selectDesktopPetAnimation(config, 'hover')).toBe('happy');
    expect(selectDesktopPetAnimation(config, 'drag')).toBe('grabbed');
  });

  it('normalizes nested sprite and states aliases used by external package examples', () => {
    const manifest = parseDesktopPetManifest({
      ...baseManifest,
      sprite: { columns: 5, rows: 3, defaultFps: 10 },
      actions: {
        resting: { row: 0, frames: 5 },
        happy: { row: 1, frames: 3 },
        grabbed: { row: 2, frames: 2 },
        grabbedLeft: { row: 2, frames: [0] },
        grabbedRight: { row: 2, frames: [1] },
      },
      states: {
        default: 'resting',
        hover: 'happy',
        dragging: 'grabbed',
        dragLeft: 'grabbedLeft',
        dragRight: 'grabbedRight',
      },
    });
    const config = resolveDesktopPetAnimations(manifest, 500, 300);

    expect(manifest).toMatchObject({
      columns: 5,
      rows: 3,
      frameDurationMs: 100,
      stateAnimations: {
        idle: 'resting',
        hover: 'happy',
        drag: 'grabbed',
        dragLeft: 'grabbedLeft',
        dragRight: 'grabbedRight',
      },
    });
    expect(config.animations.resting.frameDurationsMs).toEqual([100, 100, 100, 100, 100]);
    expect(selectDesktopPetAnimation(config, 'idle')).toBe('resting');
    expect(selectDesktopPetAnimation(config, 'hover')).toBe('happy');
    expect(selectDesktopPetAnimation(config, 'drag')).toBe('grabbed');
    expect(selectDesktopPetAnimation(config, 'drag', -1)).toBe('grabbedLeft');
    expect(selectDesktopPetAnimation(config, 'drag', 1)).toBe('grabbedRight');
  });

  it('accepts matching aliases but rejects contradictory duplicate declarations', () => {
    const matching = parseDesktopPetManifest({
      ...baseManifest,
      columns: 4,
      rows: 2,
      frameDurationMs: 125,
      sprite: { columns: 4, rows: 2, defaultFps: 8 },
      animations: { idle: { row: 0, frames: 4 }, happy: { row: 1, frames: 4 } },
      stateAnimations: { idle: 'idle', hover: 'happy' },
      states: { default: 'idle', hover: 'happy' },
    });
    expect(matching.stateAnimations).toEqual({ idle: 'idle', hover: 'happy' });

    expect(() => parseDesktopPetManifest({
      ...baseManifest,
      columns: 4,
      rows: 2,
      sprite: { columns: 5, rows: 2 },
      animations: { idle: { row: 0, frames: 4 } },
    })).toThrow('columns 与 sprite.columns 配置冲突');

    expect(() => parseDesktopPetManifest({
      ...baseManifest,
      columns: 4,
      rows: 2,
      frameDurationMs: 100,
      sprite: { columns: 4, rows: 2, defaultFps: 8 },
      animations: { idle: { row: 0, frames: 4 } },
    })).toThrow('frameDurationMs 与 sprite.defaultFps 配置冲突');

    expect(() => parseDesktopPetManifest({
      ...baseManifest,
      sprite: { columns: 4, rows: 2 },
      animations: { idle: { row: 0, frames: 4 }, happy: { row: 1, frames: 4 } },
      stateAnimations: { hover: 'happy' },
      states: { hover: 'idle' },
    })).toThrow('stateAnimations.hover 与 states 别名配置冲突');
  });

  it('rejects broken state references and grid dimensions with clear errors', () => {
    expect(() => parseDesktopPetManifest({
      ...baseManifest,
      columns: 4,
      rows: 2,
      animations: { idle: { row: 0, frames: 4 } },
      stateAnimations: { hover: 'missing' },
    })).toThrow('引用了不存在的动画');

    expect(() => parseDesktopPetManifest({
      ...baseManifest,
      sprite: { columns: 4, rows: 2 },
      actions: { idle: { row: 0, frames: 4 } },
      states: { dragging: 'missing' },
    })).toThrow('states.dragging 引用了不存在的动画');

    const custom = parseDesktopPetManifest({
      ...baseManifest,
      columns: 4,
      rows: 2,
      animations: { idle: { row: 0, frames: 4 } },
    });
    expect(() => validateDesktopPetSpritesheetDimensions(custom, 401, 200)).toThrow(
      '必须能被 4×2 网格整除',
    );
  });
});
