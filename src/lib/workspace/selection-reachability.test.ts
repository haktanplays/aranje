/**
 * The reachability audit (2V-B §10).
 *
 * ## Why the artefact is generated rather than written
 *
 * The last three rounds each ended with a table saying which actions were
 * reachable, and each table was right when it was written. A table a person
 * fills in is a claim about the code; this one is produced *by* the code, so
 * it cannot say "rendered 1" about an action the canon does not place, and it
 * cannot say "handler yes" about an id the runner has no case for.
 *
 * Every column is measured:
 *
 * - `capability` — what `selectionCapabilities` answers for the verb;
 * - `rendered` — how many times the canon places the action on that surface;
 * - `enabled` — the canon's availability;
 * - `handler` — whether the production runner actually calls something;
 * - `result` — what it called.
 *
 * The rules §10 lists are asserted over the rows, and the file is written as
 * a side effect of the run rather than as its purpose: a failing assertion
 * still leaves the table on disk to be read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import {
  onSurface,
  placementOf,
  selectionActionCanon,
  ALL_SELECTION_ACTIONS,
  type SelectionActionId,
  type SelectionMode,
} from "@/lib/song/selection-action-canon";
import {
  canRun,
  offeredVerbs,
  selectionCapabilities,
  type SelectionVerb,
} from "@/lib/song/selection-capability";
import {
  EDIT_HANDLERS,
  MEASURE_HANDLERS,
  READ_HANDLERS,
  selectionRunner,
} from "@/lib/workspace/selection-verbs";
import { hasAudibleNotes } from "@/lib/playback/selection-playback";
import { hasExtendTarget } from "@/lib/song/selection-extend";
import {
  describeBarSelection,
  describeTimeSelection,
  type SelectionDescriptor,
} from "@/lib/song/selection-descriptor";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import type { Bar, DrumSlot, MelodicSlot, Song } from "@/lib/song/schema";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";

const GTR = "gtr";
const DRUMS = "drums";
const SLOT = 48;
const BAR = 768;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

const chord = (
  voices: readonly (readonly [string, number, number])[],
): MelodicSlot => ({
  notes: voices.map(([pitch, string, fret]) => ({ pitch, position: { string, fret } })),
});

function twoTrackBar(melodic: readonly MelodicSlot[], drums: readonly DrumSlot[]): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: [...melodic], [DRUMS]: [...drums] },
  };
}

function auditSong(): Song {
  const first: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  first[0] = chord([
    ["E2", 0, 0],
    ["B2", 1, 2],
    ["E3", 2, 2],
  ]);
  first[4] = note("G2", 0, 3);
  first[8] = chord([
    ["C3", 1, 3],
    ["E3", 2, 2],
    ["G3", 3, 0],
    ["C4", 4, 1],
  ]);
  const second: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  const beat: DrumSlot[] = Array.from({ length: 16 }, (_, index) =>
    index % 4 === 0 ? [{ piece: "kick" as const }] : [],
  );
  const quiet: DrumSlot[] = Array.from({ length: 16 }, () => []);
  return song(
    [guitarTrack({ id: GTR }), drumTrack({ id: DRUMS })],
    [section([twoTrackBar(first, quiet), twoTrackBar(second, beat)], { id: "s1" })],
  );
}

const SONG = auditSong();

const time = (from: number, to: number, trackId = GTR): SelectionDescriptor => {
  const found = describeTimeSelection(SONG, {
    sectionId: "s1",
    trackId,
    startTicks: from,
    endTicks: to,
  });
  if (!found) throw new Error("fixture has no descriptor");
  return found;
};

const bars = (scope: "track" | "full", from: number, to: number): SelectionDescriptor => {
  const found = describeBarSelection(
    SONG,
    scope === "full"
      ? { scope, sectionId: "s1", startBarIndex: from, endBarIndex: to }
      : { scope, sectionId: "s1", trackId: GTR, startBarIndex: from, endBarIndex: to },
  );
  if (!found) throw new Error("fixture has no bar descriptor");
  return found;
};

const KINDS: readonly {
  readonly kind: string;
  readonly descriptor: SelectionDescriptor;
  readonly modes: readonly SelectionMode[];
}[] = [
  { kind: "tek nota", descriptor: time(4 * SLOT, 5 * SLOT), modes: ["read", "edit"] },
  { kind: "tek chord", descriptor: time(8 * SLOT, 9 * SLOT), modes: ["read", "edit"] },
  { kind: "tek power chord", descriptor: time(0, SLOT), modes: ["read", "edit"] },
  { kind: "çoklu onset range", descriptor: time(0, 9 * SLOT), modes: ["read", "edit"] },
  { kind: "yalnız es range", descriptor: time(12 * SLOT, 16 * SLOT), modes: ["read", "edit"] },
  { kind: "drum onset", descriptor: time(BAR, BAR + SLOT, DRUMS), modes: ["read", "edit"] },
  { kind: "drum range", descriptor: time(BAR, BAR + 8 * SLOT, DRUMS), modes: ["read", "edit"] },
  {
    kind: "bölüm sonuna dayanmış range",
    descriptor: time(BAR + 15 * SLOT, BAR + 16 * SLOT),
    modes: ["read", "edit"],
  },
  { kind: "tek enstrüman ölçüsü", descriptor: bars("track", 0, 0), modes: ["measure"] },
  { kind: "tüm enstrümanlar ölçüsü", descriptor: bars("full", 0, 1), modes: ["measure"] },
];

const HANDLERS: Readonly<Record<SelectionMode, ReadonlySet<SelectionActionId>>> = {
  read: READ_HANDLERS,
  edit: EDIT_HANDLERS,
  measure: MEASURE_HANDLERS,
};

/**
 * What the production runner does with each id, recorded rather than assumed.
 *
 * The note surfaces both go through `selectionRunner`, so one recording
 * answers for both. Nothing here is stubbed out of the runner: it is the
 * function the two rows call, driven with a session that writes down what it
 * was asked for instead of doing it.
 */
