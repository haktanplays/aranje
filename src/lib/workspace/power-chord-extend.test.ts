/**
 * The founder pressed where "Devam" should have been (2V-A.1 §2).
 *
 * ## What was reported, exactly
 *
 * A real Android phone, `384×740`, `dokunma 5`, on
 * `/eval/editor-acceptance?sha=057f405`. The guide said
 * «2/36 · «Devam»a dokun.», the production selection read
 * «1 power chord · 3 nota», and the actions on screen were
 * `Kopyala · Kes · Çoğalt · Tekrarla · Taşı · Sil · Daha fazla`.
 *
 * Seven of them, and no "Devam".
 *
 * ## Why the obvious suspects are innocent
 *
 * That list is not the compact selection toolbar — that row is
 * `Bağla · Taşı · Devam · Daha fazla` and has carried "Devam" since K-59. It
 * is `SelectionActionBar`, the taller bar the reading surface draws, and its
 * seven verbs are a hard-coded list that has never asked the capability model
 * anything. So the model offering `extend` could not put it on screen, in the
 * same shape as the 2U-B clipboard defect: offered by the model, absent from
 * the list that draws.
 *
 * The tests below pin both halves — that the model does offer it for a power
 * chord, and that the surface the founder was looking at draws it — because
 * fixing either alone leaves the other free to break it again.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import {
  canRun,
  refusalFor,
  selectionCapabilities,
  offeredVerbs,
} from "@/lib/song/selection-capability";
import { hasExtendTarget } from "@/lib/song/selection-extend";
import {
  onSurface,
  selectionActionCanon,
} from "@/lib/song/selection-action-canon";
import { EDIT_HANDLERS, READ_HANDLERS } from "@/lib/workspace/selection-verbs";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";
const SLOT = 48;

/**
 * The acceptance fixture's shape: a power chord on beat one, and a motif.
 *
 * Three notes struck together on the low three strings — the root, the fifth
 * and the octave — which is what `summariseSelection` calls
 * «1 power chord · 3 nota».
 */
function riff(): Song {
  const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  slots[0] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2", position: { string: 1, fret: 2 } },
      { pitch: "E3", position: { string: 2, fret: 2 } },
    ],
  };
  slots[4] = { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] };
  slots[8] = { notes: [{ pitch: "A2", position: { string: 0, fret: 5 } }] };
  return song(
    [guitarTrack({ id: TRACK })],
    [
      section([
        melodicBar(TRACK, slots, { resolution: 16 }),
        melodicBar(TRACK, Array.from({ length: 16 }, () => null), {
          resolution: 16,
        }),
      ]),
    ],
  );
}

const held = (source: Song, startTicks: number, endTicks: number) => {
  const descriptor = describeTimeSelection(source, {
    sectionId: "s1",
    trackId: TRACK,
    startTicks,
    endTicks,
  });
  if (!descriptor) throw new Error("fixture produced no descriptor");
  return descriptor;
};

const context = (source: Song, descriptor = held(source, 0, SLOT)) => ({
  hasClipboard: false,
  clipboardScope: null,
  sectionBarCount: 2,
  hasAudibleNotes: true,
  hasExtendTarget: hasExtendTarget(source, descriptor),
});

describe("the selection the founder was holding", () => {
  it("is one chord of three notes, as the screen said", () => {
    const descriptor = held(riff(), 0, SLOT);
    expect(descriptor.scope).toBe("chord");
    expect(descriptor.onsetCount).toBe(1);
    expect(descriptor.eventIds).toHaveLength(3);
  });

  it("offers «Devam», which is what the guide asked for", () => {
    const source = riff();
    const descriptor = held(source, 0, SLOT);
    const offers = selectionCapabilities(descriptor, context(source, descriptor));
    expect(canRun(offers, "extend")).toBe(true);
  });

  it("keeps the three chord voices together while it is held", () => {
    /* Reaching is not narrowing to one string: the run carries the chord. */
    const source = riff();
    const before = held(source, 0, SLOT);
    const after = held(source, 0, SLOT * 9);
    expect(before.stringIndexes).toEqual([0, 1, 2]);
    expect(after.stringIndexes).toEqual([0, 1, 2]);
    expect(after.eventIds.length).toBeGreaterThan(before.eventIds.length);
  });
});

describe("when there is nowhere to reach to", () => {
  /** One slot, and it is the last one in the section. */
  function ending(): Song {
    const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    slots[15] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    return song(
      [guitarTrack({ id: TRACK })],
      [section([melodicBar(TRACK, slots, { resolution: 16 })])],
    );
  }

  it("says so before the press, in the reader's own words", () => {
    const source = ending();
    const descriptor = held(source, SLOT * 15, SLOT * 16);
    const offers = selectionCapabilities(descriptor, {
      ...context(source, descriptor),
      sectionBarCount: 1,
    });
    expect(canRun(offers, "extend")).toBe(false);
    const reason = refusalFor(offers, "extend");
    expect(reason).toBe("Uzatılacak yer kalmadı.");
    /* The reader's language, not the core's. */
    expect(reason).not.toMatch(/tick|slot|scope|descriptor|extend/i);
  });

  it("is still drawn rather than removed", () => {
    const source = ending();
    const descriptor = held(source, SLOT * 15, SLOT * 16);
    const drawn = offeredVerbs(
      selectionCapabilities(descriptor, {
        ...context(source, descriptor),
        sectionBarCount: 1,
      }),
    ).map((offer) => offer.verb);
    expect(drawn).toContain("extend");
  });
});

