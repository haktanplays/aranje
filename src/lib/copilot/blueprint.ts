/**
 * What a piece is going to be, before any of it is written (spec 11.8, K-31).
 *
 * The S-01 rehearsal had to be handed a song skeleton that a human had
 * already decided: four sections, these names, this many bars, this tempo.
 * The Copilot could not have produced it, because `arrange_track` writes
 * slots into a section that already exists — there is no public operation
 * that invents form. So "compose a minute of music" was never actually being
 * asked; only "fill in these sixteen bars" was.
 *
 * A blueprint is that missing answer, and it is deliberately **not a Song**:
 *
 * - It is not played. Nothing here is scheduled, rendered or heard.
 * - It is not stored. It does not go to localStorage and it is not part of
 *   the Song Contract, so a change here can never corrupt someone's song.
 * - It carries **no persistent identity**. A model may not name a section or
 *   a track that the rest of the system will then live with; the materialiser
 *   derives those, deterministically, from position and role. What the model
 *   gets instead are *internal keys* — a motif key it can refer back to
 *   within this one document, and nothing that outlives it.
 *
 * ## Artist names
 *
 * A musician will type "Pantera" rather than "syncopated stop-start groove
 * with low-register chromatic tension", and refusing that request would be
 * refusing the way people actually talk. So the name is accepted at the
 * request boundary and kept in the raw user-data artifact, which is what it
 * is: what the user said.
 *
 * It does not survive into the blueprint. What survives is what the name
 * *meant* as a musical property, because that is the part a model can act on
 * without reproducing anyone's riff. The musical fields of this document are
 * feature-based by construction: there is nowhere to write "in the style of",
 * and `referenceTraits` takes traits, not names.
 */
import { z } from "zod";

import { ARRANGE_SKILLS } from "@/lib/copilot/contract";
import { bpmRange, songLimits } from "@/lib/limits";
import { resolutionSchema, timeSignatureSchema } from "@/lib/song/schema";

/** Where a section sits in the shape of the piece. */
export const FORM_ROLES = [
  "intro",
  "break",
  "verse",
  "bridge",
  "chorus",
  "solo",
  "outro",
] as const;
export type FormRole = (typeof FORM_ROLES)[number];

/** How hard a section pushes, and how full it is. Coarse on purpose. */
export const INTENSITY = ["low", "medium", "high"] as const;

const intensity = z.enum(INTENSITY);

/**
 * A short internal handle, used only inside one blueprint.
 *
 * Constrained so it cannot be smuggled into a Song id: lower-case, no colons
 * (the Song's own key separator) and short enough to read.
 */
const internalKey = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, "internal key must be lower-case and simple");

/** Free prose the model writes to explain a choice. Never an instruction. */
const rationale = z.string().min(1).max(300);

export const blueprintTrackSchema = z.strictObject({
  /** The job this track does; the same vocabulary the arrange turns use. */
  role: z.enum(ARRANGE_SKILLS),
  /** Which instrument family it needs. Checked against the registry later. */
  instrumentFamily: z.enum(["guitar", "bass", "drums"]),
  /** "amplified, high gain", "steel string, fingerpicked". Words, not ids. */
  presetIntent: z.string().min(1).max(80),
  /** "drop D", "standard, capo 2". Realised by the materialiser. */
  tuningIntent: z.string().min(1).max(80),
  /** Section keys this track plays in. Everywhere else it is simply absent. */
  playsInSections: z.array(internalKey).max(songLimits.totalBars),
  /** What it is carrying: "low-end weight", "melodic lead", "pulse". */
  energyJob: z.string().min(1).max(120),
  /** False when the piece works without it, so a reader can drop it. */
  required: z.boolean(),
  /** Why it is here, or — for an optional one — why it earns its place. */
  rationale,
});
export type BlueprintTrack = z.infer<typeof blueprintTrackSchema>;

