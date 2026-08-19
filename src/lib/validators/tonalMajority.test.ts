import { describe, expect, it } from "vitest";

import { coreIntervals } from "@/lib/music/tonality";
import type { Bar, DrumSlot, MelodicSlot, NoteEvent, Track } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import {
  MIN_ONSETS_FOR_VERDICT,
  validateTonalMajority,
} from "@/lib/validators/tonalMajority";

function notes(...pitches: readonly string[]): MelodicSlot {
  return { notes: pitches.map((pitch): NoteEvent => ({ pitch })) };
}

/** Fill the first slots of a guitar bar and rest for the remainder. */
function line(...values: readonly MelodicSlot[]): MelodicSlot[] {
  const slots = restSlots(8);
  values.forEach((value, index) => {
    slots[index] = value;
  });
  return slots;
}

function sharedBar(
  slots: Record<string, readonly (MelodicSlot | DrumSlot)[]>,
): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 8,
    slots: Object.fromEntries(
      Object.entries(slots).map(([id, value]) => [id, [...value]]),
    ) as Bar["slots"],
  };
}

const BASS: Track = {
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: ["E1", "A1", "D2", "G2"], capo: 0 },
};

function eMinor(bars: readonly Bar[], tracks: readonly Track[] = [guitarTrack()]) {
  return song(tracks, [section([...bars])], { key: "E minor" });
}

