import JSZip, { type JSZipObject } from 'jszip';
import type {
  StoredDesktopPet,
} from './octoRecall';
import {
  parseDesktopPetManifest,
  validateDesktopPetSpritesheetDimensions,
} from './octoPetManifest';

export const MAX_PET_PACKAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PET_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ARCHIVE_ENTRIES = 64;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

type SizedZipObject = JSZipObject & {
  unsafeOriginalName?: string;
  _data?: { uncompressedSize?: number };
};

function safeArchivePath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\\')) {
    throw new Error(`宠物包包含不安全路径：${rawPath || '(空路径)'}`);
  }
  const path = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  if (!path || path.startsWith('/') || /^[a-zA-Z]:\//.test(path)) {
    throw new Error(`宠物包包含不安全路径：${rawPath}`);
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`宠物包包含不安全路径：${rawPath}`);
  }
  return parts.join('/');
}

function getUncompressedSize(entry: JSZipObject): number | null {
  const size = (entry as SizedZipObject)._data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : null;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function parsePetPackage(file: Blob): Promise<StoredDesktopPet> {
  if (file.size > MAX_PET_PACKAGE_BYTES) {
    throw new Error('宠物包不能超过 10 MB');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('无法读取压缩包，请确认文件是有效的 zip');
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('宠物包内文件过多');
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const sizedEntry = entry as SizedZipObject;
    // JSZip sanitizes ../ during loading and retains the original for audits.
    safeArchivePath(sizedEntry.unsafeOriginalName ?? entry.name);
    const size = getUncompressedSize(entry);
    if (size != null) {
      totalUncompressed += size;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('宠物包解压后不能超过 16 MB');
      }
    }
  }

  const manifestEntry = zip.file('pet.json');
  if (!manifestEntry) throw new Error('宠物包必须在根目录包含 pet.json');
  const manifestSize = getUncompressedSize(manifestEntry);
  if (manifestSize != null && manifestSize > MAX_MANIFEST_BYTES) {
    throw new Error('pet.json 不能超过 64 KB');
  }

  let manifestValue: unknown;
  try {
    const manifestText = await manifestEntry.async('string');
    if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) {
      throw new Error('pet.json 不能超过 64 KB');
    }
    manifestValue = JSON.parse(manifestText);
  } catch (error) {
    if (error instanceof Error && error.message.includes('64 KB')) throw error;
    throw new Error('pet.json 不是有效的 JSON');
  }

  const manifest = parseDesktopPetManifest(manifestValue);
  const imageEntry = zip.file(manifest.spritesheetPath);
  if (!imageEntry || imageEntry.dir) {
    throw new Error(`找不到 spritesheet 图片：${manifest.spritesheetPath}`);
  }
  const extension = manifest.spritesheetPath.match(/\.[^.]+$/)?.[0].toLowerCase() ?? '';
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error('spritesheet 仅支持 webp、png、jpg、jpeg 或 gif');
  }
  const imageSize = getUncompressedSize(imageEntry);
  if (imageSize != null && imageSize > MAX_PET_IMAGE_BYTES) {
    throw new Error('spritesheet 图片不能超过 8 MB');
  }

  const imageBytes = await imageEntry.async('uint8array');
  if (imageBytes.byteLength > MAX_PET_IMAGE_BYTES) {
    throw new Error('spritesheet 图片不能超过 8 MB');
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const imageBuffer = new ArrayBuffer(imageBytes.byteLength);
      new Uint8Array(imageBuffer).set(imageBytes);
      const bitmap = await createImageBitmap(new Blob([imageBuffer], { type: mimeType }));
      try {
        validateDesktopPetSpritesheetDimensions(manifest, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('spritesheet')) throw error;
      if (error instanceof Error && error.message.startsWith('Codex')) throw error;
      throw new Error('spritesheet 图片已损坏、尺寸不符或无法解码');
    }
  }

  return {
    manifest,
    spritesheetDataUrl: bytesToDataUrl(imageBytes, mimeType),
    importedAt: Date.now(),
  };
}
