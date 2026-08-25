"use client";

/**
 * Every instrument of the song, on one axis (2Q-A §6, §7, §10; 2Q-C §4).
 *
 * ## One scroller, and why it is not a choice
 *
 * There is exactly one horizontally scrolling element on this surface, and
 * every lane lives inside it. The alternative — a scroller per lane, kept in
 * step by listening to each other's scroll events — is the shape this file
 * exists to avoid: it chases, it fights momentum on a phone, and every lane
 * is a frame behind the one that moved. Here there is nothing to keep in
 * step, because there is nothing that can differ.
 *
 * Bar lines land at the same x in every lane for a structural reason rather
 * than a maintained one: meter and resolution belong to the bar, so every
 * track written in a bar has the same slot count, and the axis is computed
 * once for the whole song (`lib/tab/song-axis.ts`) — the same axis the Tab
 * surface uses.
 *
 * ## The whole song, and only part of it in the DOM
 *
 * It was one section per surface until 2Q-C, which is why the view reset
 * itself whenever playback crossed a boundary: a new section meant a new
 * model, a new axis and a scroll position that meant something else. Now
 * every section is on one surface, and what keeps eight lanes at 1/32
 * affordable is that only the bars near the viewport are mounted. The scroll
 * content keeps the axis's full width, so nothing that reasons about the
 * song can tell the difference — a bar that is not mounted is not missing,
 * it is simply not drawn yet.
 *
 * ## One playhead, one frame
 *
 * A single column crosses every lane, moved by transform on a single
 * animation frame through the one loop the whole app uses. It is not a
 * playhead per lane and not a frame per lane: adding a fifth instrument
 * costs no extra callback. Where the surface should be scrolled to on that
 * frame is `use-reading-surface`'s answer, not this file's.
 *
 * ## What this is not
 *
 * Not a mixer: no level, no pan, no mute, no solo. Not a cross-track editor:
 * one lane is active, and it is the only one a gesture here can change.
 */
import { useEffect, useMemo, useRef } from "react";

import { DrumMultiLane, type DrumStepArming } from "@/components/workspace/DrumMultiLane";
import {
  FrettedMultiLane,
  type LaneEditing,
} from "@/components/workspace/FrettedMultiLane";
import { LANE_GAP, STAFF_TOP_PADDING } from "@/components/workspace/geometry";
import { MultiTrackLane } from "@/components/workspace/MultiTrackLane";
import {
  PitchedMultiLane,
  type PitchedStepArming,
} from "@/components/workspace/PitchedMultiLane";
import { PlayheadLayer } from "@/components/workspace/PlayheadLayer";
import { ReturnToPlayback } from "@/components/workspace/ReturnToPlayback";
import { SectionMarkers } from "@/components/workspace/SectionMarkers";
import { xAtSection, xAtTicks } from "@/lib/tab/song-axis";
import { useDrumGridWindow } from "@/lib/workspace/use-drum-grid-window";
import { useReadingSurface } from "@/lib/workspace/use-reading-surface";
import { runPlayheadLoop } from "@/lib/workspace/playhead-loop";
import { drumRhythm, frettedRhythm } from "@/lib/tab/timeline";
import type { PlayPosition } from "@/lib/audio/position";
import type { Song } from "@/lib/song/schema";
import type { MultiTrackLane as Lane, MultiTrackModel } from "@/lib/multitrack/model";
import type { MultiTrackSession } from "@/lib/workspace/use-multitrack-session";

/** How tall the whole stack is, so the playhead column spans all of it. */
const LANE_BODY_HEIGHT = 120;

/**
 * A folded lane's one line: where the onsets are, and nothing else.
 *
 * Enough to see that a track is busy here and quiet there without unfolding
 * it, and deliberately not enough to read — a digest that tried to be
 * notation would be a second, worse renderer.
 */
function digestOf(lane: Lane): string {
  const marks: string[] = [];
  for (const bar of lane.bars) {
    if (lane.kind === "fretted") {
      const states = frettedRhythm(bar as never);
      marks.push(states.some((state) => state === "onset") ? "▮" : "·");
    } else if (lane.kind === "drums") {
      const states = drumRhythm(bar as never);
      marks.push(states.some((state) => state === "onset") ? "▮" : "·");
    } else {
      const notes = "notes" in bar ? bar.notes : [];
      marks.push(notes.length > 0 ? "▮" : "·");
    }
  }
  return marks.join(" ");
}

