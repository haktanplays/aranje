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
const REST = null as unknown as MelodicSlot;

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

/**
 * Two notes on one string an interval apart, the second sliding into the first.
 *
 * The source is held over four slots so the hand has somewhere to travel: a
 * slide arrives at the target's written time, so the travel happens before it
 * (spec 8.5, K-23).
 */
function slideCase(
  fromPitch: string,
  fromFret: number,
  toPitch: string,
  toFret: number,
  articulation?: Articulation,
): Bar {
  return bar([
    { notes: [event(fromPitch, 1, fromFret)] },
    TIE, TIE, TIE,
    { notes: [event(toPitch, 1, toFret, articulation)] },
    TIE, TIE, TIE,
  ]);
}

/**
 * Two notes so close together there is no time to hear a hand move.
 *
 * Sixteenths at 200bpm are 75ms apart, and 20ms of that belongs to the source
 * note, so 55ms of travel is left — well under the audible floor.
 */
function slideTooFast(): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 16,
    slots: {
      [TRACK_ID]: [
        { notes: [event("G3", 1, 10)] },
        { notes: [event("B3", 1, 14, "slide")] },
        ...Array.from({ length: 14 }, () => TIE),
      ],
    },
  };
}

/** A slide whose source is in the section before it (spec 8.5: a line alone
 * ends nothing). */
function slideAcrossSections(): [Bar, Bar] {
  return [
    bar([REST, REST, REST, REST, { notes: [event("G3", 1, 10)] }, TIE, TIE, TIE]),
    bar([{ notes: [event("B3", 1, 14, "slide")] }, TIE, TIE, TIE, TIE, TIE, TIE, TIE]),
  ];
}

/** Up and straight back down: one chain, two slides, one struck note. */
function slideRun(): Bar {
  return bar([
    { notes: [event("G3", 1, 10)] },
    TIE, TIE,
    { notes: [event("B3", 1, 14, "slide")] },
    TIE, TIE,
    { notes: [event("G3", 1, 10, "slide")] },
    TIE,
  ]);
}

/** One string slides, the other is held: the isolation case for a slide. */
function chordWithSlide(): Bar {
  return bar([
    { notes: [event("E3", 0, 12), event("G3", 1, 10)] },
    TIE, TIE, TIE,
    { notes: [event("B3", 1, 14, "slide")] },
    TIE, TIE, TIE,
  ]);
}

/** The expressive riff with a slide written into it. */
function slideRiff(): Bar[] {
  return [
    bar([
      { notes: [event("E3", 0, 12, "accent")] },
      TIE,
      { notes: [event("E3", 0, 12, "palm_mute")] },
      { notes: [event("G3", 1, 10)] },
      TIE, TIE,
      { notes: [event("B3", 1, 14, "slide")] },
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

/** The same song at a tempo nobody can slide at. */
function fastDemoSong(bars: readonly Bar[], title: string): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title,
    bpm: 200,
    key: "E minor",
    tracks: [GUITAR],
    sections: [{ id: "demo", name: "Demo", status: "fixed", bars: [...bars] }],
  });
  if (!parsed.success) throw new Error(`${title} does not parse`);
  return parsed.data;
}

/** The same thing in two sections, so a section line really is crossed. */
function twoSectionSong(bars: readonly [Bar, Bar], title: string): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title,
    bpm: 96,
    key: "E minor",
    tracks: [GUITAR],
    sections: [
      { id: "one", name: "Bir", status: "fixed", bars: [bars[0]] },
      { id: "two", name: "Iki", status: "fixed", bars: [bars[1]] },
    ],
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

/**
 * Phase 2F.2: the slide, before and after (spec 8.5, K-23).
 *
 * The question these are here to answer is one a measurement cannot: in the
 * old renders the hand movement was hidden under the target's own attack and
 * the pair came out sounding like an ordinary restrike. What is being listened
 * for is a pitch that is already moving *before* the target's written time and
 * a target that is not struck again when it arrives.
 */
export const SLIDE_DEMOS: readonly ExpressionDemo[] = [
  { id: "01-normal-two-notes", pairsWith: null, label: "Normal iki nota", song: demoSong([slideCase("G3", 10, "B3", 14)], "Normal iki nota") },
  { id: "02-slide-old-80ms", pairsWith: "03-slide-up-4st-continuous", label: "Slide (eski 2F, 80 ms)", song: demoSong([slideCase("G3", 10, "B3", 14, "slide")], "Slide old"), options: { comparison: { legacySlide: true } } },
  { id: "03-slide-up-4st-continuous", pairsWith: "01-normal-two-notes", label: "Slide yukarı 4 yarım ton", song: demoSong([slideCase("G3", 10, "B3", 14, "slide")], "Slide up 4st") },
  { id: "04-slide-down-4st-continuous", pairsWith: "03-slide-up-4st-continuous", label: "Slide aşağı 4 yarım ton", song: demoSong([slideCase("B3", 14, "G3", 10, "slide")], "Slide down 4st") },
  { id: "05-slide-up-7st-continuous", pairsWith: "03-slide-up-4st-continuous", label: "Slide yukarı 7 yarım ton", song: demoSong([slideCase("A3", 12, "E4", 19, "slide")], "Slide up 7st") },
  { id: "06-slide-down-7st-continuous", pairsWith: "05-slide-up-7st-continuous", label: "Slide aşağı 7 yarım ton", song: demoSong([slideCase("E4", 19, "A3", 12, "slide")], "Slide down 7st") },
  { id: "07-slide-fast-invalid-fallback", pairsWith: "03-slide-up-4st-continuous", label: "Çok hızlı pasaj: normale düşer", song: fastDemoSong([slideTooFast()], "Slide too fast") },
  { id: "08-slide-section-boundary", pairsWith: "03-slide-up-4st-continuous", label: "Section sınırını geçen slide", song: twoSectionSong(slideAcrossSections(), "Slide across sections") },
  { id: "09-slide-chain-up-down", pairsWith: "01-normal-two-notes", label: "Zincir: yukarı ve geri aşağı", song: demoSong([slideRun()], "Slide chain") },
  { id: "10-chord-one-slide-one-steady", pairsWith: null, label: "Akor: biri slide, biri sabit", song: demoSong([chordWithSlide()], "Chord slide") },
  { id: "11-expressive-riff-slide-v2", pairsWith: null, label: "Slide v2 ile expressive riff", song: demoSong(slideRiff(), "Expressive riff slide v2") },
];
