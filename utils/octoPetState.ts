import type {
  DesktopPetManifest,
  DesktopPetPosition,
  StoredDesktopPet,
} from './octoRecall';

export function isStoredDesktopPet(value: unknown): value is StoredDesktopPet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pet = value as Partial<StoredDesktopPet>;
  const manifest = pet.manifest as Partial<DesktopPetManifest> | undefined;
  return !!(
    manifest &&
    typeof manifest.id === 'string' &&
    typeof manifest.displayName === 'string' &&
    typeof manifest.spritesheetPath === 'string' &&
    typeof pet.spritesheetDataUrl === 'string' &&
    /^data:image\/(?:webp|png|jpeg|gif);base64,/i.test(pet.spritesheetDataUrl) &&
    typeof pet.importedAt === 'number'
  );
}

export function isDesktopPetPosition(value: unknown): value is DesktopPetPosition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const position = value as Partial<DesktopPetPosition>;
  return (
    typeof position.x === 'number' &&
    Number.isFinite(position.x) &&
    Math.abs(position.x) <= 100_000 &&
    typeof position.y === 'number' &&
    Number.isFinite(position.y) &&
    Math.abs(position.y) <= 100_000
  );
}
