import { describe, expect, it } from "vitest";

import { PreviewEngine, type PreviewPlayback } from "@/lib/audio/preview-engine";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";

type FakePlayback = PreviewPlayback & {
  readonly log: string[];
  readonly song: Song;
  disposed: boolean;
};

function harness() {
  const built: FakePlayback[] = [];
  const log: string[] = [];

  const engine = new PreviewEngine((song) => {
    const playback: FakePlayback = {
      log,
      song,
      disposed: false,
      seekToBar(barKey) {
        log.push(`seek:${barKey}`);
      },
      async play() {
        log.push("play");
      },
      dispose() {
        playback.disposed = true;
        log.push("dispose");
      },
    };
    built.push(playback);
    log.push("build");
    return playback;
  });

  return { engine, built, log };
}

const CANDIDATE: Song = { ...SAMPLE_SONG, title: "Aday" };
const SECTION = SAMPLE_SONG.sections[0]?.id ?? "intro-riff";

describe("the preview engine's lifetime", () => {
  it("stops the song's own playback before it builds anything", () => {
    const { engine, log } = harness();
    engine.start(CANDIDATE, SECTION, () => log.push("stop-host"));
    expect(log).toEqual(["stop-host", "build", `seek:${SECTION}:0`, "play"]);
  });

  it("starts at the section that changed, not at the top of the song", () => {
    const { engine, log } = harness();
    engine.start(CANDIDATE, "main-riff", () => {});
    expect(log).toContain("seek:main-riff:0");
  });

  it("plays the candidate, not the song it came from", () => {
    const { engine, built } = harness();
    engine.start(CANDIDATE, SECTION, () => {});
    expect(built[0]?.song).toBe(CANDIDATE);
  });

  it("never leaves two engines alive", () => {
    const { engine, built } = harness();
    engine.start(CANDIDATE, SECTION, () => {});
    engine.start(CANDIDATE, SECTION, () => {});
    engine.start(CANDIDATE, SECTION, () => {});

    expect(built).toHaveLength(3);
    expect(built.filter((playback) => !playback.disposed)).toHaveLength(1);
    expect(built[2]?.disposed).toBe(false);
  });

  it("disposes on stop", () => {
    const { engine, built } = harness();
    engine.start(CANDIDATE, SECTION, () => {});
    expect(engine.active).toBe(true);

    engine.stop();
    expect(engine.active).toBe(false);
    expect(built[0]?.disposed).toBe(true);
  });

  it("is safe to stop when nothing is playing", () => {
    const { engine, built } = harness();
    engine.stop();
    engine.stop();
    expect(built).toHaveLength(0);
    expect(engine.active).toBe(false);
  });

  it("disposes once, however often it is stopped", () => {
    const { engine, log } = harness();
    engine.start(CANDIDATE, SECTION, () => {});
    engine.stop();
    engine.stop();
    expect(log.filter((entry) => entry === "dispose")).toHaveLength(1);
  });

  it("survives a fast open and close", () => {
    const { engine, built } = harness();
    for (let round = 0; round < 5; round += 1) {
      engine.start(CANDIDATE, SECTION, () => {});
      engine.stop();
    }
    expect(built).toHaveLength(5);
    expect(built.every((playback) => playback.disposed)).toBe(true);
    expect(engine.active).toBe(false);
  });

  it("writes nothing anywhere; it only plays", () => {
    // The engine takes a song and a section id and returns nothing. There is
    // no storage in its surface at all, which is what keeps a preview from
    // ever being saved by listening to it.
    const { engine } = harness();
    expect(engine.start(CANDIDATE, SECTION, () => {})).toBeUndefined();
    expect(engine.stop()).toBeUndefined();
  });
});
