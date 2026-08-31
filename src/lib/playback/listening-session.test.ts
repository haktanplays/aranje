/**
 * A run belongs to the selection it was started for (2V-A §5, §8).
 */
import { describe, expect, it } from "vitest";

import {
  playbackSignature,
  shouldStopListening,
} from "@/lib/playback/listening-session";
import type { SelectionPlaybackPlan } from "@/lib/playback/selection-playback";

const plan = (
  over: Partial<SelectionPlaybackPlan> = {},
): SelectionPlaybackPlan => ({
  startTicks: 0,
  endTicks: 768,
  trackIds: ["gtr"],
  mode: "loop",
  onsetCount: 3,
  ...over,
});

describe("what identifies a run", () => {
  it("is the same for two selections that would sound identical", () => {
    expect(playbackSignature(plan())).toBe(playbackSignature(plan()));
    /* Mode is intent, not sound: the same music, heard two ways. */
    expect(playbackSignature(plan({ mode: "once" }))).toBe(
      playbackSignature(plan({ mode: "loop" })),
    );
  });

  it("does not depend on the order the tracks were listed in", () => {
    expect(playbackSignature(plan({ trackIds: ["gtr", "bass"] }))).toBe(
      playbackSignature(plan({ trackIds: ["bass", "gtr"] })),
    );
  });

  it("differs when the ticks or the instruments differ", () => {
    const base = playbackSignature(plan());
    expect(playbackSignature(plan({ startTicks: 48 }))).not.toBe(base);
    expect(playbackSignature(plan({ endTicks: 384 }))).not.toBe(base);
    expect(playbackSignature(plan({ trackIds: ["bass"] }))).not.toBe(base);
  });

  it("is nothing at all when nothing is playing", () => {
    expect(playbackSignature(null)).toBeNull();
  });
});

describe("when a run has to stop", () => {
  it("stops when the selection is cancelled", () => {
    expect(shouldStopListening(plan(), null)).toBe(true);
  });

  it("stops when another selection is drawn", () => {
    expect(shouldStopListening(plan(), plan({ startTicks: 768, endTicks: 1536 })))
      .toBe(true);
  });

  it("stops when the instrument changes under it", () => {
    expect(shouldStopListening(plan(), plan({ trackIds: ["bass"] }))).toBe(true);
  });

  it("keeps going while the same music is still selected", () => {
    expect(shouldStopListening(plan(), plan())).toBe(false);
  });

  it("has nothing to say when nothing is playing", () => {
    /* So a cleanup can be run on every render without asking first. */
    expect(shouldStopListening(null, null)).toBe(false);
    expect(shouldStopListening(null, plan())).toBe(false);
  });
});
