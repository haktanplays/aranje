/**
 * Ways to hold a chord on a real fretboard (spec 13.22 §9, 2O-B).
 *
 * Not a chord dictionary. A dictionary is a list of shapes somebody typed in,
 * and it is wrong the moment a reader tunes to Drop D, puts a capo on, or
 * plays a bass. This searches the fretboard the reader actually has: the
 * tuning on their track, their capo, their string count, the fret limit that
 * capo leaves them.
 *
 * ## The search
 *
 * 1. Every string, every fret in range, is asked what it sounds. The ones
 *    whose pitch class belongs to the chord are candidates.
 * 2. Candidates are gathered inside a moving window of `maxFretSpan` frets,
 *    plus the open strings, because that is the shape of a hand.
 * 3. Each window enumerates one-note-or-silence per string.
 * 4. What survives is filtered by what makes the chord that chord and by what
 *    a hand can do — never by what is "good".
 * 5. The survivors are grouped by neck position and a small, descriptive set
 *    is offered.
 *
 * ## What it will not do
 *
 * There is no ranking by quality, difficulty or suitability, no scale-aware
 * filtering, and no voice leading from a neighbouring chord: the reader picks.
 * The order is canonical so the same request answers the same bytes, and the
 * labels say where a shape sits, never how good it is.
 */
