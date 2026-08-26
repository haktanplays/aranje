/**
 * A pitch change must not quietly take the music with it (2S-A kapanış §2).
 *
 * The reported defect: writing a hammer-on chain with the Legato Brush and
 * then changing one of its frets left a note with no articulation at all.
 * Nobody was asked, nothing was said, and the chain was gone — which is the
 * worst of the three possible outcomes, because the reader cannot see what
 * they lost.
 *
 * `set_note` rebuilds the note from the command, so every field the command
 * does not carry used to disappear. The rule these tests hold is that one
 * update says exactly one thing: change what I named, keep what I did not,
 * and refuse — atomically, in words — if the two cannot both be true.
 */
import { describe, expect, it } from "vitest";

import { applyEdit, pitchAt, type EditCommand, type EditTarget } from "@/lib/song/edit";
import {
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import type { Articulation, Fretboard, MelodicSlot, Song } from "@/lib/song/schema";

const E_STANDARD: Fretboard = { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 };
const DROP_D: Fretboard = { tuning: ["D2", "A2", "D3", "G3", "B3", "E4"], capo: 0 };
const DADGAD: Fretboard = { tuning: ["D2", "A2", "D3", "G3", "A3", "D4"], capo: 0 };
const CAPO_3: Fretboard = { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 3 };

const AT = (slotIndex: number): EditTarget => ({
  sectionId: "s1",
  trackId: "gtr",
  barIndex: 0,
  slotIndex,
});

/** One fretted note, said the way the schema says it. */
function note(
  pitch: string,
  string: number,
  fret: number,
  extra: { articulation?: Articulation; velocity?: number } = {},
): MelodicSlot {
  return {
    notes: [
      {
        pitch,
        position: { string, fret },
        ...(extra.articulation === undefined ? {} : { articulation: extra.articulation }),
        ...(extra.velocity === undefined ? {} : { velocity: extra.velocity }),
      },
    ],
  };
}

/**
 * Two notes on the sixth string, the second carrying the slur.
 *
 * The sixth string is index 5 in this tuning — the tuning array runs from the
 * thickest string up, so `E4` is the one a hammer-on is easiest to read on.
 */
function chainSong(
  first: { fret: number; pitch?: string },
  second: { fret: number; pitch?: string; articulation: Articulation },
  fretboard: Fretboard = E_STANDARD,
): Song {
  /*
   * The pitch is read off the fretboard rather than typed in, so the Drop D,
   * DADGAD and capo fixtures say what those tunings really sound like instead
   * of carrying E standard's names into them.
   */
  const sounds = (fret: number) => pitchAt(fretboard, 5, fret) ?? "E4";
  const slots: (MelodicSlot | null | "-")[] = restSlots(8);
  slots[0] = note(first.pitch ?? sounds(first.fret), 5, first.fret);
  slots[1] = note(second.pitch ?? sounds(second.fret), 5, second.fret, {
    articulation: second.articulation,
  });
  return song([guitarTrack({ fretboard })], [section([melodicBar("gtr", slots)])]);
}

const HAMMER = () =>
  chainSong({ fret: 7, pitch: "B4" }, { fret: 10, pitch: "D5", articulation: "hammer_on" });
const PULL = () =>
  chainSong({ fret: 10, pitch: "D5" }, { fret: 7, pitch: "B4", articulation: "pull_off" });

const update = (target: EditTarget, stringIndex: number, fret: number): EditCommand => ({
  kind: "set_note",
  target,
  stringIndex,
  fret,
});

/** The lane is a union across instruments; this track is the fretted one. */
const slotAt = (song: Song, slotIndex: number): MelodicSlot | null | "-" | undefined =>
  (song.sections[0]?.bars[0]?.slots["gtr"] as (MelodicSlot | null | "-")[] | undefined)?.[
    slotIndex
  ];

const noteAt = (song: Song, slotIndex: number) => {
  const slot = slotAt(song, slotIndex);
  return slot && slot !== "-" ? slot.notes[0] : undefined;
};

const articulationAt = (song: Song, slotIndex: number): Articulation | undefined =>
  noteAt(song, slotIndex)?.articulation;

describe("a note update keeps what the update did not name", () => {
  it("keeps the hammer-on when its source note moves to another valid fret", () => {
    const before = HAMMER();
    // 7 -> 8, still below the 10 the hammer-on lands on.
    const result = applyEdit(before, update(AT(0), 5, 8));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("hammer_on");
    expect(noteAt(result.song, 0)?.position).toEqual({ string: 5, fret: 8 });
  });

  it("keeps the hammer-on when its target note moves to another valid fret", () => {
    const result = applyEdit(HAMMER(), update(AT(1), 5, 9));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("hammer_on");
  });

  it("keeps the pull-off when its source note moves", () => {
    const result = applyEdit(PULL(), update(AT(0), 5, 11));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("pull_off");
  });

  it("keeps the pull-off when its target note moves", () => {
    const result = applyEdit(PULL(), update(AT(1), 5, 8));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("pull_off");
  });

  it("keeps a slide", () => {
    const before = chainSong(
      { fret: 5, pitch: "A4" },
      { fret: 9, pitch: "C#5", articulation: "slide" },
    );
    const result = applyEdit(before, update(AT(0), 5, 6));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("slide");
  });

  it.each(["palm_mute", "vibrato", "bend_half", "bend_full", "accent", "staccato"] as const)(
    "keeps %s, which is not a link at all",
    (articulation) => {
      const slots: (MelodicSlot | null | "-")[] = restSlots(8);
      slots[0] = note("B4", 5, 7, { articulation });
      const before = song(
        [guitarTrack({ fretboard: E_STANDARD })],
        [section([melodicBar("gtr", slots)])],
      );
      const result = applyEdit(before, update(AT(0), 5, 9));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(articulationAt(result.song, 0)).toBe(articulation);
    },
  );

  it("keeps a velocity the update did not mention", () => {
    const slots: (MelodicSlot | null | "-")[] = restSlots(8);
    slots[0] = note("B4", 5, 7, { velocity: 96 });
    const before = song(
      [guitarTrack({ fretboard: E_STANDARD })],
      [section([melodicBar("gtr", slots)])],
    );
    const result = applyEdit(before, update(AT(0), 5, 9));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0)?.velocity).toBe(96);
  });

  it("keeps the tie that was continuing the note", () => {
    const slots: (MelodicSlot | null | "-")[] = restSlots(8);
    slots[0] = note("B4", 5, 7);
    slots[1] = "-";
    const before = song(
      [guitarTrack({ fretboard: E_STANDARD })],
      [section([melodicBar("gtr", slots)])],
    );
    const result = applyEdit(before, update(AT(0), 5, 9));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotAt(result.song, 1)).toBe("-");
  });

  it.each([
    ["Drop D", DROP_D],
    ["DADGAD", DADGAD],
    ["capo 3", CAPO_3],
  ] as const)("keeps the hammer-on in %s too", (_name, fretboard) => {
    const before = chainSong({ fret: 7 }, { fret: 10, articulation: "hammer_on" }, fretboard);
    const result = applyEdit(before, update(AT(0), 5, 8));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("hammer_on");
  });
});

