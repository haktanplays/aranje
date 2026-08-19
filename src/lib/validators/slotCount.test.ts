import { describe, expect, it } from "vitest";

import { guitarTrack, melodicBar, restSlots, section, song } from "@/lib/song/fixtures";
import { validateSlotCount } from "@/lib/validators/slotCount";

describe("slotCount validator (spec 10.1)", () => {
  it("accepts a 4/4 bar at resolution 8 with eight slots", () => {
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", restSlots(8))])],
    );
    expect(validateSlotCount(subject)).toEqual([]);
  });

  it("accepts a 6/8 bar at resolution 8 with six slots", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar("gtr", restSlots(6), { timeSignature: [6, 8] }),
        ]),
      ],
    );
    expect(validateSlotCount(subject)).toEqual([]);
  });

  it("accepts a 7/8 bar at resolution 16 with fourteen slots", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar("gtr", restSlots(14), {
            timeSignature: [7, 8],
            resolution: 16,
          }),
        ]),
      ],
    );
    expect(validateSlotCount(subject)).toEqual([]);
  });

  it("rejects a short bar and says what was expected", () => {
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", restSlots(7))])],
    );
    const issues = validateSlotCount(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("slotCount");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("8");
    expect(issues[0]?.message).toContain("7");
    expect(issues[0]?.trackId).toBe("gtr");
    expect(issues[0]?.barIndex).toBe(0);
  });

  it("rejects a long bar", () => {
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", restSlots(9))])],
    );
    expect(validateSlotCount(subject)).toHaveLength(1);
  });

  it("rejects a 6/8 bar that still carries eight slots", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([
          melodicBar("gtr", restSlots(8), { timeSignature: [6, 8] }),
        ]),
      ],
    );
    expect(validateSlotCount(subject)).toHaveLength(1);
  });

  it("reports every offending track in a bar", () => {
    const subject = song(
      [guitarTrack(), guitarTrack({ id: "gtr2" })],
      [
        section([
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: restSlots(7), gtr2: restSlots(6) },
          },
        ]),
      ],
    );
    expect(validateSlotCount(subject)).toHaveLength(2);
  });
});
