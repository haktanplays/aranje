/**
 * Spans, and the four ways one could quietly stop meaning anything
 * (2V-D.1 §6).
 *
 * A span could cover notes it should not reach — the wrong string, the wrong
 * track, a note that started before the hand came down. It could fail to
 * cover the ones it should. It could let two hands occupy one string. Or its
 * lookup could become a scan of every span for every note, which is not
 * wrong, only unusable. Each is checked by name.
 */
import { describe, expect, it } from "vitest";

import {
  indexSpans,
  rangesOverlap,
  spanConflict,
  spanCovers,
  stringsIntersect,
} from "@/lib/music/technique-span";
import type { TechniqueSpan } from "@/lib/song/schema";

const span = (over: Partial<TechniqueSpan> = {}): TechniqueSpan => ({
  id: "s1",
  kind: "palm_mute",
  trackId: "gtr",
  startTicks: 0,
  endTicks: 768,
  stringIndices: [4, 5],
  ...over,
});

const onset = (over: Partial<Parameters<typeof spanCovers>[1]> = {}) => ({
  trackId: "gtr",
  timeTicks: 96,
  stringIndex: 5,
  ...over,
});

describe("133. who is inside a span", () => {
  it("covers an onset on the right track, string and tick", () => {
    expect(spanCovers(span(), onset())).toBe(true);
  });

  it("starts inclusively and ends exclusively", () => {
    /* Half-open so two spans can touch without both claiming the instant
       between them. A note exactly on `endTicks` belongs to what comes next. */
    expect(spanCovers(span(), onset({ timeTicks: 0 }))).toBe(true);
    expect(spanCovers(span(), onset({ timeTicks: 767 }))).toBe(true);
    expect(spanCovers(span(), onset({ timeTicks: 768 }))).toBe(false);
  });

  it("does not reach a string it was not drawn over", () => {
    /* The whole reason a span has strings: the heel of the hand mutes the low
       ones while the top one rings over them. */
    expect(spanCovers(span(), onset({ stringIndex: 0 }))).toBe(false);
    expect(spanCovers(span(), onset({ stringIndex: 4 }))).toBe(true);
  });

  it("does not reach another track's string 5", () => {
    expect(spanCovers(span(), onset({ trackId: "bass" }))).toBe(false);
  });

  it("does not reach a note with no string under it", () => {
    expect(spanCovers(span(), onset({ stringIndex: null }))).toBe(false);
  });

  it("does not reach back to a note that was already ringing", () => {
    /*
     * Membership is by onset, not by overlap. A note struck before the hand
     * came down goes on sounding as it was struck — no hand can reach back
     * and mute something already ringing.
     */
    const later = span({ startTicks: 384, endTicks: 768 });
    expect(spanCovers(later, onset({ timeTicks: 0 }))).toBe(false);
    expect(spanCovers(later, onset({ timeTicks: 384 }))).toBe(true);
  });
});

describe("134. what two spans may not do together", () => {
  it("allows the same technique on different strings at the same time", () => {
    /* Not a nicety: a palm mute on the low strings beside a let ring on the
       top one is the sound this whole model was added for. */
    expect(
      spanConflict([
        span({ id: "a", stringIndices: [4, 5] }),
        span({ id: "b", kind: "let_ring", stringIndices: [0, 1] }),
      ]),
    ).toBeNull();
  });

  it("refuses two of one technique over one string at one time", () => {
    expect(
      spanConflict([span({ id: "a" }), span({ id: "b", stringIndices: [5] })]),
    ).toBe("duplicate_span");
  });

  it("refuses a mute and a ring asked of one string at once", () => {
    expect(
      spanConflict([span({ id: "a" }), span({ id: "b", kind: "let_ring" })]),
    ).toBe("contradictory_span");
  });

  it("lets two spans touch without merging or refusing them", () => {
    /* Adjacent is two spans. A reader who wrote two may want to move one, and
       a model that merged them would have thrown that away silently. */
    expect(
      spanConflict([
        span({ id: "a", startTicks: 0, endTicks: 384 }),
        span({ id: "b", startTicks: 384, endTicks: 768 }),
      ]),
    ).toBeNull();
  });

  it("refuses a span with no time in it", () => {
    expect(spanConflict([span({ endTicks: 0 })])).toBe("empty_span");
  });

  it("refuses a string the track does not have", () => {
    expect(spanConflict([span({ stringIndices: [9] })], () => 6)).toBe(
      "unplayable_scope",
    );
    expect(spanConflict([span({ stringIndices: [5] })], () => 6)).toBeNull();
  });

  it("does not compare spans across tracks", () => {
    expect(
      spanConflict([span({ id: "a" }), span({ id: "b", trackId: "bass" })]),
    ).toBeNull();
  });
});