describe("a note update says so when the link cannot survive it", () => {
  it("refuses, atomically, when the hammer-on would stop rising", () => {
    const before = HAMMER();
    // Move the source above the target: 7 -> 12 against a target of 10.
    const result = applyEdit(before, update(AT(0), 5, 12));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("articulation_conflict");
  });

  it("refuses when the pull-off would stop falling", () => {
    const result = applyEdit(PULL(), update(AT(0), 5, 3));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("articulation_conflict");
  });

  it("refuses when the target moves out of the link's reach", () => {
    // hammer_on reaches at most five semitones; 7 -> 20 is thirteen.
    const result = applyEdit(HAMMER(), update(AT(1), 5, 20));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("articulation_conflict");
  });

  it("leaves a link alone when the update lands on a different string", () => {
    /*
     * `set_note` writes one string of one slot: naming another string adds a
     * voice to the chord rather than moving the note across. The hammer-on
     * lives on the string nobody touched, so it is neither broken nor
     * silently carried onto a note that never had it.
     */
    const result = applyEdit(HAMMER(), update(AT(1), 4, 10));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = slotAt(result.song, 1);
    const notes = slot && slot !== "-" ? slot.notes : [];
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.position?.string === 5)?.articulation).toBe("hammer_on");
    expect(notes.find((n) => n.position?.string === 4)?.articulation).toBeUndefined();
  });

  it("says it in music, not in identifiers", () => {
    const result = applyEdit(HAMMER(), update(AT(0), 5, 12));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.error.message;
    expect(message).not.toMatch(/hammer_on|pull_off|Zod|validator|diagnostic|tick|slot|Error:/i);
    expect(message).toMatch(/bağlantı/i);
  });

  it("leaves the song byte-identical when it refuses", () => {
    const before = HAMMER();
    const frozen = JSON.stringify(before);
    const result = applyEdit(before, update(AT(0), 5, 12));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("does not refuse an update to a note whose link was already broken", () => {
    /*
     * A song can arrive with a hammer-on that never rose — imported, or
     * written before the rule existed. Refusing every edit on it would trap
     * the reader with no way to repair it, so the gate is "this update broke
     * it", not "it is broken".
     */
    const before = chainSong(
      { fret: 12, pitch: "E5" },
      { fret: 10, pitch: "D5", articulation: "hammer_on" },
    );
    const result = applyEdit(before, update(AT(0), 5, 11));
    expect(result.ok).toBe(true);
  });
});

