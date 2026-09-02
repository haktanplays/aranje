/**
 * What a selection offers, bound to the handles that run it (2V-B §3).
 *
 * Which handle each action calls is a fact about the selection session, not
 * about the row that draws it — and the composition root is not the place to
 * spell a dozen callbacks out, because that is exactly how a root grows back
 * into the file everything lived in (K-47).
 *
 * Nothing new is staged, no command is invented, and this file writes
 * nothing: it names the calls, and asks `selection-action-canon.ts` which of
 * them belong on which surface.
 */
import {
  selectionActionCanon,
  type SelectionActionId,
  type SelectionActionOffer,
  type SelectionMode,
} from "@/lib/song/selection-action-canon";
import {
  offeredVerbs,
  selectionCapabilities,
  type VerbOffer,
} from "@/lib/song/selection-capability";
import { hasAudibleNotes } from "@/lib/playback/selection-playback";
import { hasExtendTarget } from "@/lib/song/selection-extend";
import type { SelectionListening } from "@/lib/workspace/use-selection-listening";
import {
  describeBarSelection,
  describeTimeSelection,
} from "@/lib/song/selection-descriptor";
import type { Song } from "@/lib/song/schema";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";

/**
 * Which actions each surface has a production handler wired for (§4).
 *
 * Named here rather than counted at the call site, because "is there a
 * handler" is the question the canon uses to decide whether to draw at all,
 * and the matrix test asserts the other half of the rule against these very
 * sets: a handler set that fails to cover an available capability is a defect
 * in the wiring, not a licence to hide the verb quietly.
 */
export const READ_HANDLERS: ReadonlySet<SelectionActionId> = new Set<SelectionActionId>([
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
]);

/** The same, plus the legato brush's door, which only the edit area owns. */
export const EDIT_HANDLERS: ReadonlySet<SelectionActionId> = new Set<SelectionActionId>([
  ...READ_HANDLERS,
  "connect",
]);

/** A run of bars: the bar commands, and the two listening intents. */
export const MEASURE_HANDLERS: ReadonlySet<SelectionActionId> =
  new Set<SelectionActionId>([
    "copy",
    "cut",
    "duplicate",
    "repeat",
    "move",
    "delete",
    "listen_once",
    "listen_loop",
    "more",
  ]);

/** Everything the selection toolbar can ask for. */
export type SelectionActions = {
  readonly notice: string | null;
  readonly error: string | null;
  /**
   * What this selection may be asked to do, computed once (2U-A §3, 2V-B §3).
   *
   * The row draws what the canon placed on it and the drawer draws the rest,
   * greying what is disabled with the reason the model gave. Neither decides
   * for itself — a screen that works out whether a run can be joined by
   * counting notes will offer "Bağla" on one note the day the counting is off
   * by one.
   */
  readonly actions: readonly SelectionActionOffer[];
  /** True while "Devam" is waiting for the reader to say where to reach to. */
  readonly extendArmed: boolean;
  /** Run one of them. Every id the canon drew has a case here. */
  run(id: SelectionActionId): void;
};

/** The one line the edit header says about a covered run, and its way out. */
export type SelectionHeader = { readonly summary: string; onCancel(): void };

function selectionHeader(input: CoveredRunInput): SelectionHeader | null {
  if (!input.editing || !input.time.handle.selection) return null;
  return {
    summary: input.time.handle.summary?.text ?? "Seçim",
    onCancel: input.time.clear,
  };
}

/** One answer for both places a covered run appears while writing. */
export type CoveredRun = {
  readonly header: SelectionHeader;
  readonly verbs: SelectionActions;
};

export type CoveredRunInput = {
  readonly editing: boolean;
  readonly time: SelectionSession["time"];
  /** Read to describe the selection; never written through. */
  readonly song: Song;
  /** The two listening intents, already bound to the transport (2V-A §3). */
  readonly listening: SelectionListening;
};

export function coveredRun(input: CoveredRunInput): CoveredRun | null {
  const header = selectionHeader(input);
  const verbs = selectionVerbs(input);
  return header && verbs ? { header, verbs } : null;
}

/**
 * What the capability model says about what is held — for any surface.
 *
 * Exported, and computed without asking whether the reader is writing
 * (2V-A.1 §2). "What may be done to this run" is a musical question, and it
 * has the same answer whether the reading surface's tall bar or the focused
 * row is the thing on screen.
 */
export function selectionOffers(
  song: Song,
  time: SelectionSession["time"],
): readonly VerbOffer[] {
  const selection = time.handle.selection;
  if (!selection) return [];
  const descriptor = describeTimeSelection(song, selection);
  if (!descriptor) return [];
  const section = song.sections.find((entry) => entry.id === selection.sectionId);
  return offeredVerbs(
    selectionCapabilities(descriptor, {
      hasClipboard: time.handle.hasClipboard,
      /* The time clipboard only ever holds a run of notes. */
      clipboardScope: time.handle.hasClipboard ? "range" : null,
      sectionBarCount: section?.bars.length ?? 0,
      /*
       * Asked of the same schedule the engine will play (2V-A §2), so the
       * drawer cannot offer a listen the plan then refuses.
       */
      hasAudibleNotes: hasAudibleNotes(song, descriptor),
      /*
       * And of the same section the reach would move the edge across
       * (2V-A.1 §4), so "Devam" cannot light up with nowhere to go.
       */
      hasExtendTarget: hasExtendTarget(song, descriptor),
    }),
  );
}