export const blueprintMotifSchema = z.strictObject({
  /** Referred to by sections. Internal to this blueprint (see the header). */
  key: internalKey,
  /** Where the attacks fall, e.g. "0 3 6 10 12 on a sixteenth grid". */
  rhythmSignature: z.string().min(1).max(160),
  /** Which of them are accented, and which are choked. */
  accentStructure: z.string().min(1).max(160),
  /** Scale degrees or shape, never absolute pitches: "1 b3 2, rising". */
  pitchContour: z.string().min(1).max(160),
  /** How much of it is silence, which is part of a riff, not a gap in one. */
  spaceCharacter: z.string().min(1).max(160),
  rationale,
});
export type BlueprintMotif = z.infer<typeof blueprintMotifSchema>;

export const blueprintSectionSchema = z.strictObject({
  /** Internal handle other parts of the blueprint refer to. */
  key: internalKey,
  /** What a reader will see on the section chip. */
  displayName: z.string().min(1).max(40),
  formRole: z.enum(FORM_ROLES),
  bars: z.number().int().min(1).max(songLimits.barsPerSection),
  timeSignature: timeSignatureSchema,
  /** This section's own tempo. The Song's top-level bpm is the fallback. */
  bpm: z.number().min(bpmRange.min).max(bpmRange.max),
  energy: intensity,
  density: intensity,
  /** "sits on the tonic pedal", "unresolved tritone into the solo". */
  tonalJob: z.string().min(1).max(160),
  /** Which motif this section uses, and what it does to it. */
  motifKey: internalKey.nullable(),
  motifTransformation: z.string().min(1).max(200),
  /** How it should arrive, and how it should hand over. */
  entryIntent: z.string().min(1).max(160),
  exitIntent: z.string().min(1).max(160),
  /** What ties it to its neighbours: a common tone, a rhythm, a silence. */
  linkToPrevious: z.string().max(160),
  linkToNext: z.string().max(160),
  /** Roles that play here, and roles that deliberately do not. */
  activeRoles: z.array(z.enum(ARRANGE_SKILLS)).max(songLimits.maxTracks),
  silentRoles: z.array(z.enum(ARRANGE_SKILLS)).max(songLimits.maxTracks),
});
export type BlueprintSection = z.infer<typeof blueprintSectionSchema>;

export const techniqueIntentSchema = z.strictObject({
  technique: z.string().min(1).max(40),
  /** The section it belongs in, and the musical job it is doing there. */
  sectionKey: internalKey,
  purpose: z.string().min(1).max(200),
});
export type TechniqueIntent = z.infer<typeof techniqueIntentSchema>;

/**
 * Something the request asked for that this piece is not going to do.
 *
 * Written down rather than quietly dropped: a plan that silently omits half
 * the brief reads as a plan that met it.
 */
export const omittedRequestSchema = z.strictObject({
  request: z.string().min(1).max(200),
  reason: z.string().min(1).max(300),
});
export type OmittedRequest = z.infer<typeof omittedRequestSchema>;

export const compositionBlueprintSchema = z.strictObject({
  version: z.literal(1),
  targetDurationSeconds: z.number().min(5).max(600),
  durationToleranceSeconds: z.number().min(0).max(60),
  /** "D minor". Same shape the Song Contract uses. */
  tonalCenter: z.string().min(1).max(40),
  tuningIntent: z.string().min(1).max(80),
  resolution: resolutionSchema,
  /**
   * What the reference in the request meant, as musical properties.
   *
   * Traits, never names: "half-time drum backbone", not a band. The regex is
   * not a content filter — it is a shape, and the reason the field exists is
   * to give the meaning somewhere to go so it does not have to travel as a
   * name.
   */
  referenceTraits: z.array(z.string().min(1).max(120)).max(20),
  tracks: z.array(blueprintTrackSchema).min(1).max(songLimits.maxTracks),
  motifs: z.array(blueprintMotifSchema).min(1).max(8),
  sections: z.array(blueprintSectionSchema).min(1).max(16),
  requestedTechniques: z.array(techniqueIntentSchema).max(40),
  omittedRequests: z.array(omittedRequestSchema).max(20),
});

export type CompositionBlueprint = z.infer<typeof compositionBlueprintSchema>;
