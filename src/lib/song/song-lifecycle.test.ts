/**
 * The song-level lifecycle (spec 13.17, 2L-B §3, §4, §5, §14).
 *
 * Templates are judged by the same law as everything else — the strict
 * schema and the central validator chain — and determinism is asserted the
 * only way it can be: the same input, five times, byte for byte.
 */
import { describe, expect, it } from "vitest";

import { identifiersOf } from "@/lib/dev/ast";
import { bpmRange } from "@/lib/limits";
import { sameSong } from "@/lib/song/edit-history";
import { historyActionLabel } from "@/lib/song/history-labels";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema } from "@/lib/song/schema";
import {
  applySongCommand,
  parseKey,
  TONIC_OPTIONS,
} from "@/lib/song/song-lifecycle";
import {
  SONG_TEMPLATES,
  TEMPLATE_DEFAULTS,
  materializeTemplate,
} from "@/lib/song/song-templates";
import { errorsOnly, runValidators } from "@/lib/validators";

const frozenSample = JSON.stringify(SAMPLE_SONG);

describe("42. the three templates", () => {
  it("all pass the strict schema and the validator chain with zero errors", () => {
    for (const template of SONG_TEMPLATES) {
      const song = materializeTemplate(template.id);
      expect(song, template.id).not.toBeNull();
      const parsed = songSchema.safeParse(song);
      expect(parsed.success, template.id).toBe(true);
      if (parsed.success) {
        expect(errorsOnly(runValidators(parsed.data)), template.id).toEqual([]);
      }
    }
  });

  it("share the one central set of defaults", () => {
    for (const template of SONG_TEMPLATES) {
      const song = materializeTemplate(template.id)!;
      expect(song.title).toBe(TEMPLATE_DEFAULTS.title);
      expect(song.key).toBe(TEMPLATE_DEFAULTS.key);
      expect(song.bpm).toBe(TEMPLATE_DEFAULTS.bpm);
      expect(song.sections).toHaveLength(1);
      const section = song.sections[0]!;
      expect(section.name).toBe(TEMPLATE_DEFAULTS.sectionName);
      expect(section.bpmOverride).toBeUndefined();
      expect(section.bars).toHaveLength(TEMPLATE_DEFAULTS.barCount);
      for (const bar of section.bars) {
        expect(bar.timeSignature).toEqual(TEMPLATE_DEFAULTS.timeSignature);
        expect(bar.resolution).toBe(TEMPLATE_DEFAULTS.resolution);
        // Silence is a missing key, not an empty array (spec 5.5).
        expect(Object.keys(bar.slots)).toEqual([]);
      }
    }
  });

  it("stand up the instruments the spec names", () => {
    const instruments = (id: string) =>
      materializeTemplate(id)!.tracks.map((track) => track.instrumentId);
    expect(instruments("empty")).toEqual(["electric_guitar"]);
    expect(instruments("rock_band")).toEqual([
      "electric_guitar",
      "electric_bass",
      "drum_kit",
    ]);
    expect(instruments("acoustic")).toEqual(["steel_acoustic"]);
  });

  it("resolves preset, tuning and capo from the registry", () => {
    const rock = materializeTemplate("rock_band")!;
    const [guitar, bass, drums] = rock.tracks;
    expect(guitar?.presetId).toBe("clean");
    expect(guitar?.fretboard?.tuning).toHaveLength(6);
    expect(guitar?.fretboard?.capo).toBe(0);
    expect(bass?.fretboard?.tuning).toHaveLength(4);
    // A drum kit has no fretboard, and none is invented for it.
    expect(drums?.fretboard).toBeUndefined();
  });

  it("materialises byte-identically five times over", () => {
    for (const template of SONG_TEMPLATES) {
      const runs = Array.from({ length: 5 }, () =>
        JSON.stringify(materializeTemplate(template.id)),
      );
      expect(new Set(runs).size, template.id).toBe(1);
    }
  });

  it("uses no clock and no randomness anywhere in the lifecycle", () => {
    // Asked of the syntax tree: no identifier in any lifecycle module is
    // Date, random or randomUUID — determinism by construction (2L-B §3).
    for (const path of [
      "src/lib/song/lifecycle-ids.ts",
      "src/lib/song/song-templates.ts",
      "src/lib/song/song-lifecycle.ts",
      "src/lib/song/section-lifecycle.ts",
      "src/lib/song/track-lifecycle.ts",
      "src/lib/workspace/use-lifecycle.ts",
    ]) {
      const names = identifiersOf(path);
      for (const banned of ["Date", "random", "randomUUID", "crypto"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("no longer offers a command that replaces the open song", () => {
    /*
     * `create_song` is gone (2O-A §18). It was the only command that threw the
     * reader's music away, and its replacement makes a project beside it
     * instead. Leaving the old command callable would have left a live route
     * back to the behaviour the checkpoint exists to remove — so this asserts
     * the route is closed, at the type level and at runtime.
     */
    const command = { kind: "create_song", templateId: "empty" };
    const result = applySongCommand(
      SAMPLE_SONG,
      command as unknown as Parameters<typeof applySongCommand>[1],
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  });
});

describe("43. the song info command", () => {
  const info = {
    title: "Başka Ad",
    tonic: "A",
    mode: "minor" as const,
    bpm: 96,
  };

  it("changes exactly the three top-level facts", () => {
    const result = applySongCommand(SAMPLE_SONG, {
      kind: "update_song_info",
      info,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.title).toBe("Başka Ad");
    expect(result.song.key).toBe("A minor");
    expect(result.song.bpm).toBe(96);
    expect(sameSong(result.song.sections, SAMPLE_SONG.sections)).toBe(true);
    expect(sameSong(result.song.tracks, SAMPLE_SONG.tracks)).toBe(true);
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  });

  it("keeps section tempo overrides when the base tempo changes", () => {
    const withOverride = {
      ...SAMPLE_SONG,
      sections: SAMPLE_SONG.sections.map((section, index) =>
        index === 0 ? { ...section, bpmOverride: 90 } : section,
      ),
    };
    const result = applySongCommand(withOverride, {
      kind: "update_song_info",
      info: { ...info, bpm: 200 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.song.sections[0]?.bpmOverride).toBe(90);
      expect(result.song.bpm).toBe(200);
    }
  });

  it("rejects an out-of-range tempo atomically, from the central limits", () => {
    for (const bpm of [bpmRange.min - 1, bpmRange.max + 1, Number.NaN]) {
      const result = applySongCommand(SAMPLE_SONG, {
        kind: "update_song_info",
        info: { ...info, bpm },
      });
      expect(result.ok, String(bpm)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("bpm_out_of_range");
    }
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  });

  it("rejects an empty title and an unknown tonic", () => {
    const blank = applySongCommand(SAMPLE_SONG, {
      kind: "update_song_info",
      info: { ...info, title: "   " },
    });
    expect(!blank.ok && blank.error.code).toBe("invalid_title");
    const oddTonic = applySongCommand(SAMPLE_SONG, {
      kind: "update_song_info",
      info: { ...info, tonic: "H" },
    });
    expect(!oddTonic.ok && oddTonic.error.code).toBe("invalid_key");
  });

  it("returns the same music for a no-op, which the gate then refuses", () => {
    const parsed = parseKey(SAMPLE_SONG.key)!;
    const result = applySongCommand(SAMPLE_SONG, {
      kind: "update_song_info",
      info: {
        title: SAMPLE_SONG.title,
        tonic: parsed.tonic,
        mode: parsed.mode,
        bpm: SAMPLE_SONG.bpm,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(sameSong(result.song, SAMPLE_SONG)).toBe(true);
  });

  it("speaks in keys the schema speaks", () => {
    for (const tonic of TONIC_OPTIONS) {
      const result = applySongCommand(SAMPLE_SONG, {
        kind: "update_song_info",
        info: { ...info, tonic },
      });
      // Tonal majority may reject the music in a far-away key; the *key text*
      // itself must never be the reason.
      if (!result.ok) {
        expect(result.error.code, tonic).not.toBe("invalid_key");
      }
    }
  });
});

describe("44. the fourteen reader labels", () => {
  it("names every lifecycle command without leaking a command id", () => {
    const labels = [
      "update_song_info",
      "create_section",
      "rename_section",
      "duplicate_section",
      "move_section",
      "delete_section",
      "set_section_tempo_override",
      "clear_section_tempo_override",
      "create_track",
      "rename_track",
      "duplicate_track",
      "move_track",
      "delete_track",
      "update_track_setup",
      "replace_track_setup_and_clear_content",
    ] as const;
    const seen = new Set<string>();
    for (const command of labels) {
      const label = historyActionLabel({ kind: "lifecycle", command });
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_");
      seen.add(label);
    }
    // Fifteen commands, fourteen sentences: set/clear tempo share one.
    expect(seen.size).toBe(14);
  });
});
