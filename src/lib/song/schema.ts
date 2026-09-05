/**
 * Song Contract (spec 5). Names are exactly as the spec writes them.
 *
 * Every localStorage read and every AI patch must pass through these schemas
 * before entering the system (spec 5.6).
 */
import { z } from "zod";

import { bpmRange, songLimits, velocityRange, volumeDbRange } from "@/lib/limits";
import { DRUM_PIECES } from "@/lib/instruments/registry";
import { MAX_CAPO } from "@/lib/music/fretboard";
import { PITCH_PATTERN } from "@/lib/music/pitch";
import {
  RESOLUTIONS,
  STORED_RESOLUTIONS,
  isRepresentableGrid,
} from "@/lib/music/timing";

/** "E minor", "C major" (spec 5.1). */
export const KEY_PATTERN = /^[A-G](#|b)? (minor|major)$/;

export const pitchSchema = z.string().regex(PITCH_PATTERN, "invalid pitch");

export const timeSignatureSchema = z.union([
  z.tuple([z.literal(4), z.literal(4)]),
  z.tuple([z.literal(3), z.literal(4)]),
  z.tuple([z.literal(6), z.literal(8)]),
  z.tuple([z.literal(7), z.literal(8)]),
  /*
   * 2V-D.2 §12. Four Pro metres, each exact on grids the format already has.
   *
   * Additive: no song is rewritten and no existing metre changes meaning. A
   * metre earns a place here by being writable in whole ticks — `5/8` is
   * `5 * 96 = 480`, `5/4` is `960` — which is why 11/16 is absent rather than
   * approximated.
   */
  z.tuple([z.literal(5), z.literal(8)]),
  z.tuple([z.literal(9), z.literal(8)]),
  z.tuple([z.literal(12), z.literal(8)]),
  z.tuple([z.literal(5), z.literal(4)]),
]);

/**
 * The grid a bar is written on (spec 5.5, K-34).
 *
 * Divisions of a whole note, so the same number means the same thing in every
 * meter: 8 eighths, 12 eighth triplets, 16 sixteenths, 24 sixteenth triplets,
 * 32 thirty-seconds. 12 and 24 are triplet grids, not denser straight ones.
 *
 * 64 is deliberately absent — see `lib/music/timing.ts` for why, and spec 5.5
 * for the open gap that leaves.
 */
/*
 * Derived from the timing core's list rather than restated.
 *
 * It was a hand-written union of literals, which is a second place the set of
 * grids lived — and adding 1/4 in 2N-A would have meant patching it by hand,
 * with nothing to notice if someone forgot. `z.literal` over the const array
 * keeps both the runtime check and the inferred type coming from one source.
 */
/**
 * The grids a *stored* bar may declare.
 *
 * Wider than the grids anyone is offered: it also admits the lattices that
 * exist so straight and triplet music can share one measure (2V-B.4
 * Completion §5). A song written before they existed parses unchanged —
 * adding a member to this list can only accept more, never less — and a bar
 * that reaches a lattice carries `notation` so the reader is never told a
 * number nobody counts.
 */
export const resolutionSchema = z.literal(STORED_RESOLUTIONS);

/** The grids a picker offers and a Copilot may write. */
export const offeredResolutionSchema = z.literal(RESOLUTIONS);

/**
 * How one note is played (spec 5.4, 8.5).
 *
 * The first five were here from phase 0 and keep their meaning exactly, so a
 * song written before expressive playback reads and sounds the same. The six
 * added in phase 2F are the pilot's expression vocabulary; a note carries at
 * most one of them, and combinations are deliberately not part of this
 * version.
 *
 * This is the **only** articulation enum in the codebase. The copilot's narrow
 * output shape derives from it rather than declaring its own, so the two can
 * never drift into disagreeing about what a valid articulation is.
 */
export const articulationSchema = z.enum([
  "normal",
  "palm_mute",
  "accent",
  "sustain",
  "staccato",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
  /*
   * 2T-C §9. Five more ways of striking a string, each of which changes what
   * is heard rather than only what is drawn.
   *
   * They are articulations because that is what they are: a hand doing
   * something different to the string at the moment of attack. `letRing` and
   * `strum` deliberately stay out of this list — those say what happens
   * *around* the attack, not how it was made, and moving them in to keep one
   * tidy list would teach the wrong thing about all seven.
   */
  "ghost",
  "dead",
  "tapping",
  "natural_harmonic",
  "pinch_harmonic",
]);

export const positionSchema = z
  .strictObject({
    string: z.number().int().min(0),
    fret: z.number().int().min(0),
  });

/**
 * How far a bend goes, in cents (2V-C.1 §2).
 *
 * Bounded rather than enumerated. A quarter-tone is 50, a half bend 100, a
 * full bend 200, and the two-tone bend a rock player reaches for is 400 —
 * all of them the same field, so a new interval never needs a migration.
 * Zero is refused because a bend that arrives nowhere is not a bend.
 */
export const bendCentsSchema = z.number().int().min(25).max(400);

/**
 * The pitch's own movement during a note.
 *
 * Six kinds, on one axis: a note's pitch does one thing, and asking it to do
 * two would be asking two hands to hold one string. `vibrato` lives *inside*
 * the bend kinds rather than beside them because "bend up then shake at the
 * top" is one gesture with an order to it, and two independent fields could
 * express the impossible "shake first, then arrive".
 */
export const pitchGestureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["bend", "bend_release", "prebend", "prebend_release"]),
    targetCents: bendCentsSchema,
    vibrato: z
      .strictObject({
        /* A hand arrives before it shakes; false would be another gesture. */
        startAfterTarget: z.literal(true),
        depthCents: z.number().int().min(1).max(100),
        rateHz: z.number().min(1).max(12),
      })
      .optional(),
  }),
  /**
   * Arriving from nowhere written down.
   *
   * `approxSemitones` is approximate on purpose: a slide-in from below is a
   * hand starting somewhere lower, not a fret the player wrote. Writing a
   * source note into the Song would put a note on the staff nobody played.
   */
  z.strictObject({
    kind: z.literal("slide_in"),
    from: z.enum(["below", "above"]),
    approxSemitones: z.number().int().min(1).max(12).optional(),
  }),
  z.strictObject({
    kind: z.literal("slide_out"),
    to: z.enum(["down", "up"]),
    approxSemitones: z.number().int().min(1).max(12).optional(),
  }),
]);

