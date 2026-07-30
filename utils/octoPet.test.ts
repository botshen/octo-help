import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MAX_PET_PACKAGE_BYTES, parsePetPackage } from './octoPet';

async function packageBlob(
  manifest: Record<string, unknown>,
  imagePath = 'spritesheet.webp',
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('pet.json', JSON.stringify(manifest));
  zip.file(imagePath, new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  return zip.generateAsync({ type: 'blob' });
}

describe('parsePetPackage', () => {
  it('parses a valid local WebP pet package', async () => {
    const result = await parsePetPackage(
      await packageBlob({
        id: 'jade-regent',
        displayName: 'Jade Regent',
        description: 'A tiny regent.',
        spritesheetPath: 'spritesheet.webp',
      }),
    );

    expect(result.manifest.displayName).toBe('Jade Regent');
    expect(result.spritesheetDataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it('rejects traversal paths even when JSZip sanitizes the entry name', async () => {
    const zip = new JSZip();
    zip.file('pet.json', JSON.stringify({
      id: 'unsafe',
      displayName: 'Unsafe',
      spritesheetPath: 'spritesheet.webp',
    }));
    zip.file('../spritesheet.webp', new Uint8Array([1]));
    const blob = await zip.generateAsync({ type: 'blob' });

    await expect(parsePetPackage(blob)).rejects.toThrow('不安全路径');
  });

  it('rejects a missing spritesheet', async () => {
    const zip = new JSZip();
    zip.file('pet.json', JSON.stringify({
      id: 'missing',
      displayName: 'Missing',
      spritesheetPath: 'missing.webp',
    }));

    await expect(parsePetPackage(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow(
      '找不到 spritesheet',
    );
  });

  it('rejects packages over the compressed size limit before parsing', async () => {
    const oversized = new Blob([new Uint8Array(MAX_PET_PACKAGE_BYTES + 1)]);
    await expect(parsePetPackage(oversized)).rejects.toThrow('10 MB');
  });
});