function runnerResults(): Readonly<Record<string, string>> {
  const calls: string[] = [];
  const session = {
    handle: {
      selection: { sectionId: "s1", trackId: GTR, startTicks: 0, endTicks: SLOT },
      hasClipboard: true,
      copy: () => calls.push("clipboard.copy"),
      apply: (command: { kind: string }) => calls.push(`transform.${command.kind}`),
    },
    extendArmed: false,
    toggleExtend: () => calls.push("selection.toggleExtend"),
    openSheet: (kind: string) => calls.push(`sheet.${kind}`),
    closeSheet: () => calls.push("sheet.close"),
    pasteHere: () => calls.push("clipboard.pasteHere"),
    clear: () => calls.push("selection.clear"),
  } as unknown as SelectionSession["time"];

  const run = selectionRunner({
    time: session,
    listening: {
      audition: () => calls.push("transport.playSelection(once)"),
      toggleLoop: () => calls.push("transport.playSelection(loop)"),
      stop: () => calls.push("transport.stopSelection"),
      looping: false,
    },
    openMore: () => calls.push("sheet.more"),
  });

  const found: Record<string, string> = {};
  for (const id of ALL_SELECTION_ACTIONS) {
    calls.length = 0;
    run(id);
    found[id] = calls[0] ?? "";
  }
  return found;
}

/**
 * What the measure row's wiring does, read out of the production switch.
 *
 * That switch lives in a component and cannot be called from a node test, so
 * the audit reads it — which is still a measurement of the production wiring
 * rather than a table of intentions, and it fails the moment a case is
 * dropped.
 */
function measureResults(): Readonly<Record<string, string>> {
  const source = readFileSync(
    "src/components/workspace/SelectionActionArea.tsx",
    "utf8",
  );
  const block = source.slice(
    source.indexOf("<BarActionBar"),
    source.indexOf("onRepeat={(choice: BarRepeatChoice)"),
  );
  const found: Record<string, string> = {};
  for (const match of block.matchAll(
    /case "([a-z_]+)":\s*(?:\/\/[^\n]*\n\s*)*([^\n;]+)/g,
  )) {
    found[match[1]!] = match[2]!.trim();
  }
  return found;
}

/**
 * The one handler the runner deliberately does not own.
 *
 * `connect` opens the legato brush's door, and only the edit area can open
 * it — so the runner has an empty case and the area wraps it. Read from the
 * area rather than assumed, so a wrapper that stopped wrapping shows up here
 * as an action with no handler.
 */
function connectResult(): string {
  const source = readFileSync("src/components/workspace/EditArea.tsx", "utf8");
  const wrap = source.slice(source.indexOf('id === "connect"'));
  const match = /setDoor\("connect"\)/.exec(wrap.slice(0, 200));
  return match ? "composer.setDoor(connect)" : "";
}

const RUNNER: Readonly<Record<string, string>> = {
  ...runnerResults(),
  connect: connectResult(),
};
const MEASURE = measureResults();

type Row = {
  readonly selection: string;
  readonly mode: SelectionMode;
  readonly surface: string;
  readonly action: SelectionActionId;
  readonly capability: string;
  readonly rendered: number;
  readonly enabled: boolean;
  readonly handler: boolean;
  readonly result: string;
};

