/**
 * Which verbs a selection offers, and why the others are missing (2U-A §2, §3).
 *
 * ## Why this is a function and not an `if` in a component
 *
 * "Which buttons should be on screen?" is a musical question wearing a UI
 * costume. Whether a selection can become an arpeggio depends on whether it
 * is one onset with several notes; whether it can be moved left depends on
 * whether there is a bar to its left. A component that answers those by
 * counting things it happens to have to hand will answer them differently in
 * each of the three places a selection appears, and the difference will show
 * up as a button that appears and then refuses.
 *
 * So the answer is computed once, from the descriptor, and every surface
 * renders what it is given.
 *
 * ## Three states, not two
 *
 * `available` and `hidden` are not enough. An action that vanishes teaches a
 * reader nothing; an action that is always visible and always refuses is
 * worse. The middle state — `disabled` with a sentence — is for the case
 * where the verb *belongs* to this kind of selection and cannot be used right
 * now: "Yapıştır" on an empty clipboard, "Sola taşı" on the first bar. The
 * reader learns the rule from the disabled control instead of from a refusal.
 *
 * `hidden` is for verbs that do not belong to this kind of selection at all.
 * "Ölçüyü sil" is not disabled on a two-note range; it is not one of the
 * things you can do to a two-note range, and showing it greyed would suggest
 * that the right selection would enable it — which is true, and is exactly
 * what the measure selection is for.
 *
 * Nothing here writes, previews or refuses. It says what may be offered; the
 * commands themselves still decide what actually happens, and they still
 * refuse for reasons this file cannot know (a collision, a chain, a grid).
 */
import { barCount, type SelectionDescriptor } from "@/lib/song/selection-descriptor";

/**
 * Every verb the editor offers on a selection.
 *
 * One flat list rather than one per surface: a verb means the same thing
 * wherever it is drawn, and a name that exists in two vocabularies is a name
 * that will mean two things.
 */
export type SelectionVerb =
  /* ---------------------------------------------------- the clipboard */
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "repeat"
  | "delete"
  /* ------------------------------------------------------- movements */
  | "move_time"
  | "transpose"
  | "restring"
  /* -------------------------------------------------------- the runs */
  | "connect"
  | "extend"
  /* ------------------------------------------------ what a chord is */
  | "to_arpeggio"
  | "to_chord"
  | "strum"
  | "retune"
  /* ----------------------------------------------------- whole bars */
  | "timing"
  | "insert_bar_before"
  | "insert_bar_after"
  | "duplicate_bar"
  | "delete_bar"
  | "move_bar_left"
  | "move_bar_right";

export type VerbState =
  | { readonly kind: "available" }
  /** Belongs here, cannot be used now, and says why in the reader's words. */
  | { readonly kind: "disabled"; readonly reason: string }
  /** Does not belong to this kind of selection. Not drawn at all. */
  | { readonly kind: "hidden" };

export type VerbOffer = {
  readonly verb: SelectionVerb;
  readonly state: VerbState;
};

/**
 * What the capability answer needs to know beyond the selection itself.
 *
 * Deliberately small, and deliberately not the Song: everything here is a
 * fact about the *session* or about the shape of the section, and a function
 * that took the whole Song would be tempted to start deciding whether a
 * command would succeed — which is the command's job, not this one's.
 */
export type CapabilityContext = {
  /** True when something has been copied or cut in this session. */
  readonly hasClipboard: boolean;
  /**
   * Which kind of thing the clipboard holds.
   *
   * A bar clipboard and a range clipboard are never silently converted
   * (`bar-selection.ts`), so a paste is only offered where the two agree.
   */
  readonly clipboardScope: "range" | "measures" | null;
  /** How many bars the section has. Needed to know where the edges are. */
  readonly sectionBarCount: number;
};

const available: VerbState = { kind: "available" };
const hidden: VerbState = { kind: "hidden" };
const disabled = (reason: string): VerbState => ({ kind: "disabled", reason });

/** Verbs that act on notes inside a range, whatever the range holds. */
const RANGE_VERBS: readonly SelectionVerb[] = [
  "copy",
  "cut",
  "paste",
  "duplicate",
  "repeat",
  "delete",
  "move_time",
  "transpose",
  "restring",
  "connect",
  "extend",
];

/** Verbs that only mean something when several notes were struck together. */
const CHORD_VERBS: readonly SelectionVerb[] = [
  "to_arpeggio",
  "to_chord",
  "strum",
  "retune",
];

/** Verbs that act on bars as objects, with every track in them. */
const MEASURE_VERBS: readonly SelectionVerb[] = [
  "timing",
  "insert_bar_before",
  "insert_bar_after",
  "duplicate_bar",
  "delete_bar",
  "move_bar_left",
  "move_bar_right",
];

