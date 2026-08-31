/**
 * What a covered run offers while the reader is writing (K-59 §3, 2U-A §3).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import {
  canRun,
  refusalFor,
  type SelectionVerb,
} from "@/lib/song/selection-capability";
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

/**
 * The two listening intents, recorded rather than performed.
 *
 * They reach the transport in the app; here what matters is that the drawer
 * calls them and that they are offered on the same terms as everything else.
 */
const fakeListening = (calls: string[], looping = false) => ({
  audition: () => calls.push("audition"),
  toggleLoop: () => calls.push("loop"),
  stop: () => calls.push("stop-listening"),
  looping,
});

const cover = (
  selection: unknown,
  editing: boolean,
  calls: string[] = [],
  looping = false,
) => {
  const { time } = fakeTime(selection);
  return coveredRun({
    editing,
    time,
    song: subject(),
    listening: fakeListening(calls, looping),
  });
};

const run = (
  selection: unknown,
  over: { hasClipboard?: boolean; extendArmed?: boolean; looping?: boolean } = {},
) => {
  const { time, calls } = fakeTime(selection, over);
  return {
    run: coveredRun({
      editing: true,
      time,
      song: subject(),
      listening: fakeListening(calls, over.looping ?? false),
    }),
    calls,
  };
};

describe("the selection row is offered only when there is one", () => {
  it("offers nothing while the reader is not writing", () => {
    expect(cover(covering(0, 48), false)).toBeNull();
  });

  it("offers nothing while nothing is covered", () => {
    expect(cover(null, true)).toBeNull();
  });

  it("says the run in the header and gives it a way out", () => {
    const { time, calls } = fakeTime(covering(0, 48));
    const found = coveredRun({
      editing: true,
      time,
      song: subject(),
      listening: fakeListening(calls),
    });
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
    const found = coveredRun({
      editing: true,
      time,
      song: subject(),
      listening: fakeListening([]),
    });
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
   * The founder's target, and the case the other paste test does not reach
   * (2U-B §3).
   *
   * The second bar of the fixture is empty, and an empty selection is exactly
   * what a reader holds when they have chosen somewhere to paste *into*. Every
   * other range verb is greyed there with "Seçimde nota yok." — paste must not
   * be, because it is the one verb whose whole purpose is to put something
   * where there is nothing.
   */
  it("offers paste on an empty target, where the other verbs are greyed", () => {
    const emptyBar = covering(768, 816);
    const offers = offersOf(emptyBar, { hasClipboard: true });
    expect(canRun(offers, "paste")).toBe(true);
    /* And the neighbours it must not be confused with. */
    expect(canRun(offers, "copy")).toBe(false);
    expect(canRun(offers, "delete")).toBe(false);
    expect(refusalFor(offers, "copy")).toBe("Seçimde nota yok.");
    /* With nothing copied it is greyed rather than gone. */
    const withoutClipboard = offersOf(emptyBar);
    expect(canRun(withoutClipboard, "paste")).toBe(false);
    expect(refusalFor(withoutClipboard, "paste")).toBe("Panoda bir şey yok.");
  });

  /*
   * The drawer's entries and the model's verbs are named in one place, so an
   * entry cannot end up drawn from a verb the model never answers for.
   */
  it("names a verb the model answers for, for every drawer entry", () => {
    const offers = offersOf(covering(0, 240));
    const known: readonly SelectionVerb[] = offers.map((offer) => offer.verb);
    for (const entry of DRAWER_VERBS) {
      expect(known, entry.verb).toContain(entry.verb);
    }
  });

  /*
   * The other direction, which is the one that was missing (2U-B §3).
   *
   * The test above asks "is every drawer entry a real verb" — and it passed
   * throughout, because the entries that existed were all real. What nothing
   * asked was the converse: is every verb the model offers actually reachable?
   * "Yapıştır" was not. The model answered `available` for it on an empty
   * target with a full clipboard, the drawer had no entry for it, and the
   * verb was simply undrawable — copy worked, the notice appeared, and the
   * menu that should have used it did not mention it.
   *
   * So: the frozen row plus the drawer must between them reach every verb a
   * range selection is offered. A verb the model offers and no surface draws
   * is a promise the product does not keep.
   */
  it("leaves no offered verb without a surface to draw it on", () => {
    /* What UI Contract v1 froze onto the row itself. */
    const ROW_VERBS: readonly SelectionVerb[] = ["connect", "move_time", "extend"];
    /*
     * The eight movements live behind "Taşı" rather than on a verb of their
     * own (`movement-menu.ts`). Named here rather than waved at, so a verb
     * that stops being in that sheet stops counting as reachable.
     */
    const BEHIND_MOVE: readonly SelectionVerb[] = ["transpose", "restring"];
    const reachable = new Set<SelectionVerb>([
      ...ROW_VERBS,
      ...BEHIND_MOVE,
      ...DRAWER_VERBS.map((entry) => entry.verb),
    ]);

    /* Both clipboard states, because paste is only offered in one of them. */
    for (const hasClipboard of [false, true]) {
      for (const selection of [covering(0, 48), covering(0, 240), covering(0, 0)]) {
        for (const offer of offersOf(selection, { hasClipboard })) {
          expect(
            reachable.has(offer.verb),
            `${offer.verb} is offered (${offer.state.kind}) but no surface draws it`,
          ).toBe(true);
        }
      }
    }
  });
});

// -------------------------------------------------------------------- 2V-A

describe("hearing what is held", () => {
  it("puts both actions in the drawer, not in the frozen row", () => {
    /*
     * UI Contract v1 froze the toolbar at four verbs and a door (§9). These
     * two are things a reader does occasionally, so they live behind the
     * door — and the row is asserted to be exactly what it was.
     */
    const drawn = DRAWER_VERBS.map((entry) => entry.verb);
    expect(drawn).toContain("audition");
    expect(drawn).toContain("loop_selection");

    const toolbar = readFileSync(
      "src/components/workspace/SelectionToolbar.tsx",
      "utf8",
    );
    const row = toolbar.slice(
      toolbar.indexOf('aria-label="Seçim işlemleri"'),
      toolbar.indexOf("Daha fazla"),
    );
    expect(row).not.toContain("audition");
    expect(row).not.toContain("loop_selection");
  });

  it("runs the audition and closes the drawer behind it", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.onAudition();
    expect(calls).toEqual(["audition"]);
  });

  it("asks the loop to start, or to stop when it is already running", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.onLoopSelection();
    expect(calls).toEqual(["loop"]);
  });

  it("reports whether this selection is the one looping", () => {
    expect(run(covering(0, 240)).run?.verbs.loopingSelection).toBe(false);
    expect(
      run(covering(0, 240), { looping: true }).run?.verbs.loopingSelection,
    ).toBe(true);
  });

  it("neither of them stages, previews or applies anything", () => {
    /*
     * §6: the two are entirely ephemeral. The fake session records every
     * command it is asked for, so a listen that quietly staged one would
     * show up as an extra call rather than as a silent write.
     */
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.onAudition();
    found?.verbs.onLoopSelection();
    expect(calls.filter((call) => call.startsWith("apply:"))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("sheet:"))).toEqual([]);
    expect(calls).not.toContain("copy");
  });

  it("says both labels in full Turkish, and the loop says its way out", () => {
    const toolbar = readFileSync(
      "src/components/workspace/SelectionToolbar.tsx",
      "utf8",
    );
    expect(toolbar).toContain('label: "Seçimi dinle"');
    expect(toolbar).toContain('label: "Seçimden döngü"');
    expect(toolbar).toContain('label: "Seçim döngüsünü kapat"');
    /* The running label is the control's own, not a badge beside it (§9). */
    expect(toolbar).toMatch(
      /actions\.loopingSelection\s*\?\s*LOOP_RUNNING/,
    );
  });
});
