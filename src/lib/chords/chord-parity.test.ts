/**
 * A chord written by the builder is ordinary music (2O-B §20, §21, §22).
 *
 * The whole design rests on one claim: nothing about a chord is stored, so
 * everything that already works on notes works on it unchanged. That claim is
 * only worth as much as the evidence, so this runs a builder-written chord
 * through the machinery that existed before it — selection, transform, bar
 * operations, history, export, the project file, the fingerprint and the
 * Copilot boundary — and checks the music comes back.
 */
import { describe, expect, it } from "vitest";

import { guitar, songOf } from "../../../eval/chord/fixtures";

import { applyChordWrite } from "@/lib/chords/chord-command";
import { chordVoicings, type ChordVoicing } from "@/lib/chords/chord-voicing";
import { readChord } from "@/lib/chords/chord-recognition";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { canonicalJson } from "@/lib/copilot/fingerprint";
import { buildMidiPlan } from "@/lib/export/midi-plan";
import { applyBarCommand, copyBars } from "@/lib/song/bar-transform";
import { createEditHistory, recordEdit, undo, redo, currentSong, sameSong } from "@/lib/song/edit-history";
import { pickOnsetAt } from "@/lib/song/onset-selection";
import { findSection, sectionOnsetBlocks } from "@/lib/song/onset-block";
import { applyTransform } from "@/lib/song/transform";
import { ticksPerSlot } from "@/lib/music/timing";
import { pitchToMidi } from "@/lib/music/pitch";
import type { MelodicSlot, NoteEvent, Song } from "@/lib/song/schema";

const EIGHTH = ticksPerSlot(8);

function voicing(root: number, quality: Parameters<typeof chordVoicings>[0]["quality"]): ChordVoicing {
  const found = chordVoicings({ track: guitar(), rootPitchClass: root, quality });
  if (!found.ok) throw new Error("fixture");
  return found.voicings[0]!;
}

