"use client";

/**
 * The arrangement's cells: one bar of one track, and the bar number above it
 * (2L-R, moved verbatim out of ArrangementCanvas).
 *
 * Everything drawn here comes from the arrangement model; nothing is invented
 * to fill a cell. The cells are deliberately not miniature tab: the contour
 * says "the line rises here", the ticks say "it is busy here", the bridge
 * says "this note is still ringing". Anything finer is the tab's job.
 */
import {
  BAR_NUMBER_HEIGHT,
  LANE_HEIGHT,
  TRACK_LABEL_WIDTH,
} from "@/lib/arrangement/geometry";
import {
  cellKey,
  type ArrangementBar,
  type ArrangementCell,
  type ArrangementModel,
} from "@/lib/arrangement/model";
import { useLongPress } from "@/lib/ui/use-long-press";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/** Marks the cell a test or a scroll needs to find. */
export const ARR_CELL_ATTRIBUTE = "data-arr-cell";
/** The bar number, which is where a whole-bar selection is picked up. */
export const ARR_BAR_ATTRIBUTE = "data-arr-bar";

function CellContent({
  cell,
  width,
}: {
  cell: ArrangementCell;
  width: number;
}) {
  if (cell.kind === "silent") return null;

  // Inset so a mark at the very start of a bar does not sit on the bar line.
  const inner = Math.max(1, width - 6);
  const x = (at: number) => 3 + at * inner;
  const y = (height: number | null) => {
    // A note with no placement has no contour; it sits on the centre line
    // rather than being dropped, because it is still a note that sounds.
    const level = height ?? 0.5;
    return 4 + (1 - level) * (LANE_HEIGHT - 16);
  };

  return (
    <>
      {cell.sustains.map((sustain, index) => (
        <span
          key={`s${index}`}
          aria-hidden
          className="bg-text/35 absolute h-px"
          style={{
            left: x(sustain.from),
            width: Math.max(1, (sustain.to - sustain.from) * inner),
            top: LANE_HEIGHT / 2,
          }}
        />
      ))}
      {cell.marks.map((mark, index) => (
        <span
          key={`m${index}`}
          aria-hidden
          className="bg-text/85 absolute w-px"
          style={{ left: x(mark.at), top: y(mark.height), height: 8 }}
        />
      ))}
    </>
  );
}

/**
 * What a cell is called out loud.
 *
 * The reader gets the structure in words: which track, which bar, whether it
 * sounds, and — only when it is exactly true — that it repeats an earlier bar.
 */
function cellLabel(
  trackName: string,
  bar: ArrangementBar,
  cell: ArrangementCell,
): string {
  const parts = [`${trackName}, ${bar.barNumber}. ölçü`];
  if (cell.kind === "silent") parts.push("sessiz");
  else if (cell.repeatOf) parts.push(repeatSentence(cell.repeatOf.barNumber));
  return parts.join(", ");
}

/** The whole claim, in the words a musician would use. */
const repeatSentence = (barNumber: number) => `${barNumber}. ölçü ile aynı`;

/**
 * The same claim, as small as a bar can hold.
 *
 * A 6/8 cell is seventy-two pixels wide and the sentence does not fit, so the
 * cell shows a mark and carries the full sentence as its accessible name and
 * its tooltip. The recycle glyph says *repeat* without needing a word, which
 * is what leaves room for the number that actually varies.
 */
const repeatChip = (barNumber: number) => `↻${barNumber}`;

/**
 * Is this cell the *start* of a run of repeats, or the middle of one?
 *
 * A bass line that plays the same bar for thirty bars is thirty true repeat
 * labels, and thirty of anything down one lane is noise rather than
 * information. The first cell of a run says which bar it repeats; the ones
 * behind it keep a quieter mark that says the run is still going.
 *
 * Derived at render time from the model as it already is; presentation only.
 */
export function repeatRunStart(
  model: ArrangementModel,
  trackId: string,
  barIndex: number,
): boolean {
  const bar = model.bars[barIndex];
  const cell = bar && model.cells.get(cellKey(trackId, bar.barKey));
  if (!cell?.repeatOf) return false;
  const previousBar = model.bars[barIndex - 1];
  if (!previousBar) return true;
  const previous = model.cells.get(cellKey(trackId, previousBar.barKey));
  return previous?.repeatOf?.barKey !== cell.repeatOf.barKey;
}

