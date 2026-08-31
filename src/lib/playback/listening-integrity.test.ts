/**
 * What listening leaves behind, which is nothing (2V-A §5, §6, §8).
 *
 * Two questions this file answers and no other does. First, the ways a run
 * ends that are not a change of selection: an audio failure, and an abort
 * that arrives while the engine is still being built. Second, whether hearing
 * a selection can reach the Song, the history or the disk — asked of the real
 * store, and of the listening modules' own source, because "produces no
 * command" is a property of the wiring rather than of any function.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { PlaybackController } from "@/lib/audio/playback";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { createSongStore } from "@/lib/song/song-store";
import { planSelectionPlayback } from "@/lib/playback/selection-playback";
import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import { guitarTrack, restSlots, section, song } from "@/lib/song/fixtures";
import type { Engine } from "@/lib/audio/engine";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";
import type { SelectionPlaybackPlan } from "@/lib/playback/selection-playback";

const GTR = "gtr";
const BAR = 768;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

function oneTrackSong(): Song {
  const slots = restSlots(16);
  slots[0] = note("E2", 0, 0);
  slots[8] = note("A3", 3, 2);
  const bar = {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: slots },
  } satisfies Bar;
  return song([guitarTrack({ id: GTR })], [section([bar, bar], { id: "s1" })]);
}

/** A transport that remembers what it was told, and never runs a clock. */
function fakeTransport() {
  return {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: { value: 0, setValueAtTime: () => {}, cancelScheduledValues: () => {} },
    loop: false,
    loopStart: "",
    loopEnd: "",
    starts: 0,
    scheduled: [] as number[],
    schedule(_run: (at: number) => void, at: unknown) {
      this.scheduled.push(Number(String(at).replace("i", "")));
      return this.scheduled.length;
    },
    on: () => {},
    start() {
      this.starts += 1;
    },
    pause: () => {},
    stop: () => {},
    cancel() {
      this.scheduled = [];
    },
  };
}

function fakeEngine(source: Song, transport: ReturnType<typeof fakeTransport>) {
  return {
    context: { transport, draw: { schedule: (run: () => void) => run() }, now: () => 0 },
    master: {},
    metronome: { click: { triggerAttackRelease: () => {} }, filter: {} },
    voices: new Map(),
    meters: new Map(),
    plan: buildSongPlan(source),
    expression: {
      getPlan: () => buildExpressionPlan(source),
      setPlan: () => {},
      play: () => false,
      playChain: () => false,
      stopAll: () => {},
      counts: { active: 0, started: 0, disposed: 0 },
      fetchedUrls: 0,
      dispose: () => {},
    },
    silentTracks: [],
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose: () => {},
  } as unknown as Engine;
}

const planFor = (source: Song, from: number, to: number, mode: "once" | "loop") => {
  const descriptor = describeTimeSelection(source, {
    sectionId: "s1",
    trackId: GTR,
    startTicks: from,
    endTicks: to,
  });
  const result = planSelectionPlayback(source, descriptor, mode);
  if (!result.ok) throw new Error(`fixture refused: ${result.reason}`);
  return result.plan;
};

describe("when the audio itself fails", () => {
  it("says so, holds nothing, and does not reject the press", async () => {
    const source = oneTrackSong();
    const controller = new PlaybackController(source, {
      createEngine: async () => {
        throw new Error("no audio context");
      },
    });
    controller.setCountIn(0);

    /* The press handler calls this with `void`; a rejection here would be an
       unhandled one, and the reader would be told nothing. */
    await expect(controller.playSelection(planFor(source, 0, BAR, "loop"))).resolves
      .toBeUndefined();

    expect(controller.getSelectionPlayback()).toBeNull();
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().error).not.toBeNull();
  });

  it("is still safe to clean up after", async () => {
    const source = oneTrackSong();
    const controller = new PlaybackController(source, {
      createEngine: async () => {
        throw new Error("no audio context");
      },
    });
    controller.setCountIn(0);
    await controller.playSelection(planFor(source, 0, BAR, "once"));
    expect(() => controller.stopSelection()).not.toThrow();
    expect(controller.getSelectionPlayback()).toBeNull();
  });
});

describe("an abort that arrives while the engine is being built", () => {
  /**
   * The reader presses, then leaves — cancels the selection, changes view,
   * closes the editor — before the audio context has opened. Everything that
   * cancels is synchronous; the start is not.
   */
  const deferred = () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release };
  };

  it("never starts the run it was told to abandon", async () => {
    const source = oneTrackSong();
    const transport = fakeTransport();
    const { gate, release } = deferred();
    const controller = new PlaybackController(source, {
      createEngine: async () => {
        await gate;
        return fakeEngine(source, transport);
      },
    });
    controller.setCountIn(0);

    const run = controller.playSelection(planFor(source, 0, BAR, "loop"));
    controller.stopSelection();
    release();
    await run;

    expect(transport.starts).toBe(0);
    expect(controller.getSelectionPlayback()).toBeNull();
    expect(controller.getState().status).not.toBe("playing");
  });

  it("still lets the next press through", async () => {
    const source = oneTrackSong();
    const transport = fakeTransport();
    const { gate, release } = deferred();
    const controller = new PlaybackController(source, {
      createEngine: async () => {
        await gate;
        return fakeEngine(source, transport);
      },
    });
    controller.setCountIn(0);

    const abandoned = controller.playSelection(planFor(source, 0, BAR, "loop"));
    controller.stopSelection();
    release();
    await abandoned;

    await controller.playSelection(planFor(source, BAR, BAR * 2, "once"));
    expect(transport.starts).toBe(1);
    expect(controller.getSelectionPlayback()?.startTicks).toBe(BAR);
  });
});

