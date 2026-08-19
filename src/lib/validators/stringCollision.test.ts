import { describe, expect, it } from "vitest";

import type { Bar, Fretboard, MelodicSlot, Track } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";
import { validateStringCollision } from "@/lib/validators/stringCollision";

/** A bar in which the track is not written at all (spec 5.5: silent). */
function absentBar(): Bar {
  return { timeSignature: [4, 4], resolution: 8, slots: {} };
}

function bar(slots: Record<number, MelodicSlot>): Bar {
  const filled = restSlots(8);
  for (const [index, slot] of Object.entries(slots)) {
    filled[Number(index)] = slot;
  }
  return melodicBar("gtr", filled);
}

/** Sustain from the first slot to the end of the bar. */
function held(slot: MelodicSlot): Bar {
  const filled = restSlots(8);
  filled[0] = slot;
  for (let index = 1; index < filled.length; index += 1) filled[index] = "-";
  return melodicBar("gtr", filled);
}

function tiedFrom(first: MelodicSlot): MelodicSlot[] {
  const slots = restSlots(8);
  slots[0] = first;
  return slots;
}

function withBars(bars: readonly Bar[], track: Track = guitarTrack()) {
  return song([track], [section([...bars])]);
}

describe("stringCollision validator (spec 10.1, placements from spec 9.2)", () => {
  it("rejects two independent onsets on the same string", () => {
    const subject = withBars([
      bar({
        0: {
          notes: [
            { pitch: "G2", position: { string: 0, fret: 3 } },
            { pitch: "A2", position: { string: 0, fret: 5 } },
          ],
        },
      }),
    ]);

    // Each position is internally sound, so no other validator sees a problem.
    expect(validateFretboardIntegrity(subject)).toEqual([]);

    const issues = validateStringCollision(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "stringCollision",
      severity: "error",
      sectionId: "s1",
      barIndex: 0,
      trackId: "gtr",
      slotIndex: 0,
    });
    expect(issues[0]?.message).toContain("tel 0");
    expect(issues[0]?.message).toContain("G2");
    expect(issues[0]?.message).toContain("A2");
  });

  it("names one issue per string, however many notes pile up on it", () => {
    const subject = withBars([
      bar({
        0: {
          notes: [
            { pitch: "E2", position: { string: 0, fret: 0 } },
            { pitch: "G2", position: { string: 0, fret: 3 } },
            { pitch: "A2", position: { string: 0, fret: 5 } },
          ],
        },
      }),
    ]);
    const issues = validateStringCollision(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("3 nota");
  });

  it("accepts a chord spread over different strings", () => {
    const subject = withBars([
      bar({
        0: {
          notes: [
            { pitch: "E2", position: { string: 0, fret: 0 } },
            { pitch: "B2", position: { string: 1, fret: 2 } },
            { pitch: "E3", position: { string: 2, fret: 2 } },
          ],
        },
      }),
    ]);
    expect(validateStringCollision(subject)).toEqual([]);
  });

  it("accepts the same pitch deliberately doubled on two strings", () => {
    const explicit = withBars([
      bar({
        0: {
          notes: [
            { pitch: "A2", position: { string: 0, fret: 5 } },
            { pitch: "A2", position: { string: 1, fret: 0 } },
          ],
        },
      }),
    ]);
    expect(validateFretboardIntegrity(explicit)).toEqual([]);
    expect(validateStringCollision(explicit)).toEqual([]);

    // The engine reaches the same answer on its own when nothing is written.
    const computed = withBars([
      bar({ 0: { notes: [{ pitch: "A2" }, { pitch: "A2" }] } }),
    ]);
    const timeline = buildTrackTimeline(computed, "gtr");
    const strings =
      timeline.kind === "fretted"
        ? (timeline.bars[0]?.spans ?? []).map((span) => span.stringIndex)
        : [];
    expect(new Set(strings).size).toBe(2);
    expect(validateStringCollision(computed)).toEqual([]);
  });

  it("lets the engine place a computed note around a written one", () => {
    // A2 is nailed to string 1; G2 has to go somewhere else, and can.
    const subject = withBars([
      bar({
        0: {
          notes: [
            { pitch: "A2", position: { string: 1, fret: 0 } },
            { pitch: "G2" },
          ],
        },
      }),
    ]);
    const timeline = buildTrackTimeline(subject, "gtr");
    const spans = timeline.kind === "fretted" ? (timeline.bars[0]?.spans ?? []) : [];
    expect(spans.map((span) => span.stringIndex).sort()).toEqual([0, 1]);
    expect(validateStringCollision(subject)).toEqual([]);
  });

  it("does not call an unplaceable note a collision", () => {
    // G2 only exists on string 0 of this tuning, and string 0 is taken. The
    // engine returns no placement; that is not a string conflict and this
    // validator says nothing about it.
    const subject = withBars([
      bar({
        0: {
          notes: [
            { pitch: "G2", position: { string: 0, fret: 3 } },
            { pitch: "G2" },
          ],
        },
      }),
    ]);
    const timeline = buildTrackTimeline(subject, "gtr");
    const spans = timeline.kind === "fretted" ? (timeline.bars[0]?.spans ?? []) : [];
    expect(spans.filter((span) => span.fret === null)).toHaveLength(1);
    expect(validateStringCollision(subject)).toEqual([]);
  });

  it("does not count a tie carried across a bar line as a new onset", () => {
    const first = held({ notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] });
    const second = melodicBar("gtr", [
      "-",
      {
        notes: [
          { pitch: "E2", position: { string: 0, fret: 0 } },
          { pitch: "A2", position: { string: 0, fret: 5 } },
        ],
      },
      ...restSlots(6),
    ]);

    const subject = withBars([first, second]);
    const timeline = buildTrackTimeline(subject, "gtr");
    const carried =
      timeline.kind === "fretted" ? (timeline.bars[1]?.spans ?? []) : [];
    expect(carried.some((span) => span.openStart)).toBe(true);

    // Only the real double-onset in bar 2 is reported.
    const issues = validateStringCollision(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ barIndex: 1, slotIndex: 1 });
  });

  it("carries a tie over a section boundary the same way", () => {
    const first = section(
      [held({ notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] })],
      { id: "a", name: "A" },
    );
    const second = section(
      [
        melodicBar("gtr", [
          "-",
          "-",
          {
            notes: [
              { pitch: "E2", position: { string: 0, fret: 0 } },
              { pitch: "A2", position: { string: 0, fret: 5 } },
            ],
          },
          ...restSlots(5),
        ]),
      ],
      { id: "b", name: "B" },
    );

    const subject = song([guitarTrack()], [first, second]);
    const timeline = buildTrackTimeline(subject, "gtr");
    const spans = timeline.kind === "fretted" ? (timeline.bars[1]?.spans ?? []) : [];
    expect(spans.some((span) => span.openStart)).toBe(true);

    const issues = validateStringCollision(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      sectionId: "b",
      barIndex: 0,
      slotIndex: 2,
    });
  });

  it("treats a real onset after a tie as ending the carry, not colliding with it", () => {
    const first = held({ notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] });
    const second = melodicBar("gtr", [
      "-",
      { notes: [{ pitch: "A2", position: { string: 0, fret: 5 } }] },
      ...restSlots(6),
    ]);
    expect(validateStringCollision(withBars([first, second]))).toEqual([]);
  });

  it("stops the carry where the track is not written, and reports nothing for it", () => {
    const sustaining = held({
      notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }],
    });
    const silent = absentBar();
    const resumed = melodicBar("gtr", [
      // A tie with nothing behind it: the carry was cleared by the silent bar.
      ...tiedFrom("-"),
    ]);
    const later = melodicBar("gtr", [
      { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] },
      ...restSlots(7),
    ]);

    const subject = withBars([sustaining, silent, resumed, later]);
    const timeline = buildTrackTimeline(subject, "gtr");
    const afterSilence =
      timeline.kind === "fretted" ? (timeline.bars[2]?.spans ?? []) : [];
    expect(afterSilence).toEqual([]);
    expect(validateStringCollision(subject)).toEqual([]);
  });

  it("works under a capo and an alternate tuning", () => {
    const fretboard: Fretboard = {
      tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
      capo: 2,
    };
    const track = guitarTrack({ fretboard });

    // Capo 2 on a dropped D string: fret 0 sounds E2, fret 3 sounds G2.
    const clash = song(
      [track],
      [
        section([
          bar({
            0: {
              notes: [
                { pitch: "E2", position: { string: 0, fret: 0 } },
                { pitch: "G2", position: { string: 0, fret: 3 } },
              ],
            },
          }),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(clash)).toEqual([]);
    expect(validateStringCollision(clash)).toHaveLength(1);

    const spread = song(
      [track],
      [
        section([
          bar({
            0: {
              notes: [
                { pitch: "E2", position: { string: 0, fret: 0 } },
                { pitch: "B2", position: { string: 1, fret: 0 } },
              ],
            },
          }),
        ]),
      ],
    );
    expect(validateFretboardIntegrity(spread)).toEqual([]);
    expect(validateStringCollision(spread)).toEqual([]);
  });

  it("skips drum tracks, which have no strings", () => {
    const subject = song(
      [drumTrack()],
      [
        section([
          melodicBar("drums", [
            {
              notes: [
                { pitch: "G2", position: { string: 0, fret: 3 } },
                { pitch: "A2", position: { string: 0, fret: 5 } },
              ],
            },
            ...restSlots(7),
          ]),
        ]),
      ],
    );
    expect(validateStringCollision(subject)).toEqual([]);
  });

  it("orders issues by section, bar, slot and string", () => {
    const onString = (stringIndex: number, low: string, high: string) => ({
      notes: [
        { pitch: low, position: { string: stringIndex, fret: 0 } },
        { pitch: high, position: { string: stringIndex, fret: 5 } },
      ],
    });
    // string 0: E2 open, A2 at fret 5. string 2: D3 open, G3 at fret 5.
    const bothStrings: MelodicSlot = {
      notes: [
        ...onString(2, "D3", "G3").notes,
        ...onString(0, "E2", "A2").notes,
      ],
    };

    const subject = song(
      [guitarTrack()],
      [
        section([bar({ 6: onString(0, "E2", "A2") }), bar({ 1: bothStrings })], {
          id: "a",
          name: "A",
        }),
        section([bar({ 0: onString(2, "D3", "G3") })], { id: "b", name: "B" }),
      ],
    );

    expect(validateFretboardIntegrity(subject)).toEqual([]);
    const path = validateStringCollision(subject).map((issue) => [
      issue.sectionId,
      issue.barIndex,
      issue.slotIndex,
      // The string is only in the message, so read it back from there.
      /tel (\d+)/.exec(issue.message)?.[1],
    ]);
    expect(path).toEqual([
      ["a", 0, 6, "0"],
      ["a", 1, 1, "0"],
      ["a", 1, 1, "2"],
      ["b", 0, 0, "2"],
    ]);
  });

  it("is a pure function of the song", () => {
    const subject = withBars([
      bar({
        0: {
          notes: [
            { pitch: "G2", position: { string: 0, fret: 3 } },
            { pitch: "A2", position: { string: 0, fret: 5 } },
          ],
        },
      }),
    ]);
    const before = JSON.stringify(subject);
    expect(validateStringCollision(subject)).toEqual(
      validateStringCollision(subject),
    );
    expect(JSON.stringify(subject)).toBe(before);
  });
});
