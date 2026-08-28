/**
 * The rhythm, in words someone can count (spec 13.20 §4, 2N-A).
 *
 * Every example the brief gave is here as a literal string, because the
 * wording *is* the feature: a reader who does not read music has nothing to
 * check it against except itself. The two rules that matter most are that a
 * step is never called a beat, and that 7/8 is never given a beat grouping the
 * contract cannot back up.
 */
import { describe, expect, it } from "vitest";

import { hasFeltBeat, readRhythm, rhythmSummary, gridChoices, readGrid } from "@/lib/music/rhythm-language";
import {
  isRepresentableGrid,
  RESOLUTIONS,
  TIME_SIGNATURES,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

const plain = (meter: TimeSignature, resolution: Resolution) =>
  readRhythm(meter, resolution).plain;

describe("98. the plain reading, exactly as the brief asked for it", () => {
  it("counts beats and steps separately in 4/4", () => {
    expect(plain([4, 4], 4)).toBe("4 ana vuruş · 4 adım");
    expect(plain([4, 4], 8)).toBe("4 ana vuruş · 8 adım");
    expect(plain([4, 4], 12)).toBe("4 ana vuruş · 12 adım");
    expect(plain([4, 4], 16)).toBe("4 ana vuruş · 16 adım");
    expect(plain([4, 4], 24)).toBe("4 ana vuruş · 24 adım");
    expect(plain([4, 4], 32)).toBe("4 ana vuruş · 32 adım");
  });

  it("keeps the beat count the meter's, not the grid's, in 3/4", () => {
    expect(plain([3, 4], 16)).toBe("3 ana vuruş · 12 adım");
    expect(plain([3, 4], 4)).toBe("3 ana vuruş · 3 adım");
  });

  it("counts 6/8 in the beat a foot actually taps", () => {
    // Two dotted beats, not six eighths. The rule lives in the timing core;
    // this only reads it.
    expect(plain([6, 8], 16)).toBe("2 ana vuruş · 12 adım");
    expect(plain([6, 8], 8)).toBe("2 ana vuruş · 6 adım");
  });

  it("never calls a step a beat", () => {
    /*
     * The whole reason the two words exist. "16 vuruş" would tell a reader
     * their bar has sixteen beats in it, which is not true of any bar this
     * product can make.
     */
    for (const meter of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        if (!isRepresentableGrid(meter, resolution)) continue;
        const reading = readRhythm(meter as TimeSignature, resolution);
        expect(reading.count, reading.plain).toBeLessThanOrEqual(reading.steps);
        if (reading.hasFeltBeat) {
          expect(reading.count, reading.plain).toBeLessThanOrEqual(7);
        }
      }
    }
  });
});

describe("99. 7/8 is not given a grouping the contract cannot back", () => {
  it("says what it counts in, rather than inventing main beats", () => {
    expect(plain([7, 8], 8)).toBe("7 sekizlik · 7 adım");
    expect(plain([7, 8], 16)).toBe("7 sekizlik · 14 adım");
  });

  it("has no felt beat to offer", () => {
    expect(hasFeltBeat([7, 8])).toBe(false);
    expect(readRhythm([7, 8], 16).hasFeltBeat).toBe(false);
  });

  it("never writes 2+2+3 or any other invented grouping", () => {
    // Whether 7/8 is felt 2+2+3, 3+2+2 or 2+3+2 is a property of the music,
    // and the Song Contract has no field for it (spec 5.5).
    for (const resolution of [8, 16, 32] as const) {
      const reading = readRhythm([7, 8], resolution);
      expect(reading.plain).not.toMatch(/\+/);
      expect(reading.plain).not.toContain("ana vuruş");
      expect(reading.technical).not.toMatch(/\+/);
    }
  });

  it("still calls 6/8 compound, because that one really is", () => {
    // The absence of a grouping for 7/8 is a fact about 7/8, not a blanket
    // refusal to describe eighth-note meters.
    expect(hasFeltBeat([6, 8])).toBe(true);
  });
});

