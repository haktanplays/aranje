/**
 * The pure mixer (spec 13.18, 2L-C §3, §4, §5, §14).
 */
import { describe, expect, it } from "vitest";

import { worstCasePlayableSong } from "../../../eval/shared/worst-case-song";
import { mixerLimits } from "@/lib/limits";
import { sameSong } from "@/lib/song/edit-history";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  EMPTY_AUDITION,
  applyMixCommand,
  audibleTrackIds,
  clearTrackAudition,
  effectiveTrackGain,
  isMixOnlyChange,
  pruneAudition,
  readTrackMixes,
  setTrackMuted,
  setTrackSoloed,
  trackPan,
  type TrackAudition,
} from "@/lib/song/track-mix";
import type { Song } from "@/lib/song/schema";

const frozen = JSON.stringify(SAMPLE_SONG);
const ids = SAMPLE_SONG.tracks.map((track) => track.id);

const update = (song: Song, mixes: Record<string, { volumeDb: number; pan: number }>) =>
  applyMixCommand(song, { kind: "update_track_mix", mixes });

const trackById = (song: Song, id: string) =>
  song.tracks.find((track) => track.id === id)!;

describe("56. the persisted mix command", () => {
  it("moves one track's volume and nothing else", () => {
    const result = update(SAMPLE_SONG, { gtr: { volumeDb: -12, pan: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trackById(result.song, "gtr").volumeDb).toBe(-12);
    expect(sameSong(result.song.sections, SAMPLE_SONG.sections)).toBe(true);
    for (const id of ids.filter((entry) => entry !== "gtr")) {
      expect(sameSong(trackById(result.song, id), trackById(SAMPLE_SONG, id))).toBe(
        true,
      );
    }
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozen);
  });

  it("moves one track's stereo position", () => {
    const result = update(SAMPLE_SONG, {
      gtr: { volumeDb: trackById(SAMPLE_SONG, "gtr").volumeDb, pan: -0.5 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(trackById(result.song, "gtr").pan).toBe(-0.5);
  });

  it("writes centre as an absent field, but only when the pan moved", () => {
    const panned = update(SAMPLE_SONG, {
      gtr: { volumeDb: -6, pan: 0.4 },
    });
    if (!panned.ok) throw new Error("pan refused");
    expect(trackById(panned.song, "gtr").pan).toBe(0.4);

    const centred = update(panned.song, { gtr: { volumeDb: -6, pan: 0 } });
    if (!centred.ok) throw new Error("centre refused");
    expect("pan" in trackById(centred.song, "gtr")).toBe(false);

    // A track already at centre with no field keeps having no field.
    const untouched = update(SAMPLE_SONG, {
      bass: { volumeDb: trackById(SAMPLE_SONG, "bass").volumeDb, pan: 0 },
    });
    if (!untouched.ok) throw new Error("no-op refused");
    expect(sameSong(untouched.song, SAMPLE_SONG)).toBe(true);
  });

  it("moves several tracks in one apply", () => {
    const result = update(SAMPLE_SONG, {
      gtr: { volumeDb: -3, pan: -0.6 },
      bass: { volumeDb: -9, pan: 0 },
      drums: { volumeDb: 0, pan: 0.2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trackById(result.song, "gtr").volumeDb).toBe(-3);
    expect(trackById(result.song, "bass").volumeDb).toBe(-9);
    expect(trackById(result.song, "drums").pan).toBe(0.2);
    // The one track nobody touched is the very same object.
    expect(trackById(result.song, "acc").volumeDb).toBe(
      trackById(SAMPLE_SONG, "acc").volumeDb,
    );
  });

  it("accepts both ends of the central limits", () => {
    for (const volumeDb of [mixerLimits.volumeDb.min, mixerLimits.volumeDb.max]) {
      for (const pan of [mixerLimits.pan.min, mixerLimits.pan.max]) {
        const result = update(SAMPLE_SONG, { gtr: { volumeDb, pan } });
        expect(result.ok, `${volumeDb}/${pan}`).toBe(true);
      }
    }
  });

  it("refuses out of range instead of clamping", () => {
    const loud = update(SAMPLE_SONG, {
      gtr: { volumeDb: mixerLimits.volumeDb.max + 0.5, pan: 0 },
    });
    expect(!loud.ok && loud.error.code).toBe("volume_out_of_range");

    const quiet = update(SAMPLE_SONG, {
      gtr: { volumeDb: mixerLimits.volumeDb.min - 0.5, pan: 0 },
    });
    expect(!quiet.ok && quiet.error.code).toBe("volume_out_of_range");

    const wide = update(SAMPLE_SONG, { gtr: { volumeDb: -6, pan: 1.2 } });
    expect(!wide.ok && wide.error.code).toBe("pan_out_of_range");

    const nonsense = update(SAMPLE_SONG, {
      gtr: { volumeDb: Number.NaN, pan: 0 },
    });
    expect(!nonsense.ok && nonsense.error.code).toBe("volume_out_of_range");

    // Refused whole: nothing was written, not even the valid track beside it.
    const partial = update(SAMPLE_SONG, {
      bass: { volumeDb: -10, pan: 0 },
      gtr: { volumeDb: 99, pan: 0 },
    });
    expect(partial.ok).toBe(false);
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozen);
  });

  it("refuses a track the song does not have", () => {
    const result = update(SAMPLE_SONG, { yok: { volumeDb: 0, pan: 0 } });
    expect(!result.ok && result.error.code).toBe("track_not_found");
  });

  it("mixes the drum lane like any other track", () => {
    const result = update(SAMPLE_SONG, { drums: { volumeDb: -18, pan: -0.3 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(trackById(result.song, "drums").volumeDb).toBe(-18);
      expect(trackById(result.song, "drums").pan).toBe(-0.3);
    }
  });

  it("is a no-op when handed back what it read", () => {
    const result = applyMixCommand(SAMPLE_SONG, {
      kind: "update_track_mix",
      mixes: readTrackMixes(SAMPLE_SONG),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(sameSong(result.song, SAMPLE_SONG)).toBe(true);
  });

  it("resets to the values the mixer opened with", () => {
    const opened = readTrackMixes(SAMPLE_SONG);
    const moved = update(SAMPLE_SONG, { gtr: { volumeDb: -20, pan: 0.9 } });
    if (!moved.ok) throw new Error("move refused");
    const back = applyMixCommand(moved.song, {
      kind: "reset_track_mix_to_opened_value",
      opened,
    });
    expect(back.ok).toBe(true);
    if (back.ok) expect(sameSong(back.song, SAMPLE_SONG)).toBe(true);
  });

  it("carries warnings through without blocking", () => {
    const warned = worstCasePlayableSong();
    const first = warned.tracks[0]!;
    const result = update(warned, { [first.id]: { volumeDb: -2, pan: 0.1 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.song.tracks[0]?.volumeDb).toBe(-2);
    }
  });

  it("cannot launder a song the validators refuse", () => {
    const broken: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, instrumentId: "kazoo" } : track,
      ),
    };
    const result = update(broken, { gtr: { volumeDb: -6, pan: 0 } });
    expect(!result.ok && result.error.code).toBe("mix_validation_failed");
  });

  it("gives the same bytes five runs in a row", () => {
    const runs = Array.from({ length: 5 }, () => {
      const result = update(SAMPLE_SONG, {
        gtr: { volumeDb: -7.5, pan: -0.35 },
        drums: { volumeDb: 1.5, pan: 0.15 },
      });
      return result.ok ? JSON.stringify(result.song) : "refused";
    });
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).not.toBe("refused");
  });

  it("reads a level as a gain, with audibility left out of it", () => {
    expect(effectiveTrackGain({ ...SAMPLE_SONG.tracks[0]!, volumeDb: 0 })).toBe(1);
    expect(
      effectiveTrackGain({ ...SAMPLE_SONG.tracks[0]!, volumeDb: -6 }),
    ).toBeCloseTo(0.5012, 4);
    expect(
      effectiveTrackGain({ ...SAMPLE_SONG.tracks[0]!, volumeDb: -12 }),
    ).toBeCloseTo(0.2512, 4);
    // Never minus infinity, whatever the audition says.
    expect(Number.isFinite(effectiveTrackGain(SAMPLE_SONG.tracks[0]!))).toBe(true);
  });

  it("reads an absent pan as the centre", () => {
    expect(trackPan(SAMPLE_SONG.tracks[0]!)).toBe(mixerLimits.pan.center);
  });
});

describe("57. who is heard", () => {
  const mute = (state: TrackAudition, id: string) => setTrackMuted(state, id, true);
  const solo = (state: TrackAudition, id: string) => setTrackSoloed(state, id, true);

  it("hears everything when nothing is muted or soloed", () => {
    expect(audibleTrackIds(SAMPLE_SONG, EMPTY_AUDITION)).toEqual(ids);
  });

  it("drops one muted track", () => {
    const state = mute(EMPTY_AUDITION, "gtr");
    expect(audibleTrackIds(SAMPLE_SONG, state)).toEqual(
      ids.filter((id) => id !== "gtr"),
    );
  });

  it("drops several muted tracks", () => {
    const state = mute(mute(EMPTY_AUDITION, "gtr"), "bass");
    expect(audibleTrackIds(SAMPLE_SONG, state)).toEqual(
      ids.filter((id) => id !== "gtr" && id !== "bass"),
    );
  });

  it("narrows to one soloed track", () => {
    const state = solo(EMPTY_AUDITION, "bass");
    expect(audibleTrackIds(SAMPLE_SONG, state)).toEqual(["bass"]);
  });

  it("narrows to several soloed tracks, in song order", () => {
    const state = solo(solo(EMPTY_AUDITION, "drums"), "gtr");
    expect(audibleTrackIds(SAMPLE_SONG, state)).toEqual(["gtr", "drums"]);
  });

  it("lets mute beat solo", () => {
    const state = mute(solo(solo(EMPTY_AUDITION, "gtr"), "bass"), "gtr");
    expect(audibleTrackIds(SAMPLE_SONG, state)).toEqual(["bass"]);
  });

  it("treats every track muted as a valid silence", () => {
    const state = ids.reduce(mute, EMPTY_AUDITION);
    expect(audibleTrackIds(SAMPLE_SONG, state)).toEqual([]);
  });

  it("forgets a track the song no longer has", () => {
    const state = solo(mute(EMPTY_AUDITION, "gtr"), "bass");
    const smaller: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((track) => track.id !== "gtr"),
      sections: SAMPLE_SONG.sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar) => {
          const slots = { ...bar.slots };
          delete slots["gtr"];
          return { ...bar, slots };
        }),
      })),
    };
    const pruned = pruneAudition(smaller, state);
    expect([...pruned.muted]).toEqual([]);
    expect([...pruned.soloed]).toEqual(["bass"]);
    expect(audibleTrackIds(smaller, state)).toEqual(["bass"]);
  });

  it("keeps the state when nothing needed pruning", () => {
    const state = mute(EMPTY_AUDITION, "gtr");
    expect(pruneAudition(SAMPLE_SONG, state)).toBe(state);
  });

  it("never names the metronome, whatever is muted or soloed", () => {
    // The metronome is not a track, so it cannot appear in the audible list
    // and no combination of audition state can silence it.
    const states = [
      EMPTY_AUDITION,
      mute(EMPTY_AUDITION, "gtr"),
      ids.reduce(mute, EMPTY_AUDITION),
      solo(EMPTY_AUDITION, "drums"),
    ];
    for (const state of states) {
      for (const id of audibleTrackIds(SAMPLE_SONG, state)) {
        expect(ids).toContain(id);
      }
    }
  });

  it("clears back to everything audible", () => {
    expect(clearTrackAudition()).toEqual(EMPTY_AUDITION);
    expect(audibleTrackIds(SAMPLE_SONG, clearTrackAudition())).toEqual(ids);
  });
});

