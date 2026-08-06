import { describe, expect, it, vi } from 'vitest';
import { startFeatures, stopAllFeatures, type PageFeature } from './octoPageFeatures';

/**
 * The registry exists so that "master switch off leaves the page as if the
 * extension were not installed" is structurally true rather than a convention
 * someone has to remember. These tests pin the properties that make that work.
 */

function feature(
  id: string,
  log: string[],
  opts: { start?: boolean; failStart?: boolean; failStop?: boolean } = {},
): PageFeature {
  return {
    id,
    ...(opts.start === false
      ? {}
      : {
          start: () => {
            log.push(`start:${id}`);
            if (opts.failStart) throw new Error(`${id} start failed`);
          },
        }),
    stop: () => {
      log.push(`stop:${id}`);
      if (opts.failStop) throw new Error(`${id} stop failed`);
    },
  };
}

describe('stopAllFeatures', () => {
  it('stops every feature in registry order', () => {
    const log: string[] = [];
    const features = ['a', 'b', 'c'].map((id) => feature(id, log));
    stopAllFeatures(features);
    expect(log).toEqual(['stop:a', 'stop:b', 'stop:c']);
  });

  it('keeps tearing down after one feature throws', () => {
    // A half-reverted page is worse than one misbehaving feature, so a failing
    // teardown must not strand the features after it.
    const log: string[] = [];
    const features = [
      feature('a', log),
      feature('boom', log, { failStop: true }),
      feature('c', log),
    ];
    expect(() => stopAllFeatures(features)).not.toThrow();
    expect(log).toEqual(['stop:a', 'stop:boom', 'stop:c']);
  });

  it('stops features that were never started', () => {
    // Message-driven features (composer enhancement, desktop pet) have no start,
    // yet their teardown still has to run.
    const log: string[] = [];
    stopAllFeatures([feature('messageDriven', log, { start: false })]);
    expect(log).toEqual(['stop:messageDriven']);
  });
});

describe('startFeatures', () => {
  it('starts in the given order, not registry order', () => {
    // Startup order is independent: beautify must be up before recall runs.
    const log: string[] = [];
    const features = ['recall', 'beautify'].map((id) => feature(id, log));
    startFeatures(features, ['beautify', 'recall']);
    expect(log).toEqual(['start:beautify', 'start:recall']);
  });

  it('skips features that have no start', () => {
    const log: string[] = [];
    const features = [feature('withStart', log), feature('noStart', log, { start: false })];
    startFeatures(features, ['withStart', 'noStart']);
    expect(log).toEqual(['start:withStart']);
  });

  it('ignores unknown ids instead of throwing during page boot', () => {
    const log: string[] = [];
    expect(() => startFeatures([feature('a', log)], ['a', 'typo'])).not.toThrow();
    expect(log).toEqual(['start:a']);
  });

  it('keeps starting after one feature throws', () => {
    const log: string[] = [];
    const features = [feature('boom', log, { failStart: true }), feature('b', log)];
    expect(() => startFeatures(features, ['boom', 'b'])).not.toThrow();
    expect(log).toEqual(['start:boom', 'start:b']);
  });

  it('does not start a feature the order omits', () => {
    const log: string[] = [];
    const features = ['a', 'b'].map((id) => feature(id, log));
    startFeatures(features, ['a']);
    expect(log).toEqual(['start:a']);
  });
});

describe('the master switch contract', () => {
  it('start-then-stop leaves every started feature stopped', () => {
    // The property that matters: whatever came up must go back down.
    const started = new Set<string>();
    const ids = ['recall', 'beautify', 'petSpeech', 'githubLinks', 'compatCheck'];
    const features: PageFeature[] = ids.map((id) => ({
      id,
      start: () => started.add(id),
      stop: () => started.delete(id),
    }));

    startFeatures(features, ids);
    expect(started.size).toBe(ids.length);
    stopAllFeatures(features);
    expect(started.size).toBe(0);
  });

  it('stop is idempotent enough to run twice', () => {
    // applyMaster guards on state, but a stop that only works once would be a
    // trap for any future caller.
    const stop = vi.fn();
    const features: PageFeature[] = [{ id: 'a', stop }];
    stopAllFeatures(features);
    stopAllFeatures(features);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