/**
 * The bond between this note and the one before it.
 *
 * `legato_slide` is what the old `slide` articulation already renders: the
 * hand travels and the target is never struck. `shift_slide` is the one the
 * enum could not say — the same travel, and then the target *is* struck.
 */
export const noteConnectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("hammer_on") }),
  z.strictObject({ kind: z.literal("pull_off") }),
  z.strictObject({ kind: z.literal("legato_slide") }),
  z.strictObject({ kind: z.literal("shift_slide") }),
]);

/**
 * The attack axis (2V-D.1 §3).
 *
 * Exactly the members of `articulation` that answer "how was the string
 * struck", and no others: this is a second name for a question already
 * asked, not a place to invent techniques. `normal`, `sustain` and
 * `staccato` are absent for different reasons — the first is the absence of
 * the field, and the other two say how long the note is held rather than how
 * it was hit, which is `articulationHold`'s question and stays there.
 */
export const noteAttackSchema = z.enum([
  "accent",
  "ghost",
  "dead",
  "tapping",
  "natural_harmonic",
  "pinch_harmonic",
]);

/** Down or up. See `NoteEvent.picking` for why there is no third value. */
export const pickingDirectionSchema = z.enum(["down", "up"]);

export const noteEventSchema = z.strictObject({
  pitch: pitchSchema,
  velocity: z.number().int().min(velocityRange.min).max(velocityRange.max).optional(),
  articulation: articulationSchema.optional(),
  position: positionSchema.optional(),
  /**
   * How long this note sounds, in ticks (2T §3.2, Score Truth v2).
   *
   * Absent means what it has always meant: the note lasts until the tie run
   * under it ends, and the next onset anywhere in the track ends it. That is
   * why every song written before this field sounds byte-for-byte the same —
   * absence is not a default, it is the old rule.
   *
   * Present, it says this note's own length and nothing else's. Two things
   * follow, and both were impossible before:
   *
   * - A note on one string may go on ringing while another string is struck.
   *   The written score already meant that; the model could not hold it,
   *   because a slot was an onset for *every* string at once.
   * - A note may be longer or shorter than the slot it starts on without
   *   moving, shortening or deleting anything after it.
   *
   * Ticks rather than slots, because a duration outlives the grid it was
   * written on: a bar regridded from sixteenths to thirty-seconds must not
   * change how long anything sounds.
   */
  durationTicks: z.number().int().positive().optional(),
  /**
   * The chord this note belongs to is strummed, and in which direction
   * (2T §3.4).
   *
   * A performance intent, not a rhythm. A strum is one written onset played
   * by dragging a pick across the strings, so the score keeps saying "one
   * chord here" and this says how the hand crossed it. Writing a strum as
   * separate onsets would be writing down a lie — nobody counts a strum in
   * sixteenths — which is exactly what separates it from an arpeggio.
   *
   * It sits on the note rather than the slot because a slot has no room for
   * anything but its notes, and every voice of one chord carries the same
   * value. The performance reads it once, from the chord.
   */
  strum: z.enum(["down", "up"]).optional(),
  /**
   * Keep sounding past the next attack on this same string (2T §3.3).
   *
   * The dirty arpeggio: a guitarist lets an open string ring and plays over
   * it. Absent is the ordinary physical truth — one string, one sounding
   * note — and this is the reader saying otherwise on purpose.
   */
  letRing: z.boolean().optional(),
  /**
   * What the pitch does while this note sounds (2V-C.1 §2).
   *
   * The `articulation` enum answers "how was the string struck" and can hold
   * exactly one value, which is why it could say `bend_full` but never "bend
   * up and stay there, with vibrato on top". Those are two different
   * questions about one note, and this is the second one.
   *
   * Absent is the ordinary case and is **not** a default: a song written
   * before this field means exactly what it always meant, and a legacy
   * `bend_half`/`bend_full` articulation keeps its own audio path rather than
   * being quietly re-read as one of these (§3). Nothing migrates on open.
   *
   * `targetCents` is a number rather than a `half | full` enum so the next
   * interval a guitarist asks for — a quarter-tone, a bend and a half — costs
   * a bound change and not a schema migration. This round's simple editor
   * still offers only 100 and 200.
   */
  pitchGesture: pitchGestureSchema.optional(),
  /**
   * How this note is joined to the one before it (2V-C.1 §2, §8).
   *
   * The old enum carried `hammer_on`, `pull_off` and one generic `slide` —
   * and that slide is, in what it actually renders, a *legato* slide: the
   * target is never struck. A shift slide is a different musical event that
   * the enum had no room for, so this field is where the difference lives.
   *
   * Absent means "read `articulation`", which is what every existing song
   * says. Both present and disagreeing is a typed refusal, never a silent
   * winner — see `expression-resolver`.
   */
  connection: noteConnectionSchema.optional(),
  /**
   * How the string was struck, on an axis of its own (2V-D.1 §3).
   *
   * `articulation` already answers this — and three other questions besides,
   * one value at a time. That is the whole defect: a note could say `accent`
   * or `bend_full`, never both, so an accented bend was unwritable and the
   * planner returned at the first branch that matched.
   *
   * Every value here is a striking the app already plays; nothing new is
   * claimed. `normal` is the field's *absence*, so an ordinary note stays
   * ordinary and no song grows a field for saying nothing.
   *
   * `palm_mute` is deliberately **not** here. It is not a way of striking a
   * string, it is something the hand keeps doing over a stretch of them, and
   * it moved to `TechniqueSpan` where a range and a set of strings can be
   * said. A legacy `palm_mute` articulation keeps working exactly as it did;
   * see `expression-resolver`.
   *
   * Absent means "read `articulation`". Both present and answering the same
   * question is a typed refusal, never a silent winner.
   */
  attack: noteAttackSchema.optional(),
  /**
   * Which way the pick crossed the string (2V-D.1 §3, §9).
   *
   * Distinct from `strum`, which says how one hand crossed a *chord* and
   * really does move each voice in time. This is one note and one direction,
   * and the shipped sample bank has one recording per pitch: it is written
   * down, drawn, spoken, carried through every edit and export — and it does
   * not change what comes out of the speakers. The app says so in those
   * words rather than implying a difference it cannot produce.
   *
   * Rake, sweep and alternate-picking patterns are not here. They are
   * patterns over several notes, not a property of one.
   */
  picking: pickingDirectionSchema.optional(),
});

