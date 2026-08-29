/**
 * The thirty-three things bar operations have to get right (spec 13.12).
 *
 * Two scopes that look alike from the outside and mean opposite things inside:
 * one empties a bar, the other removes it. Almost every test here exists
 * because getting the two confused loses music silently — the bar is still
 * there, or the section is one shorter, and nothing says so.
 */
import { describe, expect, it } from "vitest";

import {
  applyBarCommand,
  copyBars,
  isStructuralBarCommand,
  type BarClipboard,
  type BarCommand,
  type FullBarsClipboard,
  type TrackBarsClipboard,
} from "@/lib/song/bar-transform";
import { expandBarSelection, type BarSelection } from "@/lib/song/bar-selection";
import { BAR_MESSAGES, needsReplaceConfirmation } from "@/lib/song/bar-messages";
import { regridMelodic } from "@/lib/song/bar-regrid";
import {
  drumTrack,
  guitarTrack,
  restSlots,
  section,
  song as makeSong,
} from "@/lib/song/fixtures";
import type { Bar, DrumSlot, MelodicSlot, Song } from "@/lib/song/schema";

const note = (pitch: string, extra: Record<string, unknown> = {}): MelodicSlot => ({
  notes: [{ pitch, velocity: 100, ...extra }],
});

/** A bar written for the given tracks; anything absent is silence. */
function bar(
  slots: Record<string, MelodicSlot[]>,
  overrides: Partial<Omit<Bar, "slots">> = {},
): Bar {
  return { timeSignature: [4, 4], resolution: 8, ...overrides, slots };
}

const RIFF = () => [note("E2"), null, note("G2"), null, null, null, null, null];
const OTHER = () => [note("A2"), null, null, null, null, null, null, null];

/** Two guitars and a drum kit, so scope has something to be wrong about. */
function song(bars: readonly Bar[]): Song {
  return makeSong(
    [guitarTrack({ id: "gtr" }), guitarTrack({ id: "gtr2", name: "İkinci" }), drumTrack()],
    [section(bars)],
  );
}

const trackSel = (start: number, end: number, trackId = "gtr"): BarSelection => ({
  scope: "track",
  sectionId: "s1",
  trackId,
  startBarIndex: start,
  endBarIndex: end,
});

const fullSel = (start: number, end: number): BarSelection => ({
  scope: "full",
  sectionId: "s1",
  startBarIndex: start,
  endBarIndex: end,
});

const slotsOf = (s: Song, barIndex: number, trackId: string) =>
  s.sections[0]?.bars[barIndex]?.slots[trackId];

const barCount = (s: Song) => s.sections[0]?.bars.length ?? 0;

function mustCopy(s: Song, selection: BarSelection): BarClipboard {
  const result = copyBars(s, selection);
  if (!result.ok) throw new Error(`copy refused: ${result.error.code}`);
  return result.clipboard;
}

describe("1. the two scopes are strictly separate", () => {
  it("a track copy is a track clipboard and a full copy is a full one", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: OTHER() }), bar({ gtr: RIFF() })]);
    expect(mustCopy(source, trackSel(0, 0)).kind).toBe("track_bars");
    expect(mustCopy(source, fullSel(0, 0)).kind).toBe("full_bars");
  });

  it("refuses a full clipboard offered to a track paste", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: restSlots(8) })]);
    const clipboard = mustCopy(source, fullSel(0, 0));
    const result = applyBarCommand(source, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("scope_mismatch");
  });

  it("refuses a track clipboard offered to a full paste", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: restSlots(8) })]);
    const clipboard = mustCopy(source, trackSel(0, 0));
    const result = applyBarCommand(source, fullSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("scope_mismatch");
  });

  it("refuses a track clipboard offered to another track", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: restSlots(8) })]);
    const clipboard = mustCopy(source, trackSel(0, 0, "gtr"));
    const result = applyBarCommand(source, trackSel(0, 0, "gtr2"), {
      kind: "paste_bar_contents",
      clipboard,
      replace: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("wrong_track");
  });
});

