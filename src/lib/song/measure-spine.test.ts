/**
 * Holding bars, and what happens to them (2U-A §9, §10, §11).
 *
 * One test per sentence of the brief, against the cores that answer it: the
 * gesture that decides what is held, the capability answer that decides what
 * is offered, and the transform that decides what is written.
 *
 * The claim these make together is the one §12 asks for — a measure operation
 * either happens once, completely, or does not happen at all and says why.
 */
import { describe, expect, it } from "vitest";

import {
  applyBarCommand,
  type BarCommand,
} from "@/lib/song/bar-transform";
import type { BarSelection } from "@/lib/song/bar-selection";
import {
  createEditHistory,
  currentSong,
  recordEdit,
} from "@/lib/song/edit-history";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  section,
  silentDrumSlots,
  song,
} from "@/lib/song/fixtures";
import {
  barsInSelection,
  measureGestureWanted,
  resolveMeasureGesture,
} from "@/lib/song/measure-gesture";
import {
  canRun,
  refusalFor,
  selectionCapabilities,
} from "@/lib/song/selection-capability";
import { describeBarSelection } from "@/lib/song/selection-descriptor";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import { pointerOwner } from "@/lib/tab/pointer-ownership";

const GTR = "gtr";
const DRM = "drm";

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

/** Four 4/4 bars on a 1/16 grid, guitar and drums, both written in. */
function fixture(): Song {
  const bar = (fret: number) => {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[0] = note("E2", 0, fret);
    slots[8] = note("A2", 1, fret);
    const base = melodicBar(GTR, slots, { resolution: 16 });
    return {
      ...base,
      slots: { ...base.slots, [DRM]: silentDrumSlots(16) },
    };
  };

  return song(
    [guitarTrack({ id: GTR }), drumTrack({ id: DRM })],
    [section([bar(0), bar(3), bar(5), bar(7)])],
  );
}

const BOUNDS = { sectionId: "s1", barCount: 4 };

const full = (start: number, end: number): BarSelection => ({
  scope: "full",
  sectionId: "s1",
  startBarIndex: start,
  endBarIndex: end,
});

const track = (start: number, end: number): BarSelection => ({
  scope: "track",
  sectionId: "s1",
  trackId: GTR,
  startBarIndex: start,
  endBarIndex: end,
});

const capabilities = (selection: BarSelection, sectionBarCount = 4) =>
  selectionCapabilities(describeBarSelection(fixture(), selection)!, {
    hasClipboard: false,
    clipboardScope: null,
    sectionBarCount,
  });

/** Run a command the way the app does: onto a history, as one step. */
function run(subject: Song, selection: BarSelection, command: BarCommand) {
  const history = createEditHistory(subject);
  const result = applyBarCommand(subject, selection, command);
  if (!result.ok) return { result, history, steps: 0 };
  const next = recordEdit(history, result.song, {
    kind: "bar_transform",
    command: command.kind,
    scope: selection.scope,
  });
  return { result, history: next, steps: next.snapshots.length - 1 };
}

// --------------------------------------------------------------------- §9

describe("§9 · who owns a press on a bar's header", () => {
  it("gives the header to the measure gesture even with a pen armed", () => {
    expect(
      pointerOwner({
        onMeasureHeader: true,
        penArmed: true,
        selectionAvailable: true,
      }),
    ).toBe("measure");
  });

  /* A handle is held; a header is only pressed. The handle keeps the drag. */
  it("still yields to a duration handle, which is a thing being held", () => {
    expect(
      pointerOwner({
        onDurationHandle: true,
        onMeasureHeader: true,
        penArmed: false,
        selectionAvailable: true,
      }),
    ).toBe("duration");
  });

  it("leaves the staff to the pen and the time selection as before", () => {
    expect(
      pointerOwner({ penArmed: true, selectionAvailable: true }),
    ).toBe("pen");
    expect(
      pointerOwner({ penArmed: false, selectionAvailable: true }),
    ).toBe("selection");
  });

  it("tells a surface in one word whether to arm the measure gesture", () => {
    expect(measureGestureWanted("measure")).toBe(true);
    for (const owner of ["duration", "pen", "selection", "none"] as const) {
      expect(measureGestureWanted(owner), owner).toBe(false);
    }
  });
});