/** null is a rest, "-" ties the previous event (spec 5.4). */
export const melodicSlotSchema = z.union([
  z.null(),
  z.literal("-"),
  z.strictObject({ notes: z.array(noteEventSchema).min(1) }),
]);

export const drumPieceSchema = z.enum(DRUM_PIECES);

export const drumHitSchema = z.strictObject({
  piece: drumPieceSchema,
  velocity: z.number().int().min(velocityRange.min).max(velocityRange.max).optional(),
  articulation: z.enum(["normal", "ghost", "accent"]).optional(),
});

/** An empty array is a rest; several hits in one slot are allowed (spec 5.4). */
export const drumSlotSchema = z.array(drumHitSchema);

export const barSchema = z
  .strictObject({
    timeSignature: timeSignatureSchema,
    resolution: resolutionSchema,
    /**
     * The grid the reader is reading and snapping to (2V-B.4 Completion §5, §7).
     *
     * Absent — and absent in every song written before now — means the stored
     * resolution *is* the reading grid, which is the ordinary case. It is
     * present only when a local write raised this one bar to a lattice so a
     * triplet run could live beside straight sixteenths: the data is exact on
     * the lattice, and every user-facing question about "which grid is this
     * bar on" is answered from here instead.
     *
     * It is an **offered** grid, never a lattice: a bar cannot claim to be
     * read on a grid nobody counts.
     */
    notation: offeredResolutionSchema.optional(),
    /**
     * Where the weight of the bar is felt (2V-D.2 §12).
     *
     * A list of beats per group, summing to the numerator: 7/8 felt `2+2+3`
     * is `[2, 2, 3]`. Optional, and absent in every song written before now,
     * which means "the ordinary feel for this metre" — `defaultGrouping`
     * supplies it and nothing is migrated.
     *
     * It has to be stored because **nothing else can say it.** A 5/8 felt
     * `2+3` and one felt `3+2` are the same five eighth notes; the metre
     * cannot distinguish them and neither can the notes. Guessing it from the
     * note pattern would be the app deciding where a reader's accents are.
     */
    grouping: z.array(z.number().int().min(1)).min(1).optional(),
    slots: z.record(
      z.string(),
      z.union([z.array(melodicSlotSchema), z.array(drumSlotSchema)]),
    ),
  })
  /*
   * A bar has to be writable on the grid it declares (spec 5.5). 7/8 at 1/12
   * would be ten and a half slots, and 6/8 at 1/12 would be nine slots none
   * of which is an eighth. Both are caught here rather than downstream, so
   * nothing that reads a parsed Song ever has to wonder.
   */
  .superRefine((bar, ctx) => {
    if (!isRepresentableGrid(bar.timeSignature, bar.resolution)) {
      ctx.addIssue({
        code: "custom",
        path: ["resolution"],
        message:
          `${bar.timeSignature[0]}/${bar.timeSignature[1]} olcusu ` +
          `1/${bar.resolution} gridinde yazilamaz`,
      });
    }
    /*
     * A grouping that does not add up is not a feel, it is a typo (§12).
     * Refused at the schema so nothing downstream has to wonder whether the
     * accents it was handed cover the bar.
     */
    if (bar.grouping !== undefined) {
      const total = bar.grouping.reduce((sum, group) => sum + group, 0);
      if (total !== bar.timeSignature[0]) {
        ctx.addIssue({
          code: "custom",
          path: ["grouping"],
          message:
            `vurgu gruplamasi ${total} ediyor, ` +
            `${bar.timeSignature[0]}/${bar.timeSignature[1]} olcusu ` +
            `${bar.timeSignature[0]} bekliyor`,
        });
      }
    }
  });

