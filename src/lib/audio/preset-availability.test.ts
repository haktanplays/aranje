/**
 * Whether a preset can be heard, and what happens when it cannot (2O-B.1 §2).
 *
 * The rule these tests exist to hold: being in the registry and being
 * playable are two different facts, and no code path may quietly turn one
 * into the other — not by inventing a file, not by borrowing another
 * preset's samples, and not by rewriting somebody's song.
 */
import { describe, expect, it } from "vitest";

import {
  audioPresetAvailability,
  corePresetOptions,
  isPlayablePreset,
  playableCorePresets,
  silentTrackNotice,
  silentTracks,
} from "@/lib/audio/preset-availability";
import { samplePackFor } from "@/lib/audio/packs";
import { corePresets, getPreset, listInstruments } from "@/lib/instruments/registry";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { SONG_TEMPLATES, materializeTemplate } from "@/lib/song/song-templates";
import { songSchema, type Song, type Track } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { canonicalJson } from "@/lib/copilot/fingerprint";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { errorsOnly, runValidators } from "@/lib/validators";

const trackOn = (instrumentId: string, presetId: string, name = "Track"): Track => ({
  id: "track-1",
  name,
  instrumentId,
  presetId,
  volumeDb: -6,
});

describe("168. registry visibility is not audibility", () => {
  it("keeps a preset with no vendored pack in the registry and out of earshot", () => {
    // The whole point of the checkpoint in one assertion: `clean` still
    // exists, is still core scope, and still cannot be heard.
    expect(getPreset("electric_guitar", "clean")).toBeDefined();
    expect(corePresets("electric_guitar").map((preset) => preset.id)).toContain("clean");
    expect(isPlayablePreset("electric_guitar", "clean")).toBe(false);
    expect(audioPresetAvailability("electric_guitar", "clean")).toEqual({
      status: "unavailable",
      reason: "sample_pack_missing",
    });
  });

  it("reports the decoded asset set, not the preset name, as the bank key", () => {
    const high = audioPresetAvailability("electric_guitar", "high_gain");
    const acoustic = audioPresetAvailability("steel_acoustic", "finger");
    expect(high.status).toBe("available");
    expect(acoustic.status).toBe("available");
    if (high.status !== "available" || acoustic.status !== "available") return;
    expect(high.bankKey).not.toBe(acoustic.bankKey);
    // The key names the files, so two presets cannot collide and a pack
    // pointed at a different set of files is a different bank.
    expect(high.bankKey).toContain("E2=E2.mp3");
    expect(high.bankKey).toContain(samplePackFor("electric_guitar", "high_gain")!.baseUrl);
    expect(high.sampleCount).toBe(7);
  });

  it("calls the synthesised kit available with nothing to download", () => {
    const drums = audioPresetAvailability("drum_kit", "rock");
    expect(drums).toEqual({
      status: "available",
      source: "synthesised",
      sampleCount: 0,
      bankKey: null,
    });
  });

  it("agrees with the vendored manifest on every registry pair", () => {
    for (const instrument of listInstruments()) {
      for (const preset of instrument.presets) {
        const availability = audioPresetAvailability(instrument.id, preset.id);
        const expected =
          isDrumInstrument(instrument.id) ||
          samplePackFor(instrument.id, preset.id) !== undefined;
        expect(availability.status === "available", `${instrument.id}/${preset.id}`).toBe(
          expected,
        );
      }
    }
  });
});

