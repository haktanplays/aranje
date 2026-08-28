import { describe, expect, it } from "vitest";

import { fingerprintDiff, musicalFingerprint } from "@/lib/song/fingerprint";
import { REPERTOIRE } from "@/lib/repertoire/fixtures";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";

function fixture(slots: MelodicSlot[], over: Partial<Song> = {}): Song {
  return {
    ...song([guitarTrack()], [section([melodicBar(TRACK, slots, { resolution: 16 })])]),
    ...over,
  };
}

const line = (): MelodicSlot[] => {
  const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  slots[0] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 }, durationTicks: 192, letRing: true },
    ],
  };
  slots[4] = {
    notes: [{ pitch: "G3", position: { string: 3, fret: 0 }, articulation: "hammer_on" }],
  };
  return slots;
};

describe("musicalFingerprint", () => {
  it("ignores the title", () => {
    expect(musicalFingerprint(fixture(line(), { title: "Bir" }))).toBe(
      musicalFingerprint(fixture(line(), { title: "Başka" })),
    );
  });

  it("ignores the names given to sections and tracks", () => {
    const renamed = fixture(line());
    renamed.sections[0]!.name = "Yeni ad";
    renamed.tracks[0]!.name = "Elektro";
    expect(musicalFingerprint(renamed)).toBe(musicalFingerprint(fixture(line())));
  });

  it("hears a different tempo", () => {
    expect(musicalFingerprint(fixture(line(), { bpm: 90 }))).not.toBe(
      musicalFingerprint(fixture(line(), { bpm: 132 })),
    );
  });

  const changed = (mutate: (slots: MelodicSlot[]) => void) => {
    const slots = line();
    mutate(slots);
    return musicalFingerprint(fixture(slots));
  };
  const base = () => musicalFingerprint(fixture(line()));

  it("hears a different pitch", () => {
    expect(
      changed((slots) => {
        (slots[0] as { notes: { pitch: string }[] }).notes[0]!.pitch = "F2";
      }),
    ).not.toBe(base());
  });

  it("hears a different length", () => {
    expect(
      changed((slots) => {
        (slots[0] as { notes: { durationTicks?: number }[] }).notes[0]!.durationTicks = 96;
      }),
    ).not.toBe(base());
  });

  it("hears let-ring being taken off", () => {
    expect(
      changed((slots) => {
        delete (slots[0] as { notes: { letRing?: boolean }[] }).notes[0]!.letRing;
      }),
    ).not.toBe(base());
  });

  /* 2T-C §9. A strum is a performance mark, and two songs that differ only
     in which way the hand went are not the same music. */
  it("hears a strum direction that was added", () => {
    expect(
      changed((slots) => {
        (slots[0] as { notes: { strum?: "down" | "up" }[] }).notes[0]!.strum = "down";
      }),
    ).not.toBe(base());
  });

  it("hears a different articulation", () => {
    expect(
      changed((slots) => {
        (slots[4] as { notes: { articulation?: string }[] }).notes[0]!.articulation =
          "pull_off";
      }),
    ).not.toBe(base());
  });

  it("hears a note moved to a different beat", () => {
    expect(
      changed((slots) => {
        slots[8] = slots[4]!;
        slots[4] = null;
      }),
    ).not.toBe(base());
  });

  it("hears a different string under the same pitch", () => {
    expect(
      changed((slots) => {
        (slots[4] as { notes: { position?: { string: number; fret: number } }[] }).notes[0]!.position =
          { string: 2, fret: 5 };
      }),
    ).not.toBe(base());
  });

  it("says where two songs stop agreeing", () => {
    const other = line();
    other[4] = null;
    const diff = fingerprintDiff(fixture(line()), fixture(other));
    expect(diff).toContain("beklenen");
    expect(diff).toContain("yazılan");
  });

  it("says nothing when they are the same music", () => {
    expect(fingerprintDiff(fixture(line()), fixture(line()))).toBeNull();
  });

  it("tells the three repertoire fixtures apart", () => {
    const prints = [
      musicalFingerprint(REPERTOIRE.fixtureA()),
      musicalFingerprint(REPERTOIRE.fixtureB()),
      musicalFingerprint(REPERTOIRE.fixtureC()),
    ];
    expect(new Set(prints).size).toBe(3);
  });
});