/** A song with an A minor 7 written by the real command, at tick 0. */
function withChord(durationSlots = 1): Song {
  const result = applyChordWrite(songOf([guitar()], 2), {
    sectionId: "s1",
    trackId: "gtr",
    timeTicks: 0,
    durationTicks: EIGHTH * durationSlots,
    voicing: voicing(9, "minor_7"),
    velocity: 96,
    mode: "insert",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.song;
}

const notesAt = (song: Song, bar: number, index: number): readonly NoteEvent[] => {
  const slot = (song.sections[0]!.bars[bar]!.slots.gtr as readonly MelodicSlot[])[index];
  return slot === null || slot === "-" || slot === undefined ? [] : slot.notes;
};

const pitchesAt = (song: Song, bar: number, index: number) =>
  notesAt(song, bar, index).map((note) => note.pitch);

describe("163. selection and transform treat a chord as one onset group", () => {
  it("takes the whole chord with one press", () => {
    const song = withChord();
    const section = findSection(song, "s1")!;
    const pick = pickOnsetAt(section, "gtr", 0);
    expect(pick).not.toBeNull();
    expect(pick?.notes).toHaveLength(5);
  });

  it("counts the chord as one onset block, not five", () => {
    const song = withChord(3);
    const blocks = sectionOnsetBlocks(findSection(song, "s1")!, "gtr");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.tail).toHaveLength(2);
  });

  it("transposes the chord and keeps its intervals exactly", () => {
    const song = withChord();
    const before = pitchesAt(song, 0, 0).map((pitch) => pitchToMidi(pitch)!);
    const result = applyTransform(
      song,
      { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: EIGHTH },
      { kind: "transpose_pitch", semitones: 3 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = pitchesAt(result.song, 0, 0).map((pitch) => pitchToMidi(pitch)!);
    expect(after).toEqual(before.map((midi) => midi + 3));
    // Still a minor 7, three semitones up.
    const reading = readChord(notesAt(result.song, 0, 0));
    expect(reading.kind === "matched" && reading.matches[0]?.name).toBe("Cm7");
  });

  it("translates a power shape as a block and keeps root, fifth and octave", () => {
    const base = applyChordWrite(songOf([guitar()]), {
      sectionId: "s1",
      trackId: "gtr",
      timeTicks: 0,
      durationTicks: EIGHTH,
      voicing: voicing(9, "power"),
      velocity: 96,
      mode: "insert",
    });
    if (!base.ok) throw new Error("fixture");
    const before = pitchesAt(base.song, 0, 0).map((pitch) => pitchToMidi(pitch)!);
    const gap = before[1]! - before[0]!;

    const moved = applyTransform(
      base.song,
      { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: EIGHTH },
      { kind: "translate_fret_shape", stringDelta: 0, fretDelta: 2 },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const after = pitchesAt(moved.song, 0, 0).map((pitch) => pitchToMidi(pitch)!);
    expect(after[1]! - after[0]!).toBe(gap);
    expect(after[0]).toBe(before[0]! + 2);
  });

  it("moves, copies and repeats the chord whole", () => {
    const song = withChord();
    const selection = { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: EIGHTH };

    const moved = applyTransform(song, selection, {
      kind: "move_selection_time",
      deltaTicks: EIGHTH * 2,
    });
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(pitchesAt(moved.song, 0, 0)).toEqual([]);
      expect(pitchesAt(moved.song, 0, 2)).toHaveLength(5);
    }

    const duplicated = applyTransform(song, selection, { kind: "duplicate_selection" });
    expect(duplicated.ok).toBe(true);
    if (duplicated.ok) expect(pitchesAt(duplicated.song, 0, 1)).toHaveLength(5);

    const repeated = applyTransform(song, selection, {
      kind: "repeat_selection",
      mode: { kind: "count", count: 2 },
    });
    expect(repeated.ok).toBe(true);
    if (repeated.ok) {
      expect(pitchesAt(repeated.song, 0, 1)).toEqual(pitchesAt(song, 0, 0));
    }
  });

  it("deletes the whole chord, never a string of it", () => {
    const song = withChord();
    const result = applyTransform(
      song,
      { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: EIGHTH },
      { kind: "delete_selection" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(pitchesAt(result.song, 0, 0)).toEqual([]);
  });

  it("survives a bar copy and paste unchanged", () => {
    const song = withChord();
    const range = (bar: number) => ({
      sectionId: "s1",
      startBarIndex: bar,
      endBarIndex: bar,
      scope: "track" as const,
      trackId: "gtr",
    });
    const copied = copyBars(song, range(0));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const pasted = applyBarCommand(song, range(1), {
      kind: "paste_bar_contents",
      clipboard: copied.clipboard,
    });
    expect(pasted.ok).toBe(true);
    if (pasted.ok) expect(pitchesAt(pasted.song, 1, 0)).toEqual(pitchesAt(song, 0, 0));
  });
});

describe("164. history, export and the boundaries a chord must not cross", () => {
  it("undoes and redoes the whole chord in one step", () => {
    const empty = songOf([guitar()], 2);
    const written = withChord();
    let history = createEditHistory(empty);
    history = recordEdit(history, written, { kind: "chord", mode: "chord_insert" });

    const back = undo(history);
    expect(sameSong(currentSong(back), empty)).toBe(true);
    expect(pitchesAt(currentSong(back), 0, 0)).toEqual([]);

    const forward = redo(back);
    expect(sameSong(currentSong(forward), written)).toBe(true);
    expect(pitchesAt(currentSong(forward), 0, 0)).toHaveLength(5);
  });

  it("writes every note of the chord at one tick in the MIDI plan", () => {
    const planned = buildMidiPlan(withChord());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    /*
     * Read off the events rather than a summary: five note-ons, all sharing
     * one tick, is the claim — and it is what makes a chord a chord rather
     * than a very fast arpeggio.
     */
    const noteOns = planned.plan.tracks
      .flatMap((track) => track.events)
      .filter((event) => event.kind === "noteOn");
    expect(noteOns).toHaveLength(5);
    expect(new Set(noteOns.map((event) => event.tick)).size).toBe(1);
    expect(noteOns[0]?.tick).toBe(0);
  });

  it("carries no chord metadata into the project file", () => {
    const song = withChord();
    const exported = exportProject(song);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    for (const banned of ["chordName", "voicingId", "quality", "shapeId", "chordId", "inversion"]) {
      expect(exported.text.includes(banned), banned).toBe(false);
    }
    const back = parseProjectText(exported.text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(sameSong(back.song, song)).toBe(true);
  });

  it("changes what a Copilot request would hash, because the notes changed", () => {
    /*
     * The fingerprint is over the request, and the song inside it. Hashing
     * the canonical form of that song is the same comparison the real
     * fingerprint makes, without needing a whole request to do it with.
     */
    const empty = songOf([guitar()], 2);
    const written = withChord();
    expect(canonicalJson(written)).not.toBe(canonicalJson(empty));
    // The same chord written twice is the same music, so the same bytes.
    expect(canonicalJson(withChord())).toBe(canonicalJson(written));
  });

  it("puts nothing about the builder into the fingerprint's input", () => {
    // The fingerprint reads a Song. There is no field on a Song that could
    // carry a chord id, so the boundary holds by construction — asserted here
    // over the serialised bytes rather than by inspection.
    const text = JSON.stringify(withChord());
    for (const banned of ["voicing", "chord", "builder", "root", "power"]) {
      expect(text.toLowerCase().includes(banned), banned).toBe(false);
    }
  });
});
