/**
 * Continuing a pattern: the reader's choice, written once (2S-A §9).
 */
import { describe, expect, it } from "vitest";

import {
  MAX_PREVIEW_CARDS,
  continueLabel,
  continuePattern,
  previewContinuations,
  type ContinuePlanMode,
} from "@/lib/song/continue-pattern";
import type { TimeSelection } from "@/lib/song/time-selection";
import { ticksPerSlot } from "@/lib/music/timing";
import type { Song } from "@/lib/song/schema";
import { bar, note, readBar, slots, song, TRACK_ID } from "@/test/move-fixtures";

const STEP = ticksPerSlot(8);
const BAR = STEP * 8;

const A3 = () => note("A3", 1, 12);
const C4 = () => note("C4", 1, 15);

const select = (startTicks: number, endTicks: number): TimeSelection => ({
  sectionId: "s1",
  trackId: TRACK_ID,
  startTicks,
  endTicks,
});

/** Two notes and two rests, in a four-bar section. */
const pattern = (): Song =>
  song([
    bar(slots([A3(), C4()])),
    bar(slots([])),
    bar(slots([])),
    bar(slots([])),
  ]);

describe("313. an exact repeat is the repeat command, not a second one", () => {
  it("writes the pattern again after itself", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 1)).toEqual(readBar(result.song, 0));
  });

  it("carries the rests, because the rests are the rhythm", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    // Two notes and six rests, in that order, both times.
    expect(readBar(result.song, 1).filter((entry) => entry !== ".")).toHaveLength(2);
  });

  it("writes as many copies as the reader asked for", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 3,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.written).toBe(3);
    for (const barIndex of [1, 2, 3]) {
      expect(readBar(result.song, barIndex)).toEqual(readBar(result.song, 0));
    }
  });
});

describe("314. moving the shape and moving the pitch are different things", () => {
  it("moves the hand shape without changing which strings it uses", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "shape", stringDelta: 0, fretDelta: 2 },
      repeats: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(readBar(result.song, 1)).not.toEqual(readBar(result.song, 0));
  });

  it("moves the melody by semitones without touching the shape's own rule", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "pitch", semitones: 2 },
      repeats: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(readBar(result.song, 1)).not.toEqual(readBar(result.song, 0));
  });

  it("treats a move of zero as an exact repeat rather than as a second command", () => {
    const moved = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "shape", stringDelta: 0, fretDelta: 0 },
      repeats: 1,
    });
    const plain = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 1,
    });
    if (!moved.ok || !plain.ok) throw new Error("refused");
    expect(JSON.stringify(moved.song)).toBe(JSON.stringify(plain.song));
  });
});

describe("315. one plan, one result", () => {
  it("never touches the song it was handed", () => {
    const before = pattern();
    const snapshot = JSON.stringify(before);
    continuePattern({
      song: before,
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 3,
    });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("writes nothing when one step of three is refused", () => {
    const before = pattern();
    const snapshot = JSON.stringify(before);
    // Four bars of room, four copies asked for: the last has nowhere to go.
    const result = continuePattern({
      song: before,
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 4,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("writes as much as fits only when the reader said so", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 4,
      onOverrun: "fit",
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.written).toBe(3);
    expect(result.trimmed).toBe(true);
  });

  it("says so rather than trimming in silence", () => {
    const refused = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 4,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toBeTruthy();
    expect(refused.error.message).not.toMatch(/undefined|_/);
  });

  it("refuses a count of nothing rather than doing nothing quietly", () => {
    const result = continuePattern({
      song: pattern(),
      selection: select(0, BAR),
      mode: { kind: "repeat" },
      repeats: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("gives the same bytes five times running", () => {
    const runs = Array.from({ length: 5 }, () =>
      continuePattern({
        song: pattern(),
        selection: select(0, BAR),
        mode: { kind: "pitch", semitones: 2 },
        repeats: 2,
      }),
    );
    const first = runs[0];
    if (!first?.ok) throw new Error("refused");
    for (const run of runs) {
      if (!run.ok) throw new Error("refused");
      expect(JSON.stringify(run.song)).toBe(JSON.stringify(first.song));
    }
  });
});

describe("316. it says what it does and claims nothing about the music", () => {
  const MODES: readonly ContinuePlanMode[] = [
    { kind: "repeat" },
    { kind: "shape", stringDelta: 0, fretDelta: 2 },
    { kind: "pitch", semitones: -2 },
  ];

  it("names each option by what it does", () => {
    expect(continueLabel({ kind: "repeat" })).toBe("Aynen tekrar et");
    expect(continueLabel({ kind: "shape", stringDelta: 0, fretDelta: 2 })).toBe(
      "Aynı şekli 2 perde ileri taşı",
    );
    expect(continueLabel({ kind: "pitch", semitones: -2 })).toBe(
      "Aynı ezgiyi 2 ses aşağı taşı",
    );
  });

  it("never calls one of them better, recommended, correct or in scale", () => {
    for (const mode of MODES) {
      const label = continueLabel(mode);
      expect(label).not.toMatch(/en iyi|önerilen|doğru|gam|uygun|tavsiye/i);
    }
  });

  it("draws at most three cards", () => {
    const cards = previewContinuations(pattern(), select(0, BAR), [...MODES, ...MODES], 1);
    expect(cards).toHaveLength(MAX_PREVIEW_CARDS);
  });

  it("makes every card a real result of the real command", () => {
    const cards = previewContinuations(pattern(), select(0, BAR), MODES, 1);
    for (const card of cards) {
      expect(card.result.ok, card.label).toBe(true);
      if (card.result.ok) {
        expect(card.result.song).not.toBe(undefined);
      }
    }
  });

  it("changes nothing by drawing the cards", () => {
    const before = pattern();
    const snapshot = JSON.stringify(before);
    previewContinuations(before, select(0, BAR), MODES, 2);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
