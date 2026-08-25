/**
 * What a practice loop's edges cut (2R-A §10, §17).
 *
 * The failure this guards against is quiet by nature. A loop whose start
 * lands inside a held note does not error; it just plays a sound that begins
 * out of nowhere, on every pass, while the reader practises against it. So
 * the tests below are all shaped the same way: build a real chain, put an
 * edge through it, and check the reading names what is actually there.
 *
 * The negative claim matters as much as the positive ones. Nothing here is
 * allowed to widen a range: the offer is computed and returned, and the range
 * the reader set stays the range they set.
 */
import { describe, expect, it } from "vitest";

import { practiceRange, type PracticeRange } from "@/lib/practice/range";
import { rangePreflight } from "@/lib/practice/range-preflight";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";

/*
 * Pitches are scientific names, not fret coordinates — the first draft of
 * this file used `{ string, fret }` and vitest was happy with it because a
 * fixture is not schema-parsed. `tsc` was not, which is the reason both run.
 */
const PITCHES = ["E2", "A2", "D3", "G3", "B3", "E4", "A4", "D5", "G5", "B5"] as const;
const pitchAt = (step: number): string => PITCHES[step % PITCHES.length]!;

const NOTE = (step: number): MelodicSlot => ({ notes: [{ pitch: pitchAt(step) }] });
const SLIDE = (step: number): MelodicSlot => ({
  notes: [{ pitch: pitchAt(step), articulation: "slide" }],
});
const HAMMER = (step: number): MelodicSlot => ({
  notes: [{ pitch: pitchAt(step), articulation: "hammer_on" }],
});
const TIE: MelodicSlot = "-";
const REST: MelodicSlot = null;

/** A section of 4/4 bars at 1/8, written out slot by slot. */
const sectionOf = (bars: readonly (readonly MelodicSlot[])[], id = "one"): Song =>
  song(
    [guitarTrack()],
    [
      section(
        bars.map((slots) => melodicBar("gtr", slots)),
        { id, name: "Bölüm" },
      ),
    ],
  );

const eight = (...slots: MelodicSlot[]): MelodicSlot[] => {
  const out = [...slots];
  while (out.length < 8) out.push(REST);
  return out.slice(0, 8);
};

const rangeOf = (source: Song, a: string, b: string): PracticeRange => {
  const result = practiceRange(source, a, b);
  if (!result.ok) throw new Error(`expected a range, got ${result.reason}`);
  return result.range;
};

