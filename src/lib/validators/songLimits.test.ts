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

  it("rejects more total bars than the core limit", () => {
    const sections: Section[] = Array.from({ length: 3 }, (_, index) =>
      section(
        Array.from({ length: songLimits.barsPerSection }, () =>
          melodicBar("gtr", restSlots(8)),
        ),
        { id: `s${index}` },
      ),
    );
    const issues = validateSongLimits(song([guitarTrack()], sections));
    expect(issues.some((issue) => issue.message.includes("24"))).toBe(true);
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
  const { voicesAt } = __testing;

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

  it("contributes nothing when a bar opens with a tie", () => {
    expect(voicesAt(["-"], 0)).toBe(0);
  });
});
