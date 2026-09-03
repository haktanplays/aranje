/**
 * A phrase is not the screen (2V-B.3 §13, §14).
 *
 * Every claim here is one half of the same sentence: the phrase's own range
 * never changes, and what the renderer is handed does. Zoom, pan and window
 * size move the second and must never touch the first.
 */
import { describe, expect, it } from "vitest";

import {
  crossesPhraseBoundary,
  measuresTouched,
  overlappingPhrases,
  phraseAt,
  phraseFragments,
} from "@/lib/song/phrase";
import { sectionSchema, type Phrase } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

/** 4/4 at PPQ 192: a measure is 768 ticks. */
const BAR = 768;

const inside: Phrase = { id: "p-inside", startTicks: 192, endTicks: 576 };
const acrossTwo: Phrase = { id: "p-two", startTicks: 576, endTicks: 1152 };
const long: Phrase = { id: "p-long", startTicks: 0, endTicks: BAR * 6 };

describe("what a window shows of a phrase", () => {
  it("shows a phrase that fits inside one measure whole", () => {
    const [fragment] = phraseFragments([inside], { fromTicks: 0, toTicks: BAR });
    expect(fragment).toBeDefined();
    expect(fragment!.continuesBefore).toBe(false);
    expect(fragment!.continuesAfter).toBe(false);
    expect(fragment!.fromTicks).toBe(192);
    expect(fragment!.toTicks).toBe(576);
  });

  it("shows a phrase that spans two measures as one fragment, not two", () => {
    const fragments = phraseFragments([acrossTwo], { fromTicks: 0, toTicks: BAR * 2 });
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.fromTicks).toBe(576);
    expect(fragments[0]?.toTicks).toBe(1152);
    /* Two measures, one idea: the bar line inside it is not a boundary. */
    expect(measuresTouched(acrossTwo, [0, BAR], BAR * 2)).toBe(2);
  });

  it("marks a phrase that carries on past the visible window", () => {
    const [fragment] = phraseFragments([long], { fromTicks: 0, toTicks: BAR });
    expect(fragment!.continuesAfter).toBe(true);
    expect(fragment!.continuesBefore).toBe(false);
    expect(fragment!.toTicks).toBe(BAR);
    /* And its own range is untouched by the clipping. */
    expect(fragment!.phraseStartTicks).toBe(0);
    expect(fragment!.phraseEndTicks).toBe(BAR * 6);
  });

  it("marks the fragment on the far side of a pan as continuing from before", () => {
    const [next] = phraseFragments([long], { fromTicks: BAR, toTicks: BAR * 2 });
    expect(next!.continuesBefore).toBe(true);
    expect(next!.continuesAfter).toBe(true);
    expect(next!.phraseId).toBe(long.id);
  });

  it("closes the mark on the fragment that really does contain the end", () => {
    const [last] = phraseFragments([long], { fromTicks: BAR * 5, toTicks: BAR * 7 });
    expect(last!.continuesBefore).toBe(true);
    expect(last!.continuesAfter).toBe(false);
    expect(last!.toTicks).toBe(BAR * 6);
  });

  it("keeps the phrase's identity and ticks across every window it is seen in", () => {
    const windows = [
      { fromTicks: 0, toTicks: BAR },
      { fromTicks: 0, toTicks: BAR * 2 },
      { fromTicks: BAR * 2, toTicks: BAR * 3 },
      /* A zoomed-out view is only a wider window; a zoomed-in one, narrower. */
      { fromTicks: BAR, toTicks: BAR * 6 },
      { fromTicks: BAR + 100, toTicks: BAR + 200 },
    ];
    for (const window of windows) {
      const [fragment] = phraseFragments([long], window);
      expect(fragment!.phraseId).toBe("p-long");
      expect(fragment!.phraseStartTicks).toBe(0);
      expect(fragment!.phraseEndTicks).toBe(BAR * 6);
    }
  });

  it("shows nothing for a window the phrase does not reach", () => {
    expect(phraseFragments([inside], { fromTicks: BAR, toTicks: BAR * 2 })).toEqual([]);
    expect(phraseFragments([inside], { fromTicks: 0, toTicks: 0 })).toEqual([]);
    expect(phraseFragments(undefined, { fromTicks: 0, toTicks: BAR })).toEqual([]);
  });

  it("draws them in the order they are played, whatever order they were written", () => {
    const fragments = phraseFragments([acrossTwo, inside], {
      fromTicks: 0,
      toTicks: BAR * 2,
    });
    expect(fragments.map((fragment) => fragment.phraseId)).toEqual(["p-inside", "p-two"]);
  });
});

describe("phrases, selections and the boundary between them", () => {
  it("finds the phrase a moment is in, and none outside one", () => {
    expect(phraseAt([inside], 192)?.id).toBe("p-inside");
    expect(phraseAt([inside], 575)?.id).toBe("p-inside");
    /* Half-open: the end tick belongs to whatever comes next. */
    expect(phraseAt([inside], 576)).toBeNull();
    expect(phraseAt([inside], 0)).toBeNull();
  });

  it("lets a selection cross a phrase boundary, and says that it did", () => {
    const phrases = [inside, acrossTwo];
    expect(crossesPhraseBoundary(phrases, { fromTicks: 200, toTicks: 400 })).toBe(false);
    expect(crossesPhraseBoundary(phrases, { fromTicks: 400, toTicks: 800 })).toBe(true);
    /* Neither end in a phrase is not a crossing — there was nothing to cross. */
    expect(crossesPhraseBoundary(phrases, { fromTicks: 1200, toTicks: 1400 })).toBe(false);
  });

  it("recognises phrases that overlap, which nothing may write", () => {
    expect(overlappingPhrases([inside, acrossTwo])).toBe(false);
    expect(
      overlappingPhrases([inside, { id: "p-x", startTicks: 400, endTicks: 900 }]),
    ).toBe(true);
  });
});

describe("phrases survive being written down", () => {
  const section = {
    ...SAMPLE_SONG.sections[0]!,
    phrases: [inside, { ...acrossTwo, name: "Cevap" }],
  };

  it("round-trips through the schema with the same ticks and the same ids", () => {
    const parsed = sectionSchema.parse(section);
    expect(parsed.phrases).toEqual(section.phrases);
    expect(JSON.stringify(sectionSchema.parse(JSON.parse(JSON.stringify(parsed))))).toBe(
      JSON.stringify(parsed),
    );
  });

  it("stays absent in a song that never mentioned one", () => {
    const parsed = sectionSchema.parse(SAMPLE_SONG.sections[0]!);
    expect(parsed.phrases).toBeUndefined();
    expect("phrases" in parsed).toBe(false);
  });

  it("refuses a phrase that ends before it starts", () => {
    expect(
      sectionSchema.safeParse({
        ...section,
        phrases: [{ id: "bad", startTicks: 500, endTicks: 100 }],
      }).success,
    ).toBe(false);
  });
});
