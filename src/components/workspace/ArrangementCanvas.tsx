"use client";

/**
 * The song seen as a structure (spec 13.10, K-39).
 *
 * One lane per track, one cell per bar, section boundaries above them. Every
 * mark on screen comes from the arrangement model, which comes from the Song;
 * nothing here is decorative and nothing is invented to fill a cell. A bar the
 * track does not play is drawn empty and says "Sessiz" — not a row of faint
 * ghost notes, which would tell a reader there is something there to read.
 *
 * The cells are deliberately not miniature tab. You cannot read a pitch off
 * them and you are not meant to: the contour says "the line rises here", the
 * ticks say "it is busy here", the bridge says "this note is still ringing".
 * Anything finer is what the tab view is for, and it is one tap away.
 *
 * ## What each colour means here
 *
 * Fixed roles, so nothing on this screen has to be decoded twice (spec 13.11):
 *
 * - **Blue** is the music's position and the music's continuity: the playhead
 *   column, the bar being played, and the bridge where a sound carries into the
 *   next bar. Nothing a *reader chooses* is blue.
 * - **Gold** is the reader's own choice — the selected track's name — and
 *   nothing else. It used to mark section boundaries and carry links too, which
 *   put three unrelated meanings on one colour and made the boundaries shout
 *   over the playhead.
 * - **Grey** is everything passive: grid lines, bar lines, section boundaries,
 *   the repeat note. The section boundary is heavier than a bar line and
 *   lighter than the playhead, which is the whole of what it needs to say.
 * - **Red** is never used here, because nothing on this surface fails.
 *
 * Depth follows the same idea: the grid sits back, the onsets a step forward.
 * The lines are structure and the marks are the music.
 *
 * ## One scroller
 *
 * This is the only horizontal scroller while the arrangement is on screen —
 * the tab is not merely hidden, it is unmounted, so there is no second live
 * scroller and no second animation frame. Vertically the same element scrolls,
 * because eight lanes do not fit a phone; the section strip is sticky so the
 * structure stays legible while it does.
 */
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import {
  BAR_NUMBER_HEIGHT,
  LANE_HEIGHT,
  SECTION_HEADER_HEIGHT,
  TRACK_LABEL_WIDTH,
} from "@/lib/arrangement/geometry";
import { LINK_LABELS } from "@/lib/arrangement/links";
import {
  cellKey,
  type ArrangementBar,
  type ArrangementCell,
  type ArrangementModel,
} from "@/lib/arrangement/model";
import { useLongPress } from "@/lib/ui/use-long-press";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { BarSelection } from "@/lib/song/bar-selection";
import type { PlayPosition } from "@/lib/audio/position";

/** Marks the cell a test or a scroll needs to find. */
export const ARR_CELL_ATTRIBUTE = "data-arr-cell";
export const ARR_SECTION_ATTRIBUTE = "data-arr-section";
/** The bar number, which is where a whole-bar selection is picked up. */
export const ARR_BAR_ATTRIBUTE = "data-arr-bar";

/** A request for bars, from whichever gesture made it (spec 13.12). */
export type BarSelectRequest = {
  readonly barIndex: number;
  readonly sectionId: string;
  /** Present for a track selection, absent for a whole-bar one. */
  readonly trackId?: string;
};

/** Which end of an existing selection a handle is moving. */
export type BarSelectEdge = "start" | "end";

/*
 * The resize handles.
 *
 * A full 44px square at each end would cover most of a single-bar selection
 * and take the cells under it out of reach, so the touch area is spent where
 * the gesture actually needs it: full lane height to grab, narrower across,
 * because the drag is horizontal and the finger only has to *start* on the
 * handle — pointer capture carries the rest.
 */
const HANDLE_WIDTH = 28;
const HANDLE_HEIGHT = MIN_TOUCH_TARGET_PX;

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
 * its tooltip. The recycle glyph is doing the work "= " used to: it says
 * *repeat* without needing a word, which is what leaves room for the number
 * that actually varies.
 */
const repeatChip = (barNumber: number) => `\u21BB${barNumber}`;

/**
 * Is this cell the *start* of a run of repeats, or the middle of one?
 *
 * A bass line that plays the same bar for thirty bars is thirty true repeat
 * labels, and thirty of anything down one lane is noise rather than
 * information. The first cell of a run says which bar it repeats; the ones
 * behind it keep a quieter mark that says the run is still going.
 *
 * Derived at render time from the model as it already is. No repeat-run data
 * model is being invented here — a fuller summary belongs with the arrangement
 * work in 2J.1, and this is presentation only.
 */
