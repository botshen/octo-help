import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KICK_GLOBAL_KEY,
  KICK_READY_EVENT,
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  type KickScriptApi,
} from './octoRecall';

/**
 * The lazy façade is what keeps pixi.js (543 KB) out of the always-injected
 * main-world bundle, so its load/replay behaviour needs to hold up under the
 * orderings that actually happen on a live page: settings arriving before the
 * script loads, the user toggling the effect back off mid-flight, and the script
 * already being present from an earlier activation.
 */

function makeFakeApi() {
  return {
    setFullscreenKickStyle: vi.fn(),
    setFullscreenKickBallCursor: vi.fn(),
    setFullscreenKickPlayer: vi.fn(),
  } satisfies KickScriptApi;
}

/** Fresh module instance per test — the façade holds module-level state. */
async function loadLazy() {
  vi.resetModules();
  return import('./octoFullscreenKickLazy');
}

function readPostedTypes(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls
    .map(([message]) => (message as { type?: string } | undefined)?.type)
    .filter((type): type is string => typeof type === 'string');
}

/**
 * Minimal stand-in for the page `window`. Tests run in node (no DOM), and the
 * façade only needs postMessage, event plumbing and property storage — an
 * EventTarget-backed object models the real ordering faithfully without
 * pulling in jsdom.
 */
function makeFakeWindow() {
  const target = new EventTarget();
  const postMessage = vi.fn();
  return {
    postMessage,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
}

type FakeWindow = ReturnType<typeof makeFakeWindow> & Record<string, unknown>;

let fakeWindow: FakeWindow;
let postMessageSpy: ReturnType<typeof vi.fn>;

function setPageApi(api: unknown): void {
  fakeWindow[KICK_GLOBAL_KEY] = api;
}

function announceReady(): void {
  fakeWindow.dispatchEvent(new Event(KICK_READY_EVENT));
}

beforeEach(() => {
  fakeWindow = makeFakeWindow() as FakeWindow;
  postMessageSpy = fakeWindow.postMessage;
  vi.stubGlobal('window', fakeWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('octoFullscreenKickLazy', () => {
  it('does not request the heavy script while the effect is off', async () => {
    const lazy = await loadLazy();

    lazy.setFullscreenKickStyle('fire');
    lazy.setFullscreenKickBallCursor(true);
    lazy.setFullscreenKickPlayer('none', '');

    expect(readPostedTypes(postMessageSpy)).toEqual([]);
    expect(lazy.isFullscreenKickLoaded()).toBe(false);
  });

  it('requests injection once when a player is selected', async () => {
    const lazy = await loadLazy();

    lazy.setFullscreenKickPlayer('messi', 'ball-1');
    lazy.setFullscreenKickPlayer('mbappe', 'ball-2');

    expect(readPostedTypes(postMessageSpy)).toEqual([MESSAGE_TYPE.requestKickScript]);
    expect(postMessageSpy.mock.calls[0][0]).toMatchObject({ source: MESSAGE_SOURCE });
  });

  it('adopts an API that is already present on the page', async () => {
    const api = makeFakeApi();
    setPageApi(api);

    const lazy = await loadLazy();
    lazy.setFullscreenKickStyle('cannon');
    lazy.setFullscreenKickPlayer('messi', 'ball-1');

    // No injection round trip is needed when the script is already loaded.
    expect(readPostedTypes(postMessageSpy)).toEqual([]);
    expect(lazy.isFullscreenKickLoaded()).toBe(true);
    expect(api.setFullscreenKickStyle).toHaveBeenCalledWith('cannon');
    expect(api.setFullscreenKickPlayer).toHaveBeenCalledWith('messi', 'ball-1');
  });

  it('replays the full desired state once the script becomes ready', async () => {
    const lazy = await loadLazy();

    // Settings arrive before the script exists; they must not be dropped.
    lazy.setFullscreenKickStyle('comet');
    lazy.setFullscreenKickBallCursor(false);
    lazy.setFullscreenKickPlayer('mbappe', 'ball-2');

    const api = makeFakeApi();
    setPageApi(api);
    announceReady();

    expect(api.setFullscreenKickStyle).toHaveBeenCalledWith('comet');
    expect(api.setFullscreenKickBallCursor).toHaveBeenCalledWith(false);
    expect(api.setFullscreenKickPlayer).toHaveBeenCalledWith('mbappe', 'ball-2');
  });

  it('does not resurrect an effect switched off while the script was loading', async () => {
    const lazy = await loadLazy();

    lazy.setFullscreenKickPlayer('messi', 'ball-1');
    // User picks "none" before the injected script finishes evaluating.
    lazy.setFullscreenKickPlayer('none', '');

    const api = makeFakeApi();
    setPageApi(api);
    announceReady();

    // Replay must use the newest state, not the one captured at request time.
    expect(api.setFullscreenKickPlayer).toHaveBeenCalledWith('none', '');
    expect(api.setFullscreenKickPlayer).not.toHaveBeenCalledWith('messi', 'ball-1');
  });

  it('forwards later changes straight through once loaded', async () => {
    const lazy = await loadLazy();

    lazy.setFullscreenKickPlayer('messi', 'ball-1');
    const api = makeFakeApi();
    setPageApi(api);
    announceReady();

    lazy.setFullscreenKickStyle('bullet');
    lazy.setFullscreenKickBallCursor(false);

    expect(api.setFullscreenKickStyle).toHaveBeenLastCalledWith('bullet');
    expect(api.setFullscreenKickBallCursor).toHaveBeenLastCalledWith(false);
    // Still only ever one injection request for the page.
    expect(readPostedTypes(postMessageSpy)).toEqual([MESSAGE_TYPE.requestKickScript]);
  });

  it('ignores a malformed global instead of adopting it', async () => {
    setPageApi({ setFullscreenKickPlayer: 'not-a-function' });

    const lazy = await loadLazy();
    lazy.setFullscreenKickPlayer('messi', 'ball-1');

    expect(lazy.isFullscreenKickLoaded()).toBe(false);
    // Falls back to asking for a real injection.
    expect(readPostedTypes(postMessageSpy)).toEqual([MESSAGE_TYPE.requestKickScript]);
  });
});
