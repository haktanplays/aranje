/**
 * Moving onset blocks in time (spec 13.1, phase 2E).
 *
 * The move is atomic: either every chosen block lands, or the song comes back
 * untouched with a reason that names the bar and slot in the way.
 */
import { describe, expect, it } from "vitest";

import { applyMoveOnsetGroup, type MoveOnsetGroupCommand, type OnsetMovement } from "@/lib/song/move";
import type { OnsetRef } from "@/lib/song/onset-block";
import {
  REST,
  TIE,
  bar,
  emptyBar,
  note,
  readBar,
  slots,
  song,
} from "@/test/move-fixtures";
import type { Song } from "@/lib/song/schema";

const A3 = () => note("A3", 1, 12);
const C4 = () => note("C4", 1, 15);
const E4 = () => note("E4", 2, 14);

function move(
  target: Song,
  origins: readonly OnsetRef[],
  movement: OnsetMovement,
  sectionId = "s1",
) {
  const command: MoveOnsetGroupCommand = {
    kind: "move_onset_group",
    sectionId,
    trackId: "gtr",
    origins,
    movement,
  };
  return applyMoveOnsetGroup(target, command);
}

function at(barIndex: number, slotIndex: number): OnsetRef {
  return { barIndex, slotIndex };
}

describe("moving one block", () => {
  it("moves a single onset one slot to the right", () => {
    const before = song([bar(slots([A3()]))]);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([".", "A3", ".", ".", ".", ".", ".", "."]);
  });

  it("moves a single onset one slot to the left", () => {
    const before = song([bar(slots([REST, A3()]))]);
    const result = move(before, [at(0, 1)], "previous_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[0]).toBe("A3");
    expect(readBar(result.song, 0)[1]).toBe(".");
  });

  it("crosses the bar line with a slot move", () => {
    const before = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, A3()])),
      bar(slots([])),
    ]);
    const result = move(before, [at(0, 7)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[7]).toBe(".");
    expect(readBar(result.song, 1)[0]).toBe("A3");
  });

  it("takes the whole tie run with the chord", () => {
    const before = song([bar(slots([A3(), TIE, TIE]))]);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([".", "A3", "-", "-", ".", ".", ".", "."]);
  });

  it("moves a whole chord, never one string of it", () => {
    const chord = {
      notes: [
        { pitch: "E3", position: { string: 0, fret: 12 } },
        { pitch: "B3", position: { string: 1, fret: 14 } },
      ],
    };
    const before = song([bar(slots([chord]))]);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[1]).toBe("E3+B3");
  });

  it("moves one bar forward, keeping the slot", () => {
    const before = song([bar(slots([REST, REST, A3()])), bar(slots([]))]);
    const result = move(before, [at(0, 2)], "next_bar");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[2]).toBe(".");
    expect(readBar(result.song, 1)[2]).toBe("A3");
  });

  it("moves one bar back, keeping the slot", () => {
    const before = song([bar(slots([])), bar(slots([REST, REST, A3()]))]);
    const result = move(before, [at(1, 2)], "previous_bar");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[2]).toBe("A3");
    expect(readBar(result.song, 1)[2]).toBe(".");
  });
});

