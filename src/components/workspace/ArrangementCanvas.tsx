"use client";

/**
 * The song seen as a structure (spec 13.10, K-39).
 *
 * One lane per track, one cell per bar, section boundaries above them. Every
 * mark on screen comes from the arrangement model, which comes from the Song;
 * nothing here is decorative and nothing is invented to fill a cell.
 *
 * ## What each colour means here
 *
 * Fixed roles, so nothing on this screen has to be decoded twice (spec 13.11):
 *
 * - **Blue** is the music's position and the music's continuity: the playhead
 *   column, the bar being played, and the bridge where a sound carries into the
 *   next bar. Nothing a *reader chooses* is blue.
 * - **Gold** is the reader's own choice — the selected track's name — and
 *   nothing else.
 * - **Grey** is everything passive: grid lines, bar lines, section boundaries,
 *   the repeat note.
 * - **Red** is never used here, because nothing on this surface fails.
 *
 * ## One scroller
 *
 * This is the only horizontal scroller while the arrangement is on screen —
 * the tab is not merely hidden, it is unmounted, so there is no second live
 * scroller and no second animation frame. Vertically the same element scrolls,
 * because eight lanes do not fit a phone; the section strip is sticky so the
 * structure stays legible while it does.
 *
 * The cells, the selection handle and the follow-scroll frame live in
 * `./arrangement/` (2L-R); this file owns the layout, the selection geometry
 * and the wiring between them.
 */
import { useCallback, useMemo, useRef, type RefObject } from "react";

import {
  BAR_NUMBER_HEIGHT,
  LANE_HEIGHT,
  SECTION_HEADER_HEIGHT,
  TRACK_LABEL_WIDTH,
} from "@/lib/arrangement/geometry";
import { LINK_LABELS } from "@/lib/arrangement/links";
import {
  cellKey,
  type ArrangementModel,
} from "@/lib/arrangement/model";
import {
  BarCell,
  BarNumberCell,
  repeatRunStart,
} from "@/components/workspace/arrangement/ArrangementCells";
import {
  HANDLE_HEIGHT,
  HANDLE_WIDTH,
  SelectionHandle,
} from "@/components/workspace/arrangement/SelectionHandle";
import { useFollowPlayhead } from "@/components/workspace/arrangement/use-follow-playhead";
import type { BarSelection } from "@/lib/song/bar-selection";
import type { PlayPosition } from "@/lib/audio/position";

export const ARR_SECTION_ATTRIBUTE = "data-arr-section";

/** A request for bars, from whichever gesture made it (spec 13.12). */
export type BarSelectRequest = {
  readonly barIndex: number;
  readonly sectionId: string;
  /** Present for a track selection, absent for a whole-bar one. */
  readonly trackId?: string;
};

/** Which end of an existing selection a handle is moving. */
export type BarSelectEdge = "start" | "end";

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
  const lanesHeight = model.tracks.length * LANE_HEIGHT;

  const { markUserScroll } = useFollowPlayhead({
    scrollRef,
    columnRef,
    model,
    getPosition,
    running,
    onActiveBarChange,
  });

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
                markUserScroll();
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
          once, so they are where a whole-bar selection is picked up.
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
                {/* The name, and nothing under it: the instrument and its
                    variation are in the track sheet, in full. */}
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
            cells. It takes no pointer events: the cells underneath keep
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