/** What a note selection offers on one row, in that row's own order. */
export function selectionActions(input: {
  readonly song: Song;
  readonly time: SelectionSession["time"];
  readonly mode: Extract<SelectionMode, "read" | "edit">;
  readonly looping: boolean;
}): readonly SelectionActionOffer[] {
  return selectionActionCanon({
    mode: input.mode,
    offers: selectionOffers(input.song, input.time),
    handlers: input.mode === "read" ? READ_HANDLERS : EDIT_HANDLERS,
    looping: input.looping,
  });
}

/** What a run of whole bars offers, in the same canon (2V-B §6). */
export function measureActions(input: {
  readonly song: Song;
  readonly bars: SelectionSession["bars"];
  readonly looping: boolean;
}): readonly SelectionActionOffer[] {
  const selection = input.bars.handle.selection;
  if (!selection) return [];
  const descriptor = describeBarSelection(input.song, selection);
  if (!descriptor) return [];
  const section = input.song.sections.find((entry) => entry.id === selection.sectionId);
  /*
   * A clipboard from the other scope is not offered at all: the two are never
   * silently converted, so a track clipboard has nothing to say to a whole
   * measure and the reader is not asked to find that out by trying.
   */
  const usable =
    input.bars.handle.hasClipboard &&
    input.bars.handle.clipboardScope === selection.scope;
  return selectionActionCanon({
    mode: "measure",
    offers: offeredVerbs(
      selectionCapabilities(descriptor, {
        hasClipboard: usable,
        clipboardScope: usable ? "measures" : null,
        sectionBarCount: section?.bars.length ?? 0,
        hasAudibleNotes: hasAudibleNotes(input.song, descriptor),
        /* Bars are not reached forward from; the model hides "Devam" here. */
        hasExtendTarget: false,
      }),
    ),
    handlers: MEASURE_HANDLERS,
    looping: input.looping,
    barScope: descriptor.barScope,
  });
}

/**
 * Every handle a note selection's actions reach for, by canon id.
 *
 * One map for both rows. The read bar and the compact row differ in which of
 * these the canon puts in front of the reader, never in what pressing one
 * does — "Kes" cuts the same way whichever surface asked.
 *
 * `connect` is absent on purpose: the legato brush's door belongs to the edit
 * area, which is the only place that can open it, and it wraps this.
 */
export function selectionRunner(input: {
  readonly time: SelectionSession["time"];
  readonly listening: SelectionListening;
  readonly openMore: () => void;
}): (id: SelectionActionId) => void {
  const { listening, openMore, time } = input;
  return (id) => {
    switch (id) {
      /* Reading only: no commit, no write, no undo step. */
      case "copy":
        time.handle.copy();
        return;
      case "cut":
        time.handle.apply({ kind: "cut_selection" });
        return;
      case "duplicate":
        time.handle.apply({ kind: "duplicate_selection" });
        return;
      case "delete":
        time.handle.apply({ kind: "delete_selection" });
        return;
      case "move":
        time.openSheet("move");
        return;
      case "repeat":
        time.openSheet("repeat");
        return;
      /*
       * Stages and previews; the write happens at "Uygula" in the sheet.
       *
       * `pasteHere` on both surfaces now (2V-B §2). The reading sheet used to
       * call `startPasteFlow`, which asks the reader to long-press a
       * destination — the right question when nothing is held, and the wrong
       * one inside a sheet that only opens on a selection, where the question
       * has already been answered (2U-B §3).
       */
      case "paste":
        time.pasteHere();
        return;
      /*
       * "Devam" reaches from the end of what is held (2U-A §3). The session
       * arms the reach and the next long press says where to; no second
       * extension algorithm, and nothing written either way.
       */
      case "extend":
        time.toggleExtend();
        return;
      /* Ephemeral, both of them: they schedule sound and produce no command. */
      case "listen_once":
        listening.audition();
        return;
      case "listen_loop":
        listening.toggleLoop();
        return;
      case "more":
        openMore();
        return;
      case "connect":
        /* Owned by the edit area; see `selectionRunner`'s note above. */
        return;
    }
  };
}

function selectionVerbs(input: CoveredRunInput): SelectionActions | null {
  const { time } = input;
  if (!input.editing || !time.handle.selection) return null;

  return {
    /*
     * The listening refusal first (2V-B.2 §4). It answers the press the
     * reader just made, so it is newer than anything the staged command left
     * behind, and it is the sentence that stops a silent button from reading
     * as a broken one.
     */
    notice: input.listening.refusal ?? time.handle.notice ?? null,
    error: time.handle.error ?? null,
    actions: selectionActions({
      song: input.song,
      time,
      mode: "edit",
      looping: input.listening.looping,
    }),
    extendArmed: time.extendArmed,
    run: selectionRunner({
      time,
      listening: input.listening,
      /* The compact row's drawer is the toolbar's own state, not a sheet. */
      openMore: () => {},
    }),
  };
}
