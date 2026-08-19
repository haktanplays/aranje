/**
 * Meter and grid resolution (spec 5.5).
 *
 * The slot count of a bar is derived from the meter and the resolution, never
 * stored. Core uses 4/4 and 6/8; 3/4 and 7/8 exist in the schema and open up in
 * phase 2.5.
 */

export const TIME_SIGNATURES = [
  [4, 4],
  [3, 4],
  [6, 8],
  [7, 8],
] as const;

export type TimeSignature = (typeof TIME_SIGNATURES)[number];

export const RESOLUTIONS = [8, 16] as const;

export type Resolution = (typeof RESOLUTIONS)[number];

export const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 4];
export const DEFAULT_RESOLUTION: Resolution = 8;

/** Meters enabled in the core scope (spec 2.6). */
export const CORE_TIME_SIGNATURES: readonly TimeSignature[] = [
  [4, 4],
  [6, 8],
];

/**
 * Number of grid slots in a bar.
 *
 * slotCount = numerator * resolution / denominator
 *
 * 4/4 at 8 -> 8, 4/4 at 16 -> 16, 6/8 at 8 -> 6, 6/8 at 16 -> 12,
 * 3/4 at 8 -> 6, 7/8 at 8 -> 7.
 */
export function slotCount(
  timeSignature: TimeSignature,
  resolution: Resolution,
): number {
  const [numerator, denominator] = timeSignature;
  return (numerator * resolution) / denominator;
}

export function isCoreTimeSignature(timeSignature: TimeSignature): boolean {
  return CORE_TIME_SIGNATURES.some(
    (core) => core[0] === timeSignature[0] && core[1] === timeSignature[1],
  );
}

export function formatTimeSignature(timeSignature: TimeSignature): string {
  return `${timeSignature[0]}/${timeSignature[1]}`;
}
