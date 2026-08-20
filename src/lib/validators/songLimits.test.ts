import { describe, expect, it } from "vitest";

import { songLimits } from "@/lib/limits";
import type { MelodicSlot, Section } from "@/lib/song/schema";
import {
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { validateSongLimits } from "@/lib/validators/songLimits";
import { __testing } from "@/lib/validators/songLimits";

describe("songLimits validator (spec 10.1, values 6)", () => {
  it("accepts a song inside every limit", () => {
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", restSlots(8))])],
    );
    expect(validateSongLimits(subject)).toEqual([]);
  });

  it("accepts exactly eight tracks", () => {
    const tracks = Array.from({ length: songLimits.maxTracks }, (_, i) =>
      guitarTrack({ id: `t${i}` }),
    );
    expect(validateSongLimits(song(tracks, []))).toEqual([]);
  });

  it("rejects a ninth track", () => {
    const tracks = Array.from({ length: songLimits.maxTracks + 1 }, (_, i) =>
      guitarTrack({ id: `t${i}` }),
    );
    const issues = validateSongLimits(song(tracks, []));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("songLimits");
  });

  /** `count` full sections of `barsPerSection` bars each. */
  const fullSections = (count: number): Section[] =>
    Array.from({ length: count }, (_, index) =>
      section(
        Array.from({ length: songLimits.barsPerSection }, () =>
          melodicBar("gtr", restSlots(8)),
        ),
        { id: `s${index}` },
      ),
    );

  it("rejects more total bars than the core limit", () => {
    // Derived, not written: this used to say "24" and quietly stopped
    // testing anything the moment the limit moved (spec 6, K-25).
    const overBy = songLimits.barsPerSection;
    const count = songLimits.totalBars / songLimits.barsPerSection + 1;
    const issues = validateSongLimits(song([guitarTrack()], fullSections(count)));
    expect(
      issues.some((issue) =>
        issue.message.includes(String(songLimits.totalBars + overBy)),
      ),
    ).toBe(true);
  });

  it("accepts exactly the limit and refuses one bar more", () => {
    const exact = fullSections(songLimits.totalBars / songLimits.barsPerSection);
    expect(validateSongLimits(song([guitarTrack()], exact))).toEqual([]);

    // One bar over, in a section of its own, so only the total is wrong.
    const overBy = [...exact, section([melodicBar("gtr", restSlots(8))], { id: "extra" })];
    const issues = validateSongLimits(song([guitarTrack()], overBy));
    expect(issues).not.toEqual([]);
    expect(issues.some((issue) => issue.message.includes(String(songLimits.totalBars + 1)))).toBe(true);
  });

  it("is the limit phase 2G raised it to", () => {
    // Pinned so a change to the pilot's length is a deliberate edit here.
    expect(songLimits.totalBars).toBe(32);
    expect(songLimits.barsPerSection).toBe(8);
    expect(songLimits.barsPerPatch).toBe(8);
  });

  it("rejects more bars in one section than allowed", () => {
    const bars = Array.from({ length: songLimits.barsPerSection + 1 }, () =>
      melodicBar("gtr", restSlots(8)),
    );
    const issues = validateSongLimits(song([guitarTrack()], [section(bars)]));
    expect(
      issues.some((issue) => issue.message.includes("bölüm başına")),
    ).toBe(true);
  });

  it("rejects more simultaneous voices than allowed", () => {
    const slots = restSlots(8);
    slots[0] = {
      notes: Array.from({ length: songLimits.maxVoicesPerSlot + 1 }, () => ({
        pitch: "E2",
      })),
    };
    const issues = validateSongLimits(
      song([guitarTrack()], [section([melodicBar("gtr", slots)])]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.slotIndex).toBe(0);
  });

  it("counts voices across tracks, not per track", () => {
    const half = Math.ceil((songLimits.maxVoicesPerSlot + 1) / 2);
    const makeSlots = (): MelodicSlot[] => {
      const slots = restSlots(8);
      slots[0] = {
        notes: Array.from({ length: half }, () => ({ pitch: "E2" })),
      };
      return slots;
    };
    const subject = song(
      [guitarTrack(), guitarTrack({ id: "gtr2" })],
      [
        section([
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: makeSlots(), gtr2: makeSlots() },
          },
        ]),
      ],
    );
    expect(validateSongLimits(subject)).toHaveLength(1);
  });
});

