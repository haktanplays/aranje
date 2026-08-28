/**
 * What a covered run offers while the reader is writing (K-59 §3, 2U-A §3).
 */
import { describe, expect, it } from "vitest";

import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import { canRun, type SelectionVerb } from "@/lib/song/selection-capability";
import { coveredRun, DRAWER_VERBS } from "@/lib/workspace/selection-verbs";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";

type Time = SelectionSession["time"];

const TRACK = "gtr";

/** Two notes on the low E, and a bar of silence after them. */
function subject(): Song {
  const first: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  first[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
  first[4] = { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] };
  return song(
    [guitarTrack({ id: TRACK })],
    [
      section([
        melodicBar(TRACK, first, { resolution: 16 }),
        melodicBar(TRACK, Array.from({ length: 16 }, () => null), {
          resolution: 16,
        }),
      ]),
    ],
  );
}

const covering = (startTicks: number, endTicks: number) => ({
  sectionId: "s1",
  trackId: TRACK,
  startTicks,
  endTicks,
});

/** A time-selection session that records what was asked of it. */
function fakeTime(
  selection: unknown,
  over: { hasClipboard?: boolean; extendArmed?: boolean } = {},
) {
  const calls: string[] = [];
  const time = {
    handle: {
      selection,
      summary: selection ? { text: "5 nota · 1 ölçü" } : null,
      notice: null,
      error: null,
      hasClipboard: over.hasClipboard ?? false,
      copy: () => calls.push("copy"),
      apply: (command: { kind: string }) => calls.push(`apply:${command.kind}`),
    },
    extendArmed: over.extendArmed ?? false,
    toggleExtend: () => calls.push("extend"),
    openSheet: (kind: string) => calls.push(`sheet:${kind}`),
    clear: () => calls.push("clear"),
  } as unknown as Time;
  return { time, calls };
}

const run = (
  selection: unknown,
  over: { hasClipboard?: boolean; extendArmed?: boolean } = {},
) => {
  const { time, calls } = fakeTime(selection, over);
  return { run: coveredRun({ editing: true, time, song: subject() }), calls };
};

describe("the selection row is offered only when there is one", () => {
  it("offers nothing while the reader is not writing", () => {
    const { time } = fakeTime(covering(0, 48));
    expect(coveredRun({ editing: false, time, song: subject() })).toBeNull();
  });

  it("offers nothing while nothing is covered", () => {
    const { time } = fakeTime(null);
    expect(coveredRun({ editing: true, time, song: subject() })).toBeNull();
  });

  it("says the run in the header and gives it a way out", () => {
    const { time, calls } = fakeTime(covering(0, 48));
    const found = coveredRun({ editing: true, time, song: subject() });
    expect(found?.header.summary).toBe("5 nota · 1 ölçü");
    found?.header.onCancel();
    expect(calls).toEqual(["clear"]);
  });
});

describe("every verb is a handle that already existed", () => {
  it("calls the same command the tall reading bar called", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.onCopy();
    found?.verbs.onCut();
    found?.verbs.onDuplicate();
    found?.verbs.onDelete();
    found?.verbs.onMove();
    found?.verbs.onRepeat();
    expect(calls).toEqual([
      "copy",
      "apply:cut_selection",
      "apply:duplicate_selection",
      "apply:delete_selection",
      "sheet:move",
      "sheet:repeat",
    ]);
  });

  it("carries the selection's own notice and refusal, unchanged", () => {
    const { time } = fakeTime(covering(0, 48));
    const handle = (time as unknown as { handle: Record<string, unknown> }).handle;
    handle.notice = "Bağlantı korundu.";
    handle.error = "Bu seçim taşınamıyor.";
    const found = coveredRun({ editing: true, time, song: subject() });
    expect(found?.verbs.notice).toBe("Bağlantı korundu.");
    expect(found?.verbs.error).toBe("Bu seçim taşınamıyor.");
  });
});

// -------------------------------------------------------------------- §3

describe("“Devam” reaches from the end of what is held", () => {
  /*
   * It used to pick up the pattern-continuation composer tool. That tool is
   * still reachable from the Ritim door; what changed is that a verb on the
   * *selection* toolbar now does something to the selection.
   */
  it("arms the reach rather than staging anything", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.onContinue();
    expect(calls).toEqual(["extend"]);
  });

  it("says when it is armed, so the control can show it", () => {
    expect(run(covering(0, 240)).run?.verbs.extendArmed).toBe(false);
    expect(
      run(covering(0, 240), { extendArmed: true }).run?.verbs.extendArmed,
    ).toBe(true);
  });
});

describe("the drawer offers only what this selection can do", () => {
  const offersOf = (
    selection: unknown,
    over: { hasClipboard?: boolean } = {},
  ) => run(selection, over).run?.verbs.offers ?? [];

  it("never offers a verb that is hidden for this kind of selection", () => {
    const offers = offersOf(covering(0, 48));
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((offer) => offer.state.kind !== "hidden")).toBe(true);
    for (const verb of [
      "insert_bar_before",
      "delete_bar",
      "move_bar_left",
    ] as const) {
      expect(offers.some((offer) => offer.verb === verb), verb).toBe(false);
    }
  });

  /* One note has nothing to be joined to; a run of two does. */
  it("greys “Bağla” on one note and offers it on two", () => {
    const one = offersOf(covering(0, 48));
    expect(canRun(one, "connect")).toBe(false);
    expect(
      one.find((offer) => offer.verb === "connect")?.state,
    ).toEqual({
      kind: "disabled",
      reason: "Bağlamak için en az iki nota gerekiyor.",
    });
    expect(canRun(offersOf(covering(0, 240)), "connect")).toBe(true);
  });

  it("greys the verbs that need notes when the run holds none", () => {
    const empty = offersOf(covering(768, 816));
    for (const verb of ["copy", "cut", "delete", "transpose"] as const) {
      expect(canRun(empty, verb), verb).toBe(false);
    }
  });

  it("greys “Yapıştır” until something has been copied, then offers it", () => {
    expect(canRun(offersOf(covering(0, 48)), "paste")).toBe(false);
    expect(
      canRun(offersOf(covering(0, 48), { hasClipboard: true }), "paste"),
    ).toBe(true);
  });

  /*
   * The drawer's five entries and the model's verbs are named in one place,
   * so an entry cannot end up drawn from a verb the model never answers for.
   */
  it("names a verb the model answers for, for every drawer entry", () => {
    const offers = offersOf(covering(0, 240));
    const known: readonly SelectionVerb[] = offers.map((offer) => offer.verb);
    expect(DRAWER_VERBS).toHaveLength(5);
    for (const entry of DRAWER_VERBS) {
      expect(known, entry.verb).toContain(entry.verb);
    }
  });
});