/**
 * One bar of one track, and the way that track's bars are picked up.
 *
 * A component rather than JSX inside a loop, because the long press is a hook
 * and a hook cannot be called in a `map`. The tap and the press are different
 * verbs on purpose: a tap opens the bar in the tab, a press picks up this
 * track's content in it. Nothing here can start a whole-bar selection — that
 * gesture lives on the bar number one row up, because emptying one lane and
 * removing a bar from the song are not the same act and must not share a
 * finger movement.
 */
export function BarCell({
  bar,
  cell,
  trackId,
  trackName,
  runStart,
  playing,
  selected,
  onOpen,
  onLongPress,
}: {
  bar: ArrangementBar;
  cell: ArrangementCell;
  trackId: string;
  trackName: string;
  runStart: boolean;
  playing: boolean;
  selected: boolean;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      type="button"
      {...{ [ARR_CELL_ATTRIBUTE]: `${trackId}|${bar.barKey}` }}
      {...longPress}
      onClick={onOpen}
      aria-label={cellLabel(trackName, bar, cell)}
      title={
        cell.repeatOf ? repeatSentence(cell.repeatOf.barNumber) : undefined
      }
      data-arr-selected={playing ? "" : undefined}
      data-arr-picked={selected ? "" : undefined}
      className={`absolute top-0 rounded-[2px] ${
        bar.isSectionStart
          ? "border-line border-l-2"
          : "border-line/40 border-l"
      } ${playing ? "bg-steel/12 ring-steel/40 ring-1 ring-inset" : ""} ${
        /*
         * Gold, and only ever gold: this is the reader's own choice, and it
         * has to stay legible on top of the blue the transport paints when
         * the two land on the same bar.
         */
        selected ? "bg-bronze/15" : ""
      }`}
      style={{
        left: bar.left,
        width: bar.width,
        height: LANE_HEIGHT,
        minHeight: MIN_TOUCH_TARGET_PX,
      }}
    >
      <CellContent cell={cell} width={bar.width} />
      {cell.repeatOf ? (
        runStart ? (
          <span
            aria-hidden
            className="text-muted/70 absolute right-1 bottom-0.5 truncate text-[9px] leading-none tabular-nums"
            style={{ maxWidth: bar.width - 6 }}
          >
            {repeatChip(cell.repeatOf.barNumber)}
          </span>
        ) : (
          /* Still the same run: a dot, not a repeat of the sentence the cell
             before it already made. */
          <span
            aria-hidden
            className="bg-muted/40 absolute right-1.5 bottom-1.5 h-1 w-1 rounded-full"
          />
        )
      ) : null}
    </button>
  );
}

/**
 * The bar number, and the way the whole bar is picked up.
 *
 * The number is the one thing on this screen that belongs to every track at
 * once, which is exactly what a whole-bar operation acts on — so it is where
 * that gesture goes. A tap moves the transport and stays here: someone
 * checking where bar 19 is should not lose the structure to do it.
 */
export function BarNumberCell({
  bar,
  playing,
  selected,
  onSeek,
  onLongPress,
}: {
  bar: ArrangementBar;
  playing: boolean;
  selected: boolean;
  onSeek: () => void;
  onLongPress: () => void;
}) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      type="button"
      {...{ [ARR_BAR_ATTRIBUTE]: bar.barKey }}
      {...longPress}
      onClick={onSeek}
      data-arr-picked={selected ? "" : undefined}
      aria-label={`${bar.barNumber}. ölçü. Bütün enstrümanlarda seçmek için basılı tutun.`}
      className={`border-line absolute top-0 flex items-center justify-center ${
        bar.isSectionStart ? "border-l-2" : "border-l border-line/40"
      } ${playing ? "bg-steel/12" : ""} ${selected ? "bg-bronze/20 text-bronze" : "text-muted"}`}
      style={{
        left: TRACK_LABEL_WIDTH + bar.left,
        width: bar.width,
        height: BAR_NUMBER_HEIGHT,
      }}
    >
      <span className="text-[10px] tabular-nums">{bar.barNumber}</span>
    </button>
  );
}
