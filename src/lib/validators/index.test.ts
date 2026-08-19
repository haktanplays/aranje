import { describe, expect, it } from "vitest";

import { isCorePreset } from "@/lib/instruments/registry";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  songSchema,
  type Resolution,
  type TimeSignature,
} from "@/lib/song/schema";
import {
  PHASE_0_VALIDATORS,
  PLAYABILITY_VALIDATORS,
  SONG_VALIDATORS,
  TONAL_VALIDATORS,
  WARNING_VALIDATORS,
  hasErrors,
  runValidators,
} from "@/lib/validators";
import { errorsOnly, warningsOnly } from "@/lib/validators/types";

describe("validator chain (spec 10)", () => {
  it("runs every phase 0 validator", () => {
    expect(PHASE_0_VALIDATORS).toHaveLength(5);
  });

  it("runs the playability validators from the central chain by default", () => {
    expect(PLAYABILITY_VALIDATORS).toHaveLength(2);
    expect(TONAL_VALIDATORS).toHaveLength(1);
    expect(WARNING_VALIDATORS).toHaveLength(2);
    expect(SONG_VALIDATORS).toHaveLength(10);
    // Order is fixed, so the same song always reports in the same sequence.
    expect(SONG_VALIDATORS).toEqual([
      ...PHASE_0_VALIDATORS,
      ...PLAYABILITY_VALIDATORS,
      ...TONAL_VALIDATORS,
      ...WARNING_VALIDATORS,
    ]);
  });

  it("reaches every added validator without being asked for them", () => {
    const broken = {
      ...SAMPLE_SONG,
      sections: [
        {
          id: "bad",
          name: "Bozuk",
          status: "fixed" as const,
          bars: [
            {
              timeSignature: [4, 4] as TimeSignature,
              resolution: 8 as Resolution,
              slots: {
                gtr: [
                  { notes: [{ pitch: "C0" }] },
                  {
                    notes: [
                      { pitch: "G2", position: { string: 0, fret: 3 } },
                      { pitch: "A2", position: { string: 0, fret: 5 } },
                    ],
                  },
                  // Two pitches that live only on the thickest string.
                  { notes: [{ pitch: "E2" }, { pitch: "F2" }] },
                  // A fourteen-fret leap from the note before it.
                  { notes: [{ pitch: "F#3", position: { string: 0, fret: 14 } }] },
                  ...Array.from({ length: 4 }, () => null),
                ],
              },
            },
          ],
        },
      ],
    };
    const codes = new Set(runValidators(broken).map((issue) => issue.code));
    expect(codes.has("range")).toBe(true);
    expect(codes.has("stringCollision")).toBe(true);
    expect(codes.has("unplaceable")).toBe(true);
    expect(codes.has("fretJump")).toBe(true);
  });

  it("finds nothing wrong with the sample song", () => {
    const issues = runValidators(SAMPLE_SONG);
    expect(issues).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it("keeps the sample song valid against the schema too", () => {
    expect(songSchema.safeParse(SAMPLE_SONG).success).toBe(true);
  });

  it("separates errors from warnings", () => {
    const issues = [
      { code: "a", severity: "error" as const, message: "x" },
      { code: "b", severity: "warning" as const, message: "y" },
    ];
    expect(errorsOnly(issues)).toHaveLength(1);
    expect(warningsOnly(issues)).toHaveLength(1);
    expect(hasErrors(issues)).toBe(true);
  });

  it("collects issues from more than one validator at once", () => {
    const broken = {
      ...SAMPLE_SONG,
      sections: [
        {
          id: "bad",
          name: "Bozuk",
          status: "fixed" as const,
          bars: [
            {
              timeSignature: [4, 4] as TimeSignature,
              resolution: 8 as Resolution,
              slots: { ghost: [null, null] },
            },
          ],
        },
      ],
    };
    const issues = runValidators(broken);
    const codes = new Set(issues.map((issue) => issue.code));
    expect(codes.has("trackReferences")).toBe(true);
    expect(codes.has("slotCount")).toBe(true);
  });
});

describe("sample song content (spec 2.4)", () => {
  it("uses the four core demo tracks", () => {
    expect(SAMPLE_SONG.tracks.map((track) => track.instrumentId)).toEqual([
      "electric_guitar",
      "steel_acoustic",
      "electric_bass",
      "drum_kit",
    ]);
  });

  it("stays within the core bar limit", () => {
    const bars = SAMPLE_SONG.sections.reduce(
      (total, entry) => total + entry.bars.length,
      0,
    );
    expect(bars).toBe(8);
  });

  it("uses only core-scope instruments and presets (spec 2.5)", () => {
    for (const track of SAMPLE_SONG.tracks) {
      expect(isCorePreset(track.instrumentId, track.presetId)).toBe(true);
    }
  });

  it("is written in E minor", () => {
    expect(SAMPLE_SONG.key).toBe("E minor");
  });

  it("leaves the acoustic track silent in the first section (spec 5.5)", () => {
    const intro = SAMPLE_SONG.sections[0];
    expect(intro?.bars.every((bar) => bar.slots.acc === undefined)).toBe(true);
  });
});
