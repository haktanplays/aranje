/**
 * What the real scheduler places when it is given a window (2V-A §3, §7, §8).
 *
 * Not a second scheduler and not a mock of one: `scheduleSong` itself, run
 * against an injected fake transport, exactly as `playback.test.ts` runs it.
 * The claim is that bounding it changes *which* events are placed and nothing
 * else — same plan, same chains, same expression, same strum offsets.
 */
import { describe, expect, it } from "vitest";

import { scheduleSong, type Engine } from "@/lib/audio/engine";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildTempoMap } from "@/lib/audio/tempo";
import {
  drumTrack,
  guitarTrack,
  restSlots,
  section,
  silentDrumSlots,
  song as makeSong,
} from "@/lib/song/fixtures";
import {
  bar as legatoBar,
  note as legatoNote,
  slots as legatoSlots,
  song as legatoSong,
} from "@/test/expression-fixtures";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const GTR = "gtr";
const BASS = "bass";
const DRUMS = "drums";
const BAR = 768;
const SLOT = 48;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

function trio(): Song {
  const line = (): MelodicSlot[] => {
    const slots = restSlots(16);
    slots[0] = note("E2", 0, 0);
    slots[4] = note("G3", 3, 0);
    slots[8] = note("A3", 3, 2);
    slots[12] = note("B3", 4, 0);
    return slots;
  };
  const beats = silentDrumSlots(16);
  beats[0] = [{ piece: "kick" }];
  beats[8] = [{ piece: "snare" }];
  const bar: Bar = {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: line(), [BASS]: line(), [DRUMS]: beats },
  };
  return makeSong(
    [
      guitarTrack({ id: GTR }),
      guitarTrack({ id: BASS, name: "Bas" }),
      drumTrack({ id: DRUMS }),
    ],
    [section([bar, bar], { id: "s1" })],
  );
}

type Placed = { time: number; run: (at: number) => void };

/** Just enough transport for the real scheduler, recording what it places. */
function bench(source: Song) {
  const placed: Placed[] = [];
  const struck: { trackId: string; pitch: string; duration: string }[] = [];
  const drumHits: string[] = [];
  const clicks: number[] = [];

  const transport = {
    ticks: 0,
    PPQ: 192,
    bpm: {
      value: 0,
      setValueAtTime: () => {},
      cancelScheduledValues: () => {},
    },
    loop: false,
    loopStart: "",
    loopEnd: "",
    cancel: () => placed.splice(0, placed.length),
    schedule: (run: (at: number) => void, at: string) => {
      placed.push({ time: Number(String(at).replace("i", "")), run });
      return placed.length;
    },
    on: () => {},
  };

  const voiceFor = (trackId: string) => ({
    kind: "sampler" as const,
    trackId,
    sampler: {
      triggerAttackRelease: (pitch: string, duration: string) =>
        struck.push({ trackId, pitch, duration }),
    },
  });

  const engine = {
    context: { transport, draw: { schedule: (run: () => void) => run() } },
    voices: new Map<string, unknown>([
      [GTR, voiceFor(GTR)],
      [BASS, voiceFor(BASS)],
      [
        DRUMS,
        {
          kind: "drums",
          trackId: DRUMS,
          drums: {
            kick: { triggerAttackRelease: () => drumHits.push("kick") },
            snare: { triggerAttackRelease: () => drumHits.push("snare") },
            hat: { triggerAttackRelease: () => drumHits.push("hat") },
            cymbal: { triggerAttackRelease: () => drumHits.push("cymbal") },
            filters: [],
          },
        },
      ],
    ]),
    metronome: {
      click: { triggerAttackRelease: () => clicks.push(1) },
      filter: {},
    },
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

  return { engine, placed, struck, drumHits, clicks, transport };
}

/** Fire everything the scheduler placed, as a transport reaching each tick. */
const fireAll = (placed: readonly Placed[]) => {
  for (const entry of placed) entry.run(0);
};

const window = (
  startTicks: number,
  endTicks: number,
  trackIds: readonly string[],
) => ({ startTicks, endTicks, trackIds });

describe("scheduling a bounded, filtered run", () => {
  it("places nothing for a track the selection did not name", () => {
    const source = trio();
    const only = bench(source);
    scheduleSong(only.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
    });
    fireAll(only.placed);

    expect(only.struck.length).toBeGreaterThan(0);
    expect(new Set(only.struck.map((hit) => hit.trackId))).toEqual(
      new Set([GTR]),
    );
    /* Not merely silent: the drums were never given a callback at all. */
    expect(only.drumHits).toEqual([]);
  });

  it("places nothing for an onset outside the selected ticks", () => {
    const source = trio();
    const first = bench(source);
    scheduleSong(first.engine, buildTempoMap(source), {
      window: window(0, 8 * SLOT, [GTR]),
    });
    fireAll(first.placed);
    expect(first.struck.map((hit) => hit.pitch)).toEqual(["E2", "G3"]);
  });

  it("schedules the whole song when no window is given", () => {
    const source = trio();
    const all = bench(source);
    scheduleSong(all.engine, buildTempoMap(source));
    fireAll(all.placed);
    expect(new Set(all.struck.map((hit) => hit.trackId))).toEqual(
      new Set([GTR, BASS]),
    );
    expect(all.drumHits.length).toBeGreaterThan(0);
  });

  it("reports the selection's end as the end, not the song's", () => {
    const source = trio();
    const cut = bench(source);
    const total = scheduleSong(cut.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
    });
    expect(total).toBe(BAR);

    const whole = bench(source);
    expect(scheduleSong(whole.engine, buildTempoMap(source))).toBe(2 * BAR);
  });

  it("says it has ended at the selection's end", () => {
    const source = trio();
    const cut = bench(source);
    let ended = 0;
    scheduleSong(cut.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
      onEnded: () => {
        ended += 1;
      },
    });
    const last = cut.placed.filter((entry) => entry.time === BAR);
    expect(last.length).toBeGreaterThan(0);
    fireAll(cut.placed);
    expect(ended).toBe(1);
  });

  it("cuts a tail at the boundary and leaves the rest alone", () => {
    /*
     * A note tied across four slots, auditioned inside one. Unwindowed it
     * sounds for its whole written length; windowed it stops at the boundary
     * — and the Song still says four slots, because the cut is in this
     * playing and nowhere else.
     */
    const held = restSlots(16);
    held[0] = note("E2", 0, 0);
    held[1] = "-";
    held[2] = "-";
    held[3] = "-";
    const source = makeSong(
      [guitarTrack({ id: GTR })],
      [
        section(
          [{ timeSignature: [4, 4], resolution: 16, slots: { [GTR]: held } }],
          { id: "s1" },
        ),
      ],
    );

    const whole = bench(source);
    scheduleSong(whole.engine, buildTempoMap(source));
    fireAll(whole.placed);
    const unclipped = Number(whole.struck[0]?.duration.replace("i", ""));
    expect(unclipped).toBeGreaterThan(SLOT);

    const cut = bench(source);
    scheduleSong(cut.engine, buildTempoMap(source), {
      window: window(0, SLOT, [GTR]),
    });
    fireAll(cut.placed);
    expect(cut.struck).toHaveLength(1);
    expect(Number(cut.struck[0]?.duration.replace("i", ""))).toBe(SLOT);
  });

  it("keeps the metronome inside the selection too", () => {
    const source = trio();
    const cut = bench(source);
    scheduleSong(cut.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
      metronomeEnabled: () => true,
    });
    fireAll(cut.placed);
    const inOneBar = cut.clicks.length;

    const whole = bench(source);
    scheduleSong(whole.engine, buildTempoMap(source), {
      metronomeEnabled: () => true,
    });
    fireAll(whole.placed);
    expect(inOneBar).toBeGreaterThan(0);
    expect(inOneBar).toBeLessThan(whole.clicks.length);
  });

  it("still asks the reader's metronome preference at click time", () => {
    const source = trio();
    const cut = bench(source);
    scheduleSong(cut.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
      metronomeEnabled: () => false,
    });
    fireAll(cut.placed);
    expect(cut.clicks).toEqual([]);
  });
});

