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
          className="bg-muted/40 absolute h-px"
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
          className="bg-steel absolute w-px"
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
 * The same claim, shortened to fit a bar.
 *
 * A 6/8 cell is seventy-two pixels wide and the sentence does not fit in it, so
 * the cell shows the short form and carries the full one as its accessible name
 * and its tooltip. What it may not do is fall back to a symbol: "=1" is not
 * something a reader can be expected to decode, and this is the one label in
 * the view that makes a claim about the music rather than drawing it.
 */
const repeatChip = (barNumber: number) => `= ${barNumber}. ölçü`;

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
              className="border-bronze/70 absolute top-0 flex items-center gap-1.5 overflow-hidden border-l px-1.5 text-left"
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
                className={`bg-app border-line sticky left-0 z-10 shrink-0 border-r px-2 text-left ${
                  track.trackId === selectedTrackId ? "text-bronze" : "text-muted"
                }`}
                style={{ width: TRACK_LABEL_WIDTH, height: LANE_HEIGHT }}
              >
                <span className="block truncate text-[11px] leading-tight">
                  {track.name}
                </span>
                {/* Registry labels, never the ids the song stores. */}
                <span className="block truncate text-[9px] leading-tight opacity-70">
                  {track.instrument}
                </span>
              </button>

              <div className="relative" style={{ width: model.totalWidth }}>
                {model.bars.map((bar) => {
                  const cell = model.cells.get(cellKey(track.trackId, bar.barKey));
                  if (!cell) return null;
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
                      className={`absolute top-0 ${
                        bar.isSectionStart ? "border-bronze/70 border-l" : "border-line/60 border-l"
                      } ${bar.barKey === activeBarKey ? "bg-steel/10" : ""}`}
                      style={{
                        left: bar.left,
                        width: bar.width,
                        height: LANE_HEIGHT,
                        minHeight: MIN_TOUCH_TARGET_PX,
                      }}
                    >
                      <CellContent cell={cell} width={bar.width} />
                      {cell.kind === "silent" ? (
                        <span
                          aria-hidden
                          className="text-muted/45 absolute inset-0 flex items-center justify-center text-[8px]"
                        >
                          Sessiz
                        </span>
                      ) : null}
                      {cell.repeatOf ? (
                        <span
                          aria-hidden
                          className="text-muted/70 absolute right-1 bottom-0.5 truncate text-[8px] leading-none"
                          style={{ maxWidth: bar.width - 6 }}
                        >
                          {repeatChip(cell.repeatOf.barNumber)}
                        </span>
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
                        className="border-bronze pointer-events-none absolute rounded-b-full border-x border-b"
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
