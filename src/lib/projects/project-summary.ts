/**
 * What a project looks like in the list (spec 13.21 §12, 2O-A).
 *
 * Derived from the Song every time, never cached in the catalog. A cached
 * "32 ölçü" is right until the moment someone edits, and after that it is a
 * number the app is telling its reader that nothing in the app believes. The
 * cost of deriving it is one pass over the sections, measured in §25.
 *
 * A project that could not be read gets a summary too — one that says so,
 * rather than a row of zeroes. "0 ölçü" for a corrupt project reads as "this
 * project is empty", which is the opposite of what happened to it.
 */
import type { Song } from "@/lib/song/schema";

export type ProjectHealth =
  | "ok"
  /** Written by a newer Aranje. Readable rows, unreadable content. */
  | "future_version"
  /** Neither slot of the record could be read. */
  | "unreadable";

export type ProjectSummary = {
  readonly id: string;
  readonly health: ProjectHealth;
  /** The Song's own title — the one name authority (2O-A §6). */
  readonly title: string | null;
  readonly sectionCount: number | null;
  readonly barCount: number | null;
  readonly trackCount: number | null;
  /** Milliseconds, from an injected clock. Null when nothing recorded one. */
  readonly updatedAt: number | null;
  readonly isActive: boolean;
};

export function summarizeSong(
  id: string,
  song: Song,
  options: { readonly isActive: boolean; readonly updatedAt: number | null },
): ProjectSummary {
  let barCount = 0;
  for (const section of song.sections) barCount += section.bars.length;
  return {
    id,
    health: "ok",
    title: song.title,
    sectionCount: song.sections.length,
    barCount,
    trackCount: song.tracks.length,
    updatedAt: options.updatedAt,
    isActive: options.isActive,
  };
}

/** A project whose content this version must not or cannot read. */
export function unreadableSummary(
  id: string,
  health: Exclude<ProjectHealth, "ok">,
  isActive: boolean,
): ProjectSummary {
  return {
    id,
    health,
    title: null,
    sectionCount: null,
    barCount: null,
    trackCount: null,
    updatedAt: null,
    isActive,
  };
}