export const sectionStatusSchema = z.enum(["fixed", "pending", "accepted"]);

/**
 * One musical region, addressed in ticks from the start of its section.
 *
 * Ticks, not bar numbers, for the reason every other position in this format
 * is in ticks: bars stopped sharing a grid in 2H-A, so a phrase named by slots
 * would mean different music in different bars. `endTicks` is exclusive, like
 * every other range here.
 */
export const phraseSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    startTicks: z.number().int().min(0),
    endTicks: z.number().int().min(1),
  })
  .refine((phrase) => phrase.endTicks > phrase.startTicks, {
    message: "phrase ends before it starts",
  });

/**
 * One technique held over a range of time and a set of strings.
 *
 * Ticks from the start of its section, `endTicks` exclusive — the same
 * addressing as a phrase, and for the same reason: bars stopped sharing a
 * grid in 2H-A, so anything named by slots would mean different music in
 * different bars.
 *
 * `stringIndices` is required and may not be empty. A track-wide span would
 * be smaller than the model already is: the per-note flag it replaces could
 * put palm mute on one string and not another, and a span without strings
 * would lose that. It is also simply not what the technique is — the heel of
 * the hand covers the strings nearest it, and the ones above go on ringing.
 */
export const techniqueSpanSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(["palm_mute", "let_ring"]),
    trackId: z.string().min(1),
    startTicks: z.number().int().min(0),
    endTicks: z.number().int().min(1),
    stringIndices: z.array(z.number().int().min(0)).min(1),
  })
  .refine((span) => span.endTicks > span.startTicks, {
    message: "span ends before it starts",
  })
  .refine(
    (span) => new Set(span.stringIndices).size === span.stringIndices.length,
    { message: "span names one string twice" },
  );

