import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { applyPatch } from "@/lib/copilot/apply";
import { modelPatchSchema, type ModelPatch } from "@/lib/copilot/contract";
import {
  STYLE_CARD_IDS,
  extractExamples,
  styleCardPath,
} from "@/lib/copilot/style-cards";
import { slotCount } from "@/lib/music/timing";
import type { Bar, Song, Track } from "@/lib/song/schema";
import { songSchema } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import { errorsOnly } from "@/lib/validators/types";

const BODIES = Object.fromEntries(
  STYLE_CARD_IDS.map((id) => [id, readFileSync(styleCardPath(id), "utf8")]),
) as Record<string, string>;

const GUITAR: Track = {
  id: "ornek-gitar",
  name: "Ornek gitar",
  instrumentId: "electric_guitar",
  presetId: "clean",
  volumeDb: -6,
  fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};

const BASS: Track = {
  id: "ornek-bas",
  name: "Ornek bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: ["E1", "A1", "D2", "G2"], capo: 0 },
};

const DRUMS: Track = {
  id: "ornek-davul",
  name: "Ornek davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -4,
};

const TRACKS = [GUITAR, BASS, DRUMS];

/**
 * A song shaped to fit the example: the same number of bars, 4/4 at eighth
 * notes, in the key the cards are written in, with the track the example
 * targets silent so the example is what fills it.
 */
function hostSong(patch: ModelPatch): Song {
  const bars: Bar[] = patch.bars.map(() => ({
    timeSignature: [4, 4],
    resolution: 8,
    slots: {},
  }));

  const candidate = {
    version: 2,
    title: "Stil karti ornegi",
    bpm: 120,
    key: "E minor",
    tracks: TRACKS,
    sections: [
      { id: patch.sectionId, name: "Ornek", status: "fixed", bars },
    ],
  };

  const parsed = songSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("host song does not parse");
  return parsed.data;
}

describe("style card examples (spec 11.7)", () => {
  it("ships two examples on every card", () => {
    for (const id of STYLE_CARD_IDS) {
      expect(extractExamples(BODIES[id] ?? "")).toHaveLength(2);
    }
  });

  for (const id of STYLE_CARD_IDS) {
    describe(id, () => {
      const examples = extractExamples(BODIES[id] ?? "");

      examples.forEach((example, index) => {
        it(`example ${index + 1} parses against the strict output schema`, () => {
          const parsed = modelPatchSchema.safeParse(example);
          if (!parsed.success) {
            throw new Error(
              parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; "),
            );
          }
          expect(parsed.success).toBe(true);
        });

        it(`example ${index + 1} carries no id and no written position`, () => {
          const text = JSON.stringify(example);
          expect(text).not.toContain('"id"');
          expect(text).not.toContain('"position"');
          expect(text).not.toContain('"string"');
          expect(text).not.toContain('"fret"');
        });

        it(`example ${index + 1} fills every slot of every bar it writes`, () => {
          const patch = modelPatchSchema.parse(example);
          for (const bar of patch.bars) {
            expect(bar.slots).toHaveLength(slotCount([4, 4], 8));
          }
          // Bar indexes are in order and each appears once.
          expect(patch.bars.map((bar) => bar.barIndex)).toEqual(
            patch.bars.map((_, position) => position),
          );
        });

        it(`example ${index + 1} produces no validator error`, () => {
          const patch = modelPatchSchema.parse(example);
          const applied = applyPatch(hostSong(patch), { id: "ornek", ...patch });
          expect(applied.ok).toBe(true);
          if (!applied.ok) return;

          const issues = runValidators(applied.song);
          expect(errorsOnly(issues)).toEqual([]);
        });
      });

      it("names no artist, band or song", () => {
        const body = (BODIES[id] ?? "").toLowerCase();
        for (const name of ["opeth", "metallica", "tarzinda", "in the style of"]) {
          expect(body).not.toContain(name);
        }
        expect(BODIES[id]).toContain("not an artist");
      });

      it("shows something the card actually describes", () => {
        const patches = examples.map((example) => modelPatchSchema.parse(example));
        const slots: unknown[] = patches.flatMap((patch) =>
          patch.bars.flatMap((bar) => bar.slots as unknown[]),
        );
        // Not a random note salad: there is real silence in every card, which
        // is the trait both of them insist on.
        const rests = slots.filter(
          (slot) => slot === null || (Array.isArray(slot) && slot.length === 0),
        );
        expect(rests.length).toBeGreaterThan(0);
        // And something is actually played.
        const played = slots.filter(
          (slot) =>
            slot !== null &&
            slot !== "-" &&
            (Array.isArray(slot)
              ? slot.length > 0
              : (slot as { notes: unknown[] }).notes.length > 0),
        );
        expect(played.length).toBeGreaterThan(3);
      });
    });
  }

  it("targets both a melodic and a drum track across the cards", () => {
    const targets = STYLE_CARD_IDS.flatMap((id) =>
      extractExamples(BODIES[id] ?? "").map(
        (example) => modelPatchSchema.parse(example).targetTrackId,
      ),
    );
    expect(new Set(targets).size).toBeGreaterThan(1);
    expect(targets).toContain("ornek-davul");
  });
});
