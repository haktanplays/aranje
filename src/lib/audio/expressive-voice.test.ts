/**
 * One voice per note, and no voice touching another (spec 8.5, K-21).
 *
 * The node module is faked, so this runs without an audio context and can
 * check the thing that actually matters: *which* object each automation call
 * lands on. A test that only listened to the output could not tell a per-note
 * bend from a track-wide one until a chord happened to expose it.
 */
import { describe, expect, it } from "vitest";

import { ExpressiveVoicePool, type VoiceHost } from "@/lib/audio/expressive-voice";
import { buildExpressionPlan, type ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import type { LegatoChain } from "@/lib/audio/legato-chain";
import { sampleEntries } from "@/lib/audio/sample-map";
import { TIE, bar, note, slots, song } from "@/test/expression-fixtures";

type Call = { kind: "set" | "ramp"; value: number; time: number };

type FakeParam = { calls: Call[] };

type FakeSource = {
  id: number;
  playbackRate: FakeParam & {
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
  };
  started: { time: number; offset: number; duration: number } | null;
  stopped: boolean;
  disposed: number;
  onended: () => void;
  connect(node: unknown): void;
  start(time: number, offset: number, duration: number): void;
  stop(): void;
  dispose(): void;
};

function fakeTone() {
  const sources: FakeSource[] = [];
  const gains: { id: number; calls: Call[]; disposed: number; gainAtBuild: number }[] = [];
  const filters: { id: number; disposed: number }[] = [];

  const param = (): FakeParam & {
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
  } => {
    const calls: Call[] = [];
    return {
      calls,
      setValueAtTime(value, time) {
        calls.push({ kind: "set", value, time });
      },
      linearRampToValueAtTime(value, time) {
        calls.push({ kind: "ramp", value, time });
      },
    };
  };

  const tone = {
    Gain: class {
      id = gains.length;
      gain = param();
      disposed = 0;
      calls = this.gain.calls;
      /** The level it was constructed with, before any automation. */
      gainAtBuild = 0;
      constructor(options?: { gain?: number }) {
        this.gainAtBuild = options?.gain ?? 0;
        gains.push(
          this as unknown as {
            id: number;
            calls: Call[];
            disposed: number;
            gainAtBuild: number;
          },
        );
      }
      connect() {}
      dispose() {
        this.disposed += 1;
      }
    },
    Filter: class {
      id = filters.length;
      disposed = 0;
      constructor() {
        filters.push(this as unknown as { id: number; disposed: number });
      }
      connect() {}
      dispose() {
        this.disposed += 1;
      }
    },
    ToneBufferSource: class {
      id = sources.length;
      playbackRate = param();
      started: FakeSource["started"] = null;
      stopped = false;
      disposed = 0;
      onended: () => void = () => {};
      constructor() {
        sources.push(this as unknown as FakeSource);
      }
      connect() {}
      start(time: number, offset: number, duration: number) {
        this.started = { time, offset, duration };
      }
      stop() {
        this.stopped = true;
      }
      dispose() {
        this.disposed += 1;
      }
    },
  };

  return { tone, sources, gains, filters };
}

const NOTES = ["E2", "A2", "D3", "G3", "B3", "E4"];

function harness(options: { offline?: boolean } = {}) {
  const { tone, sources, gains, filters } = fakeTone();
  const host: VoiceHost = {
    buffers: {
      has: () => true,
      get: (name: string) => ({ name }),
    } as unknown as VoiceHost["buffers"],
    entries: sampleEntries(NOTES),
    destination: {} as VoiceHost["destination"],
    trimGain: 1,
  };
  const pool = new ExpressiveVoicePool(
    tone as never,
    { isOffline: options.offline ?? false } as never,
    new Map([["gtr", host]]),
  );
  return { pool, sources, gains, filters };
}

function planFor(articulation: Parameters<typeof note>[3]): ExpressiveNotePlan {
  const fixture = song([
    bar(slots([note("G3", 1, 10), note("B3", 1, 14, articulation)])),
  ]);
  const found = buildExpressionPlan(fixture).notes.find(
    (entry) => entry.slotIndex === 1,
  );
  if (!found) throw new Error("no plan");
  return found;
}

describe("one voice per note", () => {
  it("builds a source, a gain and nothing shared", () => {
    const { pool, sources, gains } = harness();
    expect(pool.play("gtr", planFor("vibrato"), 1)).toBe(true);

    expect(sources).toHaveLength(1);
    expect(gains).toHaveLength(1);
    expect(pool.counts.active).toBe(1);
    expect(pool.counts.started).toBe(1);
  });

  it("starts at the time it was given, for the length it was planned", () => {
    const { pool, sources } = harness();
    const plan = planFor("vibrato");
    pool.play("gtr", plan, 4.5);

    expect(sources[0]?.started).toEqual({
      time: 4.5,
      offset: 0,
      duration: plan.durationSeconds,
    });
  });

  it("writes the modulation on its own source and no other", () => {
    const { pool, sources } = harness();
    // A chord: one note shakes, the other does not.
    pool.play("gtr", planFor("vibrato"), 0);
    pool.play("gtr", { ...planFor(undefined), expressive: true }, 0);

    const shaken = sources[0];
    const still = sources[1];
    expect(shaken?.playbackRate.calls.length).toBeGreaterThan(3);
    // The plain note is set once, at its own rate, and never moved.
    expect(still?.playbackRate.calls.filter((call) => call.kind === "ramp")).toEqual([]);
  });

  it("gives a bend its own rise and fall", () => {
    const { pool, sources } = harness();
    pool.play("gtr", planFor("bend_full"), 0);

    const calls = sources[0]?.playbackRate.calls ?? [];
    const rates = calls.map((call) => call.value);
    expect(Math.max(...rates)).toBeGreaterThan(rates[0] ?? 0);
    expect(calls[calls.length - 1]?.value).toBeCloseTo(rates[0] ?? 0, 10);
  });

  it("hands a palm mute a filter of its own", () => {
    const { pool, filters } = harness();
    pool.play("gtr", planFor("palm_mute"), 0);
    expect(filters).toHaveLength(1);
  });

  it("gives an accent a gain of its own and no filter", () => {
    const { pool, gains, filters } = harness();
    pool.play("gtr", planFor("accent"), 0);

    expect(filters).toHaveLength(0);
    expect(gains[0]?.calls.length).toBeGreaterThan(0);
  });

  it("refuses a track it has no samples for", () => {
    const { pool, sources } = harness();
    expect(pool.play("bass", planFor("vibrato"), 0)).toBe(false);
    expect(sources).toHaveLength(0);
  });
});

describe("nothing is left ringing", () => {
  it("goes away when the source ends", () => {
    const { pool, sources } = harness();
    pool.play("gtr", planFor("vibrato"), 0);
    sources[0]?.onended();

    expect(pool.counts.active).toBe(0);
    expect(pool.counts.disposed).toBe(1);
    expect(sources[0]?.disposed).toBe(1);
  });

  it("stops everything at once when asked", () => {
    const { pool, sources, gains } = harness();
    pool.play("gtr", planFor("vibrato"), 0);
    pool.play("gtr", planFor("bend_half"), 1);
    expect(pool.counts.active).toBe(2);

    pool.stopAll();

    expect(pool.counts.active).toBe(0);
    expect(sources.every((source) => source.disposed === 1)).toBe(true);
    expect(gains.every((gain) => gain.disposed === 1)).toBe(true);
  });

  it("does not mind being disposed twice", () => {
    const { pool, sources } = harness();
    pool.play("gtr", planFor("vibrato"), 0);

    pool.stopAll();
    sources[0]?.onended();
    pool.stopAll();

    expect(sources[0]?.disposed).toBe(1);
    expect(pool.counts.disposed).toBe(1);
    expect(pool.counts.active).toBe(0);
  });

  it("leaks nothing through a fast run of starts and stops", () => {
    const { pool, sources } = harness();
    for (let round = 0; round < 25; round += 1) {
      pool.play("gtr", planFor("vibrato"), round);
      if (round % 3 === 0) pool.stopAll();
    }
    pool.stopAll();

    expect(pool.counts.active).toBe(0);
    expect(pool.counts.disposed).toBe(pool.counts.started);
    expect(sources.every((source) => source.disposed === 1)).toBe(true);
  });

  it("plays nothing more once it has been disposed", () => {
    const { pool } = harness();
    pool.dispose();
    expect(pool.play("gtr", planFor("vibrato"), 0)).toBe(false);
    expect(pool.counts.active).toBe(0);
  });
});

describe("the offline renderer's rule", () => {
  it("keeps a finished voice's nodes until the render is over", () => {
    // Offline, Tone walks the timeline first and writes the audio afterwards.
    // Freeing a node when its note ends would erase the sound before it was
    // ever written, so the nodes stay until the pool is stopped.
    const { pool, sources } = harness({ offline: true });
    pool.play("gtr", planFor("vibrato"), 0);
    sources[0]?.onended();

    expect(pool.counts.active).toBe(0);
    expect(sources[0]?.disposed).toBe(0);

    pool.stopAll();
    expect(sources[0]?.disposed).toBe(1);
    expect(pool.counts.disposed).toBe(1);
  });

  it("frees a finished voice straight away when it is not offline", () => {
    const { pool, sources } = harness({ offline: false });
    pool.play("gtr", planFor("vibrato"), 0);
    sources[0]?.onended();

    expect(sources[0]?.disposed).toBe(1);
  });

  it("leaves nothing behind offline once everything has stopped", () => {
    const { pool, sources } = harness({ offline: true });
    for (let index = 0; index < 10; index += 1) {
      pool.play("gtr", planFor("vibrato"), index);
    }
    for (const source of sources) source.onended();

    expect(pool.counts.active).toBe(0);
    pool.dispose();
    expect(sources.every((source) => source.disposed === 1)).toBe(true);
    expect(pool.counts.disposed).toBe(sources.length);
  });
});

/** The chain for a fixture, plus a pool to play it on. */
function chainOf(fixture: ReturnType<typeof song>): LegatoChain {
  const chain = buildExpressionPlan(fixture).chains[0];
  if (!chain) throw new Error("no chain");
  return chain;
}

const G3 = () => note("G3", 1, 10);
const B3 = (a?: Parameters<typeof note>[3]) => note("B3", 1, 14, a);

describe("a legato chain is one voice", () => {
  it("starts a single source for a hammer-on pair", () => {
    const { pool, sources } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));

    expect(pool.playChain(chain, 0)).toBe(true);

    expect(sources).toHaveLength(1);
    expect(pool.counts.primary).toBe(1);
    expect(pool.counts.auxiliaryTransient).toBe(0);
  });

  it("never starts a second source at the hammer-on target", () => {
    const { pool, sources } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));
    pool.playChain(chain, 0);

    // One source, started once, for the whole chain.
    expect(sources).toHaveLength(1);
    expect(sources[0]?.started?.duration).toBeCloseTo(
      chain.endSeconds - chain.startSeconds,
      6,
    );
  });

  it("moves the pitch of the voice that is already ringing", () => {
    const { pool, sources } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));
    pool.playChain(chain, 0);

    const calls = sources[0]?.playbackRate.calls ?? [];
    const ramps = calls.filter((call) => call.kind === "ramp");
    expect(ramps).toHaveLength(1);

    // Four semitones up: the rate rises by 2^(4/12).
    const start = calls[0]?.value ?? 0;
    expect(ramps[0]?.value ?? 0).toBeCloseTo(start * Math.pow(2, 4 / 12), 8);
    expect(ramps[0]?.time).toBeCloseTo(
      (chain.transitions[0]?.atSeconds ?? 0) +
        (chain.transitions[0]?.transitionSeconds ?? 0),
      6,
    );
  });

  it("keeps 5h7p5 on one source with two transitions", () => {
    const { pool, sources } = harness();
    const chain = chainOf(
      song([bar(slots([G3(), B3("hammer_on"), note("G3", 1, 10, "pull_off")]))]),
    );
    pool.playChain(chain, 0);

    // One primary, plus the pull-off's own short click.
    expect(pool.counts.primary).toBe(1);
    expect(pool.counts.auxiliaryTransient).toBe(1);
    expect(sources.filter((entry) => entry.started !== null)).toHaveLength(2);

    const ramps = (sources[0]?.playbackRate.calls ?? []).filter(
      (call) => call.kind === "ramp",
    );
    expect(ramps).toHaveLength(2);
    // It comes back to exactly where it started.
    expect(ramps[1]?.value ?? 0).toBeCloseTo(
      sources[0]?.playbackRate.calls[0]?.value ?? 0,
      8,
    );
  });

  it("gives a pull-off one short quiet click, not a second note", () => {
    const { pool, sources, filters } = harness();
    const chain = chainOf(song([bar(slots([B3(), note("G3", 1, 10, "pull_off")]))]));
    pool.playChain(chain, 0);

    expect(pool.counts.primary).toBe(1);
    expect(pool.counts.auxiliaryTransient).toBe(1);
    expect(filters).toHaveLength(1);

    const aux = sources[1];
    const primary = sources[0];
    expect(aux?.started?.duration).toBeLessThanOrEqual(0.035);
    expect(aux?.started?.duration ?? 1).toBeLessThan(
      (primary?.started?.duration ?? 0) / 4,
    );
  });

  it("keeps the pull-off click far below the note it sits on", () => {
    const { pool, gains } = harness();
    const chain = chainOf(song([bar(slots([B3(), note("G3", 1, 10, "pull_off")]))]));
    pool.playChain(chain, 0);

    // The chain's own gain, then the click's.
    const primaryLevel = gains[0]?.calls[0]?.value ?? 0;
    const auxLevel = gains[1]?.gainAtBuild ?? 0;

    expect(primaryLevel).toBeGreaterThan(0);
    expect(auxLevel).toBeGreaterThan(0);
    // A finger coming off the string is a hint, not an attack.
    expect(auxLevel).toBeLessThan(primaryLevel / 4);
  });

  it("steps the level down at each transition, on its own gain", () => {
    const { pool, gains } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));
    pool.playChain(chain, 0);

    const calls = gains[0]?.calls ?? [];
    const ramps = calls.filter((call) => call.kind === "ramp");
    expect(ramps).toHaveLength(1);
    expect(ramps[0]?.value ?? 0).toBeLessThan(calls[0]?.value ?? 0);
  });

  it("does not touch any other string", () => {
    const { pool, sources } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));
    // A steady note on another string, playing at the same time.
    const steady = buildExpressionPlan(
      song([bar(slots([note("E3", 0, 12, "accent")]))]),
    ).notes[0];
    if (!steady) throw new Error("no steady note");

    pool.playChain(chain, 0);
    pool.play("gtr", steady, 0);

    const other = sources[1];
    expect(other?.playbackRate.calls.filter((call) => call.kind === "ramp")).toEqual([]);
  });

  it("does not touch a string that was already ringing before it started", () => {
    // The order matters. Writing the travel onto "every voice this track has"
    // looks correct as long as the chain goes first, because the other voices
    // do not exist yet. In a chord they very often do.
    const { pool, sources } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));
    const steady = buildExpressionPlan(
      song([bar(slots([note("E3", 0, 12, "accent")]))]),
    ).notes[0];
    if (!steady) throw new Error("no steady note");

    pool.play("gtr", steady, 0);
    pool.playChain(chain, 0);

    const other = sources[0];
    const moved = sources[1];
    expect(other?.playbackRate.calls.filter((call) => call.kind === "ramp")).toEqual([]);
    // The steady string is set once, to its own rate, and never moved again.
    expect(other?.playbackRate.calls).toHaveLength(1);
    // Meanwhile the chain's own source really did move, so the test is not
    // passing because nothing happened at all.
    expect(
      moved?.playbackRate.calls.filter((call) => call.kind === "ramp").length,
    ).toBeGreaterThan(0);
  });

  it("keeps a slide's whole travel on its own source", () => {
    const { pool, sources } = harness();
    const chain = chainOf(
      song([bar(slots([G3(), TIE, TIE, TIE, B3("slide")]))]),
    );
    const steady = buildExpressionPlan(
      song([bar(slots([note("E3", 0, 12, "accent")]))]),
    ).notes[0];
    if (!steady) throw new Error("no steady note");

    pool.play("gtr", steady, 0);
    pool.playChain(chain, 0);

    const other = sources[0];
    const sliding = sources[1];
    expect(other?.playbackRate.calls).toHaveLength(1);
    // A slide is written out as a curve, so there are many points to leak.
    expect(
      sliding?.playbackRate.calls.filter((call) => call.kind === "ramp").length,
    ).toBeGreaterThan(4);
  });

  it("refuses a track it has no samples for", () => {
    const { pool, sources } = harness();
    const chain = chainOf(song([bar(slots([G3(), B3("hammer_on")]))]));
    expect(pool.playChain({ ...chain, trackId: "bass" }, 0)).toBe(false);
    expect(sources).toHaveLength(0);
  });

  it("releases the chain once, at its end", () => {
    const { pool, sources } = harness();
    const chain = chainOf(
      song([bar(slots([G3(), B3("hammer_on"), note("G3", 1, 10, "pull_off")]))]),
    );
    pool.playChain(chain, 0);

    for (const source of sources) source.onended();

    expect(pool.counts.active).toBe(0);
    expect(sources.every((source) => source.disposed === 1)).toBe(true);
    expect(pool.counts.disposed).toBe(pool.counts.started);
  });

  it("takes the whole chain away on a stop", () => {
    const { pool, sources } = harness();
    pool.playChain(chainOf(song([bar(slots([B3(), note("G3", 1, 10, "pull_off")]))])), 0);
    expect(pool.counts.active).toBe(2);

    pool.stopAll();

    expect(pool.counts.active).toBe(0);
    expect(sources.every((source) => source.disposed === 1)).toBe(true);
  });

  it("plays nothing once the pool is closed", () => {
    const { pool } = harness();
    pool.dispose();
    expect(pool.playChain(chainOf(song([bar(slots([G3(), B3("hammer_on")]))])), 0)).toBe(
      false,
    );
  });
});
