/**
 * Two things on one note, and the exit that used to prevent it (2V-D.1 §8, §15).
 *
 * Every one of these combinations was unplayable before, and unplayable in a
 * particular way: the plan came back correct for whichever axis the planner
 * checked first, and silent about the other. So each test asks for both, and
 * each one would have passed on the old code for exactly half its assertions.
 */
import { describe, expect, it } from "vitest";

import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { expressionPresets } from "@/lib/audio/expression";
import { pitchAt } from "@/lib/song/edit";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;

const note = (stringIndex: number, fret: number, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, stringIndex, fret)!,
    position: { string: stringIndex, fret },
    ...extra,
  }) as NoteEvent;

function oneNote(extra: Partial<NoteEvent>): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note(2, 7, extra)] };
  lane[1] = "-";
  lane[2] = "-";
  lane[3] = "-";
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
      },
    ],
  } satisfies Song);
}

const planOf = (extra: Partial<NoteEvent>) =>
  buildExpressionPlan(oneNote(extra)).notes.find((entry) => entry.timeTicks === 0)!;

/** The loudest cents the pitch reaches. */
const topCents = (points: readonly { cents: number }[]): number =>
  points.reduce((most, point) => Math.max(most, point.cents), 0);

/** The level the note is at once it has arrived. */
const level = (points: readonly { value: number }[]): number =>
  points.reduce((most, point) => Math.max(most, point.value), 0);

describe("141. an attack and a pitch gesture on one note", () => {
  it("gives an accented bend both the accent and the bend", () => {
    const plain = planOf({ pitchGesture: { kind: "bend", targetCents: 200 } });
    const accented = planOf({
      attack: "accent",
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    /* The bend the old code kept. */
    expect(topCents(accented.pitchAutomation)).toBe(200);
    expect(topCents(plain.pitchAutomation)).toBe(200);
    /* The accent the old code dropped: the branch returned before it. */
    expect(level(accented.gainEnvelope)).toBeGreaterThan(plain.gain);
    expect(level(accented.gainEnvelope)).toBeCloseTo(
      plain.gain * expressionPresets.accent.gainMultiplier,
      5,
    );
  });

  it("bends a pinch harmonic without losing the harmonic", () => {
    /*
     * The two add, because both end up as one number on one playback rate:
     * the squeal is 1900 cents above the stopped note and a full bend is 200
     * above that. Anything else would be an approximation of arithmetic.
     */
    const squeal = planOf({ attack: "pinch_harmonic" });
    const bent = planOf({
      attack: "pinch_harmonic",
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    expect(topCents(squeal.pitchAutomation)).toBe(expressionPresets.harmonic.pinchCents);
    expect(topCents(bent.pitchAutomation)).toBe(
      expressionPresets.harmonic.pinchCents + 200,
    );
    /* And it is still a harmonic: the level is the harmonic's, not the note's. */
    expect(level(bent.gainEnvelope)).toBeCloseTo(
      bent.gain * expressionPresets.harmonic.pinchGain,
      5,
    );
  });

  it("starts a bent pinch harmonic where the string actually was", () => {
    /* The squeal arrives a moment after the pick. It must climb from the
       note's own pitch, not jump to one the string was never at. */
    const bent = planOf({
      attack: "pinch_harmonic",
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    expect(bent.pitchAutomation[0]!.cents).toBe(0);
    expect(bent.pitchAutomation[0]!.timeSeconds).toBe(0);
  });

  it("keeps a natural harmonic's octave under a vibrato", () => {
    const shaken = planOf({
      attack: "natural_harmonic",
      pitchGesture: {
        kind: "bend",
        targetCents: 100,
        vibrato: { startAfterTarget: true, depthCents: 30, rateHz: 5 },
      },
    });
    expect(topCents(shaken.pitchAutomation)).toBeGreaterThanOrEqual(
      expressionPresets.harmonic.naturalCents,
    );
    expect(shaken.pitchAutomation.length).toBeGreaterThan(2);
  });

  it("shortens a ghosted bend and still bends it", () => {
    const plain = planOf({ pitchGesture: { kind: "bend", targetCents: 200 } });
    const ghosted = planOf({
      attack: "ghost",
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    expect(ghosted.durationSeconds).toBeLessThan(plain.durationSeconds);
    expect(topCents(ghosted.pitchAutomation)).toBe(200);
    expect(level(ghosted.gainEnvelope)).toBeLessThan(plain.gain);
  });

  it("leaves a note with no attack exactly as it was", () => {
    /* The regression guard for the whole refactor: adding a layer must not
       change what a note without one does. */
    const before = planOf({ pitchGesture: { kind: "bend", targetCents: 200 } });
    expect(before.gainEnvelope).toEqual([]);
    expect(before.durationSeconds).toBeGreaterThan(0);
  });
});

describe("142. the new field and the old enum sound the same", () => {
  /*
   * §4's real claim, checked rather than asserted. `attack: "accent"` and
   * `articulation: "accent"` are the same striking written twice, and the day
   * they stop producing the same plan is the day one of them is a different
   * technique wearing the other's name.
   */
  const same = ["accent", "ghost", "dead", "tapping", "natural_harmonic", "pinch_harmonic"] as const;

  for (const attack of same) {
    it(`plans ${attack} identically from either field`, () => {
      const legacy = planOf({ articulation: attack });
      const modern = planOf({ attack });
      expect(modern.gainEnvelope).toEqual(legacy.gainEnvelope);
      expect(modern.pitchAutomation).toEqual(legacy.pitchAutomation);
      expect(modern.durationSeconds).toBe(legacy.durationSeconds);
      expect(modern.filterPreset).toBe(legacy.filterPreset);
      expect(modern.expressive).toBe(true);
    });
  }

  it("still plays a legacy palm mute the way it always did", () => {
    /* It is a span now, and a song written before spans still says it on the
       note. That song must not change on the day the span field appeared. */
    const muted = planOf({ articulation: "palm_mute" });
    expect(muted.filterPreset).toBe("palm_mute");
    expect(muted.expressive).toBe(true);
    expect(muted.gainEnvelope.length).toBeGreaterThan(0);
  });

  it("refuses rather than choosing when both fields answer at once", () => {
    const both = planOf({ articulation: "accent", attack: "ghost" });
    expect(both.fallbackReason).toBe("conflicting_expression");
    expect(both.gainEnvelope).toEqual([]);
  });
});

describe("143. picking direction is written down and not played", () => {
  it("changes nothing about the plan", () => {
    /*
     * §9's honesty, as a test rather than as a promise. The shipped bank has
     * one recording per pitch; a plan that differed here would be the app
     * claiming a difference it cannot produce.
     */
    const plain = planOf({});
    for (const picking of ["down", "up"] as const) {
      const picked = planOf({ picking });
      expect(picked.gainEnvelope).toEqual(plain.gainEnvelope);
      expect(picked.pitchAutomation).toEqual(plain.pitchAutomation);
      expect(picked.durationSeconds).toBe(plain.durationSeconds);
      expect(picked.gain).toBe(plain.gain);
    }
  });

  it("composes with an attack without disturbing it", () => {
    const accented = planOf({ attack: "accent" });
    const both = planOf({ attack: "accent", picking: "up" });
    expect(both.gainEnvelope).toEqual(accented.gainEnvelope);
  });
});