export function MultiTrackCanvas({
  song,
  model,
  session,
  getPosition,
  running,
  activeBarKey,
  editing,
  drumEntry,
  pitchedEntry,
  scrollRef,
  onActivateTrack,
  onSelectBar,
  onActiveBarChange,
  onScrolledToSection,
  pendingScroll,
  onPendingHandled,
}: {
  song: Song;
  model: MultiTrackModel;
  session: MultiTrackSession;
  getPosition: () => PlayPosition;
  running: boolean;
  activeBarKey: string | null;
  /**
   * The edit machinery, or null when edit mode is off.
   *
   * It is handed to **one** lane — the active one — and to no other. Not as a
   * flag an inactive lane is trusted to respect: the object simply is not
   * there, so there is nothing an inactive lane could resolve a gesture
   * against. A long press cannot start a selection on a track the reader is
   * not editing, and a tap cannot write to one (§8).
   */
  editing: LaneEditing | null;
  /**
   * The kit's step grid, armed, or null.
   *
   * Handed to the active drum lane and to no other, for the same reason
   * `editing` is: an inactive lane has nothing to resolve a tap against.
   */
  drumEntry: DrumStepArming | null;
  /** The fretless track's strip, armed, or null (2Q-B §7.3). */
  pitchedEntry: PitchedStepArming | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** A tap on a lane makes it the one being edited. It writes nothing. */
  onActivateTrack: (trackId: string) => void;
  onSelectBar: (barKey: string) => void;
  onActiveBarChange: (barKey: string | null) => void;
  /** The reader scrolled themselves into a different section (2Q-C §4). */
  onScrolledToSection: (sectionId: string) => void;
  /**
   * A bar the surface has been asked to bring into view, or null.
   *
   * `follows` distinguishes a bar tap (which seeks, so the view may go back
   * to following the transport) from a section choice (which does not).
   */
  pendingScroll: { barKey: string; follows: boolean } | null;
  onPendingHandled: () => void;
}) {
  const surface = useReadingSurface({ song, scrollRef, running, onScrolledToSection });
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastBarKey = useRef<string | null>(null);

  const stackHeight =
    model.lanes.length * (LANE_BODY_HEIGHT + LANE_GAP) + STAFF_TOP_PADDING;

  /*
   * Which bars are drawn. The model is the whole song and the window is the
   * part of it worth having in the DOM; the two are joined by key rather than
   * by index, so a lane cannot end up drawing a different bar than its
   * neighbour at the same x.
   */
  const drawn = useMemo(
    () => new Set(surface.window.renderedBarKeys),
    [surface.window],
  );

  /*
   * The armed kit's own window, in the armed section's coordinates. It rides
   * the same scroller as everything else: the lane is placed at the section's
   * x below, and the grid's origin is that same x (2R-A §6).
   */
  const drumSectionX = drumEntry
    ? xAtSection(surface.axis, drumEntry.model.sectionId) ?? 0
    : 0;
  const grid = useDrumGridWindow({
    model: drumEntry?.model ?? null,
    scrollRef,
    offsetPx: drumSectionX,
  });

  const { scrollToBar } = surface;
  useEffect(() => {
    if (pendingScroll === null) return;
    scrollToBar(pendingScroll.barKey, pendingScroll.follows);
    onPendingHandled();
  }, [onPendingHandled, pendingScroll, scrollToBar]);

  /*
   * The one frame. It reads the transport, moves one element and asks the
   * surface to follow. React state is not written here: a `setState` per
   * frame would re-render every lane sixty times a second to move a line two
   * pixels.
   */
  const { follow } = surface;
  const axis = surface.axis;
  useEffect(() => {
    const draw = () => {
      const position = getPosition();
      const x = xAtTicks(axis, position.ticks);
      const element = layerRef.current;

      if (element) {
        if (x === null) {
          element.style.opacity = "0";
        } else {
          element.style.opacity = "1";
          element.style.transform = `translateX(${x}px)`;
        }
      }

      if (position.barKey !== lastBarKey.current) {
        lastBarKey.current = position.barKey;
        onActiveBarChange(position.barKey);
      }

      follow(x);
    };

    return runPlayheadLoop({ source: "multi", running, draw });
  }, [running, axis, follow, getPosition, onActiveBarChange]);

  return (
    <div className="relative h-full">
      <ReturnToPlayback
        shown={surface.detached}
        onReturn={() => surface.returnToPlayback(xAtTicks(axis, getPosition().ticks))}
      />
      <div
        ref={scrollRef}
        data-multi-scroll
        /*
         * The one horizontally scrolling element on this surface. Lanes stack
         * vertically inside it and share its horizontal position by being in
         * it, not by being told about it.
         */
        className="h-full overflow-x-auto overflow-y-auto overscroll-x-contain"
      >
        <div
          data-multi-content
          data-viewed-section={surface.viewedSectionId ?? undefined}
          className="relative"
          style={{ paddingTop: STAFF_TOP_PADDING, width: surface.contentWidthPx }}
        >
          <SectionMarkers axis={surface.axis} sections={song.sections} />
          <PlayheadLayer layerRef={layerRef} height={stackHeight} />

          {model.lanes.map((lane) => {
            /*
             * An armed step grid draws one section in full rather than the
             * window: it is a writing surface, and the model behind it is a
             * section's. It is placed at that section's own x on the shared
             * axis, so its bar lines still land on every other lane's — the
             * one thing this surface exists to hold together.
             */
            const armedSectionId = !lane.active
              ? null
              : lane.kind === "drums" && drumEntry
              ? drumEntry.model.sectionId
              : lane.kind === "pitched" && pitchedEntry
              ? pitchedEntry.model.sectionId
              : null;
            const leadPx =
              armedSectionId === null
                ? surface.window.beforePx
                : xAtSection(surface.axis, armedSectionId) ?? 0;
            return (
            <MultiTrackLane
              key={lane.trackId}
              trackId={lane.trackId}
              label={lane.label}
              instrumentFamily={lane.instrumentFamily}
              active={lane.active}
              collapsed={session.isCollapsed(lane.trackId)}
              silentThroughout={lane.silentThroughout}
              onActivate={() => onActivateTrack(lane.trackId)}
              onToggleCollapse={() => session.toggleCollapse(lane.trackId)}
              digest={<span className="font-mono text-[10px]">{digestOf(lane)}</span>}
            >
              {/*
                The empty space standing in for the bars before this window.
                Padding rather than a translate: the lane's own flex row then
                lands at the bar's real x with no second coordinate system,
                and the three parts of the window add up to the axis exactly.
              */}
              <div style={{ paddingLeft: leadPx }}>
                {lane.kind === "fretted" ? (
                  <FrettedMultiLane
                    trackId={lane.trackId}
                    bars={lane.bars.filter((bar) => drawn.has(bar.key))}
                    stringCount={lane.strings.length}
                    activeBarKey={activeBarKey}
                    editable={lane.active}
                    editing={lane.active ? editing : null}
                    onSelectBar={(barKey) => {
                      // A tap on a lane that is not being edited makes it the
                      // one that is, in the same gesture (§8).
                      if (!lane.active) onActivateTrack(lane.trackId);
                      onSelectBar(barKey);
                    }}
                  />
                ) : lane.kind === "drums" ? (
                  <DrumMultiLane
                    trackId={lane.trackId}
                    bars={lane.bars.filter((bar) => drawn.has(bar.key))}
                    laneCount={lane.pieces.length}
                    activeBarKey={activeBarKey}
                    editable={lane.active}
                    entry={lane.active ? drumEntry : null}
                    grid={grid}
                    onSelectBar={(barKey) => {
                      if (!lane.active) onActivateTrack(lane.trackId);
                      onSelectBar(barKey);
                    }}
                  />
                ) : (
                  <PitchedMultiLane
                    trackId={lane.trackId}
                    bars={lane.bars.filter((bar) => drawn.has(bar.key))}
                    axis={lane.axis}
                    slotCounts={surface.window.bars.map((bar) => bar.slotCount)}
                    entry={lane.active ? pitchedEntry : null}
                  />
                )}
              </div>
            </MultiTrackLane>
            );
          })}
        </div>
      </div>
    </div>
  );
}