describe("voice counting (spec 6)", () => {
  const { voicesAt, carryOut } = __testing;

  it("counts a rest as no voices", () => {
    expect(voicesAt([null], 0)).toBe(0);
  });

  it("counts the notes of a chord", () => {
    expect(voicesAt([{ notes: [{ pitch: "E2" }, { pitch: "B2" }] }], 0)).toBe(2);
  });

  it("counts drum hits in one slot", () => {
    expect(voicesAt([[{ piece: "kick" }, { piece: "crash" }]], 0)).toBe(2);
  });

  it("keeps a tied event sounding", () => {
    const slots: MelodicSlot[] = [
      { notes: [{ pitch: "E2" }, { pitch: "B2" }] },
      "-",
      "-",
    ];
    expect(voicesAt(slots, 1)).toBe(2);
    expect(voicesAt(slots, 2)).toBe(2);
  });

  it("stops sounding after a rest", () => {
    const slots: MelodicSlot[] = [{ notes: [{ pitch: "E2" }] }, null, "-"];
    expect(voicesAt(slots, 2)).toBe(0);
  });

  it("continues the previous bar when a bar opens with a tie", () => {
    expect(voicesAt(["-"], 0, 3)).toBe(3);
    expect(voicesAt(["-", "-"], 1, 3)).toBe(3);
  });

  it("carries nothing in when the previous bar left nothing sounding", () => {
    expect(voicesAt(["-"], 0, 0)).toBe(0);
    expect(voicesAt(["-"], 0)).toBe(0);
  });

  it("ignores the carry once a real event starts in this bar", () => {
    const slots: MelodicSlot[] = [{ notes: [{ pitch: "E2" }] }, "-"];
    expect(voicesAt(slots, 1, 9)).toBe(1);
  });

  it("reports what is still sounding when a bar ends", () => {
    expect(carryOut([{ notes: [{ pitch: "E2" }, { pitch: "B2" }] }, "-"])).toBe(2);
    expect(carryOut([{ notes: [{ pitch: "E2" }] }, null])).toBe(0);
    expect(carryOut(["-", "-"], 4)).toBe(4);
    expect(carryOut([])).toBe(0);
  });
});

describe("voice counting across bars (spec 6)", () => {
  /** A bar whose last slot holds `count` simultaneous notes. */
  function barEndingWithChord(count: number) {
    const slots = restSlots(8);
    slots[7] = {
      notes: Array.from({ length: count }, () => ({ pitch: "E2" })),
    };
    return melodicBar("gtr", slots);
  }

  /** A bar that opens with a tie and then rests. */
  function barOpeningWithTie() {
    const slots = restSlots(8);
    slots[0] = "-";
    return melodicBar("gtr", slots);
  }

  it("keeps a tie at the start of a bar sounding the previous bar's event", () => {
    const over = songLimits.maxVoicesPerSlot + 1;
    const subject = song(
      [guitarTrack()],
      [section([barEndingWithChord(over), barOpeningWithTie()])],
    );
    const issues = validateSongLimits(subject);

    // Both the originating slot and the tied slot in the next bar are over.
    expect(issues).toHaveLength(2);
    expect(issues[0]?.barIndex).toBe(0);
    expect(issues[0]?.slotIndex).toBe(7);
    expect(issues[1]?.barIndex).toBe(1);
    expect(issues[1]?.slotIndex).toBe(0);
  });

  it("carries across a section boundary too", () => {
    const over = songLimits.maxVoicesPerSlot + 1;
    const subject = song(
      [guitarTrack()],
      [
        section([barEndingWithChord(over)], { id: "s1" }),
        section([barOpeningWithTie()], { id: "s2" }),
      ],
    );
    const issues = validateSongLimits(subject);

    expect(issues).toHaveLength(2);
    expect(issues[1]?.sectionId).toBe("s2");
    expect(issues[1]?.barIndex).toBe(0);
    expect(issues[1]?.slotIndex).toBe(0);
  });

  it("stays quiet when the carried event is inside the limit", () => {
    const subject = song(
      [guitarTrack()],
      [section([barEndingWithChord(2), barOpeningWithTie()])],
    );
    expect(validateSongLimits(subject)).toEqual([]);
  });

  it("drops the carry when the next bar omits the track", () => {
    const over = songLimits.maxVoicesPerSlot + 1;
    const silentBar = melodicBar("other", restSlots(8));
    const subject = song(
      [guitarTrack(), guitarTrack({ id: "other" })],
      [
        section([
          barEndingWithChord(over),
          silentBar,
          barOpeningWithTie(),
        ]),
      ],
    );
    const issues = validateSongLimits(subject);

    // Only the originating slot; the track was silent in between, so the tie
    // in the third bar has nothing to continue.
    expect(issues).toHaveLength(1);
    expect(issues[0]?.barIndex).toBe(0);
  });

  it("drops the carry when a rest ends the previous bar", () => {
    const over = songLimits.maxVoicesPerSlot + 1;
    const slots = restSlots(8);
    slots[6] = {
      notes: Array.from({ length: over }, () => ({ pitch: "E2" })),
    };
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", slots), barOpeningWithTie()])],
    );
    const issues = validateSongLimits(subject);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.barIndex).toBe(0);
    expect(issues[0]?.slotIndex).toBe(6);
  });
});
