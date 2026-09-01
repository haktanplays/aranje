/**
 * The drawer and the engine give the same answer (2V-A §2, §8.25).
 *
 * §2: the capability check has to be right *before* the drawer opens. A verb
 * offered and then refused by the core is the defect this pairing exists to
 * make impossible, so the two are asserted against each other rather than each
 * against its own expectation.
 */
import { describe, expect, it } from "vitest";

import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import { hasExtendTarget } from "@/lib/song/selection-extend";
import {
  canRun,
  refusalFor,
  selectionCapabilities,
} from "@/lib/song/selection-capability";
import {
  NO_AUDIBLE_NOTES,
  hasAudibleNotes,
  planSelectionPlayback,
} from "@/lib/playback/selection-playback";
import { guitarTrack, restSlots, section, song } from "@/lib/song/fixtures";
import type { SelectionDescriptor } from "@/lib/song/selection-descriptor";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const GTR = "gtr";
const BASS = "bass";
const BAR = 768;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

function twoTrackBar(slots: readonly MelodicSlot[]): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: [...slots], [BASS]: [...slots] },
  };
}

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

const describeTime = (
  source: Song,
  sectionId: string,
  from: number,
  to: number,
  trackId = GTR,
) =>
  describeTimeSelection(source, { sectionId, trackId, startTicks: from, endTicks: to });

describe("the drawer and the engine give the same answer", () => {
  /**
   * §2: the capability check has to be right *before* the drawer opens. A
   * verb offered and then refused by the core is the defect this pairing
   * exists to make impossible, so the two are asserted against each other
   * rather than each against its own expectation.
   */
  const contextFor = (source: Song, descriptor: SelectionDescriptor) => ({
    hasClipboard: false,
    clipboardScope: null,
    sectionBarCount: 1,
    hasAudibleNotes: hasAudibleNotes(source, descriptor),
    /* Asked of the same section, so the sweep below covers the real answer. */
    hasExtendTarget: hasExtendTarget(source, descriptor),
  });

  it("agrees on a selection with notes in it", () => {
    const source = twoSectionSong();
    const descriptor = describeTime(source, "intro", 0, BAR);
    if (!descriptor) throw new Error("fixture has no descriptor");
    const offers = selectionCapabilities(descriptor, contextFor(source, descriptor));

    expect(canRun(offers, "audition")).toBe(true);
    expect(canRun(offers, "loop_selection")).toBe(true);
    expect(planSelectionPlayback(source, descriptor, "once").ok).toBe(true);
  });

  it("agrees on a selection with none, and says the same sentence", () => {
    const source = twoSectionSong();
    const descriptor = describeTime(source, "intro", 9 * 48, BAR);
    if (!descriptor) throw new Error("fixture has no descriptor");
    const offers = selectionCapabilities(descriptor, contextFor(source, descriptor));

    expect(canRun(offers, "audition")).toBe(false);
    expect(refusalFor(offers, "audition")).toBe(NO_AUDIBLE_NOTES);
    expect(refusalFor(offers, "loop_selection")).toBe(NO_AUDIBLE_NOTES);
    expect(planSelectionPlayback(source, descriptor, "once").ok).toBe(false);
  });

  it("never offers what the plan would refuse, on any selection", () => {
    /*
     * The invariant behind the two cases above, swept over every range in a
     * bar. One of these is the empty-range edge, one is silent, the rest have
     * notes — and every one of them must have the drawer and the plan saying
     * the same thing.
     */
    const source = twoSectionSong();
    for (let from = 0; from <= 16; from += 1) {
      for (let to = from; to <= 16; to += 1) {
        const descriptor = describeTime(source, "intro", from * 48, to * 48);
        if (!descriptor) continue;
        const offers = selectionCapabilities(descriptor, contextFor(source, descriptor));
        const planned = planSelectionPlayback(source, descriptor, "once");
        expect(canRun(offers, "audition"), `${from}..${to}`).toBe(planned.ok);
        expect(canRun(offers, "loop_selection"), `${from}..${to}`).toBe(
          planned.ok,
        );
      }
    }
  });
});
