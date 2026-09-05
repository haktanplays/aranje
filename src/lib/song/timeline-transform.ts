/**
 * Moving a bar line, and everything written over it (2V-D.2 §14, §15).
 *
 * ## The half-converted song this prevents
 *
 * A bar's length in ticks is derived, so changing a metre moves every bar
 * after it without anything having to be told. That is true of the *notes*,
 * which live inside bars. It is not true of the two things that live over
 * them: a phrase and a technique span are section-relative tick ranges, and a
 * bar line moving underneath one leaves it pointing at different music.
 *
 * Before this existed, shortening bar 2 of a section left a phrase over bars
 * 3–4 covering bars 2–3 instead. Nothing crashed; the song was simply no
 * longer the one the reader wrote, and the only way to notice was to look.
 *
 * ## The rule, which is arithmetic and not a guess
 *
 * A tick is remapped by where it sits relative to the bars that changed:
 *
 * - **Before them** — untouched. Nothing in front of an edit moves.
 * - **After them** — shifted by the total change in length. The music it
 *   covers is the same music; only its distance from the section start moved.
 * - **Inside one** — the offset within that bar is kept, because that is what
 *   the note transform does too: an onset at tick 384 of a bar is at tick 384
 *   of it afterwards. A phrase edge and the note it was drawn around therefore
 *   move together or not at all.
 *
 * Two things it deliberately does not do. It never **clamps** an endpoint to
 * the new bar's end — a phrase quietly getting shorter is the failure this
 * module exists to prevent, and an endpoint with nowhere to go is a refusal.
 * And it never **splits** a range at a bar line: a phrase crossing three bars
 * stays one phrase, because that is what the reader wrote.
 *
 * The bar line itself is the exception worth naming: an endpoint sitting
 * exactly *on* the end of a changed bar maps to the new end of that bar. It is
 * not inside the bar, it is the boundary, and a phrase that ended where the
 * bar ended still does.
 */

/** One bar's place on the section's timeline, before or after the change. */
export type BarExtent = {
  readonly startTicks: number;
  readonly lengthTicks: number;
};

export type TickRemapFailure =
  /** The tick sat inside a bar that is now too short to contain it. */
  | "offset_beyond_new_bar";

export type TickRemap =
  | { readonly ok: true; readonly ticks: number }
  | { readonly ok: false; readonly reason: TickRemapFailure };

/**
 * Where one section-relative tick lands after the bars changed length.
 *
 * `before` and `after` are the same bars in the same order — the section's
 * whole bar list, twice — so this can answer for a tick anywhere in it. A
 * mismatched pair is a caller error and is refused rather than guessed at.
 */
export function remapTick(
  ticks: number,
  before: readonly BarExtent[],
  after: readonly BarExtent[],
): TickRemap {
  if (before.length !== after.length) return { ok: false, reason: "offset_beyond_new_bar" };

  for (const [index, bar] of before.entries()) {
    const next = after[index]!;
    const end = bar.startTicks + bar.lengthTicks;
    if (ticks < bar.startTicks) continue;

    /* The boundary belongs to the bar it closes, not to the one it opens:
       a phrase ending at the bar line still ends at the bar line. */
    if (ticks === end) {
      return { ok: true, ticks: next.startTicks + next.lengthTicks };
    }
    if (ticks < end) {
      const offset = ticks - bar.startTicks;
      if (offset >= next.lengthTicks) {
        return { ok: false, reason: "offset_beyond_new_bar" };
      }
      return { ok: true, ticks: next.startTicks + offset };
    }
  }

  /* Past the last bar: the section end, and anything a caller placed there. */
  const lastBefore = before[before.length - 1];
  const lastAfter = after[after.length - 1];
  if (!lastBefore || !lastAfter) return { ok: true, ticks };
  const beforeEnd = lastBefore.startTicks + lastBefore.lengthTicks;
  const afterEnd = lastAfter.startTicks + lastAfter.lengthTicks;
  return { ok: true, ticks: ticks - beforeEnd + afterEnd };
}

/** A range with both ends remapped, or the reason one of them could not be. */
export function remapRange<T extends { readonly startTicks: number; readonly endTicks: number }>(
  range: T,
  before: readonly BarExtent[],
  after: readonly BarExtent[],
): { readonly ok: true; readonly range: T } | { readonly ok: false; readonly reason: TickRemapFailure } {
  const start = remapTick(range.startTicks, before, after);
  if (!start.ok) return start;
  const end = remapTick(range.endTicks, before, after);
  if (!end.ok) return end;
  /*
   * A range that came out empty or backwards means the two ends landed on
   * top of each other — the music between them stopped existing. Reported as
   * the same refusal rather than written, because a zero-length phrase is not
   * something a reader can see or delete.
   */
  if (end.ticks <= start.ticks) return { ok: false, reason: "offset_beyond_new_bar" };
  return { ok: true, range: { ...range, startTicks: start.ticks, endTicks: end.ticks } };
}

/** Every bar of a section as an extent, in order. */
export function extentsOf(
  bars: readonly { readonly lengthTicks: number }[],
): readonly BarExtent[] {
  const extents: BarExtent[] = [];
  let startTicks = 0;
  for (const bar of bars) {
    extents.push({ startTicks, lengthTicks: bar.lengthTicks });
    startTicks += bar.lengthTicks;
  }
  return extents;
}
