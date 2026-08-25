/**
 * The legato brush: one gesture, one decision, all or nothing (2S-A §8).
 */
import { describe, expect, it } from "vitest";

import {
  BRUSH_MESSAGES,
  applyBrush,
  brushMessage,
  planBrush,
  type BrushRefusal,
  type BrushRequest,
  type LegatoChoice,
} from "@/lib/song/legato-brush";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { ticksPerSlot } from "@/lib/music/timing";
import {
  songSchema,
  type Articulation,
  type MelodicSlot,
  type Song,
} from "@/lib/song/schema";

const SLOT = ticksPerSlot(8);
const E_STANDARD = [...TUNING_PRESETS.e_standard!.tuning];

const note = (
  pitch: string,
  fret: number,
  articulation?: Articulation,
  string = 2,
): MelodicSlot => ({
  notes: [
    {
      pitch,
      position: { string, fret },
      ...(articulation === undefined ? {} : { articulation }),
    },
  ],
});

function songOf(slots: readonly MelodicSlot[]): Song {
  const lane = Array.from({ length: 8 }, (_, index) => slots[index] ?? null);
  return songSchema.parse({
    version: 2,
    title: "brush",
    bpm: 120,
    key: "E minor",
    tracks: [
      {
        id: "gtr",
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "high_gain",
        volumeDb: -6,
        fretboard: { tuning: E_STANDARD, capo: 0 },
      },
    ],
    sections: [
      {
        id: "s1",
        name: "S1",
        status: "fixed",
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { gtr: lane } }],
      },
    ],
  });
}

/** Five notes on the third string: rising, rising, falling, falling. */
const RUN: readonly MelodicSlot[] = [
  note("G3", 5),
  note("A3", 7),
  note("A#3", 8),
  note("A3", 7),
  note("G3", 5),
];

const request = (
  song: Song,
  choice: LegatoChoice = "auto",
  extra: Partial<BrushRequest> = {},
): BrushRequest => ({
  song,
  trackId: "gtr",
  sectionId: "s1",
  fromTicks: 0,
  toTicks: SLOT * 4,
  choice,
  ...extra,
});

const articulations = (song: Song) =>
  song.sections[0]!.bars[0]!.slots.gtr!.map((slot) =>
    slot && slot !== "-" && !Array.isArray(slot)
      ? (slot.notes[0]?.articulation ?? null)
      : null,
  );

