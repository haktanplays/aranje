/**
 * "Continue this pattern" (2S-A §9).
 *
 * Not a composer. It does not know what a scale is, it never says a choice is
 * *better* than another, and there is no "recommended" anywhere in it. What it
 * does is take the piece of music the reader has already selected and put it
 * down again — as it is, or moved.
 *
 * Three options, and each of them is an existing command:
 *
 * - **exact repeat** is `repeat_selection`, the same core the selection bar
 *   has used since 2J.1;
 * - **move the same shape** is `translate_fret_shape`, which keeps the hand
 *   shape and changes where the hand is;
 * - **move the same pitch** is `transpose_pitch`, which keeps the melody and
 *   changes how high it is.
 *
 * The reader picks the option, how many times, and how far. Nothing is chosen
 * for them, and nothing is labelled correct.
 *
 * ## One plan, one commit
 *
 * A continuation of four repeats is four applications of a command, and if the
 * fourth is refused the first three must not have happened. So the whole plan
 * is built on a **pure candidate** — each step feeds the next Song — and only
 * the last one is handed back. The caller commits once. A UI that called the
 * atomic command four times would be four undo steps and three chances to
 * leave the song half done.
 */
import {
  applyTransform,
  type TransformFailure,
  type TransformResult,
} from "@/lib/song/transform";
import type { TimeSelection } from "@/lib/song/time-selection";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators";

/** What the reader chose to do with the selection. */
export type ContinuePlanMode =
  | { readonly kind: "repeat" }
  | {
      readonly kind: "shape";
      /** Signed. Strings and frets move together, as the hand does. */
      readonly stringDelta: number;
      readonly fretDelta: number;
    }
  | { readonly kind: "pitch"; readonly semitones: number };

export type ContinueRequest = {
  readonly song: Song;
  readonly selection: TimeSelection;
  readonly mode: ContinuePlanMode;
  /** How many more copies. One is "once more". */
  readonly repeats: number;
  /**
   * What to do when the copies would run past the end of the section.
   *
   * Absent, the whole thing is refused rather than quietly writing fewer
   * copies than the reader asked for. `fit` is the reader saying, in so many
   * words, "as much as fits".
   */
  readonly onOverrun?: "refuse" | "fit";
};

export type ContinueResult =
  | {
      readonly ok: true;
      readonly song: Song;
      readonly selection: TimeSelection;
      readonly warnings: readonly ValidationIssue[];
      /** How many copies were actually written. */
      readonly written: number;
      /** True when the reader asked for more than the section had room for. */
      readonly trimmed: boolean;
    }
  | { readonly ok: false; readonly error: TransformFailure };

const REPEAT_LIMIT = 32;

/**
 * The whole continuation, worked out on a candidate and handed back once.
 *
 * Each step is applied to the Song the step before it produced, so a
 * collision, a mixed grid or a section end is found where it really is rather
 * than against the song as it was before any of this started.
 */
export function continuePattern(request: ContinueRequest): ContinueResult {
  const repeats = Math.floor(request.repeats);
  if (!Number.isFinite(repeats) || repeats < 1) {
    return {
      ok: false,
      error: { code: "selection_empty", message: "Kaç kez tekrarlanacağını seç." },
    };
  }
  if (repeats > REPEAT_LIMIT) {
    return {
      ok: false,
      error: {
        code: "selection_out_of_bounds",
        message: `Bir seferde en çok ${REPEAT_LIMIT} kez tekrarlanabilir.`,
      },
    };
  }

  /*
   * The selection's own width carries the rests with it. A pattern that ends
   * in silence is a pattern that ends in silence, and copying only its notes
   * would change the rhythm — which is the one thing "continue this" must not
   * do.
   */
  let song = request.song;
  let selection = request.selection;
  const warnings: ValidationIssue[] = [];
  let written = 0;
  let trimmed = false;

  for (let step = 0; step < repeats; step += 1) {
    const width = selection.endTicks - selection.startTicks;
    const copied = applyTransform(song, selection, {
      kind: "repeat_selection",
      mode: { kind: "count", count: 1 },
    });
    if (!copied.ok) {
      // Running out of section is the one refusal the reader may have already
      // answered; every other one is the answer.
      if (request.onOverrun === "fit" && isOverrun(copied)) {
        trimmed = true;
        break;
      }
      return copied;
    }

    /*
     * The copy alone, not the pair.
     *
     * `repeat_selection` gives back the whole span it now covers, which is
     * the right answer for a selection bar and the wrong one here: moving
     * that would move the original too, and repeating it would double the
     * width every round. The copy is exactly one width further on.
     */
    const copySelection = {
      ...selection,
      startTicks: selection.startTicks + width,
      endTicks: selection.endTicks + width,
    };

    const placed = moved(copied.song, copySelection, request.mode);
    if (!placed.ok) return placed;

    song = placed.song;
    /*
     * The next copy continues from this one, so a move applied three times is
     * three steps of it rather than the same step three times — which is what
     * "continue the pattern, moving up" means when a musician says it.
     */
    selection = copySelection;
    warnings.push(...placed.warnings);
    written += 1;
  }

  if (written === 0) {
    return {
      ok: false,
      error: {
        code: "selection_out_of_bounds",
        message: "Bu bölümde bir kopya daha için yer yok.",
      },
    };
  }

  return { ok: true, song, selection, warnings, written, trimmed };
}