describe("what a whole listening session costs the project", () => {
  it("writes nothing, remembers nothing, and moves no undo step", async () => {
    const source = oneTrackSong();
    let saves = 0;
    let writes = 0;
    const storage = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
      },
      removeItem: () => {
        writes += 1;
      },
    };
    const store = createSongStore(
      { song: source, outcome: "stored", canPersist: true },
      storage,
      {
        save: () => {
          saves += 1;
          return { ok: true, revision: 1 };
        },
      },
    );
    const before = store.getSnapshot();
    const bytes = JSON.stringify(before.song);

    const transport = fakeTransport();
    const controller = new PlaybackController(store.getSnapshot().song, {
      createEngine: async () => fakeEngine(source, transport),
    });
    controller.setCountIn(0);

    /* The whole of what §3 and §4 offer: hear it, loop it, turn the loop off. */
    await controller.playSelection(planFor(source, 0, BAR, "once"));
    controller.handleSelectionEnded();
    await controller.playSelection(planFor(source, 0, BAR, "loop"));
    controller.stopSelection();

    const after = store.getSnapshot();
    expect(saves).toBe(0);
    expect(writes).toBe(0);
    expect(after.undoDepth).toBe(before.undoDepth);
    expect(after.redoDepth).toBe(before.redoDepth);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.canRedo).toBe(before.canRedo);
    expect(after.undoLabel).toBe(before.undoLabel);
    expect(after.song).toBe(before.song);
    expect(JSON.stringify(after.song)).toBe(bytes);
  });

  it("has a store that would have noticed", () => {
    /* Not a vacuous zero: the same store counts a real edit. */
    let saves = 0;
    const store = createSongStore(
      { song: oneTrackSong(), outcome: "stored", canPersist: true },
      { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      {
        save: () => {
          saves += 1;
          return { ok: true, revision: 1 };
        },
      },
    );
    const before = store.getSnapshot();
    store.commit({ ...before.song, title: "Baska" }, { kind: "note_edit" });
    expect(saves).toBe(1);
    expect(store.getSnapshot().undoDepth).toBe(before.undoDepth + 1);
  });
});

describe("the listening path has no way to write", () => {
  /*
   * Read from disk on purpose (2L-R). "Produces no command" is a fact about
   * which modules the listening path is allowed to know about, and that is
   * exactly the kind of fact that decays the first time someone needs to
   * remember a loop "just for this session".
   */
  const MODULES = [
    "src/lib/playback/selection-playback.ts",
    "src/lib/playback/listening-session.ts",
    "src/lib/workspace/use-selection-listening.ts",
    "src/lib/workspace/use-covered-run.ts",
  ] as const;

  const sources = MODULES.map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("has the modules it claims to check", () => {
    expect(sources).toHaveLength(4);
    for (const source of sources) expect(source.text.length).toBeGreaterThan(400);
  });

  it("never commits", () => {
    for (const source of sources) {
      expect(source.text, source.path).not.toMatch(/\bcommit\s*\(/);
    }
  });

  it("never reaches history, storage or the clipboard", () => {
    for (const source of sources) {
      for (const forbidden of [
        "edit-history",
        "song-store",
        "project-storage",
        "project-record",
        "localStorage",
        "sessionStorage",
        "clipboard",
      ]) {
        expect(source.text, `${source.path} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("changing section under a run", () => {
  /*
   * §5 lists a section change beside cancelling the selection, and from the
   * plan's side they are the same event: the ticks a descriptor resolves to
   * are song-absolute, so the same bar of a later section is different music.
   */
  it("plans different music for the same bar of another section", () => {
    const bar = {
      timeSignature: [4, 4],
      resolution: 16,
      slots: { [GTR]: (() => {
        const slots = restSlots(16);
        slots[0] = note("E2", 0, 0);
        return slots;
      })() },
    } satisfies Bar;
    const two = song(
      [guitarTrack({ id: GTR })],
      [section([bar], { id: "s1" }), section([bar], { id: "s2" })],
    );
    const planIn = (sectionId: string): SelectionPlaybackPlan => {
      const descriptor = describeTimeSelection(two, {
        sectionId,
        trackId: GTR,
        startTicks: 0,
        endTicks: BAR,
      });
      const result = planSelectionPlayback(two, descriptor, "loop");
      if (!result.ok) throw new Error(result.reason);
      return result.plan;
    };
    expect(planIn("s1").startTicks).toBe(0);
    expect(planIn("s2").startTicks).toBe(BAR);
  });
});
