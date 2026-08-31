/**
 * Turning a selection into something the transport can play (2V-A §7, §8).
 *
 * Written before the module it tests. The claim is not that the numbers are
 * plausible but that a *selection* — whichever of the three gestures made it —
 * resolves to one honest pair of song-absolute ticks and one honest list of
 * tracks, and refuses in a way the reader can be told about rather than
 * refusing after they have pressed.
 */
import { describe, expect, it } from "vitest";

import {
  describeBarSelection,
  describeTimeSelection,
} from "@/lib/song/selection-descriptor";
import {
  NO_AUDIBLE_NOTES,
  planSelectionPlayback,
} from "@/lib/playback/selection-playback";
import {
  guitarTrack,
  drumTrack,
  restSlots,
  silentDrumSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const GTR = "gtr";
const BASS = "bass";
/** One 4/4 bar on a 1/16 grid: sixteen slots of 48 ticks. */
const BAR = 768;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

/** A bar with the same slots written for two instruments. */
function twoTrackBar(slots: readonly MelodicSlot[]): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: [...slots], [BASS]: [...slots] },
  };
}

/**
 * Two sections, so "song-absolute" is falsifiable.
 *
 * A descriptor counts ticks from the start of its *section*; the transport
 * counts them from the start of the song. On a one-section song those two are
 * the same number, and a plan that forgot to add the offset would pass every
 * test written against it.
 */
function twoSectionSong(): Song {
  const first: MelodicSlot[] = restSlots(16);
  first[0] = note("E2", 0, 0);
  first[4] = note("G3", 3, 0);
  first[8] = note("A3", 3, 2);

  const second: MelodicSlot[] = restSlots(16);
  second[0] = note("B3", 4, 0);
  second[8] = note("C4", 4, 1);

  return song(
    [guitarTrack({ id: GTR }), guitarTrack({ id: BASS, name: "Bas" })],
    [
      section([twoTrackBar(first)], { id: "intro", name: "Giriş" }),
      section([twoTrackBar(second)], { id: "verse", name: "Kıta" }),
    ],
  );
}

const timeSelection = (
  sectionId: string,
  startTicks: number,
  endTicks: number,
  trackId = GTR,
) => ({ sectionId, trackId, startTicks, endTicks });

const describeTime = (
  source: Song,
  sectionId: string,
  from: number,
  to: number,
  trackId = GTR,
) => describeTimeSelection(source, timeSelection(sectionId, from, to, trackId));

describe("a note range becomes a bounded run of the song", () => {
  it("resolves the reader's ticks onto the transport's own timeline", () => {
    const source = twoSectionSong();
    /* Slots 0–7 of the *second* section: 0–384 in the section, 768–1152 in
       the song. A plan that returned the section's own numbers would be
       playing the first section's music. */
    const descriptor = describeTime(source, "verse", 0, 384);
    const result = planSelectionPlayback(source, descriptor, "once");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.startTicks).toBe(BAR);
    expect(result.plan.endTicks).toBe(BAR + 384);
  });

  it("plays only the track the range was drawn on", () => {
    const source = twoSectionSong();
    const descriptor = describeTime(source, "intro", 0, BAR, BASS);
    const result = planSelectionPlayback(source, descriptor, "once");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.trackIds).toEqual([BASS]);
  });

  it("carries the mode it was asked for", () => {
    const source = twoSectionSong();
    const descriptor = describeTime(source, "intro", 0, BAR);
    expect(planSelectionPlayback(source, descriptor, "once")).toMatchObject({
      ok: true,
      plan: { mode: "once" },
    });
    expect(planSelectionPlayback(source, descriptor, "loop")).toMatchObject({
      ok: true,
      plan: { mode: "loop" },
    });
  });
});

describe("a measure selection becomes the bars it names", () => {
  it("plays one instrument when one instrument's bars are held", () => {
    const source = twoSectionSong();
    const descriptor = describeBarSelection(source, {
      scope: "track",
      sectionId: "intro",
      trackId: GTR,
      startBarIndex: 0,
      endBarIndex: 0,
    });
    const result = planSelectionPlayback(source, descriptor, "once");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.trackIds).toEqual([GTR]);
    expect(result.plan.startTicks).toBe(0);
    expect(result.plan.endTicks).toBe(BAR);
  });

  it("plays every instrument when the whole measures are held", () => {
    const source = twoSectionSong();
    const descriptor = describeBarSelection(source, {
      scope: "full",
      sectionId: "verse",
      startBarIndex: 0,
      endBarIndex: 0,
    });
    const result = planSelectionPlayback(source, descriptor, "once");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.plan.trackIds].sort()).toEqual([BASS, GTR]);
    expect(result.plan.startTicks).toBe(BAR);
    expect(result.plan.endTicks).toBe(2 * BAR);
  });
});

describe("what cannot be played, and why", () => {
  it("refuses a selection holding nothing but rests", () => {
    const source = twoSectionSong();
    /* Slots 9–15 of the first bar: written, reachable, and silent. */
    const descriptor = describeTime(source, "intro", 9 * 48, BAR);
    const result = planSelectionPlayback(source, descriptor, "once");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_audible_notes");
  });

  it("refuses when there is no selection at all", () => {
    const source = twoSectionSong();
    const result = planSelectionPlayback(source, null, "once");
    expect(result).toEqual({ ok: false, reason: "no_selection" });
  });

  it("refuses a range of no length", () => {
    const source = twoSectionSong();
    const descriptor = describeTime(source, "intro", 0, 0);
    const result = planSelectionPlayback(source, descriptor, "once");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty_range");
  });

  it("refuses a section the song no longer has", () => {
    const source = twoSectionSong();
    const descriptor = describeTime(source, "intro", 0, BAR);
    if (!descriptor) throw new Error("fixture has no descriptor");
    const moved = { ...descriptor, sectionId: "gone" };
    const result = planSelectionPlayback(source, moved, "once");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown_section");
  });

  it("says why in the reader's own words, with no internal vocabulary", () => {
    expect(NO_AUDIBLE_NOTES).toBe("Bu seçimde dinlenecek nota yok.");
    /* No enum, tick, slot, schema or validator language reaches the screen. */
    expect(NO_AUDIBLE_NOTES).not.toMatch(
      /tick|slot|scope|descriptor|onset|track|schema|null|undefined/i,
    );
  });
});

describe("a drum-only selection", () => {
  it("plays, because a struck drum is an audible note", () => {
    const kit = drumTrack({ id: "drums" });
    const marks = silentDrumSlots(16);
    marks[0] = [{ piece: "kick" }];
    marks[8] = [{ piece: "snare" }];
    const source = song(
      [kit],
      [
        section(
          [
            {
              timeSignature: [4, 4],
              resolution: 16,
              slots: { drums: marks },
            },
          ],
          { id: "beat" },
        ),
      ],
    );
    const descriptor = describeBarSelection(source, {
      scope: "full",
      sectionId: "beat",
      startBarIndex: 0,
      endBarIndex: 0,
    });
    const result = planSelectionPlayback(source, descriptor, "once");
    expect(result.ok).toBe(true);
  });
});