// E natural minor core: E F# G A B C D. Colour tones used below:
//   D#  raised seventh   C#  raised sixth   Bb  flat five
//   G#  borrowed         F   chromatic
describe("tonalMajority (spec 10.1, core from 10.4, K-17)", () => {
  it("passes three core notes against two colour notes", () => {
    const subject = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("G2"), notes("B2"), notes("F2"), notes("Bb2"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("fails an even split of two core and two colour notes", () => {
    const subject = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("G2"), notes("F2"), notes("Bb2"))),
    ]);
    const issues = validateTonalMajority(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "tonalMajority",
      severity: "error",
      sectionId: "s1",
      barIndex: 0,
    });
    expect(issues[0]?.message).toContain("4 melodik notanın yalnız 2");
  });

  it("passes two core notes against one colour note", () => {
    const subject = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("G2"), notes("F2"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("gives no verdict on a bar of one or two notes", () => {
    expect(MIN_ONSETS_FOR_VERDICT).toBe(3);

    // Every note colour, and still no issue: one or two notes are not
    // evidence of a tonality either way.
    expect(validateTonalMajority(eMinor([melodicBar("gtr", line(notes("F2")))]))).toEqual([]);
    expect(
      validateTonalMajority(
        eMinor([melodicBar("gtr", line(notes("F2"), notes("Bb2")))]),
      ),
    ).toEqual([]);

    // A third colour note is enough evidence, and now it fails.
    expect(
      validateTonalMajority(
        eMinor([melodicBar("gtr", line(notes("F2"), notes("Bb2"), notes("C#3")))]),
      ),
    ).toHaveLength(1);
  });

  it("lets a single harmonic-minor raised seventh through", () => {
    // D# is not in the natural minor, so it is colour; the other three are
    // core and carry the majority.
    expect(coreIntervals("minor").has(11)).toBe(false);
    const subject = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("B2"), notes("G2"), notes("D#3"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("lets a single flat five through", () => {
    const subject = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("B2"), notes("A2"), notes("Bb2"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("does not count a chromatic step as core, even between two core notes", () => {
    // E - F - F#: under the old rule the F was admitted for having core
    // neighbours. It is colour now, and the bar passes on the core majority
    // rather than on an exception.
    const passing = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("F2"), notes("F#2"))),
    ]);
    expect(validateTonalMajority(passing)).toEqual([]);

    // Take the core majority away and the same neighbours no longer save it:
    // E and F# are core, the other four are colour.
    const surrounded = eMinor([
      melodicBar(
        "gtr",
        line(
          notes("E2"),
          notes("F2"),
          notes("F#2"),
          notes("G#2"),
          notes("Bb2"),
          notes("C#3"),
        ),
      ),
    ]);
    expect(validateTonalMajority(surrounded)).toHaveLength(1);
  });

  it("fails a bar that is mostly chromatic", () => {
    const subject = eMinor([
      melodicBar("gtr", line(notes("F2"), notes("G#2"), notes("Bb2"), notes("E2"))),
    ]);
    const issues = validateTonalMajority(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("F2");
    expect(issues[0]?.message).toContain("G#2");
  });

  it("reads major and natural minor from the song's own key", () => {
    const bars = [
      melodicBar("gtr", line(notes("C3"), notes("E3"), notes("A3"), notes("B3"))),
    ];
    // All four are degrees of C major.
    expect(
      validateTonalMajority(song([guitarTrack()], [section(bars)], { key: "C major" })),
    ).toEqual([]);
    // In C natural minor only the tonic is core; E, A and B are all borrowed
    // from the parallel major.
    expect(
      validateTonalMajority(song([guitarTrack()], [section(bars)], { key: "C minor" })),
    ).toHaveLength(1);
  });

  it("counts every melodic track in the bar together", () => {
    const bar = sharedBar({
      gtr: line(notes("F2"), notes("Bb2")),
      bass: line(notes("E1"), notes("G1")),
    });
    // Two core and two colour across the two tracks: an even split fails, and
    // it only reads as one bar because both tracks are counted.
    expect(validateTonalMajority(eMinor([bar], [guitarTrack(), BASS]))).toHaveLength(1);

    const better = sharedBar({
      gtr: line(notes("F2")),
      bass: line(notes("E1"), notes("G1")),
    });
    expect(validateTonalMajority(eMinor([better], [guitarTrack(), BASS]))).toEqual([]);
  });

  it("ignores drum hits, which carry no pitch", () => {
    const bar = sharedBar({
      gtr: line(notes("F2"), notes("Bb2"), notes("E2")),
      drums: [
        [{ piece: "kick" as const }],
        [{ piece: "snare" as const }],
        [{ piece: "kick" as const }],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    // One core in three melodic notes fails; the drums neither rescue it nor
    // change the count.
    const issues = validateTonalMajority(eMinor([bar], [guitarTrack(), drumTrack()]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("3 melodik notanın yalnız 1");
  });

  it("does not count a tie as a second onset", () => {
    // Held colour notes would tip this bar if a tie counted again.
    const subject = eMinor([
      melodicBar("gtr", line(notes("F2"), "-", "-", notes("E2"), notes("G2"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("counts every note of a chord, not every slot", () => {
    // One slot, four notes, three of them colour.
    const subject = eMinor([
      melodicBar("gtr", line(notes("F2", "Bb2", "G#2", "E3"))),
    ]);
    expect(validateTonalMajority(subject)).toHaveLength(1);
  });

  it("says nothing when the key cannot be read", () => {
    const subject = {
      ...eMinor([melodicBar("gtr", line(notes("F2"), notes("Bb2"), notes("G#2")))]),
      key: "not a key",
    };
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("reports in section and bar order, and repeats itself exactly", () => {
    const bad = melodicBar("gtr", line(notes("F2"), notes("Bb2"), notes("G#2")));
    const subject = song(
      [guitarTrack()],
      [
        section([bad, bad], { id: "a", name: "A" }),
        section([bad], { id: "b", name: "B" }),
      ],
      { key: "E minor" },
    );

    const path = validateTonalMajority(subject).map((issue) => [
      issue.sectionId,
      issue.barIndex,
    ]);
    expect(path).toEqual([
      ["a", 0],
      ["a", 1],
      ["b", 0],
    ]);
    expect(validateTonalMajority(subject)).toEqual(
      validateTonalMajority(subject),
    );
  });
});
