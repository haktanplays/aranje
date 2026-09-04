/**
 * What the two slides and a carried bend actually do (2V-C.1 §7, §8).
 *
 * The single fact that separates a legato slide from a shift slide is whether
 * the target is struck. Everything else about them — the travel curve, the
 * time it takes, the arrival on the beat — is deliberately identical, so a
 * test that only compared their pitch would pass on two things that sound
 * the same. What is asserted here is the attack.
 */
import { describe, expect, it } from "vitest";

import { activeVoicesAt } from "@/lib/audio/active-voices";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap } from "@/lib/audio/tempo";
import {
  songSchema,
  type MelodicSlot,
  type NoteConnection,
  type NoteEvent,
  type PitchGesture,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const STRING = 2;

const at = (fret: number, pitch: string, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({ pitch, position: { string: STRING, fret }, ...extra }) as NoteEvent;

/** Two notes a whole tone apart on one string, joined however the caller says. */
function pair(connection: NoteConnection | undefined): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [at(5, "G3")] };
  lane[1] = "-";
  lane[2] = {
    notes: [at(7, "A3", connection === undefined ? {} : { connection })],
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

const targetOf = (song: Song) =>
  buildExpressionPlan(song).notes.find((note) => note.timeTicks === 192)!;

describe("89. a legato slide is not struck; a shift slide is", () => {
  it("gives the legato slide to a chain, so nothing strikes the target", () => {
    const note = targetOf(pair({ kind: "legato_slide" }));
    /* Belonging to a chain *is* how the engine knows not to strike it: the
       chain plays every member with one voice. */
    expect(note.chainId).toBeDefined();
    expect(note.chainRole).toBe("target");
  });

  it("leaves the shift slide an ordinary onset, so it is struck", () => {
    const note = targetOf(pair({ kind: "shift_slide" }));
    expect(note.chainId).toBeUndefined();
    expect(note.chainRole).toBeUndefined();
    expect(note.expressive).toBe(true);
  });

  /*
   * This test used to assert the opposite (2V-C.2 §9).
   *
   * It required the target's automation to start at −200 and arrive at 0,
   * which is what C.1 built and what the trace showed to be the wrong event
   * order: the target's buffer struck at the *source's* pitch, at the
   * target's written moment, sliding up from there. That is not re-striking
   * the target — it is re-striking the source, late. The assertion has not
   * been dropped, it has been moved onto the notes that now carry the
   * behaviour, and it is stricter than it was.
   */
  it("strikes the target flat, at the pitch and the moment written for it", () => {
    const shift = targetOf(pair({ kind: "shift_slide" }));
    expect(shift.timeTicks).toBe(192);
    expect(shift.pitchAutomation.every((point) => point.cents === 0)).toBe(true);
  });

  it("travels during the source note, arriving exactly as the target is struck", () => {
    const plan = buildExpressionPlan(pair({ kind: "shift_slide" }));
    const source = plan.notes.find((note) => note.timeTicks === 0)!;
    const target = plan.notes.find((note) => note.timeTicks === 192)!;

    /* Held as itself first: the departure is not at the onset. */
    expect(source.pitchAutomation[0]!.cents).toBe(0);
    const leaves = source.pitchAutomation.find((point) => point.cents !== 0)!;
    expect(leaves.timeSeconds).toBeGreaterThan(0);

    /* And it gets there exactly on time, at exactly the interval. */
    const arrival = source.pitchAutomation.find((point) => point.cents === 200)!;
    const handover = target.startSeconds - source.startSeconds;
    expect(arrival.timeSeconds).toBeCloseTo(handover, 6);
    /*
     * The string is not let go on the way: the source sounds right through
     * the arrival. Since 2V-C.4 it sounds a little past it too — the target's
     * recording needs a few milliseconds to get loud and the source covers
     * them — and every point written after the arrival holds the pitch it
     * arrived at, so the tail is the same note rather than a second one.
     */
    expect(source.durationSeconds).toBeGreaterThanOrEqual(handover);
    for (const point of source.pitchAutomation) {
      if (point.timeSeconds > handover) expect(point.cents).toBe(200);
    }
  });

  it("leaves the legato slide's source alone, because its chain owns it", () => {
    const plan = buildExpressionPlan(pair({ kind: "legato_slide" }));
    const source = plan.notes.find((note) => note.timeTicks === 0)!;
    /* One voice travels through the whole chain, so nothing is written onto
       the source separately — two owners for one string is the bug this
       skip exists to avoid. */
    expect(source.chainRole).toBe("source");
    expect(source.pitchAutomation.every((point) => point.cents === 0)).toBe(true);
  });

  it("keeps the legacy slide on the chain path, unchanged", () => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = { notes: [at(5, "G3")] };
    lane[1] = "-";
    lane[2] = { notes: [at(7, "A3", { articulation: "slide" })] };
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
    const note = buildExpressionPlan(song).notes.find((entry) => entry.timeTicks === 192)!;
    expect(note.chainRole).toBe("target");
  });

  it("plans the same chain for the legacy slide and the explicit legato one", () => {
    const legacyLane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    legacyLane[0] = { notes: [at(5, "G3")] };
    legacyLane[1] = "-";
    legacyLane[2] = { notes: [at(7, "A3", { articulation: "slide" })] };
    const legacy = songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: legacyLane } }],
        },
      ],
    } satisfies Song);
    const explicit = pair({ kind: "legato_slide" });
    expect(JSON.stringify(buildExpressionPlan(explicit).chains)).toBe(
      JSON.stringify(buildExpressionPlan(legacy).chains),
    );
  });
});

