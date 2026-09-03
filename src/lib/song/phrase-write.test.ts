/**
 * A phrase is not a selection and not a measure (2V-B.4 §10, §11).
 *
 * The distinction is the whole point. A selection is a range the reader is
 * holding *now*; a phrase is a region that stays after they let go. A measure
 * is the meter's division and a phrase is under no obligation to agree with
 * it. This file is where those three claims are checked as behaviour rather
 * than as prose in a header.
 */
import { describe, expect, it } from "vitest";

import { measuresTouched, phraseAt, phraseFragments } from "@/lib/song/phrase";
import { namePhrase, nextPhraseName, removePhrase } from "@/lib/song/phrase-write";
import { semanticSnapshot } from "@/lib/song/preserve";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const BAR_TICKS = 768;

function fixture(): Song {
  const lane = (): MelodicSlot[] => Array.from({ length: 8 }, () => null);
  return songSchema.parse({
    ...SAMPLE_SONG,
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane() } },
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane() } },
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane() } },
        ],
      },
    ],
  } satisfies Song);
}

const SECTION = SAMPLE_SONG.sections[0]!.id;
const phrasesOf = (song: Song) => song.sections[0]!.phrases ?? [];

describe("58. naming an idea makes a region, not a selection", () => {
  it("takes the held range exactly as it was given", () => {
    const result = namePhrase(fixture(), {
      sectionId: SECTION,
      fromTicks: 384,
      toTicks: 1536,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [phrase] = phrasesOf(result.song);
    expect(phrase?.startTicks).toBe(384);
    expect(phrase?.endTicks).toBe(1536);
    expect(phrase?.name).toBe("Cümle 1");
  });

  it("lets a phrase cross measure lines, because an idea may", () => {
    const result = namePhrase(fixture(), {
      sectionId: SECTION,
      fromTicks: 384,
      toTicks: 1536,
    });
    if (!result.ok) throw new Error(result.reason);
    const phrase = phrasesOf(result.song)[0]!;
    /* Half of the first measure and all of the second: two measures for one
       idea, which is exactly what a model that equated the two could not say. */
    expect(measuresTouched(phrase, [0, BAR_TICKS, BAR_TICKS * 2], BAR_TICKS * 3)).toBe(2);

    const longer = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 384, toTicks: 1920 });
    if (!longer.ok) throw new Error(longer.reason);
    expect(
      measuresTouched(phrasesOf(longer.song)[0]!, [0, BAR_TICKS, BAR_TICKS * 2], BAR_TICKS * 3),
    ).toBe(3);
  });

  it("lets a phrase be shorter than a measure too", () => {
    const result = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 96, toTicks: 288 });
    if (!result.ok) throw new Error(result.reason);
    const phrase = phrasesOf(result.song)[0]!;
    expect(measuresTouched(phrase, [0, BAR_TICKS, BAR_TICKS * 2], BAR_TICKS * 3)).toBe(1);
  });

  it("writes no music at all", () => {
    const before = fixture();
    const result = namePhrase(before, { sectionId: SECTION, fromTicks: 0, toTicks: 768 });
    if (!result.ok) throw new Error(result.reason);
    expect(semanticSnapshot(result.song)).toEqual(semanticSnapshot(before));
    expect(result.song.sections[0]!.bars).toEqual(before.sections[0]!.bars);
  });

  it("refuses an overlap rather than trimming one to fit", () => {
    const first = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 0, toTicks: 768 });
    if (!first.ok) throw new Error(first.reason);
    const second = namePhrase(first.song, {
      sectionId: SECTION,
      fromTicks: 384,
      toTicks: 1152,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/cümlenin/u);
    /* Nothing was written, so the first phrase is still exactly itself. */
    expect(phrasesOf(first.song)).toHaveLength(1);
  });

  it("allows two phrases that merely touch", () => {
    const first = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 0, toTicks: 768 });
    if (!first.ok) throw new Error(first.reason);
    const second = namePhrase(first.song, {
      sectionId: SECTION,
      fromTicks: 768,
      toTicks: 1536,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(phrasesOf(second.song).map((phrase) => phrase.name)).toEqual([
      "Cümle 1",
      "Cümle 2",
    ]);
  });

  it("refuses an empty range and an unknown section", () => {
    expect(namePhrase(fixture(), { sectionId: SECTION, fromTicks: 96, toTicks: 96 }).ok).toBe(
      false,
    );
    expect(namePhrase(fixture(), { sectionId: "nope", fromTicks: 0, toTicks: 96 }).ok).toBe(
      false,
    );
  });

  it("takes a name back off without touching the music", () => {
    const named = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 0, toTicks: 768 });
    if (!named.ok) throw new Error(named.reason);
    const dropped = removePhrase(named.song, {
      sectionId: SECTION,
      phraseId: named.phraseId,
    });
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(phrasesOf(dropped.song)).toHaveLength(0);
    expect(semanticSnapshot(dropped.song)).toEqual(semanticSnapshot(named.song));
    /* And says so rather than silently succeeding twice. */
    expect(removePhrase(dropped.song, { sectionId: SECTION, phraseId: named.phraseId }).ok).toBe(
      false,
    );
  });

  it("names the next one after the numbers already used", () => {
    expect(nextPhraseName(undefined)).toBe("Cümle 1");
    expect(nextPhraseName([{ id: "a", name: "Cümle 1", startTicks: 0, endTicks: 1 }])).toBe(
      "Cümle 2",
    );
    expect(
      nextPhraseName([
        { id: "a", name: "Cümle 2", startTicks: 0, endTicks: 1 },
        { id: "b", name: "Cümle 1", startTicks: 1, endTicks: 2 },
      ]),
    ).toBe("Cümle 3");
  });
});

