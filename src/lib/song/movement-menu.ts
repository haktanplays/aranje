/**
 * The eight ways a covered run can be moved (2U-A §3).
 *
 * "Taşı" is one sheet with four kinds of motion in it, and each kind offers
 * one or more grains: time moves by a grid step, a beat or a bar; pitch by a
 * semitone or an octave; a string moves on its own; a chord shape moves along
 * the neck or across it. Eight in all.
 *
 * They are listed here rather than only inside the sheet for one reason: the
 * count is a promise. A movement dropped because a label did not fit, or
 * because a stepper was refactored, is a capability quietly leaving the app —
 * and the sheet is the only place it would have shown. With the list in a
 * module a test can hold it, and the sheet reads its labels from here so the
 * two cannot say different things.
 *
 * Nothing here is a command. Each entry names a motion and the control that
 * offers it; what a press stages is still the sheet's business, because the
 * shapes of those commands differ and flattening them into data would only
 * move the difference somewhere harder to read.
 */

/** Which of the sheet's four tabs a movement lives under. */
export type MovementMode = "time" | "pitch" | "string" | "shape";

export type Movement = {
  readonly id: string;
  readonly mode: MovementMode;
  /** What the reader sees on the control. */
  readonly label: string;
  /**
   * The `data-testid` stem the controls that offer this movement carry.
   *
   * Every movement is offered in both directions, so a stem always names at
   * least two targets — there is no motion the reader can make and not take
   * back. Pitch is the one place two movements share a stem: a semitone and
   * an octave are four buttons of one stepper.
   */
  readonly testPrefix: string;
};

export const MOVEMENTS: readonly Movement[] = [
  { id: "time-grid", mode: "time", label: "Bir grid", testPrefix: "nudge-*-grid" },
  { id: "time-beat", mode: "time", label: "Bir vuruş", testPrefix: "nudge-*-vuruş" },
  { id: "time-bar", mode: "time", label: "Bir ölçü", testPrefix: "nudge-*-ölçü" },
  { id: "pitch-semitone", mode: "pitch", label: "Yarım ses", testPrefix: "transpose" },
  { id: "pitch-octave", mode: "pitch", label: "Oktav", testPrefix: "transpose" },
  { id: "string-neighbour", mode: "string", label: "Komşu tel", testPrefix: "restring" },
  { id: "shape-string", mode: "shape", label: "Şekli tel yönünde", testPrefix: "shape-string" },
  { id: "shape-fret", mode: "shape", label: "Şekli perde yönünde", testPrefix: "shape-fret" },
];

/** The four tabs, in the order the sheet draws them. */
export const MOVEMENT_MODES: readonly MovementMode[] = [
  "time",
  "pitch",
  "string",
  "shape",
];

/** The movements one tab offers. */
export function movementsOf(mode: MovementMode): readonly Movement[] {
  return MOVEMENTS.filter((entry) => entry.mode === mode);
}

/** The time grains, in the order they are stacked. Labels the sheet reuses. */
export const TIME_GRAINS: readonly { readonly id: string; readonly label: string }[] =
  movementsOf("time").map((entry) => ({
    id: entry.id,
    /* "Bir grid" on the control, "grid" in the sentence beside it. */
    label: entry.label.replace(/^Bir /, ""),
  }));
