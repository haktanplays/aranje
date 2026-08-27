/**
 * The whole shape a pen would write (K-59 §6).
 */
import { describe, expect, it } from "vitest";

import { penGhost } from "@/lib/tab/pen-ghost";
import { writePowerChord } from "@/lib/chords/power-chord-pen";
import { sectionSlotStream } from "@/lib/song/onset-block";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import type { Song } from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;

const song = (): Song => ({
  version: 2,
  title: "K-59 ghost",
  bpm: 120,
  key: "E minor",
  tracks: [
    {
      id: "gtr",
      name: "Gitar",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: -6,
      fretboard: { tuning: [...E_STANDARD], capo: 0 },
    },
  ],
  sections: [
    {
      id: "s1",
      name: "Bölüm 1",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: { gtr: Array.from({ length: 8 }, () => null) },
        },
      ],
    },
  ],
});

/** The command the tap would run, exactly as `previewPen` runs it. */
function preview(base: Song, voices: 2 | 3, fret: number): Song | null {
  const section = base.sections[0]!;
  const stream = sectionSlotStream(section, "gtr");
  const at = stream.find((entry) => entry.barIndex === 0 && entry.slotIndex === 0);
  if (!at) return null;
  const result = writePowerChord({
    song: base,
    track: base.tracks[0]!,
    sectionId: "s1",
    timeTicks: at.startTicks,
    durationTicks: at.durationTicks,
    stringIndex: 1,
    fret,
    voices,
    mode: "insert",
  });
  return result.ok ? result.song : null;
}

describe("the armed pen shows its whole shape", () => {
  it("draws two voices for a two-voice pen", () => {
    const base = song();
    const ghost = penGhost({
      preview: preview(base, 2, 5),
      current: base,
      trackId: "gtr",
      barKey: "s1:0",
      slotIndex: 0,
    });
    expect(ghost?.notes).toHaveLength(2);
    expect(ghost?.slotIndex).toBe(0);
    expect(ghost?.barKey).toBe("s1:0");
  });

  it("draws three voices for a three-voice pen, on one onset", () => {
    const base = song();
    const ghost = penGhost({
      preview: preview(base, 3, 5),
      current: base,
      trackId: "gtr",
      barKey: "s1:0",
      slotIndex: 0,
    });
    expect(ghost?.notes).toHaveLength(3);
    // Every voice is a real string and a real fret — never one faint digit
    // with the rest left to the imagination.
    expect(ghost?.notes.every((note) => note.stringIndex >= 0)).toBe(true);
    expect(ghost?.notes.every((note) => note.fret !== null)).toBe(true);
    expect(new Set(ghost?.notes.map((note) => note.stringIndex)).size).toBe(3);
  });

  it("puts the voices in string order so the layer can draw rows", () => {
    const base = song();
    const ghost = penGhost({
      preview: preview(base, 3, 7),
      current: base,
      trackId: "gtr",
      barKey: "s1:0",
      slotIndex: 0,
    });
    const strings = ghost?.notes.map((note) => note.stringIndex) ?? [];
    expect([...strings].sort((a, b) => a - b)).toEqual(strings);
  });

  it("shows nothing when the command was refused", () => {
    const base = song();
    expect(
      penGhost({
        preview: null,
        current: base,
        trackId: "gtr",
        barKey: "s1:0",
        slotIndex: 0,
      }),
    ).toBeNull();
  });

  it("shows nothing when the preview would change nothing", () => {
    /*
     * A ghost drawn exactly on top of the notes that are already there says
     * something is about to happen when nothing is.
     */
    const base = song();
    const written = preview(base, 3, 5);
    expect(written).not.toBeNull();
    expect(
      penGhost({
        preview: written,
        current: written as Song,
        trackId: "gtr",
        barKey: "s1:0",
        slotIndex: 0,
      }),
    ).toBeNull();
  });

  it("shows nothing for a bar or a track that is not there", () => {
    const base = song();
    const written = preview(base, 2, 5);
    for (const wrong of [
      { barKey: "s1:9", slotIndex: 0, trackId: "gtr" },
      { barKey: "s9:0", slotIndex: 0, trackId: "gtr" },
      { barKey: "s1:0", slotIndex: 0, trackId: "bass" },
      { barKey: "s1:0", slotIndex: 3, trackId: "gtr" },
    ]) {
      expect(
        penGhost({ preview: written, current: base, ...wrong }),
      ).toBeNull();
    }
  });

  it("never touches the song it was given", () => {
    const base = song();
    const before = JSON.stringify(base);
    penGhost({
      preview: preview(base, 3, 5),
      current: base,
      trackId: "gtr",
      barKey: "s1:0",
      slotIndex: 0,
    });
    expect(JSON.stringify(base)).toBe(before);
  });
});
