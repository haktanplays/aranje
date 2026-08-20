/**
 * The one place ticks become seconds (spec 8.3, 13.8, K-25).
 *
 * Everything that sounds is scheduled in **ticks**, which are tempo-free by
 * construction — that has been true since phase 0 and does not change here.
 * What changes is that "how long is a tick" stopped being a single number.
 * A song may now run at different tempos in different sections, so anyone who
 * needs seconds has to ask a timeline rather than divide by `song.bpm`.
 *
 * Before this existed, roughly a dozen places computed `60 / (bpm * PPQ)`
 * from the global tempo. Each of them would have been silently wrong the
 * moment a section carried its own tempo, and wrong in a way nothing would
 * catch: the audio would play at one tempo and the playhead would draw at
 * another. So the rule is not "use this where convenient" — it is that there
 * is no second way to answer the question.
 *
 * ## Semantics (v1)
 *
 * A section's tempo is `section.bpmOverride ?? song.bpm`, and it takes effect
 * on the **first tick of that section's first bar**. Nothing carries over: a
 * section with no override runs at the song's own tempo, whatever the section
 * before it did. That makes each section self-describing, which is what the
 * arrange contract needs — a model shown one section can be told its tempo
 * without also being told the history that led to it.
 *
 * Only step changes at section boundaries exist. No ramp, no rubato, no
 * tempo inside a bar; those are deliberately not in this version.
 *
 * ## Practice rate
 *
 * Practice rate is a *performance* multiplier, not a property of the music.
 * It scales the whole map and never touches the Song (spec 13.8), so the
 * same song at 50% is the same song.
 */
import { PPQ, barTimeline } from "@/lib/audio/schedule";
import { DEFAULT_PRACTICE_PERCENT } from "@/lib/audio/practice-rate";
import type { Song } from "@/lib/song/schema";

/** One stretch of the song that runs at a single tempo. */
export type TempoSegment = {
  sectionId: string;
  /** First tick of the segment, from the start of the song. */
  startTicks: number;
  /** One past the last tick. */
  endTicks: number;
  /** The tempo actually used, practice rate already applied. */
  bpm: number;
  /** The tempo as the Song declares it, before practice rate. */
  writtenBpm: number;
  /** Where the segment begins, in seconds. */
  startSeconds: number;
  secondsPerTick: number;
};

export type TempoMap = {
  segments: readonly TempoSegment[];
  totalTicks: number;
  totalSeconds: number;
  /** Whole percent of the song's own tempo this map was built at. */
  practicePercent: number;
};

/** The tempo a section is written at, before practice rate (spec 5.1). */
export function sectionBpm(song: Song, sectionId: string): number {
  const section = song.sections.find((entry) => entry.id === sectionId);
  return section?.bpmOverride ?? song.bpm;
}

/** True when the song asks for more than one tempo (spec 13.8 UI). */
export function hasTempoChanges(song: Song): boolean {
  return song.sections.some(
    (section) =>
      section.bpmOverride !== undefined && section.bpmOverride !== song.bpm,
  );
}

/**
 * The song's tempo timeline, one segment per section.
 *
 * Sections are kept even when neighbouring tempos match, because a segment is
 * "a section's stretch of time" and callers ask about sections by id.
 */
export function buildTempoMap(
  song: Song,
  practicePercent: number = DEFAULT_PRACTICE_PERCENT,
): TempoMap {
  const bars = barTimeline(song);
  const scale = practicePercent / DEFAULT_PRACTICE_PERCENT;

  const segments: TempoSegment[] = [];
  let startSeconds = 0;

  for (const section of song.sections) {
    const own = bars.filter((bar) => bar.sectionId === section.id);
    if (own.length === 0) continue;

    const startTicks = own[0]?.time ?? 0;
    const last = own[own.length - 1];
    const endTicks = (last?.time ?? 0) + (last?.durationTicks ?? 0);

    const writtenBpm = section.bpmOverride ?? song.bpm;
    const bpm = writtenBpm * scale;
    const secondsPerTick = 60 / (bpm * PPQ);

    segments.push({
      sectionId: section.id,
      startTicks,
      endTicks,
      bpm,
      writtenBpm,
      startSeconds,
      secondsPerTick,
    });
    startSeconds += (endTicks - startTicks) * secondsPerTick;
  }

  const totalTicks = segments[segments.length - 1]?.endTicks ?? 0;
  return { segments, totalTicks, totalSeconds: startSeconds, practicePercent };
}

/** The segment a tick falls in. Ticks past the end belong to the last one. */
export function segmentAtTicks(map: TempoMap, ticks: number): TempoSegment | null {
  if (map.segments.length === 0) return null;
  for (const segment of map.segments) {
    if (ticks < segment.endTicks) return segment;
  }
  return map.segments[map.segments.length - 1] ?? null;
}

/** How long one tick lasts at this point in the song. */
export function secondsPerTickAt(map: TempoMap, ticks: number): number {
  const segment = segmentAtTicks(map, ticks);
  return segment?.secondsPerTick ?? 60 / (120 * PPQ);
}

/** The tempo sounding at this tick, practice rate included. */
export function tempoAtTicks(map: TempoMap, ticks: number): number {
  const segment = segmentAtTicks(map, ticks);
  return segment?.bpm ?? 0;
}

/** Where a tick falls, in seconds from the start of the song. */
export function secondsAtTicks(map: TempoMap, ticks: number): number {
  const segment = segmentAtTicks(map, ticks);
  if (!segment) return 0;
  return segment.startSeconds + (ticks - segment.startTicks) * segment.secondsPerTick;
}

/**
 * How long a span of ticks lasts, measured where it actually sits.
 *
 * Not `ticks * secondsPerTick`: a note held across a tempo change lasts the
 * sum of its two parts, and asking the timeline twice is what gets that right.
 */
export function durationSeconds(
  map: TempoMap,
  fromTicks: number,
  spanTicks: number,
): number {
  return secondsAtTicks(map, fromTicks + spanTicks) - secondsAtTicks(map, fromTicks);
}

/** The inverse, for a playhead reading a clock. */
export function ticksAtSeconds(map: TempoMap, seconds: number): number {
  if (map.segments.length === 0) return 0;
  for (const segment of map.segments) {
    const end = segment.startSeconds + (segment.endTicks - segment.startTicks) * segment.secondsPerTick;
    if (seconds < end) {
      return segment.startTicks + (seconds - segment.startSeconds) / segment.secondsPerTick;
    }
  }
  return map.totalTicks;
}

export function sectionStartSeconds(map: TempoMap, sectionId: string): number {
  return map.segments.find((s) => s.sectionId === sectionId)?.startSeconds ?? 0;
}

export function sectionStartTicks(map: TempoMap, sectionId: string): number {
  return map.segments.find((s) => s.sectionId === sectionId)?.startTicks ?? 0;
}

export function songDurationSeconds(
  song: Song,
  practicePercent: number = DEFAULT_PRACTICE_PERCENT,
): number {
  return buildTempoMap(song, practicePercent).totalSeconds;
}
