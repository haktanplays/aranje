/**
 * Screen settings that are not part of the song (spec 5.6, 13.8).
 *
 * The song and the settings are two different responsibilities and they are
 * stored, validated and recovered separately:
 *
 * - A song that cannot be read is **quarantined**: it is the musician's work,
 *   and throwing it away silently would be losing something irreplaceable.
 * - A setting that cannot be read is simply **replaced with its default**.
 *   Nobody wants a rescue copy of a practice speed, and a bad settings blob
 *   must never make the app behave as though the song were corrupt.
 *
 * The schema is strict: an unknown key is a settings file this version does
 * not understand, so it falls back rather than half-applying it.
 */
import { z } from "zod";

import { clampPercent, DEFAULT_PRACTICE_PERCENT } from "@/lib/audio/practice-rate";
import { practiceRateLimits } from "@/lib/limits";
import { STORAGE_PREFIX, type StorageLike } from "@/lib/song/storage";

export const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;

export const settingsSchema = z.strictObject({
  /** Whole percent of the song's own tempo (spec 13.8). */
  practiceRatePercent: z
    .number()
    .int()
    .min(practiceRateLimits.minPercent)
    .max(practiceRateLimits.maxPercent)
    .refine(
      (value) => value % practiceRateLimits.stepPercent === 0,
      "practice rate is kept in whole steps",
    ),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  practiceRatePercent: DEFAULT_PRACTICE_PERCENT,
};

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the stored settings. Always returns something usable, never throws, and
 * never touches the song or its quarantine keys.
 */
export function loadSettings(
  storage: StorageLike | null = browserStorage(),
): Settings {
  if (!storage) return DEFAULT_SETTINGS;

  let raw: string | null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (raw === null) return DEFAULT_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  const result = settingsSchema.safeParse(parsed);
  return result.success ? result.data : DEFAULT_SETTINGS;
}

/** Persist the settings. Returns false when storage refused the write. */
export function saveSettings(
  settings: Settings,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const result = settingsSchema.safeParse({
    ...settings,
    practiceRatePercent: clampPercent(settings.practiceRatePercent),
  });
  if (!result.success) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(result.data));
    return true;
  } catch {
    return false;
  }
}
