/**
 * A chord on a track that is not written in this bar yet (2Q-B §8).
 *
 * K-55 settled that a missing track key means two things at once — "silent
 * here" and "not written here" — and that a surface which refuses to write
 * into the second one leaves the reader with a track they can see and cannot
 * use. The single-note commands were taught this in §3. The chord builder was
 * not, and 2Q-B is the first checkpoint where a reader can reach it on such a
 * track: the door onto it used to be the fret sheet, which only opens on an
 * instrument that has a fretboard and therefore always had lanes.
 *
 * These tests were written red against that behaviour and are the fix's
 * ledger, not a description of it.
 */
import { describe, expect, it } from "vitest";

import { applyChordWrite } from "@/lib/chords/chord-command";
import { chordTargetAt } from "@/lib/chords/chord-target";
import { chordVoicings } from "@/lib/chords/chord-voicing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";

const KEYS = {
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
} as const;

/** A fretless track the song carries but has written nothing for. */
function withUnwrittenKeys(): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  next.tracks = [...next.tracks, { ...KEYS }];
  return songSchema.parse(next);
}

const SECTION = SAMPLE_SONG.sections[0]!.id;

function cMajor(song: Song) {
  const track = song.tracks.find((entry) => entry.id === KEYS.id)!;
  const result = chordVoicings({ track, rootPitchClass: 0, quality: "major", octave: 4 });
  expect(result.ok).toBe(true);
  return result.ok ? result.voicings[0]! : null;
}

describe("223. the chord builder reaches an unwritten lane", () => {
  it("offers a target on a bar the track has no lane in", () => {
    const song = withUnwrittenKeys();
    const target = chordTargetAt(song, {
      sectionId: SECTION,
      trackId: KEYS.id,
      barIndex: 0,
      slotIndex: 0,
      barNumber: 1,
      octave: 4,
    });
    expect(target).not.toBeNull();
    // Nothing is there, so nothing is being replaced.
    expect(target?.occupied).toBe(false);
  });

  it("writes the chord and lays the lane in the same candidate", () => {
    const song = withUnwrittenKeys();
    const voicing = cMajor(song)!;
    const target = chordTargetAt(song, {
      sectionId: SECTION,
      trackId: KEYS.id,
      barIndex: 0,
      slotIndex: 0,
      barNumber: 1,
      octave: 4,
    })!;
    const result = applyChordWrite(song, {
      sectionId: target.sectionId,
      trackId: target.trackId,
      timeTicks: target.timeTicks,
      durationTicks: target.slotTicks,
      voicing,
      velocity: 100,
      articulation: "normal",
      mode: "insert",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lane = result.song.sections[0]!.bars[0]!.slots[KEYS.id] as
      | readonly MelodicSlot[]
      | undefined;
    expect(Array.isArray(lane)).toBe(true);
    const onset = lane?.[0];
    expect(onset !== null && onset !== undefined && onset !== "-").toBe(true);
    if (onset === null || onset === undefined || onset === "-") return;
    expect(onset.notes.map((note) => note.pitch)).toEqual(["C4", "E4", "G4"]);
    // A stack has no string to sit on, so no position is written.
    expect(onset.notes.every((note) => note.position === undefined)).toBe(true);
  });

  it("leaves the rest of the section written as rests, not as holes", () => {
    const song = withUnwrittenKeys();
    const voicing = cMajor(song)!;
    const target = chordTargetAt(song, {
      sectionId: SECTION,
      trackId: KEYS.id,
      barIndex: 0,
      slotIndex: 0,
      barNumber: 1,
      octave: 4,
    })!;
    const result = applyChordWrite(song, {
      sectionId: target.sectionId,
      trackId: target.trackId,
      timeTicks: target.timeTicks,
      durationTicks: target.slotTicks,
      voicing,
      velocity: 100,
      articulation: "normal",
      mode: "insert",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lane = result.song.sections[0]!.bars[0]!.slots[KEYS.id] as readonly MelodicSlot[];
    expect(lane.slice(1).every((slot) => slot === null)).toBe(true);
  });

  it("still refuses a drum lane, which is not a place a chord can go", () => {
    const target = chordTargetAt(SAMPLE_SONG, {
      sectionId: SECTION,
      trackId: "drums",
      barIndex: 0,
      slotIndex: 0,
      barNumber: 1,
    });
    expect(target).toBeNull();
  });

  it("does not touch bars the chord never reaches", () => {
    const song = withUnwrittenKeys();
    const voicing = cMajor(song)!;
    const target = chordTargetAt(song, {
      sectionId: SECTION,
      trackId: KEYS.id,
      barIndex: 0,
      slotIndex: 0,
      barNumber: 1,
      octave: 4,
    })!;
    const result = applyChordWrite(song, {
      sectionId: target.sectionId,
      trackId: target.trackId,
      timeTicks: target.timeTicks,
      durationTicks: target.slotTicks,
      voicing,
      velocity: 100,
      articulation: "normal",
      mode: "insert",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Other sections are left exactly as they were: this command wrote in one.
    expect(
      Object.prototype.hasOwnProperty.call(
        result.song.sections[1]!.bars[0]!.slots,
        KEYS.id,
      ),
    ).toBe(false);
  });
});
