/**
 * Length, in words a beginner already has (2V-B.4 §6).
 *
 * The measured problem: the sheet that opened on a cell tap led with nine
 * note-value names and a "Süre − ikilik +" stepper. A reader who does not
 * know what an "ikilik" is cannot start, and the app was asking them to
 * learn notation before they could make a sound.
 *
 * So the first surface is verbs — lengthen, shorten, split in three, fit into
 * a beat — and the note value is under "Ayrıntılar". This file is the
 * contract that keeps it that way: the words are checked as words, and the
 * technical reading is checked to be reachable only through the one function
 * that is named after the disclosure it belongs to.
 */
import { describe, expect, it } from "vitest";

import { PPQ } from "@/lib/music/timing";
import {
  DIVIDE_COUNT,
  DURATION_ACTION_IDS,
  DURATION_ACTION_KIND,
  DURATION_ACTION_LABEL,
  densityExplanationFor,
  detailedLength,
  durationOffers,
} from "@/lib/music/duration-language";

/** 4/4 at 1/8, a quarter-note already written, with room to the bar's end. */
const CONTEXT = {
  currentTicks: 192,
  slotTicks: 96,
  beatTicks: 192,
  maxTicks: 768,
  toNextOnsetTicks: 384,
};

/** What the simple surface may never open with (§6). */
const JARGON = [
  "tick",
  "ppq",
  "raw",
  "1/32",
  "1/16",
  "subdivision",
  "slot",
  "resolution",
  "duration",
  "quantis",
];

describe("55. the length verbs are the ones the batch names", () => {
  it("offers exactly the nine priority actions, in one order", () => {
    expect([...DURATION_ACTION_IDS]).toEqual([
      "extend",
      "shorten",
      "split_2",
      "split_3",
      "split_4",
      "to_next_note",
      "half_beat",
      "beat",
      "densify",
    ]);
    expect(DURATION_ACTION_IDS.map((id) => DURATION_ACTION_LABEL[id])).toEqual([
      "Uzat",
      "Kısalt",
      "İkiye böl",
      "Üçe böl",
      "Dörde böl",
      "Sonraki notaya kadar",
      "Yarım vuruşa sığdır",
      "Bir vuruşa sığdır",
      "Bu bölümü sıklaştır",
    ]);
  });

  it("says nothing technical on the first surface", () => {
    const words = [
      ...Object.values(DURATION_ACTION_LABEL),
      ...durationOffers(CONTEXT).flatMap((offer) => [offer.label, offer.reason ?? ""]),
      densityExplanationFor(3),
    ];
    for (const word of words) {
      for (const banned of JARGON) {
        expect(word.toLowerCase(), `"${word}" says "${banned}"`).not.toContain(banned);
      }
      /* And no bare note values either: "1/8", "otuz ikilik" and friends. */
      expect(word).not.toMatch(/\d+\s*\/\s*\d+/u);
    }
  });

  it("keeps the same list whatever the context, and explains the greys", () => {
    const cramped = durationOffers({
      currentTicks: 96,
      slotTicks: 96,
      beatTicks: 192,
      maxTicks: 96,
      toNextOnsetTicks: null,
    });
    expect(cramped).toHaveLength(DURATION_ACTION_IDS.length);
    expect(cramped.map((offer) => offer.id)).toEqual([...DURATION_ACTION_IDS]);
    for (const offer of cramped) {
      if (offer.state === "disabled") {
        expect(offer.reason, offer.id).toBeTruthy();
        expect(offer.reason, offer.id).not.toMatch(/\d+\s*tick/u);
      } else {
        expect(offer.reason, offer.id).toBeUndefined();
      }
    }
    /* And it really is a mixture, so the loop above is not vacuous. */
    expect(cramped.some((offer) => offer.state === "disabled")).toBe(true);
    expect(cramped.some((offer) => offer.state === "available")).toBe(true);
  });

  it("works the lengths out rather than leaving them to the caller", () => {
    const offers = durationOffers(CONTEXT);
    const at = (id: string) => offers.find((offer) => offer.id === id)!;
    expect(at("extend").ticks).toBe(288);
    expect(at("shorten").ticks).toBe(96);
    expect(at("to_next_note").ticks).toBe(384);
    expect(at("half_beat").ticks).toBe(96);
    expect(at("beat").ticks).toBe(192);
    /* A divide is about how many notes, not about one length. */
    for (const id of ["split_2", "split_3", "split_4", "densify"]) {
      expect(at(id).ticks, id).toBeNull();
    }
  });

  it("knows which verbs are divides and how many notes each means", () => {
    expect(DURATION_ACTION_KIND["split_3"]).toBe("divide");
    expect(DURATION_ACTION_KIND["extend"]).toBe("length");
    expect(DURATION_ACTION_KIND["densify"]).toBe("densify");
    expect(DIVIDE_COUNT["split_2"]).toBe(2);
    expect(DIVIDE_COUNT["split_3"]).toBe(3);
    expect(DIVIDE_COUNT["split_4"]).toBe(4);
    expect(DIVIDE_COUNT["extend"]).toBeUndefined();
  });
});

describe("56. the one sentence a fast run shows, and the details it does not", () => {
  it("says the measure does not get longer, in the batch's own words", () => {
    expect(densityExplanationFor(3)).toBe(
      "Aynı süreye 3 nota sığar; ölçünün uzunluğu değişmez.",
    );
    expect(densityExplanationFor(4)).toBe(
      "Aynı süreye 4 nota sığar; ölçünün uzunluğu değişmez.",
    );
  });

  it("keeps the exact value behind a function nobody reaches by accident", () => {
    const detail = detailedLength(PPQ, 96);
    expect(detail).toContain("vuruş");
    expect(detail).toContain("tick");
    /* The technical reading exists — that is the point of Ayrıntılar — and it
       is the only place in this module where it does. */
    expect(detail).toMatch(/\d+ tick/u);
  });
});
