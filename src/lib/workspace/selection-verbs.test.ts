/**
 * What a covered run offers, and where it is drawn (K-59 §3, 2U-A §3, 2V-B §2).
 *
 * The tests below kept their shape through the canon: they still ask whether
 * a verb is offered, whether the handle it calls is one that already existed,
 * and whether anything the model offers has nowhere to appear. What changed is
 * that the last of those is now asked of *both* surfaces, because the defect
 * that closed this round was a verb reachable on one row and nowhere on the
 * other.
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
import { onSurface } from "@/lib/song/selection-action-canon";
import {
  coveredRun,
  selectionActions,
  selectionOffers,
  selectionRunner,
} from "@/lib/workspace/selection-verbs";
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
    closeSheet: () => calls.push("close-sheet"),
    pasteHere: () => calls.push("paste"),
    clear: () => calls.push("clear"),
  } as unknown as Time;
  return { time, calls };
}

/**
 * The two listening intents, recorded rather than performed.
 *
 * They reach the transport in the app; here what matters is that the surfaces
 * call them and that they are offered on the same terms as everything else.
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

/** What the model says about a selection, without any surface in the way. */
const offersOf = (selection: unknown, over: { hasClipboard?: boolean } = {}) =>
  selectionOffers(subject(), fakeTime(selection, over).time);

/** What one surface would draw for it. */
const drawnOn = (
  selection: unknown,
  mode: "read" | "edit",
  over: { hasClipboard?: boolean; looping?: boolean } = {},
) =>
  selectionActions({
    song: subject(),
    time: fakeTime(selection, over).time,
    mode,
    looping: over.looping ?? false,
  });

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

  it("still draws the tall reading bar when nobody is writing", () => {
    /*
     * The other half of the same rule (2V-B §2). `coveredRun` is null in read
     * mode — that is the compact row's own answer — and the reading surface
     * asks the canon directly, so a reader who never presses "Düzenle" is not
     * a reader with no actions.
     */
    const read = drawnOn(covering(0, 240), "read");
    expect(read.length).toBeGreaterThan(0);
    expect(onSurface(read, "read_primary").length).toBe(8);
  });
});

describe("every action is a handle that already existed", () => {
  it("calls the same command whichever surface asked", () => {
    const { time, calls } = fakeTime(covering(0, 240));
    const runner = selectionRunner({
      time,
      listening: fakeListening(calls),
      openMore: () => calls.push("open-more"),
    });
    for (const id of ["copy", "cut", "duplicate", "delete", "move", "repeat"] as const) {
      runner(id);
    }
    expect(calls).toEqual([
      "copy",
      "apply:cut_selection",
      "apply:duplicate_selection",
      "apply:delete_selection",
      "sheet:move",
      "sheet:repeat",
    ]);
  });

  it("is the same runner behind the compact row", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.run("copy");
    found?.verbs.run("cut");
    expect(calls).toEqual(["copy", "apply:cut_selection"]);
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
    found?.verbs.run("extend");
    expect(calls).toEqual(["extend"]);
  });

  it("says when it is armed, so the control can show it", () => {
    expect(run(covering(0, 240)).run?.verbs.extendArmed).toBe(false);
    expect(
      run(covering(0, 240), { extendArmed: true }).run?.verbs.extendArmed,
    ).toBe(true);
  });

  it("is on both primary rows, not behind a door on either", () => {
    for (const mode of ["read", "edit"] as const) {
      const primary = onSurface(
        drawnOn(covering(0, 240), mode),
        mode === "read" ? "read_primary" : "edit_primary",
      );
      expect(primary.some((entry) => entry.id === "extend"), mode).toBe(true);
    }
  });
});

