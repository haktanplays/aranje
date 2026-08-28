/**
 * Articulation travels through the contract, and only the allowed values do
 * (spec 8.5, 11.1, K-21).
 */
import { describe, expect, it } from "vitest";

import { EXPRESSIVE_ARTICULATIONS } from "@/lib/audio/expression";
import {
  modelNoteEventSchema,
  modelPatchSchema,
  type ModelPatch,
} from "@/lib/copilot/contract";
import { applyPatch } from "@/lib/copilot/apply";
import { SYSTEM_PROMPT } from "@/lib/copilot/prompt";
import { articulationSchema, noteEventSchema, songSchema } from "@/lib/song/schema";
import { HARMONY_SONG, mainSection } from "@/test/copilot-fixtures";

/**
 * Every value that is played differently, pinned as a list.
 *
 * Eight in the pilot; thirteen since 2T-C §9 added ghost, dead, tapping and
 * the two harmonics. Written out rather than counted, so swapping one for
 * another still fails here.
 */
const EXPRESSIVE = [
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
  "ghost",
  "dead",
  "tapping",
  "natural_harmonic",
  "pinch_harmonic",
] as const;

describe("the song contract", () => {
  it("still accepts a note with no articulation at all", () => {
    expect(noteEventSchema.safeParse({ pitch: "A3" }).success).toBe(true);
  });

  it("still accepts the values phase 0 wrote", () => {
    for (const articulation of ["normal", "palm_mute", "accent", "sustain", "staccato"]) {
      expect(
        noteEventSchema.safeParse({ pitch: "A3", articulation }).success,
      ).toBe(true);
    }
  });

  it("accepts every value that is played differently", () => {
    for (const articulation of EXPRESSIVE) {
      expect(
        noteEventSchema.safeParse({ pitch: "A3", articulation }).success,
      ).toBe(true);
    }
    expect([...EXPRESSIVE].sort()).toEqual([...EXPRESSIVE_ARTICULATIONS].sort());
  });

  it("rejects anything else, rather than dropping it quietly", () => {
    for (const articulation of ["bend", "tremolo", "harmonic", "BEND_HALF", ""]) {
      const parsed = noteEventSchema.safeParse({ pitch: "A3", articulation });
      expect(parsed.success).toBe(false);
    }
  });

  it("reads an old song with no articulations unchanged", () => {
    const parsed = songSchema.safeParse(HARMONY_SONG);
    expect(parsed.success).toBe(true);
  });
});

describe("the model's narrow output", () => {
  it("derives its articulations from the one enum, not a second list", () => {
    for (const articulation of articulationSchema.options) {
      expect(
        modelNoteEventSchema.safeParse({ pitch: "A3", articulation }).success,
      ).toBe(true);
    }
  });

  it("still refuses a written position", () => {
    expect(
      modelNoteEventSchema.safeParse({
        pitch: "A3",
        position: { string: 1, fret: 12 },
      }).success,
    ).toBe(false);
  });

  it("carries a valid articulation through a whole patch", () => {
    const section = mainSection(HARMONY_SONG);
    const patch: ModelPatch = {
      operation: "arrange_track",
      sectionId: section.id,
      targetTrackId: "gtr2",
      bars: section.bars.map((bar, barIndex) => ({
        barIndex,
        slots: Array.from({ length: 8 }, (_, slotIndex) =>
          slotIndex === 0
            ? { notes: [{ pitch: "B3", articulation: "vibrato" as const }] }
            : null,
        ),
      })),
      explanation: "test",
    };

    expect(modelPatchSchema.safeParse(patch).success).toBe(true);

    const applied = applyPatch(HARMONY_SONG, { id: "p1", ...patch });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const slot = applied.song.sections
      .find((entry) => entry.id === section.id)
      ?.bars[0]?.slots.gtr2?.[0];
    expect(slot).toMatchObject({
      notes: [{ pitch: "B3", articulation: "vibrato" }],
    });
  });

  it("never reaches the candidate with an articulation the schema refuses", () => {
    const section = mainSection(HARMONY_SONG);
    const raw = {
      operation: "arrange_track",
      sectionId: section.id,
      targetTrackId: "gtr2",
      bars: section.bars.map((bar, barIndex) => ({
        barIndex,
        slots: Array.from({ length: 8 }, (_, slotIndex) =>
          slotIndex === 0 ? { notes: [{ pitch: "B3", articulation: "whammy" }] } : null,
        ),
      })),
      explanation: "test",
    };

    // The gate is the schema: the patch never becomes a patch at all.
    expect(modelPatchSchema.safeParse(raw).success).toBe(false);
  });
});

/*
 * What the model may write, which is deliberately narrower than what a
 * person may write. 2T-C §17 puts provider and Copilot changes out of scope,
 * so the five techniques added in §9 are reachable from the sheet and not
 * from the prompt — and this list says so rather than leaving the difference
 * to be discovered.
 */
const PROMPT_ARTICULATIONS = [
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
] as const;

describe("what the model is told", () => {
  it("names every articulation the model may write", () => {
    for (const articulation of PROMPT_ARTICULATIONS) {
      expect(SYSTEM_PROMPT).toContain(articulation);
    }
  });

  it("does not offer the model the techniques 2T-C added for people", () => {
    for (const articulation of ["ghost", "dead", "tapping", "pinch_harmonic"]) {
      expect(SYSTEM_PROMPT).not.toContain(articulation);
    }
  });

  it("states the context rules for the three that need a note before them", () => {
    expect(SYSTEM_PROMPT).toContain("AYNI telde");
    expect(SYSTEM_PROMPT).toContain("hammer_on yalniz yukari");
    expect(SYSTEM_PROMPT).toContain("pull_off yalniz asagi");
    expect(SYSTEM_PROMPT).toContain("en fazla BIR articulation");
  });

  it("keeps the bend amounts out of the model's hands", () => {
    expect(SYSTEM_PROMPT).toContain("miktar yazilmaz");
  });
});
