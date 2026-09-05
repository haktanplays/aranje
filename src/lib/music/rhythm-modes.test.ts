/**
 * Simple, Pro, and the line between them (2V-D.2 §5, §6).
 *
 * The tests that matter here are the negative ones: that Simple never shows a
 * number a beginner cannot act on, that Pro never opens a metre the format
 * cannot store, and that a closed option still says why.
 */
import { describe, expect, it } from "vitest";

import {
  PRO_DENOMINATORS,
  PRO_NUMERATORS,
  SIMPLE_INTENTS,
  openProMeters,
  proMeterOptions,
  resolveIntent,
  simpleIntent,
} from "@/lib/music/rhythm-modes";
import { RHYTHM_PROFILES } from "@/lib/music/rhythm-profile";
import { isRepresentableGrid, TIME_SIGNATURES } from "@/lib/music/timing";
import { songSchema } from "@/lib/song/schema";

/** The smallest track the schema accepts, so the metre is what is on trial. */
const GUITAR = {
  id: "g",
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "clean",
  volumeDb: 0,
  fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};

describe("354. Simple offers five intents and no vocabulary", () => {
  it("offers exactly the five the brief names", () => {
    expect(SIMPLE_INTENTS.map((intent) => intent.label)).toEqual([
      "Düz 4/4",
      "Üçlemeli 4/4",
      "Karışık 4/4",
      "3/4",
      "6/8",
    ]);
  });

  it("says nothing about resolution, slots, PPQ or a grouping array", () => {
    /*
     * The rule Simple lives or dies by. A beginner meets these strings and
     * nothing else; the moment one of them says "1/16 çözünürlük" or "12
     * slot", Simple has become Pro with fewer options.
     *
     * A metre's own name — "4/4", "6/8" — is not jargon: it is on the front
     * of every songbook they own.
     */
    const banned = [
      /çözünürlük/i,
      /resolution/i,
      /\bslot\b/i,
      /\bPPQ\b/i,
      /\btick\b/i,
      /\blattice\b/i,
      /\d+\+\d+/,
    ];
    for (const intent of SIMPLE_INTENTS) {
      for (const pattern of banned) {
        expect(intent.label, intent.id).not.toMatch(pattern);
        expect(intent.hint, intent.id).not.toMatch(pattern);
      }
    }
  });

  it("resolves every intent to something the Song Contract accepts", () => {
    for (const intent of SIMPLE_INTENTS) {
      const resolved = resolveIntent(intent.id);
      expect(
        isRepresentableGrid(resolved.meter, resolved.resolution),
        intent.id,
      ).toBe(true);
      const total = resolved.grouping.reduce((sum, group) => sum + group, 0);
      expect(total, intent.id).toBe(resolved.meter[0]);
    }
  });

  it("keeps the intents and the grid profiles on different axes", () => {
    /*
     * Both lists have five entries and they are not the same five. The intent
     * says what the bar *is*; the profile says what the pencil writes into it.
     * A round that merged them would give the reader one control answering
     * two questions, which is the exact confusion this phase set out to end.
     */
    const intentLabels = new Set(SIMPLE_INTENTS.map((intent) => intent.label));
    for (const profile of RHYTHM_PROFILES) {
      expect(intentLabels.has(profile.label), profile.id).toBe(false);
    }
  });

  it("gives Karışık 4/4 the same bar as Düz 4/4, and a different promise", () => {
    /* Not a different grid — the lattice does the mixing, one bar at a time,
       through the availability gate. What differs is what happens when a
       triplet arrives, not what is written before one does. */
    expect(resolveIntent("mixed_four").meter).toEqual(resolveIntent("straight_four").meter);
    expect(resolveIntent("mixed_four").resolution).toBe(
      resolveIntent("straight_four").resolution,
    );
    expect(simpleIntent("mixed_four").hint).toContain("üçlemeli");
  });
});

describe("355. Pro evaluates the whole space and opens part of it", () => {
  const options = proMeterOptions();

  it("answers every numerator 2–15 against 4, 8 and 16", () => {
    expect(PRO_NUMERATORS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(PRO_DENOMINATORS).toEqual([4, 8, 16]);
    expect(options).toHaveLength(PRO_NUMERATORS.length * PRO_DENOMINATORS.length);
  });

  it("opens only what the format can actually store", () => {
    /* The honesty gate. A row that opened and then failed to save would be
       worse than one that never opened: the reader would have written the
       bar before finding out. */
    for (const option of openProMeters()) {
      const inContract = TIME_SIGNATURES.some(
        (meter) => meter[0] === option.meter[0] && meter[1] === option.meter[1],
      );
      expect(inContract, `${option.meter[0]}/${option.meter[1]}`).toBe(true);
      expect(option.grids.length).toBeGreaterThan(0);
      expect(option.groupings.length).toBeGreaterThan(0);
    }
    expect(openProMeters()).toHaveLength(TIME_SIGNATURES.length);
  });

  it("closes the rest with a reason, and never with silence", () => {
    for (const option of options) {
      if (option.state === "open") {
        expect(option.reason).toBeNull();
        continue;
      }
      expect(option.reason, `${option.meter[0]}/${option.meter[1]}`).toBeTruthy();
      expect(option.reason).not.toMatch(/slot|tick|resolution|lattice/i);
    }
  });

  it("distinguishes 'cannot be written' from 'cannot be stored'", () => {
    /*
     * Two different closures, and the difference is the next round's work
     * list. 11/16 lands on exact ticks and is simply not in the contract;
     * nothing here can express a metre whose bar is not a whole number of
     * lattice steps, and no schema change would help that one.
     */
    const byName = new Map(
      options.map((option) => [`${option.meter[0]}/${option.meter[1]}`, option]),
    );
    expect(byName.get("11/16")?.state).toBe("not_in_contract");
    expect(byName.get("7/8")?.state).toBe("open");
    expect(byName.get("4/4")?.state).toBe("open");
  });

  it("offers no arbitrary tuplet, polymetre or tempo automation", () => {
    /* Out of scope for this round, and the option shape has nowhere to put
       them — which is the cheapest way to keep them out. */
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual([
        "grids",
        "groupings",
        "meter",
        "reason",
        "state",
      ]);
    }
  });

  it("saves a song in every metre it opens", () => {
    /*
     * The end-to-end version of the honesty gate: not "the table agrees with
     * the table" but "the schema accepts what Pro says it will".
     */
    for (const option of openProMeters()) {
      const grid = option.grids[0]!;
      const parsed = songSchema.safeParse({
        version: 4,
        title: "pro",
        bpm: 120,
        key: "E minor",
        tracks: [GUITAR],
        sections: [
          {
            id: "s",
            name: "S",
            status: "fixed",
            bars: [
              {
                timeSignature: [option.meter[0], option.meter[1]],
                resolution: grid,
                grouping: [...option.groupings[0]!],
                slots: {},
              },
            ],
          },
        ],
      });
      expect(
        parsed.success,
        `${option.meter[0]}/${option.meter[1]} @ ${grid}`,
      ).toBe(true);
    }
  });
});