describe("58. telling a mix change from every other change", () => {
  const moved = (() => {
    const result = update(SAMPLE_SONG, { gtr: { volumeDb: -9, pan: 0.25 } });
    if (!result.ok) throw new Error("refused");
    return result.song;
  })();

  it("says yes to a level and a position", () => {
    expect(isMixOnlyChange(SAMPLE_SONG, moved)).toBe(true);
  });

  it("says no when the song is the same object or the same music", () => {
    expect(isMixOnlyChange(SAMPLE_SONG, SAMPLE_SONG)).toBe(false);
    expect(isMixOnlyChange(SAMPLE_SONG, { ...SAMPLE_SONG })).toBe(false);
  });

  it("says no to anything that is not a level", () => {
    const renamed: Song = {
      ...moved,
      tracks: moved.tracks.map((track, index) =>
        index === 0 ? { ...track, name: "Başka" } : track,
      ),
    };
    expect(isMixOnlyChange(SAMPLE_SONG, renamed)).toBe(false);

    const retitled: Song = { ...moved, title: "Başka Şarkı" };
    expect(isMixOnlyChange(SAMPLE_SONG, retitled)).toBe(false);

    const retempoed: Song = { ...moved, bpm: SAMPLE_SONG.bpm + 4 };
    expect(isMixOnlyChange(SAMPLE_SONG, retempoed)).toBe(false);

    const fewerTracks: Song = { ...moved, tracks: moved.tracks.slice(1) };
    expect(isMixOnlyChange(SAMPLE_SONG, fewerTracks)).toBe(false);

    const editedBar: Song = {
      ...moved,
      sections: moved.sections.map((section, index) =>
        index === 0
          ? { ...section, bars: section.bars.slice(0, -1) }
          : section,
      ),
    };
    expect(isMixOnlyChange(SAMPLE_SONG, editedBar)).toBe(false);
  });
});
