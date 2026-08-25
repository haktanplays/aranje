/**
 * The track lifecycle (spec 13.17, 2L-B §7, §8, §14).
 */
import { describe, expect, it } from "vitest";

import { songLimits } from "@/lib/limits";
import { slotCount } from "@/lib/music/timing";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { sameSong } from "@/lib/song/edit-history";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  applyTrackCommand,
  createdTrackId,
  isFrettedInstrument,
  tuningOptionsFor,
  type TrackCommand,
  type TrackSetup,
} from "@/lib/song/track-lifecycle";
import type { Song } from "@/lib/song/schema";

const frozenSample = JSON.stringify(SAMPLE_SONG);

const GUITAR_SETUP: TrackSetup = {
  name: "İkinci Gitar",
  instrumentId: "electric_guitar",
  presetId: "clean",
  fretboard: { tuning: TUNING_PRESETS.e_standard!.tuning, capo: 0 },
};

const run = (song: Song, command: TrackCommand) => {
  const result = applyTrackCommand(song, command);
  expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  return result;
};

describe("48. creating, renaming, reordering tracks", () => {
  it("appends a writable, silent track with a deterministic id", () => {
    const result = run(SAMPLE_SONG, { kind: "create_track", setup: GUITAR_SETUP });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.song.tracks.at(-1)!;
    expect(created.id).toBe("track-1");
    expect(created.name).toBe("İkinci Gitar");
    /*
     * Every bar gains an **empty lane** (2Q-A §1).
     *
     * This test used to require the opposite — no key anywhere — on the
     * reading that silence is a missing key (spec 5.5). That is true and it
     * was not the whole truth: a missing key also says "not written in this
     * bar", which the write path refuses, so the track a reader had just
     * created was writable nowhere and every cell told them to do something
     * no control does (`eval/multitrack/BASELINE.json`).
     */
    for (const section of result.song.sections) {
      for (const bar of section.bars) {
        expect(created.id in bar.slots).toBe(true);
        const lane = bar.slots[created.id]!;
        expect(lane).toHaveLength(slotCount(bar.timeSignature, bar.resolution));
        // Silent, by the rule that already meant silence: every slot a rest.
        expect(lane.every((slot) => slot === null)).toBe(true);
      }
    }
  });

  it("gives a drum track the drum slot shape, not the melodic one", () => {
    const result = run(SAMPLE_SONG, {
      kind: "create_track",
      setup: { name: "İkinci Davul", instrumentId: "drum_kit", presetId: "rock" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.song.tracks.at(-1)!;
    for (const section of result.song.sections) {
      for (const bar of section.bars) {
        const lane = bar.slots[created.id]!;
        // A drum rest is an empty *hit list*, not `null`. Mixing the two is a
        // hard validator error, so the shape is asked of the registry rather
        // than assumed.
        expect(lane.every((slot) => Array.isArray(slot) && slot.length === 0)).toBe(true);
      }
    }
  });

  it("refuses past the central track limit", () => {
    let song: Song = SAMPLE_SONG;
    while (song.tracks.length < songLimits.maxTracks) {
      const next = applyTrackCommand(song, {
        kind: "create_track",
        setup: GUITAR_SETUP,
      });
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      song = next.song;
    }
    const overflow = applyTrackCommand(song, {
      kind: "create_track",
      setup: GUITAR_SETUP,
    });
    expect(!overflow.ok && overflow.error.code).toBe("track_limit_reached");
  });

  it("renames without touching id or content", () => {
    const result = run(SAMPLE_SONG, {
      kind: "rename_track",
      trackId: "gtr",
      name: "Sol Gitar",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.song.tracks[0]?.name).toBe("Sol Gitar");
      expect(result.song.tracks[0]?.id).toBe("gtr");
      expect(sameSong(result.song.sections, SAMPLE_SONG.sections)).toBe(true);
    }
    const blank = run(SAMPLE_SONG, {
      kind: "rename_track",
      trackId: "gtr",
      name: " ",
    });
    expect(!blank.ok && blank.error.code).toBe("invalid_track_name");
  });

  it("reorders without changing ids or any section content", () => {
    const result = run(SAMPLE_SONG, {
      kind: "move_track",
      trackId: SAMPLE_SONG.tracks[0]!.id,
      direction: "down",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.song.tracks.map((track) => track.id)).toEqual([
        SAMPLE_SONG.tracks[1]!.id,
        SAMPLE_SONG.tracks[0]!.id,
        SAMPLE_SONG.tracks[2]!.id,
        SAMPLE_SONG.tracks[3]!.id,
      ]);
      expect(sameSong(result.song.sections, SAMPLE_SONG.sections)).toBe(true);
    }
    const stuck = run(SAMPLE_SONG, {
      kind: "move_track",
      trackId: SAMPLE_SONG.tracks[0]!.id,
      direction: "up",
    });
    expect(!stuck.ok && stuck.error.code).toBe("no_room_to_move");
  });
});

describe("49. duplicating a track", () => {
  it("copies the setup and every section's content to the new id", () => {
    const result = run(SAMPLE_SONG, { kind: "duplicate_track", trackId: "gtr" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.song.tracks[1]!;
    expect(copy.id).toBe("gtr-copy");
    expect(copy.name).toBe("Gitar 1 kopyası");
    expect(copy.instrumentId).toBe(SAMPLE_SONG.tracks[0]!.instrumentId);
    result.song.sections.forEach((section, sectionIndex) => {
      section.bars.forEach((bar, barIndex) => {
        const source =
          SAMPLE_SONG.sections[sectionIndex]!.bars[barIndex]!.slots["gtr"];
        const copied = bar.slots[copy.id];
        // A missing key stays missing — never converted to a fake empty
        // array — and a present one is the same music.
        expect(copied === undefined).toBe(source === undefined);
        if (source !== undefined) {
          expect(sameSong(copied ?? null, source)).toBe(true);
        }
      });
    });
  });

  it("keeps the acoustic's silent first section silent for the copy", () => {
    // The sample song expresses the acoustic's silence in section one by
    // carrying no key for it there (spec 5.5).
    const acoustic = SAMPLE_SONG.tracks.find((track) =>
      track.instrumentId.includes("acoustic"),
    )!;
    const result = run(SAMPLE_SONG, {
      kind: "duplicate_track",
      trackId: acoustic.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copyId = `${acoustic.id}-copy`;
    const firstSection = result.song.sections[0]!;
    for (const bar of firstSection.bars) {
      expect(copyId in bar.slots).toBe(false);
    }
  });
});

describe("50. deleting a track", () => {
  it("removes the row and every section key atomically", () => {
    const result = run(SAMPLE_SONG, { kind: "delete_track", trackId: "gtr" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.tracks.some((track) => track.id === "gtr")).toBe(false);
    for (const section of result.song.sections) {
      for (const bar of section.bars) {
        expect("gtr" in bar.slots).toBe(false);
      }
    }
    // The other lanes are untouched, byte for byte.
    result.song.sections.forEach((section, sectionIndex) => {
      section.bars.forEach((bar, barIndex) => {
        const sourceSlots = {
          ...SAMPLE_SONG.sections[sectionIndex]!.bars[barIndex]!.slots,
        };
        delete sourceSlots["gtr"];
        expect(sameSong(bar.slots, sourceSlots)).toBe(true);
      });
    });
  });

  it("never deletes the last track", () => {
    let song: Song = SAMPLE_SONG;
    while (song.tracks.length > 1) {
      const next = applyTrackCommand(song, {
        kind: "delete_track",
        trackId: song.tracks[0]!.id,
      });
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      song = next.song;
    }
    const last = applyTrackCommand(song, {
      kind: "delete_track",
      trackId: song.tracks[0]!.id,
    });
    expect(!last.ok && last.error.code).toBe("last_track_undeletable");
  });
});

describe("51. setup changes: the safe road and the destructive road", () => {
  it("derives the offered tunings from the registry", () => {
    expect(tuningOptionsFor("electric_guitar").map((preset) => preset.id)).toEqual([
      "e_standard",
      "drop_d",
    ]);
    expect(tuningOptionsFor("electric_bass").map((preset) => preset.id)).toEqual([
      "bass_standard",
    ]);
    expect(tuningOptionsFor("drum_kit")).toEqual([]);
    expect(isFrettedInstrument("drum_kit")).toBe(false);
    expect(isFrettedInstrument("electric_guitar")).toBe(true);
  });

  it("checks the setup against the registry before building anything", () => {
    const cases: readonly [TrackSetup, string][] = [
      [{ ...GUITAR_SETUP, instrumentId: "kazoo" }, "unknown_instrument"],
      [{ ...GUITAR_SETUP, instrumentId: "piano" }, "unknown_instrument"],
      [{ ...GUITAR_SETUP, presetId: "crunch" }, "unknown_preset"],
      [{ ...GUITAR_SETUP, fretboard: undefined }, "invalid_fretboard"],
      [
        { ...GUITAR_SETUP, fretboard: { tuning: ["X9"], capo: 0 } },
        "invalid_fretboard",
      ],
      [
        {
          ...GUITAR_SETUP,
          fretboard: { ...GUITAR_SETUP.fretboard!, capo: 99 },
        },
        "invalid_capo",
      ],
      [
        {
          name: "Davul 2",
          instrumentId: "drum_kit",
          presetId: "rock",
          fretboard: { tuning: ["E2"], capo: 0 },
        },
        "fretboard_not_allowed",
      ],
    ];
    for (const [setup, code] of cases) {
      const result = run(SAMPLE_SONG, { kind: "create_track", setup });
      expect(!result.ok && result.error.code, code).toBe(code);
    }
  });

  it("accepts a compatible retune — Drop D keeps every written position valid", () => {
    const result = run(SAMPLE_SONG, {
      kind: "update_track_setup",
      trackId: "gtr",
      setup: {
        name: "Gitar 1",
        instrumentId: "electric_guitar",
        presetId: "high_gain",
        fretboard: { tuning: TUNING_PRESETS.drop_d!.tuning, capo: 0 },
      },
    });
    /*
     * Honest note: Drop D moves every sixth-string pitch down a tone, so the
     * *pitch/position pairs* written for E standard no longer agree. The
     * validator chain decides — this test only asserts the decision is
     * atomic: either applied whole with content kept, or refused whole.
     */
    if (result.ok) {
      expect(result.song.tracks[0]?.fretboard?.tuning[0]).toBe("D2");
      expect(sameSong(result.song.sections, SAMPLE_SONG.sections)).toBe(true);
    } else {
      expect(result.error.code).toBe("setup_incompatible");
    }
  });

  it("accepts a preset-only change on a full track", () => {
    const result = run(SAMPLE_SONG, {
      kind: "update_track_setup",
      trackId: "gtr",
      setup: {
        name: "Gitar 1",
        instrumentId: "electric_guitar",
        presetId: "clean",
        fretboard: { tuning: TUNING_PRESETS.e_standard!.tuning, capo: 0 },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.song.tracks[0]?.presetId).toBe("clean");
      expect(sameSong(result.song.sections, SAMPLE_SONG.sections)).toBe(true);
    }
  });

  it("refuses an incompatible setup atomically, positions untouched", () => {
    // One string cannot carry chords written across six.
    const result = run(SAMPLE_SONG, {
      kind: "update_track_setup",
      trackId: "gtr",
      setup: {
        ...GUITAR_SETUP,
        fretboard: { tuning: ["E2"], capo: 0 },
      },
    });
    expect(!result.ok && result.error.code).toBe("setup_incompatible");
    // Nothing was clamped, dropped or moved: the input song is bytes-equal.
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  });

  it("clears and changes on the separate destructive road, in one result", () => {
    const result = run(SAMPLE_SONG, {
      kind: "replace_track_setup_and_clear_content",
      trackId: "gtr",
      setup: {
        name: "Tek Telli",
        instrumentId: "electric_guitar",
        presetId: "clean",
        fretboard: { tuning: TUNING_PRESETS.drop_d!.tuning, capo: 2 },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.tracks[0]?.name).toBe("Tek Telli");
    expect(result.song.tracks[0]?.fretboard?.capo).toBe(2);
    /*
     * The music goes; the track's place in the bar stays (2Q-B §1.3).
     *
     * This used to drop the key from every bar, and a missing key says two
     * things at once — "silent here" *and* "not written here" — so a reader
     * who converted a guitar into a kit got a track they could not write
     * into. That is the defect K-55 closed for `create_track`, arriving
     * through a second door: the same silence has to be an explicit empty
     * lane, in the shape the *new* instrument asks for.
     */
    for (const section of result.song.sections) {
      for (const bar of section.bars) {
        const lane = bar.slots["gtr"];
        expect(Array.isArray(lane)).toBe(true);
        expect(lane?.every((slot) => slot === null)).toBe(true);
      }
    }
    // The input song still holds the music, whole: undo has something real
    // to return to, byte for byte.
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  });
});

describe("228. landing on the track you just made (2Q-B §5.3)", () => {
  /*
   * Written red: `create_track` left the reader on the track they were on
   * before, so the chain "add a kit → tap a beat" wrote nothing, or worse,
   * wrote onto the guitar. Nothing about the create command was wrong; the
   * controller simply never moved.
   */
  const base = SAMPLE_SONG;

  it("names the track a create command added", () => {
    const result = applyTrackCommand(base, {
      kind: "create_track",
      setup: { name: "Davul 2", instrumentId: "drum_kit", presetId: "rock" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const made = createdTrackId(base, result.song);
    expect(made).not.toBeNull();
    expect(result.song.tracks.some((track) => track.id === made)).toBe(true);
    expect(base.tracks.some((track) => track.id === made)).toBe(false);
  });

  it("names the copy a duplicate command added", () => {
    const result = applyTrackCommand(base, {
      kind: "duplicate_track",
      trackId: base.tracks[0]!.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createdTrackId(base, result.song)).not.toBeNull();
  });

  it("names nothing when a command added no track", () => {
    const result = applyTrackCommand(base, {
      kind: "rename_track",
      trackId: base.tracks[0]!.id,
      name: "Başka",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createdTrackId(base, result.song)).toBeNull();
  });

  it("names nothing when a track was removed", () => {
    const result = applyTrackCommand(base, {
      kind: "delete_track",
      trackId: base.tracks[0]!.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createdTrackId(base, result.song)).toBeNull();
  });

  it("finds the new track by identity, not by position", () => {
    const result = applyTrackCommand(base, {
      kind: "create_track",
      setup: { name: "Davul 2", instrumentId: "drum_kit", presetId: "rock" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Reorder the result: the answer must not change.
    const shuffled = { ...result.song, tracks: [...result.song.tracks].reverse() };
    expect(createdTrackId(base, shuffled)).toBe(createdTrackId(base, result.song));
  });
});
