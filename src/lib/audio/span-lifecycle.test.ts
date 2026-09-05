/**
 * A span through pause, resume, loop and shutdown (2V-D.1-C §10).
 *
 * The plan is built once and everything downstream reads it, so in principle
 * a span cannot be lost on the way to a resume. In principle is not evidence.
 * The specific failure worth naming: a note struck under a palm mute, paused
 * halfway, and resumed as an *open* note — the reader hears the mute drop out
 * mid-bar, which is worse than never having had it.
 *
 * Every case here has a note outside the span to compare against, because a
 * fixture where everything is muted cannot tell muting from a broken song.
 */
import { describe, expect, it } from "vitest";

import { activeVoicesAt } from "@/lib/audio/active-voices";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap } from "@/lib/audio/tempo";
import { pitchAt } from "@/lib/song/edit";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const BAR = 768;

const note = (stringIndex: number, fret: number): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, stringIndex, fret)!,
    position: { string: stringIndex, fret },
  }) as NoteEvent;

/**
 * Two bars, each one strike held for the whole bar: the low A string and the
 * top E together. The span covers the low one only, so every case has a note
 * beside it that was never muted.
 */
function song(spans?: readonly TechniqueSpan[]): Song {
  /* Struck on the downbeat and tied across the bar, so there is something
     still sounding to resume into. A single-slot note would have finished
     before any of these questions could be asked. */
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => "-" as MelodicSlot);
  lane[0] = { notes: [note(1, 3), note(5, 3)] };
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } },
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: [...lane] } },
        ],
        ...(spans ? { techniqueSpans: [...spans] } : {}),
      },
    ],
  } satisfies Song);
}

const SPAN: TechniqueSpan = {
  id: "pm1",
  kind: "palm_mute",
  trackId: TRACK,
  startTicks: 0,
  endTicks: BAR,
  stringIndices: [1],
};

/** The low A string, which the span covers. */
const MUTED_PITCH = note(1, 3).pitch;
/** The top E, which it does not. */
const OPEN_PITCH = note(5, 3).pitch;

const resumeOf = (
  built: Song,
  atTicks: number,
  window?: { startTicks: number; endTicks: number; trackIds?: readonly string[] },
) =>
  activeVoicesAt(
    buildExpressionPlan(built),
    buildTempoMap(built),
    atTicks,
    window ? { ...window, trackIds: window.trackIds ?? [TRACK] } : null,
  );

/** The note on the string the span covers, as the resume sees it. */
const mutedVoice = (built: Song, atTicks: number) =>
  resumeOf(built, atTicks).voices.find((voice) => voice.sourcePitch === MUTED_PITCH);

const openVoice = (built: Song, atTicks: number) =>
  resumeOf(built, atTicks).voices.find((voice) => voice.sourcePitch === OPEN_PITCH);

describe("333. a span survives a pause and a resume", () => {
  it("carries the mute across the pause", () => {
    /* The note itself has no `articulation` field at all — the mute is the
       span's, so this is also the proof that the span reached the resume. */
    const voice = mutedVoice(song([SPAN]), 24);
    expect(voice).toBeDefined();
    expect(voice?.filterPreset).toBe("palm_mute");
    expect(voice?.articulation).toBeUndefined();
  });

  it("does not mute the string the span was not over", () => {
    const built = song([SPAN]);
    expect(openVoice(built, 24)).toBeDefined();
    expect(openVoice(built, 24)?.filterPreset).toBeUndefined();
  });

  it("does not mute anything when there is no span", () => {
    /* The negative control. Without it the test above passes on a fixture
       where nothing was ever muted. */
    expect(mutedVoice(song(), 24)).toBeDefined();
    expect(mutedVoice(song(), 24)?.filterPreset).toBeUndefined();
  });

  it("has already finished where an open note is still ringing", () => {
    /*
     * A muted note is shorter, so past a certain point there is nothing to
     * resume. That is the span reaching the *length* as well as the tone —
     * the two halves of the mute that the previous round had disagreeing.
     */
    /* The written note is a whole bar; muted it keeps 45% of that and open
       it keeps 92%, so 400 ticks in only one of them is left. */
    const muted = mutedVoice(song([SPAN]), 400);
    const open = mutedVoice(song(), 400);
    expect(open).toBeDefined();
    expect(muted).toBeUndefined();
  });

  it("gives the same answer to the same question twice", () => {
    const built = song([SPAN]);
    expect(JSON.stringify(resumeOf(built, 24))).toBe(JSON.stringify(resumeOf(built, 24)));
  });
});

describe("334. a span through a loop and a selection", () => {
  const WHOLE = { startTicks: 0, endTicks: BAR };

  it("restores the same voices on the second pass as on the first", () => {
    /*
     * A wrap re-enters at the window's start and asks the same question. If
     * the answer drifted, the mute would be there on pass one and gone by
     * pass four — the 2V-B.3 defect, in the technique axis.
     */
    const built = song([SPAN]);
    const first = resumeOf(built, 24, WHOLE);
    const again = resumeOf(built, 24, WHOLE);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(first.voices.some((voice) => voice.filterPreset === "palm_mute")).toBe(true);
  });

  it("mutes the voice a selection carried into its own window", () => {
    const voices = resumeOf(song([SPAN]), 24, WHOLE).voices;
    expect(voices.find((voice) => voice.sourcePitch === MUTED_PITCH)?.filterPreset).toBe(
      "palm_mute",
    );
    expect(
      voices.find((voice) => voice.sourcePitch === OPEN_PITCH)?.filterPreset,
    ).toBeUndefined();
  });

  it("restores nothing from a note the selection did not start", () => {
    /*
     * Scope before technique. The note is still sounding at tick 96 — the
     * control below proves it — but its onset is outside the chosen range,
     * so it is not this selection's to play, muted or not.
     */
    const built = song([SPAN]);
    expect(resumeOf(built, 96, { startTicks: 48, endTicks: BAR }).voices).toEqual([]);
    expect(resumeOf(built, 96, WHOLE).voices.length).toBeGreaterThan(0);
  });

  it("restores nothing from a track the selection did not name", () => {
    const built = song([SPAN]);
    expect(resumeOf(built, 24, { ...WHOLE, trackIds: ["bass"] }).voices).toEqual([]);
    expect(resumeOf(built, 24, WHOLE).voices.length).toBeGreaterThan(0);
  });

  it("cuts a muted tail at the selection's end rather than past it", () => {
    const built = song([SPAN]);
    const short = resumeOf(built, 24, { startTicks: 0, endTicks: 48 }).voices.find(
      (voice) => voice.sourcePitch === MUTED_PITCH,
    );
    const long = resumeOf(built, 24, WHOLE).voices.find(
      (voice) => voice.sourcePitch === MUTED_PITCH,
    );
    expect(short).toBeDefined();
    expect(long).toBeDefined();
    expect(short!.remainingSeconds).toBeLessThan(long!.remainingSeconds);
  });

  it("has nothing left to restore once the span's notes have stopped", () => {
    /* Cleanup, stated as a fact about the plan rather than about a timer:
       there is no voice to leak because there is no voice. */
    const built = song([SPAN]);
    expect(resumeOf(built, BAR, WHOLE).voices).toEqual([]);
  });
});
