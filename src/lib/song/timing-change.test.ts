/**
 * Changing the meter and grid of music that already exists (spec 13.20 §6).
 *
 * The rule under all of these is that a note's **moment** is what survives.
 * Everything the command refuses, it refuses because keeping that moment would
 * require moving it — and moving it quietly is the failure this whole module
 * exists to make impossible.
 */
import { describe, expect, it } from "vitest";

import { barTimeline, buildNotatedPlan } from "@/lib/audio/schedule";
import { ticksPerSlot } from "@/lib/music/timing";
import { changeTiming, type TimingChange } from "@/lib/song/timing-change";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";
import { bar, readBar, REST, sectionOf, slots, song, TIE, TRACK_ID } from "@/test/move-fixtures";

const note = (pitch: string, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string: 1, fret } }],
});

const hammered = (pitch: string, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string: 1, fret }, articulation: "hammer_on" as const }],
});

const change = (
  overrides: Partial<TimingChange> = {},
): TimingChange => ({
  sectionId: "s1",
  scope: { kind: "bar", barIndex: 0 },
  timeSignature: [4, 4],
  resolution: 16,
  ...overrides,
});

/** A bar written at a given grid, padded with rests. */
const gridBar = (written: readonly MelodicSlot[], resolution: 4 | 8 | 16 | 32, count: number): Bar => ({
  timeSignature: [4, 4],
  resolution,
  slots: {
    [TRACK_ID]: [
      ...written,
      ...Array.from({ length: count - written.length }, () => REST),
    ],
  },
});

