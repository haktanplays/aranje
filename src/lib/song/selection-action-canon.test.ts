/**
 * The whole matrix, checked as one table (2V-B §4, §5).
 *
 * ## What is being defended
 *
 * Three times now a verb the capability model offered has been missing from a
 * surface that draws — "Yapıştır" in 2U-B, "Devam" in 2V-A.1, and both
 * listening verbs in the read-mode sheet the founder actually opened. Each was
 * found by a person on a phone, and each was found *after* an acceptance run
 * had called the same build green.
 *
 * A test that checks a named button on a named screen would have caught none
 * of them, because in every case the button existed on some other screen. So
 * these are swept: every selection kind, in every mode, against every action,
 * with the invariants asserted over the product rather than over a list of
 * cases someone thought of.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_SELECTION_ACTIONS,
  onSurface,
  placementOf,
  selectionActionCanon,
  type SelectionActionId,
  type SelectionMode,
} from "@/lib/song/selection-action-canon";
import {
  canRun,
  offeredVerbs,
  selectionCapabilities,
  type VerbOffer,
} from "@/lib/song/selection-capability";
import { hasAudibleNotes } from "@/lib/playback/selection-playback";
import { hasExtendTarget } from "@/lib/song/selection-extend";
import {
  describeBarSelection,
  describeTimeSelection,
  type SelectionDescriptor,
} from "@/lib/song/selection-descriptor";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import type { Bar, DrumSlot, MelodicSlot, Song } from "@/lib/song/schema";

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

function twoTrackBar(
  melodic: readonly MelodicSlot[],
  drums: readonly DrumSlot[],
): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: [...melodic], [DRUMS]: [...drums] },
  };
}

/**
 * One song with every shape the matrix names in it.
 *
 * Bar 0 carries a power chord at slot 0, a plain note at 4, a chord at 8 and
 * silence from 12 on; bar 1 is empty melodically and carries drums. Real
 * shapes rather than a fixture per case, so the sweep below is asking about
 * one song the way a reader would.
 */