describe("the surfaces offer only what this selection can do", () => {
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
    expect(one.find((offer) => offer.verb === "connect")?.state).toEqual({
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
   * The rule that was missing, now asked of every surface (2U-B §3, 2V-B §4).
   *
   * "Yapıştır" was offered by the model and undrawable, then "Devam" was, then
   * both listening verbs were — each time on one surface while another drew
   * them fine. So the sweep runs per mode: whatever the model offers must be
   * reachable on the row *that mode* draws, or in the sheet behind it.
   */
  it("leaves no offered verb without a surface to draw it on, in either mode", () => {
    /*
     * The eight movements live behind "Taşı" rather than on verbs of their
     * own (`movement-menu.ts`). Named here rather than waved at, so a verb
     * that stops being in that sheet stops counting as reachable.
     */
    const BEHIND_MOVE: readonly SelectionVerb[] = ["transpose", "restring"];
    for (const mode of ["read", "edit"] as const) {
      for (const hasClipboard of [false, true]) {
        for (const selection of [covering(0, 48), covering(0, 240), covering(0, 0)]) {
          const drawn = new Set<SelectionVerb>([
            ...BEHIND_MOVE,
            ...drawnOn(selection, mode, { hasClipboard })
              .map((entry) => entry.verb)
              .filter((verb): verb is SelectionVerb => verb !== null),
          ]);
          for (const offer of offersOf(selection, { hasClipboard })) {
            /* "Bağla" is the edit surface's door; read mode has no brush. */
            if (mode === "read" && offer.verb === "connect") continue;
            expect(
              drawn.has(offer.verb),
              `${mode}: ${offer.verb} is offered (${offer.state.kind}) but no surface draws it`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

// -------------------------------------------------------------------- 2V-A

describe("hearing what is held", () => {
  it("is behind the door on both surfaces, never on a frozen row", () => {
    /*
     * UI Contract v1 froze the compact toolbar at four verbs and a door, and
     * the reading grid at eight targets (§9, 2V-A.1 §5). These two are things
     * a reader does occasionally, so they live behind the door on both.
     */
    for (const mode of ["read", "edit"] as const) {
      const drawn = drawnOn(covering(0, 240), mode);
      const sheet = onSurface(drawn, "more_sheet").map((entry) => entry.id);
      expect(sheet, mode).toContain("listen_once");
      expect(sheet, mode).toContain("listen_loop");
      const primary = onSurface(
        drawn,
        mode === "read" ? "read_primary" : "edit_primary",
      ).map((entry) => entry.id);
      expect(primary, mode).not.toContain("listen_once");
      expect(primary, mode).not.toContain("listen_loop");
    }
  });

  it("runs the audition, from either surface's runner", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.run("listen_once");
    expect(calls).toEqual(["audition"]);
  });

  it("asks the loop to start, or to stop when it is already running", () => {
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.run("listen_loop");
    expect(calls).toEqual(["loop"]);
  });

  it("says its own way out while it is running", () => {
    const quiet = drawnOn(covering(0, 240), "edit").find(
      (entry) => entry.id === "listen_loop",
    );
    const running = drawnOn(covering(0, 240), "edit", { looping: true }).find(
      (entry) => entry.id === "listen_loop",
    );
    expect(quiet?.label).toBe("Seçimden döngü");
    expect(running?.label).toBe("Seçim döngüsünü kapat");
  });

  it("neither of them stages, previews or applies anything", () => {
    /*
     * §6: the two are entirely ephemeral. The fake session records every
     * command it is asked for, so a listen that quietly staged one would
     * show up as an extra call rather than as a silent write.
     */
    const { run: found, calls } = run(covering(0, 240));
    found?.verbs.run("listen_once");
    found?.verbs.run("listen_loop");
    expect(calls.filter((call) => call.startsWith("apply:"))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("sheet:"))).toEqual([]);
    expect(calls).not.toContain("copy");
  });
});

// -------------------------------------------------------------------- 2V-B

describe("no surface carries a list of its own", () => {
  /*
   * The four that draw selection actions. `TransformSheet` is not among them
   * any more, which is the point of the third test below — it draws the move,
   * repeat and paste sheets, and their titles echo the verb that opened them
   * rather than listing verbs of their own.
   */
  const SURFACES = [
    "src/components/workspace/SelectionActionBar.tsx",
    "src/components/workspace/SelectionToolbar.tsx",
    "src/components/workspace/SelectionMoreSheet.tsx",
    "src/components/workspace/BarActionBar.tsx",
  ] as const;

  it("names no action label in any component that draws one", () => {
    /*
     * The defect, expressed as a rule. Every one of these files used to spell
     * out its own verbs, and every time one was added to the model somebody
     * had to remember which of them to edit. The words live in the canon now;
     * a component that writes "Seçimi dinle" is a component that has started
     * deciding again.
     */
    const LABELS = [
      "Kopyala",
      "Kes",
      "Çoğalt",
      "Tekrarla",
      "Devam",
      "Bağla",
      "Yapıştır",
      "Seçimi dinle",
      "Seçimden döngü",
      "Seçimi sil",
      "Ölçüyü kaldır",
      "İçeriği sil",
    ];
    for (const file of SURFACES) {
      const source = readFileSync(file, "utf8");
      /* Comments explain the history; only code may not name a verb. */
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const word of LABELS) {
        expect(code, `${file} names "${word}"`).not.toContain(`"${word}"`);
      }
    }
  });

  it("draws whatever the canon placed, in the canon's order", () => {
    const bar = readFileSync("src/components/workspace/SelectionActionBar.tsx", "utf8");
    expect(bar).toContain("actions.map((entry)");
    expect(bar).toContain('data-testid={`selection-action-${entry.id}`}');
    const toolbar = readFileSync(
      "src/components/workspace/SelectionToolbar.tsx",
      "utf8",
    );
    expect(toolbar).toContain('onSurface(actions.actions, "edit_primary")');
    expect(toolbar).toContain('onSurface(actions.actions, "more_sheet")');
  });

  it("gives the reading surface's door the canon's sheet, not a pair of its own", () => {
    /*
     * The live FAIL of §1. The read "Daha fazla" used to be a branch inside
     * `TransformSheet` with "Seçimi sil" and, sometimes, "Yapıştır" in it —
     * one of which is already on the grid the reader pressed the door from.
     */
    const transform = readFileSync(
      "src/components/workspace/TransformSheet.tsx",
      "utf8",
    );
    expect(transform).toContain('kind === "more") return null');
    expect(transform).not.toContain('kind === "more" ? (');

    const area = readFileSync(
      "src/components/workspace/SelectionActionArea.tsx",
      "utf8",
    );
    expect(area).toContain("<SelectionMoreSheet");
    /*
     * The whole prop, not a substring of it. A `.filter(...)` appended to the
     * call satisfies "contains `onSurface(read, "more_sheet")`" while handing
     * the sheet a fixed pair again — which is the defect, and a mutant that
     * did exactly that stayed green until this line was pinned.
     */
    expect(area).toContain('actions={onSurface(read, "more_sheet")}');
    expect(area).toContain('actions={onSurface(read, "read_primary")}');
  });

  it("hands the measure bar the canon too", () => {
    const area = readFileSync(
      "src/components/workspace/SelectionActionArea.tsx",
      "utf8",
    );
    expect(area).toContain("measureActions({ song, bars, looping: listening.looping })");
    const bar = readFileSync("src/components/workspace/BarActionBar.tsx", "utf8");
    expect(bar).toContain('onSurface(actions, "measure_primary")');
    expect(bar).toContain('onSurface(actions, "more_sheet")');
  });
});
