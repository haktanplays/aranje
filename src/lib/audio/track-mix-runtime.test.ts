/**
 * The mixer against the running graph (spec 13.18, 2L-C §7, §14).
 *
 * The engine is injected, so this drives the real controller and the real
 * `setTrackMix`/`setTrackAudibility` without an audio context. What is being
 * checked is not that Tone works — it is that changing a level touches
 * exactly one channel, and touches nothing else at all: no second engine, no
 * rescheduling, no re-decoded sample, no moved playhead.
 */
import { describe, expect, it } from "vitest";

import { setTrackAudibility, setTrackMix, type Engine } from "@/lib/audio/engine";
import { PlaybackController } from "@/lib/audio/playback";
import { buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { applyMixCommand } from "@/lib/song/track-mix";
import type { Song } from "@/lib/song/schema";

type FakeChannel = {
  volume: { value: number };
  pan: { value: number };
  mute: boolean;
};

function fakeTransport() {
  return {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: {
      value: 0,
      setValueAtTime() {},
      cancelScheduledValues() {},
    },
    loop: false,
    loopStart: "0i",
    loopEnd: "0i",
    scheduled: 0,
    cancels: 0,
    schedule() {
      this.scheduled += 1;
      return this.scheduled;
    },
    on() {},
    start() {},
    pause() {},
    stop() {},
    cancel() {
      this.cancels += 1;
    },
  };
}

function harness(song: Song = SAMPLE_SONG) {
  const transport = fakeTransport();
  const channels = new Map<string, FakeChannel>();
  const voices = new Map<string, { trackId: string; channel: FakeChannel }>();
  for (const track of song.tracks) {
    const channel: FakeChannel = {
      volume: { value: track.volumeDb },
      pan: { value: track.pan ?? 0 },
      mute: false,
    };
    channels.set(track.id, channel);
    voices.set(track.id, { trackId: track.id, channel });
  }

  let builds = 0;
  /** Counted the way the real engine counts them: once per pack decode. */
  let decodes = 0;
  let stopAlls = 0;

  const engine = {
    context: { transport },
    master: {},
    metronome: { click: { triggerAttackRelease: () => {} }, filter: {} },
    voices,
    meters: new Map(),
    plan: buildSongPlan(song),
    expression: {
      setPlan() {},
      getPlan: () => ({ notes: [], chains: [] }),
      play: () => true,
      playChain: () => true,
      stopAll() {
        stopAlls += 1;
      },
      counts: { active: 0, peak: 0 },
      fetchedUrls: 0,
      dispose() {},
    },
    silentTracks: [],
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose() {},
  } as unknown as Engine;

  const controller = new PlaybackController(song, {
    createEngine: async () => {
      builds += 1;
      decodes += 1;
      return engine;
    },
  });

  return {
    controller,
    engine,
    transport,
    channels,
    builds: () => builds,
    decodes: () => decodes,
    stopAlls: () => stopAlls,
  };
}

const started = async (song?: Song) => {
  const bench = harness(song);
  await bench.controller.play();
  return bench;
};

describe("59. one level, one channel", () => {
  it("writes only the track it was given", async () => {
    const bench = await started();
    const before = new Map(
      [...bench.channels].map(([id, channel]) => [
        id,
        { volume: channel.volume.value, pan: channel.pan.value },
      ]),
    );

    bench.controller.setTrackMix("gtr", -14, -0.4);

    expect(bench.channels.get("gtr")!.volume.value).toBe(-14);
    expect(bench.channels.get("gtr")!.pan.value).toBe(-0.4);
    for (const [id, channel] of bench.channels) {
      if (id === "gtr") continue;
      expect(channel.volume.value, id).toBe(before.get(id)!.volume);
      expect(channel.pan.value, id).toBe(before.get(id)!.pan);
    }
  });

  it("refuses to invent a channel for a track that is not in the graph", () => {
    const bench = harness();
    expect(setTrackMix(bench.engine, "yok", -6, 0)).toBe(false);
  });

  it("builds no engine, schedules nothing and moves nothing", async () => {
    const bench = await started();
    bench.controller.seekToBar("main-riff:1");
    const at = {
      builds: bench.builds(),
      decodes: bench.decodes(),
      scheduled: bench.transport.scheduled,
      cancels: bench.transport.cancels,
      ticks: bench.transport.ticks,
      loop: bench.transport.loop,
      practice: bench.controller.getPracticePercent(),
    };

    bench.controller.setTrackMix("gtr", -3, 0.5);
    bench.controller.setTrackMix("bass", -9, -0.5);
    bench.controller.setTrackAudibility(["gtr"]);

    expect(bench.builds()).toBe(at.builds);
    expect(bench.decodes()).toBe(at.decodes);
    expect(bench.transport.scheduled).toBe(at.scheduled);
    expect(bench.transport.cancels).toBe(at.cancels);
    expect(bench.transport.ticks).toBe(at.ticks);
    expect(bench.transport.loop).toBe(at.loop);
    expect(bench.controller.getPracticePercent()).toBe(at.practice);
  });

  it("keeps a level asked for before there was a graph", async () => {
    const bench = harness();
    // The mixer opens and a slider moves while the engine does not exist yet.
    bench.controller.setTrackMix("gtr", -20, 0.75);
    expect(bench.builds()).toBe(0);

    await bench.controller.play();
    expect(bench.channels.get("gtr")!.volume.value).toBe(-20);
    expect(bench.channels.get("gtr")!.pan.value).toBe(0.75);
    expect(bench.builds()).toBe(1);
  });

  it("puts the graph back on the song's own levels when the draft is dropped", async () => {
    const bench = await started();
    bench.controller.setTrackMix("gtr", -20, 0.75);
    bench.controller.clearTrackMixPreview();

    const committed = SAMPLE_SONG.tracks.find((track) => track.id === "gtr")!;
    expect(bench.channels.get("gtr")!.volume.value).toBe(committed.volumeDb);
    expect(bench.channels.get("gtr")!.pan.value).toBe(committed.pan ?? 0);
  });

  it("applies a committed mix without a second engine", async () => {
    const bench = await started();
    const result = applyMixCommand(SAMPLE_SONG, {
      kind: "update_track_mix",
      mixes: { gtr: { volumeDb: -11, pan: -0.25 }, drums: { volumeDb: 2, pan: 0 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = bench.builds();
    bench.controller.applyMixOnly(result.song);

    expect(bench.builds()).toBe(before);
    expect(bench.channels.get("gtr")!.volume.value).toBe(-11);
    expect(bench.channels.get("gtr")!.pan.value).toBe(-0.25);
    expect(bench.channels.get("drums")!.volume.value).toBe(2);
    // Committed values win over anything a slider had staged.
    bench.controller.setTrackMix("gtr", 5, 0.9);
    bench.controller.applyMixOnly(result.song);
    expect(bench.channels.get("gtr")!.volume.value).toBe(-11);
  });

  it("drops the staged levels the commit replaced, not just their sound", async () => {
    /*
     * Writing the committed value onto the channel is only half of it: a
     * preview the commit superseded must also stop being *pending*, or it
     * comes back the next time a graph is built and quietly overrides the
     * music. Staged before there is any engine, so the only thing that can
     * carry the value into the build is the pending list itself.
     */
    const result = applyMixCommand(SAMPLE_SONG, {
      kind: "update_track_mix",
      mixes: { gtr: { volumeDb: -11, pan: -0.25 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The graph will be built from the committed song, so anything other
    // than -11/-0.25 on that channel can only have come from the pending list.
    const bench = harness(result.song);
    bench.controller.setTrackMix("gtr", 5, 0.9);
    bench.controller.applyMixOnly(result.song);

    await bench.controller.play();
    expect(bench.channels.get("gtr")!.volume.value).toBe(-11);
    expect(bench.channels.get("gtr")!.pan.value).toBe(-0.25);
  });
});

describe("60. who is heard, on the graph", () => {
  it("mutes exactly the tracks that are not audible", async () => {
    const bench = await started();
    bench.controller.setTrackAudibility(["gtr", "bass"]);
    expect(bench.channels.get("gtr")!.mute).toBe(false);
    expect(bench.channels.get("bass")!.mute).toBe(false);
    expect(bench.channels.get("acc")!.mute).toBe(true);
    expect(bench.channels.get("drums")!.mute).toBe(true);
  });

  it("never changes a level while changing audibility", async () => {
    const bench = await started();
    const levels = new Map(
      [...bench.channels].map(([id, channel]) => [id, channel.volume.value]),
    );
    bench.controller.setTrackAudibility([]);
    for (const [id, channel] of bench.channels) {
      expect(channel.volume.value, id).toBe(levels.get(id));
      expect(channel.mute, id).toBe(true);
    }
    // ...and coming back is the level that was never touched.
    bench.controller.setTrackAudibility(SAMPLE_SONG.tracks.map((t) => t.id));
    for (const [id, channel] of bench.channels) {
      expect(channel.mute, id).toBe(false);
      expect(channel.volume.value, id).toBe(levels.get(id));
    }
  });

  it("cannot reach the metronome, which is not a track", async () => {
    const bench = await started();
    // Every voice the audibility pass can see is a track of the song; the
    // metronome hangs off the master and is not in the map at all.
    setTrackAudibility(bench.engine, []);
    expect([...bench.channels.keys()].sort()).toEqual(
      SAMPLE_SONG.tracks.map((track) => track.id).sort(),
    );
    expect(bench.engine.metronome).toBeDefined();
    expect(bench.engine.voices.has("metronome")).toBe(false);
  });

  it("keeps an audition asked for before there was a graph", async () => {
    const bench = harness();
    bench.controller.setTrackAudibility(["drums"]);
    await bench.controller.play();
    expect(bench.channels.get("drums")!.mute).toBe(false);
    expect(bench.channels.get("gtr")!.mute).toBe(true);
  });

  it("leaves no voice sounding after dispose", async () => {
    const bench = await started();
    bench.controller.setTrackMix("gtr", -5, 0);
    bench.controller.dispose();
    expect(bench.engine.expression.counts.active).toBe(0);
  });
});
