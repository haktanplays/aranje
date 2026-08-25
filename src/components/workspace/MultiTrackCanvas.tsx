"use client";

/**
 * Every instrument of one section, on one axis (2Q-A §6, §7, §10).
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
 * once from the section (`lib/multitrack/geometry.ts`).
 *
 * ## One playhead, one frame
 *
 * A single column crosses every lane, moved by transform on a single
 * animation frame through the one loop the whole app uses. It is not a
 * playhead per lane and not a frame per lane: adding a fifth instrument
 * costs no extra callback.
 *
 * When the transport is somewhere this section does not cover, the column is
 * hidden rather than pinned to an edge — a line drawn at the left margin
 * while the music is two sections away is a claim that is not true.
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
import {
  LANE_GAP,
  SLOT_WIDTH,
  STAFF_TOP_PADDING,
} from "@/components/workspace/geometry";
import { MultiTrackLane } from "@/components/workspace/MultiTrackLane";
import { PitchedMultiLane } from "@/components/workspace/PitchedMultiLane";
import { PlayheadLayer } from "@/components/workspace/PlayheadLayer";
import { followScrollLeft } from "@/components/workspace/playhead";
import { useScrollTakeover } from "@/components/workspace/use-scroll-takeover";
import { timeAxis } from "@/lib/multitrack/geometry";
import { runPlayheadLoop } from "@/lib/workspace/playhead-loop";
import { drumRhythm, frettedRhythm } from "@/lib/tab/timeline";
import type { PlayPosition } from "@/lib/audio/position";
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
  model,
  session,
  getPosition,
  running,
  activeBarKey,
  editing,
  drumEntry,
  scrollRef,
  onActivateTrack,
  onSelectBar,
  onActiveBarChange,
  followsPlayback,
  playheadVisible,
}: {
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
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** A tap on a lane makes it the one being edited. It writes nothing. */
  onActivateTrack: (trackId: string) => void;
  onSelectBar: (barKey: string) => void;
  onActiveBarChange: (barKey: string | null) => void;
  followsPlayback: boolean;
  /** False while the reader is looking at a section that is not playing. */
  playheadVisible: boolean;
}) {
  const axis = useMemo(() => timeAxis(model.bars, SLOT_WIDTH), [model.bars]);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastBarKey = useRef<string | null>(null);
  /*
   * Who owns the horizontal position. Without this, activating a lane moved
   * the view: the re-render restarts the loop, the loop paints once whether
   * or not the transport is running, and that paint dragged the reader back
   * to a paused playhead they had scrolled away from (§6, defect C).
   */
  const takeover = useScrollTakeover({ scrollRef, running });

  const stackHeight =
    model.lanes.length * (LANE_BODY_HEIGHT + LANE_GAP) + STAFF_TOP_PADDING;

  /*
   * The one frame. It reads the transport, moves one element and — only when
   * the reader has not taken the view somewhere else — scrolls. React state
   * is not written here: a `setState` per frame would re-render every lane
   * sixty times a second to move a line two pixels.
   */
  useEffect(() => {
    const draw = () => {
      const position = getPosition();
      const element = layerRef.current;
      const bar = position.barKey
        ? axis.bars.find((entry) => entry.key === position.barKey)
        : undefined;
      const x = bar ? bar.x + position.barProgress * bar.width : null;

      if (element) {
        if (x === null || !playheadVisible) {
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

      const scroller = scrollRef.current;
      if (
        scroller &&
        x !== null &&
        playheadVisible &&
        followsPlayback &&
        takeover.follows()
      ) {
        const target = followScrollLeft(
          x,
          { scrollLeft: scroller.scrollLeft, clientWidth: scroller.clientWidth },
          scroller.scrollWidth,
        );
        if (target !== null) takeover.scrollTo(target);
      }
    };

    return runPlayheadLoop({ source: "multi", running, draw });
  }, [
    running,
    axis,
    getPosition,
    onActiveBarChange,
    scrollRef,
    followsPlayback,
    playheadVisible,
    takeover,
  ]);

  return (
    <div className="relative h-full">
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
          data-viewed-section={model.sectionId}
          className="relative min-w-max"
          style={{ paddingTop: STAFF_TOP_PADDING }}
        >
          <PlayheadLayer layerRef={layerRef} height={stackHeight} />

          {model.lanes.map((lane) => (
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
              {lane.kind === "fretted" ? (
                <FrettedMultiLane
                  trackId={lane.trackId}
                  bars={lane.bars}
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
                  bars={lane.bars}
                  laneCount={lane.pieces.length}
                  activeBarKey={activeBarKey}
                  editable={lane.active}
                  entry={lane.active ? drumEntry : null}
                  onSelectBar={(barKey) => {
                    if (!lane.active) onActivateTrack(lane.trackId);
                    onSelectBar(barKey);
                  }}
                />
              ) : (
                <PitchedMultiLane
                  trackId={lane.trackId}
                  bars={lane.bars}
                  axis={lane.axis}
                  slotCounts={model.bars.map((bar) => bar.slotCount)}
                />
              )}
            </MultiTrackLane>
          ))}
        </div>
      </div>
    </div>
  );
}