describe("309. auto reads the sounding pitch, not the fret number", () => {
  it("joins a rising pair with a hammer-on and a falling pair with a pull-off", () => {
    const result = applyBrush(request(songOf(RUN)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(articulations(result.song).slice(0, 5)).toEqual([
      null,
      "hammer_on",
      "hammer_on",
      "pull_off",
      "pull_off",
    ]);
  });

  it("writes the slur on the note it lands on, never on the one it leaves", () => {
    const plan = planBrush(request(songOf(RUN)));
    if (plan.kind !== "ready") throw new Error(plan.reason);
    for (const link of plan.links) {
      expect(link.onset.startTicks).toBeGreaterThan(link.from.startTicks);
    }
  });

  it("refuses two notes of the same pitch by name", () => {
    const same = songOf([note("G3", 5), note("G3", 5)]);
    const plan = planBrush(request(same));
    expect(plan).toEqual({ kind: "refused", reason: "same_pitch" });
  });

  it("follows the sounding pitch when the written fret disagrees with it", () => {
    /*
     * The contract carries a pitch and a placement, and nothing forces them to
     * agree — an imported song, or one written by a tool that got the tuning
     * wrong, can say `A3` on the 5th fret and `G3` on the 7th. §8 says the
     * direction comes from the **sounding pitch**, so the brush hears a fall
     * here even though the fret numbers climb.
     */
    const disagreeing = songOf([note("A3", 5), note("G3", 7)]);
    const plan = planBrush(request(disagreeing));
    expect(plan.kind).toBe("ready");
    expect(plan.kind === "ready" ? plan.links.map((link) => link.kind) : []).toEqual([
      "pull_off",
    ]);
  });

  it("reads the pitch even where the fret number points the other way", () => {
    // Same fret, different strings: the pitch is what decides. The brush only
    // works on one string, so this is refused for that reason rather than
    // being quietly read off the fret.
    const crossed = songOf([note("G3", 5, undefined, 2), note("C4", 5, undefined, 1)]);
    expect(planBrush(request(crossed))).toEqual({
      kind: "refused",
      reason: "not_one_string",
    });
  });
});

describe("310. an explicit choice is never silently turned into the other one", () => {
  it("refuses a hammer-on that would go down", () => {
    const falling = songOf([note("A3", 7), note("G3", 5)]);
    expect(planBrush(request(falling, "hammer_on"))).toEqual({
      kind: "refused",
      reason: "wrong_direction",
    });
  });

  it("refuses a pull-off that would go up", () => {
    const rising = songOf([note("G3", 5), note("A3", 7)]);
    expect(planBrush(request(rising, "pull_off"))).toEqual({
      kind: "refused",
      reason: "wrong_direction",
    });
  });

  it("writes an explicit choice where it does fit", () => {
    const rising = songOf([note("G3", 5), note("A3", 7), note("A#3", 8)]);
    const result = applyBrush(request(rising, "hammer_on"));
    if (!result.ok) throw new Error(result.reason);
    expect(articulations(result.song).slice(0, 3)).toEqual([
      null,
      "hammer_on",
      "hammer_on",
    ]);
  });
});

describe("311. what the brush refuses, and why", () => {
  const refusals: readonly [string, Song, BrushRefusal][] = [
    ["a single note", songOf([note("G3", 5)]), "needs_two_notes"],
    [
      "a chord in the run",
      songOf([
        note("G3", 5),
        { notes: [{ pitch: "A3", position: { string: 2, fret: 7 } }, { pitch: "E4" }] },
      ]),
      "chord_in_run",
    ],
    [
      "a note with no placement",
      songOf([note("G3", 5), { notes: [{ pitch: "A3" }] }]),
      "unplaced_note",
    ],
  ];

  for (const [what, song, reason] of refusals) {
    it(`refuses ${what} with "${reason}"`, () => {
      expect(planBrush(request(song))).toEqual({ kind: "refused", reason });
    });
  }

  it("refuses a tie continuation inside the run", () => {
    const song = songOf(RUN);
    const lane = song.sections[0]!.bars[0]!.slots.gtr! as MelodicSlot[];
    lane[2] = "-";
    expect(planBrush(request(song))).toEqual({
      kind: "refused",
      reason: "tie_inside_run",
    });
  });

  it("refuses a rest inside the run", () => {
    const song = songOf(RUN);
    const lane = song.sections[0]!.bars[0]!.slots.gtr! as MelodicSlot[];
    lane[2] = null;
    expect(planBrush(request(song))).toEqual({
      kind: "refused",
      reason: "rest_inside_run",
    });
  });

  it("fails closed on a slur that is already there", () => {
    const linked = songOf([note("G3", 5), note("A3", 7, "hammer_on"), note("A#3", 8)]);
    expect(planBrush(request(linked))).toEqual({
      kind: "refused",
      reason: "already_linked",
    });
  });

  it("rewrites an existing slur only when the reader said so", () => {
    const linked = songOf([note("G3", 5), note("A3", 7, "slide"), note("A#3", 8)]);
    const result = applyBrush(request(linked, "auto", { overrideExisting: true }));
    if (!result.ok) throw new Error(result.reason);
    expect(articulations(result.song).slice(0, 3)).toEqual([
      null,
      "hammer_on",
      "hammer_on",
    ]);
  });

  it("says every refusal in music, never in an identifier", () => {
    const codes = Object.keys(BRUSH_MESSAGES) as BrushRefusal[];
    for (const code of codes) {
      const message = brushMessage(code);
      expect(message, code).toBeTruthy();
      expect(message).not.toMatch(/hammer_on|pull_off|tick|slot|_|undefined/);
    }
  });
});

describe("312. all of it or none of it", () => {
  it("writes nothing when one link of five is bad", () => {
    const broken = songOf([
      note("G3", 5),
      note("A3", 7),
      note("A3", 7),
      note("A#3", 8),
      note("G3", 5),
    ]);
    const before = JSON.stringify(broken);
    const result = applyBrush(request(broken));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(broken)).toBe(before);
  });

  it("never touches the song it was handed", () => {
    const song = songOf(RUN);
    const before = JSON.stringify(song);
    applyBrush(request(song));
    expect(JSON.stringify(song)).toBe(before);
  });

  it("gives the same bytes five times running", () => {
    const runs = Array.from({ length: 5 }, () => applyBrush(request(songOf(RUN))));
    const first = runs[0];
    if (!first?.ok) throw new Error("refused");
    for (const run of runs) {
      expect(run.ok).toBe(true);
      if (run.ok) expect(JSON.stringify(run.song)).toBe(JSON.stringify(first.song));
    }
  });

  it("adds no field to a note that was not slurred", () => {
    const result = applyBrush(request(songOf(RUN)));
    if (!result.ok) throw new Error(result.reason);
    const first = result.song.sections[0]!.bars[0]!.slots.gtr![0];
    expect(first).toEqual({
      notes: [{ pitch: "G3", position: { string: 2, fret: 5 } }],
    });
  });

  it("keeps everything else about a slurred note exactly as it was", () => {
    const withVelocity = songOf([
      { notes: [{ pitch: "G3", position: { string: 2, fret: 5 }, velocity: 40 }] },
      { notes: [{ pitch: "A3", position: { string: 2, fret: 7 }, velocity: 41 }] },
    ]);
    const result = applyBrush(request(withVelocity));
    if (!result.ok) throw new Error(result.reason);
    const second = result.song.sections[0]!.bars[0]!.slots.gtr![1];
    expect(second).toEqual({
      notes: [
        {
          pitch: "A3",
          position: { string: 2, fret: 7 },
          velocity: 41,
          articulation: "hammer_on",
        },
      ],
    });
  });

  it("covers exactly the onsets the gesture reached, and no more", () => {
    const plan = planBrush(
      request(songOf(RUN), "auto", { fromTicks: SLOT, toTicks: SLOT * 3 }),
    );
    if (plan.kind !== "ready") throw new Error(plan.reason);
    expect(plan.onsets.map((onset) => onset.slotIndex)).toEqual([1, 2, 3]);
    expect(plan.links).toHaveLength(2);
  });

  it("reads the gesture the same way whichever end it started from", () => {
    const forward = planBrush(request(songOf(RUN), "auto", { fromTicks: 0, toTicks: SLOT * 2 }));
    const backward = planBrush(request(songOf(RUN), "auto", { fromTicks: SLOT * 2, toTicks: 0 }));
    expect(backward).toEqual(forward);
  });
});
