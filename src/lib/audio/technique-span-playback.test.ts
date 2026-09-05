/**
 * A span that is written and inaudible would be the whole defect again
 * (2V-D.1 §6, §10).
 *
 * The round before this one found the new `attack` field being written down,
 * drawn, exported and never reaching the speakers, because the shape the
 * planner reads had already dropped it. A span is the same risk with more
 * places to go wrong: it lives on the section, it is addressed from the
 * section's own start, and the planner counts from the start of the song.
 *
 * So each of these asks the production plan what a note actually does, and
 * each has a note *outside* the span to compare against — a test where
 * everything is muted cannot tell muting from a broken fixture.
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
  type TechniqueSpan,
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

/** Two bars: low string and top string struck together on every beat. */
function song(spans?: TechniqueSpan[], extra: Partial<NoteEvent> = {}): Song {
  const lane = (): MelodicSlot[] => {
    const slots: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    slots[0] = { notes: [note(5, 3, extra), note(1, 3, extra)] };
    slots[4] = { notes: [note(5, 5, extra), note(1, 5, extra)] };
    return slots;
  };
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane() } },
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane() } },
        ],
        ...(spans ? { techniqueSpans: spans } : {}),
      },
    ],
  } satisfies Song);
}

const span = (over: Partial<TechniqueSpan> = {}): TechniqueSpan => ({
  id: "pm1",
  kind: "palm_mute",
  trackId: TRACK,
  startTicks: 0,
  endTicks: 768,
  stringIndices: [4, 5],
  ...over,
});

const planAt = (built: Song, timeTicks: number, stringIndex: number) =>
  buildExpressionPlan(built).notes.find(
    (entry) => entry.timeTicks === timeTicks && entry.position?.stringIndex === stringIndex,
  )!;

describe("144. a palm-mute span reaches the speakers", () => {
  it("chokes and rolls off the strings it covers", () => {
    const muted = planAt(song([span()]), 0, 5);
    const open = planAt(song(), 0, 5);
    expect(muted.filterPreset).toBe("palm_mute");
    expect(muted.durationSeconds).toBeLessThan(open.durationSeconds);
    expect(muted.expressive).toBe(true);
    expect(open.filterPreset).toBeUndefined();
  });

  it("leaves the string above it completely alone", () => {
    /* The sound the span model exists for: low strings choked, top string
       ringing over them, in one bar, from one hand position. */
    const built = song([span()]);
    expect(planAt(built, 0, 5).filterPreset).toBe("palm_mute");
    expect(planAt(built, 0, 1).filterPreset).toBeUndefined();
    expect(planAt(built, 0, 1).durationSeconds).toBe(planAt(song(), 0, 1).durationSeconds);
  });

  it("stops at its own end, counted from the section's start", () => {
    /*
     * The bar-to-section offset, which is the one piece of arithmetic between
     * a span's ticks and an onset's. A span over the first bar must not reach
     * the second, and a test that only looked at the first bar could not tell.
     */
    const built = song([span({ endTicks: 768 })]);
    expect(planAt(built, 0, 5).filterPreset).toBe("palm_mute");
    expect(planAt(built, 384, 5).filterPreset).toBe("palm_mute");
    /* Bar two starts at 768. */
    expect(planAt(built, 768, 5).filterPreset).toBeUndefined();
  });

  it("crosses a bar line when it was drawn across one", () => {
    const built = song([span({ endTicks: 1152 })]);
    expect(planAt(built, 768, 5).filterPreset).toBe("palm_mute");
    expect(planAt(built, 1152, 5).filterPreset).toBeUndefined();
  });

  it("keeps the accent's level under the mute's envelope", () => {
    /*
     * §8: two gain multipliers in series is how a note ends up inaudible from
     * two decisions that each looked reasonable. The accent decides the level
     * the muted envelope starts from; it does not multiply it a second time.
     */
    const plain = planAt(song([span()]), 0, 5);
    const accented = planAt(song([span()], { attack: "accent" }), 0, 5);
    const top = (points: readonly { value: number }[]) =>
      points.reduce((most, point) => Math.max(most, point.value), 0);
    expect(accented.filterPreset).toBe("palm_mute");
    expect(top(accented.gainEnvelope)).toBeGreaterThan(top(plain.gainEnvelope));
    expect(top(accented.gainEnvelope)).toBeLessThanOrEqual(1);
    expect(accented.durationSeconds).toBe(plain.durationSeconds);
  });

  it("plays a span exactly as the legacy articulation does", () => {
    /*
     * Byte-equal, not close. The eight-millisecond gap the previous round
     * left was never a rounding: the timeline gated a legacy mute in ticks
     * and could not see a span, so the span was gated a second time in the
     * planner — 0.92 x 0.45 against 0.45. The timeline resolves the
     * technique now, so both reach the planner the same length and there is
     * nothing left to be close about.
     */
    const bySpan = planAt(song([span()]), 0, 5);
    const byLegacy = planAt(song(undefined, { articulation: "palm_mute" }), 0, 5);
    expect(bySpan.filterPreset).toBe(byLegacy.filterPreset);
    expect(bySpan.durationSeconds).toBe(byLegacy.durationSeconds);
    expect(bySpan.gainEnvelope).toEqual(byLegacy.gainEnvelope);
    expect(bySpan.durationTicks).toBe(byLegacy.durationTicks);
  });

  it("is not comparing two notes that were never muted", () => {
    /* Non-vacuity for the parity above: a plain note has to differ from both
       of them, or "identical" would be a fact about the fixture. */
    const plain = planAt(song(), 0, 5);
    const muted = planAt(song([span()]), 0, 5);
    expect(plain.filterPreset).toBeUndefined();
    expect(plain.durationSeconds).toBeGreaterThan(muted.durationSeconds);
    expect(plain.gainEnvelope).toEqual([]);
  });

  it("changes nothing at all when the song has no spans", () => {
    const before = buildExpressionPlan(song()).notes;
    const after = buildExpressionPlan(song([])).notes;
    expect(after).toEqual(before);
  });
});

