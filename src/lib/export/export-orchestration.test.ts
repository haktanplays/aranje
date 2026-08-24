/**
 * What an export must leave exactly as it found it (spec 13.19, 2M-A §6, §13, §16).
 *
 * The render is driven with an injected offline renderer, so these tests
 * exercise the real `createEngine`/`scheduleSong` path and the real audibility
 * call without needing a browser audio context. What is asserted is the part
 * that would be expensive to discover later: an export reads, and a session
 * that exported is indistinguishable from one that did not.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { buildTempoMap } from "@/lib/audio/tempo";
import { levelNotice } from "@/lib/export/export-messages";
import { audioExportLimits } from "@/lib/limits";
import { surfaceDigest } from "@/lib/copilot/scope";
import { createSongStore } from "@/lib/song/song-store";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { audibleTrackIds, EMPTY_AUDITION, setTrackMuted } from "@/lib/song/track-mix";
import type { Song } from "@/lib/song/schema";
import { renderSongToBuffer } from "@/lib/export/render-wav";
import { renderDuration } from "@/lib/export/export-plan";

/* --------------------------------------------------------------- harness */

type FakeChannel = { volume: { value: number }; pan: { value: number }; mute: boolean };

function countingStorage(): StorageLike & { writes: () => number } {
  const map = new Map<string, string>();
  let count = 0;
  return {
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

/**
 * An offline renderer that runs the build callback against a fake context.
 *
 * The callback is the real one from `render-wav`, so `createEngine`,
 * `scheduleSong` and `setTrackAudibility` all really run — only the audio
 * hardware is missing.
 */
function fakeOffline(record: {
  contexts: number;
  channels: Map<string, FakeChannel>;
  disposed: boolean;
  scheduled: number;
  metronomeAsked: number;
}) {
  return async (
    build: (context: never) => Promise<void> | void,
    seconds: number,
    channels: number,
    sampleRate: number,
  ) => {
    record.contexts += 1;
    const transport = {
      ticks: 0,
      seconds: 0,
      PPQ: 192,
      bpm: { value: 0, setValueAtTime() {}, cancelScheduledValues() {} },
      loop: false,
      loopStart: "0i",
      loopEnd: "0i",
      schedule: () => {
        record.scheduled += 1;
        return record.scheduled;
      },
      on() {},
      start() {},
      pause() {},
      stop() {},
      cancel() {},
    };
    const context = { transport, destination: {}, dispose() {} };
    await build(context as never);

    const frames = Math.ceil(seconds * sampleRate);
    const planar = Array.from(
      { length: channels },
      () => new Float32Array(frames),
    );
    return {
      numberOfChannels: channels,
      length: frames,
      sampleRate,
      toArray: () => planar,
    };
  };
}

/**
 * `createEngine` is stubbed at the module boundary so the graph is countable.
 *
 * The point of these tests is orchestration — what the export touches — not
 * whether Tone builds a sampler, which the offline render measurements cover.
 */
vi.mock("@/lib/audio/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio/engine")>();
  return {
    ...actual,
    createEngine: vi.fn(async (song: Song) => {
      const voices = new Map<string, { trackId: string; channel: FakeChannel }>();
      for (const track of song.tracks) {
        voices.set(track.id, {
          trackId: track.id,
          channel: {
            volume: { value: track.volumeDb },
            pan: { value: track.pan ?? 0 },
            mute: false,
          },
        });
      }
      return {
        context: { dispose() {} },
        master: {},
        metronome: {},
        voices,
        meters: new Map(),
        plan: { events: [], bars: [], totalTicks: 0 },
        expression: { stopAll() {}, counts: { active: 0 }, fetchedUrls: 0 },
        expectedBuffers: song.tracks.length,
        loadedBuffers: song.tracks.length,
        dispose() {},
      } as never;
    }),
    scheduleSong: vi.fn(),
  };
});

const fresh = () => ({
  contexts: 0,
  channels: new Map<string, FakeChannel>(),
  disposed: false,
  scheduled: 0,
  metronomeAsked: 0,
});

