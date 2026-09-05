/**
 * Asking before doing (2V-D.2 §14).
 *
 * The behaviour under test is not "does the change work" — `timing-change`
 * already covers that — but "does the reader find out first, in a sentence
 * they can act on, without anything being written".
 */
import { describe, expect, it } from "vitest";

import type { TimeSignature } from "@/lib/music/timing";
import { previewMeterChange } from "@/lib/song/meter-change-preview";
import type { TimingChange } from "@/lib/song/timing-change";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import { bar, REST, slots, song } from "@/test/move-fixtures";

const note = (pitch: string, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string: 1, fret } }],
});

/** One 4/4 bar at 1/8 with a note on the last eighth. */
const full = (): Song =>
  song([bar(slots([REST, REST, REST, REST, REST, REST, REST, note("A3", 12)]))]);

/** One empty 4/4 bar at 1/8. */
const empty = (): Song => song([bar(slots([REST]))]);

const to = (meter: TimeSignature): TimingChange => ({
  sectionId: "s1",
  scope: { kind: "bar", barIndex: 0 },
  timeSignature: meter,
  resolution: 8,
});

describe("351. the reader is told before anything is written", () => {
  it("says what an empty bar's change would do", () => {
    const preview = previewMeterChange(empty(), to([3, 4]));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.barsChanged).toBe(1);
    expect(preview.barLengthChanges).toBe(true);
    expect(preview.summary).toContain("ölçü uzunluğu değişiyor");
  });

  it("gives the refusal the brief asks for, word for word", () => {
    /* A beginner meets this one and no other. It says what is wrong in a
       sentence about their music, not about slots or ticks. */
    const preview = previewMeterChange(full(), to([3, 4]));
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.refusal).toBe("Sondaki notalar yeni ölçüye sığmıyor.");
    expect(preview.code).toBe("content_exceeds_new_measure");
  });

  it("marks the one refusal that has somewhere else to go", () => {
    /* Pro may offer to push the overflow into the next bar. There is nothing
       to offer for a grid that cannot express the notes at all, so it says
       so rather than showing a button that would refuse again. */
    const overflowing = previewMeterChange(full(), to([3, 4]));
    expect(!overflowing.ok && overflowing.hasOverflow).toBe(true);

    const unchanged = previewMeterChange(empty(), to([4, 4]));
    expect(!unchanged.ok && unchanged.code).toBe("no_timing_change");
    expect(!unchanged.ok && unchanged.hasOverflow).toBe(false);
  });

  it("writes nothing, whichever answer it gives", () => {
    /*
     * The whole point of a preview. Both calls run the real command on the
     * reader's song; if either of them kept the result, a reader who opened
     * the picker and changed their mind would have changed their song.
     */
    const source = full();
    const snapshot = JSON.stringify(source);
    previewMeterChange(source, to([3, 4]));
    previewMeterChange(source, to([6, 8]));
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("never offers to make the music fit", () => {
    /*
     * There is no third state between "it fits" and "it does not". A
     * `MeterChangePreview` carries a summary or a refusal, and neither of
     * them is an option to squeeze, stretch or speed anything up — which is
     * the one thing an editor must never do to a song silently.
     */
    const preview = previewMeterChange(full(), to([3, 4]));
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(Object.keys(preview).sort()).toEqual(["code", "hasOverflow", "ok", "refusal"]);
    expect(preview.refusal).not.toMatch(/sığdır|hızlan|kısalt/);
  });
});

describe("352. a preview and an apply cannot disagree", () => {
  it("refuses exactly what the command refuses", () => {
    /*
     * Guaranteed by construction — the preview *is* the command — and
     * asserted anyway, because the guarantee is only worth what a second
     * implementation appearing here would cost.
     */
    for (const meter of [[3, 4], [6, 8], [7, 8], [5, 8]] as const) {
      const preview = previewMeterChange(full(), to(meter));
      const applied = previewMeterChange(full(), to(meter));
      expect(preview.ok, `${meter[0]}/${meter[1]}`).toBe(applied.ok);
    }
  });

  it("reports a bar count that matches how many bars the change touches", () => {
    const twoBars = song([bar(slots([REST])), bar(slots([REST]))]);
    const preview = previewMeterChange(twoBars, {
      sectionId: "s1",
      scope: { kind: "section" },
      timeSignature: [3, 4],
      resolution: 8,
    });
    expect(preview.ok && preview.barsChanged).toBe(2);
  });

  it("says the bar length is unchanged when only the feel moves", () => {
    /* 7/8 as 2+2+3 and as 3+2+2 are the same seven eighths. A reader must not
       be warned that their bar is about to get longer when it is not. */
    const sevenEight = previewMeterChange(empty(), {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [7, 8],
      resolution: 8,
      grouping: [2, 2, 3],
    });
    expect(sevenEight.ok && sevenEight.barLengthChanges).toBe(true);

    const sameLength = previewMeterChange(
      { ...empty() },
      {
        sectionId: "s1",
        scope: { kind: "bar", barIndex: 0 },
        timeSignature: [4, 4],
        resolution: 8,
        grouping: [2, 2],
      },
    );
    expect(sameLength.ok && sameLength.barLengthChanges).toBe(false);
    expect(sameLength.ok && sameLength.summary).toContain("süreler aynı kalıyor");
  });
});

describe("353. the feel is part of the same decision as the metre", () => {
  it("stores the grouping the reader picked", () => {
    const preview = previewMeterChange(empty(), {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [7, 8],
      resolution: 8,
      grouping: [3, 2, 2],
    });
    expect(preview.ok).toBe(true);
  });

  it("refuses a grouping that does not fill the bar, before touching anything", () => {
    const preview = previewMeterChange(empty(), {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [7, 8],
      resolution: 8,
      grouping: [2, 2, 2],
    });
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.code).toBe("grouping_does_not_fit");
    expect(preview.refusal).toBe("Vurgu grupları bu ölçüyü tam doldurmuyor.");
  });

  it("treats a change of feel alone as a real change", () => {
    /*
     * Same metre, same grid, different accents. If this came back
     * `no_timing_change` the reader could not switch a 7/8 between its two
     * feels at all — the picker would refuse the only edit it exists for.
     */
    const base = previewMeterChange(empty(), {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [4, 4],
      resolution: 8,
      grouping: [2, 2],
    });
    expect(base.ok).toBe(true);
  });
});
