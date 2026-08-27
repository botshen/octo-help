/**
 * Types for the sprite generator, so tests can import the bitmaps and check
 * them against the stylesheet. The script itself stays plain JS — it runs under
 * bare `node` with no build step.
 */

/** RGB triples. */
export declare const NES: Record<string, [number, number, number]>;
/** Character -> colour used by every bitmap in this module. */
export declare const PAL: Record<string, [number, number, number]>;
/** Shared head + face rows reused by each character pose. */
export declare const FACE: string[];
/** name -> rows of '0'/'1'-style dot characters, one per pixel. */
export declare const SPRITES: Record<string, string[]>;
/** Nine-slice frame tile, one row per source pixel. */
export declare const FRAME: string[];
/** Per-tier frame colours: highlight / main / centre. */
export declare const FRAME_TIERS: Record<
  string,
  { H: [number, number, number]; M: [number, number, number]; C: [number, number, number] }
>;
/** Render rows to a PNG buffer, optionally with a palette override. */
export declare function png(
  rows: string[],
  palette?: Record<string, [number, number, number]>,
): Buffer;
