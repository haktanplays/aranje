/**
 * One note, one recording, whichever path plays it (2V-D.2 gain parity §5–§9).
 */
import { describe, expect, it } from "vitest";

import { buildExpressionPlan, type ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import { ExpressiveVoicePool, type VoiceHost } from "@/lib/audio/expressive-voice";
import { expressionPresets } from "@/lib/audio/expression";
import { nearestSample, sampleEntries, type SampleEntry } from "@/lib/audio/sample-map";
import { samplePackFor } from "@/lib/audio/packs";
import { pitchToMidi } from "@/lib/music/pitch";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { pitchAt, settle } from "@/lib/song/edit";
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";

const PACK_IDS = [
  ["electric_guitar", "high_gain"],
  ["steel_acoustic", "finger"],
  ["electric_bass", "finger"],
] as const;

/**
 * Tone's own search, written out rather than imported.
 *
 * `Tone.Sampler._findClosest` walks outwards from the wanted note and asks
 * for `midi + interval` **before** `midi - interval`, so an equally close
 * recording above wins. This is a second, independent statement of that rule
 * — it shares no code with `nearestSample` — and the browser bench
 * (`eval/audio-parity/measure-parity.mjs`) checks both of them against a real
 * `Tone.Sampler` node, so neither can be right only by agreeing with itself.
 */
function samplerWouldPlay(entries: readonly SampleEntry[], midi: number): SampleEntry | null {
  const have = new Map(entries.map((entry) => [entry.midi, entry]));
  for (let interval = 0; interval < 96; interval += 1) {
    const above = have.get(midi + interval);
    if (above) return above;
    const below = have.get(midi - interval);
    if (below) return below;
  }
  return null;
}

describe("386. the note comes from one recording, not two", () => {
  it("gives every pack a tie to break, so this is not vacuous", () => {
    /* A pack whose recordings are all an odd number of semitones apart would
       have no midpoint and would pass the test below for free. */
    const ties = PACK_IDS.flatMap(([instrument, preset]) => {
      const pack = samplePackFor(instrument, preset);
      if (!pack) return [];
      const entries = sampleEntries(Object.keys(pack.urls));
      const found: number[] = [];
      for (let index = 0; index + 1 < entries.length; index += 1) {
        const low = entries[index]!.midi;
        const high = entries[index + 1]!.midi;
        if ((high - low) % 2 === 0) found.push(low + (high - low) / 2);
      }
      return found;
    });
    expect(ties.length).toBeGreaterThan(0);
    /* The guitar pack's two, named, because L31 was written on the first. */
    expect(ties).toContain(pitchToMidi("D3"));
    expect(ties).toContain(pitchToMidi("D4"));
  });

  it("agrees with the shared sampler on every semitone of every pack", () => {
    for (const [instrument, preset] of PACK_IDS) {
      const pack = samplePackFor(instrument, preset);
      expect(pack, `${instrument}/${preset}`).toBeDefined();
      if (!pack) continue;
      const entries = sampleEntries(Object.keys(pack.urls));
      const lowest = entries[0]!.midi;
      const highest = entries[entries.length - 1]!.midi;
      /* Past the ends too: a note below the lowest recording or above the
         highest is still a note somebody may write. */
      for (let midi = lowest - 12; midi <= highest + 12; midi += 1) {
        expect(
          nearestSample(entries, midi)?.note,
          `${pack.id} midi ${midi}`,
        ).toBe(samplerWouldPlay(entries, midi)?.note);
      }
    }
  });

  it("breaks a tie upwards whatever order the entries arrive in", () => {
    const ascending = sampleEntries(["C3", "E3"]);
    const descending = [...ascending].reverse();
    const d3 = pitchToMidi("D3") ?? 0;
    expect(nearestSample(ascending, d3)?.note).toBe("E3");
    expect(nearestSample(descending, d3)?.note).toBe("E3");
  });

  it("still takes the genuinely nearer recording when there is one", () => {
    const entries = sampleEntries(["A2", "C3", "E3", "A3"]);
    expect(nearestSample(entries, pitchToMidi("B2") ?? 0)?.note).toBe("C3");
    expect(nearestSample(entries, pitchToMidi("F3") ?? 0)?.note).toBe("E3");
    expect(nearestSample(entries, pitchToMidi("C3") ?? 0)?.note).toBe("C3");
    expect(nearestSample([], 60)).toBeNull();
  });
});

/* ------------------------------------------------- the technique matrix */

const STRING = 1;

type Written = {
  readonly note?: Partial<NoteEvent>;
  /** A second note after it, for the connections that need one. */
  readonly next?: Partial<NoteEvent>;
  /** Where the second note is, when the technique needs a direction. */
  readonly nextFret?: number;
  readonly span?: Pick<TechniqueSpan, "kind" | "startTicks" | "endTicks">;
};

/** One bar of the sample song carrying exactly what a case describes. */
function planFor(written: Written): {
  readonly song: Song;
  readonly notes: ReturnType<typeof buildExpressionPlan>["notes"];
  readonly trackId: string;
} | null {
  const track = SAMPLE_SONG.tracks.find((entry) => entry.fretboard !== undefined);
  const fretboard = track?.fretboard;
  const section = SAMPLE_SONG.sections[0];
  if (!track || !fretboard || !section) return null;
  const first = pitchAt(fretboard, STRING, 5);
  const nextFret = written.nextFret ?? 7;
  const second = pitchAt(fretboard, STRING, nextFret);
  if (first === null || second === null) return null;

  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = {
    notes: [
      { pitch: first, position: { string: STRING, fret: 5 }, ...written.note } as NoteEvent,
    ],
  };
  if (written.next) {
    /* Adjacent, because a connection joins *this* note to the one before it:
       a gap means "no previous note" and the chain never forms. */
    lane[1] = {
      notes: [
        {
          pitch: second,
          position: { string: STRING, fret: nextFret },
          ...written.next,
        } as NoteEvent,
      ],
    };
  }
  const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
  for (const entry of SAMPLE_SONG.tracks) {
    const existing = section.bars[0]?.slots[entry.id];
    slots[entry.id] =
      existing && isDrumSlotArray(existing)
        ? Array.from({ length: 8 }, () => [] as DrumSlot)
        : Array.from({ length: 8 }, () => null as MelodicSlot);
  }
  slots[track.id] = lane;

  const bar: Bar = { timeSignature: [4, 4], resolution: 8, slots };
  const staged = settle({
    ...SAMPLE_SONG,
    sections: [
      {
        ...section,
        bars: [bar],
        /* Spans belong to the section, in ticks from its start, because a
           hand position does not stop at a bar line. */
        ...(written.span
          ? {
              techniqueSpans: [
                {
                  id: "span-1",
                  trackId: track.id,
                  stringIndices: [STRING],
                  ...written.span,
                } satisfies TechniqueSpan,
              ],
            }
          : {}),
      },
    ],
  });
  if (!staged.ok) return null;
  const plan = buildExpressionPlan(staged.song);
  return {
    song: staged.song,
    notes: plan.notes
      .filter((note) => note.trackId === track.id)
      .sort((a, b) => a.timeTicks - b.timeTicks),
    trackId: track.id,
  };
}

/**
 * Every technique the app can write, and which path plays it.
 *
 * `reaches` is what makes each row non-vacuous: it asserts the technique
 * actually arrived in the plan. A row whose technique silently fell out on
 * the way would otherwise "pass" by describing a plain note.
 */
const MATRIX: readonly {
  readonly name: string;
  readonly written: Written;
  readonly index: number;
  readonly expressive: boolean;
  readonly reaches: (
    note: NonNullable<ReturnType<typeof planFor>>["notes"][number],
  ) => boolean;
}[] = [
  {
    name: "normal",
    written: {},
    index: 0,
    expressive: false,
    reaches: (note) =>
      note.gainEnvelope.length === 0 &&
      note.pitchAutomation.every((point) => point.cents === 0),
  },
  {
    name: "accent",
    written: { note: { attack: "accent" } },
    index: 0,
    expressive: true,
    reaches: (note) =>
      note.gainEnvelope.some(
        (point) =>
          Math.abs(point.value - note.gain * expressionPresets.accent.gainMultiplier) < 1e-6,
      ),
  },
  {
    name: "ghost",
    written: { note: { attack: "ghost" } },
    index: 0,
    expressive: true,
    reaches: (note) =>
      note.gainEnvelope.some(
        (point) =>
          Math.abs(point.value - note.gain * expressionPresets.ghost.gainMultiplier) < 1e-6,
      ),
  },
  {
    name: "dead note",
    written: { note: { attack: "dead" } },
    index: 0,
    expressive: true,
    reaches: (note) => note.filterPreset === "dead",
  },
  {
    name: "tapping",
    written: { note: { attack: "tapping" } },
    index: 0,
    expressive: true,
    reaches: (note) =>
      note.gainEnvelope.some(
        (point) =>
          Math.abs(point.value - note.gain * expressionPresets.tapping.gainMultiplier) < 1e-6,
      ),
  },
  {
    name: "natural harmonic",
    written: { note: { attack: "natural_harmonic" } },
    index: 0,
    expressive: true,
    reaches: (note) =>
      note.gainEnvelope.some(
        (point) =>
          Math.abs(point.value - note.gain * expressionPresets.harmonic.naturalGain) < 1e-6,
      ),
  },
  {
    name: "pinch harmonic",
    written: { note: { attack: "pinch_harmonic" } },
    index: 0,
    expressive: true,
    reaches: (note) =>
      note.gainEnvelope.some(
        (point) =>
          Math.abs(point.value - note.gain * expressionPresets.harmonic.pinchGain) < 1e-6,
      ),
  },
  {
    name: "vibrato",
    written: { note: { articulation: "vibrato" } },
    index: 0,
    expressive: true,
    reaches: (note) => note.pitchAutomation.length > 2,
  },
  {
    name: "bend",
    written: { note: { pitchGesture: { kind: "bend", targetCents: 200 } } },
    index: 0,
    expressive: true,
    reaches: (note) => note.pitchAutomation.some((point) => point.cents >= 199),
  },
  {
    name: "bend release",
    written: { note: { pitchGesture: { kind: "bend_release", targetCents: 200 } } },
    index: 0,
    expressive: true,
    reaches: (note) => {
      const top = Math.max(...note.pitchAutomation.map((point) => point.cents));
      const last = note.pitchAutomation[note.pitchAutomation.length - 1]?.cents ?? 0;
      return top >= 199 && last < 1;
    },
  },
  {
    name: "pre-bend",
    written: { note: { pitchGesture: { kind: "prebend", targetCents: 200 } } },
    index: 0,
    expressive: true,
    reaches: (note) => (note.pitchAutomation[0]?.cents ?? 0) >= 199,
  },
  {
    name: "slide in",
    written: { note: { pitchGesture: { kind: "slide_in", from: "below" } } },
    index: 0,
    expressive: true,
    reaches: (note) => (note.pitchAutomation[0]?.cents ?? 0) < 0,
  },
  {
    name: "slide out",
    written: { note: { pitchGesture: { kind: "slide_out", to: "down" } } },
    index: 0,
    expressive: true,
    reaches: (note) =>
      (note.pitchAutomation[note.pitchAutomation.length - 1]?.cents ?? 0) < 0,
  },
  {
    name: "legato slide",
    written: { next: { connection: { kind: "legato_slide" } } },
    index: 1,
    expressive: true,
    reaches: (note) => note.chainRole === "target",
  },
  {
    name: "shift slide",
    written: { next: { connection: { kind: "shift_slide" } } },
    index: 1,
    expressive: true,
    reaches: (note) => note.pitchAutomation.length > 0 || note.chainId !== undefined,
  },
  {
    name: "hammer-on",
    written: { next: { connection: { kind: "hammer_on" } } },
    index: 1,
    expressive: true,
    reaches: (note) => note.chainRole === "target",
  },
  {
    name: "pull-off",
    /* Downwards, because that is what a pull-off is: the finger comes off a
       higher fret and leaves a lower one sounding. */
    written: { nextFret: 3, next: { connection: { kind: "pull_off" } } },
    index: 1,
    expressive: true,
    reaches: (note) => note.chainRole === "target",
  },
  {
    name: "palm mute span",
    written: { span: { kind: "palm_mute", startTicks: 0, endTicks: 192 } },
    index: 0,
    expressive: true,
    reaches: (note) => note.filterPreset === "palm_mute",
  },
  {
    name: "palm mute + accent",
    written: {
      note: { attack: "accent" },
      span: { kind: "palm_mute", startTicks: 0, endTicks: 192 },
    },
    index: 0,
    expressive: true,
    reaches: (note) => note.filterPreset === "palm_mute" && note.gainEnvelope.length > 0,
  },
  {
    name: "harmonic + bend + vibrato",
    written: {
      note: {
        attack: "natural_harmonic",
        pitchGesture: {
          kind: "bend",
          targetCents: 200,
          vibrato: { startAfterTarget: true, depthCents: 25, rateHz: 5 },
        },
      },
    },
    index: 0,
    expressive: true,
    reaches: (note) =>
      note.pitchAutomation.some((point) => point.cents >= 199) &&
      note.gainEnvelope.length > 0,
  },
];

describe("387. which path each technique is played on", () => {
  it("covers every technique the app can write", () => {
    expect(MATRIX).toHaveLength(20);
    expect(new Set(MATRIX.map((row) => row.name)).size).toBe(MATRIX.length);
  });

  for (const row of MATRIX) {
    it(`plays ${row.name} on the ${row.expressive ? "expressive" : "shared"} path`, () => {
      const planned = planFor(row.written);
      expect(planned, "the fixture did not build").not.toBeNull();
      if (!planned) return;
      const note = planned.notes[row.index];
      expect(note, `no note at index ${row.index}`).toBeDefined();
      if (!note) return;
      /* Non-vacuity first: the technique has to be in the plan before its
         path means anything. */
      expect(row.reaches(note), `${row.name} never reached the plan`).toBe(true);
      expect(note.expressive).toBe(row.expressive);
    });
  }

  it("has exactly one technique on the shared path, and it is the plain note", () => {
    const shared = MATRIX.filter((row) => !row.expressive);
    expect(shared.map((row) => row.name)).toEqual(["normal"]);
  });
});

describe("388. accent above plain above ghost, in the plan", () => {
  const planned = planFor({});
  const accented = planFor({ note: { attack: "accent" } });
  const ghosted = planFor({ note: { attack: "ghost" } });

  it("leaves the plain note's own gain alone on all three", () => {
    /* The presets scale the envelope; none of them may quietly move the note's
       nominal gain, or "x1.18 of what" stops having an answer. */
    expect(accented?.notes[0]?.gain).toBe(planned?.notes[0]?.gain);
    expect(ghosted?.notes[0]?.gain).toBe(planned?.notes[0]?.gain);
  });

  it("orders the three the way a guitarist would expect", () => {
    const base = planned?.notes[0]?.gain ?? 0;
    const accentPeak = Math.max(
      ...(accented?.notes[0]?.gainEnvelope ?? []).map((point) => point.value),
    );
    const ghostPeak = Math.max(
      ...(ghosted?.notes[0]?.gainEnvelope ?? []).map((point) => point.value),
    );
    expect(base).toBeGreaterThan(0);
    expect(accentPeak).toBeGreaterThan(base);
    expect(base).toBeGreaterThan(ghostPeak);
  });

  it("keeps the declared ratios rather than a taste", () => {
    const base = planned?.notes[0]?.gain ?? 0;
    const accentPeak = Math.max(
      ...(accented?.notes[0]?.gainEnvelope ?? []).map((point) => point.value),
    );
    const ghostPeak = Math.max(
      ...(ghosted?.notes[0]?.gainEnvelope ?? []).map((point) => point.value),
    );
    expect(accentPeak / base).toBeCloseTo(expressionPresets.accent.gainMultiplier, 4);
    expect(ghostPeak / base).toBeCloseTo(expressionPresets.ghost.gainMultiplier, 4);
    expect(accentPeak / ghostPeak).toBeCloseTo(
      expressionPresets.accent.gainMultiplier / expressionPresets.ghost.gainMultiplier,
      3,
    );
  });
});

/* --------------------------------------- one output, one edge, no leftovers */

type Edge = { readonly from: string; readonly to: unknown };

/**
 * A Tone that remembers what was wired to what.
 *
 * The pool's own tests fake the nodes to watch *automation*; this one watches
 * *connections*, because "the expressive voice is louder" would also be the
 * symptom of a voice reaching the bus twice, and no test in the app could
 * have told the difference.
 */
function wiringTone() {
  const edges: Edge[] = [];
  const disposals: string[] = [];
  const param = () => ({
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  let serial = 0;
  const make = (kind: string) =>
    class {
      readonly name = `${kind}#${(serial += 1)}`;
      gain = param();
      playbackRate = param();
      started = false;
      onended: () => void = () => {};
      connect(node: unknown) {
        edges.push({ from: this.name, to: node });
      }
      start() {
        this.started = true;
      }
      stop() {}
      dispose() {
        disposals.push(this.name);
      }
    };
  return {
    tone: { Gain: make("gain"), Filter: make("filter"), ToneBufferSource: make("src") },
    edges,
    disposals,
  };
}

function wiringHarness() {
  const { tone, edges, disposals } = wiringTone();
  const destination = { bus: "track" };
  const host: VoiceHost = {
    buffers: {
      has: () => true,
      get: (name: string) => ({ name }),
    } as unknown as VoiceHost["buffers"],
    entries: sampleEntries(["E2", "A2", "C3", "E3", "A3", "C4", "E4"]),
    destination: destination as unknown as VoiceHost["destination"],
    trimGain: 1,
  };
  const pool = new ExpressiveVoicePool(
    tone as never,
    { isOffline: false } as never,
    new Map([["gtr", host]]),
  );
  return { pool, edges, disposals, destination };
}

function onePlan(over: Partial<ExpressiveNotePlan> = {}): ExpressiveNotePlan {
  return {
    id: "gtr:0:1:E3",
    trackId: "gtr",
    pitch: "E3",
    startSeconds: 0,
    durationSeconds: 0.5,
    timeTicks: 0,
    durationTicks: 96,
    velocity: 96,
    gain: 0.75,
    pitchAutomation: [],
    gainEnvelope: [],
    expressive: true,
    barKey: "b:0",
    slotIndex: 0,
    ...over,
  };
}

describe("389. one voice, one edge into the track bus", () => {
  it("reaches the bus exactly once, through exactly one gain", () => {
    const { pool, edges, destination } = wiringHarness();
    expect(pool.play("gtr", onePlan(), 0)).toBe(true);
    const intoBus = edges.filter((edge) => edge.to === destination);
    expect(intoBus).toHaveLength(1);
    expect(intoBus[0]?.from.startsWith("gain#")).toBe(true);
    /* And the source reaches that gain rather than the bus. */
    expect(edges.filter((edge) => edge.from.startsWith("src#"))).toHaveLength(1);
    expect(edges.find((edge) => edge.from.startsWith("src#"))?.to).not.toBe(destination);
  });

  it("puts a filter in the chain without adding a second path to the bus", () => {
    const { pool, edges, destination } = wiringHarness();
    expect(pool.play("gtr", onePlan({ filterPreset: "palm_mute" }), 0)).toBe(true);
    expect(edges.filter((edge) => edge.to === destination)).toHaveLength(1);
    /* source -> filter -> gain -> bus: three edges, no dry copy beside them. */
    expect(edges).toHaveLength(3);
  });

  it("does not accumulate connections when the same note plays again and again", () => {
    const { pool, edges, destination } = wiringHarness();
    for (let index = 0; index < 20; index += 1) {
      pool.play("gtr", onePlan({ id: `gtr:${index}` }), index * 0.5);
    }
    /* One per voice, not one more each time. */
    expect(edges.filter((edge) => edge.to === destination)).toHaveLength(20);
    expect(pool.counts.started).toBe(20);
  });

  it("ends with nothing active and everything freed", () => {
    const { pool, disposals } = wiringHarness();
    for (let index = 0; index < 5; index += 1) {
      pool.play("gtr", onePlan({ id: `gtr:${index}` }), index * 0.5);
    }
    expect(pool.counts.active).toBe(5);
    pool.stopAll();
    expect(pool.counts.active).toBe(0);
    /* Each voice frees its source and its gain, once each. */
    expect(disposals).toHaveLength(10);
    expect(new Set(disposals).size).toBe(disposals.length);
  });

  it("gives a new pool none of the old one's voices", () => {
    const first = wiringHarness();
    first.pool.play("gtr", onePlan(), 0);
    expect(first.pool.counts.active).toBe(1);
    const second = wiringHarness();
    expect(second.pool.counts.active).toBe(0);
    expect(second.pool.counts.started).toBe(0);
  });

  it("plays nothing, and wires nothing, once it is closed", () => {
    const { pool, edges } = wiringHarness();
    pool.dispose();
    expect(pool.play("gtr", onePlan(), 0)).toBe(false);
    expect(edges).toHaveLength(0);
    expect(pool.counts.active).toBe(0);
  });
});
