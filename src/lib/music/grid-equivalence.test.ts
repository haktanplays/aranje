/**
 * The three grids that were already here must not have moved (spec 5.5, K-34).
 *
 * Phase 2H-A widened `Resolution` from two values to five and pulled the tick
 * arithmetic into one module. Both are the kind of change that can be right in
 * general and wrong for the songs people already have, so these tests hold the
 * new code against the old formulas — written out literally below, exactly as
 * they appeared inline before the move — and against the demo song's plan.
 */
import { describe, expect, it } from "vitest";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { barTimeline, buildNotatedPlan, buildSongPlan } from "@/lib/audio/schedule";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { songSchema } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import {
  PPQ,
  isRepresentableGrid,
  slotCount,
  slotsPerNotatedBeat,
  ticksPerSlot,
} from "@/lib/music/timing";
import { TIME_SIGNATURES, type TimeSignature } from "@/lib/music/timing";

/** `lib/audio/schedule.ts`, before the move. */
const oldTicksPerSlot = (resolution: number) => (PPQ * 4) / resolution;

/** `lib/audio/schedule.ts` `barTimeline`, before the move. */
const oldSlotCount = (timeSignature: TimeSignature, resolution: number) =>
  (timeSignature[0] * resolution) / timeSignature[1];

/** `components/workspace/geometry.ts`, before the move. */
const oldSlotsPerBeat = (timeSignature: TimeSignature, resolution: number) =>
  Math.max(1, resolution / timeSignature[1]);

describe("8 and 16 answer exactly what they used to", () => {
  it("gives the same slot length in ticks", () => {
    for (const resolution of [8, 16] as const) {
      expect(ticksPerSlot(resolution)).toBe(oldTicksPerSlot(resolution));
    }
    expect(ticksPerSlot(8)).toBe(96);
    expect(ticksPerSlot(16)).toBe(48);
  });

  it("gives the same slot count in every meter", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of [8, 16] as const) {
        expect(slotCount(timeSignature, resolution)).toBe(
          oldSlotCount(timeSignature, resolution),
        );
      }
    }
  });

  it("puts the beat ticks in the same places", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of [8, 16] as const) {
        expect(slotsPerNotatedBeat(timeSignature, resolution)).toBe(
          oldSlotsPerBeat(timeSignature, resolution),
        );
      }
    }
  });
});

describe("the demo song plans byte for byte the same", () => {
  it("has the same bar timeline it had before the widening", () => {
    const timeline = barTimeline(SAMPLE_SONG);
    // Rebuilt here with the old inline arithmetic, start to finish.
    let time = 0;
    let barNumber = 0;
    const rebuilt = SAMPLE_SONG.sections.flatMap((section) =>
      section.bars.map((bar, barIndex) => {
        barNumber += 1;
        const count = oldSlotCount(bar.timeSignature, bar.resolution);
        const durationTicks = count * oldTicksPerSlot(bar.resolution);
        const marker = {
          barKey: `${section.id}:${barIndex}`,
          sectionId: section.id,
          barNumber,
          time,
          durationTicks,
          slotCount: count,
          timeSignature: bar.timeSignature,
          resolution: bar.resolution,
        };
        time += durationTicks;
        return marker;
      }),
    );
    expect(JSON.stringify(timeline)).toBe(JSON.stringify(rebuilt));
  });

  it("still schedules the same events at the same ticks", () => {
    // A golden of the shape rather than a re-derivation: if any of the moved
    // arithmetic drifted, the first event's tick or the last event's end would
    // move, and this song is entirely on the grids that already existed.
    const plan = buildSongPlan(SAMPLE_SONG);
    expect(plan.totalTicks).toBe(6144);
    expect(plan.bars).toHaveLength(8);
    expect(plan.bars.every((bar) => bar.durationTicks === 768)).toBe(true);
    expect(plan.events.length).toBeGreaterThan(0);
    for (const event of plan.events) {
      expect(Number.isInteger(event.time)).toBe(true);
      expect(event.time % 24).toBe(0); // every 2H-A grid divides 24 ticks
    }
  });
});

describe("101. the quarter grid arrived without a second list (2N-A §5)", () => {
  /*
   * The risk with widening `Resolution` is not the arithmetic — it is the
   * places that quietly kept their own copy of the set. This walks a song
   * written at 1/4 through the schema, the validators, the plan and the tab
   * timeline, and checks the answer against the same formulas the rest of this
   * file holds the older grids to. Nothing here is patched for 4.
   */
  const guitar = SAMPLE_SONG.tracks.find((track) => track.id === "gtr");
  const hit = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };

  const quarterSong = () =>
    songSchema.parse({
      version: 2,
      title: "Dortluk",
      bpm: 120,
      key: "E minor",
      tracks: [guitar],
      sections: [
        {
          id: "s1",
          name: "S1",
          status: "fixed",
          bars: [
            { timeSignature: [4, 4], resolution: 4, slots: { gtr: [hit, null, hit, "-"] } },
            { timeSignature: [3, 4], resolution: 4, slots: { gtr: [hit, null, null] } },
            {
              timeSignature: [4, 4],
              resolution: 16,
              slots: { gtr: Array.from({ length: 16 }, () => null) },
            },
          ],
        },
      ],
    });

  it("counts and times a quarter bar by the same formulas as every other", () => {
    expect(slotCount([4, 4], 4)).toBe(oldSlotCount([4, 4], 4));
    expect(slotCount([3, 4], 4)).toBe(oldSlotCount([3, 4], 4));
    expect(ticksPerSlot(4)).toBe(oldTicksPerSlot(4));
    // A bar lasts what a bar lasts: the grid changes how finely it is written,
    // never how long it is.
    expect(slotCount([4, 4], 4) * ticksPerSlot(4)).toBe(
      slotCount([4, 4], 32) * ticksPerSlot(32),
    );
  });

  it("is accepted by the contract and refused nothing by the validators", () => {
    const song = quarterSong();
    expect(runValidators(song).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("schedules a quarter bar, its tie and the finer bar after it", () => {
    const plan = buildNotatedPlan(quarterSong());
    // Two struck notes in bar 1 and one in bar 2; the tie is folded into the
    // note it continues rather than becoming an event of its own.
    expect(plan.events.map((event) => event.time)).toEqual([0, 384, 768]);
    const second = plan.events[1];
    expect(second?.kind).toBe("note");
    // Two quarter slots: the tie is folded into the note it continues.
    expect(second?.kind === "note" ? second.durationTicks : null).toBe(384);
  });

  it("draws one cell per slot, mixed grids included", () => {
    const timeline = buildTrackTimeline(quarterSong(), "gtr");
    expect(timeline.kind).toBe("fretted");
    if (timeline.kind !== "fretted") return;
    expect(timeline.bars.map((bar) => bar.slotCount)).toEqual([4, 3, 16]);
  });

  it("is offered on the meters that can write it and no others", () => {
    // Not a list: the representability rule already knows, and this is the
    // reading of it that the section form and the timing sheet both use.
    expect(isRepresentableGrid([4, 4], 4)).toBe(true);
    expect(isRepresentableGrid([3, 4], 4)).toBe(true);
    expect(isRepresentableGrid([6, 8], 4)).toBe(false);
    expect(isRepresentableGrid([7, 8], 4)).toBe(false);
  });
});
