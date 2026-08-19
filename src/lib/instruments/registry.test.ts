import { describe, expect, it } from "vitest";

import {
  CORE_DRUM_PIECES,
  DRUM_PIECES,
  coreInstruments,
  getInstrument,
  getPreset,
  isDrumInstrument,
  listInstruments,
} from "@/lib/instruments/registry";

describe("instrument registry (spec 7.1)", () => {
  it("declares the ten Core Lite instruments", () => {
    expect(listInstruments()).toHaveLength(10);
  });

  it("marks exactly the four demo instruments as core (spec 2.4)", () => {
    expect(coreInstruments().map((entry) => entry.id)).toEqual([
      "electric_guitar",
      "steel_acoustic",
      "electric_bass",
      "drum_kit",
    ]);
  });

  it("gives the electric guitar clean and high gain variants (spec 2.5)", () => {
    const presets = getInstrument("electric_guitar")?.presets.map((p) => p.id);
    expect(presets).toContain("clean");
    expect(presets).toContain("high_gain");
  });

  it("produces high gain from the sample chain, not a separate sampler", () => {
    expect(getPreset("electric_guitar", "high_gain")?.engine).toBe("sampler_fx");
    expect(getPreset("electric_guitar", "clean")?.engine).toBe("sampler");
  });

  it("gives the acoustic steel and finger variants", () => {
    const presets = getInstrument("steel_acoustic")?.presets.map((p) => p.id);
    expect(presets).toEqual(["finger", "pick"]);
  });

  it("recognises only the drum kit as a drum instrument", () => {
    expect(isDrumInstrument("drum_kit")).toBe(true);
    expect(isDrumInstrument("electric_guitar")).toBe(false);
  });

  it("keeps the core drum pieces inside the full vocabulary", () => {
    for (const piece of CORE_DRUM_PIECES) {
      expect(DRUM_PIECES).toContain(piece);
    }
    expect(CORE_DRUM_PIECES).toEqual(["kick", "snare", "closed_hat", "crash"]);
  });

  it("returns undefined for unknown ids instead of throwing", () => {
    expect(getInstrument("theremin")).toBeUndefined();
    expect(getPreset("electric_guitar", "nope")).toBeUndefined();
  });

  it("lets fretted instruments name a default tuning preset", () => {
    expect(getInstrument("electric_guitar")?.defaultTuningPresetId).toBe(
      "e_standard",
    );
    expect(getInstrument("electric_bass")?.defaultTuningPresetId).toBe(
      "bass_standard",
    );
    expect(getInstrument("drum_kit")?.defaultTuningPresetId).toBeUndefined();
  });
});