describe("100. one formatter, both lines", () => {
  it("produces the technical reading from the same call", () => {
    const reading = readRhythm([4, 4], 16);
    expect(reading.technical).toBe("4/4 · 1/16");
    expect(reading.plain).toBe("4 ana vuruş · 16 adım");
  });

  it("names a triplet grid as a note value, never as a bare number", () => {
    // "1/12" next to "1/16" reads as a straight grid, which is what it is not.
    expect(readRhythm([4, 4], 12).technical).toBe("4/4 · 1/8 üçleme");
    expect(readRhythm([4, 4], 24).technical).toBe("4/4 · 1/16 üçleme");
  });

  it("puts both in one string when a control has room for one", () => {
    expect(rhythmSummary([4, 4], 4)).toBe("4 ana vuruş · 4 adım (4/4 · 1/4)");
  });

  it("has a reading for every meter and grid the contract allows", () => {
    for (const meter of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        if (!isRepresentableGrid(meter, resolution)) continue;
        const reading = readRhythm(meter as TimeSignature, resolution);
        expect(reading.plain, `${meter}@${resolution}`).toMatch(/^\d+ \S+.* · \d+ adım$/);
        expect(reading.technical, `${meter}@${resolution}`).toContain("·");
        // No leftover placeholder: an unnamed note value would show as "1/8".
        expect(reading.unit, `${meter}@${resolution}`).not.toMatch(/^1\//);
      }
    }
  });

  it("refuses to describe a bar that cannot exist", () => {
    // 1/4 in 6/8 is not a bar this product can make, and the reading does not
    // paper over that with a rounded number.
    expect(() => readRhythm([6, 8], 4)).toThrow(RangeError);
    expect(() => readRhythm([7, 8], 12)).toThrow(RangeError);
  });
});

describe("the grid, said as a grid (2T §3.1)", () => {
  /*
   * The founder saw "4/4", "132 BPM" and "1/16" together and read them as one
   * fact. They are three answers to three questions, and only this control
   * changes the third.
   */
  it("says how finely a beat is divided, not how big the bar is", () => {
    expect(readGrid([4, 4], 16).plain).toBe("Izgara: 16'lık · Her vuruşta 4 adım");
    expect(readGrid([4, 4], 8).plain).toBe("Izgara: sekizlik · Her vuruşta 2 adım");
    expect(readGrid([4, 4], 4).plain).toBe("Izgara: dörtlük · Her vuruşta 1 adım");
    expect(readGrid([4, 4], 32).plain).toBe("Izgara: 32'lik · Her vuruşta 8 adım");
  });

  it("counts triplet steps as triplets, not as a denser straight grid", () => {
    expect(readGrid([4, 4], 12).stepsPerBeat).toBe(3);
    expect(readGrid([4, 4], 24).stepsPerBeat).toBe(6);
    expect(readGrid([4, 4], 12).name).toBe("sekizlik triole");
  });

  it("counts against the felt beat in compound time", () => {
    /* 6/8 at 1/16 is twelve steps and two dotted beats: six steps a beat. */
    expect(readGrid([6, 8], 16).stepsPerBeat).toBe(6);
  });

  it("never drops the notation the reader will meet everywhere else", () => {
    expect(readGrid([4, 4], 16).technical).toBe("1/16");
    expect(readGrid([4, 4], 12).technical).toBe("1/8 üçleme");
  });

  it("offers both names on every choice, and only grids the meter can write", () => {
    const choices = gridChoices([4, 4], [4, 8, 12, 16, 24, 32]);
    expect(choices.map((c) => c.label)).toEqual([
      "Vuruş — 1/4",
      "Yarım vuruş — 1/8",
      "Sekizlik triole — 1/8 üçleme",
      "Çeyrek vuruş — 1/16",
      "On altılık triole — 1/16 üçleme",
      "Çok ince — 1/32",
    ]);
  });

  it("leaves out a grid the meter cannot be written on", () => {
    /* 7/8 counts in eighths, so a grid of quarters cannot write its value. */
    const choices = gridChoices([7, 8], [4, 8, 16, 32]);
    expect(choices.map((c) => c.resolution)).toEqual([8, 16, 32]);
  });
});

/*
 * 2T-B §5. Two forms of one sentence, never two different sentences: the chip
 * has room for the answer and the accessible description carries the whole of
 * it, so nothing a reader can hear is missing from what they can see.
 */
describe("the grid chip and what is read aloud", () => {
  it("shortens to the name and keeps the full reading beside it", () => {
    const reading = readGrid([4, 4], 16);
    expect(reading.short).toBe("Izgara · 16'lık");
    expect(reading.plain).toBe("Izgara: 16'lık · Her vuruşta 4 adım");
  });

  it("keeps the short form a prefix of the full one, for every grid", () => {
    for (const resolution of [4, 8, 12, 16, 24, 32] as const) {
      const reading = readGrid([4, 4], resolution);
      expect(reading.short).toBe(`Izgara · ${reading.name}`);
      expect(reading.plain.startsWith(`Izgara: ${reading.name}`)).toBe(true);
    }
  });
});
