import { describe, expect, it } from "vitest";

import {
  CORE_DRUM_PIECES,
  DRUM_PIECES,
  coreInstruments,
  corePresetIds,
  corePresets,
  getInstrument,
  getPreset,
  isCorePreset,
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

  it("scopes presets independently of the instrument (spec 2.5)", () => {
    expect(corePresetIds("electric_guitar")).toEqual(["clean", "high_gain"]);
    expect(corePresetIds("steel_acoustic")).toEqual(["finger"]);
    expect(corePresetIds("electric_bass")).toEqual(["finger"]);
    expect(corePresetIds("drum_kit")).toEqual(["rock"]);
  });

  it("keeps non-core presets of core instruments out of core scope", () => {
    expect(isCorePreset("electric_guitar", "crunch")).toBe(false);
    expect(isCorePreset("steel_acoustic", "pick")).toBe(false);
    expect(isCorePreset("electric_bass", "driven")).toBe(false);
    expect(isCorePreset("drum_kit", "metal")).toBe(false);
    expect(getPreset("electric_guitar", "crunch")?.scope).toBe("phase_2_5");
  });

  it("marks every preset of a phase 2.5 instrument as phase 2.5", () => {
    for (const instrument of listInstruments()) {
      if (instrument.scope === "core") continue;
      for (const preset of instrument.presets) {
        expect(preset.scope).toBe("phase_2_5");
      }
      expect(corePresets(instrument.id)).toEqual([]);
    }
  });

  it("refuses a core preset on an instrument that is not core", () => {
    expect(isCorePreset("piano", "grand")).toBe(false);
    expect(isCorePreset("theremin", "clean")).toBe(false);
  });

  it("gives every preset an explicit scope", () => {
    for (const instrument of listInstruments()) {
      for (const preset of instrument.presets) {
        expect(["core", "phase_2_5"]).toContain(preset.scope);
      }
    }
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