describe("the capability matrix «Devam» has to satisfy (§4)", () => {
  const source = riff();

  it("offers it on a single ordinary onset", () => {
    const descriptor = held(source, SLOT * 4, SLOT * 5);
    expect(descriptor.scope).not.toBe("chord");
    expect(
      canRun(selectionCapabilities(descriptor, context(source, descriptor)), "extend"),
    ).toBe(true);
  });

  it("offers it on a single power chord", () => {
    const descriptor = held(source, 0, SLOT);
    expect(descriptor.scope).toBe("chord");
    expect(
      canRun(selectionCapabilities(descriptor, context(source, descriptor)), "extend"),
    ).toBe(true);
  });

  it("offers it on a run of several onsets", () => {
    const descriptor = held(source, 0, SLOT * 9);
    expect(descriptor.onsetCount).toBeGreaterThan(1);
    expect(
      canRun(selectionCapabilities(descriptor, context(source, descriptor)), "extend"),
    ).toBe(true);
  });

  it("offers it on an empty stretch, which is a place to reach from", () => {
    /* Deliberately: "Devam" is a reach, not an edit, and a caret in silence
       is a perfectly good place to reach forward from. */
    const descriptor = held(source, SLOT * 12, SLOT * 13);
    expect(descriptor.eventIds).toHaveLength(0);
    expect(
      canRun(selectionCapabilities(descriptor, context(source, descriptor)), "extend"),
    ).toBe(true);
  });

  it("hides it on whole bars, where the measure verbs answer instead", () => {
    const descriptor = describeTimeSelection(source, {
      sectionId: "s1",
      trackId: TRACK,
      startTicks: 0,
      endTicks: 768,
    });
    if (!descriptor) throw new Error("no descriptor");
    const offers = selectionCapabilities(
      { ...descriptor, scope: "measures", barScope: "track" },
      context(source, descriptor),
    );
    expect(offers.find((offer) => offer.verb === "extend")?.state.kind).toBe("hidden");
  });
});

describe("the surface the founder was looking at", () => {
  /*
   * Asked of the canon rather than grepped out of a component, because since
   * 2V-B there is no list in a component to grep. What these pinned is still
   * pinned — which row draws "Devam", where the door sits, how many targets
   * the grid holds — it is just asked of the thing that decides.
   */
  const tall = readFileSync("src/components/workspace/SelectionActionBar.tsx", "utf8");
  const canon = readFileSync("src/lib/song/selection-action-canon.ts", "utf8");

  const drawn = (mode: "read" | "edit") =>
    selectionActionCanon({
      mode,
      offers: selectionCapabilities(held(riff(), 0, SLOT), context(riff())),
      handlers: mode === "read" ? READ_HANDLERS : EDIT_HANDLERS,
    });

  it("draws «Devam» on the reading surface's own bar", () => {
    const labels = onSurface(drawn("read"), "read_primary").map((entry) => entry.label);
    expect(labels).toContain("Devam");
  });

  it("draws it in the main grid rather than behind «Daha fazla»", () => {
    /* "Daha fazla" stays last: a door after the verbs, not among them. */
    const labels = onSurface(drawn("read"), "read_primary").map((entry) => entry.label);
    expect(labels.at(-1)).toBe("Daha fazla");
    expect(labels.indexOf("Devam")).toBeLessThan(labels.indexOf("Daha fazla"));
    expect(
      onSurface(drawn("read"), "more_sheet").some((entry) => entry.id === "extend"),
    ).toBe(false);
  });

  it("keeps the grid at four columns, so no third row appears", () => {
    /* Eight targets in a four-column grid is two rows, which is what it was. */
    expect(tall).toContain("grid-cols-4");
    expect(onSurface(drawn("read"), "read_primary")).toHaveLength(8);
  });

  it("asks the capability model rather than deciding for itself", () => {
    /* The bar draws the canon's answer, and the canon reads the model. */
    expect(tall).toContain("selection-action-canon");
    expect(tall).not.toContain("selection-capability");
    expect(canon).toContain("selection-capability");
  });

  it("still carries it on the compact toolbar too", () => {
    const labels = onSurface(drawn("edit"), "edit_primary").map((entry) => entry.label);
    expect(labels).toEqual(["Bağla", "Taşı", "Devam", "Daha fazla"]);
  });

  it("keeps every target a finger can hit", () => {
    /*
     * §5: at least 44×44, and asked of the shared constant rather than of a
     * number written here — a bar that hard-coded 44 would pass this and
     * drift the day the constant moves.
     */
    expect(tall).toContain("minHeight: MIN_TOUCH_TARGET_PX");
    expect(tall).toContain("minWidth: MIN_TOUCH_TARGET_PX");
    expect(tall).not.toMatch(/minHeight:\s*\d/);
    expect(tall).not.toMatch(/minWidth:\s*\d/);
  });

  it("calls it «Devam» to a screen reader as well as to an eye", () => {
    /*
     * The accessible name is the verb when the control is live, and the verb
     * plus the model's reason when it is not. A test id in that slot would
     * leave a reader who cannot see the row with nothing to go on.
     */
    expect(tall).toContain(
      "aria-label={off ? `${entry.label} — ${entry.reason}` : entry.label}",
    );
  });
});

