/**
 * The four gestures, as physical movements (2V-C.2 §6, §8, §9, §10, §11).
 *
 * Every assertion here answers a number from `eval/expression-fidelity/BEFORE.md`.
 * Nothing asserts that a gesture is "natural", because that is not a thing a
 * test can know; what these check is that the mechanics the founder was
 * hearing — a release quicker than its own rise, a return landing on the last
 * sample, a target struck at the wrong pitch, an exit at full volume — are
 * gone and cannot come back unnoticed.
 */
import { describe, expect, it } from "vitest";

import { bendGestureAutomation, centsAt } from "@/lib/audio/pitch-gesture";
import { bendReleaseStages } from "@/lib/audio/gesture-shape";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { expressionPresets } from "@/lib/audio/expression";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { PitchGesture } from "@/lib/song/schema";

const TRACK = "gtr";
const LONG = 1.149089;

function bend(kind: "bend" | "bend_release" | "prebend" | "prebend_release") {
  return bendGestureAutomation({ kind, targetCents: 200 }, LONG);
}

/** One fretted note carrying a gesture, planned by production. */
function withGesture(gesture: PitchGesture): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = {
    notes: [{ pitch: "G3", position: { string: 2, fret: 5 }, pitchGesture: gesture }],
  };
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

const firstNote = (song: Song) =>
  buildExpressionPlan(song).notes.find((note) => note.timeTicks === 0)!;

describe("104. a bend that comes back is a movement that finishes", () => {
  it("reaches the target exactly, not near it", () => {
    const points = bend("bend_release");
    expect(points.some((point) => point.cents === 200)).toBe(true);
    expect(Math.max(...points.map((point) => point.cents))).toBe(200);
  });

  it("holds at the target long enough to be heard as an arrival", () => {
    const stages = bendReleaseStages(LONG);
    expect(stages.holdSeconds).toBeGreaterThan(0.2);
  });

  it("does not begin the descent before it has arrived", () => {
    const stages = bendReleaseStages(LONG);
    expect(stages.releaseStartsAtSeconds).toBeGreaterThanOrEqual(
      stages.reachedAtSeconds,
    );
  });

  it("lets go no faster than it pushed", () => {
    const stages = bendReleaseStages(LONG);
    expect(stages.releaseSeconds).toBeGreaterThanOrEqual(stages.riseSeconds);
  });

  it("is back at the written pitch before the note ends, not at its last sample", () => {
    const stages = bendReleaseStages(LONG);
    expect(stages.returnedAtSeconds).toBeLessThan(LONG);
    expect(stages.restSeconds).toBeGreaterThan(0.05);
    /* And it is audibly there for that whole stretch. */
    const points = bend("bend_release");
    const midRest = (stages.returnedAtSeconds + LONG) / 2;
    expect(centsAt(points, midRest)).toBeCloseTo(0, 6);
    expect(centsAt(points, LONG)).toBeCloseTo(0, 6);
  });

  it("ends where it started, with nothing still moving", () => {
    const points = bend("bend_release");
    const last = points.at(-1)!;
    expect(last.cents).toBe(0);
    expect(last.timeSeconds).toBeCloseTo(LONG, 6);
    /* No point past the note: automation that outlives its voice is a snap. */
    expect(points.every((point) => point.timeSeconds <= LONG + 1e-9)).toBe(true);
  });

  it("writes no gain at all, so nothing swells on the way down", () => {
    expect(firstNote(withGesture({ kind: "bend_release", targetCents: 200 }))
      .gainEnvelope).toEqual([]);
  });

  it("survives a note too short to hold every stage", () => {
    for (const short of [0.32, 0.18, 0.09, 0.04]) {
      const stages = bendReleaseStages(short);
      expect(stages.holdSeconds).toBeGreaterThanOrEqual(0);
      expect(stages.releaseStartsAtSeconds).toBeGreaterThanOrEqual(
        stages.reachedAtSeconds,
      );
      expect(stages.returnedAtSeconds).toBeLessThanOrEqual(short + 1e-9);
      const points = bendGestureAutomation({ kind: "bend_release", targetCents: 200 }, short);
      expect(points.every((point) => point.timeSeconds <= short + 1e-9)).toBe(true);
      for (let index = 1; index < points.length; index += 1) {
        expect(points[index]!.timeSeconds).toBeGreaterThanOrEqual(
          points[index - 1]!.timeSeconds,
        );
      }
    }
  });

  it("keeps its proportions at practice speed rather than its milliseconds", () => {
    const full = bendReleaseStages(LONG, 1);
    /* Half speed: the note is twice as long and the gesture twice as long
       with it, so the shape is the same gesture slowed down. */
    const half = bendReleaseStages(LONG * 2, 2);
    const ratio = (stages: ReturnType<typeof bendReleaseStages>) =>
      stages.releaseSeconds / stages.riseSeconds;
    expect(ratio(half)).toBeCloseTo(ratio(full), 3);
    expect(half.restSeconds / (LONG * 2)).toBeCloseTo(full.restSeconds / LONG, 3);
    expect(half.releaseSeconds).toBeGreaterThan(full.releaseSeconds);
  });

  it("leaves a bend that stays up exactly where it was", () => {
    const points = bend("bend");
    expect(points.at(-1)!.cents).toBe(200);
    expect(centsAt(points, LONG)).toBe(200);
  });
});