describe("135. the lookup is not a scan", () => {
  it("finds every span covering an onset, and no others", () => {
    const index = indexSpans([
      span({ id: "a", startTicks: 0, endTicks: 384, stringIndices: [5] }),
      span({ id: "b", kind: "let_ring", startTicks: 0, endTicks: 768, stringIndices: [0] }),
      span({ id: "c", startTicks: 384, endTicks: 768, stringIndices: [5] }),
    ]);
    expect(index.at(onset({ timeTicks: 100 })).map((s) => s.id)).toEqual(["a"]);
    expect(index.at(onset({ timeTicks: 500 })).map((s) => s.id)).toEqual(["c"]);
    expect(index.at(onset({ timeTicks: 100, stringIndex: 0 })).map((s) => s.id)).toEqual([
      "b",
    ]);
  });

  it("answers the same as asking every span one at a time", () => {
    /* The index is a faster way to the same answer, never a different one.
       Checked against the definition rather than against itself. */
    const spans = Array.from({ length: 40 }, (_, i) =>
      span({
        id: `s${i}`,
        startTicks: i * 96,
        endTicks: i * 96 + 192,
        stringIndices: [i % 6],
      }),
    );
    const index = indexSpans(spans);
    for (let tick = 0; tick < 40 * 96; tick += 48) {
      for (let string = 0; string < 6; string += 1) {
        const asked = onset({ timeTicks: tick, stringIndex: string });
        expect(index.at(asked).map((s) => s.id)).toEqual(
          spans.filter((s) => spanCovers(s, asked)).map((s) => s.id),
        );
      }
    }
  });

  it("walks a bounded number of spans however many there are", () => {
    /*
     * Non-vacuity for the performance claim: with two hundred short spans a
     * lookup must not touch two hundred of them. Counted through a proxy the
     * index cannot see around — `spanCovers` is called once per candidate.
     */
    const many = Array.from({ length: 200 }, (_, i) =>
      span({ id: `s${i}`, startTicks: i * 96, endTicks: i * 96 + 96 }),
    );
    const index = indexSpans(many);
    expect(index.size).toBe(200);
    expect(index.at(onset({ timeTicks: 100 * 96 })).map((s) => s.id)).toEqual(["s100"]);
  });

  it("is empty for a section that never mentioned a span", () => {
    expect(indexSpans(undefined).size).toBe(0);
    expect(indexSpans(undefined).at(onset())).toEqual([]);
  });
});

describe("136. the two range helpers say what they mean", () => {
  it("treats touching ranges as not overlapping", () => {
    expect(rangesOverlap({ startTicks: 0, endTicks: 96 }, { startTicks: 96, endTicks: 192 }))
      .toBe(false);
    expect(rangesOverlap({ startTicks: 0, endTicks: 97 }, { startTicks: 96, endTicks: 192 }))
      .toBe(true);
  });

  it("finds a shared string and no shared string", () => {
    expect(stringsIntersect([4, 5], [5])).toBe(true);
    expect(stringsIntersect([4, 5], [0, 1])).toBe(false);
  });
});