function matrixSong(): Song {
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

const SONG = matrixSong();

const timeSelection = (
  from: number,
  to: number,
  trackId = GTR,
): SelectionDescriptor => {
  const found = describeTimeSelection(SONG, {
    sectionId: "s1",
    trackId,
    startTicks: from,
    endTicks: to,
  });
  if (!found) throw new Error("fixture has no descriptor");
  return found;
};

const barSelection = (
  scope: "track" | "full",
  startBarIndex: number,
  endBarIndex: number,
): SelectionDescriptor => {
  const found = describeBarSelection(
    SONG,
    scope === "full"
      ? { scope, sectionId: "s1", startBarIndex, endBarIndex }
      : { scope, sectionId: "s1", trackId: GTR, startBarIndex, endBarIndex },
  );
  if (!found) throw new Error("fixture has no bar descriptor");
  return found;
};

/** Every selection kind §5 names, described once. */
const KINDS: readonly {
  readonly name: string;
  readonly descriptor: SelectionDescriptor;
  /** Which rows this selection can appear on. */
  readonly modes: readonly SelectionMode[];
}[] = [
  { name: "tek nota", descriptor: timeSelection(4 * SLOT, 5 * SLOT), modes: ["read", "edit"] },
  { name: "tek chord", descriptor: timeSelection(8 * SLOT, 9 * SLOT), modes: ["read", "edit"] },
  {
    name: "tek power chord",
    descriptor: timeSelection(0, SLOT),
    modes: ["read", "edit"],
  },
  {
    name: "çoklu onset note range",
    descriptor: timeSelection(0, 9 * SLOT),
    modes: ["read", "edit"],
  },
  {
    name: "yalnız es range",
    descriptor: timeSelection(12 * SLOT, 16 * SLOT),
    modes: ["read", "edit"],
  },
  {
    name: "drum onset",
    descriptor: timeSelection(BAR, BAR + SLOT, DRUMS),
    modes: ["read", "edit"],
  },
  {
    name: "drum range",
    descriptor: timeSelection(BAR, BAR + 8 * SLOT, DRUMS),
    modes: ["read", "edit"],
  },
  {
    name: "bölüm sonuna dayanmış range",
    descriptor: timeSelection(15 * SLOT + BAR, 16 * SLOT + BAR),
    modes: ["read", "edit"],
  },
  {
    name: "tek enstrüman ölçü aralığı",
    descriptor: barSelection("track", 0, 0),
    modes: ["measure"],
  },
  {
    name: "tüm enstrümanlar ölçü aralığı",
    descriptor: barSelection("full", 0, 1),
    modes: ["measure"],
  },
];

/** Both clipboard states, since paste's answer is the whole point of one. */
const CLIPBOARDS: readonly { readonly name: string; readonly full: boolean }[] = [
  { name: "pano boş", full: false },
  { name: "pano dolu", full: true },
];

function offersFor(descriptor: SelectionDescriptor, clipboard: boolean): readonly VerbOffer[] {
  return selectionCapabilities(descriptor, {
    hasClipboard: clipboard,
    clipboardScope: clipboard ? (descriptor.scope === "measures" ? "measures" : "range") : null,
    sectionBarCount: 2,
    hasAudibleNotes: hasAudibleNotes(SONG, descriptor),
    hasExtendTarget: hasExtendTarget(SONG, descriptor),
  });
}

/**
 * What each mode's production wiring can actually run (§4).
 *
 * Written out rather than derived, because "which handler exists" is a fact
 * about the surfaces and the point of the sweep is to catch a surface that
 * forgot one. The binding tests in `selection-verbs.test.ts` and the source
 * assertions hold these to the real components.
 */
const HANDLERS: Readonly<Record<SelectionMode, ReadonlySet<SelectionActionId>>> = {
  read: new Set<SelectionActionId>([
    "copy",
    "cut",
    "duplicate",
    "repeat",
    "move",
    "delete",
    "extend",
    "paste",
    "listen_once",
    "listen_loop",
    "more",
  ]),
  edit: new Set<SelectionActionId>([
    "copy",
    "cut",
    "duplicate",
    "repeat",
    "move",
    "delete",
    "extend",
    "connect",
    "paste",
    "listen_once",
    "listen_loop",
    "more",
  ]),
  measure: new Set<SelectionActionId>([
    "copy",
    "cut",
    "duplicate",
    "repeat",
    "move",
    "delete",
    "listen_once",
    "listen_loop",
    "more",
  ]),
};

type Row = {
  readonly kind: string;
  readonly mode: SelectionMode;
  readonly clipboard: string;
  readonly descriptor: SelectionDescriptor;
  readonly offers: readonly VerbOffer[];
  readonly actions: ReturnType<typeof selectionActionCanon>;
};

/** The whole matrix, built once and asserted over many times. */
const MATRIX: readonly Row[] = KINDS.flatMap((kind) =>
  kind.modes.flatMap((mode) =>
    CLIPBOARDS.map((clipboard) => {
      const offers = offersFor(kind.descriptor, clipboard.full);
      return {
        kind: kind.name,
        mode,
        clipboard: clipboard.name,
        descriptor: kind.descriptor,
        offers,
        actions: selectionActionCanon({
          mode,
          offers,
          handlers: HANDLERS[mode],
          barScope: kind.descriptor.barScope,
        }),
      };
    }),
  ),
);

const label = (row: Row) => `${row.kind} · ${row.mode} · ${row.clipboard}`;

describe("the canon covers the whole matrix", () => {
  it("has a row for every selection kind, mode and clipboard state", () => {
    /* Ten kinds; eight are note selections in two modes, two are measures. */
    expect(MATRIX.length).toBe((8 * 2 + 2) * 2);
    expect(new Set(MATRIX.map((row) => row.kind)).size).toBe(10);
  });

  it("offers something on every one of them", () => {
    for (const row of MATRIX) {
      expect(row.actions.length, label(row)).toBeGreaterThan(0);
    }
  });
});

describe("the invariants, over the whole matrix", () => {
  it("never draws the same action twice in one context", () => {
    for (const row of MATRIX) {
      const ids = row.actions.map((action) => action.id);
      expect(new Set(ids).size, label(row)).toBe(ids.length);
    }
  });

  it("never draws an action the surface has no handler for", () => {
    for (const row of MATRIX) {
      for (const action of row.actions) {
        expect(HANDLERS[row.mode].has(action.id), `${label(row)} · ${action.id}`).toBe(
          true,
        );
      }
    }
  });

  it("never hides what the capability model calls available", () => {
    /*
     * The rule the three shipped defects all broke. Every verb the model
     * offers must be drawn *somewhere* in a mode that has a place for it —
     * a row, or the sheet behind it, but never nowhere.
     */
    for (const row of MATRIX) {
      const drawn = new Set(row.actions.map((action) => action.verb));
      for (const id of ALL_SELECTION_ACTIONS) {
        if (placementOf(row.mode, id) === null) continue;
        if (!HANDLERS[row.mode].has(id)) continue;
        const offer = row.actions.find((action) => action.id === id);
        const verb = offer?.verb ?? null;
        if (verb === null) continue;
        if (canRun(row.offers, verb)) {
          expect(drawn.has(verb), `${label(row)} · ${id} available but hidden`).toBe(
            true,
          );
        }
      }
    }
  });

  it("keeps the model's own sentence on every disabled action", () => {
    for (const row of MATRIX) {
      for (const action of row.actions) {
        if (action.availability !== "disabled") {
          expect(action.reason, `${label(row)} · ${action.id}`).toBeUndefined();
          continue;
        }
        const state = row.offers.find((offer) => offer.verb === action.verb)?.state;
        expect(state?.kind, `${label(row)} · ${action.id}`).toBe("disabled");
        expect(action.reason, `${label(row)} · ${action.id}`).toBe(
          state?.kind === "disabled" ? state.reason : null,
        );
      }
    }
  });

  it("never marks an action available that the model would refuse", () => {
    for (const row of MATRIX) {
      for (const action of row.actions) {
        if (action.verb === null) continue;
        expect(
          action.availability === "available",
          `${label(row)} · ${action.id}`,
        ).toBe(canRun(row.offers, action.verb));
      }
    }
  });

  it("says every disabled reason in the reader's own language", () => {
    const forbidden = /tick|slot|scope|descriptor|capability|verb|null|undefined/i;
    for (const row of MATRIX) {
      for (const action of row.actions) {
        if (action.availability !== "disabled") continue;
        expect(action.reason, `${label(row)} · ${action.id}`).toMatch(/[a-zçğıöşü]/i);
        expect(action.reason ?? "", `${label(row)} · ${action.id}`).not.toMatch(
          forbidden,
        );
      }
    }
  });

  it("puts each action on exactly the surface its mode assigns it", () => {
    for (const row of MATRIX) {
      for (const action of row.actions) {
        expect(action.placement, `${label(row)} · ${action.id}`).toBe(
          placementOf(row.mode, action.id),
        );
      }
    }
  });

  it("gives every drawn action a non-empty label and hint", () => {
    for (const row of MATRIX) {
      for (const action of row.actions) {
        expect(action.label.trim().length, `${label(row)} · ${action.id}`).toBeGreaterThan(0);
        expect(action.hint.trim().length, `${label(row)} · ${action.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("placement does not change the answer", () => {
  it("gives one selection the same availability wherever it is drawn", () => {
    /*
     * §4: moving an action between surfaces must not change what the model
     * said about it. The same note selection is asked in both modes and every
     * action they share has to agree.
     */
    for (const kind of KINDS) {
      if (!kind.modes.includes("read") || !kind.modes.includes("edit")) continue;
      for (const clipboard of CLIPBOARDS) {
        const offers = offersFor(kind.descriptor, clipboard.full);
        const read = selectionActionCanon({ mode: "read", offers, handlers: HANDLERS.read });
        const edit = selectionActionCanon({ mode: "edit", offers, handlers: HANDLERS.edit });
        for (const action of read) {
          if (action.verb === null) continue;
          const twin = edit.find((entry) => entry.id === action.id);
          if (!twin) continue;
          expect(
            twin.availability,
            `${kind.name} · ${clipboard.name} · ${action.id}`,
          ).toBe(action.availability);
          expect(twin.reason).toBe(action.reason);
        }
      }
    }
  });

  it("draws the two rows where UI Contract v1 froze them", () => {
    const offers = offersFor(timeSelection(0, 9 * SLOT), true);
    const read = onSurface(
      selectionActionCanon({ mode: "read", offers, handlers: HANDLERS.read }),
      "read_primary",
    ).map((action) => action.label);
    expect(read).toEqual([
      "Kopyala",
      "Kes",
      "Çoğalt",
      "Tekrarla",
      "Taşı",
      "Devam",
      "Sil",
      "Daha fazla",
    ]);

    const edit = onSurface(
      selectionActionCanon({ mode: "edit", offers, handlers: HANDLERS.edit }),
      "edit_primary",
    ).map((action) => action.label);
    expect(edit).toEqual(["Bağla", "Taşı", "Devam", "Daha fazla"]);
  });
});

describe("the sheet the founder opened", () => {
  /*
   * The live FAIL of 2V-B §1, as a unit. A real note-range selection in read
   * mode, and the sheet behind the visible "Daha fazla".
   */
  const sheetFor = (clipboard: boolean) =>
    onSurface(
      selectionActionCanon({
        mode: "read",
        offers: offersFor(timeSelection(0, 9 * SLOT), clipboard),
        handlers: HANDLERS.read,
      }),
      "more_sheet",
    );

  it("carries «Seçimi dinle» and «Seçimden döngü», enabled", () => {
    const sheet = sheetFor(false);
    const once = sheet.filter((action) => action.id === "listen_once");
    const loop = sheet.filter((action) => action.id === "listen_loop");
    expect(once.length).toBe(1);
    expect(loop.length).toBe(1);
    expect(once[0]!.label).toBe("Seçimi dinle");
    expect(loop[0]!.label).toBe("Seçimden döngü");
    expect(once[0]!.availability).toBe("available");
    expect(loop[0]!.availability).toBe("available");
  });

  it("does not repeat «Sil», which is already on the grid in front of it", () => {
    for (const clipboard of [false, true]) {
      const sheet = sheetFor(clipboard);
      expect(sheet.some((action) => action.id === "delete")).toBe(false);
    }
    const grid = onSurface(
      selectionActionCanon({
        mode: "read",
        offers: offersFor(timeSelection(0, 9 * SLOT), false),
        handlers: HANDLERS.read,
      }),
      "read_primary",
    );
    expect(grid.some((action) => action.id === "delete")).toBe(true);
  });

  it("greys «Yapıştır» on an empty clipboard and lights it on a full one", () => {
    const empty = sheetFor(false).find((action) => action.id === "paste");
    const full = sheetFor(true).find((action) => action.id === "paste");
    expect(empty?.availability).toBe("disabled");
    expect(empty?.reason).toBe("Panoda bir şey yok.");
    expect(full?.availability).toBe("available");
  });
});

describe("listening is reachable on a run of whole bars", () => {
  /*
   * §6: the measure surface keeps its two scopes and listening honours them.
   * The capability model has offered `audition` on a measure selection since
   * 2V-A; until now no surface drew it.
   */
  for (const scope of ["track", "full"] as const) {
    it(`on the ${scope} scope, in that scope's own words`, () => {
      const descriptor = barSelection(scope, 0, scope === "full" ? 1 : 0);
      const actions = selectionActionCanon({
        mode: "measure",
        offers: offersFor(descriptor, false),
        handlers: HANDLERS.measure,
        barScope: scope,
      });
      const sheet = onSurface(actions, "more_sheet");
      expect(sheet.map((action) => action.id)).toEqual(["listen_once", "listen_loop"]);
      for (const action of sheet) expect(action.availability).toBe("available");

      /* And the bar verbs still say which scope they are acting in. */
      const del = actions.find((action) => action.id === "delete");
      expect(del?.label).toBe(scope === "full" ? "Ölçüyü kaldır" : "İçeriği sil");
    });
  }

  it("greys the measure row's «Taşı» where neither arrow could move", () => {
    /*
     * A section of two bars, held whole: there is no bar before the first and
     * none after the last, so the door to the two arrows opens onto nothing.
     * It used to stand live and lead there anyway.
     */
    const whole = barSelection("full", 0, 1);
    const actions = selectionActionCanon({
      mode: "measure",
      offers: offersFor(whole, false),
      handlers: HANDLERS.measure,
      barScope: "full",
    });
    const move = actions.find((action) => action.id === "move");
    expect(move?.availability).toBe("disabled");
    expect(move?.reason).toBe("Taşınacak yer yok.");

    /* And it is live where an arrow really could move. */
    const first = selectionActionCanon({
      mode: "measure",
      offers: offersFor(barSelection("track", 0, 0), false),
      handlers: HANDLERS.measure,
      barScope: "track",
    });
    expect(first.find((action) => action.id === "move")?.availability).toBe("available");
  });

  it("plays only the instrument the track scope holds", () => {
    /*
     * Honest scope, measured on the descriptor the plan is built from rather
     * than asserted about the label: a "Bu enstrüman" selection carries one
     * track id, the whole measure carries every one.
     */
    expect(barSelection("track", 0, 0).trackIds).toEqual([GTR]);
    expect(barSelection("full", 0, 1).trackIds).toEqual([GTR, DRUMS]);
  });
});

describe("the two guards the layouts alone cannot reach", () => {
  /*
   * `hidden` and "no handler" are contracts, and the layouts happen never to
   * place a verb that either applies to — so a sweep over the real matrix
   * cannot tell whether the guards are there. Asked directly instead, with an
   * offers list and a handler set made for the question. Both mutants came
   * back green until these existed, and both were my tests' fault.
   */
  const offers = offersFor(timeSelection(0, 9 * SLOT), true);

  it("never draws a verb the model hid, even where the layout places it", () => {
    const hidden = offers.map((offer) =>
      offer.verb === "copy" ? { verb: offer.verb, state: { kind: "hidden" as const } } : offer,
    );
    const drawn = selectionActionCanon({
      mode: "read",
      offers: hidden,
      handlers: HANDLERS.read,
    });
    expect(drawn.some((action) => action.id === "copy")).toBe(false);
    /* And the rest of the row is untouched, so this is not a blanket drop. */
    expect(drawn.some((action) => action.id === "cut")).toBe(true);
  });

  it("never draws an action the surface has no handler for", () => {
    const thin = new Set<SelectionActionId>(
      [...HANDLERS.read].filter((id) => id !== "duplicate"),
    );
    const drawn = selectionActionCanon({ mode: "read", offers, handlers: thin });
    expect(drawn.some((action) => action.id === "duplicate")).toBe(false);
    expect(drawn.some((action) => action.id === "repeat")).toBe(true);
  });

  it("says which actions open another sheet rather than acting at once", () => {
    /*
     * The sheet that drew "Yapıştır" used to close itself on every press,
     * including the press that had just opened the paste sheet behind it. The
     * surfaces read this rather than each keeping a list.
     */
    const drawn = selectionActionCanon({
      mode: "read",
      offers,
      handlers: HANDLERS.read,
    });
    const opens = Object.fromEntries(drawn.map((action) => [action.id, action.opens]));
    expect(opens).toMatchObject({
      move: "sheet",
      repeat: "sheet",
      paste: "sheet",
      more: "sheet",
      copy: "immediate",
      cut: "immediate",
      delete: "immediate",
      extend: "immediate",
      listen_once: "immediate",
      listen_loop: "immediate",
    });
  });
});

describe("what the canon refuses to invent", () => {
  it("draws nothing outside its own vocabulary", () => {
    for (const row of MATRIX) {
      for (const action of row.actions) {
        expect(ALL_SELECTION_ACTIONS, label(row)).toContain(action.id);
      }
    }
  });

  it("hides the note verbs on a run of bars, as the model does", () => {
    for (const row of MATRIX.filter((entry) => entry.mode === "measure")) {
      for (const id of ["extend", "connect", "paste"] as const) {
        expect(row.actions.some((action) => action.id === id), label(row)).toBe(false);
      }
    }
    /* And the model is the one saying so, not this file. */
    const offers = offersFor(barSelection("full", 0, 1), true);
    expect(offeredVerbs(offers).some((offer) => offer.verb === "extend")).toBe(false);
  });

  it("keeps «Devam» disabled with a reason where there is nowhere to reach", () => {
    const stuck = MATRIX.find(
      (row) => row.kind === "bölüm sonuna dayanmış range" && row.mode === "read",
    );
    const extend = stuck?.actions.find((action) => action.id === "extend");
    expect(extend?.availability).toBe("disabled");
    expect(extend?.reason).toBe("Uzatılacak yer kalmadı.");
  });

  it("offers «Devam» on a single power chord", () => {
    const power = MATRIX.find(
      (row) => row.kind === "tek power chord" && row.mode === "read",
    );
    const extend = power?.actions.find((action) => action.id === "extend");
    expect(extend?.availability).toBe("available");
    expect(extend?.label).toBe("Devam");
  });

  it("still offers listening on a range with nothing but rests — greyed", () => {
    const silent = MATRIX.find(
      (row) => row.kind === "yalnız es range" && row.mode === "read",
    );
    const once = silent?.actions.find((action) => action.id === "listen_once");
    expect(once?.availability).toBe("disabled");
    expect(once?.reason).toBe("Bu seçimde dinlenecek nota yok.");
  });

  it("offers listening on a drum selection the melodic count calls empty", () => {
    for (const kind of ["drum onset", "drum range"]) {
      const row = MATRIX.find((entry) => entry.kind === kind && entry.mode === "read");
      const once = row?.actions.find((action) => action.id === "listen_once");
      expect(once?.availability, kind).toBe("available");
    }
  });
});