describe("169. a launch template hands over something that can be heard", () => {
  it.each(SONG_TEMPLATES.map((template) => template.id))(
    "%s stands up no silent track",
    (templateId) => {
      const song = materializeTemplate(templateId);
      expect(song).not.toBeNull();
      // Fail closed: the assertion is about audibility itself, so vendoring
      // or withdrawing a pack changes this result rather than going unnoticed.
      expect(silentTracks(song!)).toEqual([]);
    },
  );

  it("still produces a song the schema and the registry both accept", () => {
    for (const template of SONG_TEMPLATES) {
      const song = materializeTemplate(template.id)!;
      expect(songSchema.safeParse(song).success, template.id).toBe(true);
      for (const track of song.tracks) {
        expect(getPreset(track.instrumentId, track.presetId), track.presetId).toBeDefined();
      }
    }
  });

  it("filters rather than re-ranks, so the choice stays the registry's order", () => {
    const playable = playableCorePresets("electric_guitar").map((preset) => preset.id);
    const all = corePresets("electric_guitar").map((preset) => preset.id);
    expect(playable).toEqual(all.filter((id) => playable.includes(id)));
    expect(playable[0]).toBe("high_gain");
  });

  it("refuses a track rather than materialising a silent one", () => {
    // An instrument with no playable core preset has no defensible track to
    // build, and the template says so by refusing.
    expect(playableCorePresets("piano")).toEqual([]);
    expect(materializeTemplate("no-such-template")).toBeNull();
  });
});

describe("170. a song carrying an unavailable preset is told the truth, not corrected", () => {
  const legacy: Song = {
    ...SAMPLE_SONG,
    tracks: [trackOn("electric_guitar", "clean", "Ritim Gitar")],
    sections: [],
  };

  it("leaves the song exactly as it found it", () => {
    const before = JSON.stringify(legacy);
    silentTracks(legacy);
    audioPresetAvailability("electric_guitar", "clean");
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it("names the track the reader named, and nothing technical", () => {
    const notice = silentTrackNotice(silentTracks(legacy));
    expect(notice).not.toBeNull();
    expect(notice).toContain("Ritim Gitar");
    for (const leak of [
      "clean",
      "electric_guitar",
      "sample_pack_missing",
      "/samples/",
      ".mp3",
      "manifest",
      "{",
    ]) {
      expect(notice, `notice leaks ${leak}`).not.toContain(leak);
    }
  });

  it("says nothing at all when every track can sound", () => {
    expect(silentTrackNotice(silentTracks(SAMPLE_SONG))).toBeNull();
    expect(silentTracks(SAMPLE_SONG)).toEqual([]);
  });

  it("keeps a picker showing what the track already carries, un-choosable", () => {
    const options = corePresetOptions("electric_guitar", "clean");
    const clean = options.find((option) => option.preset.id === "clean");
    expect(clean).toBeDefined();
    expect(clean?.playable).toBe(false);
    // And it is not offered to a track that did not already have it.
    expect(
      corePresetOptions("electric_guitar", "high_gain").map((option) => option.preset.id),
    ).toEqual(["high_gain"]);
  });

  it("offers nothing extra for a preset the registry has never heard of", () => {
    expect(
      corePresetOptions("electric_guitar", "not-a-preset").map((o) => o.preset.id),
    ).toEqual(["high_gain"]);
  });
});

describe("171. availability is not part of the Song Contract", () => {
  const legacy: Song = {
    ...SAMPLE_SONG,
    tracks: [trackOn("electric_guitar", "clean", "Ritim Gitar")],
    sections: [],
  };

  it("adds no field to a song, an exported project or a fingerprint input", () => {
    const exported = exportProject(legacy);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    for (const word of [
      "availability",
      "playable",
      "bankKey",
      "sample_pack_missing",
      "silentTrack",
    ]) {
      expect(exported.text, `project file carries ${word}`).not.toContain(word);
    }
    // The song that comes back is the song that went in, byte for byte.
    const roundTrip = parseProjectText(exported.text);
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(canonicalJson(roundTrip.song)).toBe(canonicalJson(legacy));
    expect(roundTrip.song.tracks[0]?.presetId).toBe("clean");
  });

  it("leaves the schema and the validator chain saying what they said before", () => {
    // A legacy project with an unavailable preset still opens. Availability is
    // a fact about this build's assets; schema validity is a fact about the
    // file, and turning the first into the second would lock people out of
    // their own songs.
    expect(songSchema.safeParse(legacy).success).toBe(true);
    expect(errorsOnly(runValidators(legacy))).toEqual([]);
  });
});
