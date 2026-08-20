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
import { RESOLUTIONS, isRepresentableGrid } from "@/lib/music/timing";

/** "E minor", "C major" (spec 5.1). */
export const KEY_PATTERN = /^[A-G](#|b)? (minor|major)$/;

export const pitchSchema = z.string().regex(PITCH_PATTERN, "invalid pitch");

export const timeSignatureSchema = z.union([
  z.tuple([z.literal(4), z.literal(4)]),
  z.tuple([z.literal(3), z.literal(4)]),
  z.tuple([z.literal(6), z.literal(8)]),
  z.tuple([z.literal(7), z.literal(8)]),
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
export const resolutionSchema = z.union([
  z.literal(8),
  z.literal(12),
  z.literal(16),
  z.literal(24),
  z.literal(32),
]);

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
]);

export const positionSchema = z
  .strictObject({
    string: z.number().int().min(0),
    fret: z.number().int().min(0),
  });

export const noteEventSchema = z.strictObject({
  pitch: pitchSchema,
  velocity: z.number().int().min(velocityRange.min).max(velocityRange.max).optional(),
  articulation: articulationSchema.optional(),
  position: positionSchema.optional(),
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
    if (isRepresentableGrid(bar.timeSignature, bar.resolution)) return;
    ctx.addIssue({
      code: "custom",
      path: ["resolution"],
      message:
        `${bar.timeSignature[0]}/${bar.timeSignature[1]} olcusu ` +
        `1/${bar.resolution} gridinde yazilamaz`,
    });
  });

export const sectionStatusSchema = z.enum(["fixed", "pending", "accepted"]);

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

export const songSchema = z.strictObject({
  version: z.literal(2),
  title: z.string().min(1),
  bpm: z.number().min(bpmRange.min).max(bpmRange.max),
  key: z.string().regex(KEY_PATTERN, "invalid key"),
  tracks: z.array(trackSchema).min(1).max(songLimits.maxTracks),
  sections: z.array(sectionSchema),
});

export type Articulation = z.infer<typeof articulationSchema>;
export type Position = z.infer<typeof positionSchema>;
export type NoteEvent = z.infer<typeof noteEventSchema>;
export type MelodicSlot = z.infer<typeof melodicSlotSchema>;
export type DrumPiece = z.infer<typeof drumPieceSchema>;
export type DrumHit = z.infer<typeof drumHitSchema>;
export type DrumSlot = z.infer<typeof drumSlotSchema>;
export type Bar = z.infer<typeof barSchema>;
export type SectionStatus = z.infer<typeof sectionStatusSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Fretboard = z.infer<typeof fretboardSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Song = z.infer<typeof songSchema>;

export type TimeSignature = z.infer<typeof timeSignatureSchema>;
export type Resolution = (typeof RESOLUTIONS)[number];

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
