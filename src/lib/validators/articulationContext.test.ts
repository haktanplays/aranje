/**
 * Articulations whose context does not hold (spec 10.3, 8.5).
 */
import { describe, expect, it } from "vitest";

import {
  ARTICULATION_CONTEXT_CODE,
  validateArticulationContext,
} from "@/lib/validators/articulationContext";
import { SONG_VALIDATORS, runValidators } from "@/lib/validators";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  REST,
  bar,
  emptyBar,
  note,
  slots,
  song,
} from "@/test/expression-fixtures";
import { songSchema, type Song } from "@/lib/song/schema";

const G3 = (a?: Parameters<typeof note>[3]) => note("G3", 1, 10, a);
const B3 = (a?: Parameters<typeof note>[3]) => note("B3", 1, 14, a);

function issuesOf(target: Song) {
  return validateArticulationContext(target);
}

describe("what needs no context", () => {
  it("says nothing about an accent", () => {
    expect(issuesOf(song([bar(slots([G3("accent")]))]))).toEqual([]);
  });

  it("says nothing about palm mute, vibrato or a bend on a fretted track", () => {
    for (const articulation of ["palm_mute", "vibrato", "bend_half", "bend_full"] as const) {
      expect(issuesOf(song([bar(slots([G3(articulation)]))]))).toEqual([]);
    }
  });

  it("says nothing about a song with no articulation at all", () => {
    expect(issuesOf(SAMPLE_SONG)).toEqual([]);
  });
});

describe("slide", () => {
  it("accepts a slide from the note before it on the same string", () => {
    expect(issuesOf(song([bar(slots([G3(), B3("slide")]))]))).toEqual([]);
  });

  it("warns when there is no note before it", () => {
    const issues = issuesOf(song([bar(slots([B3("slide")]))]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: ARTICULATION_CONTEXT_CODE,
      severity: "warning",
      sectionId: "s1",
      barIndex: 0,
      trackId: "gtr",
      slotIndex: 0,
    });
  });

  it("warns when the note before it was on another string", () => {
    const issues = issuesOf(
      song([bar(slots([note("E3", 0, 12), note("A3", 1, 12, "slide")]))]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("aynı telde değil");
  });

  it("warns when the interval is wider than an octave", () => {
    const issues = issuesOf(
      song([bar(slots([note("E2", 0, 0), note("F3", 0, 13, "slide")]))]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("oktavdan");
  });
});

describe("hammer-on and pull-off", () => {
  it("accepts a hammer-on that goes up", () => {
    expect(issuesOf(song([bar(slots([G3(), B3("hammer_on")]))]))).toEqual([]);
  });

  it("warns about a hammer-on that goes down", () => {
    const issues = issuesOf(song([bar(slots([B3(), G3("hammer_on")]))]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("yukarı yönde");
  });

  it("accepts a pull-off that goes down", () => {
    expect(issuesOf(song([bar(slots([B3(), G3("pull_off")]))]))).toEqual([]);
  });

  it("warns about a pull-off that goes up", () => {
    const issues = issuesOf(song([bar(slots([G3(), B3("pull_off")]))]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("aşağı yönde");
  });
});

describe("the slur distance limit", () => {
  it("accepts a hammer-on at exactly the limit", () => {
    const edge = song([
      bar(slots([note("E3", 1, 7), note("A3", 1, 12, "hammer_on")])),
    ]);
    expect(issuesOf(edge)).toEqual([]);
  });

  it("warns one semitone past it, and says the number", () => {
    const wide = song([
      bar(slots([note("E3", 1, 7), note("A#3", 1, 13, "hammer_on")])),
    ]);
    const issues = issuesOf(wide);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain("5 yarım ton");
  });

  it("holds a pull-off to the same limit", () => {
    const wide = song([
      bar(slots([note("A#3", 1, 13), note("E3", 1, 7, "pull_off")])),
    ]);
    expect(issuesOf(wide)).toHaveLength(1);
  });
});

describe("what breaks a connection", () => {
  it("a real rest does", () => {
    const issues = issuesOf(song([bar(slots([G3(), REST, B3("hammer_on")]))]));
    expect(issues).toHaveLength(1);
  });

  it("a bar the track is not written in does", () => {
    const across = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()])),
      emptyBar(),
      bar(slots([B3("hammer_on")])),
    ]);
    expect(issuesOf(across)).toHaveLength(1);
  });

  it("a bar line on its own does not", () => {
    const across = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()])),
      bar(slots([B3("hammer_on")])),
    ]);
    expect(issuesOf(across)).toEqual([]);
  });

  it("a section line on its own does not", () => {
    const across = song(
      [bar(slots([REST, REST, REST, REST, REST, REST, REST, G3()]))],
      [bar(slots([B3("hammer_on")]))],
    );
    expect(issuesOf(across)).toEqual([]);
  });
});

describe("instruments it has nothing to say about", () => {
  it("skips drums entirely", () => {
    const withDrums = runValidators(SAMPLE_SONG, [validateArticulationContext]);
    expect(withDrums).toEqual([]);
  });

  it("defers an instrument with no fretboard, once for the whole track", () => {
    const keys = SAMPLE_SONG.tracks[0];
    if (!keys) throw new Error("no track");
    const parsed = songSchema.safeParse({
      version: 2,
      title: "no fretboard",
      bpm: 120,
      key: "E minor",
      tracks: [
        {
          id: "pad",
          name: "Pad",
          instrumentId: "synth_pad",
          presetId: "warm",
          volumeDb: -6,
        },
      ],
      sections: [
        {
          id: "s1",
          name: "S1",
          status: "fixed",
          bars: [
            {
              timeSignature: [4, 4],
              resolution: 8,
              slots: {
                pad: [
                  { notes: [{ pitch: "A3", articulation: "vibrato" }] },
                  { notes: [{ pitch: "B3", articulation: "vibrato" }] },
                  null, null, null, null, null, null,
                ],
              },
            },
          ],
        },
      ],
    });
    if (!parsed.success) throw new Error("fixture does not parse");

    const issues = validateArticulationContext(parsed.data);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ trackId: "pad", severity: "warning" });
    expect(issues[0]?.slotIndex).toBeUndefined();
  });
});

describe("the chain it belongs to", () => {
  it("is a warning, never an error, in the central chain", () => {
    const broken = song([bar(slots([B3("slide")]))]);
    const issues = runValidators(broken, SONG_VALIDATORS);
    const mine = issues.filter((issue) => issue.code === ARTICULATION_CONTEXT_CODE);

    expect(mine).toHaveLength(1);
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("reports in a deterministic order, every time", () => {
    const messy = song([
      bar(slots([B3("slide"), REST, G3("hammer_on"), REST, B3("pull_off")])),
      bar(slots([note("A3", 2, 2, "slide")])),
    ]);
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(issuesOf(messy)),
    );
    expect(new Set(runs).size).toBe(1);
    expect(issuesOf(messy).length).toBeGreaterThan(1);
  });

  it("reports one issue per note, not one per symptom", () => {
    const issues = issuesOf(song([bar(slots([B3("hammer_on")]))]));
    expect(issues).toHaveLength(1);
  });
});
