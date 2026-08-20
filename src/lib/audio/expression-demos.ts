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
import type { ExpressionPlanOptions } from "@/lib/audio/expression-plan";
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

/** A run up and back down on one string: one chain, two transitions. */
function slurRun(): Bar {
  return bar([
    { notes: [event("G3", 1, 10)] },
    TIE,
    { notes: [event("B3", 1, 14, "hammer_on")] },
    TIE,
    { notes: [event("G3", 1, 10, "pull_off")] },
    TIE, TIE, TIE,
  ]);
}

/**
 * A chord where one string is slurred and the other is held.
 *
 * This is the isolation case: the steady string must come out with no pitch
 * movement at all while the other one is being hammered or pulled.
 */
function chordWithSlur(kind: "hammer_on" | "pull_off"): Bar {
  const rising = kind === "hammer_on";
  const first = rising ? event("G3", 1, 10) : event("B3", 1, 14);
  const next = rising
    ? event("B3", 1, 14, "hammer_on")
    : event("G3", 1, 10, "pull_off");

  return bar([
    { notes: [event("E3", 0, 12), first] },
    TIE, TIE, TIE,
    { notes: [next] },
    TIE, TIE, TIE,
  ]);
}

/** One bend, one steady note, so the steady one can be checked for movement. */
function chordWithBend(): Bar {
  return bar([
    { notes: [event("E3", 0, 12), event("A3", 1, 12, "bend_full")] },
    TIE, TIE, TIE, TIE, TIE, TIE, TIE,
  ]);
}

/** A single struck note, short enough that a bend has to be squeezed. */
function shortBend(): Bar {
  return bar([
    { notes: [event("A3", 1, 12, "bend_full")] },
    { notes: [event("A3", 1, 12)] },
    TIE, TIE, TIE, TIE, TIE, TIE,
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
  /** How to plan it. Render comparisons only; the app never sets these. */
  options?: ExpressionPlanOptions;
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

/**
 * The phase 2F.1 listening pack (spec 8.5, K-22).
 *
 * Two questions are being asked here, and the pairs are built to answer each
 * on its own: does a hammer-on now sound like one note continuing rather than
 * two, and does a bend arrive like a hand rather than a ramp.
 *
 * The `-old-baseline` entries plan the way phase 2F did. They exist in this
 * list and nowhere else: there is no setting that reaches them.
 */
export const LEGATO_DEMOS: readonly ExpressionDemo[] = [
  { id: "01-normal-restrike", pairsWith: null, label: "Normal yeniden vuruş", song: demoSong([joined(undefined, true)], "Normal yeniden vurus") },
  { id: "02-hammer-on-continuous", pairsWith: "01-normal-restrike", label: "Hammer-on (sürekli voice)", song: demoSong([joined("hammer_on", true)], "Hammer-on continuous") },
  { id: "03-hammer-on-old-baseline", pairsWith: "02-hammer-on-continuous", label: "Hammer-on (eski 2F)", song: demoSong([joined("hammer_on", true)], "Hammer-on old"), options: { comparison: { legacyLegato: true } } },
  { id: "04-pull-off-continuous", pairsWith: "01-normal-restrike", label: "Pull-off (sürekli voice)", song: demoSong([joined("pull_off", false)], "Pull-off continuous") },
  { id: "05-pull-off-old-baseline", pairsWith: "04-pull-off-continuous", label: "Pull-off (eski 2F)", song: demoSong([joined("pull_off", false)], "Pull-off old"), options: { comparison: { legacyLegato: true } } },
  { id: "06-pull-off-without-aux-transient", pairsWith: "07-pull-off-with-aux-transient", label: "Pull-off, parmak sesi yok", song: demoSong([joined("pull_off", false)], "Pull-off no aux"), options: { comparison: { pullOffAuxiliary: false } } },
  { id: "07-pull-off-with-aux-transient", pairsWith: "06-pull-off-without-aux-transient", label: "Pull-off, parmak sesi var", song: demoSong([joined("pull_off", false)], "Pull-off aux") },
  { id: "08-legato-chain-5h7p5", pairsWith: "01-normal-restrike", label: "Zincir: 5h7p5", song: demoSong([slurRun()], "Legato chain") },
  { id: "09-chord-one-hammer-one-steady", pairsWith: null, label: "Akor: biri hammer, biri sabit", song: demoSong([chordWithSlur("hammer_on")], "Chord hammer") },
  { id: "10-chord-one-pull-one-steady", pairsWith: null, label: "Akor: biri pull, biri sabit", song: demoSong([chordWithSlur("pull_off")], "Chord pull") },
  { id: "11-expressive-riff", pairsWith: null, label: "Güncellenmiş expressive riff", song: demoSong(riff(), "Expressive riff v2") },
];

/** The bend v2 listening pack (spec 8.5, K-22). */
export const BEND_DEMOS: readonly ExpressionDemo[] = [
  { id: "01-bend-half-baseline", pairsWith: "02-bend-half-tight", label: "Yarım bend (eski 2F)", song: demoSong([held("bend_half")], "Bend half old"), options: { comparison: { legacyBend: true } } },
  { id: "02-bend-half-tight", pairsWith: "01-bend-half-baseline", label: "Yarım bend (tight)", song: demoSong([held("bend_half")], "Bend half tight") },
  { id: "03-bend-half-expressive", pairsWith: "02-bend-half-tight", label: "Yarım bend (expressive)", song: demoSong([held("bend_half")], "Bend half expressive"), options: { bendProfile: "expressive" } },
  { id: "04-bend-full-baseline", pairsWith: "05-bend-full-tight", label: "Tam bend (eski 2F)", song: demoSong([held("bend_full")], "Bend full old"), options: { comparison: { legacyBend: true } } },
  { id: "05-bend-full-tight", pairsWith: "04-bend-full-baseline", label: "Tam bend (tight)", song: demoSong([held("bend_full")], "Bend full tight") },
  { id: "06-bend-full-expressive", pairsWith: "05-bend-full-tight", label: "Tam bend (expressive)", song: demoSong([held("bend_full")], "Bend full expressive"), options: { bendProfile: "expressive" } },
  { id: "07-bend-full-short", pairsWith: "05-bend-full-tight", label: "Tam bend, kısa nota", song: demoSong([shortBend()], "Bend full short") },
  { id: "08-bend-full-long", pairsWith: "05-bend-full-tight", label: "Tam bend, uzun sustain", song: demoSong([held("bend_full"), held()], "Bend full long") },
  { id: "09-chord-one-bend-one-steady", pairsWith: null, label: "Akor: biri bend, biri düz", song: demoSong([chordWithBend()], "Chord bend") },
  { id: "10-expressive-riff-bend-v2", pairsWith: null, label: "Bend v2 ile expressive riff", song: demoSong(riff(), "Expressive riff bend v2") },
];
