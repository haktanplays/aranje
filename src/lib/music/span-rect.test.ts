/**
 * The arithmetic every span edit stands on (2V-D.1-C §3).
 *
 * Copy, move, repeat, delete and transpose all reduce to two questions about
 * a rectangle, so those two questions get tested here once, hard, instead of
 * five times each and slightly differently. The table below walks the shapes
 * a selection and a span can be in — full coverage, partial time, partial
 * strings, several strings, a range that only touches, and no meeting at all
 * — and the property tests then say the things that must hold for *every*
 * pair, not only the six that occurred to me.
 *
 * The section-boundary cases are here rather than in a store test on purpose:
 * a span may not cross a section, and the place that rule is actually decided
 * is `clipToSection` and `splitAcrossSections`.
 */
import { describe, expect, it } from "vitest";

import {
  clipToSection,
  copyId,
  fragmentId,
  intersect,
  normalize,
  rectOf,
  remapStrings,
  splitAcrossSections,
  subtract,
  translate,
  validate,
  withRect,
  type SpanRect,
} from "@/lib/music/span-rect";
import type { TechniqueSpan } from "@/lib/song/schema";

const rect = (
  startTicks: number,
  endTicks: number,
  stringIndices: readonly number[],
): SpanRect => ({ startTicks, endTicks, stringIndices });

const span = (over: Partial<TechniqueSpan> = {}): TechniqueSpan => ({
  id: "s1",
  kind: "palm_mute",
  trackId: "gtr",
  startTicks: 0,
  endTicks: 768,
  stringIndices: [4, 5],
  ...over,
});

/** A whole track: six strings, one bar. The span under test lives inside it. */
const BAR = 768;
const ALL_STRINGS = [0, 1, 2, 3, 4, 5];

describe("318. the six shapes a selection and a span can be in", () => {
  const target = rect(192, 576, [3, 4, 5]);

  const cases: readonly {
    readonly name: string;
    readonly selection: SpanRect;
    readonly meeting: SpanRect | null;
    /** What survives the selection being deleted. */
    readonly left: readonly SpanRect[];
  }[] = [
    {
      name: "full coverage: the selection swallows the span",
      selection: rect(0, BAR, ALL_STRINGS),
      meeting: rect(192, 576, [3, 4, 5]),
      left: [],
    },
    {
      name: "partial time: the same strings, only the first half",
      selection: rect(0, 384, ALL_STRINGS),
      meeting: rect(192, 384, [3, 4, 5]),
      left: [rect(384, 576, [3, 4, 5])],
    },
    {
      name: "partial strings: the whole time, one string of three",
      selection: rect(0, BAR, [4]),
      meeting: rect(192, 576, [4]),
      left: [rect(192, 576, [3, 5])],
    },
    {
      name: "multi-string and mid-time: a hole in the middle",
      selection: rect(288, 384, [4, 5]),
      meeting: rect(288, 384, [4, 5]),
      left: [rect(192, 576, [3]), rect(192, 288, [4, 5]), rect(384, 576, [4, 5])],
    },
    {
      name: "adjacent range: it ends exactly where the span begins",
      selection: rect(0, 192, [3, 4, 5]),
      meeting: null,
      left: [rect(192, 576, [3, 4, 5])],
    },
    {
      name: "empty intersection: right time, wrong strings",
      selection: rect(192, 576, [0, 1]),
      meeting: null,
      left: [rect(192, 576, [3, 4, 5])],
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      expect(intersect(target, entry.selection)).toEqual(entry.meeting);
      expect(normalize(subtract(target, entry.selection))).toEqual(
        normalize(entry.left),
      );
    });
  }

  it("meets the same way round either way", () => {
    for (const entry of cases) {
      const forward = intersect(target, entry.selection);
      const back = intersect(entry.selection, target);
      expect(back).toEqual(forward);
    }
  });
});

