/**
 * One door, both kinds of instrument (2O-B §24).
 */
import { describe, expect, it } from "vitest";

import {
  acoustic,
  bass,
  drums,
  electricPiano,
  guitar,
  nylonGuitar,
  organ,
  piano,
  stringsEnsemble,
  synth,
} from "../../../eval/chord/fixtures";

import { CHORD_MESSAGES, type ChordErrorCode } from "@/lib/chords/chord-errors";
import {
  chordVoicings,
  isHarmonicTrack,
  voicingToNotes,
} from "@/lib/chords/chord-voicing";
import { readChord } from "@/lib/chords/chord-recognition";
import { pitchClass } from "@/lib/music/pitch";
import { songSchema } from "@/lib/song/schema";
import { errorsOnly, runValidators } from "@/lib/validators";
import { songOf } from "../../../eval/chord/fixtures";

describe("157. the track decides which search answers", () => {
  it("gives a fretted track shapes with strings and frets", () => {
    for (const track of [guitar(), acoustic(), nylonGuitar(), bass()]) {
      const result = chordVoicings({
        track,
        rootPitchClass: 9,
        quality: "minor",
      });
      expect(result.ok, track.instrumentId).toBe(true);
      if (!result.ok) continue;
      expect(result.voicings.length).toBeGreaterThan(0);
      for (const voicing of result.voicings) {
        expect(voicing.kind, track.instrumentId).toBe("fretted");
      }
      for (const note of voicingToNotes(result.voicings[0]!)) {
        expect(note.position, track.instrumentId).toBeDefined();
      }
    }
  });

  it("gives a pitched instrument with no fretboard a stack of pitches", () => {
    for (const track of [piano(), electricPiano(), organ(), synth(), stringsEnsemble()]) {
      const result = chordVoicings({
        track,
        rootPitchClass: 0,
        quality: "major_7",
        octave: 4,
      });
      expect(result.ok, track.instrumentId).toBe(true);
      if (!result.ok) continue;
      for (const voicing of result.voicings) {
        expect(voicing.kind, track.instrumentId).toBe("keyboard");
      }
      for (const note of voicingToNotes(result.voicings[0]!)) {
        // No fretboard, so no position: anything else would name a string
        // that does not exist.
        expect(note.position, track.instrumentId).toBeUndefined();
      }
    }
  });

  it("refuses a drum track with a typed code and a safe sentence", () => {
    const result = chordVoicings({
      track: drums(),
      rootPitchClass: 0,
      quality: "major",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("instrument_not_harmonic");
    expect(isHarmonicTrack(drums())).toBe(false);
    // No instrument id, no diagnostic, no field name.
    expect(result.error.message).not.toContain("drum_kit");
    expect(result.error.message).not.toContain("fretboard");
  });

  it("refuses an unknown root or quality rather than guessing", () => {
    const badRoot = chordVoicings({
      track: guitar(),
      rootPitchClass: 12,
      quality: "major",
    });
    expect(!badRoot.ok && badRoot.error.code).toBe("invalid_chord_root");

    const badQuality = chordVoicings({
      track: guitar(),
      rootPitchClass: 0,
      quality: "add9" as never,
    });
    expect(!badQuality.ok && badQuality.error.code).toBe("unsupported_chord_quality");
  });

  it("has a sentence for every code, and none of them leaks", () => {
    const codes = Object.keys(CHORD_MESSAGES) as ChordErrorCode[];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const message = CHORD_MESSAGES[code];
      expect(message.length, code).toBeGreaterThan(0);
      for (const banned of ["JSON", "Zod", "localStorage", "undefined", "Error", "_"]) {
        expect(message.includes(banned), `${code} leaks ${banned}`).toBe(false);
      }
    }
  });
});

describe("158. a chosen shape becomes notes the Song Contract accepts", () => {
  it("writes one note per sounding string, in string order", () => {
    const result = chordVoicings({
      track: guitar(),
      rootPitchClass: 9,
      quality: "minor_7",
    });
    if (!result.ok) throw new Error("fixture");
    const notes = voicingToNotes(result.voicings[0]!);
    expect(notes.map((note) => note.pitch)).toEqual(["A2", "E3", "G3", "C4", "E4"]);
    expect(notes.map((note) => note.position?.string)).toEqual([1, 2, 3, 4, 5]);
    expect(notes.map((note) => note.position?.fret)).toEqual([0, 2, 0, 1, 0]);
  });

  it("dresses every note of the chord the same way", () => {
    const result = chordVoicings({ track: guitar(), rootPitchClass: 4, quality: "power" });
    if (!result.ok) throw new Error("fixture");
    const notes = voicingToNotes(result.voicings[0]!, {
      velocity: 96,
      articulation: "palm_mute",
    });
    for (const note of notes) {
      expect(note.velocity).toBe(96);
      expect(note.articulation).toBe("palm_mute");
    }
  });

  it("never writes 'normal' as an articulation", () => {
    const result = chordVoicings({ track: guitar(), rootPitchClass: 4, quality: "power" });
    if (!result.ok) throw new Error("fixture");
    for (const note of voicingToNotes(result.voicings[0]!, { articulation: "normal" })) {
      expect(Object.keys(note)).not.toContain("articulation");
    }
  });

  it("passes the strict schema and the whole validator chain", () => {
    for (const track of [guitar(), bass(), piano(), stringsEnsemble()]) {
      const result = chordVoicings({
        track,
        rootPitchClass: 9,
        quality: "minor_7",
        octave: 3,
      });
      if (!result.ok) throw new Error(track.instrumentId);
      const song = songOf([track]);
      const slots = song.sections[0]!.bars[0]!.slots[track.id] as unknown[];
      slots[0] = { notes: voicingToNotes(result.voicings[0]!, { velocity: 90 }) };

      const parsed = songSchema.safeParse(song);
      expect(parsed.success, track.instrumentId).toBe(true);
      if (!parsed.success) continue;
      expect(
        errorsOnly(runValidators(parsed.data)).map((issue) => issue.code),
        track.instrumentId,
      ).toEqual([]);
    }
  });

  it("comes back as the chord it was asked for, when all of it is sounding", () => {
    for (const track of [guitar(), piano()]) {
      const result = chordVoicings({
        track,
        rootPitchClass: 0,
        quality: "major_7",
        octave: 4,
      });
      if (!result.ok) throw new Error(track.instrumentId);
      for (const voicing of result.voicings) {
        const notes = voicingToNotes(voicing);
        const complete =
          new Set(notes.map((note) => pitchClass(note.pitch))).size === 4;
        if (!complete) continue;
        const reading = readChord(notes);
        expect(reading.kind, `${track.instrumentId} ${voicing.id}`).toBe("matched");
        if (reading.kind !== "matched") continue;
        expect(reading.matches.map((match) => match.name)).toContain("Cmaj7");
      }
    }
  });

  it("does not name a shape that dropped the fifth, and does not call it wrong", () => {
    /*
     * The two halves of this feature disagree on purpose, and both are right.
     *
     * The voicing search may leave out the fifth of a seventh chord when a
     * neck cannot reach it — the seventh already fixes the quality, and the
     * exemption is written down in the formula table. The recogniser matches
     * exact pitch-class sets and therefore has no name for what is left: C, E
     * and B are not Cmaj7, they are three notes.
     *
     * So a reader who writes such a shape sees "özel nota grubu" rather than
     * a name, and never sees their own music marked as an error. Naming it
     * Cmaj7 would be the app inventing a fifth nobody played.
     */
    const partial = [{ pitch: "C3" }, { pitch: "E3" }, { pitch: "B3" }];
    const reading = readChord(partial);
    expect(reading.kind).toBe("unknown");
  });

  it("mutates nothing it was given", () => {
    const track = guitar();
    const frozen = JSON.stringify(track);
    chordVoicings({ track, rootPitchClass: 5, quality: "major" });
    expect(JSON.stringify(track)).toBe(frozen);
  });
});
