/**
 * The power chord pen: the root is where the finger is (2S-A §7).
 */
import { describe, expect, it } from "vitest";

import { shapesRootedAt, writePowerChord } from "@/lib/chords/power-chord-pen";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { ticksPerSlot } from "@/lib/music/timing";
import { songSchema, type Song, type Track } from "@/lib/song/schema";

const E_STANDARD = [...TUNING_PRESETS.e_standard!.tuning];
const DROP_D = [...TUNING_PRESETS.drop_d!.tuning];
const BASS = [...TUNING_PRESETS.bass_standard!.tuning];
const SLOT = ticksPerSlot(8);

function trackOf(overrides: Partial<Track> = {}): Track {
  return {
    id: "gtr",
    name: "Gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: -6,
    fretboard: { tuning: E_STANDARD, capo: 0 },
    ...overrides,
  };
}

function songOf(track: Track, written: (null | { notes: { pitch: string }[] })[] = []): Song {
  const slots = Array.from({ length: 8 }, (_, index) => written[index] ?? null);
  return songSchema.parse({
    version: 2,
    title: "pen",
    bpm: 120,
    key: "E minor",
    tracks: [track],
    sections: [
      {
        id: "s1",
        name: "S1",
        status: "fixed",
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [track.id]: slots } }],
      },
    ],
  });
}

const write = (song: Song, track: Track, extra: Record<string, unknown> = {}) =>
  writePowerChord({
    song,
    track,
    sectionId: "s1",
    timeTicks: 0,
    durationTicks: SLOT,
    stringIndex: 0,
    fret: 5,
    voices: 2,
    mode: "insert",
    ...extra,
  });

/** The notes written into the first slot of the first bar. */
function slotNotes(song: Song, trackId = "gtr") {
  const slot = song.sections[0]!.bars[0]!.slots[trackId]![0];
  if (!slot || slot === "-" || Array.isArray(slot)) return [];
  return slot.notes;
}

describe("305. the root is the string and fret the finger touched", () => {
  it("writes the touched note as the lowest sounding note", () => {
    const track = trackOf();
    const result = write(songOf(track), track);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The thickest string is index 0, and its fifth fret is A2.
    expect(result.rootPitch).toBe("A2");
    expect(slotNotes(result.song)[0]?.position).toEqual({ string: 0, fret: 5 });
  });

  it("offers no shape whose lowest note sits under the finger", () => {
    const shapes = shapesRootedAt({ tuning: E_STANDARD, capo: 0 }, 0, 5, 2);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.strings[0]).toMatchObject({ kind: "played", fret: 5 });
      expect(shape.bassPitch).toBe("A2");
    }
  });

  it("writes two voices as root and fifth", () => {
    const track = trackOf();
    const result = write(songOf(track), track);
    if (!result.ok) throw new Error("refused");
    const notes = slotNotes(result.song);
    expect(notes).toHaveLength(2);
    expect(notes.map((note) => note.pitch)).toEqual(["A2", "E3"]);
  });

  it("writes three voices as root, fifth and the octave above the root", () => {
    const track = trackOf();
    const result = write(songOf(track), track, { voices: 3 });
    if (!result.ok) throw new Error("refused");
    const notes = slotNotes(result.song);
    expect(notes).toHaveLength(3);
    expect(notes.map((note) => note.pitch)).toEqual(["A2", "E3", "A3"]);
  });

  it("puts every note in one onset rather than in several slots", () => {
    const track = trackOf();
    const result = write(songOf(track), track, { voices: 3 });
    if (!result.ok) throw new Error("refused");
    const lane = result.song.sections[0]!.bars[0]!.slots.gtr!;
    expect(lane[1]).toBeNull();
    expect(slotNotes(result.song)).toHaveLength(3);
  });

  it("writes the position explicitly, so nothing has to guess it back", () => {
    const track = trackOf();
    const result = write(songOf(track), track, { voices: 3 });
    if (!result.ok) throw new Error("refused");
    for (const note of slotNotes(result.song)) {
      expect(note.position).toBeDefined();
    }
  });

  it("uses the engine's own default velocity, not a second one", () => {
    const track = trackOf();
    const result = write(songOf(track), track);
    if (!result.ok) throw new Error("refused");
    for (const note of slotNotes(result.song)) expect(note.velocity).toBe(96);
  });
});