describe("319. what subtraction is not allowed to lose", () => {
  /* A deterministic sweep, not a random one: a property test that picks its
     own numbers cannot be re-read when it fails. */
  const corners = [0, 96, 192, 288, 384, 576, BAR];
  const stringSets: readonly number[][] = [[0], [3], [3, 4], [4, 5], [0, 3, 5], ALL_STRINGS];

  const pairs = (): readonly { a: SpanRect; b: SpanRect }[] => {
    const out: { a: SpanRect; b: SpanRect }[] = [];
    for (const aStart of corners) {
      for (const aEnd of corners) {
        if (aEnd <= aStart) continue;
        for (const bStart of corners) {
          for (const bEnd of corners) {
            if (bEnd <= bStart) continue;
            for (const aStrings of stringSets) {
              for (const bStrings of stringSets) {
                out.push({
                  a: rect(aStart, aEnd, aStrings),
                  b: rect(bStart, bEnd, bStrings),
                });
              }
            }
          }
        }
      }
    }
    return out;
  };

  /** Every (tick, string) cell a rectangle set covers, at slot resolution. */
  const cells = (rects: readonly SpanRect[]): Set<string> => {
    const out = new Set<string>();
    for (const one of rects) {
      for (let tick = one.startTicks; tick < one.endTicks; tick += 96) {
        for (const stringIndex of one.stringIndices) {
          out.add(`${tick}:${stringIndex}`);
        }
      }
    }
    return out;
  };

  const all = pairs();

  it("sweeps a real number of pairs, so a pass means something", () => {
    expect(all.length).toBeGreaterThan(2000);
  });

  it("leaves exactly the cells the selection did not take", () => {
    for (const { a, b } of all) {
      const kept = cells(subtract(a, b));
      const taken = cells([intersect(a, b)].filter((one): one is SpanRect => one !== null));
      const whole = cells([a]);
      const expected = new Set([...whole].filter((cell) => !taken.has(cell)));
      expect([...kept].sort()).toEqual([...expected].sort());
    }
  });

  it("never invents a cell the span did not have", () => {
    for (const { a, b } of all) {
      const whole = cells([a]);
      for (const cell of cells(subtract(a, b))) {
        expect(whole.has(cell)).toBe(true);
      }
    }
  });

  it("returns the span untouched when nothing was taken", () => {
    for (const { a, b } of all) {
      if (intersect(a, b) !== null) continue;
      expect(subtract(a, b)).toEqual([a]);
    }
  });

  it("returns pieces that are each a real rectangle", () => {
    for (const { a, b } of all) {
      for (const piece of subtract(a, b)) {
        expect(piece.endTicks).toBeGreaterThan(piece.startTicks);
        expect(piece.stringIndices.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("320. moving a rectangle without changing its size", () => {
  it("slides in time and keeps its strings", () => {
    const moved = translate(rect(192, 576, [4, 5]), 768);
    expect(moved).toEqual(rect(960, 1344, [4, 5]));
  });

  it("comes back to where it started", () => {
    const start = rect(192, 576, [4, 5]);
    expect(translate(translate(start, 480), -480)).toEqual(start);
  });

  it("keeps its length however far it goes", () => {
    for (const by of [-192, -96, 0, 96, 768, 3072]) {
      const moved = translate(rect(192, 576, [4]), by);
      expect(moved.endTicks - moved.startTicks).toBe(384);
    }
  });

  it("moves onto other strings when every string has somewhere to go", () => {
    const moved = remapStrings(rect(0, 768, [4, 5]), (index) => index - 2);
    expect(moved).toEqual(rect(0, 768, [2, 3]));
  });

  it("refuses rather than quietly covering fewer strings", () => {
    const off = remapStrings(rect(0, 768, [0, 1]), (index) => (index === 0 ? null : 1));
    expect(off).toBeNull();
  });

  it("refuses when two strings would land on one", () => {
    const collapsed = remapStrings(rect(0, 768, [3, 4]), () => 5);
    expect(collapsed).toBeNull();
  });
});

describe("321. a span stops at the section line", () => {
  it("trims a range that runs past the end", () => {
    expect(clipToSection(rect(576, 1152, [5]), BAR)).toEqual(rect(576, BAR, [5]));
  });

  it("keeps a range that already fits, byte for byte", () => {
    const inside = rect(0, BAR, [4, 5]);
    expect(clipToSection(inside, BAR)).toEqual(inside);
  });

  it("gives back nothing when the range starts after the section ends", () => {
    expect(clipToSection(rect(BAR, 1152, [5]), BAR)).toBeNull();
  });

  it("treats the section end as outside, not inside", () => {
    expect(clipToSection(rect(BAR, BAR + 96, [5]), BAR)).toBeNull();
    expect(clipToSection(rect(BAR - 96, BAR, [5]), BAR)).toEqual(rect(BAR - 96, BAR, [5]));
  });

  it("cuts a crossing selection into one piece per section, each addressed locally", () => {
    const sections = [
      { sectionId: "a", startTicks: 0, lengthTicks: BAR },
      { sectionId: "b", startTicks: BAR, lengthTicks: BAR },
      { sectionId: "c", startTicks: BAR * 2, lengthTicks: BAR },
    ];
    const pieces = splitAcrossSections(rect(576, BAR * 2 + 192, [4, 5]), sections);
    expect(pieces).toEqual([
      { sectionId: "a", rect: rect(576, BAR, [4, 5]) },
      { sectionId: "b", rect: rect(0, BAR, [4, 5]) },
      { sectionId: "c", rect: rect(0, 192, [4, 5]) },
    ]);
  });

  it("skips the sections it does not reach", () => {
    const sections = [
      { sectionId: "a", startTicks: 0, lengthTicks: BAR },
      { sectionId: "b", startTicks: BAR, lengthTicks: BAR },
    ];
    const pieces = splitAcrossSections(rect(0, 192, [5]), sections);
    expect(pieces.map((piece) => piece.sectionId)).toEqual(["a"]);
  });

  it("loses no time when it splits", () => {
    const sections = [
      { sectionId: "a", startTicks: 0, lengthTicks: BAR },
      { sectionId: "b", startTicks: BAR, lengthTicks: BAR },
      { sectionId: "c", startTicks: BAR * 2, lengthTicks: BAR },
    ];
    for (const start of [0, 96, 576, BAR, BAR + 384]) {
      for (const end of [192, BAR, BAR + 96, BAR * 3]) {
        if (end <= start) continue;
        const pieces = splitAcrossSections(rect(start, end, [4]), sections);
        const total = pieces.reduce(
          (sum, piece) => sum + (piece.rect.endTicks - piece.rect.startTicks),
          0,
        );
        expect(total).toBe(Math.min(end, BAR * 3) - start);
      }
    }
  });
});

describe("322. the canonical form of a set of rectangles", () => {
  it("sorts by time so two runs of one command write the same bytes", () => {
    const out = normalize([rect(576, BAR, [5]), rect(0, 192, [5]), rect(192, 576, [5])]);
    expect(out.map((one) => one.startTicks)).toEqual([0, 192, 576]);
  });

  it("drops an exact repeat", () => {
    expect(normalize([rect(0, 192, [5, 4]), rect(0, 192, [4, 5])])).toEqual([
      rect(0, 192, [4, 5]),
    ]);
  });

  it("drops a rectangle with no time or no strings in it", () => {
    expect(normalize([rect(192, 192, [5]), rect(0, 192, [])])).toEqual([]);
  });

  it("does not merge two neighbours into one", () => {
    /* They are two spans because the reader wrote two, and one of them is the
       one they will move next. */
    const out = normalize([rect(0, 192, [5]), rect(192, 384, [5])]);
    expect(out).toHaveLength(2);
  });

  it("sorts the strings inside each rectangle too", () => {
    expect(normalize([rect(0, 192, [5, 3, 4])])[0]?.stringIndices).toEqual([3, 4, 5]);
  });
});

describe("323. what makes a span wrong, and what does not", () => {
  const owner = { sectionTicks: BAR, stringCount: 6 };

  it("accepts a span with no notes under it", () => {
    /* The whole point of the header: a technique mark over a rest is a mark
       over a rest, not litter. `validate` never asks about notes at all. */
    expect(validate(span(), owner)).toBeNull();
  });

  it("names a missing track or section", () => {
    expect(validate(span(), { sectionTicks: null, stringCount: 6 })).toBe("no_such_owner");
    expect(validate(span(), { sectionTicks: BAR, stringCount: null })).toBe("no_such_owner");
  });

  it("names a range with no time in it", () => {
    expect(validate(span({ startTicks: 192, endTicks: 192 }), owner)).toBe("empty_range");
    expect(validate(span({ startTicks: 384, endTicks: 192 }), owner)).toBe("empty_range");
  });

  it("names a string the instrument does not have", () => {
    expect(validate(span({ stringIndices: [6] }), owner)).toBe("bad_strings");
    expect(validate(span({ stringIndices: [-1] }), owner)).toBe("bad_strings");
    expect(validate(span({ stringIndices: [] }), owner)).toBe("bad_strings");
    expect(validate(span({ stringIndices: [4, 4] }), owner)).toBe("bad_strings");
  });

  it("names a span that reaches past its section", () => {
    expect(validate(span({ endTicks: BAR + 1 }), owner)).toBe("crosses_section");
    expect(validate(span({ startTicks: -96, endTicks: 192 }), owner)).toBe("crosses_section");
  });

  it("accepts a span that ends exactly on the section line", () => {
    expect(validate(span({ startTicks: 0, endTicks: BAR }), owner)).toBeNull();
  });
});

describe("324. which span a fragment is, and which one it is not", () => {
  it("keeps the reader's span alive in the first piece", () => {
    expect(fragmentId(span({ id: "pm-1" }), 0)).toBe("pm-1");
  });

  it("derives the rest, and derives them the same way twice", () => {
    const one = span({ id: "pm-1" });
    expect(fragmentId(one, 1)).toBe("pm-1~1");
    expect(fragmentId(one, 1)).toBe(fragmentId(one, 1));
    expect(fragmentId(one, 2)).not.toBe(fragmentId(one, 1));
  });

  it("gives a copy a new identity, not the original's", () => {
    const one = span({ id: "pm-1" });
    const copied = copyId(one, "b2", 0);
    expect(copied).not.toBe(one.id);
    expect(copyId(one, "b2", 0)).toBe(copied);
    expect(copyId(one, "b3", 0)).not.toBe(copied);
  });

  it("keeps two copies of one span apart", () => {
    const one = span({ id: "pm-1" });
    expect(copyId(one, "b2", 1)).not.toBe(copyId(one, "b2", 0));
  });
});

describe("325. putting a rectangle back on a span", () => {
  it("changes the geometry and nothing else", () => {
    const before = span({ id: "pm-1", kind: "let_ring", trackId: "gtr-2" });
    const after = withRect(before, rect(192, 384, [1, 2]), "pm-1~1");
    expect(after).toEqual({
      id: "pm-1~1",
      kind: "let_ring",
      trackId: "gtr-2",
      startTicks: 192,
      endTicks: 384,
      stringIndices: [1, 2],
    });
  });

  it("round-trips through its own rectangle", () => {
    const before = span({ id: "pm-1" });
    expect(withRect(before, rectOf(before), before.id)).toEqual(before);
  });

  it("copies the strings rather than sharing them", () => {
    const source = rect(0, 192, [4, 5]);
    const after = withRect(span(), source, "x");
    expect(after.stringIndices).not.toBe(source.stringIndices);
  });
});