describe("59. a window clips the drawing and never the phrase", () => {
  it("keeps one phrase one phrase across two windows", () => {
    const named = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 384, toTicks: 1536 });
    if (!named.ok) throw new Error(named.reason);
    const phrases = phrasesOf(named.song);

    const left = phraseFragments(phrases, { fromTicks: 0, toTicks: 768 })[0]!;
    const right = phraseFragments(phrases, { fromTicks: 768, toTicks: 1536 })[0]!;

    expect(left.phraseId).toBe(right.phraseId);
    expect(left.phraseStartTicks).toBe(right.phraseStartTicks);
    expect(left.phraseEndTicks).toBe(right.phraseEndTicks);
    /* What differs is only where the ink goes, and the marks that say so. */
    expect(left.continuesAfter).toBe(true);
    expect(left.continuesBefore).toBe(false);
    expect(right.continuesBefore).toBe(true);
  });

  it("makes no phrase at a window edge", () => {
    const named = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 384, toTicks: 1536 });
    if (!named.ok) throw new Error(named.reason);
    const phrases = phrasesOf(named.song);
    for (const window of [
      { fromTicks: 0, toTicks: 768 },
      { fromTicks: 700, toTicks: 900 },
      { fromTicks: 0, toTicks: 2304 },
    ]) {
      expect(phraseFragments(phrases, window)).toHaveLength(1);
    }
    /* And the song still holds exactly one. */
    expect(phrases).toHaveLength(1);
  });

  it("answers which phrase a moment belongs to, half-open", () => {
    const named = namePhrase(fixture(), { sectionId: SECTION, fromTicks: 384, toTicks: 1536 });
    if (!named.ok) throw new Error(named.reason);
    const phrases = phrasesOf(named.song);
    expect(phraseAt(phrases, 383)).toBeNull();
    expect(phraseAt(phrases, 384)?.id).toBe(named.phraseId);
    expect(phraseAt(phrases, 1535)?.id).toBe(named.phraseId);
    expect(phraseAt(phrases, 1536)).toBeNull();
  });
});
