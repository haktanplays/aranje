/**
 * What a bounded run of the song may sound (2V-A §3, §7, §8).
 *
 * The scheduler is not re-implemented for a selection; it is *filtered*. So
 * the thing worth testing is the filter, and it is tested against the same
 * notated plan the engine schedules from — not against a hand-written list of
 * what ought to be in there.
 */
import { describe, expect, it } from "vitest";

import { buildNotatedPlan } from "@/lib/audio/schedule";
import {
  clipToWindow,
  windowEvents,
} from "@/lib/playback/selection-playback";
import {
  drumTrack,
  guitarTrack,
  restSlots,
  section,
  silentDrumSlots,
  song,
} from "@/lib/song/fixtures";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const GTR = "gtr";
const BASS = "bass";
const DRUMS = "drums";
const BAR = 768;
const SLOT = 48;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

/**
 * One bar, three instruments, notes on every beat.
 *
 * Three tracks because "only the selected track sounds" is unfalsifiable on
 * one, and a drum kit because a struck drum is audible music that the melodic
 * slot stream cannot see.
 */
function trio(): Song {
  const line = (): MelodicSlot[] => {
    const slots = restSlots(16);
    slots[0] = note("E2", 0, 0);
    slots[4] = note("G3", 3, 0);
    slots[8] = note("A3", 3, 2);
    slots[12] = note("B3", 4, 0);
    return slots;
  };
  const beats = silentDrumSlots(16);
  beats[0] = [{ piece: "kick" }];
  beats[8] = [{ piece: "snare" }];

  const bar: Bar = {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: line(), [BASS]: line(), [DRUMS]: beats },
  };
  return song(
    [
      guitarTrack({ id: GTR }),
      guitarTrack({ id: BASS, name: "Bas" }),
      drumTrack({ id: DRUMS }),
    ],
    [section([bar, bar], { id: "s1" })],
  );
}

const win = (
  startTicks: number,
  endTicks: number,
  trackIds: readonly string[],
) => ({ startTicks, endTicks, trackIds });

describe("which events a window lets through", () => {
  it("keeps only the tracks the selection named", () => {
    const source = trio();
    const events = windowEvents(source, win(0, BAR, [GTR]));
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events.map((event) => event.trackId))).toEqual(new Set([GTR]));
  });

  it("keeps only the ticks the selection covers", () => {
    const source = trio();
    /* Beats one and two of the first bar. */
    const events = windowEvents(source, win(0, 8 * SLOT, [GTR]));
    expect(events.map((event) => event.time)).toEqual([0, 4 * SLOT]);
  });

  it("lets a drum through, because a struck drum is a note to the ear", () => {
    const source = trio();
    const events = windowEvents(source, win(0, BAR, [DRUMS]));
    expect(events.map((event) => event.kind)).toEqual(["drum", "drum"]);
  });

  it("does not re-strike a note that began before the window", () => {
    /*
     * A tie across the boundary. The second bar's note is a continuation, so
     * the notated plan puts one event at the first bar's onset and none at
     * the second's — and a window that started at the bar line must let
     * *nothing* through rather than manufacturing an attack the reader never
     * wrote (§3).
     */
    const held = restSlots(16);
    held[0] = note("E2", 0, 0);
    const carried = restSlots(16);
    carried[0] = "-";
    const source = song(
      [guitarTrack({ id: GTR })],
      [
        section(
          [
            { timeSignature: [4, 4], resolution: 16, slots: { [GTR]: held } },
            { timeSignature: [4, 4], resolution: 16, slots: { [GTR]: carried } },
          ],
          { id: "s1" },
        ),
      ],
    );
    expect(windowEvents(source, win(BAR, 2 * BAR, [GTR]))).toEqual([]);
    /* And the whole thing is one note, struck once, when both bars are in. */
    expect(windowEvents(source, win(0, 2 * BAR, [GTR]))).toHaveLength(1);
  });

  it("agrees with the unfiltered plan about every event it keeps", () => {
    /*
     * The filter may drop events; it may never invent or alter one. Compared
     * against the same traversal the engine schedules from, so a window that
     * quietly shifted a time or a duration would show up here rather than as
     * a selection that sounds slightly unlike the song.
     */
    const source = trio();
    const all = buildNotatedPlan(source).events;
    const kept = windowEvents(source, win(0, BAR, [GTR, DRUMS]));
    for (const event of kept) {
      expect(all).toContainEqual(event);
    }
    expect(kept.length).toBeLessThan(all.length);
  });

  it("is half-open: the end tick is the first one that does not play", () => {
    const source = trio();
    const upTo = windowEvents(source, win(0, 12 * SLOT, [GTR]));
    const including = windowEvents(source, win(0, 12 * SLOT + 1, [GTR]));
    expect(upTo).toHaveLength(3);
    expect(including).toHaveLength(4);
  });
});

describe("what happens to a note that rings past the end", () => {
  it("is cut at the boundary, in the sound only", () => {
    /*
     * §3: a note that begins inside the selection is played with its real
     * expression, and only its *tail* is shortened, and only for this
     * audition. The written duration is a fact about the music.
     */
    const clipped = clipToWindow(
      { time: 0, durationTicks: BAR },
      { endTicks: SLOT },
    );
    expect(clipped).toBe(SLOT);
  });

  it("leaves a note that finishes inside exactly as long as it was", () => {
    const kept = clipToWindow(
      { time: 0, durationTicks: SLOT },
      { endTicks: BAR },
    );
    expect(kept).toBe(SLOT);
  });

  it("never shortens a note to nothing", () => {
    // A note starting on the last tick still has to be heard as a note.
    const sliver = clipToWindow(
      { time: BAR - 1, durationTicks: BAR },
      { endTicks: BAR },
    );
    expect(sliver).toBeGreaterThan(0);
  });

  it("does not touch the written duration in the song", () => {
    const source = trio();
    const before = JSON.stringify(source);
    windowEvents(source, win(0, SLOT, [GTR]));
    clipToWindow(
      { time: 0, durationTicks: BAR },
      { endTicks: SLOT },
    );
    expect(JSON.stringify(source)).toBe(before);
    /* And the plan the exporter reads is unchanged too. */
    const written = (input: Song) => {
      const first = buildNotatedPlan(input).events[0];
      return first && first.kind === "note" ? first.durationTicks : null;
    };
    expect(written(source)).toBe(written(trio()));
  });
});
