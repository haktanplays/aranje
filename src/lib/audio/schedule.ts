/**
 * Turns a song into timed events.
 *
 * Time is expressed in ticks derived from note values, never in seconds
 * (spec 8.3). A slot is one grid step, so its length follows the bar's
 * resolution: at 8 a slot is an eighth, at 16 a sixteenth, at 12 an eighth
 * triplet. That keeps 6/8, 7/8 and every triplet grid correct without any
 * special case. The arithmetic itself lives in `lib/music/timing.ts`, which
 * is the only place that knows how long a slot is (spec 5.5, K-34).
 *
 * What sounds when comes from the same timeline model the tab view draws, so
 * the ear and the eye cannot drift apart.
 */
import { velocityRange } from "@/lib/limits";
import { PPQ, slotCount, ticksPerSlot } from "@/lib/music/timing";
import type { Articulation, DrumPiece, Song } from "@/lib/song/schema";
import { buildTrackTimeline } from "@/lib/tab/timeline";

/** Velocity used when a note does not carry one. */
export const DEFAULT_VELOCITY = 96;

/**
 * How much of its slot span a note actually sounds. A palm mute is choked, a
 * staccato shorter still, everything else rings for its full length.
 */
export function articulationHold(articulation?: Articulation): number {
  switch (articulation) {
    case "palm_mute":
      return 0.45;
    case "staccato":
      return 0.35;
    case "sustain":
      return 1;
    default:
      return 0.92;
  }
}

export function velocityGain(velocity?: number): number {
  const value = velocity ?? DEFAULT_VELOCITY;
  const clamped = Math.min(
    velocityRange.max,
    Math.max(velocityRange.min, value),
  );
  return clamped / velocityRange.max;
}

export type NoteEventPlan = {
  kind: "note";
  trackId: string;
  /** Ticks from the start of the song. */
  time: number;
  durationTicks: number;
  pitch: string;
  gain: number;
};

export type DrumEventPlan = {
  kind: "drum";
  trackId: string;
  time: number;
  piece: DrumPiece;
  gain: number;
};

export type BarMarker = {
  barKey: string;
  sectionId: string;
  /** 1-based across the song, matching what the tab view prints. */
  barNumber: number;
  time: number;
  durationTicks: number;
  slotCount: number;
  timeSignature: readonly [number, number];
  resolution: number;
};

export type SongPlan = {
  events: (NoteEventPlan | DrumEventPlan)[];
  bars: BarMarker[];
  totalTicks: number;
};

/** Start tick of every bar, in playing order. */
export function barTimeline(song: Song): BarMarker[] {
  const bars: BarMarker[] = [];
  let time = 0;

  let barNumber = 0;

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      barNumber += 1;
      const count = slotCount(bar.timeSignature, bar.resolution);
      const durationTicks = count * ticksPerSlot(bar.resolution);
      bars.push({
        barKey: `${section.id}:${barIndex}`,
        sectionId: section.id,
        barNumber,
        time,
        durationTicks,
        slotCount: count,
        timeSignature: bar.timeSignature,
        resolution: bar.resolution,
      });
      time += durationTicks;
    });
  }

  return bars;
}

/** Everything that has to sound, with the times it has to sound at. */
export function buildSongPlan(song: Song): SongPlan {
  const bars = barTimeline(song);
  const barStart = new Map(bars.map((bar) => [bar.barKey, bar.time]));
  const events: (NoteEventPlan | DrumEventPlan)[] = [];

  for (const track of song.tracks) {
    const timeline = buildTrackTimeline(song, track.id);
    if (timeline.kind === "unsupported") continue;

    if (timeline.kind === "fretted") {
      for (const bar of timeline.bars) {
        if (bar.silent) continue;
        const start = barStart.get(bar.key) ?? 0;
        const step = ticksPerSlot(bar.resolution);

        for (const span of bar.spans) {
          // A span that began in an earlier bar was already scheduled there.
          if (span.openStart) continue;
          const slots = span.endSlot - span.startSlot + 1;
          const full = slots * step;
          events.push({
            kind: "note",
            trackId: track.id,
            time: start + span.startSlot * step,
            durationTicks: Math.max(
              1,
              Math.round(full * articulationHold(span.articulation)),
            ),
            pitch: span.pitch,
            gain: velocityGain(span.velocity),
          });
        }
      }
    } else {
      for (const bar of timeline.bars) {
        if (bar.silent) continue;
        const start = barStart.get(bar.key) ?? 0;
        const step = ticksPerSlot(bar.resolution);
        for (const mark of bar.marks) {
          events.push({
            kind: "drum",
            trackId: track.id,
            time: start + mark.slotIndex * step,
            piece: mark.piece,
            gain: velocityGain(mark.velocity),
          });
        }
      }
    }
  }

  events.sort((a, b) => a.time - b.time);

  const last = bars[bars.length - 1];
  return {
    events,
    bars,
    totalTicks: last ? last.time + last.durationTicks : 0,
  };
}

/** Tone accepts a raw tick count written with the `i` suffix. */
export function ticks(value: number): string {
  return `${Math.max(0, Math.round(value))}i`;
}
