/**
 * The attack table, and the reason it is not decoration (2V-C.4 §5).
 *
 * The handoff's tail is derived from these numbers, so a table that quietly
 * lost its variation would give every note the same handoff and nobody would
 * see a failure — the envelope would still be produced, just wrong. The
 * measurements themselves are checked against the real decoded audio by
 * `profile-samples.mjs`; what is checked here is that the lookup asks the
 * right question of them.
 */
import { describe, expect, it } from "vitest";

import { samplePackFor } from "@/lib/audio/packs";
import {
  attackSecondsFor,
  DEFAULT_ATTACK_SECONDS,
  SAMPLE_ATTACK_SECONDS,
} from "@/lib/audio/sample-onset";
import { pitchToMidi } from "@/lib/music/pitch";

const guitar = samplePackFor("electric_guitar", "high_gain")!;

describe("132. how long each recording takes to arrive", () => {
  it("has a number for every file of every pack", () => {
    for (const [instrument, preset] of [
      ["electric_guitar", "high_gain"],
      ["steel_acoustic", "finger"],
      ["electric_bass", "finger"],
    ] as const) {
      const pack = samplePackFor(instrument, preset)!;
      const table = SAMPLE_ATTACK_SECONDS[pack.id]!;
      for (const note of Object.keys(pack.urls)) {
        expect(table[note], `${pack.id} ${note}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the range that makes the policy worth having", () => {
    /* Measured, the guitar pack spans 3 ms to 31 ms. If a later edit flattened
       that, every note would get the same handoff and the sample-aware part of
       the fix would be gone without a single test going red. */
    const table = SAMPLE_ATTACK_SECONDS[guitar.id]!;
    const values = Object.values(table);
    expect(Math.min(...values)).toBeLessThan(0.005);
    expect(Math.max(...values)).toBeGreaterThan(0.025);
  });

  it("asks the same recording the voice will play", () => {
    /* E4 is a recording in the pack; D#4 is not, and rounds to it. */
    const e4 = attackSecondsFor(guitar, pitchToMidi("E4")!);
    expect(e4).toBeCloseTo(SAMPLE_ATTACK_SECONDS[guitar.id]!.E4!, 9);
    const a3 = attackSecondsFor(guitar, pitchToMidi("A3")!);
    expect(a3).toBeCloseTo(SAMPLE_ATTACK_SECONDS[guitar.id]!.A3!, 9);
    expect(a3).toBeGreaterThan(e4);
  });

  it("shortens the attack when the recording is played faster", () => {
    /* G4 plays the E4 recording three semitones up, so its head arrives
       sooner by exactly that ratio — the same arithmetic the voice uses. */
    const e4 = attackSecondsFor(guitar, pitchToMidi("E4")!);
    const g4 = attackSecondsFor(guitar, pitchToMidi("G4")!);
    expect(g4).toBeLessThan(e4);
    expect(g4).toBeCloseTo(e4 / Math.pow(2, 3 / 12), 6);
  });

  it("falls back rather than guessing when there is no pack", () => {
    expect(attackSecondsFor(undefined, 60)).toBe(DEFAULT_ATTACK_SECONDS);
  });

  it("gives a default inside the measured range", () => {
    /* At the fast end it would leave a gap on an unmeasured pack; at the slow
       end it would smear one. Neither announces itself. */
    const values = Object.values(SAMPLE_ATTACK_SECONDS[guitar.id]!);
    expect(DEFAULT_ATTACK_SECONDS).toBeGreaterThan(Math.min(...values));
    expect(DEFAULT_ATTACK_SECONDS).toBeLessThan(Math.max(...values));
  });
});
