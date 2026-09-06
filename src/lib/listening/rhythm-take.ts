/**
 * The three bars the founder listens to this round (2V-D.2 c3 §12–§14).
 *
 * ## Why these are built rather than borrowed
 *
 * The acceptance song is in 4/4. The questions this round asks are about 6/8,
 * about how a 7/8 is grouped, and about what happens when the metre changes
 * under a phrase — none of which exists in a 4/4 bar. So each take appends
 * its own bar or bars to a copy of the song, in the metre the card is about,
 * and writes notes into it through the ordinary path.
 *
 * ## The accents are notes, not clicks
 *
 * L31's whole claim is that `2+2+3` and `3+2+2` are *different music*, and it
 * would be worthless if the difference were the metronome. So the two takes
 * carry identical pitches, identical durations, identical bar length and
 * identical tempo, and differ **only** in which notes have `attack: "accent"`
 * — which reaches the speakers through the production attack layer as a real
 * gain change on a real note. Nothing here schedules a click, adds a
 * transient, or introduces a second voice.
 *
 * ## What each take is
 *
 * - `L30a` — 6/8 felt `3+3`, straight eighths with a run of sixteenth
 *   triplets inside the second main beat. Two loops of the same bar, so a
 *   drift at the bar line would be audible as the second loop arriving early
 *   or late.
 * - `L31a` / `L31b` — the same seven-eighth riff, accented `2+2+3` and
 *   `3+2+2`.
 * - `L32a` — a 7/8 bar followed by a 6/8 bar, with one phrase written across
 *   the line and a note held over it, so what is being listened to is
 *   musical continuity at a metre change rather than a piece of metadata.
 */
import { songSupport } from "@/lib/acceptance/song-support";
import { barTicks, type Resolution, type TimeSignature } from "@/lib/music/timing";
import { pitchAt, settle } from "@/lib/song/edit";
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type NoteAttack,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

export const RHYTHM_TAKE_IDS = [
  "L30a",
  "L31a",
  "L31b",
  "L32a",
  "L33a",
  "L33b",
  "L34a",
  "L35a",
] as const;

export type RhythmTakeId = (typeof RHYTHM_TAKE_IDS)[number];

export type RhythmTake = {
  readonly song: Song;
  /** 1-based, across the song. The clip windows on this and the next. */
  readonly barNumber: number;
  /** How many bars the card listens to. */
  readonly barCount: number;
  readonly trackId: string;
  /** For the render check: how long the listened bars last, in ticks. */
  readonly ticks: number;
};

export type RhythmTakes = Readonly<Record<RhythmTakeId, RhythmTake>>;

/** The string these cards are written on, as everywhere else in the pack. */
const STRING = 1;

/** One bar's worth of instructions: which slot, which fret, struck how. */
type Hit = {
  readonly slot: number;
  readonly fret: number;
  /** What the picking hand does. Absent means an ordinary struck note. */
  readonly attack?: NoteAttack;
  /** Slots of tie after it, so a note can be held over a bar line. */
  readonly hold?: number;
  /** How the string was struck, for the one card that asks about vibrato. */
  readonly articulation?: NoteEvent["articulation"];
  /** What the pitch does while the note sounds (bend, release, slide). */
  readonly gesture?: NoteEvent["pitchGesture"];
  /** The bond with the note immediately before it on this string. */
  readonly connection?: NoteEvent["connection"];
};

type BarSpec = {
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  /** Absent in 4/4, where the main beats are the notated units. */
  readonly grouping?: readonly number[];
  readonly hits: readonly Hit[];
};

/**
 * Append these bars to a copy of the song, in their own metres.
 *
 * Every other track gets a silent lane of the right width, so the bar is a
 * real bar of the real song rather than a one-track special case: the mixer,
 * the tempo map and the renderer all see what they always see.
 */
function appendBars(
  song: Song,
  trackId: string,
  specs: readonly BarSpec[],
): { readonly song: Song; readonly barNumber: number } | null {
  const track = song.tracks.find((entry) => entry.id === trackId);
  const fretboard = track?.fretboard;
  if (!track || !fretboard) return null;

  const sectionIndex = song.sections.length - 1;
  const section = song.sections[sectionIndex];
  if (!section) return null;

  const before = song.sections.reduce((total, entry) => total + entry.bars.length, 0);

  const bars = specs.map((spec) => {
    const width = (spec.meter[0] * spec.resolution) / spec.meter[1];
    const lane: MelodicSlot[] = Array.from({ length: width }, () => null);
    for (const hit of spec.hits) {
      const pitch = pitchAt(fretboard, STRING, hit.fret);
      if (pitch === null) continue;
      const note: NoteEvent = {
        pitch,
        position: { string: STRING, fret: hit.fret },
        ...(hit.attack === undefined ? {} : { attack: hit.attack }),
        ...(hit.articulation === undefined ? {} : { articulation: hit.articulation }),
        ...(hit.gesture === undefined ? {} : { pitchGesture: hit.gesture }),
        ...(hit.connection === undefined ? {} : { connection: hit.connection }),
      };
      lane[hit.slot] = { notes: [note] };
      for (let step = 1; step <= (hit.hold ?? 0); step += 1) {
        if (hit.slot + step < width) lane[hit.slot + step] = "-";
      }
    }

    const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
    for (const entry of song.tracks) {
      const existing = song.sections[0]?.bars[0]?.slots[entry.id];
      slots[entry.id] =
        existing && isDrumSlotArray(existing)
          ? Array.from({ length: width }, () => [] as DrumSlot)
          : Array.from({ length: width }, () => null as MelodicSlot);
    }
    slots[trackId] = lane;

    return {
      timeSignature: [spec.meter[0], spec.meter[1]] as Bar["timeSignature"],
      resolution: spec.resolution,
      ...(spec.grouping === undefined ? {} : { grouping: [...spec.grouping] }),
      slots,
    } satisfies Bar;
  });

  const staged = settle({
    ...song,
    sections: song.sections.map((entry, index) =>
      index === sectionIndex ? { ...entry, bars: [...entry.bars, ...bars] } : entry,
    ),
  });
  if (!staged.ok) return null;
  return { song: staged.song, barNumber: before + 1 };
}

