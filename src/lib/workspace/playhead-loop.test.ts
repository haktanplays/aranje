/**
 * When the playhead costs a frame, and when it costs nothing (2N-A.1).
 *
 * The accepted contract is that the follow loop is alive **only while the
 * transport is running**. That is a battery claim, and a battery claim
 * measured by watching the browser's own frame rate is not measured at all:
 * `requestAnimationFrame` fires about sixty times a second whether or not
 * anything in the app asked for it, so a probe that counts its own frames
 * reports the display's refresh rate under the playhead's name.
 *
 * Here the loop is driven by a scheduler that can be counted. Every request,
 * every cancel and every callback body is recorded, so "no loop is alive"
 * stops being a hope and becomes an assertion.
 */
import { describe, expect, it } from "vitest";

import { runPlayheadLoop, type FrameScheduler } from "@/lib/workspace/playhead-loop";

/**
 * A scheduler that runs nothing on its own.
 *
 * Frames happen when the test says so, which is what makes the difference
 * between "alive" and "idle" visible: an idle loop has nothing pending, so
 * `flush()` finds nothing to run however many times it is called.
 */
function fakeFrames() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const log = { requested: 0, cancelled: 0, drawn: 0 };

  const scheduler: FrameScheduler = {
    request(callback) {
      log.requested += 1;
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      log.cancelled += 1;
      pending.delete(handle);
    },
  };

  return {
    scheduler,
    log,
    /** Loops with a frame outstanding: the number that must be 0 when idle. */
    live: () => pending.size,
    /** Run one round of whatever is pending. Returns how many ran. */
    flush() {
      const round = [...pending.entries()];
      pending.clear();
      for (const [, callback] of round) callback();
      return round.length;
    },
    /** Run `rounds` frames, or stop early once nothing is pending. */
    run(rounds: number) {
      let ran = 0;
      for (let index = 0; index < rounds; index += 1) {
        if (pending.size === 0) break;
        ran += this.flush();
      }
      return ran;
    },
  };
}

const start = (running: boolean, frames: ReturnType<typeof fakeFrames>) => {
  let drawn = 0;
  const stop = runPlayheadLoop({
    source: "tab",
    running,
    draw: () => {
      drawn += 1;
    },
    scheduler: frames.scheduler,
  });
  return { stop, drawn: () => drawn };
};

describe("114. a stopped transport costs one paint and no loop", () => {
  it("draws once and asks for nothing more when idle", () => {
    const frames = fakeFrames();
    const loop = start(false, frames);

    // The paint: a stopped transport still has a position, and the line has
    // to be put at it. What must not follow is a second request.
    expect(frames.live()).toBe(1);
    expect(frames.run(100)).toBe(1);
    expect(loop.drawn()).toBe(1);
    expect(frames.live()).toBe(0);
    expect(frames.log.requested).toBe(1);

    loop.stop();
  });

  it("is the same for paused and for ended", () => {
    /*
     * Neither is a state of its own here, and that is the point: the loop
     * knows one thing, whether the transport is running. Pause and end both
     * arrive as `running: false`, so neither can accidentally get its own
     * behaviour.
     */
    for (const state of ["paused", "ended"]) {
      const frames = fakeFrames();
      const loop = start(false, frames);
      expect(frames.run(100), state).toBe(1);
      expect(frames.live(), state).toBe(0);
      loop.stop();
    }
  });

  it("stays at zero however long nothing happens", () => {
    const frames = fakeFrames();
    const loop = start(false, frames);
    frames.run(100);
    const after = frames.log.requested;
    frames.run(1000);
    expect(frames.log.requested).toBe(after);
    expect(frames.live()).toBe(0);
    loop.stop();
  });
});

describe("115. a running transport keeps exactly one loop", () => {
  it("draws every frame and never asks twice for one", () => {
    const frames = fakeFrames();
    const loop = start(true, frames);

    for (let round = 0; round < 10; round += 1) {
      // One pending frame before each round, and one after it: the loop
      // replaces its own request rather than adding to it.
      expect(frames.live()).toBe(1);
      expect(frames.flush()).toBe(1);
    }
    expect(loop.drawn()).toBe(10);
    expect(frames.live()).toBe(1);

    loop.stop();
    expect(frames.live()).toBe(0);
  });

  it("stops on cleanup even while it is mid-flight", () => {
    const frames = fakeFrames();
    const loop = start(true, frames);
    frames.flush();
    loop.stop();

    expect(frames.live()).toBe(0);
    const drawnBefore = loop.drawn();
    expect(frames.run(100)).toBe(0);
    expect(loop.drawn()).toBe(drawnBefore);
  });
});

describe("116. no arrangement of surfaces leaves a second loop behind", () => {
  it("survives three view switches without accumulating", () => {
    /*
     * A view switch unmounts one surface and mounts the other. Each mount
     * starts a loop and each unmount cancels one, so the count after three
     * round trips is the count after none — which is what stops a reader who
     * flips between Tab and Düzen from ending up with four loops running.
     */
    const frames = fakeFrames();
    let current = start(true, frames);

    for (let round = 0; round < 3; round += 1) {
      current.stop();
      expect(frames.live()).toBe(0);
      current = start(true, frames);
      expect(frames.live()).toBe(1);
      frames.flush();
    }

    expect(frames.live()).toBe(1);
    current.stop();
    expect(frames.live()).toBe(0);
  });

  it("ends the old loop when the transport falls idle under it", () => {
    /*
     * What a timing change does: the song is replaced, the transport stops,
     * and the surface re-runs its effect with `running: false`. The old loop
     * must be gone rather than left running against a plan that no longer
     * exists.
     */
    const frames = fakeFrames();
    const playing = start(true, frames);
    frames.flush();
    expect(frames.live()).toBe(1);

    playing.stop();
    const idle = start(false, frames);
    expect(frames.run(100)).toBe(1);
    expect(frames.live()).toBe(0);

    idle.stop();
  });

  it("leaves nothing alive after the last surface goes away", () => {
    const frames = fakeFrames();
    const first = start(true, frames);
    const second = start(true, frames);
    expect(frames.live()).toBe(2);

    first.stop();
    second.stop();
    expect(frames.live()).toBe(0);
    expect(frames.run(100)).toBe(0);
  });
});

describe("292. a frame that has been drawn is no longer owed", () => {
  it("reports one outstanding frame while running, not one per frame drawn", () => {
    /*
     * `window.__playheadProbe.live` is the count of frames the loop has asked
     * for and not yet been given. A loop that only ever incremented it would
     * still draw correctly and still stop correctly — and every "no ghost
     * playback" claim measured through this counter, in every browser
     * harness, would be reading a number that grows on its own.
     */
    const probe: Record<string, Record<string, number>> = {
      scheduled: {},
      drawn: {},
      live: {},
    };
    /*
     * The counter is a browser affordance: the loop reads
     * `window.__playheadProbe` every time it bumps one. This suite runs in
     * node, so the window it reads is supplied here — otherwise every bump is
     * a no-op and the assertion below would be about nothing.
     */
    const host = globalThis as { window?: { __playheadProbe?: unknown } };
    const had = host.window;
    host.window = { __playheadProbe: probe };
    const frames = fakeFrames();
    const { stop } = start(true, frames);
    for (let frame = 0; frame < 10; frame += 1) {
      frames.flush();
      expect(probe.live!.tab, `after ${frame + 1} frames`).toBe(1);
    }
    stop();
    expect(probe.live!.tab).toBe(0);
    expect(probe.drawn!.tab).toBe(10);
    if (had === undefined) delete host.window;
    else host.window = had;
  });
});

