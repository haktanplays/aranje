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
import { RESOLUTIONS } from "@/lib/music/timing";

/** "E minor", "C major" (spec 5.1). */
export const KEY_PATTERN = /^[A-G](#|b)? (minor|major)$/;

export const pitchSchema = z.string().regex(PITCH_PATTERN, "invalid pitch");

export const timeSignatureSchema = z.union([
  z.tuple([z.literal(4), z.literal(4)]),
  z.tuple([z.literal(3), z.literal(4)]),
  z.tuple([z.literal(6), z.literal(8)]),
  z.tuple([z.literal(7), z.literal(8)]),
]);

export const resolutionSchema = z.union([z.literal(8), z.literal(16)]);

export const articulationSchema = z.enum([
  "normal",
  "palm_mute",
  "accent",
  "sustain",
  "staccato",
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

export const barSchema = z.strictObject({
  timeSignature: timeSignatureSchema,
  resolution: resolutionSchema,
  bpmOverride: z.number().min(bpmRange.min).max(bpmRange.max).optional(),
  slots: z.record(
    z.string(),
    z.union([z.array(melodicSlotSchema), z.array(drumSlotSchema)]),
  ),
});

export const sectionStatusSchema = z.enum(["fixed", "pending", "accepted"]);

export const sectionSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: sectionStatusSchema,
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