describe("102. the grid changes and the music does not move", () => {
  it("keeps every onset at the tick it was on", () => {
    // 1/8: notes at slots 0 and 4, which are ticks 0 and 384.
    const before = song([bar(slots([note("A3", 12), REST, REST, REST, note("C4", 15)]))]);
    const result = changeTiming(before, change({ resolution: 16 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1/16: the same ticks are slots 0 and 8.
    const after = readBar(result.song, 0);
    expect(after).toHaveLength(16);
    expect(after[0]).toBe("A3");
    expect(after[8]).toBe("C4");
    // And the plan agrees, which is the reading that actually gets played.
    expect(buildNotatedPlan(result.song).events.map((event) => event.time)).toEqual(
      buildNotatedPlan(before).events.map((event) => event.time),
    );
  });

  it("rebuilds a held note's ties for the new grid, keeping its length", () => {
    const before = song([bar(slots([note("A3", 12), TIE, REST, REST]))]);
    const result = changeTiming(before, change({ resolution: 16 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two eighths of sound become four sixteenths of sound.
    expect(readBar(result.song, 0).slice(0, 5)).toEqual(["A3", "-", "-", "-", "."]);
  });

  it("refuses rather than rounding a rhythm the target cannot write", () => {
    /*
     * A straight eighth falls between two triplets. Nothing here moves it to
     * the nearest slot: the whole point of the tick contract is that "close
     * enough" is not an answer (spec 5.5, K-34).
     */
    const before = song([bar(slots([note("A3", 12), note("C4", 15), REST, REST]))]);
    const result = changeTiming(before, change({ resolution: 12 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });

  it("goes to a coarser grid when the music really fits it", () => {
    /*
     * Both ends have to fit, not just the onsets. Two notes *held* for a
     * quarter each can be written at 1/4; the same two notes played short
     * cannot, because a sixteenth has no slot there — which is the next test.
     */
    const before = song([
      gridBar(
        [note("A3", 12), TIE, TIE, TIE, note("C4", 15), TIE, TIE, TIE],
        16,
        16,
      ),
    ]);
    const result = changeTiming(before, change({ resolution: 4 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual(["A3", "C4", ".", "."]);
  });

  it("refuses a coarser grid when the notes are shorter than its slot", () => {
    // The onsets land on 1/4 slots; the sixteenth-long sounds do not fit in
    // them, and stretching them to a quarter would be writing something else.
    const before = song([
      gridBar([note("A3", 12), REST, REST, REST, note("C4", 15)], 16, 16),
    ]);
    const result = changeTiming(before, change({ resolution: 4 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });
});

describe("103. a shorter bar refuses rather than losing anything", () => {
  it("refuses when an onset would fall outside the new measure", () => {
    // The fourth beat has a note on it; 3/4 has no fourth beat.
    const before = song([
      bar(slots([note("A3", 12), REST, REST, REST, REST, REST, note("C4", 15), REST])),
    ]);
    const result = changeTiming(
      before,
      change({ timeSignature: [3, 4], resolution: 8 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("content_exceeds_new_measure");
  });

  it("looks at the sound, not only at the onsets", () => {
    /*
     * The onset is comfortably inside the shorter bar; what does not fit is
     * how long it is held. A check that only counted onsets would truncate the
     * note and call it a success.
     */
    const before = song([
      bar(slots([REST, REST, REST, REST, note("A3", 12), TIE, TIE, TIE])),
    ]);
    const shortened = changeTiming(
      before,
      change({ timeSignature: [3, 4], resolution: 8 }),
    );
    expect(shortened.ok).toBe(false);
    if (shortened.ok) return;
    expect(shortened.error.code).toBe("content_exceeds_new_measure");
  });

  it("shortens happily when the music is really inside the new measure", () => {
    const before = song([bar(slots([note("A3", 12), REST, note("C4", 15), REST]))]);
    const result = changeTiming(
      before,
      change({ timeSignature: [3, 4], resolution: 8 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual(["A3", ".", "C4", ".", ".", "."]);
  });

  it("changes nothing at all when it refuses", () => {
    const before = song([
      bar(slots([REST, REST, REST, REST, REST, REST, note("C4", 15), REST])),
    ]);
    const snapshot = JSON.stringify(before);
    changeTiming(before, change({ timeSignature: [3, 4], resolution: 8 }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("104. a longer bar does not quietly break a chain across the line", () => {
  /** Bar 1 fills its 3/4 and is tied into bar 2. */
  const tiedOverTheLine = (): Song => {
    const first: Bar = {
      timeSignature: [3, 4],
      resolution: 8,
      slots: { [TRACK_ID]: [REST, REST, REST, REST, note("A3", 12), TIE] },
    };
    const second: Bar = {
      timeSignature: [3, 4],
      resolution: 8,
      slots: { [TRACK_ID]: [TIE, REST, REST, REST, REST, REST] },
    };
    return song([first, second]);
  };

  it("refuses to lengthen a bar whose last note is tied into the next", () => {
    /*
     * The note still fits; that is what makes this case worth its own code.
     * Lengthening the bar moves the line away from the end of the note, so the
     * `"-"` in the next bar would continue nothing.
     */
    const result = changeTiming(
      tiedOverTheLine(),
      change({ timeSignature: [4, 4], resolution: 8 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timing_change_splits_chain");
  });

  it("refuses the same way for a legato bond reaching back over the line", () => {
    const first: Bar = {
      timeSignature: [3, 4],
      resolution: 8,
      slots: { [TRACK_ID]: [REST, REST, REST, REST, REST, note("A3", 12)] },
    };
    const second: Bar = {
      timeSignature: [3, 4],
      resolution: 8,
      slots: { [TRACK_ID]: [hammered("B3", 14), REST, REST, REST, REST, REST] },
    };
    const result = changeTiming(
      song([first, second]),
      change({ timeSignature: [4, 4], resolution: 8 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timing_change_splits_chain");
  });

  it("lengthens freely when nothing crosses the line", () => {
    const first: Bar = {
      timeSignature: [3, 4],
      resolution: 8,
      slots: { [TRACK_ID]: [note("A3", 12), REST, REST, REST, REST, REST] },
    };
    const second: Bar = {
      timeSignature: [3, 4],
      resolution: 8,
      slots: { [TRACK_ID]: [note("C4", 15), REST, REST, REST, REST, REST] },
    };
    const result = changeTiming(
      song([first, second]),
      change({ timeSignature: [4, 4], resolution: 8 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The bar gained real rests, and the note stayed where it was struck.
    expect(readBar(result.song, 0)).toEqual([
      "A3", ".", ".", ".", ".", ".", ".", ".",
    ]);
  });

  it("changes the grid under a tied line without touching the line itself", () => {
    // Same meter, finer grid: the bar keeps its length, so the tie is safe.
    const result = changeTiming(
      tiedOverTheLine(),
      change({ timeSignature: [3, 4], resolution: 16 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = readBar(result.song, 0);
    expect(after).toHaveLength(12);
    // The note still sounds right up to the line, so the next bar's tie holds.
    expect(after[after.length - 1]).toBe("-");
  });
});

describe("105. a whole section changes all at once or not at all", () => {
  const mixed = (): Song =>
    song([
      gridBar([note("A3", 12), REST, REST, REST], 8, 8),
      gridBar([note("C4", 15), REST, REST, REST], 16, 16),
      gridBar([note("B3", 14), REST], 4, 4),
    ]);

  it("really converts every bar, not just the section's metadata", () => {
    const result = changeTiming(
      mixed(),
      change({ scope: { kind: "section" }, resolution: 16 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const section = sectionOf(result.song);
    expect(section.bars.map((entry) => entry.resolution)).toEqual([16, 16, 16]);
    expect(section.bars.map((_, index) => readBar(result.song, index).length)).toEqual([
      16, 16, 16,
    ]);
    expect(result.barsChanged).toBe(3);
  });

  it("leaves every bar alone when one of them cannot be converted", () => {
    /*
     * Atomicity, and it is the reason the command builds the whole section
     * before writing any of it. A partial conversion would leave a section
     * whose bars disagree about a change the reader asked for once.
     */
    const before = song([
      gridBar([note("A3", 12), REST, REST, REST], 8, 8),
      // Two straight eighths: they cannot be written on a triplet grid.
      gridBar([note("C4", 15), note("B3", 14), REST, REST], 8, 8),
    ]);
    const snapshot = JSON.stringify(before);
    const result = changeTiming(
      before,
      change({ scope: { kind: "section" }, resolution: 12 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses the whole section when one track of one bar cannot be converted", () => {
    const guitarOnly = song([
      gridBar([note("A3", 12), REST, REST, REST], 8, 8),
    ]);
    const withDrums: Song = {
      ...guitarOnly,
      sections: guitarOnly.sections.map((section) => ({
        ...section,
        bars: section.bars.map((entry) => ({
          ...entry,
          slots: {
            ...entry.slots,
            // A hit on the second eighth, which no triplet slot lands on.
            drums: [[], [{ piece: "kick" as const }], [], [], [], [], [], []],
          },
        })),
      })),
    };
    const result = changeTiming(
      withDrums,
      change({ scope: { kind: "section" }, resolution: 12 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });
});

describe("106. what the command refuses to touch", () => {
  it("writes no slot array for a track that was never written in the bar", () => {
    // Silence is absence (spec 5.5). A lengthened bar gains rests for the
    // tracks that are there, and nothing at all for the ones that are not.
    const before = song([
      { timeSignature: [3, 4], resolution: 8, slots: {} },
    ]);
    const result = changeTiming(before, change({ timeSignature: [4, 4], resolution: 8 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(sectionOf(result.song).bars[0]?.slots ?? {})).toEqual([]);
  });

  it("leaves the section's tempo override exactly where it was", () => {
    const before = song([bar(slots([note("A3", 12), REST]))]);
    const withTempo: Song = {
      ...before,
      sections: before.sections.map((section) => ({ ...section, bpmOverride: 96 })),
    };
    const result = changeTiming(withTempo, change({ resolution: 16 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOf(result.song).bpmOverride).toBe(96);
  });

  it("refuses a meter and grid that cannot be written together", () => {
    const before = song([bar(slots([note("A3", 12), REST]))]);
    for (const [meter, resolution] of [
      [[6, 8], 4],
      [[7, 8], 12],
    ] as const) {
      const result = changeTiming(
        before,
        change({ timeSignature: meter, resolution }),
      );
      expect(result.ok, `${meter}@${resolution}`).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("unsupported_meter_resolution");
    }
  });

  it("makes no write at all when nothing would change", () => {
    const before = song([bar(slots([note("A3", 12), REST]))]);
    const result = changeTiming(before, change({ resolution: 8 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_timing_change");
  });

  it("never mutates the song it was given", () => {
    const before = song([bar(slots([note("A3", 12), REST]))]);
    const snapshot = JSON.stringify(before);
    changeTiming(before, change({ resolution: 16 }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("is deterministic", () => {
    const before = song([bar(slots([note("A3", 12), REST]))]);
    const first = changeTiming(before, change({ resolution: 16 }));
    const second = changeTiming(before, change({ resolution: 16 }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.song)).toBe(JSON.stringify(second.song));
  });
});

describe("107. everything after the bar re-derives from the change", () => {
  it("moves the bars after it by exactly the beat that was removed", () => {
    /*
     * Nothing in the timeline is told about this command. A bar's length is
     * `slotCount × ticksPerSlot`, and the next bar's start is the sum of the
     * ones before it — so 4/4 becoming 3/4 moves everything after it by one
     * quarter, everywhere at once (spec 5.5, 8.3).
     */
    const before = song([
      bar(slots([note("A3", 12), REST, REST, REST])),
      bar(slots([note("C4", 15), REST])),
      bar(slots([note("B3", 14), REST])),
    ]);
    const beforeStarts = barTimeline(before).map((entry) => entry.time);

    const result = changeTiming(
      before,
      change({ timeSignature: [3, 4], resolution: 8 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const afterStarts = barTimeline(result.song).map((entry) => entry.time);
    const quarter = ticksPerSlot(8) * 2;
    expect(afterStarts[0]).toBe(beforeStarts[0]);
    expect(afterStarts[1]).toBe((beforeStarts[1] ?? 0) - quarter);
    expect(afterStarts[2]).toBe((beforeStarts[2] ?? 0) - quarter);

    // The notes in the later bars moved with their bars, not on their own.
    const plan = buildNotatedPlan(result.song);
    expect(plan.events.map((event) => event.time)).toEqual(afterStarts);
  });
});