import {
  chordPitchClasses,
  normalizePitchClass,
  requiredPitchClasses,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import { voicingLimits } from "@/lib/limits";
import {
  maxCapoRelativeFret,
  physicalFret,
  soundingMidi,
  type Fretboard,
} from "@/lib/music/fretboard";
import { anchorOf, chordSpan, type HandNote } from "@/lib/music/hand-position";
import { midiToPitch } from "@/lib/music/pitch";

/** One string of a shape: a fret, or silence. */
export type ShapeString =
  | { readonly kind: "muted" }
  | {
      readonly kind: "played";
      /** Capo-relative, exactly as it is written into a Song (spec 9.1). */
      readonly fret: number;
      readonly physicalFret: number;
      readonly pitch: string;
      readonly midi: number;
      readonly pitchClass: number;
    };

export type FrettedVoicing = {
  /** Deterministic identity of this shape. Never written into a Song. */
  readonly id: string;
  /** One entry per string, thickest first — the data order, not the drawn one. */
  readonly strings: readonly ShapeString[];
  /** Where the hand sits, in physical frets. 0 when nothing is fretted. */
  readonly anchor: number;
  /** How far it stretches, fretted notes only. */
  readonly span: number;
  /** The lowest sounding note of the shape. */
  readonly bassPitch: string;
  readonly bassPitchClass: number;
  /** Which chord tones are actually sounding, as pitch classes. */
  readonly soundingClasses: readonly number[];
  /** True when at least one string rings open. */
  readonly hasOpenString: boolean;
  readonly noteCount: number;
  /** Strings a finger has to hold down. Open strings are free. */
  readonly frettedCount: number;
  /** Silent strings between the lowest and highest sounding one. */
  readonly interiorSkips: number;
};

export type FrettedVoicingRequest = {
  readonly fretboard: Fretboard;
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
  /**
   * Where on the neck the reader is looking, in physical frets.
   *
   * Only an ordering hint: regions are offered from here upward and then from
   * here down, so "around the fifth fret" shows fifth-position shapes first.
   * Nothing is filtered out by it, and there is no default preference hidden
   * in the search — absent, the neck is read from the nut.
   */
  readonly anchorFret?: number;
  /**
   * Power chords only: whether the octave above the root may be added.
   *
   * It belongs here rather than in the formula table because it is a choice
   * about the shape, not about the harmony — `[0, 7]` is the chord either way.
   */
  readonly withOctave?: boolean;
};

/* ------------------------------------------------------------ the fretboard */

type Spot = {
  stringIndex: number;
  fret: number;
  physicalFret: number;
  midi: number;
  pitch: string;
  pitchClass: number;
};

/**
 * Every place on this fretboard where a note of the chord can be played.
 *
 * Derived from the track's own tuning and capo through the one sounding-pitch
 * function, so a fretboard the app has never seen behaves correctly and a
 * capo shortens the neck in exactly one place.
 */
export function chordSpots(
  fretboard: Fretboard,
  pitchClasses: readonly number[],
): Spot[] {
  const wanted = new Set(pitchClasses.map(normalizePitchClass));
  const maxFret = maxCapoRelativeFret(fretboard.capo);
  const spots: Spot[] = [];

  for (let stringIndex = 0; stringIndex < fretboard.tuning.length; stringIndex += 1) {
    for (let fret = 0; fret <= maxFret; fret += 1) {
      const midi = soundingMidi(fretboard, { string: stringIndex, fret });
      if (midi === null) continue;
      const pitchClass = normalizePitchClass(midi);
      if (!wanted.has(pitchClass)) continue;
      spots.push({
        stringIndex,
        fret,
        physicalFret: physicalFret(fretboard.capo, fret),
        midi,
        pitch: midiToPitch(midi),
        pitchClass,
      });
    }
  }
  return spots;
}

/**
 * A power chord is two strings, or three with the octave (spec 13.22 §8).
 *
 * Everywhere else, doubling a chord tone on another string is ordinary and
 * good: an open C major sounds its root twice and nobody calls that a
 * different chord. A power chord is the one place where that is not true —
 * "root and fifth" is the whole idea, and a six-string shape that repeats them
 * four more times is a different sound with the same name. So the shape rule
 * lives here, in the shape layer, and the formula table still says `[0, 7]`.
 */
function powerShapeAllowed(
  shape: FrettedVoicing,
  request: FrettedVoicingRequest,
): boolean {
  if (request.quality !== "power") return true;
  const wanted = request.withOctave === true ? 3 : 2;
  if (shape.noteCount !== wanted) return false;

  /*
   * The root is underneath. Everywhere else an inversion is a legitimate way
   * to play a chord and gets its own card; a power chord is the exception,
   * because "root and fifth" is a shape, not a set of pitch classes. Stack A
   * under E and the ear hears A5, whatever the reader typed — so a shape with
   * the fifth in the bass is not the chord that was asked for.
   */
  if (shape.bassPitchClass !== normalizePitchClass(request.rootPitchClass)) {
    return false;
  }
  if (wanted === 2) return true;

  // Root, fifth, octave: the top note is the root again, exactly twelve
  // semitones up. Any other three-note stack is a different chord.
  const played = shape.strings.filter(
    (entry): entry is Extract<ShapeString, { kind: "played" }> =>
      entry.kind === "played",
  );
  const midi = played.map((entry) => entry.midi).sort((a, b) => a - b);
  const low = midi[0];
  const high = midi[2];
  if (low === undefined || high === undefined) return false;
  return high - low === 12;
}

/* --------------------------------------------------------------- the shapes */

function shapeId(strings: readonly ShapeString[]): string {
  return strings
    .map((entry) => (entry.kind === "muted" ? "x" : String(entry.fret)))
    .join("-");
}

function measureShape(strings: readonly ShapeString[]): FrettedVoicing | null {
  const skips = interiorSkips(strings);
  const played = strings.filter(
    (entry): entry is Extract<ShapeString, { kind: "played" }> =>
      entry.kind === "played",
  );
  if (played.length === 0) return null;

  const hand: HandNote[] = played.map((entry) => ({
    stringIndex: 0,
    physicalFret: entry.physicalFret,
  }));
  const bass = played.reduce((low, entry) => (entry.midi < low.midi ? entry : low));

  return {
    id: shapeId(strings),
    strings,
    anchor: anchorOf(hand),
    span: chordSpan(hand),
    bassPitch: bass.pitch,
    bassPitchClass: bass.pitchClass,
    soundingClasses: [...new Set(played.map((entry) => entry.pitchClass))].sort(
      (a, b) => a - b,
    ),
    hasOpenString: played.some((entry) => entry.physicalFret === 0),
    noteCount: played.length,
    frettedCount: played.filter((entry) => entry.physicalFret > 0).length,
    interiorSkips: skips,
  };
}

/**
 * Can one hand hold this?
 *
 * Four fingers, and a barre when four are not enough.
 *
 * The naive version of this rule — "the same fret twice means a barre" — is
 * wrong, and wrong in a way that throws away ordinary chords: open D7 is
 * `x x 0 2 1 2`, two strings at the second fret with the first fret pressed
 * between them, and every guitarist plays it with three separate fingers.
 * Repeating a fret only forces a barre when the shape has run out of fingers.
 *
 * So: up to four fretted strings need no barre at all and are always
 * holdable. Beyond that, one finger has to lie across the lowest fret in the
 * shape — the only fret a finger can be laid across, since nothing is pressed
 * behind it — and that is possible only if no string it would cover is meant
 * to ring open. What is left over has to fit on the remaining three fingers.
 *
 * It is deliberately conservative. It does not model finger independence,
 * thumb-over bass notes or hand size, because modelling those badly would be
 * worse than not modelling them.
 */
const FINGERS = 4;

function handCanHold(strings: readonly ShapeString[]): boolean {
  const fretted = strings
    .map((entry, index) =>
      entry.kind === "played" && entry.physicalFret > 0
        ? { index, fret: entry.physicalFret }
        : null,
    )
    .filter((entry): entry is { index: number; fret: number } => entry !== null);

  if (fretted.length <= FINGERS) return true;

  const lowest = Math.min(...fretted.map((entry) => entry.fret));
  const covered = fretted.filter((entry) => entry.fret === lowest);
  const from = Math.min(...covered.map((entry) => entry.index));
  const to = Math.max(...covered.map((entry) => entry.index));

  // A finger laid across the neck silences the open strings underneath it.
  for (let index = from + 1; index < to; index += 1) {
    const between = strings[index];
    if (between?.kind === "played" && between.physicalFret === 0) return false;
  }

  return 1 + (fretted.length - covered.length) <= FINGERS;
}

/** Silent strings between the lowest and highest sounding one. */
function interiorSkips(strings: readonly ShapeString[]): number {
  const playedIndices = strings
    .map((entry, index) => (entry.kind === "played" ? index : -1))
    .filter((index) => index >= 0);
  if (playedIndices.length < 2) return 0;
  const first = playedIndices[0]!;
  const last = playedIndices[playedIndices.length - 1]!;
  return last - first + 1 - playedIndices.length;
}

/**
 * How much of a stretch a shape really is.
 *
 * A one-fret spread is not a stretch — the fingers are already there. Past
 * that, each fret is one the hand has to reach for. Bucketing it this way is
 * what stops the ordering from splitting hairs between two shapes that feel
 * identical to hold, and it is a claim about hands rather than about taste.
 */
function stretchOf(voicing: FrettedVoicing): number {
  return Math.max(0, voicing.span - 1);
}

/**
 * Canonical order.
 *
 * How much of the chord sounds, then whether the strumming hand has to mute
 * anything in the middle, then how many strings ring, then how far the
 * fretting hand reaches, how many fingers it costs, position, and the id.
 *
 * None of this ranks shapes by quality, and the app never tells a reader one
 * is better. What it does is answer the question that was actually asked: a
 * reader who asks for C major means the chord, so a fragment of it that
 * happens to be playable is a worse *answer* than the chord — and a shape that
 * needs a four-fret reach across six strings is a worse answer than the same
 * chord under one hand. An interior mute sits in the same class of fact: a run
 * of neighbouring strings is what one stroke sounds, and silencing a string in
 * the middle of that run is something the other hand has to do on purpose.
 * None of these are opinions about music; they are stated here once so nothing
 * downstream re-decides them.
 */
export function compareFretted(a: FrettedVoicing, b: FrettedVoicing): number {
  if (a.soundingClasses.length !== b.soundingClasses.length) {
    return b.soundingClasses.length - a.soundingClasses.length;
  }
  if (a.interiorSkips !== b.interiorSkips) return a.interiorSkips - b.interiorSkips;
  if (a.noteCount !== b.noteCount) return b.noteCount - a.noteCount;
  const stretchA = stretchOf(a);
  const stretchB = stretchOf(b);
  if (stretchA !== stretchB) return stretchA - stretchB;
  if (a.frettedCount !== b.frettedCount) return a.frettedCount - b.frettedCount;
  if (a.anchor !== b.anchor) return a.anchor - b.anchor;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every playable shape of this chord on this fretboard, in canonical order.
 *
 * "Playable" is a physical claim and nothing more: the required tones are
 * there, no string is asked to sound twice, the stretch is within the central
 * limit, and the silent strings are ones a hand could mute.
 */
export function frettedCandidates(
  request: FrettedVoicingRequest,
): FrettedVoicing[] {
  const { fretboard, rootPitchClass, quality } = request;
  const root = normalizePitchClass(rootPitchClass);
  const tones = chordPitchClasses(root, quality);
  const required = new Set(requiredPitchClasses(root, quality));
  const spots = chordSpots(fretboard, tones);
  if (spots.length === 0) return [];

  const stringCount = fretboard.tuning.length;
  const byId = new Map<string, FrettedVoicing>();

  /*
   * A window is where the hand is: `maxFretSpan` frets of neck, plus the open
   * strings, which the hand does not have to reach for. Every shape a hand can
   * hold lives in one of these windows, so enumerating windows enumerates
   * shapes — and it keeps the per-string choice down to a handful instead of
   * the whole neck.
   */
  /*
   * Only frets a chord tone actually sits on can be the bottom of a window.
   * Every shape is still generated — it appears when `base` is its own lowest
   * fretted fret — and the windows in between, which could only repeat shapes
   * already found, are not walked at all.
   */
  const bases = [...new Set([0, ...spots.map((spot) => spot.physicalFret)])].sort(
    (a, b) => a - b,
  );

  for (const base of bases) {
    const options: ShapeString[][] = [];
    for (let stringIndex = 0; stringIndex < stringCount; stringIndex += 1) {
      const choices: ShapeString[] = [{ kind: "muted" }];
      for (const spot of spots) {
        if (spot.stringIndex !== stringIndex) continue;
        const inWindow =
          spot.fret === 0 ||
          (spot.physicalFret >= base && spot.physicalFret <= base + voicingLimits.maxFretSpan);
        if (!inWindow) continue;
        choices.push({
          kind: "played",
          fret: spot.fret,
          physicalFret: spot.physicalFret,
          pitch: spot.pitch,
          midi: spot.midi,
          pitchClass: spot.pitchClass,
        });
      }
      options.push(choices);
    }

    const current: ShapeString[] = [];
    const walk = (stringIndex: number): void => {
      if (stringIndex === stringCount) {
        // A snapshot: `current` is the walker's own array and is about to be
        // popped. Keeping a reference would hand every shape the same, and
        // ultimately empty, list of strings.
        const shape = measureShape([...current]);
        if (!shape) return;
        if (shape.noteCount < voicingLimits.minNotes) return;
        if (shape.span > voicingLimits.maxFretSpan) return;
        if (!powerShapeAllowed(shape, request)) return;
        if (interiorSkips(current) > voicingLimits.maxInteriorSkips) return;
        if (!handCanHold(current)) return;
        // The chord has to still be the chord it was asked for.
        for (const tone of required) {
          if (!shape.soundingClasses.includes(tone)) return;
        }
        if (!byId.has(shape.id)) byId.set(shape.id, shape);
        return;
      }
      for (const choice of options[stringIndex] ?? []) {
        current.push(choice);
        walk(stringIndex + 1);
        current.pop();
      }
    };
    walk(0);
  }

  return [...byId.values()].sort(compareFretted);
}

/* ------------------------------------------------------------- the offering */

/**
 * Which tone of the chord is in the bass, as an index into the formula.
 *
 * 0 is the root, 1 the next tone up, and so on. It describes the shape; it
 * never decides which chord this is — that was decided by the request.
 */
export function bassRole(
  voicing: FrettedVoicing,
  rootPitchClass: number,
  quality: ChordQualityId,
): number {
  const tones = chordPitchClasses(rootPitchClass, quality);
  const index = tones.indexOf(voicing.bassPitchClass);
  return index < 0 ? tones.length : index;
}

/**
 * A handful of genuinely different shapes, spread along the neck.
 *
 * The neck is cut into regions one hand-width wide, and each region offers at
 * most `maxPerRegion` shapes that differ in something a reader can see — which
 * tone is in the bass, or how many strings ring. Two shapes that differ only
 * by one muted string are the same idea twice, and the list stops teaching.
 *
 * Regions are visited outward from wherever the reader is looking, so asking
 * around the fifth fret answers with fifth-fret shapes first. Nothing is
 * filtered by it, nothing is scored, and no shape is called better than
 * another: the order is position, then which tone is lowest.
 */
export function selectFrettedVoicings(
  request: FrettedVoicingRequest,
  candidates: readonly FrettedVoicing[] = frettedCandidates(request),
): FrettedVoicing[] {
  if (candidates.length === 0) return [];
  const width = voicingLimits.maxFretSpan + 1;
  const root = normalizePitchClass(request.rootPitchClass);

  const regions = new Map<number, FrettedVoicing[]>();
  for (const voicing of candidates) {
    const region = Math.floor(voicing.anchor / width);
    const bucket = regions.get(region) ?? [];
    bucket.push(voicing);
    regions.set(region, bucket);
  }

  const anchorRegion =
    request.anchorFret === undefined
      ? null
      : Math.floor(Math.max(0, request.anchorFret) / width);

  const orderedRegions = [...regions.keys()].sort((a, b) => {
    if (anchorRegion !== null) {
      const da = Math.abs(a - anchorRegion);
      const db = Math.abs(b - anchorRegion);
      if (da !== db) return da - db;
    }
    return a - b;
  });

  const chosen: FrettedVoicing[] = [];
  for (const region of orderedRegions) {
    if (chosen.length >= voicingLimits.maxVariations) break;
    const bucket = [...(regions.get(region) ?? [])].sort((a, b) => {
      // Root in the bass first: it is the plain form of the chord, and an
      // inversion is a different thing to hear rather than a worse one.
      const ra = bassRole(a, root, request.quality);
      const rb = bassRole(b, root, request.quality);
      if (ra !== rb) return ra - rb;
      return compareFretted(a, b);
    });

    /*
     * A second shape from the same region has to be a different thing to hear
     * or a different thing to hold: another tone in the bass, or at least two
     * strings' difference in how full it is. One extra muted string is the
     * same idea shown twice, and a reader scrolling four near-identical cards
     * learns nothing from them.
     */
    const picked: FrettedVoicing[] = [];
    let taken = 0;
    for (const voicing of bucket) {
      if (taken >= voicingLimits.maxPerRegion) break;
      if (chosen.length >= voicingLimits.maxVariations) break;
      const role = bassRole(voicing, root, request.quality);
      const distinct = picked.every(
        (other) =>
          bassRole(other, root, request.quality) !== role ||
          Math.abs(other.noteCount - voicing.noteCount) >= 2,
      );
      if (!distinct) continue;
      picked.push(voicing);
      chosen.push(voicing);
      taken += 1;
    }
  }
  return chosen;
}
