import { describe, expect, it } from "vitest";

import { guessHarmony, harmonyOf } from "@/lib/song/harmony-guess";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import { ROOT_SHORT_LABELS } from "@/lib/chords/chord-formula";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";
const RUN = { sectionId: "s1", barIndex: 0, trackId: TRACK, fromSlot: 0, toSlot: 16 };

function fixture(pitches: readonly string[]): Song {
  const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  pitches.forEach((pitch, index) => {
    slots[index] = { notes: [{ pitch, position: { string: 0, fret: 0 } }] };
  });
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution: 16 })])],
  );
}

const named = (subject: Song) => {
  const guess = guessHarmony(subject, RUN);
  return guess === null ? null : `${ROOT_SHORT_LABELS[guess.rootPitchClass]} ${guess.quality}`;
};

describe("guessHarmony", () => {
  it("hears a minor triad as one", () => {
    expect(named(fixture(["E2", "G2", "B2"]))).toBe("E minor");
  });

  it("hears a major triad as one", () => {
    expect(named(fixture(["A2", "C#3", "E3"]))).toBe("A major");
  });

  it("hears a bare fifth as a power chord rather than inventing a third", () => {
    expect(named(fixture(["E2", "B2", "E3"]))).toBe("E power");
  });

  it("hears a seventh when the seventh is actually there", () => {
    expect(named(fixture(["A2", "C3", "E3", "G3"]))).toBe("A minor_7");
  });

  /*
   * A triad and a seventh chord explain a plain triad equally well. The
   * seventh is a claim the notes did not make, so the triad wins.
   */
  it("does not add a note the passage never played", () => {
    const guess = guessHarmony(fixture(["E2", "G2", "B2"]), RUN);
    expect(guess?.quality).toBe("minor");
  });

  it("takes the root from the bass when two chords fit equally", () => {
    /* C-E-G over a C bass is C major, not E minor with an added sixth. */
    expect(named(fixture(["C3", "E3", "G3"]))).toBe("C major");
  });

  it("is not thrown off by one passing note", () => {
    expect(named(fixture(["E2", "F#2", "G2", "B2"]))).toBe("E minor");
  });

  it("gives nothing for silence", () => {
    expect(guessHarmony(fixture([]), RUN)).toBeNull();
  });

  it("gives nothing for a bar that is not there", () => {
    expect(guessHarmony(fixture(["E2"]), { ...RUN, barIndex: 9 })).toBeNull();
  });

  it("is deterministic", () => {
    const subject = fixture(["E2", "G2", "B2", "F#2"]);
    expect(guessHarmony(subject, RUN)).toEqual(guessHarmony(subject, RUN));
  });

  it("hands the transform a harmony it can use", () => {
    const harmony = harmonyOf({ rootPitchClass: 4, quality: "minor" });
    expect(harmony).toEqual({ root: "E", intervals: [0, 3, 7] });
  });
});

/**
 * 2T-C §7. A note is evidence in proportion to how much of the bar it
 * occupies and whether it lands on a beat. Without that, a figure in E minor
 * that touches a C once reads as C major seventh — which explains more notes
 * and is the wrong answer.
 */
describe("weighing the evidence", () => {
  /**
   * E, G and B each on a beat, with a C passing through on a weak sixteenth.
   *
   * The three chord tones carry real weight — a third that only ever appears
   * as a weak sixteenth is genuinely weak evidence for a triad, and the
   * scorer is right to prefer a power chord for it. What is being tested here
   * is the ornament, so the chord tones are given the weight a chord tone has.
   */
  function withOrnament(): Song {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    const put = (index: number, pitch: string, ticks: number) => {
      slots[index] = {
        notes: [{ pitch, position: { string: 0, fret: 0 }, durationTicks: ticks }],
      };
    };
    put(0, "E2", 96); // beat one
    put(4, "G3", 96); // beat two
    put(8, "B3", 96); // beat three
    put(10, "C4", 48); // off the beat, short: the neighbour
    put(11, "B3", 48);
    return song(
      [guitarTrack()],
      [section([melodicBar(TRACK, slots, { resolution: 16 })])],
    );
  }

  it("reads a passing note as decoration rather than as the chord", () => {
    expect(named(withOrnament())).toBe("E minor");
  });

  it("changes its mind when the note stops being decoration", () => {
    /* Give the C a whole beat of its own and it is no longer passing. */
    const subject = withOrnament();
    const slots = subject.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
    slots[12] = {
      notes: [{ pitch: "C4", position: { string: 0, fret: 0 }, durationTicks: 192 }],
    };
    expect(named(subject)).not.toBe("E minor");
  });

  it("weighs a long note more heavily than a short one", () => {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[0] = {
      notes: [{ pitch: "A2", position: { string: 0, fret: 0 }, durationTicks: 384 }],
    };
    slots[8] = {
      notes: [{ pitch: "C3", position: { string: 0, fret: 0 }, durationTicks: 192 }],
    };
    slots[12] = {
      notes: [{ pitch: "E3", position: { string: 0, fret: 0 }, durationTicks: 192 }],
    };
    /* A single passing F# cannot turn A minor into anything else. */
    slots[14] = {
      notes: [{ pitch: "F#3", position: { string: 0, fret: 0 }, durationTicks: 48 }],
    };
    expect(
      named(song([guitarTrack()], [section([melodicBar(TRACK, slots, { resolution: 16 })])])),
    ).toBe("A minor");
  });
});