describe("306. the fretboard the track actually has", () => {
  it("follows Drop D rather than assuming standard tuning", () => {
    const track = trackOf({ fretboard: { tuning: DROP_D, capo: 0 } });
    const result = write(songOf(track), track);
    if (!result.ok) throw new Error("refused");
    // The thickest string of Drop D is D2, so its fifth fret is G2.
    expect(result.rootPitch).toBe("G2");
  });

  it("keeps capo-relative fret semantics", () => {
    const open = trackOf();
    const capo = trackOf({ fretboard: { tuning: E_STANDARD, capo: 3 } });
    const a = write(songOf(open), open);
    const b = write(songOf(capo), capo);
    if (!a.ok || !b.ok) throw new Error("refused");
    // The same written fret sounds three semitones higher behind a capo, and
    // the number written into the Song is the same 5 either way.
    expect(a.rootPitch).toBe("A2");
    expect(b.rootPitch).toBe("C3");
    expect(slotNotes(a.song)[0]?.position).toEqual({ string: 0, fret: 5 });
    expect(slotNotes(b.song)[0]?.position).toEqual({ string: 0, fret: 5 });
  });

  it("works on a bass", () => {
    const bass = trackOf({
      id: "bass",
      instrumentId: "electric_bass",
      presetId: "finger",
      fretboard: { tuning: BASS, capo: 0 },
    });
    const result = writePowerChord({
      song: songOf(bass),
      track: bass,
      sectionId: "s1",
      timeTicks: 0,
      durationTicks: SLOT,
      stringIndex: 0,
      fret: 5,
      voices: 2,
      mode: "insert",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a drum track by name rather than writing something", () => {
    const drums = trackOf({
      id: "drums",
      instrumentId: "drum_kit",
      presetId: "acoustic",
      fretboard: undefined,
    });
    const result = write(songOf(drums), drums);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("instrument_not_harmonic");
  });

  it("refuses a fretless harmonic track rather than inventing frets", () => {
    const piano = trackOf({
      id: "pno",
      instrumentId: "acoustic_piano",
      presetId: "grand",
      fretboard: undefined,
    });
    const result = write(songOf(piano), piano);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("power_chord_needs_fretboard");
    expect(result.error.message).not.toMatch(/_/);
  });

  it("refuses a root the fretboard cannot build a fifth above", () => {
    // The thinnest string near the top of the neck has nothing above it.
    const track = trackOf();
    const result = write(songOf(track), track, { stringIndex: 5, fret: 20 });
    expect(result.ok).toBe(false);
    // By name, not merely "no". "Bir şey olmadı" is not a refusal a reader
    // can act on, and the code is what the message table is keyed by.
    expect(result.ok === false ? result.error.code : null).toBe(
      "power_chord_root_unreachable",
    );
  });

  it("puts nothing under the finger, whichever string it lands on", () => {
    /*
     * The root is the lowest sounding note, which is why the search filters on
     * pitch rather than on string index. Asked on every string the shape can
     * be rooted on, no candidate may sound anything below the note the finger
     * is actually holding — a chord that does is a different chord, however
     * right its pitch classes are.
     */
    const track = trackOf();
    const board = track.fretboard!;
    let checked = 0;
    for (const stringIndex of [0, 1, 2, 3]) {
      for (const voices of [2, 3] as const) {
        // Not every string can carry every size — the octave of a shape rooted
        // near the top has nowhere to go — so an empty answer is a legitimate
        // one. What is checked is every shape that *is* offered.
        const shapes = shapesRootedAt(board, stringIndex, 5, voices);
        checked += shapes.length;
        for (const shape of shapes) {
          const root = shape.strings[stringIndex];
          if (!root || root.kind !== "played") throw new Error("root not played");
          for (const entry of shape.strings) {
            if (entry.kind !== "played") continue;
            expect(entry.midi, `${shape.id} sounds below the finger`).toBeGreaterThanOrEqual(
              root.midi,
            );
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("307. an occupied beat is never overwritten in silence", () => {
  const occupied = () =>
    songOf(trackOf(), [{ notes: [{ pitch: "E3" }] }]);

  it("refuses rather than replacing when the reader has not said so", () => {
    const track = trackOf();
    const result = write(occupied(), track);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });

  it("replaces the whole onset when the reader chose to", () => {
    const track = trackOf();
    const before = occupied();
    const result = write(before, track, { mode: "replace_onset" });
    if (!result.ok) throw new Error("refused");
    expect(slotNotes(result.song).map((note) => note.pitch)).toEqual(["A2", "E3"]);
  });

  it("leaves the next beat alone when it replaces one", () => {
    const track = trackOf();
    const before = songOf(track, [
      { notes: [{ pitch: "E3" }] },
      { notes: [{ pitch: "G3" }] },
    ]);
    const result = write(before, track, { mode: "replace_onset" });
    if (!result.ok) throw new Error("refused");
    const lane = result.song.sections[0]!.bars[0]!.slots.gtr!;
    expect(lane[1]).toEqual({ notes: [{ pitch: "G3" }] });
  });

  it("refuses a beat that is somebody else's note still sounding", () => {
    const track = trackOf();
    const before = songOf(track, [{ notes: [{ pitch: "E3" }] }]);
    const lane = before.sections[0]!.bars[0]!.slots.gtr!;
    (lane as unknown[])[1] = "-";
    const result = writePowerChord({
      song: before,
      track,
      sectionId: "s1",
      timeTicks: SLOT,
      durationTicks: SLOT,
      stringIndex: 0,
      fret: 5,
      voices: 2,
      mode: "insert",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_is_tie_continuation");
  });
});

describe("308. the pen is a pure function of the song it was given", () => {
  it("never touches the song it was handed", () => {
    const track = trackOf();
    const before = songOf(track);
    const snapshot = JSON.stringify(before);
    write(before, track);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("gives the same bytes five times running", () => {
    const track = trackOf();
    const runs = Array.from({ length: 5 }, () => write(songOf(track), track));
    const first = runs[0];
    if (!first?.ok) throw new Error("refused");
    for (const run of runs) {
      expect(run.ok).toBe(true);
      if (run.ok) expect(JSON.stringify(run.song)).toBe(JSON.stringify(first.song));
    }
  });

  it("writes nothing at all when it refuses", () => {
    const track = trackOf();
    const before = occupiedSong(track);
    const snapshot = JSON.stringify(before);
    const result = write(before, track);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("says every refusal in words a musician can act on", () => {
    const track = trackOf();
    const result = write(occupiedSong(track), track);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.message).toMatch(/[a-zçğıöşü]/i);
    expect(result.error.message).not.toMatch(/undefined|null|Error|_/);
  });
});

function occupiedSong(track: Track): Song {
  return songOf(track, [{ notes: [{ pitch: "E3" }] }]);
}
