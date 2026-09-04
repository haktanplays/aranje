/**
 * What 2V-C.2 was not allowed to change (§7, §16).
 *
 * This batch reshaped the release of a bend and moved a slide's travel onto a
 * different note. Both are changes to how the speakers behave, and both were
 * only permitted on the *new* explicit gestures. An old project — one written
 * with `bend_half`, `bend_full` or the `slide` articulation, before any of
 * this existed — must open and sound the same as it did the day before, and
 * the things C.1 got right and the founder passed must still be right.
 *
 * So these are not tests of the new behaviour. They are the fence around it,
 * and they are written to fail loudly if a future release shape is applied by
 * kind rather than by contract.
 */
import { describe, expect, it } from "vitest";

import { bendAutomation, buildExpressionPlan } from "@/lib/audio/expression-plan";
import { activeVoicesAt } from "@/lib/audio/active-voices";
import { buildTempoMap } from "@/lib/audio/tempo";
import { centsAt } from "@/lib/audio/pitch-gesture";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";

function oneNote(extra: Partial<NoteEvent>): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = {
    notes: [{ pitch: "G3", position: { string: 2, fret: 5 }, ...extra } as NoteEvent],
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

const planned = (song: Song) =>
  buildExpressionPlan(song).notes.find((note) => note.timeTicks === 0)!;

describe("107. the legacy bend is on its own path and stays there", () => {
  it("keeps the release shape it was accepted with", () => {
    /* The old shape lands on the written pitch at the note's last sample.
       That is the very thing 2V-C.2 changed for the gesture, and it is
       exactly what must not change here: if a later edit routes the enum
       through the gesture's stages, this diverges immediately. */
    for (const seconds of [1.149089, 0.576172, 0.2, 0.08]) {
      const points = bendAutomation(seconds, "bend_full");
      /* Points are rounded to a microsecond, so compare at that grain. */
      expect(points.at(-1)!.timeSeconds).toBeCloseTo(seconds, 5);
      expect(points.at(-1)!.cents).toBe(0);
    }
  });

  it("plans a legacy bend exactly as bendAutomation writes it", () => {
    const note = planned(oneNote({ articulation: "bend_full" }));
    expect(note.pitchAutomation).toEqual(
      bendAutomation(note.durationSeconds, "bend_full"),
    );
  });

  it("gives a legacy bend no rest at the written pitch, unlike the gesture", () => {
    /* Not an endorsement of the old shape — a statement that it was left
       alone. The rest is what `bend_release` gained; if it appears here, an
       old song has silently changed. */
    const note = planned(oneNote({ articulation: "bend_full" }));
    const last = note.pitchAutomation.at(-1)!;
    expect(last.cents).toBe(0);
    expect(last.timeSeconds).toBeCloseTo(note.durationSeconds, 6);
    /* The point before it is still moving: there is no held stretch at zero. */
    const previous = note.pitchAutomation.at(-2)!;
    expect(previous.cents).toBeGreaterThan(0);
  });

  it("gives a legacy bend no gain envelope", () => {
    expect(planned(oneNote({ articulation: "bend_half" })).gainEnvelope).toEqual([]);
  });

  it("is not vacuous: the new gesture really does differ from the old enum", () => {
    const legacy = planned(oneNote({ articulation: "bend_full" }));
    const gesture = planned(
      oneNote({ pitchGesture: { kind: "bend_release", targetCents: 200 } }),
    );
    expect(gesture.pitchAutomation).not.toEqual(legacy.pitchAutomation);
    /* And it differs in the way this batch intended: the gesture is back at
       the written pitch earlier, with a stretch left to be heard there. */
    const backAt = (note: typeof legacy) =>
      [...note.pitchAutomation].reverse().find((point) => point.cents !== 0)!
        .timeSeconds;
    expect(backAt(gesture)).toBeLessThan(backAt(legacy));
  });

  it("leaves the legacy slide articulation on the chain path", () => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [{ pitch: "G3", position: { string: 2, fret: 5 } } as NoteEvent] };
    lane[1] = "-";
    lane[2] = {
      notes: [
        {
          pitch: "A3",
          position: { string: 2, fret: 7 },
          articulation: "slide",
        } as NoteEvent,
      ],
    };
    const song = songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const plan = buildExpressionPlan(song);
    const target = plan.notes.find((note) => note.timeTicks === 192)!;
    expect(target.chainRole).toBe("target");
    /* The shift slide's new source rewrite must not reach into a chain. */
    const source = plan.notes.find((note) => note.timeTicks === 0)!;
    expect(source.chainRole).toBe("source");
    expect(source.pitchAutomation.every((point) => point.cents === 0)).toBe(true);
  });
});

describe("108. L15 and L16 still hold under the new curves", () => {
  it("still shakes at the top of a bend, after the target and not before", () => {
    const note = planned(
      oneNote({
        pitchGesture: {
          kind: "bend",
          targetCents: 200,
          vibrato: { depthCents: 10, rateHz: 5, startAfterTarget: true },
        },
      }),
    );
    const wobbles = note.pitchAutomation.filter((point) => point.curve === "sine");
    expect(wobbles.length).toBeGreaterThan(0);
    const reached = note.pitchAutomation.find((point) => point.cents === 200)!;
    expect(wobbles[0]!.timeSeconds).toBeGreaterThanOrEqual(reached.timeSeconds);
  });

  it("resumes a bent note at the pitch it was actually bent to", () => {
    const song = oneNote({ pitchGesture: { kind: "bend_release", targetCents: 200 } });
    const plan = buildExpressionPlan(song);
    const note = plan.notes.find((entry) => entry.timeTicks === 0)!;
    const tempo = buildTempoMap(song, 100);
    /* Paused on the plateau: the voice that comes back is at the target, read
       from the same automation the note was scheduled with. */
    const midHold = note.durationSeconds * 0.5;
    const pausedTicks = Math.round((midHold / note.durationSeconds) * note.durationTicks);
    const live = activeVoicesAt(plan, tempo, pausedTicks);
    expect(live.voices.length).toBeGreaterThan(0);
    expect(live.voices[0]!.currentCents).toBeCloseTo(
      centsAt(note.pitchAutomation, midHold),
      0,
    );
  });

  it("writes nothing past the end of a note, at any practice rate", () => {
    for (const percent of [50, 75, 100, 150]) {
      const plan = buildExpressionPlan(
        oneNote({ pitchGesture: { kind: "bend_release", targetCents: 200 } }),
        { practicePercent: percent },
      );
      for (const note of plan.notes) {
        for (const point of note.pitchAutomation) {
          expect(point.timeSeconds).toBeLessThanOrEqual(note.durationSeconds + 1e-9);
        }
        for (const point of note.gainEnvelope) {
          expect(point.timeSeconds).toBeLessThanOrEqual(note.durationSeconds + 1e-9);
        }
      }
    }
  });
});