/** The move, applied to the copy that was just laid down. */
function moved(
  song: Song,
  selection: TimeSelection,
  mode: ContinuePlanMode,
): TransformResult {
  const unchanged: TransformResult = { ok: true, song, warnings: [], selection };
  if (mode.kind === "repeat") return unchanged;
  if (mode.kind === "shape") {
    if (mode.stringDelta === 0 && mode.fretDelta === 0) return unchanged;
    return applyTransform(song, selection, {
      kind: "translate_fret_shape",
      stringDelta: mode.stringDelta,
      fretDelta: mode.fretDelta,
    });
  }
  if (mode.semitones === 0) return unchanged;
  return applyTransform(song, selection, {
    kind: "transpose_pitch",
    semitones: mode.semitones,
  });
}

/** True when the refusal was "there is no room left in this section". */
function isOverrun(result: Extract<TransformResult, { ok: false }>): boolean {
  return (
    result.error.code === "selection_out_of_bounds" ||
    result.error.code === "section_overflow"
  );
}

/**
 * Up to three ghost cards, each a real candidate on the real song.
 *
 * Every card is the actual result of the actual command, so what the reader
 * looks at is what they would get. Nothing is written until one is chosen.
 */
export const MAX_PREVIEW_CARDS = 3;

export type ContinueCard = {
  readonly mode: ContinuePlanMode;
  readonly label: string;
  readonly result: ContinueResult;
};

export function previewContinuations(
  song: Song,
  selection: TimeSelection,
  modes: readonly ContinuePlanMode[],
  repeats: number,
): ContinueCard[] {
  return modes.slice(0, MAX_PREVIEW_CARDS).map((mode) => ({
    mode,
    label: continueLabel(mode),
    result: continuePattern({ song, selection, mode, repeats }),
  }));
}

/**
 * What a card is called.
 *
 * Says what it does. Never "best", never "recommended", never "in scale" and
 * never "correct" — those would be claims about the music, and this module
 * makes none.
 */
export function continueLabel(mode: ContinuePlanMode): string {
  if (mode.kind === "repeat") return "Aynen tekrar et";
  if (mode.kind === "shape") {
    const parts: string[] = [];
    if (mode.stringDelta !== 0) {
      parts.push(
        mode.stringDelta > 0
          ? `${mode.stringDelta} tel ince tarafa`
          : `${-mode.stringDelta} tel kalın tarafa`,
      );
    }
    if (mode.fretDelta !== 0) {
      parts.push(
        mode.fretDelta > 0
          ? `${mode.fretDelta} perde ileri`
          : `${-mode.fretDelta} perde geri`,
      );
    }
    return parts.length === 0
      ? "Aynı şekli olduğu yerde"
      : `Aynı şekli ${parts.join(", ")} taşı`;
  }
  if (mode.semitones === 0) return "Aynı perdeyi olduğu yerde";
  return mode.semitones > 0
    ? `Aynı ezgiyi ${mode.semitones} ses yukarı taşı`
    : `Aynı ezgiyi ${-mode.semitones} ses aşağı taşı`;
}