describe("what the reach costs the project", () => {
  /*
   * Read from disk. "Devam" writes nothing is a fact about which modules the
   * reach is allowed to touch, and that is exactly the kind of fact that
   * decays the first time somebody needs it to remember something.
   */
  const runner = readFileSync("src/lib/workspace/selection-verbs.ts", "utf8");
  const session = readFileSync("src/lib/workspace/use-selection-session.ts", "utf8");
  const core = readFileSync("src/lib/song/selection-extend.ts", "utf8");

  it("reaches for the session's own arm, not a second algorithm", () => {
    /*
     * §3: use the accepted movement semantics. The bar calls `toggleExtend`,
     * which is the same handle the focused row calls — there is one arm, and
     * the next long press is what moves the edge.
     */
    expect(runner).toContain("time.toggleExtend()");
    expect(session).toContain('moveEdge("end", x)');
  });

  it("moves the far edge, so the run grows from where it started", () => {
    /*
     * Sliced to the armed branch rather than searched for in the whole file:
     * `moveEdge("end", …)` appears elsewhere too, so a file-wide search would
     * stay green with the reach itself moving the *near* edge — which is a
     * selection that walks away from the note the reader was holding.
     */
    const armed = session.slice(session.indexOf("if (extendArmed) {"));
    const branch = armed.slice(0, armed.indexOf("return false;"));
    expect(branch).toContain('moveEdge("end", x)');
    expect(branch).not.toContain('moveEdge("start"');
  });

  it("has no second extension core to drift from the first", () => {
    /* This module answers whether a reach is possible. It does not perform
       one, and a `select`/`commit` here would be the start of the second. */
    expect(core).not.toMatch(/\bcommit\b|\bselect\(|transform\./);
  });

  it("names no command, clipboard, history or storage on the way", () => {
    /*
     * Sliced to the reach's own case rather than searched for in the whole
     * runner: the case above it calls `time.handle.copy()`, so a file-wide
     * search for "copy" would fail on a branch that is innocent, and a
     * file-wide search for "apply(" would pass on one that is not.
     */
    const reach = runner.slice(runner.indexOf('case "extend":'));
    const branch = reach.slice(0, reach.indexOf("return;"));
    for (const forbidden of ["apply(", "commit", "copy", "stage", "localStorage"]) {
      expect(branch, forbidden).not.toContain(forbidden);
    }
  });

  it("moves the edge without writing, and says so where it is done", () => {
    const move = session.slice(session.indexOf("const moveEdge"));
    const body = move.slice(0, move.indexOf("const onHandleMove"));
    expect(body).toContain("transform.select(next)");
    expect(body).not.toContain("commit(");
    expect(body).not.toContain("apply(");
  });
});

describe("the screen and the model give one answer", () => {
  /*
   * §4's last line. The bar draws a control as disabled exactly when the
   * model refuses it — swept rather than sampled, because an agreement that
   * holds on the two cases somebody thought of is not an invariant.
   */
  const source = riff();

  it("agrees on every range in the first bar", () => {
    for (let from = 0; from <= 16; from += 1) {
      for (let to = from + 1; to <= 16; to += 1) {
        const descriptor = held(source, from * SLOT, to * SLOT);
        const offers = selectionCapabilities(descriptor, context(source, descriptor));
        const offer = offers.find((entry) => entry.verb === "extend");
        const drawnDisabled = offer?.state.kind === "disabled";
        expect(canRun(offers, "extend"), `${from}..${to}`).toBe(!drawnDisabled);
      }
    }
  });

  it("agrees on the one selection that has nowhere to go", () => {
    /* The sweep above never reaches it: the fixture has a second bar. */
    const ending = song(
      [guitarTrack({ id: TRACK })],
      [
        section([
          melodicBar(TRACK, Array.from({ length: 16 }, () => null), {
            resolution: 16,
          }),
        ]),
      ],
    );
    const descriptor = held(ending, SLOT * 15, SLOT * 16);
    const offers = selectionCapabilities(descriptor, {
      ...context(ending, descriptor),
      sectionBarCount: 1,
    });
    expect(canRun(offers, "extend")).toBe(false);
    expect(refusalFor(offers, "extend")).toBe("Uzatılacak yer kalmadı.");
  });
});