describe("105. a pre-bend is already there when it is struck", () => {
  it("has the target in its first audible frame", () => {
    const points = bend("prebend");
    expect(points[0]!.timeSeconds).toBe(0);
    expect(points[0]!.cents).toBe(200);
    expect(points[0]!.curve).toBe("step");
    expect(centsAt(points, 0)).toBe(200);
  });

  it("never rises from the flat pitch, at any moment of the note", () => {
    const points = bend("prebend");
    for (let at = 0; at <= LONG; at += LONG / 64) {
      expect(centsAt(points, at)).toBe(200);
    }
  });

  it("is a different first frame from a normal bend, which is what L18 asks", () => {
    /* The old card compared pre-bend hold against pre-bend release: two takes
       identical for the first 88% of the note. That is why L12 could not be
       measured. This is the difference the new card asks about. */
    expect(centsAt(bend("prebend"), 0)).toBe(200);
    expect(centsAt(bend("bend"), 0)).toBe(0);
  });

  it("adds no second onset to the song for the preparation", () => {
    const plan = buildExpressionPlan(withGesture({ kind: "prebend", targetCents: 200 }));
    expect(plan.notes.filter((note) => note.trackId === TRACK)).toHaveLength(1);
  });
});

describe("106. an open slide is one note, entered or left", () => {
  it("holds the written pitch for the audible majority of a slide-in", () => {
    const note = firstNote(
      withGesture({ kind: "slide_in", from: "below", approxSemitones: 2 }),
    );
    const arrival = note.pitchAutomation.find((point) => point.cents === 0)!;
    expect(arrival.timeSeconds).toBeLessThan(note.durationSeconds * 0.4);
    expect(centsAt(note.pitchAutomation, note.durationSeconds)).toBe(0);
  });

  it("starts a slide-in at the approach pitch rather than jumping to it", () => {
    const note = firstNote(
      withGesture({ kind: "slide_in", from: "below", approxSemitones: 2 }),
    );
    expect(note.pitchAutomation[0]!.timeSeconds).toBe(0);
    expect(note.pitchAutomation[0]!.cents).toBe(-200);
  });

  it("gives a slide-in no fade: it lands into a note that goes on sounding", () => {
    expect(
      firstNote(withGesture({ kind: "slide_in", from: "below", approxSemitones: 2 }))
        .gainEnvelope,
    ).toEqual([]);
  });

  it("leaves a slide-out's exit until the late part of the note", () => {
    const note = firstNote(
      withGesture({ kind: "slide_out", to: "down", approxSemitones: 3 }),
    );
    const leaves = note.pitchAutomation.find((point) => point.cents !== 0)!;
    expect(leaves.timeSeconds).toBeGreaterThan(note.durationSeconds * 0.5);
    /* And the note is heard at its own pitch before that. */
    expect(centsAt(note.pitchAutomation, note.durationSeconds * 0.4)).toBe(0);
  });

  it("fades a slide-out as it goes, so nothing is cut at full voice", () => {
    const note = firstNote(
      withGesture({ kind: "slide_out", to: "down", approxSemitones: 3 }),
    );
    const envelope = note.gainEnvelope;
    expect(envelope.length).toBeGreaterThanOrEqual(3);
    expect(envelope[0]!.value).toBeCloseTo(note.gain, 6);
    const last = envelope.at(-1)!;
    expect(last.timeSeconds).toBeCloseTo(note.durationSeconds, 6);
    expect(last.value).toBeLessThan(note.gain);
    /* Not to silence: the string is still stopping on its own. */
    expect(last.value).toBeGreaterThan(0);
    expect(last.value).toBeCloseTo(
      note.gain * expressionPresets.slide.outFadeToFraction,
      6,
    );
    /* Level is held until the hand actually moves: at the moment the fade
       is allowed to begin, the pitch has not yet left the written note. */
    const hold = envelope.find((point) => point.timeSeconds > 0)!;
    expect(hold.value).toBeCloseTo(note.gain, 6);
    expect(centsAt(note.pitchAutomation, hold.timeSeconds)).toBe(0);
    expect(hold.timeSeconds).toBeGreaterThan(note.durationSeconds * 0.5);
  });

  it("adds no imaginary note to the song at either end", () => {
    for (const gesture of [
      { kind: "slide_in", from: "below", approxSemitones: 2 },
      { kind: "slide_out", to: "down", approxSemitones: 3 },
    ] as const) {
      const song = withGesture(gesture);
      const plan = buildExpressionPlan(song);
      expect(plan.notes.filter((note) => note.trackId === TRACK)).toHaveLength(1);
    }
  });
});
