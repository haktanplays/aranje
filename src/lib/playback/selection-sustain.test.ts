/**
 * Selecting the middle of a held note (2V-B.2 §4).
 *
 * The founder's physical run reported that selection playback "only worked
 * under a narrow condition". Measured on the acceptance fixture, the narrow
 * condition was: the selection had to begin exactly on a struck onset.
 * Everything else — including the middle of the let-ring power chord that
 * opens the fixture — was refused as having nothing to hear.
 */
import { describe, expect, it } from "vitest";

import { editorFixture, EDITOR_LANDMARKS } from "@/lib/acceptance/editor-fixture";
import {
  planSelectionPlayback,
  sustainingEvents,
  windowEvents,
} from "@/lib/playback/selection-playback";
import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import type { Song } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

const SLOT = 48;
const BAR = 768;

const song: Song = editorFixture();
const sectionId = song.sections[0]!.id;

const range = (fromSlot: number, toSlot: number, trackId = "gtr"): TimeSelection =>
  ({
    sectionId,
    trackId,
    startTicks: fromSlot * SLOT,
    endTicks: toSlot * SLOT,
  }) as TimeSelection;

const planFor = (selection: TimeSelection) => {
  const descriptor = describeTimeSelection(song, selection);
  expect(descriptor).not.toBeNull();
  return planSelectionPlayback(song, descriptor, "once");
};

describe("the middle of a held chord is music", () => {
  it("plays a selection that contains no onset at all", () => {
    /*
     * Bar 1 opens with a strummed let-ring power chord written to ring for
     * eight slots. Slots 1-3 are inside it: three notes are sounding and not
     * one of them begins there. This is the exact shape that was refused.
     */
    const result = planFor(range(1, 4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.onsetCount).toBe(0);
    expect(result.plan.sustainCount).toBeGreaterThan(0);
  });

  it("still refuses a selection with genuinely nothing in it", () => {
    /* Bar 2 of the fixture is written empty on both instruments. Silence is
       still silence, and the reader is owed the refusal rather than a
       transport that starts and plays nothing. */
    const result = planFor(range(16, 32));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_audible_notes");
  });

  it("counts onsets and sustains separately", () => {
    /* Slots 2-6 hold the tail of the chord and the onset at slot 4. */
    const result = planFor(range(2, 7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.onsetCount).toBe(1);
    expect(result.plan.sustainCount).toBe(3);
  });

  it("does not count a note that had already finished", () => {
    /*
     * The chord is written for eight slots, so by slot 9 it has stopped. The
     * onset at slot 8 is what is heard there — nothing is carried in.
     */
    const held = EDITOR_LANDMARKS.heldPowerChord;
    expect(held).toBeTruthy();
    const sustaining = sustainingEvents(song, {
      startTicks: 9 * SLOT,
      endTicks: 12 * SLOT,
      trackIds: ["gtr"],
    });
    expect(sustaining).toHaveLength(0);
  });

  it("never counts a sustain from an unselected instrument", () => {
    /* Bar 5's bass note is written to ring; a guitar-only selection must not
       be kept alive by it, or "Bu enstrüman" would quietly play two. */
    const sustaining = sustainingEvents(song, {
      startTicks: 4 * BAR + 2 * SLOT,
      endTicks: 4 * BAR + 4 * SLOT,
      trackIds: ["gtr"],
    });
    for (const event of sustaining) expect(event.trackId).toBe("gtr");
  });

  it("keeps membership onset-based, so nothing is struck twice", () => {
    /*
     * The guarantee §3 bought and this change must not spend: the *scheduled*
     * events of a window that opens mid-chord still exclude that chord. It is
     * continued by the resume path, not re-triggered at the boundary.
     */
    const window = { startTicks: SLOT, endTicks: 4 * SLOT, trackIds: ["gtr"] };
    expect(windowEvents(song, window)).toHaveLength(0);
    expect(sustainingEvents(song, window).length).toBeGreaterThan(0);
  });
});

describe("what the two selection scopes play", () => {
  it("plays one instrument when one instrument is held", () => {
    const result = planFor(range(0, 16, "gtr"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.trackIds).toEqual(["gtr"]);
  });

  it("plays the bass when the bass is held", () => {
    const result = planFor(range(0, 16, "bass"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.trackIds).toEqual(["bass"]);
  });

  it("starts and ends exactly where the reader drew it", () => {
    const result = planFor(range(4, 12));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.startTicks).toBe(4 * SLOT);
    expect(result.plan.endTicks).toBe(12 * SLOT);
  });
});