describe("74. an export reads and never writes", () => {
  it("leaves the song byte-identical", async () => {
    const before = JSON.stringify(SAMPLE_SONG);
    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, { offline: fakeOffline(record) });
    expect(JSON.stringify(SAMPLE_SONG)).toBe(before);
  });

  it("writes nothing to storage and makes no history step", async () => {
    const storage = countingStorage();
    const store = createSongStore(
      { song: SAMPLE_SONG, outcome: "stored", canPersist: true },
      storage,
    );
    const writesBefore = storage.writes();
    const undoBefore = store.getSnapshot().canUndo;

    const record = fresh();
    await renderSongToBuffer(store.getSnapshot().song, {
      offline: fakeOffline(record),
    });

    expect(storage.writes()).toBe(writesBefore);
    expect(store.getSnapshot().canUndo).toBe(undoBefore);
    expect(storage.getItem(SONG_KEY)).toBe(null);
  });

  it("leaves the Copilot fingerprint where it was", async () => {
    const before = surfaceDigest(SAMPLE_SONG);
    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, { offline: fakeOffline(record) });
    expect(surfaceDigest(SAMPLE_SONG)).toEqual(before);
  });

  it("builds its own context and disposes the graph it made", async () => {
    const record = fresh();
    const rendered = await renderSongToBuffer(SAMPLE_SONG, {
      offline: fakeOffline(record),
    });
    // Exactly one offline context, and nothing sounding once it is torn down.
    expect(record.contexts).toBe(1);
    expect(rendered.activeAfterDispose).toBe(0);
  });
});

describe("75. what the rendered file contains", () => {
  it("is stereo at the contract's rate, for the planned duration", async () => {
    const record = fresh();
    const rendered = await renderSongToBuffer(SAMPLE_SONG, {
      offline: fakeOffline(record),
    });

    expect(rendered.channels.length).toBe(audioExportLimits.channels);
    expect(rendered.sampleRate).toBe(audioExportLimits.sampleRate);
    expect(rendered.frames).toBe(
      Math.ceil(renderDuration(SAMPLE_SONG).totalSeconds * audioExportLimits.sampleRate),
    );
    expect(rendered.duration.totalSeconds).toBeGreaterThan(
      rendered.duration.notatedSeconds,
    );
  });

  it("asks the scheduler to keep the metronome out of it", async () => {
    const { scheduleSong } = await import("@/lib/audio/engine");
    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, { offline: fakeOffline(record) });

    const options = vi.mocked(scheduleSong).mock.calls.at(-1)?.[2];
    // A rehearsal click is not part of the record.
    expect(options?.metronomeEnabled?.()).toBe(false);
  });

  it("schedules at the song's own tempo, never a practice rate", async () => {
    /*
     * A file that carried rehearsal speed would be a different piece of music
     * to everyone who opened it. The tempo map handed to the scheduler is
     * inspected directly, because "we did not pass a percent" is not visible
     * from the outside — and it is the one thing standing between a slowed
     * practice session and a slowed export.
     */
    const { scheduleSong } = await import("@/lib/audio/engine");
    vi.mocked(scheduleSong).mockClear();

    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, { offline: fakeOffline(record) });

    const map = vi.mocked(scheduleSong).mock.calls.at(-1)?.[1];
    expect(map?.practicePercent).toBe(100);
    expect(map?.totalSeconds).toBeCloseTo(
      buildTempoMap(SAMPLE_SONG).totalSeconds,
      6,
    );
    for (const segment of map?.segments ?? []) {
      expect(segment.bpm).toBe(segment.writtenBpm);
    }
  });

  it("does not touch audibility at all when every track was asked for", async () => {
    /*
     * "Tüm track'ler" is not "pass the full list": it is *not asking*. If the
     * audition were consulted here, a muted track would silently vanish from
     * a full-mix export.
     */
    const { setTrackAudibility } = await import("@/lib/audio/engine");
    const spy = vi.spyOn(
      await import("@/lib/audio/engine"),
      "setTrackAudibility",
    );
    spy.mockClear();
    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, { offline: fakeOffline(record) });
    expect(spy).not.toHaveBeenCalled();
    expect(typeof setTrackAudibility).toBe("function");
    spy.mockRestore();
  });

  it("applies the audition only when the caller passed one", async () => {
    const spy = vi.spyOn(await import("@/lib/audio/engine"), "setTrackAudibility");
    spy.mockClear();

    const audition = setTrackMuted(EMPTY_AUDITION, SAMPLE_SONG.tracks[0]!.id, true);
    const chosen = audibleTrackIds(SAMPLE_SONG, audition);

    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, {
      offline: fakeOffline(record),
      audibleTrackIds: chosen,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toEqual(chosen);
    expect(chosen).not.toContain(SAMPLE_SONG.tracks[0]!.id);
    spy.mockRestore();
  });

  it("gives an empty audition an empty list rather than falling back to all", async () => {
    const spy = vi.spyOn(await import("@/lib/audio/engine"), "setTrackAudibility");
    spy.mockClear();
    const record = fresh();
    await renderSongToBuffer(SAMPLE_SONG, {
      offline: fakeOffline(record),
      audibleTrackIds: [],
    });
    // Every track muted is a valid silence (13.18 §5), including in a file.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toEqual([]);
    spy.mockRestore();
  });

  it("never consults the phase-0 contract flags", async () => {
    /*
     * A song carrying `muted: true` renders exactly like one that does not
     * (2M-A §0). Asserted through the graph the render actually builds.
     */
    const flagged: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, muted: true, soloed: true } : track,
      ),
    };
    const spy = vi.spyOn(await import("@/lib/audio/engine"), "setTrackAudibility");
    spy.mockClear();
    const record = fresh();
    const rendered = await renderSongToBuffer(flagged, {
      offline: fakeOffline(record),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(rendered.frames).toBe(
      (await renderSongToBuffer(SAMPLE_SONG, { offline: fakeOffline(fresh()) }))
        .frames,
    );
    spy.mockRestore();
  });
});