export const sectionSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: sectionStatusSchema,
  /**
   * This section's own tempo (spec 8.3, 13.8, K-25).
   *
   * Absent means the song's own `bpm`. Present, it takes effect on the first
   * tick of this section's first bar and applies to this section only —
   * nothing carries into the next one, so a section always states its own
   * tempo completely.
   *
   * Tempo lived on the *bar* until phase 2G, where it was declared, locked
   * and then read by absolutely nothing: a song could carry it and the music
   * would ignore it. A tempo field that does not change the tempo is worse
   * than no field, so it was removed rather than left beside a working one.
   */
  bpmOverride: z.number().min(bpmRange.min).max(bpmRange.max).optional(),
  bars: z.array(barSchema).min(1).max(songLimits.barsPerSection),
  /**
   * Musical regions of this section, in ticks (2V-B.3 §13).
   *
   * A phrase is not a measure and it is not the grid. It is a stretch of music
   * the reader thinks of as one thing, and it may be shorter than a bar,
   * longer than a bar, or longer than what is on the screen. Until this field
   * existed the app had no way to say that at all, and "phrase" quietly meant
   * "whatever is visible" — which is how a musical idea ends up being split
   * at a viewport edge that has nothing to do with it.
   *
   * Optional, and absent in every song written before now. Absence is not a
   * default phrase covering the section: it means this song has not said
   * anything about its phrases, and nothing may invent one.
   */
  phrases: z.array(phraseSchema).max(songLimits.barsPerSection).optional(),
  /**
   * Techniques that last over a stretch of strings and time (2V-D.1 §3, §6).
   *
   * Palm mute and let ring were per-note flags, and a per-note flag cannot
   * say the thing a guitarist actually does: mute the low strings with the
   * heel of the hand while the top one rings over them. It is one hand
   * position held across a range, and it belongs to some strings and not
   * others.
   *
   * Optional, and absent in every song written before now. Absence is not an
   * empty default that anything may fill in: it means this song has not said
   * anything about spans, and a legacy `palm_mute` articulation or `letRing`
   * flag keeps meaning exactly what it always meant.
   */
  techniqueSpans: z.array(techniqueSpanSchema).max(songLimits.barsPerSection).optional(),
});

