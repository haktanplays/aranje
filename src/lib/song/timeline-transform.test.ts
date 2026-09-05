/**
 * A moved bar line, and the two things written over it (2V-D.2 §14, §15).
 *
 * These tests are about the failure that leaves no trace: a phrase or a
 * technique span that still parses, still renders and still plays, and covers
 * different music than the reader wrote. Nothing throws. The only way to catch
 * it is to assert where the ends land.
 */
import { describe, expect, it } from "vitest";

import { PPQ } from "@/lib/music/timing";
import { changeTiming } from "@/lib/song/timing-change";
import { extentsOf, remapRange, remapTick } from "@/lib/song/timeline-transform";
import type { Song } from "@/lib/song/schema";
import { bar, REST, slots, song, TRACK_ID } from "@/test/move-fixtures";

const BAR = PPQ * 4;

/** Three 4/4 bars, the middle one about to become 3/4. */
const THREE = [
  { lengthTicks: BAR },
  { lengthTicks: BAR },
  { lengthTicks: BAR },
];
const SHORTENED = [
  { lengthTicks: BAR },
  { lengthTicks: PPQ * 3 },
  { lengthTicks: BAR },
];

describe("348. a tick keeps the music it was pointing at", () => {
  const before = extentsOf(THREE);
  const after = extentsOf(SHORTENED);

  it("leaves everything in front of the change alone", () => {
    for (const ticks of [0, PPQ, PPQ * 2, BAR - 1]) {
      expect(remapTick(ticks, before, after)).toEqual({ ok: true, ticks });
    }
  });

  it("keeps the offset inside the bar that changed", () => {
    /* Which is exactly what the note transform does: an onset at tick 384 of
       a bar is at tick 384 of it afterwards. If the phrase edge moved and the
       note did not, they would come apart. */
    expect(remapTick(BAR + PPQ, before, after)).toEqual({ ok: true, ticks: BAR + PPQ });
  });

  it("moves everything after it by exactly what the bar lost", () => {
    // Bar 3 started at 1536 and starts at 1344; a quarter note earlier.
    expect(remapTick(BAR * 2, before, after)).toEqual({ ok: true, ticks: BAR + PPQ * 3 });
    expect(remapTick(BAR * 3, before, after)).toEqual({
      ok: true,
      ticks: BAR + PPQ * 3 + BAR,
    });
  });

  it("puts a tick sitting on a bar line on the new bar line", () => {
    /* The boundary is not "inside" the bar it closes, and a phrase that ended
       where the bar ended still does. Landing it at the old offset would put
       it a beat into the next bar. */
    expect(remapTick(BAR * 2, before, after).ok).toBe(true);
  });

  it("refuses an offset the shorter bar no longer has", () => {
    /* Tick 1440 is three and a half beats into bar 2, which is now three
       beats long. There is no honest answer: clamping it to the new bar line
       makes the phrase shorter than the reader wrote it, and pushing it into
       bar 3 makes it cover music it never covered. */
    expect(remapTick(BAR + PPQ * 3 + PPQ / 2, before, after)).toEqual({
      ok: false,
      reason: "offset_beyond_new_bar",
    });
  });
});

describe("349. a range moves as one thing, or not at all", () => {
  const before = extentsOf(THREE);
  const after = extentsOf(SHORTENED);

  it("keeps a phrase that crosses three bars in one piece", () => {
    /* Never split at a grid boundary: a phrase spanning the change is still
       one phrase afterwards, with both ends moved by their own rule. */
    const moved = remapRange(
      { id: "p1", startTicks: PPQ, endTicks: BAR * 2 + PPQ },
      before,
      after,
    );
    expect(moved).toEqual({
      ok: true,
      range: { id: "p1", startTicks: PPQ, endTicks: BAR + PPQ * 3 + PPQ },
    });
  });

  it("carries every other field of the range untouched", () => {
    const moved = remapRange(
      { id: "sp", kind: "palm_mute", stringIndices: [4, 5], startTicks: 0, endTicks: PPQ },
      before,
      after,
    );
    expect(moved.ok && moved.range.kind).toBe("palm_mute");
    expect(moved.ok && moved.range.stringIndices).toEqual([4, 5]);
  });

  it("refuses rather than returning a range with nothing in it", () => {
    const collapsed = remapRange(
      { id: "p", startTicks: BAR + PPQ * 3, endTicks: BAR + PPQ * 3 + 1 },
      before,
      after,
    );
    expect(collapsed.ok).toBe(false);
  });
});

describe("350. the meter change carries phrases and spans with it", () => {
  /** Two 4/4 bars with a phrase and a span over the second one. */
  const withMarks = (): Song => {
    const base = song([bar(slots([REST])), bar(slots([REST]))]);
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        phrases: [{ id: "p1", startTicks: BAR, endTicks: BAR * 2 }],
        techniqueSpans: [
          {
            id: "sp1",
            kind: "palm_mute" as const,
            trackId: TRACK_ID,
            startTicks: BAR,
            endTicks: BAR * 2,
            stringIndices: [4, 5],
          },
        ],
      })),
    };
  };

  it("moves a phrase over a later bar when an earlier one shortens", () => {
    /*
     * The regression this file exists for. Bar 1 becomes 3/4, so bar 2 now
     * starts a beat earlier — and the phrase drawn over bar 2 has to start a
     * beat earlier with it, or it is a phrase over the last beat of bar 1 and
     * the first three of bar 2.
     */
    const result = changeTiming(withMarks(), {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [3, 4],
      resolution: 16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const section = result.song.sections[0]!;
    expect(section.phrases).toEqual([
      { id: "p1", startTicks: PPQ * 3, endTicks: PPQ * 3 + BAR },
    ]);
    expect(section.techniqueSpans?.[0]?.startTicks).toBe(PPQ * 3);
    expect(section.techniqueSpans?.[0]?.endTicks).toBe(PPQ * 3 + BAR);
  });

  it("keeps the span's identity, kind and strings across the move", () => {
    const result = changeTiming(withMarks(), {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [3, 4],
      resolution: 16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const span = result.song.sections[0]?.techniqueSpans?.[0];
    expect(span?.id).toBe("sp1");
    expect(span?.kind).toBe("palm_mute");
    expect(span?.stringIndices).toEqual([4, 5]);
  });

  it("changes nothing at all when a phrase cannot be moved exactly", () => {
    /* One refusal, whole song unchanged — not a section with the bars
       rewritten and the phrase left where it was. */
    const source = (): Song => {
      const base = song([bar(slots([REST])), bar(slots([REST]))]);
      return {
        ...base,
        sections: base.sections.map((section) => ({
          ...section,
          phrases: [{ id: "p1", startTicks: 0, endTicks: PPQ * 3 + PPQ / 2 }],
        })),
      };
    };
    const before = source();
    const result = changeTiming(before, {
      sectionId: "s1",
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: [3, 4],
      resolution: 16,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("content_exceeds_new_measure");
    expect(before).toEqual(source());
  });
});
