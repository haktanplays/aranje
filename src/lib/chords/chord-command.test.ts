/**
 * Writing a chord as one atomic edit (2O-B §24).
 *
 * The claims worth testing here are the negative ones: what the command
 * refuses, and that a refusal leaves the song it was given byte-identical.
 */
import { describe, expect, it } from "vitest";

import { guitar, piano, songOf } from "../../../eval/chord/fixtures";

import { applyChordWrite, type ChordWriteCommand } from "@/lib/chords/chord-command";
import { chordVoicings, type ChordVoicing } from "@/lib/chords/chord-voicing";
import { readChord } from "@/lib/chords/chord-recognition";
import { ticksPerSlot } from "@/lib/music/timing";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const EIGHTH = ticksPerSlot(8);

function voicingOf(
  root: number,
  quality: Parameters<typeof chordVoicings>[0]["quality"],
  track = guitar(),
): ChordVoicing {
  const result = chordVoicings({ track, rootPitchClass: root, quality, octave: 4 });
  if (!result.ok) throw new Error("fixture");
  return result.voicings[0]!;
}

const AM7 = voicingOf(9, "minor_7");
const C = voicingOf(0, "major");

const base = (overrides: Partial<ChordWriteCommand> = {}): ChordWriteCommand => ({
  sectionId: "s1",
  trackId: "gtr",
  timeTicks: 0,
  durationTicks: EIGHTH,
  voicing: AM7,
  velocity: 90,
  mode: "insert",
  ...overrides,
});

const slotsOf = (song: Song, trackId = "gtr"): readonly MelodicSlot[] =>
  song.sections[0]!.bars[0]!.slots[trackId] as readonly MelodicSlot[];

const notesAt = (song: Song, index: number) => {
  const slot = slotsOf(song)[index];
  return slot === null || slot === "-" || slot === undefined ? [] : slot.notes;
};