describe("the three intents are said apart", () => {
  it("clears the articulation when the update asks for it", () => {
    const result = applyEdit(HAMMER(), {
      kind: "set_note",
      target: AT(1),
      stringIndex: 5,
      fret: 10,
      articulation: { kind: "clear" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBeUndefined();
    expect("articulation" in (noteAt(result.song, 1) ?? {})).toBe(false);
  });

  it("replaces the articulation when the update names another one", () => {
    const result = applyEdit(HAMMER(), {
      kind: "set_note",
      target: AT(1),
      stringIndex: 5,
      fret: 10,
      articulation: { kind: "set", articulation: "palm_mute" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 1)).toBe("palm_mute");
  });

  it("keeps it when the update says keep, which is also the default", () => {
    const asked = applyEdit(HAMMER(), {
      kind: "set_note",
      target: AT(1),
      stringIndex: 5,
      fret: 9,
      articulation: { kind: "keep" },
    });
    const silent = applyEdit(HAMMER(), update(AT(1), 5, 9));
    expect(asked.ok && silent.ok).toBe(true);
    if (!asked.ok || !silent.ok) return;
    expect(JSON.stringify(asked.song)).toBe(JSON.stringify(silent.song));
    expect(articulationAt(asked.song, 1)).toBe("hammer_on");
  });

  it("writes a fresh note with no articulation where there was none", () => {
    const before = song(
      [guitarTrack({ fretboard: E_STANDARD })],
      [section([melodicBar("gtr", restSlots(8))])],
    );
    const result = applyEdit(before, update(AT(0), 5, 7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulationAt(result.song, 0)).toBeUndefined();
  });

  it("does not mutate the song it was given", () => {
    const before = HAMMER();
    const frozen = JSON.stringify(before);
    applyEdit(before, update(AT(0), 5, 8));
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("gives the same answer five times running", () => {
    const seen = new Set<string>();
    for (let round = 0; round < 5; round += 1) {
      const result = applyEdit(HAMMER(), update(AT(0), 5, 8));
      seen.add(result.ok ? JSON.stringify(result.song) : `refused:${result.error.code}`);
    }
    expect(seen.size).toBe(1);
  });
});