const rows: Row[] = [];

for (const entry of KINDS) {
  for (const mode of entry.modes) {
    for (const clipboard of [false, true]) {
      const offers = offeredVerbs(
        selectionCapabilities(entry.descriptor, {
          hasClipboard: clipboard,
          clipboardScope: clipboard
            ? entry.descriptor.scope === "measures"
              ? "measures"
              : "range"
            : null,
          sectionBarCount: 2,
          hasAudibleNotes: hasAudibleNotes(SONG, entry.descriptor),
          hasExtendTarget: hasExtendTarget(SONG, entry.descriptor),
        }),
      );
      const drawn = selectionActionCanon({
        mode,
        offers,
        handlers: HANDLERS[mode],
        barScope: entry.descriptor.barScope,
      });
      for (const id of ALL_SELECTION_ACTIONS) {
        const placement = placementOf(mode, id);
        if (placement === null) continue;
        const drawnHere = drawn.filter((action) => action.id === id);
        const verb = drawnHere[0]?.verb ?? null;
        const result = mode === "measure" ? (MEASURE[id] ?? "") : (RUNNER[id] ?? "");
        rows.push({
          selection: `${entry.kind} · ${clipboard ? "pano dolu" : "pano boş"}`,
          mode,
          surface: placement,
          action: id,
          capability:
            verb === null
              ? "—"
              : (offers.find((offer) => offer.verb === verb)?.state.kind ?? "hidden"),
          rendered: drawnHere.length,
          enabled: drawnHere[0]?.availability === "available",
          handler: HANDLERS[mode].has(id) && result !== "",
          result,
        });
      }
    }
  }
}