export const fretboardSchema = z.strictObject({
  tuning: z.array(pitchSchema).min(1),
  capo: z.number().int().min(0).max(MAX_CAPO),
});

export const trackSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  instrumentId: z.string().min(1),
  presetId: z.string().min(1),
  volumeDb: z.number().min(volumeDbRange.min).max(volumeDbRange.max),
  pan: z.number().min(-1).max(1).optional(),
  muted: z.boolean().optional(),
  soloed: z.boolean().optional(),
  fretboard: fretboardSchema.optional(),
});

/**
 * The version this app writes (2T §4).
 *
 * 3 adds `durationTicks` and `letRing` to a note event and changes the
 * meaning of nothing else. A version 2 song is still accepted and is lifted
 * on load — see `migrateSong`, which touches not one note.
 */
export const SONG_VERSION = 4;

/** Versions this app can read. The newest is the one it writes. */
export const READABLE_SONG_VERSIONS = [2, 3, 4] as const;

export const songSchema = z.strictObject({
  version: z.literal(READABLE_SONG_VERSIONS),
  title: z.string().min(1),
  bpm: z.number().min(bpmRange.min).max(bpmRange.max),
  key: z.string().regex(KEY_PATTERN, "invalid key"),
  tracks: z.array(trackSchema).min(1).max(songLimits.maxTracks),
  sections: z.array(sectionSchema),
});

export type Articulation = z.infer<typeof articulationSchema>;
export type NoteAttack = z.infer<typeof noteAttackSchema>;
export type PickingDirection = z.infer<typeof pickingDirectionSchema>;
export type TechniqueSpan = z.infer<typeof techniqueSpanSchema>;
export type Position = z.infer<typeof positionSchema>;
export type NoteEvent = z.infer<typeof noteEventSchema>;
export type PitchGesture = z.infer<typeof pitchGestureSchema>;
export type NoteConnection = z.infer<typeof noteConnectionSchema>;
export type BendGesture = Extract<
  PitchGesture,
  { kind: "bend" | "bend_release" | "prebend" | "prebend_release" }
>;
export type BendKind = BendGesture["kind"];
export type NoteConnectionKind = NoteConnection["kind"];
export type MelodicSlot = z.infer<typeof melodicSlotSchema>;
export type DrumPiece = z.infer<typeof drumPieceSchema>;
export type DrumHit = z.infer<typeof drumHitSchema>;
export type DrumSlot = z.infer<typeof drumSlotSchema>;
export type Bar = z.infer<typeof barSchema>;
export type Phrase = z.infer<typeof phraseSchema>;
export type SectionStatus = z.infer<typeof sectionStatusSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Fretboard = z.infer<typeof fretboardSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Song = z.infer<typeof songSchema>;

export type TimeSignature = z.infer<typeof timeSignatureSchema>;
export type Resolution = (typeof STORED_RESOLUTIONS)[number];

/** True when the slot array belongs to a drum track (spec 5.4). */
export function isDrumSlotArray(
  slots: readonly (MelodicSlot | DrumSlot)[],
): slots is readonly DrumSlot[] {
  return slots.every((slot) => Array.isArray(slot));
}

/** True when the slot array belongs to a melodic track (spec 5.4). */
export function isMelodicSlotArray(
  slots: readonly (MelodicSlot | DrumSlot)[],
): slots is readonly MelodicSlot[] {
  return slots.every((slot) => !Array.isArray(slot));
}
