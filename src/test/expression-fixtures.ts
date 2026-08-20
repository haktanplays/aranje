/**
 * Small songs for the expression planner and the articulation validator.
 *
 * One guitar track from the demo song, one bar at a time, written slot by slot
 * so a test can say exactly which note carries which articulation.
 */
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  songSchema,
  type Articulation,
  type Bar,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

const GUITAR = SAMPLE_SONG.tracks.find((track) => track.id === "gtr");
if (!GUITAR) throw new Error("demo song has no guitar");

export const TRACK_ID = "gtr";
export const REST = null as unknown as MelodicSlot;
export const TIE = "-" as MelodicSlot;

/** One note on one string, with an optional articulation. */
export function note(
  pitch: string,
  string: number,
  fret: number,
  articulation?: Articulation,
): MelodicSlot {
  const event: NoteEvent = {
    pitch,
    position: { string, fret },
    ...(articulation === undefined ? {} : { articulation }),
  };
  return { notes: [event] };
}

export function chord(...notes: NoteEvent[]): MelodicSlot {
  return { notes };
}

export function event(
  pitch: string,
  string: number,
  fret: number,
  articulation?: Articulation,
): NoteEvent {
  return {
    pitch,
    position: { string, fret },
    ...(articulation === undefined ? {} : { articulation }),
  };
}

export function slots(prefix: readonly MelodicSlot[], count = 8): MelodicSlot[] {
  if (prefix.length > count) throw new Error("prefix longer than the bar");
  return [...prefix, ...Array.from({ length: count - prefix.length }, () => REST)];
}

export function bar(written: readonly MelodicSlot[]): Bar {
  return { timeSignature: [4, 4], resolution: 8, slots: { gtr: [...written] } };
}

/** A bar the guitar is not written in at all (spec 5.5). */
export function emptyBar(): Bar {
  return { timeSignature: [4, 4], resolution: 8, slots: {} };
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
    title: "expression fixture",
    bpm: 120,
    key: "E minor",
    tracks: [GUITAR],
    sections,
  });
  if (!parsed.success) throw new Error("fixture does not parse");
  return parsed.data;
}
