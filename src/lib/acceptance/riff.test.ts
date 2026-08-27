/**
 * The Android acceptance fixture, and what the scheduler really does with it.
 *
 * The riff exists to make six behaviours appear honestly in one listen. That
 * only means anything if each of the six actually reaches the audio engine as
 * a *different* instruction — otherwise the guided test would be asking a
 * person "did you hear the difference?" about two identical sounds.
 *
 * So the support matrix is asserted here rather than described in a document:
 * a technique that quietly stopped being scheduled would turn this red before
 * it turned a listening step into a lie.
 */
import { describe, expect, it } from "vitest";

import { RIFF_LANDMARKS, acceptanceRiff } from "@/lib/acceptance/riff";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { songSchema } from "@/lib/song/schema";
import { errorsOnly, runValidators, warningsOnly } from "@/lib/validators";

const parsed = () => songSchema.parse(acceptanceRiff());
const planned = () => buildExpressionPlan(parsed());
const withArticulation = (name: string) =>
  planned().notes.filter((note) => note.articulation === name);

describe("the fixture is an ordinary song", () => {
  it("passes the strict schema and the central validator chain", () => {
    const song = songSchema.safeParse(acceptanceRiff());
    expect(song.success).toBe(true);
    if (!song.success) return;
    const issues = runValidators(song.data);
    expect(errorsOnly(issues).map((issue) => issue.code)).toEqual([]);
    expect(warningsOnly(issues).map((issue) => issue.code)).toEqual([]);
  });

  it("is two sections of two bars, so a loop and a seek have somewhere to go", () => {
    const song = acceptanceRiff();
    expect(song.sections.map((section) => section.id)).toEqual(["s1", "s2"]);
    expect(song.sections.every((section) => section.bars.length === 2)).toBe(true);
    expect(song.sections[0]?.bars[0]?.resolution).toBe(16);
  });

  it("hands out a new song every time, sharing nothing", () => {
    const first = acceptanceRiff();
    const second = acceptanceRiff();
    expect(first).not.toBe(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    first.sections[0]!.bars[0]!.slots.gtr![0] = null;
    expect(acceptanceRiff().sections[0]!.bars[0]!.slots.gtr![0]).not.toBeNull();
  });

  it("puts a real note where the guided test points, and a rest where it needs one", () => {
    const song = acceptanceRiff();
    const slotAt = (key: string, index: number) => {
      const [sectionId, barText] = key.split(":");
      const section = song.sections.find((entry) => entry.id === sectionId);
      return section?.bars[Number(barText)]?.slots.gtr?.[index];
    };
    for (const spot of [RIFF_LANDMARKS.runStart, RIFF_LANDMARKS.runEnd]) {
      const slot = slotAt(spot.barKey, spot.slotIndex);
      expect(slot === null || slot === "-").toBe(false);
    }
    // The pen is previewed on an empty beat, so the ghost is not sitting on a
    // note that is already there.
    expect(slotAt(RIFF_LANDMARKS.emptyBeat.barKey, RIFF_LANDMARKS.emptyBeat.slotIndex)).toBeNull();
  });
});

describe("every technique the test listens to is really scheduled", () => {
  it("makes the legato run one chain: one strike, four pitch moves", () => {
    const chains = planned().chains;
    const legato = chains.find((chain) =>
      chain.transitions.every(
        (step) => step.kind === "hammer_on" || step.kind === "pull_off",
      ),
    );
    expect(legato?.transitions.map((step) => step.kind)).toEqual([
      "hammer_on",
      "hammer_on",
      "pull_off",
      "pull_off",
    ]);
    // Every note after the first is a target: moved, not struck. That is the
    // whole difference a listener is being asked about.
    const targets = withArticulation("hammer_on").concat(withArticulation("pull_off"));
    expect(targets).toHaveLength(4);
    expect(targets.every((note) => note.chainRole === "target")).toBe(true);
    expect(targets.every((note) => note.fallbackReason === undefined)).toBe(true);
  });

  it("makes the two slides a chain of their own, with real travel", () => {
    const slide = planned().chains.find((chain) =>
      chain.transitions.every((step) => step.kind === "slide"),
    );
    expect(slide?.transitions).toHaveLength(2);
    // A slide travels; a hammer-on arrives. More points is the audible
    // difference between them, and it is the reason both get their own step.
    expect(slide?.transitions.every((step) => step.points.length > 2)).toBe(true);
  });

  it("bends a whole step twice as far as a half step", () => {
    const peak = (name: string) =>
      Math.max(...(withArticulation(name)[0]?.pitchAutomation ?? []).map((p) => p.cents));
    expect(peak("bend_half")).toBeCloseTo(100, 1);
    expect(peak("bend_full")).toBeCloseTo(200, 1);
    expect(peak("bend_full")).toBeGreaterThan(peak("bend_half"));
  });

  it("moves the pitch around the note for a vibrato, and comes back", () => {
    const points = withArticulation("vibrato")[0]?.pitchAutomation ?? [];
    expect(points.length).toBeGreaterThan(10);
    expect(Math.min(...points.map((p) => p.cents))).toBeLessThan(0);
    expect(Math.max(...points.map((p) => p.cents))).toBeGreaterThan(0);
  });

  it("shortens and filters a palm-muted note rather than only quietening it", () => {
    const muted = withArticulation("palm_mute");
    expect(muted.length).toBeGreaterThanOrEqual(3);
    expect(muted.every((note) => note.filterPreset === "palm_mute")).toBe(true);
    expect(muted.every((note) => (note.gainEnvelope?.length ?? 0) > 1)).toBe(true);
  });

  it("leaves no technique in the fixture the engine would silently ignore", () => {
    /*
     * The guided test must never ask a person whether they heard something the
     * scheduler never played. Every articulation the riff writes is expressive
     * and none of them fell back.
     */
    const written = planned().notes.filter((note) => note.articulation !== undefined);
    expect(written.length).toBeGreaterThan(10);
    expect(written.every((note) => note.expressive)).toBe(true);
    expect(written.every((note) => note.fallbackReason === undefined)).toBe(true);
  });
});