afterAll(() => {
  const out = new URL("../../../eval/editor-2vb/artifacts/", import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  writeFileSync(
    `${out}/REACHABILITY.json`,
    `${JSON.stringify(
      {
        generated: "by src/lib/workspace/selection-reachability.test.ts",
        note: "Every column is measured; no row is written by hand.",
        selections: KINDS.length,
        rows: rows.length,
        /* Counted, not claimed — the number this whole round is about. */
        hiddenButAvailable: rows.filter(
          (row) =>
            (row.capability === "available" || row.capability === "disabled") &&
            HANDLERS[row.mode].has(row.action) &&
            row.rendered === 0,
        ).length,
        duplicateRenders: rows.filter((row) => row.rendered > 1).length,
        renderedWithoutHandler: rows.filter((row) => row.rendered > 0 && !row.handler)
          .length,
        table: rows,
      },
      null,
      2,
    )}\n`,
  );
});

describe("the reachability audit", () => {
  it("covers every selection, mode and action the canon can place", () => {
    expect(rows.length).toBeGreaterThan(200);
    expect(new Set(rows.map((row) => row.selection)).size).toBe(KINDS.length * 2);
  });

  it("renders an available action exactly once", () => {
    for (const row of rows) {
      if (row.capability !== "available") continue;
      expect(row.rendered, `${row.selection} · ${row.mode} · ${row.action}`).toBe(1);
    }
  });

  it("renders a disabled action at most once", () => {
    for (const row of rows) {
      if (row.capability !== "disabled") continue;
      expect(
        row.rendered,
        `${row.selection} · ${row.mode} · ${row.action}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("gives every rendered action a handler", () => {
    for (const row of rows) {
      if (row.rendered === 0) continue;
      expect(row.handler, `${row.selection} · ${row.mode} · ${row.action}`).toBe(true);
      expect(row.result, `${row.selection} · ${row.mode} · ${row.action}`).not.toBe("");
    }
  });

  it("leaves no supported action with a rendered count of zero", () => {
    /*
     * The rule the whole round exists for. An action whose capability is
     * `available` or `disabled` on a surface that has a place and a handler
     * for it must be on screen — grey or live, but there.
     */
    const hidden = rows.filter(
      (row) =>
        (row.capability === "available" || row.capability === "disabled") &&
        HANDLERS[row.mode].has(row.action) &&
        row.rendered === 0,
    );
    expect(hidden.map((row) => `${row.selection} · ${row.mode} · ${row.action}`)).toEqual(
      [],
    );
  });

  it("never enables an action the capability model would refuse", () => {
    for (const row of rows) {
      /* The door has no verb of its own; it is judged by what is behind it. */
      if (row.rendered === 0 || row.capability === "—") continue;
      expect(row.enabled, `${row.selection} · ${row.mode} · ${row.action}`).toBe(
        row.capability === "available",
      );
    }
  });

  it("sends each action to the operation it names", () => {
    /*
     * The `handler invoked → expected operation` column, pinned rather than
     * merely non-empty: a runner that sent "Sil" to the copy handle would
     * satisfy every rule above and be catastrophic.
     */
    expect(RUNNER).toMatchObject({
      copy: "clipboard.copy",
      cut: "transform.cut_selection",
      duplicate: "transform.duplicate_selection",
      delete: "transform.delete_selection",
      move: "sheet.move",
      repeat: "sheet.repeat",
      paste: "clipboard.pasteHere",
      extend: "selection.toggleExtend",
      listen_once: "transport.playSelection(once)",
      listen_loop: "transport.playSelection(loop)",
      more: "sheet.more",
      connect: "composer.setDoor(connect)",
    });
    expect(MEASURE).toMatchObject({
      copy: "bars.handle.copy()",
      cut: 'bars.stage({ kind: "cut_bars" })',
      duplicate: 'bars.stage({ kind: "duplicate_bars" })',
      delete: 'bars.stage({ kind: "delete_bars" })',
      listen_once: "listening.audition()",
      listen_loop: "listening.toggleLoop()",
      more: 'bars.setSheet("more")',
    });
  });

  it("finds the two listening actions on every selection that can be heard", () => {
    const audible = rows.filter(
      (row) =>
        (row.action === "listen_once" || row.action === "listen_loop") &&
        row.capability === "available",
    );
    expect(audible.length).toBeGreaterThan(0);
    for (const row of audible) {
      expect(row.rendered, `${row.selection} · ${row.mode} · ${row.action}`).toBe(1);
      expect(row.surface).toBe("more_sheet");
      expect(row.enabled).toBe(true);
    }
  });

  it("finds «Devam» on every note selection with somewhere to reach", () => {
    const reaching = rows.filter(
      (row) => row.action === "extend" && row.capability === "available",
    );
    expect(reaching.length).toBeGreaterThan(0);
    for (const row of reaching) {
      expect(row.rendered).toBe(1);
      expect(row.surface === "read_primary" || row.surface === "edit_primary").toBe(
        true,
      );
    }
  });

  it("finds the clipboard actions wherever the model offers them", () => {
    for (const id of ["copy", "cut", "paste", "duplicate"] as const) {
      const offered = rows.filter(
        (row) => row.action === id && row.capability !== "hidden",
      );
      expect(offered.length, id).toBeGreaterThan(0);
      for (const row of offered) {
        expect(row.rendered, `${row.selection} · ${row.mode} · ${id}`).toBe(1);
      }
    }
  });

  it("agrees with `canRun` on every row", () => {
    /*
     * §4's last line, swept: the UI's enabled state and the model's own
     * answer are the same decision, never two.
     */
    for (const entry of KINDS) {
      for (const mode of entry.modes) {
        for (const clipboard of [false, true]) {
          const offers = offeredVerbs(
            selectionCapabilities(entry.descriptor, {
              hasClipboard: clipboard,
              clipboardScope: clipboard
                ? entry.descriptor.scope === "measures"
                  ? "measures"
                  : "range"
                : null,
              sectionBarCount: 2,
              hasAudibleNotes: hasAudibleNotes(SONG, entry.descriptor),
              hasExtendTarget: hasExtendTarget(SONG, entry.descriptor),
            }),
          );
          for (const action of selectionActionCanon({
            mode,
            offers,
            handlers: HANDLERS[mode],
            barScope: entry.descriptor.barScope,
          })) {
            if (action.verb === null) continue;
            expect(
              action.availability === "available",
              `${entry.kind} · ${mode} · ${action.id}`,
            ).toBe(canRun(offers, action.verb as SelectionVerb));
          }
        }
      }
    }
  });

  it("keeps each surface's contents disjoint", () => {
    for (const mode of ["read", "edit", "measure"] as const) {
      const offers = offeredVerbs(
        selectionCapabilities(time(0, 9 * SLOT), {
          hasClipboard: true,
          clipboardScope: "range",
          sectionBarCount: 2,
          hasAudibleNotes: true,
          hasExtendTarget: true,
        }),
      );
      const drawn = selectionActionCanon({ mode, offers, handlers: HANDLERS[mode] });
      const primary = onSurface(
        drawn,
        mode === "read" ? "read_primary" : mode === "edit" ? "edit_primary" : "measure_primary",
      ).map((action) => action.id);
      const sheet = onSurface(drawn, "more_sheet").map((action) => action.id);
      for (const id of primary) expect(sheet, `${mode}: ${id}`).not.toContain(id);
    }
  });
});