describe("the techniques keep the path they already had", () => {
  /**
   * A hammer-on is a legato chain: one struck note carrying a second. §3 says
   * the selection must use the ordinary expression plan rather than a plainer
   * preview, so what is checked is that the chain is still scheduled *as a
   * chain* — a window that dropped chains and struck their notes separately
   * would sound like two picked notes and pass any test that only counted
   * attacks.
   */
  const hammered = (): Song =>
    legatoSong([
      legatoBar(
        legatoSlots([
          legatoNote("G3", 1, 10),
          legatoNote("B3", 1, 14, "hammer_on"),
        ]),
      ),
    ]);

  const chainsIn = (source: Song) => buildExpressionPlan(source).chains;

  it("has a chain to preserve in the first place", () => {
    expect(chainsIn(hammered()).length).toBeGreaterThan(0);
  });

  it("plays the chain through the expression runtime, not as bare notes", () => {
    const source = hammered();
    const seen: string[] = [];
    const rig = bench(source);
    const engine = rig.engine as unknown as {
      expression: { playChain: (chain: { chainId: string }) => boolean };
    };
    engine.expression.playChain = (chain) => {
      seen.push(chain.chainId);
      return true;
    };

    scheduleSong(rig.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
    });
    fireAll(rig.placed);
    expect(seen).toEqual(chainsIn(source).map((chain) => chain.chainId));
  });

  it("drops a chain that begins outside the selection", () => {
    const source = hammered();
    const seen: string[] = [];
    const rig = bench(source);
    const engine = rig.engine as unknown as {
      expression: { playChain: (chain: { chainId: string }) => boolean };
    };
    engine.expression.playChain = (chain) => {
      seen.push(chain.chainId);
      return true;
    };

    /* From halfway through the bar: the chain is struck before that. */
    scheduleSong(rig.engine, buildTempoMap(source), {
      window: window(BAR / 2, BAR, [GTR]),
    });
    fireAll(rig.placed);
    expect(seen).toEqual([]);
  });

  it("hands the expressive note its own plan, strum offset included", () => {
    /*
     * The window filters; it never rewrites. So whatever the expression plan
     * says about a note — expressive or not, strummed or not — is what the
     * scheduler still reads at trigger time.
     */
    const source = trio();
    const rig = bench(source);
    const played: { pitch: string; strum: number | undefined }[] = [];
    const engine = rig.engine as unknown as {
      expression: {
        play: (note: {
          pitch: string;
          strumOffsetSeconds?: number;
        }) => boolean;
      };
    };
    engine.expression.play = (entry) => {
      played.push({ pitch: entry.pitch, strum: entry.strumOffsetSeconds });
      return true;
    };

    scheduleSong(rig.engine, buildTempoMap(source), {
      window: window(0, BAR, [GTR]),
    });
    fireAll(rig.placed);

    const planned = buildExpressionPlan(source).notes.filter(
      (entry) =>
        entry.trackId === GTR && entry.timeTicks < BAR && entry.expressive,
    );
    expect(played.map((entry) => entry.pitch)).toEqual(
      planned.map((entry) => entry.pitch),
    );
    for (const entry of played) {
      const match = planned.find((item) => item.pitch === entry.pitch);
      expect(entry.strum).toBe(match?.strumOffsetSeconds);
    }
  });
});