describe("90. a bent note is still bent at the bar line", () => {
  /** One note held across the bar line, bent up and told to stay there. */
  function carried(gesture: PitchGesture): Song {
    const first: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    first[4] = { notes: [at(7, "A3", { pitchGesture: gesture, durationTicks: 768 })] };
    for (let index = 5; index < 8; index += 1) first[index] = "-";
    const second: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    for (let index = 0; index < 4; index += 1) second[index] = "-";
    return songSchema.parse({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
      sections: [
        {
          ...SAMPLE_SONG.sections[0]!,
          bars: [
            { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: first } },
            { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: second } },
          ],
        },
      ],
    } satisfies Song);
  }

  it("sounds as one note across the bar line, not two", () => {
    const song = carried({ kind: "bend", targetCents: 200 });
    const notes = buildExpressionPlan(song).notes;
    expect(notes).toHaveLength(1);
    /* One onset spanning both bars: the tie run is 768 ticks of written
       length, and the note rings for the hold fraction of it. */
    expect(notes[0]!.timeTicks).toBe(384);
    expect(notes[0]!.timeTicks + notes[0]!.durationTicks).toBeGreaterThan(768);
  });

  it("is still up when the transport is paused in the next bar", () => {
    const song = carried({ kind: "bend", targetCents: 200 });
    const plan = buildExpressionPlan(song);
    const tempo = buildTempoMap(song, 100);
    /* Half a bar past the bar line: the gesture reached its target long ago
       and was told to hold, so a pause here must find the string bent. */
    const paused = activeVoicesAt(plan, tempo, 768 + 192);
    expect(paused.voices).toHaveLength(1);
    expect(paused.voices[0]!.currentCents).toBe(200);
  });

  it("is on its way down near the end when it was told to release", () => {
    const holdSong = carried({ kind: "bend", targetCents: 200 });
    const tempo = buildTempoMap(holdSong, 100);
    const holdPlan = buildExpressionPlan(holdSong);
    /*
     * Just before the note stops sounding, which is inside the release stage.
     * The moment is read from the plan rather than written down here: how
     * long a note actually rings is the planner's business, and a hard-coded
     * tick would be this test quietly asserting that too.
     */
    const note = holdPlan.notes[0]!;
    const nearEnd = note.timeTicks + note.durationTicks - 12;
    const holds = activeVoicesAt(holdPlan, tempo, nearEnd);
    const releases = activeVoicesAt(
      buildExpressionPlan(carried({ kind: "bend_release", targetCents: 200 })),
      tempo,
      nearEnd,
    );
    /* Same question, same moment, two different answers — which is the whole
       reason both kinds exist. */
    expect(holds.voices[0]!.currentCents).toBe(200);
    expect(releases.voices[0]!.currentCents).toBeLessThan(200);
  });

  it("resumes a prebend already bent, with no rise to hear", () => {
    const song = carried({ kind: "prebend", targetCents: 200 });
    const plan = buildExpressionPlan(song);
    const tempo = buildTempoMap(song, 100);
    /* One slot in — earlier than any rise could have finished. A prebend has
       no rise, so the answer is the target from the first instant. */
    const paused = activeVoicesAt(plan, tempo, 384 + 96);
    expect(paused.voices[0]!.currentCents).toBe(200);
  });

  it("restores the rest of the gesture, not a flat tail", () => {
    const song = carried({ kind: "bend_release", targetCents: 200 });
    const plan = buildExpressionPlan(song);
    const tempo = buildTempoMap(song, 100);
    const paused = activeVoicesAt(plan, tempo, 768);
    const voice = paused.voices[0]!;
    /* The restored automation starts at where the pitch actually was and
       still ends where the gesture said it ends. */
    expect(voice.pitchAutomation[0]!.cents).toBe(voice.currentCents);
    expect(voice.pitchAutomation.at(-1)!.cents).toBe(0);
  });

  it("restores the same pitch on every pass of a loop", () => {
    const song = carried({ kind: "bend", targetCents: 200 });
    const plan = buildExpressionPlan(song);
    const tempo = buildTempoMap(song, 100);
    /* A loop wrap re-asks the same question of the same plan. The answer is
       a function of the plan and the tick, so it cannot drift pass to pass. */
    const first = activeVoicesAt(plan, tempo, 768 + 192);
    const second = activeVoicesAt(plan, tempo, 768 + 192);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("cuts the continuation at the end of a selection window", () => {
    const song = carried({ kind: "bend", targetCents: 200 });
    const plan = buildExpressionPlan(song);
    const tempo = buildTempoMap(song, 100);
    const window = { startTicks: 384, endTicks: 960, trackIds: [TRACK] };
    const paused = activeVoicesAt(plan, tempo, 768, window);
    const voice = paused.voices[0]!;
    /*
     * The note would naturally ring to tick 1152; the window ends at 960. The
     * continuation is cut to the window, so a rendered pass and a live pass
     * cannot disagree about a tail crossing the selection's end.
     */
    const naturalRemaining = plan.notes[0]!.durationSeconds - voice.elapsedSeconds;
    expect(voice.remainingSeconds).toBeGreaterThan(0);
    expect(voice.remainingSeconds).toBeLessThan(naturalRemaining);
    expect(voice.currentCents).toBe(200);
  });
});
