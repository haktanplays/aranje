/**
 * A range of *bars*, and the two things that can mean (spec 5.4, 13.12, K-43).
 *
 * 2I-A selects a span of time on one track. This selects whole bars, and it
 * does so in one of two scopes that must never be confused:
 *
 * - **`track`** — the content of these bars *on one track*. Deleting it leaves
 *   the bars where they are and empties them; the song keeps its shape.
 * - **`full`** — these bars *as objects*, with every track in them and the
 *   metre and grid they are written on. Deleting it removes them from the
 *   section and everything after moves left; the song gets shorter.
 *
 * They are different enough that silently turning one into the other would be
 * a data-loss bug rather than a convenience, so the type makes it impossible:
 * there is no field they share that would let a `full` clipboard be read as a
 * `track` one.
 *
 * Session state, like every other selection in this app. Never written to the
 * Song, never in the fingerprint, never sent to the Copilot.
 *
 * ## Bars here, ticks underneath
 *
 * The selection is expressed in bar indices because that is what a reader is
 * pointing at. The moment content moves, the canonical unit is ticks again —
 * bars stopped sharing a grid in 2H-A, so "bar 3" is a position and never a
 * duration.
 */
import { crossBarLinks, type BarLink } from "@/lib/arrangement/links";
import type { Song } from "@/lib/song/schema";

export type BarSelection =
  | {
      readonly scope: "track";
      readonly sectionId: string;
      readonly trackId: string;
      /** Inclusive. */
      readonly startBarIndex: number;
      /** Inclusive. */
      readonly endBarIndex: number;
    }
  | {
      readonly scope: "full";
      readonly sectionId: string;
      readonly startBarIndex: number;
      readonly endBarIndex: number;
    };

export type BarSelectionErrorCode =
  | "section_not_found"
  | "selection_out_of_bounds"
  /** A sound crosses the section seam, and V1 does not select across it. */
  | "chain_crosses_section";

export type BarSelectionFailure = {
  readonly code: BarSelectionErrorCode;
  readonly message: string;
};

export type BarExpansion =
  | {
      readonly ok: true;
      readonly selection: BarSelection;
      /** How many bars the selection grew by, for the notice. */
      readonly grewBy: number;
    }
  | { readonly ok: false; readonly error: BarSelectionFailure };

/** How many bars the selection covers. Never less than one. */
export function barSelectionLength(selection: BarSelection): number {
  return Math.max(0, selection.endBarIndex - selection.startBarIndex + 1);
}

export function sameBarSelection(a: BarSelection, b: BarSelection): boolean {
  if (a.scope !== b.scope) return false;
  if (a.sectionId !== b.sectionId) return false;
  if (a.scope === "track" && b.scope === "track" && a.trackId !== b.trackId) {
    return false;
  }
  return (
    a.startBarIndex === b.startBarIndex && a.endBarIndex === b.endBarIndex
  );
}

/** Every bar key in the song, resolved back to where it came from. */
function barKeyIndex(song: Song): Map<string, { sectionId: string; barIndex: number }> {
  const index = new Map<string, { sectionId: string; barIndex: number }>();
  for (const section of song.sections) {
    section.bars.forEach((_, barIndex) => {
      index.set(`${section.id}:${barIndex}`, { sectionId: section.id, barIndex });
    });
  }
  return index;
}

/** Which tracks' links can grow this selection. */
function tracksInScope(song: Song, selection: BarSelection): readonly string[] {
  /*
   * In `full` scope, one track's tie is enough. The bars move as a unit, so a
   * sound held across the edge by *any* instrument would be cut by moving
   * them — it does not matter which one, and asking the reader to notice would
   * be asking them to audit eight lanes before every edit.
   */
  return selection.scope === "track"
    ? [selection.trackId]
    : song.tracks.map((track) => track.id);
}

/**
 * Grow a bar selection until it holds every chain it touches.
 *
 * A tie, a slide, a hammer-on and a pull-off are all one sound spread over two
 * bars. Selecting half of one and moving it would leave a note that starts
 * nowhere or ends nowhere, so the selection is widened first and the reader is
 * told it happened — the alternative is an edit that quietly does something
 * other than what was asked.
 *
 * The links come from `arrangement/links.ts`, which reads the timeline's own
 * carry marks and `legatoDecision`. That matters: a slide the player will not
 * hear because there is no room to travel is not a link there, so it does not
 * hold a selection hostage here either.
 *
 * ## Fail-closed at the section seam
 *
 * If the chain leaves the section, this refuses rather than quietly selecting
 * across the boundary. Cross-section bar selection is not in V1, and the
 * honest answer to "this bar is tied into the next section" is to say so —
 * with no clipboard, store or history touched.
 */
export function expandBarSelection(
  song: Song,
  selection: BarSelection,
): BarExpansion {
  const section = song.sections.find((entry) => entry.id === selection.sectionId);
  if (!section) {
    return {
      ok: false,
      error: {
        code: "section_not_found",
        message: `"${selection.sectionId}" bölümü şarkıda yok.`,
      },
    };
  }

  const lastBar = section.bars.length - 1;
  if (
    selection.startBarIndex < 0 ||
    selection.endBarIndex > lastBar ||
    selection.startBarIndex > selection.endBarIndex
  ) {
    return {
      ok: false,
      error: {
        code: "selection_out_of_bounds",
        message: "Seçim bölümün dışına çıkıyor.",
      },
    };
  }

  const index = barKeyIndex(song);
  const links: BarLink[] = tracksInScope(song, selection).flatMap((trackId) =>
    crossBarLinks(song, trackId),
  );

  const crossesSection: BarSelectionFailure = {
    code: "chain_crosses_section",
    message:
      "Bu ölçü sonraki bölüme bağlı. Bölüm sınırını aşan ölçü taşıma henüz desteklenmiyor.",
  };

  let start = selection.startBarIndex;
  let end = selection.endBarIndex;

  /*
   * Repeat until nothing grows. One pass is not enough: widening to take in a
   * tied bar can expose a second chain at the new edge, and a riff of three
   * bars joined end to end has to come in whole or not at all.
   */
  for (let guard = 0; guard <= section.bars.length; guard += 1) {
    let grew = false;

    for (const link of links) {
      const from = index.get(link.fromBarKey);
      const to = index.get(link.toBarKey);
      if (!from || !to) continue;

      // Something is sounding into our first bar.
      if (to.sectionId === selection.sectionId && to.barIndex === start) {
        if (from.sectionId !== selection.sectionId) {
          return { ok: false, error: crossesSection };
        }
        if (from.barIndex < start) {
          start = from.barIndex;
          grew = true;
        }
      }

      // Something is sounding out of our last bar.
      if (from.sectionId === selection.sectionId && from.barIndex === end) {
        if (to.sectionId !== selection.sectionId) {
          return { ok: false, error: crossesSection };
        }
        if (to.barIndex > end) {
          end = to.barIndex;
          grew = true;
        }
      }
    }

    if (!grew) break;
  }

  const grown: BarSelection =
    selection.scope === "track"
      ? { ...selection, startBarIndex: start, endBarIndex: end }
      : { ...selection, startBarIndex: start, endBarIndex: end };

  return {
    ok: true,
    selection: grown,
    grewBy:
      barSelectionLength(grown) - barSelectionLength(selection),
  };
}

/** What the reader is told when a selection grew under them. */
export function expansionNotice(grewBy: number, total: number): string | null {
  if (grewBy <= 0) return null;
  return `Bağlantılı notalar nedeniyle seçim ${total} ölçüye genişletildi.`;
}