describe("76. the project backup is not behind the export door (2M-A.1 §5)", () => {
  it("serialises through the one pure serializer, from both entry points", async () => {
    /*
     * The product decision, written down where it can be broken.
     *
     * There are two ways to get a project file: the one-tap "Projeyi yedekle"
     * in the info sheet, and the export surface. That is deliberate, not an
     * oversight — a safety backup should stay one tap away and must never end
     * up behind an entitlement check, whereas WAV and MIDI go through the one
     * export controller precisely so such a check has somewhere to live.
     *
     * What both paths must share is the *serializer*: one `exportProject`,
     * one file format, byte for byte. A second serializer is the thing this
     * test exists to prevent.
     */
    const project = await import("@/lib/project/project-file");
    const surface = Object.keys(project).sort();
    expect(surface).toContain("exportProject");
    // Exactly one function in the codebase turns a Song into a project file.
    expect(surface.filter((name) => /^export|^serialize/.test(name))).toEqual([
      "exportProject",
      "serializeProjectFile",
    ]);

    const first = project.exportProject(SAMPLE_SONG);
    const second = project.exportProject(SAMPLE_SONG);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.text).toBe(second.text);
  });

  it("keeps both callers on it, and neither on a serializer of its own", () => {
    const controller = readFileSync("src/lib/workspace/use-export.ts", "utf8");
    const backup = readFileSync("src/lib/project/use-project-file.ts", "utf8");

    for (const [name, source] of [
      ["use-export", controller],
      ["use-project-file", backup],
    ] as const) {
      expect(source, name).toContain("exportProject");
      // No hand-rolled JSON of a Song anywhere near either path.
      expect(source, name).not.toContain("JSON.stringify(song)");
      expect(source, name).not.toContain("aranje.project");
    }
  });

  it("does not gate the backup on anything the audio formats are gated on", () => {
    /*
     * `canPersist:false` closes editing, not exporting — and in particular
     * not the backup, which is exactly what someone in that state needs. The
     * export controller has no entitlement concept at all today; if one
     * arrives, this test is where the decision that the backup stays outside
     * it is recorded.
     */
    /*
     * `downloadProject` is where the bytes are made since 2O-A — the library
     * backs up projects that are not open, and `downloadBackup` is now a
     * one-line caller of it. The rule is unchanged and reads the function that
     * actually does the work.
     */
    const backup = readFileSync("src/lib/project/use-project-file.ts", "utf8");
    const inDownload = backup.slice(
      backup.indexOf("const downloadProject"),
      backup.indexOf("const openFile"),
    );
    expect(inDownload).toContain("exportProject");
    expect(inDownload).not.toContain("canPersist");
    expect(inDownload).not.toContain("entitle");
    expect(inDownload).not.toContain("quota");
  });
});

describe("178. what the reader is told about a file's level (2O-B.1 §4)", () => {
  it("says nothing when nothing was clamped", () => {
    expect(levelNotice(0)).toBeNull();
    expect(levelNotice(-1)).toBeNull();
  });

  it("names the cause and the fix, and no numbers", () => {
    const notice = levelNotice(788);
    expect(notice).not.toBeNull();
    expect(notice).toContain("Karıştırıcıdan");
    for (const leak of ["788", "dBFS", "clip", "clamp", "sample", "PCM"]) {
      expect(notice, `notice leaks ${leak}`).not.toContain(leak);
    }
  });

  it("is the same sentence however much was clamped", () => {
    // The reader's next move is the same whether one frame or ten thousand
    // went past full scale, so the sentence is too.
    expect(levelNotice(1)).toBe(levelNotice(10496));
  });
});
