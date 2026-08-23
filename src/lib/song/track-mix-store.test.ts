/**
 * The mixer against the real gate and the real boundaries
 * (spec 13.18, 2L-C §10, §11, §13, §14).
 *
 * The pure command is proven next door. What is proven here is what the
 * *session* does with it: one apply is one write and one undo step, a refused
 * or unchanged apply is neither, and the two kinds of mixer state end up on
 * the two sides of the line they were designed to sit on — levels in the
 * song, the file and the fingerprint; mute and solo nowhere near any of them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { surfaceDigest } from "@/lib/copilot/scope";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { sameSong } from "@/lib/song/edit-history";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { createSongStore } from "@/lib/song/song-store";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import { decideLoad } from "@/lib/song/storage-envelope";
import { applyMixCommand, readTrackMixes } from "@/lib/song/track-mix";
import type { Song } from "@/lib/song/schema";

function countingStorage(): StorageLike & {
  map: Map<string, string>;
  writes: () => number;
} {
  const map = new Map<string, string>();
  let count = 0;
  return {
    map,
    writes: () => count,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      count += 1;
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const storedSong = (storage: { map: Map<string, string> }) => {
  const decision = decideLoad(storage.map.get(SONG_KEY) ?? null);
  return "song" in decision ? decision.song : null;
};

const freshStore = (canPersist = true) => {
  const storage = countingStorage();
  const store = createSongStore(
    { song: SAMPLE_SONG, outcome: "stored", canPersist },
    storage,
  );
  return { storage, store };
};

const mixed = (song: Song, mixes: Record<string, { volumeDb: number; pan: number }>) => {
  const result = applyMixCommand(song, { kind: "update_track_mix", mixes });
  if (!result.ok) throw new Error(`mix refused: ${result.error.code}`);
  return result.song;
};

describe("61. one apply, one write, one step", () => {
  it("commits several tracks as a single history step", () => {
    const { storage, store } = freshStore();
    const next = mixed(store.getSnapshot().song, {
      gtr: { volumeDb: -12, pan: -0.4 },
      bass: { volumeDb: -4, pan: 0 },
      drums: { volumeDb: 1.5, pan: 0.3 },
    });

    const before = storage.writes();
    expect(store.commit(next, { kind: "track_mix_update" })).toBe(true);
    expect(storage.writes()).toBe(before + 1);
    expect(store.getSnapshot().undoLabel).toBe("Geri al: Track miksini değiştirme");

    const written = storedSong(storage)!;
    expect(written.tracks[0]?.volumeDb).toBe(-12);
    expect(written.tracks[0]?.pan).toBe(-0.4);
    expect(written.tracks[2]?.volumeDb).toBe(-4);
  });

  it("undoes and redoes the whole mix byte for byte", () => {
    const { storage, store } = freshStore();
    // A written baseline, so both comparisons read the same writer.
    store.commit(mixed(store.getSnapshot().song, { gtr: { volumeDb: -5, pan: 0 } }), {
      kind: "track_mix_update",
    });
    const before = JSON.stringify(storedSong(storage));

    store.commit(
      mixed(store.getSnapshot().song, {
        gtr: { volumeDb: -18, pan: 0.8 },
        acc: { volumeDb: -2, pan: -0.6 },
      }),
      { kind: "track_mix_update" },
    );
    const after = JSON.stringify(storedSong(storage));
    expect(after).not.toBe(before);

    store.undo();
    expect(JSON.stringify(storedSong(storage))).toBe(before);
    store.redo();
    expect(JSON.stringify(storedSong(storage))).toBe(after);
  });

  it("writes nothing when the draft is the music that is already there", () => {
    const { storage, store } = freshStore();
    const unchanged = mixed(
      store.getSnapshot().song,
      readTrackMixes(store.getSnapshot().song) as Record<
        string,
        { volumeDb: number; pan: number }
      >,
    );
    const before = storage.writes();
    expect(store.commit(unchanged, { kind: "track_mix_update" })).toBe(false);
    expect(storage.writes()).toBe(before);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("cannot persist means cannot commit, and the song stands still", () => {
    const { storage, store } = freshStore(false);
    const next = mixed(store.getSnapshot().song, { gtr: { volumeDb: -20, pan: 0 } });
    expect(store.commit(next, { kind: "track_mix_update" })).toBe(false);
    expect(storage.writes()).toBe(0);
    expect(sameSong(store.getSnapshot().song, SAMPLE_SONG)).toBe(true);
  });

  it("leaves nothing behind when the command itself refuses", () => {
    const { storage, store } = freshStore();
    const refused = applyMixCommand(store.getSnapshot().song, {
      kind: "update_track_mix",
      mixes: { gtr: { volumeDb: 99, pan: 0 } },
    });
    expect(refused.ok).toBe(false);
    expect(storage.writes()).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});

describe("62. levels travel, the audition does not", () => {
  const panned = mixed(SAMPLE_SONG, {
    gtr: { volumeDb: -13.5, pan: -0.45 },
    drums: { volumeDb: 3, pan: 0.2 },
  });

  it("moves the Copilot fingerprint, because it is project data", () => {
    expect(surfaceDigest(SAMPLE_SONG).tracks).not.toBe(
      surfaceDigest(panned).tracks,
    );
  });

  it("survives a project file round trip", () => {
    const exported = exportProject(panned);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const parsed = parseProjectText(exported.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.song.tracks[0]?.volumeDb).toBe(-13.5);
    expect(parsed.song.tracks[0]?.pan).toBe(-0.45);
    expect(sameSong(parsed.song, panned)).toBe(true);

    // Nothing about how someone was listening is in the file.
    expect(exported.text).not.toContain("muted");
    expect(exported.text).not.toContain("soloed");
    expect(exported.text).not.toContain("audition");
  });

  it("has no place in the Song Contract for mute or solo", () => {
    /*
     * The contract carries optional `muted`/`soloed` flags from phase 0 that
     * nothing writes. 2L-C deliberately did not start writing them: the
     * mixer's audition is session state, and a field in the song is a field
     * that would end up in a file and in a fingerprint.
     */
    for (const track of panned.tracks) {
      expect(track.muted).toBeUndefined();
      expect(track.soloed).toBeUndefined();
    }

    /*
     * And it does not manage the legacy fields either way: a song that
     * arrives carrying them keeps them exactly as they were, because the
     * mixer's audition is a different thing that happens to share a word.
     */
    const legacy: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, muted: true, soloed: false } : track,
      ),
    };
    const after = mixed(legacy, { gtr: { volumeDb: -8, pan: 0.1 } });
    expect(after.tracks[0]?.muted).toBe(true);
    expect(after.tracks[0]?.soloed).toBe(false);
  });

  it("keeps the session controller off the store and the engine", () => {
    const controller = readFileSync("src/lib/workspace/use-mixer.ts", "utf8");
    for (const forbidden of [
      "@/lib/audio/engine",
      "@/lib/audio/playback",
      "@/lib/song/storage",
      "@/lib/song/song-store",
    ]) {
      expect(controller, forbidden).not.toContain(forbidden);
    }
  });
});
