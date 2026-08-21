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
import { useEffect, useRef, type RefObject } from "react";

import {
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
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { PlayPosition } from "@/lib/audio/position";

/** Marks the cell a test or a scroll needs to find. */
export const ARR_CELL_ATTRIBUTE = "data-arr-cell";
export const ARR_SECTION_ATTRIBUTE = "data-arr-section";

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

export function ArrangementCanvas({
  model,
  scrollRef,
  activeBarKey,
  selectedTrackId,
  getPosition,
  running,
  onActiveBarChange,
  onOpenBar,
  onSelectTrack,
}: {
  model: ArrangementModel;
  scrollRef: RefObject<HTMLDivElement | null>;
  activeBarKey: string | null;
  selectedTrackId: string;
  getPosition: () => PlayPosition;
  running: boolean;
  onActiveBarChange: (barKey: string | null) => void;
  onOpenBar: (barKey: string) => void;
  onSelectTrack: (trackId: string) => void;
}) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const lastBarKey = useRef<string | null>(null);
  const lanesHeight = model.tracks.length * LANE_HEIGHT;

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
      if (ownScrollLeft.current !== null &&
          Math.abs(scroller.scrollLeft - ownScrollLeft.current) < 2) {
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
        className="relative"
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
              <span className="truncate text-[11px] font-medium">{section.name}</span>
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
                  track.trackId === selectedTrackId ? "text-bronze" : "text-muted"
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
                  const cell = model.cells.get(cellKey(track.trackId, bar.barKey));
                  if (!cell) return null;
                  const runStart =
                    cell.repeatOf !== null &&
                    repeatRunStart(model, track.trackId, barIndex);
                  return (
                    <button
                      key={bar.barKey}
                      type="button"
                      {...{ [ARR_CELL_ATTRIBUTE]: `${track.trackId}|${bar.barKey}` }}
                      onClick={() => {
                        onSelectTrack(track.trackId);
                        onOpenBar(bar.barKey);
                      }}
                      aria-label={cellLabel(track.name, bar, cell)}
                      title={
                        cell.repeatOf ? repeatSentence(cell.repeatOf.barNumber) : undefined
                      }
                      /*
                       * The cell already has the shape of something that could
                       * be picked up: its own boundary, and a state layer that
                       * a selection would light. Bar operations arrive in
                       * 2J.1; what this checkpoint refuses to add is a gesture
                       * or a menu that does not work yet, which is a different
                       * thing from leaving the surface unable to show one.
                       */
                      data-arr-selected={bar.barKey === activeBarKey ? "" : undefined}
                      className={`absolute top-0 rounded-[2px] ${
                        bar.isSectionStart ? "border-line border-l-2" : "border-line/40 border-l"
                      } ${bar.barKey === activeBarKey ? "bg-steel/12 ring-steel/40 ring-1 ring-inset" : ""}`}
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
                          /* Still the same run: a dot, not a repeat of the
                             sentence the cell before it already made. */
                          <span
                            aria-hidden
                            className="bg-muted/40 absolute right-1.5 bottom-1.5 h-1 w-1 rounded-full"
                          />
                        )
                      ) : null}
                    </button>
                  );
                })}

                {/* Sound carrying over a bar line. Drawn as a bridge rather
                    than a colour, so it reads without depending on hue. */}
                {model.links
                  .filter((link) => link.trackId === track.trackId)
                  .map((link) => {
                    const from = model.bars.find((bar) => bar.barKey === link.fromBarKey);
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
        </div>
      </div>
    </div>
  );
}
