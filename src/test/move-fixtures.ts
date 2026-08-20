/**
 * Small hand-written songs for the onset-block and group-move tests.
 *
 * One guitar track, taken from the demo song so the tuning and instrument are
 * real, and bars written slot by slot so each test says exactly what it means.
 */
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Bar, type MelodicSlot, type Song } from "@/lib/song/schema";

const GUITAR = SAMPLE_SONG.tracks.find((track) => track.id === "gtr");
if (!GUITAR) throw new Error("demo song has no guitar");

export const TRACK_ID = "gtr";
export const REST = null as unknown as MelodicSlot;
export const TIE = "-" as MelodicSlot;

export function note(pitch: string, string: number, fret: number): MelodicSlot {
  return { notes: [{ pitch, position: { string, fret } }] };
}

/** Pads a written prefix out to a whole bar of rests. */
export function slots(prefix: readonly MelodicSlot[], count = 8): MelodicSlot[] {
  if (prefix.length > count) throw new Error("prefix longer than the bar");
  return [
    ...prefix,
    ...Array.from({ length: count - prefix.length }, () => REST),
  ];
}

export function bar(written: readonly MelodicSlot[], resolution: 8 | 16 = 8): Bar {
  return { timeSignature: [4, 4], resolution, slots: { gtr: [...written] } };
}

/** A bar the guitar is not written in at all (spec 5.5). */
export function emptyBar(resolution: 8 | 16 = 8): Bar {
  return { timeSignature: [4, 4], resolution, slots: {} };
}

export function song(bars: readonly Bar[], second: readonly Bar[] = []): Song {
  const sections = [
    { id: "s1", name: "S1", status: "fixed" as const, bars: [...bars] },
    ...(second.length > 0
      ? [{ id: "s2", name: "S2", status: "fixed" as const, bars: [...second] }]
      : []),
  ];
  const parsed = songSchema.safeParse({
    version: 2,
    title: "move fixture",
    bpm: 120,
    key: "E minor",
    tracks: [GUITAR],
    sections,
  });
  if (!parsed.success) throw new Error("fixture does not parse");
  return parsed.data;
}

export function sectionOf(target: Song, id = "s1") {
  const section = target.sections.find((entry) => entry.id === id);
  if (!section) throw new Error(`no section ${id}`);
  return section;
}

/** The guitar's slots of one bar, as a readable list of tokens. */
export function readBar(target: Song, barIndex: number, sectionId = "s1"): string[] {
  const bar = sectionOf(target, sectionId).bars[barIndex];
  const written = bar?.slots[TRACK_ID];
  if (!Array.isArray(written)) return [];
  return written.map((slot) => {
    if (slot === null) return ".";
    if (slot === "-") return "-";
    if (Array.isArray(slot)) return "!";
    return slot.notes.map((entry) => entry.pitch).join("+");
  });
}