describe("159. a chord is written as one thing", () => {
  it("writes every note of the voicing into one slot", () => {
    const song = songOf([guitar()]);
    const result = applyChordWrite(song, base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notes = notesAt(result.song, 0);
    expect(notes.map((note) => note.pitch)).toEqual(["A2", "E3", "G3", "C4", "E4"]);
    const reading = readChord(notes);
    expect(reading.kind === "matched" && reading.matches[0]?.name).toBe("Am7");
    expect(result.written).toEqual([{ barIndex: 0, slotIndex: 0 }]);
  });

  it("gives every note the one velocity and the one articulation", () => {
    const result = applyChordWrite(
      songOf([guitar()]),
      base({ velocity: 110, articulation: "palm_mute" }),
    );
    if (!result.ok) throw new Error("expected ok");
    for (const note of notesAt(result.song, 0)) {
      expect(note.velocity).toBe(110);
      expect(note.articulation).toBe("palm_mute");
    }
  });

  it("carries a longer chord with ties, not with repeated strikes", () => {
    const result = applyChordWrite(
      songOf([guitar()]),
      base({ durationTicks: EIGHTH * 3 }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(slotsOf(result.song)[1]).toBe("-");
    expect(slotsOf(result.song)[2]).toBe("-");
    expect(slotsOf(result.song)[3]).toBe(null);
    expect(result.written).toHaveLength(3);
  });

  it("leaves the song it was given untouched, whatever happens", () => {
    const song = songOf([guitar()]);
    const frozen = JSON.stringify(song);
    applyChordWrite(song, base());
    applyChordWrite(song, base({ timeTicks: 7 }));
    applyChordWrite(song, base({ mode: "replace_onset" }));
    expect(JSON.stringify(song)).toBe(frozen);
  });

  it("answers the same bytes five runs over", () => {
    const song = songOf([guitar()]);
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(applyChordWrite(song, base({ durationTicks: EIGHTH * 2 }))),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("writes a keyboard chord with no position at all", () => {
    const song = songOf([piano()]);
    const result = applyChordWrite(
      song,
      base({
        trackId: "piano",
        voicing: voicingOf(0, "major_7", piano()),
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    const notes = (result.song.sections[0]!.bars[0]!.slots.piano as MelodicSlot[])[0];
    if (notes === null || notes === "-" || notes === undefined) throw new Error("no notes");
    expect(notes.notes.map((note) => note.pitch)).toEqual(["C4", "E4", "G4", "B4"]);
    for (const note of notes.notes) expect(note.position).toBeUndefined();
  });
});

describe("160. the moment is a tick, and it has to exist", () => {
  it("finds the slot that starts exactly there", () => {
    const result = applyChordWrite(
      songOf([guitar()]),
      base({ timeTicks: EIGHTH * 5 }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.written).toEqual([{ barIndex: 0, slotIndex: 5 }]);
  });

  it("refuses a moment no slot begins on, and rounds nothing", () => {
    for (const ticks of [1, EIGHTH - 1, EIGHTH + 1]) {
      const result = applyChordWrite(songOf([guitar()]), base({ timeTicks: ticks }));
      expect(result.ok, String(ticks)).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("target_grid_incompatible");
    }
  });

  it("refuses a duration that would end halfway through a slot", () => {
    const result = applyChordWrite(
      songOf([guitar()]),
      base({ durationTicks: EIGHTH + 1 }),
    );
    expect(!result.ok && result.error.code).toBe("duration_not_representable");
  });

  it("refuses a duration that runs past the end of the section", () => {
    const result = applyChordWrite(
      songOf([guitar()]),
      base({ durationTicks: EIGHTH * 100 }),
    );
    expect(!result.ok && result.error.code).toBe("duration_not_representable");
  });

  it("writes exactly onto a mixed-grid bar when the moment lines up", () => {
    // Bar one is 1/8, bar two is 1/12. The second bar starts at 8 * 96 ticks
    // and its first slot is a real moment; the one after it is not on the
    // eighth-note grid at all.
    const song = songOf([guitar()], 2);
    song.sections[0]!.bars[1] = {
      timeSignature: [4, 4],
      resolution: 12,
      slots: { gtr: Array.from({ length: 12 }, () => null) },
    };
    const barTwo = EIGHTH * 8;

    const onGrid = applyChordWrite(song, base({ timeTicks: barTwo, durationTicks: ticksPerSlot(12) }));
    expect(onGrid.ok).toBe(true);
    if (onGrid.ok) expect(onGrid.written).toEqual([{ barIndex: 1, slotIndex: 0 }]);

    const offGrid = applyChordWrite(song, base({ timeTicks: barTwo + EIGHTH }));
    expect(!offGrid.ok && offGrid.error.code).toBe("target_grid_incompatible");
  });

  /*
   * This test used to assert the opposite: that a bar the track is not
   * written in was refused. That expectation predates K-55, which settled
   * that a missing track key means "not written here" and that a surface
   * refusing to write into it leaves the reader with a track they can see and
   * cannot use. 2Q-B is the first checkpoint where a reader can reach the
   * chord builder on such a bar — the old door onto it was the fret sheet,
   * which only opens on an instrument that always had lanes — so the rule the
   * single-note commands already follow is applied here too.
   *
   * "Inventing slots" was the right worry and the answer is unchanged: the
   * lane is laid empty, inside this command's own candidate, only in the bars
   * the chord actually reaches, and the song is never written twice.
   */
  it("lays the lane in a bar the track is not written in, inside its own candidate", () => {
    const song = songOf([guitar()], 2);
    delete song.sections[0]!.bars[1]!.slots.gtr;
    const result = applyChordWrite(song, base({ timeTicks: EIGHTH * 8 }));
    expect(result.ok).toBe(true);
    // The song handed in is untouched: the lane exists only in the candidate.
    expect(song.sections[0]!.bars[1]!.slots.gtr).toBeUndefined();
    if (!result.ok) return;
    const lane = result.song.sections[0]!.bars[1]!.slots.gtr as MelodicSlot[];
    expect(Array.isArray(lane)).toBe(true);
    expect(lane[0]).not.toBeNull();
    expect(lane.slice(1).every((slot) => slot === null || slot === "-")).toBe(true);
  });
});

/** Put a chord in the first slot so the refusals have something to refuse. */
function withExisting(
  notes: readonly { pitch: string; velocity?: number; articulation?: string }[],
  tail: number = 0,
): Song {
  const song = songOf([guitar()]);
  const slots = song.sections[0]!.bars[0]!.slots.gtr as MelodicSlot[];
  slots[0] = { notes: notes.map((note) => ({ ...note }) as never) };
  for (let index = 1; index <= tail; index += 1) slots[index] = "-";
  return song;
}

describe("161. an occupied vuruş is never written over by accident", () => {
  it("refuses to insert where notes already are", () => {
    const song = withExisting([{ pitch: "E2", velocity: 90 }]);
    const result = applyChordWrite(song, base());
    expect(!result.ok && result.error.code).toBe("target_occupied");
    // The message tells the reader what to press, not what went wrong inside.
    expect(!result.ok && result.error.message).toContain("Bu vuruşu akorla değiştir");
  });

  it("replaces the whole onset when the reader says so", () => {
    const song = withExisting([
      { pitch: "E2", velocity: 90 },
      { pitch: "B2", velocity: 90 },
    ]);
    const result = applyChordWrite(song, base({ mode: "replace_onset" }));
    if (!result.ok) throw new Error("expected ok");
    // Every note of the old onset is gone; none of them survives beside the
    // new chord on a string the new chord does not use.
    expect(notesAt(result.song, 0).map((note) => note.pitch)).toEqual([
      "A2",
      "E3",
      "G3",
      "C4",
      "E4",
    ]);
  });

  it("takes the old onset's tie tail with it", () => {
    const song = withExisting([{ pitch: "E2", velocity: 90 }], 3);
    const result = applyChordWrite(song, base({ mode: "replace_onset" }));
    if (!result.ok) throw new Error("expected ok");
    // The new chord is one slot long, so the three slots the old note was
    // still sounding through become silence rather than orphaned ties.
    expect(slotsOf(result.song)[1]).toBe(null);
    expect(slotsOf(result.song)[2]).toBe(null);
    expect(slotsOf(result.song)[3]).toBe(null);
  });

  it("does not touch the onset after it", () => {
    const song = withExisting([{ pitch: "E2", velocity: 90 }]);
    const slots = song.sections[0]!.bars[0]!.slots.gtr as MelodicSlot[];
    slots[4] = { notes: [{ pitch: "G3", velocity: 70 }] };
    const before = JSON.stringify(slots[4]);

    const result = applyChordWrite(song, base({ mode: "replace_onset" }));
    if (!result.ok) throw new Error("expected ok");
    expect(JSON.stringify(slotsOf(result.song)[4])).toBe(before);
  });

  it("refuses to run a longer chord into the next onset", () => {
    const song = songOf([guitar()]);
    const slots = song.sections[0]!.bars[0]!.slots.gtr as MelodicSlot[];
    slots[2] = { notes: [{ pitch: "G3", velocity: 70 }] };
    const result = applyChordWrite(song, base({ durationTicks: EIGHTH * 4 }));
    expect(!result.ok && result.error.code).toBe("target_occupied");
  });
});

describe("162. bağlı ve karışık vuruşlar atomik olarak reddedilir", () => {
  it("refuses a tie continuation as a place to start", () => {
    const song = withExisting([{ pitch: "E2", velocity: 90 }], 2);
    for (const mode of ["insert", "replace_onset"] as const) {
      const result = applyChordWrite(song, base({ timeTicks: EIGHTH, mode }));
      expect(!result.ok && result.error.code, mode).toBe("target_is_tie_continuation");
    }
  });

  it("refuses an onset whose notes are bonded to the next one", () => {
    for (const articulation of ["slide", "hammer_on", "pull_off"] as const) {
      const song = withExisting([{ pitch: "E2", velocity: 90, articulation }]);
      const result = applyChordWrite(song, base({ mode: "replace_onset" }));
      expect(!result.ok && result.error.code, articulation).toBe("chord_target_linked");
      expect(!result.ok && result.error.message).toContain("bağlantıyı");
      // No raw articulation id ever reaches the reader.
      expect(!result.ok && result.error.message).not.toContain(articulation);
    }
  });

  it("refuses an onset a bond reaches into from the slot before", () => {
    const song = songOf([guitar()]);
    const slots = song.sections[0]!.bars[0]!.slots.gtr as MelodicSlot[];
    slots[0] = { notes: [{ pitch: "E2", velocity: 90, articulation: "slide" }] };
    slots[1] = { notes: [{ pitch: "F#2", velocity: 90 }] };
    const result = applyChordWrite(
      song,
      base({ timeTicks: EIGHTH, mode: "replace_onset" }),
    );
    expect(!result.ok && result.error.code).toBe("chord_target_linked");
  });

  it("refuses an onset whose notes disagree about velocity", () => {
    const song = withExisting([
      { pitch: "E2", velocity: 40 },
      { pitch: "B2", velocity: 110 },
    ]);
    const result = applyChordWrite(song, base({ mode: "replace_onset" }));
    expect(!result.ok && result.error.code).toBe("mixed_onset_velocity");
  });

  it("refuses an onset whose notes disagree about expression", () => {
    const song = withExisting([
      { pitch: "E2", velocity: 90, articulation: "palm_mute" },
      { pitch: "B2", velocity: 90 },
    ]);
    const result = applyChordWrite(song, base({ mode: "replace_onset" }));
    expect(!result.ok && result.error.code).toBe("mixed_onset_expression");
  });

  it("allows an onset whose notes agree, whatever they agree on", () => {
    const song = withExisting([
      { pitch: "E2", velocity: 70, articulation: "palm_mute" },
      { pitch: "B2", velocity: 70, articulation: "palm_mute" },
    ]);
    const result = applyChordWrite(song, base({ mode: "replace_onset" }));
    expect(result.ok).toBe(true);
  });

  it("changes nothing at all when it refuses", () => {
    const songs: Song[] = [
      withExisting([{ pitch: "E2", velocity: 90, articulation: "slide" }]),
      withExisting([{ pitch: "E2", velocity: 40 }, { pitch: "B2", velocity: 110 }]),
      withExisting([{ pitch: "E2", velocity: 90 }], 2),
    ];
    for (const song of songs) {
      const frozen = JSON.stringify(song);
      applyChordWrite(song, base({ mode: "replace_onset" }));
      applyChordWrite(song, base({ timeTicks: EIGHTH, mode: "replace_onset" }));
      expect(JSON.stringify(song)).toBe(frozen);
    }
  });

  it("refuses a chord that would change nothing", () => {
    const first = applyChordWrite(songOf([guitar()]), base());
    if (!first.ok) throw new Error("expected ok");
    const again = applyChordWrite(first.song, base({ mode: "replace_onset" }));
    expect(!again.ok && again.error.code).toBe("chord_no_change");
  });

  it("refuses a voicing whose notes the validators reject", () => {
    // A chord written on a track that has no slots for this bar cannot be
    // settled, and the refusal is atomic rather than partial.
    const song = songOf([guitar()]);
    const result = applyChordWrite(song, base({ trackId: "nope" }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(song)).toBe(JSON.stringify(songOf([guitar()])));
  });

  it("keeps the C major chord and the Am7 chord apart", () => {
    const first = applyChordWrite(songOf([guitar()]), base({ voicing: C }));
    if (!first.ok) throw new Error("expected ok");
    expect(notesAt(first.song, 0).map((note) => note.pitch)).toEqual([
      "C3",
      "E3",
      "G3",
      "C4",
      "E4",
    ]);
  });
});
