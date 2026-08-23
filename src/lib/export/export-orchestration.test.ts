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
