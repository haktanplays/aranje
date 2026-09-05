import {
  buildFretGlyph,
  type GlyphState,
} from "@/lib/tab/glyph-model";
import type { Articulation, NoteAttack } from "@/lib/song/schema";

/**
 * The single way a fret number is drawn (2S-A §4).
 *
 * The digit itself has no padding, no border, no radius and no shadow — it is
 * a number written on a line, which is what tab is. What used to be padding is
 * now a **separate mask** behind the digit, sized by the model, so the string
 * stops just short of the number instead of stopping at the edge of a box. A
 * one-digit and a two-digit fret are both centred on the same slot centre, and
 * the numerals are tabular, so a chord lines up vertically.
 *
 * The hit target is not this element. A finger aims at the cell in the edit
 * grid, which is its own ≥44px box; painting the digit into a 44px square
 * would put six of them on top of each other on a six-string staff.
 *
 * Every state is carried by a **shape** as well as by a colour, because a
 * selection that is only a hue is not a selection to a reader who cannot
 * separate those hues.
 */
export function FretGlyph({
  fret,
  articulation,
  attack,
  state = "normal",
  slurredFrom,
  slotIndex,
}: {
  fret: number | null;
  articulation?: Articulation;
  /**
   * The explicit attack axis (2V-D.1-C §11).
   *
   * A ghost, a dead note and a natural harmonic are written on the number
   * itself whichever axis said so, so the digit has to know about both.
   */
  attack?: NoteAttack;
  state?: GlyphState;
  /** The fret this note is slurred from, so the label can say the movement. */
  slurredFrom?: number | null;
  /**
   * Which slot this glyph sits on, so the playhead loop can find it.
   *
   * The "playing" state is the one state React must not own: marking it from
   * a render would mean re-rendering the tab on every animation frame, and
   * 2Q-C's single-rAF design exists so that never happens. The loop toggles
   * `data-playing` on this element when the transport crosses into a new slot
   * — at most a few dozen attribute writes a second — and the caret is drawn
   * by a rule in `globals.css`.
   */
  slotIndex?: number;
}) {
  const glyph = buildFretGlyph({
    fret,
    state,
    ...(articulation === undefined ? {} : { articulation }),
    ...(attack === undefined ? {} : { attack }),
    ...(slurredFrom === undefined ? {} : { slurredFrom }),
  });

  const tone =
    state === "ghost"
      ? "text-muted"
      : state === "rejected"
        ? "text-reject"
        : state === "selected"
          ? "text-accept"
          : state === "playing"
            ? "text-bronze"
            : articulation === "palm_mute"
              ? "text-text/70"
              : articulation === "accent" || attack === "accent"
                ? "text-text font-semibold"
                : "text-text";

  return (
    <span
      className="relative inline-flex items-center justify-center"
      data-fret-glyph={glyph.text}
      data-glyph-state={state}
      data-glyph-slot={slotIndex}
      aria-label={glyph.label}
      role="img"
    >
      {/* The gap in the string. Its own element, so the digit keeps no padding. */}
      <span
        aria-hidden
        className="bg-app absolute top-0 bottom-0"
        style={{
          width: glyph.maskWidth,
          left: `calc(50% - ${glyph.maskWidth / 2}px)`,
        }}
      />
      {glyph.marker === "dotted" ? (
        <span
          aria-hidden
          className="border-muted absolute -inset-x-0.5 -inset-y-px rounded-[2px] border border-dashed"
        />
      ) : null}
      {glyph.marker === "underline" ? (
        <span
          aria-hidden
          className={`absolute -bottom-1 left-1/2 h-px -translate-x-1/2 ${
            state === "selected" ? "bg-accept" : "bg-text"
          }`}
          style={{ width: glyph.maskWidth }}
        />
      ) : null}
      {glyph.marker === "caret" ? (
        <span
          aria-hidden
          className="border-b-bronze absolute -top-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[3px] border-b-[4px] border-x-transparent"
        />
      ) : null}
      {glyph.marker === "tie" ? (
        <span
          aria-hidden
          className="bg-muted absolute top-1/2 -left-2 h-px w-1.5"
        />
      ) : null}
      {glyph.marker === "struck" ? (
        <span
          aria-hidden
          className="bg-reject absolute top-1/2 left-1/2 h-px -translate-x-1/2"
          style={{ width: glyph.maskWidth }}
        />
      ) : null}
      <span
        data-glyph-digit
        className={`relative font-mono text-[12px] leading-none tabular-nums ${tone}`}
      >
        {glyph.text}
      </span>
    </span>
  );
}