describe("258. a range that cuts nothing says so", () => {
  it("is asked about songs the contract would actually accept", () => {
    /*
     * The guard on every fixture above. A test fixture is a plain object and
     * nothing makes it legal music, so the first draft of this file wrote
     * pitches as `{ string, fret }` and every assertion passed against a shape
     * the app can never hold. One parse is what stops the rest of the file
     * from being a well-tested description of nothing.
     */
    const source = sectionOf([
      eight(NOTE(0), SLIDE(1), TIE, HAMMER(2)),
      eight(NOTE(3), TIE, TIE, REST),
    ]);
    expect(songSchema.safeParse(source).success).toBe(true);
  });


  it("reads a range of plain notes as safe", () => {
    const source = sectionOf([
      eight(NOTE(3), NOTE(5), NOTE(7)),
      eight(NOTE(3), NOTE(5)),
      eight(NOTE(7)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:1", "one:1"));
    expect(reading.kind).toBe("safe");
    expect(reading.findings).toEqual([]);
    expect(reading.widened).toBeNull();
  });

  it("reads a range that covers a whole tie run as safe", () => {
    const source = sectionOf([
      eight(NOTE(3), TIE, TIE, NOTE(5)),
      eight(NOTE(7)),
    ]);
    expect(rangePreflight(source, rangeOf(source, "one:0", "one:0")).kind).toBe("safe");
  });

  it("reads a range that covers a whole legato chain as safe", () => {
    const source = sectionOf([
      eight(NOTE(3), SLIDE(5), SLIDE(7)),
      eight(NOTE(9)),
    ]);
    expect(rangePreflight(source, rangeOf(source, "one:0", "one:0")).kind).toBe("safe");
  });

  it("says nothing about a section the song does not have", () => {
    const source = sectionOf([eight(NOTE(3))]);
    const stale: PracticeRange = {
      sectionId: "gone",
      startBarKey: "gone:0",
      endBarKey: "gone:0",
    };
    expect(rangePreflight(source, stale).kind).toBe("safe");
  });
});

describe("259. a start inside a held note is named, not hidden", () => {
  it("finds a range whose first bar opens on a tie", () => {
    const source = sectionOf([
      eight(NOTE(3), REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(TIE, TIE, NOTE(7)),
      eight(NOTE(9)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:1", "one:2"));
    expect(reading.kind).toBe("start_continues_tie");
    expect(reading.findings[0]).toMatchObject({
      kind: "start_continues_tie",
      edge: "start",
      trackId: "gtr",
      reachesBarKey: "one:0",
    });
  });

  it("offers the range that would include the strike", () => {
    const source = sectionOf([
      eight(NOTE(3), REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(TIE, TIE, NOTE(7)),
      eight(NOTE(9)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:1", "one:2"));
    expect(reading.widened).toEqual({
      sectionId: "one",
      startBarKey: "one:0",
      endBarKey: "one:2",
    });
  });

  it("leaves the reader's range exactly as they set it", () => {
    const source = sectionOf([
      eight(NOTE(3), REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(TIE, TIE, NOTE(7)),
    ]);
    const range = rangeOf(source, "one:1", "one:1");
    const before = { ...range };
    rangePreflight(source, range);
    /*
     * The whole point of the offer. 2N-A removed silent widening from the
     * edit path; a loop that widened itself would be worse, because the
     * reader would hear the difference before they understood it.
     */
    expect(range).toEqual(before);
  });

  it("calls it a section crossing when the strike is not in this section", () => {
    const source = sectionOf([eight(TIE, TIE, NOTE(7)), eight(NOTE(9))]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:0"));
    expect(reading.kind).toBe("crosses_section");
    expect(reading.widened).toBeNull();
  });
});

describe("260. an end that chops a sustain is named too", () => {
  it("finds a note struck inside that is still sounding after", () => {
    const source = sectionOf([
      eight(NOTE(3)),
      eight(REST, REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(TIE, TIE, NOTE(7)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:1"));
    expect(reading.kind).toBe("end_cuts_sustain");
    expect(reading.findings[0]).toMatchObject({
      kind: "end_cuts_sustain",
      edge: "end",
      reachesBarKey: "one:2",
    });
  });

  it("offers the range that lets the note finish", () => {
    const source = sectionOf([
      eight(NOTE(3)),
      eight(REST, REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(TIE, TIE, NOTE(7)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:1"));
    expect(reading.widened).toEqual({
      sectionId: "one",
      startBarKey: "one:0",
      endBarKey: "one:2",
    });
  });

  it("says nothing when the next bar simply starts a new note", () => {
    const source = sectionOf([
      eight(NOTE(3)),
      eight(NOTE(5)),
      eight(NOTE(7)),
    ]);
    expect(rangePreflight(source, rangeOf(source, "one:0", "one:1")).kind).toBe("safe");
  });

  it("says nothing when the range ends at the last bar of the section", () => {
    const source = sectionOf([
      eight(NOTE(3)),
      eight(NOTE(5), TIE, TIE, TIE, TIE, TIE, TIE, TIE),
    ]);
    expect(rangePreflight(source, rangeOf(source, "one:0", "one:1")).kind).toBe("safe");
  });
});

describe("261. a legato bond across an edge is named as one", () => {
  it("finds a slide whose landing note is inside and its source outside", () => {
    const source = sectionOf([
      eight(REST, REST, REST, REST, REST, REST, REST, NOTE(3)),
      eight(SLIDE(5), NOTE(7)),
      eight(NOTE(9)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:1", "one:2"));
    expect(reading.kind).toBe("legato_boundary");
    expect(reading.findings[0]).toMatchObject({
      kind: "legato_boundary",
      edge: "start",
      reachesBarKey: "one:0",
    });
  });

  it("finds a hammer-on whose source is inside and its landing outside", () => {
    const source = sectionOf([
      eight(NOTE(3)),
      eight(REST, REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(HAMMER(7), NOTE(9)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:1"));
    expect(reading.kind).toBe("legato_boundary");
    expect(reading.findings[0]).toMatchObject({ edge: "end", reachesBarKey: "one:2" });
  });

  it("offers a range that contains the whole bond", () => {
    const source = sectionOf([
      eight(REST, REST, REST, REST, REST, REST, REST, NOTE(3)),
      eight(SLIDE(5), NOTE(7)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:1", "one:1"));
    expect(reading.widened).toEqual({
      sectionId: "one",
      startBarKey: "one:0",
      endBarKey: "one:1",
    });
  });

  it("says nothing about bonds entirely inside the range", () => {
    const source = sectionOf([
      eight(NOTE(3), SLIDE(5), HAMMER(7), SLIDE(9)),
      eight(NOTE(3)),
    ]);
    expect(rangePreflight(source, rangeOf(source, "one:0", "one:0")).kind).toBe("safe");
  });

  it("calls a bond with nothing before it in the section a section crossing", () => {
    const source = sectionOf([eight(SLIDE(5), NOTE(7)), eight(NOTE(9))]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:0"));
    expect(reading.kind).toBe("crosses_section");
    expect(reading.widened).toBeNull();
  });
});

describe("262. the worst thing found is the one the reader is told first", () => {
  it("reports a section crossing over everything else", () => {
    const source = sectionOf([
      eight(TIE, TIE, NOTE(3)),
      eight(REST, REST, REST, REST, REST, REST, REST, NOTE(5)),
      eight(TIE, NOTE(7)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:1"));
    expect(reading.kind).toBe("crosses_section");
    expect(reading.findings.length).toBeGreaterThan(1);
    expect(reading.widened).toBeNull();
  });

  it("reports a legato bond over a cut sustain", () => {
    const source = sectionOf([
      eight(NOTE(1)),
      eight(REST, REST, REST, REST, REST, REST, NOTE(3), NOTE(5)),
      eight(SLIDE(7), TIE, NOTE(9)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:1"));
    expect(reading.kind).toBe("legato_boundary");
  });

  it("keeps every finding, not only the worst one", () => {
    const source = sectionOf([
      eight(NOTE(1)),
      eight(REST, REST, REST, REST, REST, REST, NOTE(3), NOTE(5)),
      eight(SLIDE(7), NOTE(9)),
    ]);
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:1"));
    expect(reading.findings.map((finding) => finding.kind)).toContain("legato_boundary");
  });

  it("reads every written track, not only the first", () => {
    const source = song(
      [guitarTrack(), guitarTrack({ id: "gtr2", name: "İkinci" })],
      [
        section(
          [
            {
              timeSignature: [4, 4],
              resolution: 8,
              slots: {
                gtr: eight(NOTE(3)),
                gtr2: eight(REST, REST, REST, REST, REST, REST, REST, NOTE(5)),
              },
            },
            {
              timeSignature: [4, 4],
              resolution: 8,
              slots: { gtr: eight(NOTE(3)), gtr2: eight(TIE, NOTE(7)) },
            },
          ],
          { id: "one", name: "Bölüm" },
        ),
      ],
    );
    const reading = rangePreflight(source, rangeOf(source, "one:0", "one:0"));
    expect(reading.kind).toBe("end_cuts_sustain");
    expect(reading.findings[0]!.trackId).toBe("gtr2");
  });
});