describe("§9 · a press takes hold of one bar", () => {
  it("takes the bar itself when the press names no instrument", () => {
    const got = resolveMeasureGesture(
      null,
      { kind: "press", sectionId: "s1", barIndex: 2 },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(full(2, 2));
    expect(got.ok && got.barCount).toBe(1);
  });

  it("takes one instrument's bar when the press names one", () => {
    const got = resolveMeasureGesture(
      null,
      { kind: "press", sectionId: "s1", barIndex: 1, trackId: GTR },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(track(1, 1));
  });

  it("lets go of a wider run rather than growing it", () => {
    const got = resolveMeasureGesture(
      full(0, 3),
      { kind: "press", sectionId: "s1", barIndex: 2 },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(full(2, 2));
  });

  it("says so when the same bar is pressed again, and changes nothing", () => {
    const got = resolveMeasureGesture(
      full(2, 2),
      { kind: "press", sectionId: "s1", barIndex: 2 },
      BOUNDS,
    );
    expect(got.ok && got.unchanged).toBe(true);
  });

  it("refuses a bar the section does not have", () => {
    for (const barIndex of [-1, 4, 1.5]) {
      const got = resolveMeasureGesture(
        null,
        { kind: "press", sectionId: "s1", barIndex },
        BOUNDS,
      );
      expect(got.ok, String(barIndex)).toBe(false);
      expect(!got.ok && got.error.code).toBe("bar_out_of_bounds");
    }
  });
});

// -------------------------------------------------------------------- §11

describe("§11 · reaching from one bar to another", () => {
  it("covers every bar between the two, and nothing outside them", () => {
    const got = resolveMeasureGesture(
      full(1, 1),
      { kind: "extend", sectionId: "s1", barIndex: 3, edge: "auto" },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(full(1, 3));
    expect(got.ok && barsInSelection(got.selection)).toEqual([1, 2, 3]);
  });

  /*
   * The point of §11: there is no gesture that makes a selection with a gap
   * in it, because `BarSelection` has no way to hold one.
   */
  it("cannot leave a hole, however far the reach goes", () => {
    const got = resolveMeasureGesture(
      full(0, 0),
      { kind: "extend", sectionId: "s1", barIndex: 3, edge: "end" },
      BOUNDS,
    );
    expect(got.ok && barsInSelection(got.selection)).toEqual([0, 1, 2, 3]);
  });

  it("grows backwards when the reach goes backwards", () => {
    const got = resolveMeasureGesture(
      full(2, 2),
      { kind: "extend", sectionId: "s1", barIndex: 0, edge: "auto" },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(full(0, 2));
  });

  it("shrinks the run when the reach lands inside it", () => {
    const got = resolveMeasureGesture(
      full(0, 3),
      { kind: "extend", sectionId: "s1", barIndex: 1, edge: "start" },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(full(1, 3));
  });

  /* An inside-out range is not a range; the edge stops at the other one. */
  it("never lets one edge cross the other", () => {
    const got = resolveMeasureGesture(
      full(2, 3),
      { kind: "extend", sectionId: "s1", barIndex: 0, edge: "end" },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(full(2, 2));
  });

  it("keeps the scope it was given", () => {
    const got = resolveMeasureGesture(
      track(0, 0),
      { kind: "extend", sectionId: "s1", barIndex: 2, edge: "end" },
      BOUNDS,
    );
    expect(got.ok && got.selection).toEqual(track(0, 2));
  });

  it("refuses to reach into another instrument", () => {
    const got = resolveMeasureGesture(
      track(0, 0),
      { kind: "extend", sectionId: "s1", barIndex: 2, edge: "end", trackId: DRM },
      BOUNDS,
    );
    expect(!got.ok && got.error.code).toBe("crosses_track");
  });

  it("refuses to reach into another section", () => {
    const got = resolveMeasureGesture(
      full(0, 0),
      { kind: "extend", sectionId: "s2", barIndex: 1, edge: "end" },
      BOUNDS,
    );
    expect(!got.ok && got.error.code).toBe("crosses_section");
  });

  it("refuses to reach from nothing", () => {
    const got = resolveMeasureGesture(
      null,
      { kind: "extend", sectionId: "s1", barIndex: 1, edge: "end" },
      BOUNDS,
    );
    expect(!got.ok && got.error.code).toBe("nothing_held");
  });
});

// -------------------------------------------------------------------- §10

describe("§10 · what a whole-bar selection may be asked to do", () => {
  it("offers every measure verb on a whole bar", () => {
    const offers = capabilities(full(1, 1));
    for (const verb of [
      "timing",
      "insert_bar_before",
      "insert_bar_after",
      "duplicate_bar",
      "delete_bar",
      "move_bar_left",
      "move_bar_right",
    ] as const) {
      expect(canRun(offers, verb), verb).toBe(true);
    }
  });

  /*
   * The defect this closes: the capability answer could not tell the two bar
   * scopes apart, so it offered "Ölçü ekle" on one instrument's bar and the
   * core refused it after the press with `not_available_in_scope`.
   */
  it("will not offer to add a bar to one instrument, and says why", () => {
    const offers = capabilities(track(1, 1));
    for (const verb of ["insert_bar_before", "insert_bar_after", "timing"] as const) {
      expect(canRun(offers, verb), verb).toBe(false);
      expect(refusalFor(offers, verb), verb).toBe(
        "Bu işlem için ölçünün tamamı seçilmeli.",
      );
    }
  });

  it("keeps the verbs one instrument's bar really can run", () => {
    const offers = capabilities(track(1, 1));
    for (const verb of [
      "duplicate_bar",
      "delete_bar",
      "move_bar_left",
      "move_bar_right",
    ] as const) {
      expect(canRun(offers, verb), verb).toBe(true);
    }
  });

  /* Every refusal the capability answer gives is one the core agrees with. */
  it("never offers a verb the core would refuse for scope", () => {
    const subject = fixture();
    const commands: readonly {
      verb: "insert_bar_before" | "insert_bar_after";
      command: BarCommand;
    }[] = [
      { verb: "insert_bar_before", command: { kind: "insert_blank_bar_before" } },
      { verb: "insert_bar_after", command: { kind: "insert_blank_bar_after" } },
    ];
    for (const { verb, command } of commands) {
      expect(canRun(capabilities(track(1, 1)), verb), verb).toBe(false);
      const refused = applyBarCommand(subject, track(1, 1), command);
      expect(refused.ok, verb).toBe(false);
      expect(!refused.ok && refused.error.code).toBe("not_available_in_scope");
    }
  });

  it("refuses to delete the last bar of a section, in the reader's words", () => {
    const offers = capabilities(full(0, 0), 1);
    expect(canRun(offers, "delete_bar")).toBe(false);
    expect(refusalFor(offers, "delete_bar")).toBe("Şarkıda en az bir ölçü kalmalı.");
  });

  /*
   * Emptying one instrument's bar leaves the bar standing, so the section
   * cannot run out — offering that refusal there would be greying out a
   * control that works.
   */
  it("still empties one instrument's only bar", () => {
    expect(canRun(capabilities(track(0, 0), 1), "delete_bar")).toBe(true);
  });
});

describe("§10 · a measure operation reaches every track", () => {
  const barsOf = (subject: Song) => subject.sections[0]!.bars;

  /*
   * A bar inserted for one instrument and not the others would put the two
   * lanes out of step for the rest of the song. The blank bar carries no
   * track keys at all, which is silence for every track (5.5) — the point is
   * that it lands in the section once, and both lanes are one bar longer.
   */
  it("makes every lane one bar longer, not just the one that was pressed", () => {
    const subject = fixture();
    const before = barsOf(subject).length;
    const { result } = run(subject, full(1, 1), { kind: "insert_blank_bar_before" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barsOf(result.song)).toHaveLength(before + 1);
    expect(Object.keys(barsOf(result.song)[1]!.slots)).toEqual([]);
    for (const trackId of [GTR, DRM]) {
      expect(Object.keys(barsOf(result.song)[2]!.slots), trackId).toContain(trackId);
    }
  });

  it("removes a bar from every track at once, and no lane is left long", () => {
    const subject = fixture();
    const { result } = run(subject, full(2, 2), { kind: "delete_bars" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bars = barsOf(result.song);
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(Object.keys(bar.slots).sort()).toEqual([DRM, GTR].sort());
    }
  });

  it("moves a run of bars as one block and keeps their order", () => {
    const subject = fixture();
    const before = barsOf(subject).map((bar) => JSON.stringify(bar.slots[GTR]));
    const { result } = run(subject, full(0, 1), { kind: "move_bars_right" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = barsOf(result.song).map((bar) => JSON.stringify(bar.slots[GTR]));
    expect(after).toEqual([before[2], before[0], before[1], before[3]]);
    expect(result.selection).toEqual(full(1, 2));
  });

  it("duplicates a run of bars right after itself", () => {
    const subject = fixture();
    const { result } = run(subject, full(0, 1), { kind: "duplicate_bars" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barsOf(result.song)).toHaveLength(6);
    expect(result.selection).toEqual(full(2, 3));
  });
});

// -------------------------------------------------------------------- §12

describe("§12 · one operation, one step", () => {
  const OPS: readonly { name: string; command: BarCommand }[] = [
    { name: "insert before", command: { kind: "insert_blank_bar_before" } },
    { name: "insert after", command: { kind: "insert_blank_bar_after" } },
    { name: "duplicate", command: { kind: "duplicate_bars" } },
    { name: "delete", command: { kind: "delete_bars" } },
    { name: "move left", command: { kind: "move_bars_left" } },
    { name: "move right", command: { kind: "move_bars_right" } },
  ];

  it("records exactly one history step for each of the six", () => {
    for (const { name, command } of OPS) {
      const { result, steps } = run(fixture(), full(1, 1), command);
      expect(result.ok, name).toBe(true);
      expect(steps, name).toBe(1);
    }
  });

  it("leaves the song it was given untouched, byte for byte", () => {
    for (const { name, command } of OPS) {
      const subject = fixture();
      const before = JSON.stringify(subject);
      applyBarCommand(subject, full(1, 1), command);
      expect(JSON.stringify(subject), name).toBe(before);
    }
  });

  it("writes nothing at all when it refuses", () => {
    const subject = fixture();
    const before = JSON.stringify(subject);
    const history = createEditHistory(subject);

    const refused = applyBarCommand(subject, full(0, 3), { kind: "delete_bars" });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe("section_would_be_empty");
    expect(JSON.stringify(subject)).toBe(before);
    expect(history.snapshots).toHaveLength(1);
    expect(JSON.stringify(currentSong(history))).toBe(before);
  });

  it("refuses to move past either end of the section by name", () => {
    const left = applyBarCommand(fixture(), full(0, 0), { kind: "move_bars_left" });
    const right = applyBarCommand(fixture(), full(3, 3), { kind: "move_bars_right" });
    expect(!left.ok && left.error.code).toBe("no_room_to_move");
    expect(!right.ok && right.error.code).toBe("no_room_to_move");
  });
});