describe("145. a let-ring span reaches the same rule the flag does", () => {
  const ring = (over: Partial<TechniqueSpan> = {}) =>
    span({ id: "lr1", kind: "let_ring", stringIndices: [1], ...over });

  it("lets the covered string ring past the next attack", () => {
    const plain = planAt(song(), 0, 1);
    const rung = planAt(song([ring()]), 0, 1);
    expect(rung.durationSeconds).toBeGreaterThan(plain.durationSeconds);
  });

  it("rings for exactly as long as the note's own flag would", () => {
    /* One rule, reached two ways. A span that produced a different length
       would be a second let-ring wearing the first one's name. */
    const bySpan = planAt(song([ring()]), 0, 1);
    const byFlag = buildExpressionPlan(
      song(undefined, { letRing: true }),
    ).notes.find((entry) => entry.timeTicks === 0 && entry.position?.stringIndex === 1)!;
    expect(bySpan.durationSeconds).toBe(byFlag.durationSeconds);
  });

  it("does not lengthen a string it was not drawn over", () => {
    const built = song([ring()]);
    expect(planAt(built, 0, 5).durationSeconds).toBe(planAt(song(), 0, 5).durationSeconds);
  });

  it("still lets the same string's own next attack cut it", () => {
    /*
     * One string sounds one note. `letRing` lifts the global-onset rule and
     * nothing else — a span that let a string ring through its own re-strike
     * would be printing polyphony no hand could produce.
     */
    const built = song([ring()]);
    const first = planAt(built, 0, 1);
    expect(first.durationSeconds).toBeLessThanOrEqual(
      planAt(built, 768, 1).startSeconds - first.startSeconds + 1e-6,
    );
  });
});

describe("342. the mute's absolute ceiling, where it actually binds", () => {
  /*
   * The 180 ms ceiling is a *different* job from the notated gate: the gate
   * is proportional and the ceiling is not, which is why neither could be
   * deleted when the double-gating was fixed. At the fixture's own tempo it
   * never binds — the measurement said so — so nothing exercised it, and a
   * probe that removed it stayed green. This is the case where it binds.
   */
  const slow = (spans?: TechniqueSpan[]): Song =>
    songSchema.parse({ ...song(spans), bpm: 40 } satisfies Song);

  it("cuts a slow note at the ceiling, not at its proportional length", () => {
    const muted = buildExpressionPlan(slow([span()])).notes.find(
      (note) => note.timeTicks === 0 && note.position?.stringIndex === 5,
    )!;
    expect(muted.filterPreset).toBe("palm_mute");
    expect(muted.durationSeconds).toBe(expressionPresets.palmMute.maxHoldSeconds);
  });

  it("is not simply the length every muted note gets", () => {
    /* The control: at the fixture's own tempo the proportional gate is
       shorter than the ceiling, so the ceiling does not decide. */
    const quick = buildExpressionPlan(song([span()])).notes.find(
      (note) => note.timeTicks === 0 && note.position?.stringIndex === 5,
    )!;
    expect(quick.durationSeconds).toBeLessThan(expressionPresets.palmMute.maxHoldSeconds);
  });

  it("gives the legacy writing the same ceiling", () => {
    /* Parity holds at the ceiling too, not only under it. */
    const legacy = buildExpressionPlan(
      songSchema.parse({
        ...song(undefined, { articulation: "palm_mute" }),
        bpm: 40,
      } satisfies Song),
    ).notes.find((note) => note.timeTicks === 0 && note.position?.stringIndex === 5)!;
    expect(legacy.durationSeconds).toBe(expressionPresets.palmMute.maxHoldSeconds);
  });
});