describe("2. one bar and several", () => {
  it("copies a single bar and a range alike", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() }), bar({ gtr: RIFF() })]);
    const one = mustCopy(source, fullSel(1, 1)) as FullBarsClipboard;
    const three = mustCopy(source, fullSel(0, 2)) as FullBarsClipboard;
    expect(one.barCount).toBe(1);
    expect(three.barCount).toBe(3);
    expect(three.widthTicks).toBe(one.widthTicks * 3);
  });
});

describe("3. a track copy never changes the song", () => {
  it("leaves the input byte-identical", () => {
    const source = song([bar({ gtr: RIFF() })]);
    const before = JSON.stringify(source);
    copyBars(source, trackSel(0, 0));
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("4. a full copy carries every track", () => {
  it("holds the other tracks and the missing keys alike", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: OTHER() })]);
    const clipboard = mustCopy(source, fullSel(0, 0)) as FullBarsClipboard;
    const held = clipboard.bars[0];
    expect(Object.keys(held?.slots ?? {}).sort()).toEqual(["gtr", "gtr2"]);
    // The drum track was never written in this bar, and the clipboard says so
    // by not carrying a key for it rather than by carrying an empty one.
    expect(held?.slots["drums"]).toBeUndefined();
  });
});

describe("5. a silent bar keeps its width in the clipboard", () => {
  it("counts the rest as part of the pattern", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: restSlots(8) })]);
    const one = mustCopy(source, trackSel(0, 0)) as TrackBarsClipboard;
    const two = mustCopy(source, trackSel(0, 1)) as TrackBarsClipboard;
    expect(two.widthTicks).toBe(one.widthTicks * 2);
    expect(two.barCount).toBe(2);
  });
});

describe("6. a track delete empties the bar and keeps it", () => {
  it("leaves the bar in place with the other tracks untouched", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: OTHER() }), bar({ gtr: RIFF() })]);
    const result = applyBarCommand(source, trackSel(0, 0), { kind: "delete_bars" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(2);
    expect(slotsOf(result.song, 0, "gtr")).toEqual(restSlots(8));
    expect(slotsOf(result.song, 0, "gtr2")).toEqual(OTHER());
  });
});

describe("7. a full delete removes the bar", () => {
  it("shortens the section and shifts what follows left", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() }), bar({ gtr: RIFF() })]);
    const result = applyBarCommand(source, fullSel(0, 0), { kind: "delete_bars" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(2);
    expect(slotsOf(result.song, 0, "gtr")).toEqual(OTHER());
  });
});

describe("8. a section can never reach zero bars", () => {
  it("refuses to delete the last bar", () => {
    const source = song([bar({ gtr: RIFF() })]);
    const result = applyBarCommand(source, fullSel(0, 0), { kind: "delete_bars" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("section_would_be_empty");
  });

  it("refuses to delete every bar at once", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, fullSel(0, 1), { kind: "delete_bars" });
    expect(result.ok).toBe(false);
  });
});

