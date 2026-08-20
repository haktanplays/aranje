/**
 * The A/B pairs the expressive layer is listened to with (spec 8.5, K-21).
 *
 * Each case is the **same** written music twice: once plain, once with one
 * articulation on it. That is the only way to judge whether an articulation is
 * doing something musical rather than merely doing something — a render on its
 * own tells you a sound came out, not whether it is the right sound.
 *
 * These are listening outputs for a person. No test in this repository claims
 * they sound good.
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

const TRACK_ID = "gtr";
const TIE = "-" as MelodicSlot;

function event(
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

function bar(slots: readonly MelodicSlot[]): Bar {
  return { timeSignature: [4, 4], resolution: 8, slots: { [TRACK_ID]: [...slots] } };
}

/** One note struck on the downbeat and held for the whole bar. */
function held(articulation?: Articulation): Bar {
  return bar([
    { notes: [event("A3", 1, 12, articulation)] },
    TIE, TIE, TIE, TIE, TIE, TIE, TIE,
  ]);
}

/** Two notes on one string, the second touching the first (spec 8.5). */
function joined(second: Articulation | undefined, rising: boolean): Bar {
  const low = event("G3", 1, 10);
  const high = event("B3", 1, 14, rising ? second : undefined);
  const first = rising ? low : event("B3", 1, 14);
  const next = rising ? high : event("G3", 1, 10, second);

  return bar([
    { notes: [first] },
    TIE, TIE, TIE,
    { notes: [next] },
    TIE, TIE, TIE,
  ]);
}

/** A two-note chord where one string shakes and the other does not. */
function mixedChord(): Bar {
  return bar([
    { notes: [event("E3", 0, 12, "vibrato"), event("B3", 1, 14)] },
    TIE, TIE, TIE, TIE, TIE, TIE, TIE,
  ]);
}

/** Everything at once, as a phrase rather than a list. */
function riff(): Bar[] {
  return [
    bar([
      { notes: [event("E3", 0, 12, "accent")] },
      TIE,
      { notes: [event("E3", 0, 12, "palm_mute")] },
      { notes: [event("G3", 1, 10)] },
      { notes: [event("B3", 1, 14, "hammer_on")] },
      TIE,
      { notes: [event("G3", 1, 10, "pull_off")] },
      TIE,
    ]),
    bar([
      { notes: [event("A3", 1, 12, "bend_full")] },
      TIE, TIE, TIE,
      { notes: [event("A3", 1, 12, "vibrato")] },
      TIE, TIE, TIE,
    ]),
  ];
}

function demoSong(bars: readonly Bar[], title: string): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title,
    bpm: 96,
    key: "E minor",
    tracks: [GUITAR],
    sections: [{ id: "demo", name: "Demo", status: "fixed", bars: [...bars] }],
  });
  if (!parsed.success) throw new Error(`${title} does not parse`);
  return parsed.data;
}

export type ExpressionDemo = {
  /** File-safe identity, used for the WAV name. */
  id: string;
  /** What a listener is being asked to compare it with. */
  pairsWith: string | null;
  label: string;
  song: Song;
};

export const EXPRESSION_DEMOS: readonly ExpressionDemo[] = [
  { id: "01-normal-sustain", pairsWith: null, label: "Normal sustain", song: demoSong([held()], "Normal sustain") },
  { id: "02-vibrato", pairsWith: "01-normal-sustain", label: "Vibrato", song: demoSong([held("vibrato")], "Vibrato") },
  { id: "03-bend-half", pairsWith: "01-normal-sustain", label: "Yarım bend", song: demoSong([held("bend_half")], "Yarim bend") },
  { id: "04-bend-full", pairsWith: "01-normal-sustain", label: "Tam bend", song: demoSong([held("bend_full")], "Tam bend") },
  { id: "05-normal-two-notes", pairsWith: null, label: "Normal iki nota", song: demoSong([joined(undefined, true)], "Normal iki nota") },
  { id: "06-slide", pairsWith: "05-normal-two-notes", label: "Slide", song: demoSong([joined("slide", true)], "Slide") },
  { id: "07-normal-restrike", pairsWith: null, label: "Normal yeniden vuruş", song: demoSong([joined(undefined, true)], "Normal yeniden vurus") },
  { id: "08-hammer-on", pairsWith: "07-normal-restrike", label: "Hammer-on", song: demoSong([joined("hammer_on", true)], "Hammer-on") },
  { id: "09-pull-off", pairsWith: "07-normal-restrike", label: "Pull-off", song: demoSong([joined("pull_off", false)], "Pull-off") },
  { id: "10-normal-sustain-b", pairsWith: null, label: "Normal sustain (palm mute eşi)", song: demoSong([held()], "Normal sustain B") },
  { id: "11-palm-mute", pairsWith: "10-normal-sustain-b", label: "Palm mute", song: demoSong([held("palm_mute")], "Palm mute") },
  { id: "12-chord-one-vibrato", pairsWith: "01-normal-sustain", label: "Akor: biri vibrato, biri düz", song: demoSong([mixedChord()], "Akor vibrato") },
  { id: "13-expressive-riff", pairsWith: null, label: "Tam expressive riff", song: demoSong(riff(), "Expressive riff") },
];