/**
 * The measure verbs a one-instrument bar selection cannot run (2U-A §10).
 *
 * Adding a bar makes the section longer, and there is no such thing as doing
 * that to one instrument: a bar inserted in the guitar and not in the bass is
 * not a longer song, it is two songs of different lengths. "Ölçü ve ritim" is
 * here for the same reason — a bar's metre and grid are properties of the bar,
 * shared by every track written in it.
 *
 * The rest of the measure verbs are *not* here, and deliberately. Deleting,
 * duplicating, repeating and moving all have an honest one-instrument meaning
 * that `bar-transform.ts` implements: the bars stay where they are and only
 * this track's content is emptied, copied or nudged. The section keeps its
 * length, so no other track notices.
 *
 * The list is exactly the set the core answers `not_available_in_scope` for,
 * plus the timing sheet. Anything wider would grey out a control that works.
 */
const FULL_SCOPE_VERBS: readonly SelectionVerb[] = [
  "timing",
  "insert_bar_before",
  "insert_bar_after",
];

export const ALL_VERBS: readonly SelectionVerb[] = [
  ...RANGE_VERBS,
  ...CHORD_VERBS,
  ...MEASURE_VERBS,
];

/**
 * What this selection offers, verb by verb, in a stable order.
 *
 * Every verb appears in the answer — a surface asks for the whole list and
 * draws what is not hidden, so a verb can never be forgotten by a screen that
 * did not know to ask about it.
 */
export function selectionCapabilities(
  descriptor: SelectionDescriptor,
  context: CapabilityContext,
): readonly VerbOffer[] {
  const isMeasures = descriptor.scope === "measures";
  const isChord = descriptor.scope === "chord";
  const empty = descriptor.eventIds.length === 0;

  const bars = descriptor.barRange;
  const firstBar = bars?.startBarIndex ?? 0;
  const lastBar = bars?.endBarIndex ?? 0;

  const stateOf = (verb: SelectionVerb): VerbState => {
    /* ------------------------------------------------ the note verbs */
    if (RANGE_VERBS.includes(verb)) {
      if (verb === "paste") {
        if (isMeasures) return hidden;
        if (!context.hasClipboard) {
          return disabled("Panoda bir şey yok.");
        }
        if (context.clipboardScope !== "range") {
          return disabled("Panodaki ölçüler bir nota seçimine yapıştırılamaz.");
        }
        return available;
      }
      /*
       * A measure selection is a run of bars, and copying, cutting and moving
       * it are real things — they are just different commands, and they live
       * under the measure verbs below so the two can never be confused.
       */
      if (isMeasures) return hidden;
      if (verb === "extend") return available;
      if (empty) {
        return disabled("Seçimde nota yok.");
      }
      if (verb === "connect") {
        /*
         * A slur joins one note to the one before it, so it needs at least
         * two struck onsets to join. One note has nothing to be joined to.
         */
        return descriptor.onsetCount >= 2
          ? available
          : disabled("Bağlamak için en az iki nota gerekiyor.");
      }
      return available;
    }

    /* ----------------------------------------------- the chord verbs */
    if (CHORD_VERBS.includes(verb)) {
      if (isChord) return available;
      /*
       * Not disabled: these are what a *chord* offers, and a range that
       * happens to hold one chord is still a range. Showing them greyed on
       * every range would be four permanently dead controls.
       */
      return hidden;
    }

    /* --------------------------------------------- the measure verbs */
    if (!isMeasures) return hidden;

    /* Whole-bar work, on a selection that holds one instrument's bar. */
    if (descriptor.barScope === "track" && FULL_SCOPE_VERBS.includes(verb)) {
      return disabled("Bu işlem için ölçünün tamamı seçilmeli.");
    }

    if (verb === "delete_bar") {
      /*
       * A song is at least one bar long. Deleting the last one would leave
       * nothing to write on, so it is refused where the reader can see it
       * rather than after they have pressed it.
       *
       * Only in the full scope: emptying one instrument's bars leaves the
       * bars themselves standing, so the section cannot run out of them.
       */
      if (descriptor.barScope === "track") return available;
      return context.sectionBarCount > barCount(descriptor)
        ? available
        : disabled("Şarkıda en az bir ölçü kalmalı.");
    }
    if (verb === "move_bar_left") {
      return firstBar > 0 ? available : disabled("Bu ilk ölçü.");
    }
    if (verb === "move_bar_right") {
      return lastBar < context.sectionBarCount - 1
        ? available
        : disabled("Bu son ölçü.");
    }
    return available;
  };

  return ALL_VERBS.map((verb) => ({ verb, state: stateOf(verb) }));
}

/** Just the verbs a surface should draw, in order. */
export function offeredVerbs(
  offers: readonly VerbOffer[],
): readonly VerbOffer[] {
  return offers.filter((offer) => offer.state.kind !== "hidden");
}

/** Whether one named verb may be run right now. */
export function canRun(
  offers: readonly VerbOffer[],
  verb: SelectionVerb,
): boolean {
  return offers.some(
    (offer) => offer.verb === verb && offer.state.kind === "available",
  );
}

/** Why a verb cannot be run, or null when it can be or is not offered. */
export function refusalFor(
  offers: readonly VerbOffer[],
  verb: SelectionVerb,
): string | null {
  const found = offers.find((offer) => offer.verb === verb);
  return found && found.state.kind === "disabled" ? found.state.reason : null;
}
