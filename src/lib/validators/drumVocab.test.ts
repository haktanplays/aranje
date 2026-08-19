import { describe, expect, it } from "vitest";

import type { Bar, DrumSlot } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  restSlots,
  section,
  silentDrumSlots,
  song,
} from "@/lib/song/fixtures";
import { validateDrumVocab } from "@/lib/validators/drumVocab";

function drumBar(slots: readonly DrumSlot[]): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 8,
    slots: { drums: [...slots] },
  };
}

describe("drumVocab validator (spec 10.1)", () => {
  it("accepts a silent drum bar", () => {
    const subject = song([drumTrack()], [section([drumBar(silentDrumSlots(8))])]);
    expect(validateDrumVocab(subject)).toEqual([]);
  });

  it("accepts several pieces in one slot (spec 5.4)", () => {
    const slots = silentDrumSlots(8);
    slots[0] = [{ piece: "kick" }, { piece: "closed_hat" }, { piece: "crash" }];
    const subject = song([drumTrack()], [section([drumBar(slots)])]);
    expect(validateDrumVocab(subject)).toEqual([]);
  });

  it("accepts every piece in the vocabulary", () => {
    const slots: DrumSlot[] = [
      [{ piece: "kick" }],
      [{ piece: "snare" }],
      [{ piece: "closed_hat" }],
      [{ piece: "open_hat" }],
      [{ piece: "ride" }],
      [{ piece: "crash" }],
      [{ piece: "china" }],
      [{ piece: "tom_high" }],
    ];
    const subject = song([drumTrack()], [section([drumBar(slots)])]);
    expect(validateDrumVocab(subject)).toEqual([]);
  });

  it("rejects a melodic slot on a drum track", () => {
    const subject = song(
      [drumTrack()],
      [
        section([
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { drums: restSlots(8) },
          },
        ]),
      ],
    );
    const issues = validateDrumVocab(subject);
    expect(issues).toHaveLength(8);
    expect(issues[0]?.code).toBe("drumVocab");
    expect(issues[0]?.severity).toBe("error");
  });

  it("rejects a drum hit list on a melodic track", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: silentDrumSlots(8) },
          },
        ]),
      ],
    );
    expect(validateDrumVocab(subject)).toHaveLength(8);
  });

  it("rejects a piece outside the vocabulary", () => {
    const slots = silentDrumSlots(8);
    slots[2] = [{ piece: "cowbell" as DrumSlot[number]["piece"] }];
    const subject = song([drumTrack()], [section([drumBar(slots)])]);
    const issues = validateDrumVocab(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.slotIndex).toBe(2);
    expect(issues[0]?.message).toContain("cowbell");
  });

  it("stays quiet about tracks the song does not declare", () => {
    const subject = song(
      [guitarTrack()],
      [section([drumBar(silentDrumSlots(8))])],
    );
    expect(validateDrumVocab(subject)).toEqual([]);
  });
});