/**
 * A 6/8 bar at the 1/48 lattice: straight sixteenths, then a triplet run.
 *
 * At 1/48 one slot is 16 ticks. A straight sixteenth is 48 ticks — every
 * third slot — and a sixteenth triplet is 32 ticks — every second. Both are
 * exact on this lattice, which is the measurement c1 recorded and the reason
 * no new representation was written for this card.
 */
function sixEightBar(): BarSpec {
  const hits: Hit[] = [];
  /* First main beat: three straight eighths, one every 96 ticks = 6 slots. */
  for (const beat of [0, 6, 12]) hits.push({ slot: beat, fret: 5, hold: 5 });
  /* Second main beat: a run of sixteenth triplets, every 32 ticks = 2 slots. */
  for (let index = 0; index < 9; index += 1) {
    hits.push({ slot: 18 + index * 2, fret: index % 2 === 0 ? 7 : 5, hold: 1 });
  }
  return { meter: [6, 8], resolution: 48, grouping: [3, 3], hits };
}

/** Seven eighths, accented on the starts of the grouping given. */
function sevenEightBar(grouping: readonly number[]): BarSpec {
  const starts = new Set<number>();
  let at = 0;
  for (const group of grouping) {
    starts.add(at);
    at += group;
  }
  const hits: Hit[] = Array.from({ length: 7 }, (_unused, index) => ({
    slot: index,
    fret: 5 + (index % 3),
    ...(starts.has(index) ? { attack: "accent" as const } : {}),
  }));
  return { meter: [7, 8], resolution: 8, grouping, hits };
}

/**
 * L33's bar: one pitch, seven eighths, every note struck on purpose.
 *
 * Two things L31 got wrong are fixed here, and both are visible in this
 * function rather than hidden in a level somewhere.
 *
 * **One pitch.** L31 ran frets 5-6-7-5-6-7-5, whose contour repeats every
 * three notes and so proposes its own grouping — one that agrees with neither
 * `2+2+3` nor `3+2+2` and is far louder to the ear than any accent. With a
 * single repeated note there is nothing to group by except the striking.
 *
 * **Every note is authored.** The unaccented eighths carry `ghost`, so they
 * are quiet-but-present the way a palm-muted eighth is under an accent — and,
 * measured, both kinds then travel the same rendering path, so the difference
 * a listener hears is the one the presets declare (`1.18` against `0.45`)
 * rather than the eleven decibels the round measured between an attacked note
 * and a bare one. That gap is a real defect and it is written down as one; it
 * is not fixed by this fixture and this fixture does not pretend it is.
 *
 * Both variants carry three accents and four ghosts. Only where the accents
 * fall is different.
 */
function accentedRiffBar(grouping: readonly number[]): BarSpec {
  const starts = new Set<number>();
  let at = 0;
  for (const group of grouping) {
    starts.add(at);
    at += group;
  }
  const hits: Hit[] = Array.from({ length: 7 }, (_unused, index) => ({
    slot: index,
    fret: L33_FRET,
    attack: starts.has(index) ? ("accent" as const) : ("ghost" as const),
  }));
  return { meter: [7, 8], resolution: 8, grouping, hits };
}

/** The one fret L33 is played on, low enough to read as a riff rather than a line. */
const L33_FRET = 3;

/**
 * L34's bar: the same note struck three ways, twice (gain parity §13).
 *
 * One pitch, one register, one duration, one tempo. The only thing that
 * changes between the three notes of a group is how the string was struck,
 * so what a listener compares is the striking and nothing else. A rest ends
 * each group, because three notes running into each other is a phrase and
 * three notes with a gap after them is a comparison.
 *
 * `L34_FRET` is 3 rather than 5 on purpose: fret 3 is a pitch the pack
 * records exactly, so the card asks about level rather than about how a
 * recording sounds stretched.
 */