describe("9. a track paste changes only its own track", () => {
  it("writes the content and leaves the neighbours alone", () => {
    const source = song([
      bar({ gtr: RIFF(), gtr2: OTHER() }),
      bar({ gtr: restSlots(8), gtr2: OTHER() }),
    ]);
    const clipboard = mustCopy(source, trackSel(0, 0));
    const result = applyBarCommand(source, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
    expect(slotsOf(result.song, 1, "gtr2")).toEqual(OTHER());
  });
});

describe("10. a full replace changes the whole target", () => {
  it("writes every track the clipboard carries", () => {
    const source = song([
      bar({ gtr: RIFF(), gtr2: OTHER() }),
      bar({ gtr: OTHER(), gtr2: RIFF() }),
    ]);
    const clipboard = mustCopy(source, fullSel(0, 0));
    const result = applyBarCommand(source, fullSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
    expect(slotsOf(result.song, 1, "gtr2")).toEqual(OTHER());
  });
});

describe("11. metadata stays with the target on a content paste", () => {
  it("keeps the target's metre and grid, and the section's tempo", () => {
    const source = makeSong(
      [guitarTrack({ id: "gtr" })],
      [
        section([bar({ gtr: RIFF() }, { resolution: 8 })], { id: "a", bpmOverride: 168 }),
        section([bar({ gtr: restSlots(16) }, { resolution: 16 })], {
          id: "b",
          bpmOverride: 84,
        }),
      ],
    );
    const copied = copyBars(source, {
      scope: "full",
      sectionId: "a",
      startBarIndex: 0,
      endBarIndex: 0,
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const result = applyBarCommand(
      source,
      { scope: "full", sectionId: "b", startBarIndex: 0, endBarIndex: 0 },
      { kind: "paste_bar_contents", clipboard: copied.clipboard, replace: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.song.sections[1];
    expect(target?.bars[0]?.resolution).toBe(16);
    // Tempo belongs to the section, so it never travels with the bars.
    expect(target?.bpmOverride).toBe(84);
    expect(result.song.sections[0]?.bpmOverride).toBe(168);
  });
});

describe("12. inserting copied bars keeps their structure", () => {
  it("brings the source metre and grid with it", () => {
    const source = song([
      bar({ gtr: RIFF() }, { resolution: 8 }),
      bar({ gtr: restSlots(16) }, { resolution: 16, timeSignature: [3, 4] }),
    ]);
    const clipboard = mustCopy(source, fullSel(1, 1));
    const result = applyBarCommand(source, fullSel(0, 0), {
      kind: "insert_copied_bars",
      clipboard,
      side: "after",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(3);
    const inserted = result.song.sections[0]?.bars[1];
    expect(inserted?.resolution).toBe(16);
    expect(inserted?.timeSignature).toEqual([3, 4]);
  });
});

describe("13. a blank bar carries the shape and nothing else", () => {
  it("takes the neighbour's metre and grid and writes no track", () => {
    const source = song([bar({ gtr: RIFF() }, { resolution: 16, timeSignature: [3, 4] })]);
    const result = applyBarCommand(source, fullSel(0, 0), {
      kind: "insert_blank_bar_after",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const blank = result.song.sections[0]?.bars[1];
    expect(blank?.resolution).toBe(16);
    expect(blank?.timeSignature).toEqual([3, 4]);
    // No keys at all: a missing key is silence for every track (spec 5.5).
    expect(blank?.slots).toEqual({});
  });
});

describe("14. mixed grids paste exactly when they can", () => {
  it("writes an eighth-note bar onto a sixteenth grid", () => {
    const regridded = regridMelodic(RIFF(), 8, 16, 16);
    expect(regridded).not.toBeNull();
    // The struck notes land on the even slots and hold through the odd ones.
    expect(regridded?.[0]).toEqual({ notes: [{ pitch: "E2", velocity: 100 }] });
    expect(regridded?.[1]).toBe("-");
    expect(regridded?.[4]).toEqual({ notes: [{ pitch: "G2", velocity: 100 }] });
  });

  it("pastes a full bar across a grid change", () => {
    const source = song([
      bar({ gtr: RIFF() }, { resolution: 8 }),
      bar({ gtr: restSlots(16) }, { resolution: 16 }),
    ]);
    const clipboard = mustCopy(source, fullSel(0, 0));
    const result = applyBarCommand(source, fullSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[0]?.bars[1]?.resolution).toBe(16);
    expect(slotsOf(result.song, 1, "gtr")).toHaveLength(16);
  });
});

describe("15. a moment the target grid cannot write is refused", () => {
  it("refuses a straight bar onto a triplet grid, without rounding", () => {
    expect(regridMelodic(RIFF(), 8, 12, 12)).toBeNull();
  });

  it("refuses the paste rather than approximating it", () => {
    const source = song([
      bar({ gtr: RIFF() }, { resolution: 8 }),
      bar({ gtr: restSlots(12) }, { resolution: 12 }),
    ]);
    const clipboard = mustCopy(source, fullSel(0, 0));
    const result = applyBarCommand(source, fullSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
      replace: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });
});

describe("16. duplicating respects the bar limits", () => {
  it("refuses when the section would grow past its limit", () => {
    const bars = Array.from({ length: 8 }, () => bar({ gtr: RIFF() }));
    const source = song(bars);
    const result = applyBarCommand(source, fullSel(0, 3), { kind: "duplicate_bars" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("bar_limit_reached");
  });

  it("duplicates when there is room", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, fullSel(0, 0), { kind: "duplicate_bars" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(3);
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
  });
});

describe("17. a track repeat can fill to the end of the section", () => {
  it("writes the pattern into the bars that follow", () => {
    const source = song([
      bar({ gtr: [note("E2"), ...restSlots(7)] }),
      bar({ gtr: restSlots(8) }),
      bar({ gtr: restSlots(8) }),
    ]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "repeat_bars",
      mode: { kind: "fill_to_section_end" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The section did not grow; the pattern filled what was already there.
    expect(barCount(result.song)).toBe(3);
    expect(slotsOf(result.song, 1, "gtr")).toEqual([note("E2"), ...restSlots(7)]);
  });
});

describe("18. a full repeat adds structural copies", () => {
  it("adds count copies and refuses fill-to-end", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const twice = applyBarCommand(source, fullSel(0, 0), {
      kind: "repeat_bars",
      mode: { kind: "count", count: 2 },
    });
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(barCount(twice.song)).toBe(4);

    const filled = applyBarCommand(source, fullSel(0, 0), {
      kind: "repeat_bars",
      mode: { kind: "fill_to_section_end" },
    });
    expect(filled.ok).toBe(false);
    if (filled.ok) return;
    expect(filled.error.code).toBe("not_available_in_scope");
  });
});

describe("19. a track move carries content, not bars", () => {
  it("moves the notes and leaves the bar count alone", () => {
    const source = song([bar({ gtr: restSlots(8) }), bar({ gtr: RIFF() })]);
    const result = applyBarCommand(source, trackSel(1, 1), { kind: "move_bars_left" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(2);
    expect(slotsOf(result.song, 0, "gtr")).toEqual(RIFF());
    expect(slotsOf(result.song, 1, "gtr")).toEqual(restSlots(8));
  });

  it("refuses when there is no neighbouring bar", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: restSlots(8) })]);
    const result = applyBarCommand(source, trackSel(0, 0), { kind: "move_bars_left" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_room_to_move");
  });
});

describe("20. a full move reorders the bars themselves", () => {
  it("swaps the block with its neighbour, everything included", () => {
    const source = song([
      bar({ gtr: RIFF(), gtr2: OTHER() }),
      bar({ gtr: OTHER(), gtr2: RIFF() }),
      bar({ gtr: restSlots(8) }),
    ]);
    const result = applyBarCommand(source, fullSel(1, 1), { kind: "move_bars_left" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(3);
    expect(slotsOf(result.song, 0, "gtr")).toEqual(OTHER());
    expect(slotsOf(result.song, 0, "gtr2")).toEqual(RIFF());
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
  });

  it("refuses to move past the section edge", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, fullSel(1, 1), { kind: "move_bars_right" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_room_to_move");
  });
});

// ------------------------------------------------------- chains, 21 to 26

const HELD = () => [note("E2"), "-", "-", "-", "-", "-", "-", "-"] as MelodicSlot[];
const TAIL = () => ["-", "-", null, null, null, null, null, null] as MelodicSlot[];

describe("21. an incoming tie grows the selection", () => {
  it("takes the bar the sound was struck in", () => {
    const source = song([bar({ gtr: HELD() }), bar({ gtr: TAIL() })]);
    const grown = expandBarSelection(source, trackSel(1, 1));
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(grown.selection.startBarIndex).toBe(0);
    expect(grown.grewBy).toBe(1);
  });
});

describe("22. an outgoing tie grows the selection", () => {
  it("takes the bar the sound runs into", () => {
    const source = song([bar({ gtr: HELD() }), bar({ gtr: TAIL() })]);
    const grown = expandBarSelection(source, trackSel(0, 0));
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(grown.selection.endBarIndex).toBe(1);
  });
});

describe("23. slurs grow the selection too", () => {
  it("takes the bar a hammer-on reaches back into", () => {
    const source = song([
      bar({ gtr: [...restSlots(7), note("G3", { position: { string: 3, fret: 0 } })] }),
      bar({
        gtr: [
          note("A3", { articulation: "hammer_on", position: { string: 3, fret: 2 } }),
          ...restSlots(7),
        ],
      }),
    ]);
    const grown = expandBarSelection(source, trackSel(1, 1));
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(grown.selection.startBarIndex).toBe(0);
  });
});

describe("24. in full scope one track's link is enough", () => {
  it("grows for a tie the reader was not looking at", () => {
    const source = song([
      bar({ gtr: restSlots(8), gtr2: HELD() }),
      bar({ gtr: restSlots(8), gtr2: TAIL() }),
    ]);
    const grown = expandBarSelection(source, fullSel(1, 1));
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(grown.selection.startBarIndex).toBe(0);
  });
});

describe("25. a chain across the section seam is refused", () => {
  it("says so and changes nothing", () => {
    const source = makeSong(
      [guitarTrack({ id: "gtr" })],
      [
        section([bar({ gtr: HELD() })], { id: "a" }),
        section([bar({ gtr: TAIL() })], { id: "b" }),
      ],
    );
    const grown = expandBarSelection(source, {
      scope: "track",
      sectionId: "b",
      trackId: "gtr",
      startBarIndex: 0,
      endBarIndex: 0,
    });
    expect(grown.ok).toBe(false);
    if (grown.ok) return;
    expect(grown.error.code).toBe("chain_crosses_section");
    expect(grown.error.message).toContain("Bölüm sınırını aşan");
  });

  it("refuses the command too, without touching the song", () => {
    const source = makeSong(
      [guitarTrack({ id: "gtr" })],
      [
        section([bar({ gtr: HELD() })], { id: "a" }),
        section([bar({ gtr: TAIL() }), bar({ gtr: restSlots(8) })], { id: "b" }),
      ],
    );
    const before = JSON.stringify(source);
    const result = applyBarCommand(
      source,
      { scope: "track", sectionId: "b", trackId: "gtr", startBarIndex: 0, endBarIndex: 0 },
      { kind: "delete_bars" },
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("26. a missing track key cuts the carry", () => {
  it("does not grow across a bar the track is not written in", () => {
    const source = song([
      bar({ gtr: HELD() }),
      // The guitar is absent here, so the sound ends at the bar line.
      bar({ gtr2: OTHER() }),
      bar({ gtr: RIFF() }),
    ]);
    const grown = expandBarSelection(source, trackSel(0, 0));
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(grown.selection.endBarIndex).toBe(0);
  });
});

// --------------------------------------------------- collisions and safety

describe("27. a collision is refused without an explicit replace", () => {
  it("refuses a track paste onto written bars", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const clipboard = mustCopy(source, trackSel(0, 0));
    const result = applyBarCommand(source, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });

  /*
   * The rule is about the *target range*, not about whether two notes would
   * land on the same slot. A clipboard that happens to miss everything already
   * written is still being pasted over a bar that has music in it, and the
   * reader is still owed the question. Without this case the guard here and
   * the core's own slot-collision check fire together, and a probe that
   * removes one cannot tell that the other is doing different work.
   */
  it("refuses even when nothing would actually land on top", () => {
    const source = song([
      bar({ gtr: [note("E2"), ...restSlots(7)] }),
      bar({ gtr: [null, null, null, null, note("A2"), null, null, null] }),
    ]);
    const clipboard = mustCopy(source, trackSel(0, 0));
    const result = applyBarCommand(source, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });

  it("refuses a full paste onto written bars", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const clipboard = mustCopy(source, fullSel(0, 0));
    const result = applyBarCommand(source, fullSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });
});

describe("28. replace clears only the scope it was asked for", () => {
  it("a track replace leaves the other tracks written", () => {
    const source = song([
      bar({ gtr: RIFF(), gtr2: OTHER() }),
      bar({ gtr: OTHER(), gtr2: RIFF() }),
    ]);
    const clipboard = mustCopy(source, trackSel(0, 0));
    const result = applyBarCommand(source, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard,
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
    // The second guitar was never in scope, so it is exactly as it was.
    expect(slotsOf(result.song, 1, "gtr2")).toEqual(RIFF());
  });
});

describe("29. nothing mutates its input", () => {
  it("leaves the song byte-identical after every command", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: OTHER() }), bar({ gtr: OTHER() })]);
    const before = JSON.stringify(source);
    applyBarCommand(source, fullSel(0, 0), { kind: "duplicate_bars" });
    applyBarCommand(source, fullSel(0, 0), { kind: "delete_bars" });
    applyBarCommand(source, trackSel(0, 0), { kind: "delete_bars" });
    applyBarCommand(source, fullSel(0, 0), { kind: "insert_blank_bar_after" });
    applyBarCommand(source, fullSel(1, 1), { kind: "move_bars_left" });
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("30. the same input gives the same output", () => {
  it("is byte-equivalent over five runs", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: OTHER() }), bar({ gtr: OTHER() })]);
    const runs = Array.from({ length: 5 }, () => {
      const result = applyBarCommand(source, fullSel(0, 0), { kind: "duplicate_bars" });
      return result.ok ? JSON.stringify(result.song) : "refused";
    });
    expect(new Set(runs).size).toBe(1);
  });
});

describe("31. refusals come in a fixed order", () => {
  it("reports the chain before the collision", () => {
    // Both are true of this command: the selection is tied across the seam and
    // the target is occupied. The chain is checked first, always.
    const source = makeSong(
      [guitarTrack({ id: "gtr" })],
      [
        section([bar({ gtr: HELD() })], { id: "a" }),
        section([bar({ gtr: TAIL() }), bar({ gtr: RIFF() })], { id: "b" }),
      ],
    );
    const clipboard = copyBars(source, {
      scope: "track",
      sectionId: "b",
      trackId: "gtr",
      startBarIndex: 1,
      endBarIndex: 1,
    });
    expect(clipboard.ok).toBe(true);
    if (!clipboard.ok) return;

    const result = applyBarCommand(
      source,
      { scope: "track", sectionId: "b", trackId: "gtr", startBarIndex: 0, endBarIndex: 0 },
      { kind: "paste_bar_contents", clipboard: clipboard.clipboard },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chain_crosses_section");
  });

  it("reports an empty clipboard before a collision", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const empty: BarClipboard = {
      kind: "full_bars",
      barCount: 0,
      widthTicks: 0,
      bars: [],
    };
    const result = applyBarCommand(source, fullSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard: empty,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("clipboard_empty");
  });
});

describe("32. a successful command produces one new song", () => {
  it("returns a song that differs, and only where it should", () => {
    const source = song([bar({ gtr: RIFF(), gtr2: OTHER() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, trackSel(0, 0), { kind: "delete_bars" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).not.toBe(source);
    expect(JSON.stringify(result.song)).not.toBe(JSON.stringify(source));
    // Everything outside the scope is untouched.
    expect(result.song.sections[0]?.bars[1]).toEqual(source.sections[0]?.bars[1]);
    expect(slotsOf(result.song, 0, "gtr2")).toEqual(OTHER());
  });
});

describe("33. a refused command produces nothing at all", () => {
  it("returns no song to commit", () => {
    const source = song([bar({ gtr: RIFF() })]);
    const result = applyBarCommand(source, fullSel(0, 0), { kind: "delete_bars" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("song" in result).toBe(false);
  });
});

/*
 * Which commands change the shape of a section, and therefore which ones have
 * to stop playback before they are written (spec 13.12). Getting this wrong in
 * either direction is bad: a missed one leaves the scheduler pointing at bars
 * that moved, and a spurious one stops the music for an edit that changed
 * nothing structural.
 */
describe("34. what counts as a structural operation", () => {
  it("is never structural in the track scope", () => {
    const commands: BarCommand[] = [
      { kind: "cut_bars" },
      { kind: "delete_bars" },
      { kind: "duplicate_bars" },
      { kind: "repeat_bars", mode: { kind: "count", count: 2 } },
      { kind: "insert_blank_bar_before" },
      { kind: "insert_blank_bar_after" },
      { kind: "move_bars_left" },
      { kind: "move_bars_right" },
    ];
    for (const command of commands) {
      expect(isStructuralBarCommand("track", command)).toBe(false);
    }
  });

  it("is structural for every full-scope command that moves bars", () => {
    const commands: BarCommand[] = [
      { kind: "cut_bars" },
      { kind: "delete_bars" },
      { kind: "duplicate_bars" },
      { kind: "repeat_bars", mode: { kind: "count", count: 2 } },
      { kind: "insert_blank_bar_before" },
      { kind: "insert_blank_bar_after" },
      { kind: "move_bars_left" },
      { kind: "move_bars_right" },
    ];
    for (const command of commands) {
      expect(isStructuralBarCommand("full", command)).toBe(true);
    }
  });

  it("leaves reading and content-only writing alone", () => {
    const clipboard: FullBarsClipboard = {
      kind: "full_bars",
      barCount: 1,
      widthTicks: 768,
      bars: [bar({ gtr: RIFF() })],
    };
    expect(isStructuralBarCommand("full", { kind: "copy_bars" })).toBe(false);
    expect(
      isStructuralBarCommand("full", { kind: "paste_bar_contents", clipboard }),
    ).toBe(false);
    // Inserting copies does add bars, so it is not in the same group.
    expect(
      isStructuralBarCommand("full", {
        kind: "insert_copied_bars",
        clipboard,
        side: "after",
      }),
    ).toBe(true);
  });
});

/*
 * A bar where a track has no key at all is the ordinary empty bar: silence is
 * absence (spec 5.5). It is also the bar a reader most often pastes into, and
 * for a while it was refused with a sentence about the rhythm grid — a message
 * about a problem that was not there.
 */
describe("35. an empty bar is somewhere content can land", () => {
  const source = () =>
    song([
      bar({ gtr: RIFF() }),
      // No `gtr` key at all: the track is silent here, and says so by absence.
      bar({ gtr2: OTHER() }),
    ]);

  it("pastes into a bar the track has never been written in", () => {
    const from = source();
    const read = copyBars(from, trackSel(0, 0));
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = applyBarCommand(from, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard: read.clipboard,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
    // The bar's own shape and its other tracks are untouched.
    expect(result.song.sections[0]?.bars[1]?.resolution).toBe(8);
    expect(slotsOf(result.song, 1, "gtr2")).toEqual(OTHER());
  });

  it("does not call an empty bar occupied", () => {
    const from = source();
    const read = copyBars(from, trackSel(0, 0));
    if (!read.ok) return;
    const result = applyBarCommand(from, trackSel(1, 1), {
      kind: "paste_bar_contents",
      clipboard: read.clipboard,
    });
    expect(result.ok).toBe(true);
  });

  it("copies a silent bar as silence, and pasting it clears the target", () => {
    const from = source();
    const read = copyBars(from, trackSel(1, 1));
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = applyBarCommand(from, trackSel(0, 0), {
      kind: "paste_bar_contents",
      clipboard: read.clipboard,
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Absence in, absence out. Not an array of rests, which would be a claim
    // that the track is written here and plays nothing.
    expect(slotsOf(result.song, 0, "gtr")).toBeUndefined();
  });
});

/*
 * The arrangement draws a drum lane and offers the same long press on it. If
 * bar operations refused there, the app would be disagreeing with itself about
 * what a track is.
 */
describe("36. the drum lane is a track like any other", () => {
  const beat = (): DrumSlot[] => [
    [{ piece: "kick" }],
    [],
    [{ piece: "snare" }],
    [],
    [{ piece: "kick" }],
    [],
    [{ piece: "snare" }],
    [],
  ];

  /** A bar written for the drums, which the melodic helper cannot express. */
  const drumBar = (slots: DrumSlot[], resolution: 8 | 12 = 8): Bar => ({
    timeSignature: [4, 4],
    resolution,
    slots: { drums: slots },
  });

  it("copies and pastes a drum bar", () => {
    const source = song([drumBar(beat()), bar({})]);
    const read = copyBars(source, trackSel(0, 0, "drums"));
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const result = applyBarCommand(source, trackSel(1, 1, "drums"), {
      kind: "paste_bar_contents",
      clipboard: read.clipboard,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "drums")).toEqual(beat());
    // And the bar it came from is still exactly as it was.
    expect(slotsOf(result.song, 0, "drums")).toEqual(beat());
  });

  it("empties a drum bar without removing it", () => {
    const source = song([drumBar(beat())]);
    const result = applyBarCommand(source, trackSel(0, 0, "drums"), {
      kind: "delete_bars",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barCount(result.song)).toBe(1);
    expect(slotsOf(result.song, 0, "drums")).toEqual(
      Array.from({ length: 8 }, () => []),
    );
  });

  it("refuses a drum bar the target grid cannot state", () => {
    // A triplet bar of drums onto an eighth-note bar: the second hit lands 64
    // ticks in, and 64 is not a multiple of 96.
    const triplet: DrumSlot[] = Array.from({ length: 12 }, (_, index) =>
      index === 1 ? [{ piece: "closed_hat" as const }] : [],
    );
    const source = song([drumBar(triplet, 12), bar({})]);
    const read = copyBars(source, trackSel(0, 0, "drums"));
    if (!read.ok) return;
    const result = applyBarCommand(source, trackSel(1, 1, "drums"), {
      kind: "paste_bar_contents",
      clipboard: read.clipboard,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });
});

/**
 * The founder pressed "Yerine koy" on a move and nothing happened: the dialog
 * stayed open and the same warning was written under it again (2U-B §7).
 *
 * Three collisions used to answer with one code, and only one of the three was
 * ever honoured. These fix the boundary in both directions — the overwrite
 * that must work, and the one that must never be offered.
 */
describe("29. an overwrite either works or is never offered", () => {
  it("refuses a track duplicate onto occupied bars, and names it", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "duplicate_bars",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });

  it("lets the same duplicate through once the reader confirms", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "duplicate_bars",
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* The target now holds the source, and the source is untouched. */
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
    expect(slotsOf(result.song, 0, "gtr")).toEqual(RIFF());
    /* And nothing structural happened: a content duplicate keeps the length. */
    expect(barCount(result.song)).toBe(2);
  });

  it("lets a confirmed repeat overwrite every bar it covers", () => {
    const source = song([
      bar({ gtr: RIFF() }),
      bar({ gtr: OTHER() }),
      bar({ gtr: OTHER() }),
    ]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "repeat_bars",
      mode: { kind: "count", count: 2 },
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
    expect(slotsOf(result.song, 2, "gtr")).toEqual(RIFF());
  });

  it("leaves the other tracks alone when it overwrites", () => {
    const source = song([
      bar({ gtr: RIFF(), gtr2: OTHER() }),
      bar({ gtr: OTHER(), gtr2: RIFF() }),
    ]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "duplicate_bars",
      replace: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr2")).toEqual(RIFF());
    expect(slotsOf(result.song, 0, "gtr2")).toEqual(OTHER());
  });

  it("gives a blocked move its own code, which no overwrite answers", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "move_bars_right",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    /*
     * Not `target_occupied`. A move that wrote over its neighbour would lose a
     * bar of music to a gesture that reads like nudging, so the core refuses
     * it — and the screen must be able to tell that refusal apart from the one
     * a confirmation resolves, or it draws a button that cannot work.
     */
    expect(result.error.code).toBe("move_target_occupied");
    expect(needsReplaceConfirmation(result.error.code)).toBe(false);
  });

  it("still moves when the neighbour is free", () => {
    const source = song([bar({ gtr: RIFF() }), bar({})]);
    const result = applyBarCommand(source, trackSel(0, 0), {
      kind: "move_bars_right",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song, 1, "gtr")).toEqual(RIFF());
  });

  it("refuses without writing: the song it was given is untouched", () => {
    const source = song([bar({ gtr: RIFF() }), bar({ gtr: OTHER() })]);
    const before = JSON.stringify(source);
    applyBarCommand(source, trackSel(0, 0), { kind: "move_bars_right" });
    applyBarCommand(source, trackSel(0, 0), { kind: "duplicate_bars" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("has a sentence for every code the core can return", () => {
    /* `Record` makes this a type error, but the move code is new enough to
       be worth an assertion that its entry says something. */
    expect(BAR_MESSAGES.move_target_occupied.length).toBeGreaterThan(10);
    expect(BAR_MESSAGES.move_target_occupied).not.toBe(
      BAR_MESSAGES.target_occupied,
    );
  });
});
