import { describe, expect, it } from "vitest";

import { arrangeAnswer, arrangeBars } from "@/lib/ai/fake-skills";
import { modelPatchSchema } from "@/lib/copilot/contract";
import { applyPatch } from "@/lib/copilot/apply";
import { checkLockedSurface, surfaceDigest } from "@/lib/copilot/scope";
import { runValidators } from "@/lib/validators";
import { hasErrors } from "@/lib/validators/types";
import { classifyTone, parseKey } from "@/lib/music/tonality";
import type { ArrangeSkill, ModelBar } from "@/lib/copilot/contract";
import type { Song, Track } from "@/lib/song/schema";
import {
  HARMONY_SONG,
  TEST_SONG,
  mainSection,
} from "@/test/copilot-fixtures";

const SECTION_ID = mainSection().id;

function setup(skill: ArrangeSkill): { song: Song; target: Track } {
  const song = skill === "harmony" ? HARMONY_SONG : TEST_SONG;
  const targetId = skill === "harmony" ? "gtr2" : skill === "bass" ? "bass" : "drums";
  const target = song.tracks.find((track) => track.id === targetId);
  if (!target) throw new Error(`fixture has no ${targetId}`);
  return { song, target };
}

function bars(skill: ArrangeSkill): ModelBar[] {
  const { song, target } = setup(skill);
  const section = song.sections.find((entry) => entry.id === SECTION_ID);
  if (!section) throw new Error("fixture section missing");
  return arrangeBars({ song, section, target, skill });
}

const SKILLS: ArrangeSkill[] = ["drums", "bass", "harmony"];

describe("the three deterministic skills", () => {
  for (const skill of SKILLS) {
    it(`${skill}: answers in the shape the contract asks for`, () => {
      const { song, target } = setup(skill);
      const section = song.sections.find((entry) => entry.id === SECTION_ID);
      if (!section) throw new Error("fixture section missing");

      const raw = arrangeAnswer({
        song,
        section,
        target,
        skill,
        sectionId: SECTION_ID,
      });
      const parsed = modelPatchSchema.safeParse(JSON.parse(raw));
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.targetTrackId).toBe(target.id);
      expect(parsed.data.bars).toHaveLength(section.bars.length);
    });

    it(`${skill}: gives the same answer every time`, () => {
      expect(bars(skill)).toEqual(bars(skill));
    });

    it(`${skill}: changes only the target track`, () => {
      const { song, target } = setup(skill);
      const before = surfaceDigest(song);
      const applied = applyPatch(song, {
        id: "p1",
        operation: "arrange_track",
        sectionId: SECTION_ID,
        targetTrackId: target.id,
        bars: bars(skill),
        explanation: "x",
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;

      expect(
        checkLockedSurface(before, surfaceDigest(applied.song), {
          sectionId: SECTION_ID,
          targetTrackId: target.id,
        }),
      ).toEqual([]);
    });

    it(`${skill}: produces a candidate the whole chain accepts`, () => {
      const { song, target } = setup(skill);
      const applied = applyPatch(song, {
        id: "p1",
        operation: "arrange_track",
        sectionId: SECTION_ID,
        targetTrackId: target.id,
        bars: bars(skill),
        explanation: "x",
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(hasErrors(runValidators(applied.song))).toBe(false);
    });
  }

  it("drums: writes drum slots and reads only the guitar's rhythm", () => {
    const written = bars("drums");
    for (const bar of written) {
      for (const slot of bar.slots) {
        expect(Array.isArray(slot)).toBe(true);
      }
    }
    // Something is actually played, so the shape tests are not vacuous.
    const hits = written.flatMap((bar) =>
      bar.slots.flatMap((slot) => (Array.isArray(slot) ? slot : [])),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("bass: writes melodic slots and no written position", () => {
    const written = bars("bass");
    const notes = written.flatMap((bar) =>
      bar.slots.flatMap((slot) =>
        slot !== null && slot !== "-" && !Array.isArray(slot) ? slot.notes : [],
      ),
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note).not.toHaveProperty("position");
    }
  });

  it("bass: follows the guitar without doubling every note of it", () => {
    const section = TEST_SONG.sections.find((entry) => entry.id === SECTION_ID);
    if (!section) throw new Error("fixture section missing");
    const guitarOnsets = section.bars.reduce((total, bar) => {
      const slots = bar.slots.gtr ?? [];
      return (
        total +
        slots.filter((slot) => slot !== null && slot !== "-" && !Array.isArray(slot))
          .length
      );
    }, 0);
    const bassOnsets = bars("bass").reduce(
      (total, bar) =>
        total +
        bar.slots.filter(
          (slot) => slot !== null && slot !== "-" && !Array.isArray(slot),
        ).length,
      0,
    );
    expect(bassOnsets).toBeGreaterThan(0);
    expect(bassOnsets).toBeLessThanOrEqual(guitarOnsets);
  });

  it("harmony: writes core-scale notes and leaves the source guitar alone", () => {
    const key = parseKey(HARMONY_SONG.key);
    if (!key) throw new Error("fixture key unreadable");

    const notes = bars("harmony").flatMap((bar) =>
      bar.slots.flatMap((slot) =>
        slot !== null && slot !== "-" && !Array.isArray(slot) ? slot.notes : [],
      ),
    );
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(classifyTone(note.pitch, key).kind).toBe("core");
      expect(note).not.toHaveProperty("position");
    }

    const applied = applyPatch(HARMONY_SONG, {
      id: "p1",
      operation: "arrange_track",
      sectionId: SECTION_ID,
      targetTrackId: "gtr2",
      bars: bars("harmony"),
      explanation: "x",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const originalGuitar = HARMONY_SONG.sections
      .find((s) => s.id === SECTION_ID)
      ?.bars.map((bar) => bar.slots.gtr);
    const patchedGuitar = applied.song.sections
      .find((s) => s.id === SECTION_ID)
      ?.bars.map((bar) => bar.slots.gtr);
    expect(patchedGuitar).toEqual(originalGuitar);
  });
});

describe("expression in a fake answer (spec 8.5)", () => {
  it("writes articulations the contract accepts", () => {
    const written = bars("harmony");

    const articulations = written.flatMap((bar) =>
      bar.slots.flatMap((slot) =>
        slot === null || slot === "-" || Array.isArray(slot)
          ? []
          : slot.notes.map((note) => note.articulation),
      ),
    );

    expect(articulations.some((value) => value !== undefined)).toBe(true);
    expect(
      modelPatchSchema.safeParse({
        operation: "arrange_track",
        sectionId: SECTION_ID,
        targetTrackId: "gtr2",
        bars: written,
        explanation: "test",
      }).success,
    ).toBe(true);
  });

  it("only writes articulations whose context always holds", () => {
    const used = new Set(
      bars("harmony").flatMap((bar) =>
        bar.slots.flatMap((slot) =>
          slot === null || slot === "-" || Array.isArray(slot)
            ? []
            : slot.notes.map((note) => note.articulation).filter(Boolean),
        ),
      ),
    );

    // Nothing that depends on the note before it: a fixture must not teach a
    // habit the validator would then warn about.
    expect(used.has("slide")).toBe(false);
    expect(used.has("hammer_on")).toBe(false);
    expect(used.has("pull_off")).toBe(false);
    expect(used.size).toBeGreaterThan(0);
  });

  it("gives the same answer every time", () => {
    const runs = Array.from({ length: 3 }, () => JSON.stringify(bars("harmony")));
    expect(new Set(runs).size).toBe(1);
  });
});