describe("what a move never changes", () => {
  it("keeps velocity, articulation and the written position exactly", () => {
    const rich = {
      notes: [
        {
          pitch: "A3",
          position: { string: 1, fret: 12 },
          velocity: 96,
          articulation: "accent" as const,
        },
      ],
    };
    const before = song([bar(slots([rich]))]);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.song.sections[0]?.bars[0]?.slots.gtr?.[1];
    expect(moved).toEqual(rich);
  });

  it("does not touch the song it was given", () => {
    const before = song([bar(slots([A3(), TIE]))]);
    const snapshot = JSON.stringify(before);
    move(before, [at(0, 0)], "next_slot");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("many blocks at once", () => {
  it("moves a scattered selection together", () => {
    const before = song([bar(slots([A3(), REST, C4(), REST, E4()]))]);
    const result = move(before, [at(0, 4), at(0, 0), at(0, 2)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([
      ".", "A3", ".", "C4", ".", "E4", ".", ".",
    ]);
  });

  it("moves a selection that spans two bars, each to its own neighbour", () => {
    const before = song([
      bar(slots([REST, A3()])),
      bar(slots([REST, C4()])),
      bar(slots([])),
    ]);
    const result = move(before, [at(0, 1), at(1, 1)], "next_bar");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[1]).toBe(".");
    expect(readBar(result.song, 1)[1]).toBe("A3");
    expect(readBar(result.song, 2)[1]).toBe("C4");
  });

  it("lets a block slide into the space another selected block just left", () => {
    // Back to back: without emptying the sources first, the second block would
    // look like it was landing on the first.
    const before = song([bar(slots([A3(), C4(), E4()]))]);
    const result = move(before, [at(0, 0), at(0, 1), at(0, 2)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([
      ".", "A3", "C4", "E4", ".", ".", ".", ".",
    ]);
  });
});

describe("what it refuses, atomically", () => {
  it("refuses when a destination already holds an onset", () => {
    const before = song([bar(slots([A3(), C4()]))]);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("bar 1, slot 2");
  });

  it("refuses when a destination holds someone else's tie", () => {
    // Slot 2 is C4's tie and C4 is not part of the selection, so A3 has
    // nowhere to go: landing there would cut another note short.
    const before = song([bar(slots([C4(), TIE, A3()]))]);
    const result = move(before, [at(0, 2)], "previous_slot");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("uzatması");
    expect(result.error.message).toContain("bar 1, slot 2");
  });

  it("refuses to leave the section at the front", () => {
    const before = song([bar(slots([A3()]))]);
    const result = move(before, [at(0, 0)], "previous_slot");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("dışına");
  });

  it("refuses to leave the section at the back", () => {
    const before = song([bar(slots([REST, REST, REST, REST, REST, REST, REST, A3()]))]);
    const result = move(before, [at(0, 7)], "next_slot");

    expect(result.ok).toBe(false);
  });

  it("refuses a bar move when the neighbouring bar has no such slot", () => {
    const before = song([
      bar(slots([]), 8),
      bar(slots([...Array.from({ length: 12 }, () => REST), A3()], 16), 16),
    ]);
    const result = move(before, [at(1, 12)], "previous_bar");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("13. slotu");
  });

  it("refuses to move into a bar the track is not written in", () => {
    const before = song([bar(slots([REST, REST, A3()])), emptyBar()]);
    const result = move(before, [at(0, 2)], "next_bar");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("yazılı değil");
  });

  it("never lets two selected blocks land on the same slot", () => {
    // A uniform movement shifts every block by the same step, so two blocks
    // that were disjoint stay disjoint. The guard against a shared destination
    // is kept as a guard, and this is the property it guards: whatever the
    // selection and whatever the direction, no slot ever ends up claimed twice.
    const before = song([
      bar(slots([A3(), REST, C4(), TIE, REST, E4()])),
      bar(slots([REST, A3(), REST, REST, C4()])),
      bar(slots([])),
    ]);
    const selections: OnsetRef[][] = [
      [at(0, 0), at(0, 2)],
      [at(0, 0), at(0, 2), at(0, 5)],
      [at(0, 5), at(1, 1)],
      [at(1, 1), at(1, 4)],
      [at(0, 0), at(0, 2), at(0, 5), at(1, 1), at(1, 4)],
    ];
    const movements: OnsetMovement[] = [
      "previous_slot",
      "next_slot",
      "previous_bar",
      "next_bar",
    ];

    let applied = 0;
    for (const origins of selections) {
      for (const movement of movements) {
        const result = move(before, origins, movement);
        if (!result.ok) continue;
        applied += 1;
        const written = [0, 1, 2].flatMap((barIndex) =>
          readBar(result.song, barIndex),
        );
        const onsets = written.filter((token) => token !== "." && token !== "-");
        const sourceOnsets = [0, 1, 2]
          .flatMap((barIndex) => readBar(before, barIndex))
          .filter((token) => token !== "." && token !== "-");
        // Nothing was overwritten: exactly as many onsets came out as went in.
        expect(onsets).toHaveLength(sourceOnsets.length);
      }
    }
    expect(applied).toBeGreaterThan(0);
  });

  it("changes nothing at all when it refuses", () => {
    const before = song([bar(slots([A3(), C4()]))]);
    const snapshot = JSON.stringify(before);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(false);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses an origin that is a tie rather than an onset", () => {
    const before = song([bar(slots([A3(), TIE]))]);
    const result = move(before, [at(0, 1)], "next_slot");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("akor başlangıcı değil");
  });

  it("refuses an origin that is a rest", () => {
    const before = song([bar(slots([A3()]))]);
    expect(move(before, [at(0, 4)], "next_slot").ok).toBe(false);
  });

  it("refuses an empty selection", () => {
    expect(move(song([bar(slots([A3()]))]), [], "next_slot").ok).toBe(false);
  });

  it("refuses a track it cannot edit and a section that is not there", () => {
    const before = song([bar(slots([A3()]))]);
    expect(
      applyMoveOnsetGroup(before, {
        kind: "move_onset_group",
        sectionId: "nope",
        trackId: "gtr",
        origins: [at(0, 0)],
        movement: "next_slot",
      }).ok,
    ).toBe(false);
    expect(
      applyMoveOnsetGroup(before, {
        kind: "move_onset_group",
        sectionId: "s1",
        trackId: "nope",
        origins: [at(0, 0)],
        movement: "next_slot",
      }).ok,
    ).toBe(false);
  });
});

describe("ties are never orphaned", () => {
  it("takes the tie tail along rather than leaving it behind", () => {
    const before = song([bar(slots([REST, A3(), TIE, TIE]))]);
    const result = move(before, [at(0, 1)], "previous_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([
      "A3", "-", "-", ".", ".", ".", ".", ".",
    ]);
  });

  it("moves a block whose tie crosses the bar line, tail and all", () => {
    const before = song([
      bar(slots([REST, REST, REST, REST, REST, REST, REST, A3()])),
      bar([TIE, ...slots([]).slice(1)]),
    ]);
    const result = move(before, [at(0, 7)], "previous_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[6]).toBe("A3");
    expect(readBar(result.song, 0)[7]).toBe("-");
    expect(readBar(result.song, 1)[0]).toBe(".");
  });
});

describe("how a blocked position is named", () => {
  it("counts bars inside the section when nothing else is offered", () => {
    const before = song([bar(slots([])), bar(slots([A3(), C4()]))]);
    const result = move(before, [at(1, 0)], "next_slot");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("bar 2, slot 2");
  });

  it("uses the caller's own numbering when it has one", () => {
    // The tab numbers bars across the whole song, so a section's second bar
    // may be the sixth on screen. The message has to point at what is drawn.
    const before = song([bar(slots([])), bar(slots([A3(), C4()]))]);
    const result = applyMoveOnsetGroup(before, {
      kind: "move_onset_group",
      sectionId: "s1",
      trackId: "gtr",
      origins: [at(1, 0)],
      movement: "next_slot",
      barLabel: (barIndex) => `Bar ${barIndex + 5}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Bar 6, slot 2");
    expect(result.error.message).not.toContain("bar 2,");
  });
});

describe("where the selection ends up", () => {
  it("reports the new start of every block it moved", () => {
    const before = song([bar(slots([A3(), REST, C4()]))]);
    const result = move(before, [at(0, 0), at(0, 2)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.origins).toEqual([at(0, 1), at(0, 3)]);
  });

  it("reports the new bar after a bar move", () => {
    const before = song([bar(slots([REST, A3()])), bar(slots([]))]);
    const result = move(before, [at(0, 1)], "next_bar");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.origins).toEqual([at(1, 1)]);
  });

  it("lets the same selection be moved again, step by step", () => {
    let current = song([bar(slots([A3()]))]);
    let origins = [at(0, 0)];

    for (let step = 0; step < 3; step += 1) {
      const result = move(current, origins, "next_slot");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      current = result.song;
      origins = result.origins;
    }

    expect(readBar(current, 0)[3]).toBe("A3");
    expect(origins).toEqual([at(0, 3)]);
  });
});

describe("the validator chain", () => {
  it("returns the warnings the resulting song carries, without blocking", () => {
    const before = song([bar(slots([A3(), REST, C4()]))]);
    const result = move(before, [at(0, 0)], "next_slot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.warnings)).toBe(true);
    for (const issue of result.warnings) expect(issue.severity).toBe("warning");
  });

  it("gives the same answer, in the same order, every time", () => {
    const before = song([bar(slots([A3(), REST, C4(), REST, E4()]))]);
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(move(before, [at(0, 0), at(0, 2), at(0, 4)], "next_slot")),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("does not care what order the origins were given in", () => {
    const before = song([bar(slots([A3(), REST, C4()]))]);
    const forwards = move(before, [at(0, 0), at(0, 2)], "next_slot");
    const backwards = move(before, [at(0, 2), at(0, 0)], "next_slot");
    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
  });
});
