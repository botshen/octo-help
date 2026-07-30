import type {
  DesktopPetPosition,
  StoredDesktopPet,
} from './octoRecall';
import { parseDesktopPetManifest } from './octoPetManifest';

export function isStoredDesktopPet(value: unknown): value is StoredDesktopPet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pet = value as Partial<StoredDesktopPet>;
  try {
    parseDesktopPetManifest(pet.manifest);
  } catch {
    return false;
  }
  return (
    typeof pet.spritesheetDataUrl === 'string' &&
    /^data:image\/(?:webp|png|jpeg|gif);base64,/i.test(pet.spritesheetDataUrl) &&
    typeof pet.importedAt === 'number' &&
    Number.isFinite(pet.importedAt)
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