function repeatRunStart(
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
function BarCell({
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
function BarNumberCell({
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

/**
 * One end of a bar selection, as something a finger can move.
 *
 * Its own component so the drag flag is its own ref: two handles sharing one
 * flag is two handles that can disagree about who is being dragged, and a ref
 * read inside a `map` during render is a ref read at the wrong time.
 */
function SelectionHandle({
  edge,
  anchorX,
  left,
  top,
  onDragTo,
}: {
  edge: BarSelectEdge;
  /** Where this edge currently sits, in the arrangement's own pixels. */
  anchorX: number;
  left: number;
  top: number;
  onDragTo: (contentX: number) => void;
}) {
  /*
   * Where the gesture started, on the glass and in the arrangement.
   *
   * Both are taken once, at the press. A delta needs no layout read — the
   * edge's own position in arrangement pixels is already known — but it must
   * be measured from where the edge *was*, not from where it is now: the edge
   * moves as the selection grows, and adding the whole distance travelled to
   * an anchor that has already moved makes the drag run away from the finger.
   */
  const from = useRef<{ readonly clientX: number; readonly anchorX: number } | null>(
    null,
  );
  return (
    <button
      type="button"
      data-arr-handle={edge}
      aria-label={
        edge === "start"
          ? "Seçimin başlangıcını değiştir"
          : "Seçimin sonunu değiştir"
      }
      /*
       * Pointer capture, because the finger leaves the handle immediately —
       * the gesture is a swipe across bars and the handle is narrower than a
       * bar. Without it the drag would end on the first cell it crossed.
       */
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        from.current = { clientX: event.clientX, anchorX };
      }}
      onPointerMove={(event) => {
        const started = from.current;
        if (started === null) return;
        onDragTo(started.anchorX + (event.clientX - started.clientX));
      }}
      onPointerUp={() => {
        from.current = null;
      }}
      onPointerCancel={() => {
        from.current = null;
      }}
      className="border-bronze bg-app absolute z-[6] flex items-center justify-center rounded-md border-2"
      style={{
        left,
        top,
        width: HANDLE_WIDTH,
        height: HANDLE_HEIGHT,
        // The scroller must not take the gesture: this one really is a drag.
        touchAction: "none",
      }}
    >
      <span className="bg-bronze h-4 w-0.5 rounded-full" aria-hidden />
    </button>
  );
}

export function ArrangementCanvas({
  model,
  scrollRef,
  activeBarKey,
  selectedTrackId,
  getPosition,
  running,
  onActiveBarChange,
  onOpenBar,
  onSeekBar,
  onSelectTrack,
  barSelection,
  onSelectBars,
  onExtendBars,
  ghost = false,
}: {
  model: ArrangementModel;
  scrollRef: RefObject<HTMLDivElement | null>;
  activeBarKey: string | null;
  selectedTrackId: string;
  getPosition: () => PlayPosition;
  running: boolean;
  onActiveBarChange: (barKey: string | null) => void;
  onOpenBar: (barKey: string) => void;
  /** Move the transport without leaving the structure. */
  onSeekBar: (barKey: string) => void;
  onSelectTrack: (trackId: string) => void;
  /** The bars a reader is holding, if any (spec 13.12). */
  barSelection: BarSelection | null;
  /**
   * A long press asking for a range of bars.
   *
   * `trackId` present means the reader pressed one lane's cell and wants that
   * track's content; absent means they pressed the bar number and want the
   * bar itself, every track in it included. The two are never merged: one
   * empties a cell, the other removes a bar from the song.
   */
  onSelectBars?: (request: BarSelectRequest) => void;
  /**
   * A handle dragged to a bar. Whole bars only — there is no other step for a
   * bar selection to take, so the range cannot end up half way through one.
   */
  onExtendBars?: (edge: BarSelectEdge, barIndex: number) => void;
  /**
   * True when `model` is the song a staged command *would* produce.
   *
   * The arrangement then draws the outcome rather than a sentence about it —
   * half-lit, and untouchable, because the bars in it do not exist yet and a
   * press on one would be a press on a bar the song does not have.
   */
  ghost?: boolean;
}) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const lastBarKey = useRef<string | null>(null);
  const lanesHeight = model.tracks.length * LANE_HEIGHT;

  /** The bars currently held, as a set of keys, so a cell is one lookup. */
  const pickedBarKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!barSelection) return keys;
    for (const bar of model.bars) {
      if (
        bar.sectionId === barSelection.sectionId &&
        bar.barIndex >= barSelection.startBarIndex &&
        bar.barIndex <= barSelection.endBarIndex
      ) {
        keys.add(bar.barKey);
      }
    }
    return keys;
  }, [barSelection, model.bars]);

  /**
   * Where the selection sits on screen.
   *
   * A track selection is one lane tall and a whole-bar selection is all of
   * them, which is the difference between the two scopes made visible without
   * a word: you can see that one of them is about to touch every instrument.
   */
  const box = useMemo(() => {
    if (!barSelection) return null;
    const held = model.bars.filter((bar) => pickedBarKeys.has(bar.barKey));
    const first = held[0];
    const last = held[held.length - 1];
    if (!first || !last) return null;
    if (barSelection.scope === "full") {
      return {
        left: first.left,
        width: last.left + last.width - first.left,
        top: 0,
        height: lanesHeight,
      };
    }
    const lane = model.tracks.findIndex(
      (track) => track.trackId === barSelection.trackId,
    );
    if (lane < 0) return null;
    return {
      left: first.left,
      width: last.left + last.width - first.left,
      top: lane * LANE_HEIGHT,
      height: LANE_HEIGHT,
    };
  }, [barSelection, lanesHeight, model.bars, model.tracks, pickedBarKeys]);

  /**
   * Which bar a point in the arrangement is in.
   *
   * Bars are the only step a bar selection has, so this can only answer with a
   * whole one — there is no arithmetic here that could land between two. A
   * point outside the selection's own section is no answer at all: a selection
   * lives in one section, and a handle dragged past the boundary must stop at
   * it rather than quietly taking the selection somewhere else.
   */
  const barAtContentX = useCallback(
    (x: number): number | null => {
      if (!barSelection) return null;
      const hit = model.bars.find(
        (bar) =>
          bar.sectionId === barSelection.sectionId &&
          x >= bar.left &&
          x < bar.left + bar.width,
      );
      return hit ? hit.barIndex : null;
    },
    [barSelection, model.bars],
  );

  /*
   * Whether the reader has taken the view somewhere themselves.
   *
   * Following the playhead is a convenience, and a convenience that overrides
   * a deliberate action is an annoyance. Once someone scrolls to look at bar
   * 30 while bar 3 is playing, the view stays at bar 30. Pressing play again
   * hands the view back to the transport.
   */
  const userScrolled = useRef(false);
  const ownScrollLeft = useRef<number | null>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      // A scroll this component set itself is not the reader taking over.
      if (
        ownScrollLeft.current !== null &&
        Math.abs(scroller.scrollLeft - ownScrollLeft.current) < 2
      ) {
        return;
      }
      userScrolled.current = true;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  // Starting playback gives the view back to the transport.
  useEffect(() => {
    if (running) userScrolled.current = false;
  }, [running]);

  /*
   * One animation frame for the whole canvas, and only while the transport is
   * running. The column is moved by transform, so a playing bar costs no
   * render — the same arrangement the tab uses.
   */
  useEffect(() => {
    let frame = 0;

    const draw = () => {
      const position = getPosition();
      const bar = model.bars.find((entry) => entry.barKey === position.barKey);
      const column = columnRef.current;

      if (column) {
        if (!bar) {
          column.style.opacity = "0";
        } else {
          column.style.opacity = "1";
          column.style.width = `${bar.width}px`;
          column.style.transform = `translateX(${bar.left}px)`;
        }
      }

      if (position.barKey !== lastBarKey.current) {
        lastBarKey.current = position.barKey;
        onActiveBarChange(position.barKey);

        // Only on a bar change, and only if the reader has not taken over:
        // a per-frame scroll would fight the finger and trail the music.
        const scroller = scrollRef.current;
        if (bar && scroller && !userScrolled.current) {
          const viewLeft = scroller.scrollLeft;
          const viewRight = viewLeft + scroller.clientWidth - TRACK_LABEL_WIDTH;
          if (bar.left < viewLeft || bar.left + bar.width > viewRight) {
            const target = Math.max(0, bar.left - scroller.clientWidth / 3);
            ownScrollLeft.current = target;
            scroller.scrollLeft = target;
          }
        }
      }

      if (running) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [running, model, getPosition, onActiveBarChange, scrollRef]);

  return (
    <div
      ref={scrollRef}
      data-arrangement-scroller
      className="h-full overflow-x-auto overscroll-x-contain"
    >
      <div
        data-arr-ghost={ghost ? "" : undefined}
        className={`relative ${ghost ? "pointer-events-none opacity-50" : ""}`}
        style={{ width: TRACK_LABEL_WIDTH + model.totalWidth }}
      >
        {/* Sections. Their boundaries are stronger than any bar line, because
            they are the joints a reader navigates by. */}
        <div
          className="bg-app border-line sticky top-0 z-20 border-b"
          style={{ height: SECTION_HEADER_HEIGHT }}
        >
          {model.sections.map((section) => (
            <button
              key={section.sectionId}
              type="button"
              {...{ [ARR_SECTION_ATTRIBUTE]: section.sectionId }}
              onClick={() => {
                const scroller = scrollRef.current;
                if (!scroller) return;
                userScrolled.current = true;
                scroller.scrollTo({ left: section.left, behavior: "smooth" });
              }}
              // Scrolling only. Seeking is what a bar cell does, and running
              // the two together would make every glance at the structure move
              // the music.
              aria-label={`${section.name} bölümüne git`}
              className="border-line absolute top-0 flex items-center gap-1.5 overflow-hidden border-l-2 px-1.5 text-left"
              style={{
                left: TRACK_LABEL_WIDTH + section.left,
                width: section.width,
                height: SECTION_HEADER_HEIGHT,
              }}
            >
              <span className="truncate text-[11px] font-medium">
                {section.name}
              </span>
              <span className="text-muted shrink-0 text-[10px] tabular-nums">
                {section.barCount} ölçü · {section.meterLabel} ·{" "}
                {section.bpmFrom === null
                  ? `${section.bpm} BPM`
                  : /* A step, stated as a step. There is no tempo ramp in this
                       version, so nothing here may suggest a glide. */
                    `${section.bpmFrom} → ${section.bpm} BPM`}
              </span>
            </button>
          ))}
        </div>

        {/*
          The bar numbers.

          They are the one row on this screen that belongs to every track at
          once, so they are where a whole-bar selection is picked up — and,
          incidentally, the thing the arrangement was missing: until now you
          could see that a section had eight bars but not which eight.
        */}
        <div
          className="bg-app border-line sticky z-20 border-b"
          style={{ height: BAR_NUMBER_HEIGHT, top: SECTION_HEADER_HEIGHT }}
        >
          {/* The lane names' column, kept clear, so a scrolled bar number does
              not end up sitting where a track name is about to be. */}
          <div
            aria-hidden
            className="bg-app border-line sticky left-0 z-10 h-full border-r"
            style={{ width: TRACK_LABEL_WIDTH }}
          />
          {model.bars.map((bar) => (
            <BarNumberCell
              key={bar.barKey}
              bar={bar}
              playing={bar.barKey === activeBarKey}
              selected={
                barSelection?.scope === "full" && pickedBarKeys.has(bar.barKey)
              }
              onSeek={() => onSeekBar(bar.barKey)}
              onLongPress={() =>
                onSelectBars?.({
                  barIndex: bar.barIndex,
                  sectionId: bar.sectionId,
                })
              }
            />
          ))}
        </div>

        <div className="relative" style={{ height: lanesHeight }}>
          {/* The bar the transport is in, drawn across every lane at once. */}
          <div
            ref={columnRef}
            aria-hidden
            className="bg-steel/12 border-steel pointer-events-none absolute top-0 z-10 border-x opacity-0"
            style={{
              height: lanesHeight,
              left: TRACK_LABEL_WIDTH,
              willChange: "transform",
            }}
          />

          {model.tracks.map((track, laneIndex) => (
            <div
              key={track.trackId}
              className="border-line absolute right-0 left-0 flex border-b"
              style={{ top: laneIndex * LANE_HEIGHT, height: LANE_HEIGHT }}
            >
              <button
                type="button"
                onClick={() => onSelectTrack(track.trackId)}
                data-arr-track={track.trackId}
                aria-pressed={track.trackId === selectedTrackId}
                aria-label={`${track.name}, ${track.instrument}${
                  track.silentThroughout ? ", bu şarkıda hiç çalmıyor" : ""
                }`}
                className={`bg-app border-line sticky left-0 z-10 shrink-0 border-r px-2 text-left ${
                  track.trackId === selectedTrackId
                    ? "text-bronze"
                    : "text-muted"
                }`}
                style={{ width: TRACK_LABEL_WIDTH, height: LANE_HEIGHT }}
              >
                {/*
                  The name, and nothing under it.
                  
                  A second line saying "Elektro gitar" under "Ritim Gitar" is a
                  category the reader can see from the lane itself, printed
                  eight times down the side of the screen at the cost of the
                  width the music needed. The instrument and its variation are
                  in the track sheet, in full, where they are asked for.
                */}
                <span className="block truncate text-xs leading-tight">
                  {track.name}
                </span>
                {/* One mark, once, for a track that never plays at all. */}
                {track.silentThroughout ? (
                  <span className="text-muted/60 block text-[9px] leading-tight">
                    sessiz
                  </span>
                ) : null}
              </button>

              <div className="relative" style={{ width: model.totalWidth }}>
                {model.bars.map((bar, barIndex) => {
                  const cell = model.cells.get(
                    cellKey(track.trackId, bar.barKey),
                  );
                  if (!cell) return null;
                  return (
                    <BarCell
                      key={bar.barKey}
                      bar={bar}
                      cell={cell}
                      trackId={track.trackId}
                      trackName={track.name}
                      runStart={
                        cell.repeatOf !== null &&
                        repeatRunStart(model, track.trackId, barIndex)
                      }
                      playing={bar.barKey === activeBarKey}
                      selected={
                        barSelection !== null &&
                        (barSelection.scope === "full" ||
                          barSelection.trackId === track.trackId) &&
                        pickedBarKeys.has(bar.barKey)
                      }
                      onOpen={() => {
                        onSelectTrack(track.trackId);
                        onOpenBar(bar.barKey);
                      }}
                      onLongPress={() => {
                        onSelectTrack(track.trackId);
                        onSelectBars?.({
                          barIndex: bar.barIndex,
                          sectionId: bar.sectionId,
                          trackId: track.trackId,
                        });
                      }}
                    />
                  );
                })}

                {/* Sound carrying over a bar line. Drawn as a bridge rather
                    than a colour, so it reads without depending on hue. */}
                {model.links
                  .filter((link) => link.trackId === track.trackId)
                  .map((link) => {
                    const from = model.bars.find(
                      (bar) => bar.barKey === link.fromBarKey,
                    );
                    if (!from) return null;
                    return (
                      <span
                        key={`${link.fromBarKey}-${link.kind}`}
                        role="img"
                        aria-label={LINK_LABELS[link.kind]}
                        className="border-steel pointer-events-none absolute rounded-b-full border-x border-b"
                        style={{
                          left: from.left + from.width - 7,
                          width: 14,
                          top: LANE_HEIGHT - 13,
                          height: 6,
                        }}
                      />
                    );
                  })}
              </div>
            </div>
          ))}

          {/*
            The selection, and the two handles that resize it.

            Drawn over the lanes rather than inside them, so a range that spans
            several bars is one shape instead of a row of separately outlined
            cells — which is the difference between "these bars" and "these
            cells". It takes no pointer events: the cells underneath keep
            answering, so a press on a different bar still starts a new
            selection instead of being swallowed by the outline of the old one.
          */}
          {box ? (
            <div
              aria-hidden
              data-arr-selection-box
              className="border-bronze pointer-events-none absolute z-[5] border-2"
              style={{
                left: TRACK_LABEL_WIDTH + box.left,
                width: box.width,
                top: box.top,
                height: box.height,
              }}
            />
          ) : null}

          {box && onExtendBars
            ? (["start", "end"] as const).map((edge) => (
                <SelectionHandle
                  key={edge}
                  edge={edge}
                  anchorX={edge === "start" ? box.left : box.left + box.width}
                  left={
                    TRACK_LABEL_WIDTH +
                    (edge === "start"
                      ? box.left - HANDLE_WIDTH / 2
                      : box.left + box.width - HANDLE_WIDTH / 2)
                  }
                  top={box.top + box.height / 2 - HANDLE_HEIGHT / 2}
                  onDragTo={(contentX) => {
                    /*
                     * The right handle is measured at the *end* of its bar,
                     * which is the first pixel of the next one — so it is
                     * pulled back inside before the bar is looked up.
                     */
                    const at = barAtContentX(
                      edge === "end" ? contentX - 1 : contentX,
                    );
                    if (at !== null) onExtendBars(edge, at);
                  }}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