function plainAccentGhostBar(): BarSpec {
  const hits: Hit[] = [];
  for (const start of [0, 4]) {
    hits.push({ slot: start, fret: L34_FRET });
    hits.push({ slot: start + 1, fret: L34_FRET, attack: "accent" });
    hits.push({ slot: start + 2, fret: L34_FRET, attack: "ghost" });
  }
  return { meter: [4, 4], resolution: 8, hits };
}

const L34_FRET = 3;

/**
 * L35's two bars: one phrase that picks up expression and puts it down.
 *
 * Plain, vibrato, bend-and-release, plain, a shift slide, and a plain close —
 * on one string, in one register, at one tempo, with no attack anywhere. The
 * plain notes are the control: they are what the expressive ones have to
 * stay level with, and a listener who can hear a jump between them is
 * hearing the defect this round set out to remove.
 *
 * Harmonics are deliberately absent. A natural harmonic is a different
 * *spectrum*, not a different level, and putting one in a card about balance
 * would ask the founder to judge two things at once.
 */
function expressionBalanceBars(): readonly BarSpec[] {
  return [
    {
      meter: [4, 4],
      resolution: 8,
      hits: [
        { slot: 0, fret: L35_LOW, hold: 1 },
        { slot: 2, fret: L35_LOW, articulation: "vibrato", hold: 1 },
        {
          slot: 4,
          fret: L35_LOW,
          gesture: { kind: "bend_release", targetCents: 200 },
          hold: 1,
        },
        { slot: 6, fret: L35_LOW, hold: 1 },
      ],
    },
    {
      meter: [4, 4],
      resolution: 8,
      hits: [
        { slot: 0, fret: L35_LOW },
        { slot: 1, fret: L35_HIGH, connection: { kind: "shift_slide" }, hold: 2 },
        { slot: 4, fret: L35_LOW, hold: 3 },
      ],
    },
  ];
}

const L35_LOW = 5;
const L35_HIGH = 7;

export function buildRhythmTakes(song: Song): RhythmTakes | null {
  const trackId = songSupport(song).heldPowerChord?.trackId ?? song.tracks[0]?.id;
  if (!trackId) return null;

  const six = appendBars(song, trackId, [sixEightBar()]);
  const grouped = appendBars(song, trackId, [sevenEightBar([2, 2, 3])]);
  const regrouped = appendBars(song, trackId, [sevenEightBar([3, 2, 2])]);
  /*
   * L32's two bars. The last note of the 7/8 is held to the bar line and the
   * 6/8 opens with a struck note, so what crosses the line is a real held
   * sound followed by a real attack — not a rest, and not a second copy of
   * the same note pretending to continue.
   */
  const crossing = appendBars(song, trackId, [
    {
      meter: [7, 8],
      resolution: 8,
      grouping: [2, 2, 3],
      hits: [
        { slot: 0, fret: 5, attack: "accent" },
        { slot: 2, fret: 7, attack: "accent" },
        { slot: 4, fret: 9, attack: "accent", hold: 2 },
      ],
    },
    {
      meter: [6, 8],
      resolution: 8,
      grouping: [3, 3],
      hits: [
        { slot: 0, fret: 9 },
        { slot: 3, fret: 7, hold: 2 },
      ],
    },
  ]);
  /* L33's two takes: the same bar twice, so a listener hears the pattern
     rather than a single pass of it (completion §14). */
  const evened = appendBars(song, trackId, [
    accentedRiffBar([2, 2, 3]),
    accentedRiffBar([2, 2, 3]),
  ]);
  const uneven = appendBars(song, trackId, [
    accentedRiffBar([3, 2, 2]),
    accentedRiffBar([3, 2, 2]),
  ]);
  /* L34 and L35: the two cards the gain parity round adds (§13, §14). */
  const struckThreeWays = appendBars(song, trackId, [plainAccentGhostBar()]);
  const balance = appendBars(song, trackId, expressionBalanceBars());
  if (
    !six ||
    !grouped ||
    !regrouped ||
    !crossing ||
    !evened ||
    !uneven ||
    !struckThreeWays ||
    !balance
  ) {
    return null;
  }

  const take = (
    built: { song: Song; barNumber: number },
    specs: readonly BarSpec[],
  ): RhythmTake => ({
    song: built.song,
    barNumber: built.barNumber,
    barCount: specs.length,
    trackId,
    ticks: specs.reduce(
      (total, spec) =>
        total + barTicks({ timeSignature: spec.meter, resolution: spec.resolution }),
      0,
    ),
  });

  return {
    L30a: take(six, [sixEightBar()]),
    L31a: take(grouped, [sevenEightBar([2, 2, 3])]),
    L31b: take(regrouped, [sevenEightBar([3, 2, 2])]),
    L32a: take(crossing, [
      { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: [] },
      { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: [] },
    ]),
    L34a: take(struckThreeWays, [plainAccentGhostBar()]),
    L35a: take(balance, expressionBalanceBars()),
    L33a: take(evened, [accentedRiffBar([2, 2, 3]), accentedRiffBar([2, 2, 3])]),
    L33b: take(uneven, [accentedRiffBar([3, 2, 2]), accentedRiffBar([3, 2, 2])]),
  };
}
