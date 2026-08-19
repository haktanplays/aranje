import { describe, expect, it } from "vitest";

import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { validateTrackReferences } from "@/lib/validators/trackReferences";

describe("trackReferences validator (spec 10.1)", () => {
  it("accepts a well formed song", () => {
    const subject = song(
      [guitarTrack(), drumTrack()],
      [section([melodicBar("gtr", restSlots(8))])],
    );
    expect(validateTrackReferences(subject)).toEqual([]);
  });

  it("allows two tracks to share one instrument (spec 5.2)", () => {
    const subject = song(
      [
        guitarTrack({ id: "gtr1", name: "Gitar 1" }),
        guitarTrack({ id: "gtr2", name: "Gitar 2" }),
      ],
      [],
    );
    expect(validateTrackReferences(subject)).toEqual([]);
  });

  it("rejects a duplicate track id", () => {
    const subject = song([guitarTrack(), guitarTrack()], []);
    const issues = validateTrackReferences(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("trackReferences");
    expect(issues[0]?.severity).toBe("error");
  });

  it("rejects an unknown instrument", () => {
    const subject = song([guitarTrack({ instrumentId: "theremin" })], []);
    expect(validateTrackReferences(subject)).toHaveLength(1);
  });

  it("rejects an unknown preset for a known instrument", () => {
    const subject = song([guitarTrack({ presetId: "hyperdrive" })], []);
    const issues = validateTrackReferences(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("hyperdrive");
  });

  it("rejects a bar writing to a track that does not exist", () => {
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("ghost", restSlots(8))])],
    );
    const issues = validateTrackReferences(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.trackId).toBe("ghost");
    expect(issues[0]?.barIndex).toBe(0);
  });

  it("does not complain when a bar omits a track (spec 5.5)", () => {
    const subject = song(
      [guitarTrack(), drumTrack()],
      [section([melodicBar("gtr", restSlots(8))])],
    );
    expect(validateTrackReferences(subject)).toEqual([]);
  });
});
