/**
 * What a piece actually does with the grids it has (spec 5.5, 11.6, K-34).
 *
 * Reporting only. Nothing here is a validator, nothing here refuses anything,
 * and — the part that matters most — **nothing here scores a finer grid as
 * better music**. A piece written entirely on 1/8 with a good riff beats one
 * written entirely on 1/32 with none, and a report that returned a single
 * number would end up being read as if it disagreed.
 *
 * So what comes back is a set of counts a reader can argue with: which grids
 * were used and how often, how fast the fastest real onset gap was, whether
 * the fast writing came in bursts or ran continuously, and how much of the
 * piece was put on a fine grid without needing one.
 *
 * The heuristics are named as heuristics on purpose. "Four consecutive
 * onsets mostly moving one way by one or two semitones" is not what a scalar
 * run *is*; it is something that can be counted the same way twice, which is
 * what a comparison between two pieces needs.
 */
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildTempoMap, durationSeconds } from "@/lib/audio/tempo";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { pitchToMidi } from "@/lib/music/pitch";
import { isTripletGrid, type Resolution } from "@/lib/music/timing";
import type { Song } from "@/lib/song/schema";

export type GridDistribution = {
  totalBars: number;
  byResolution: Record<number, number>;
  tripletBars: number;
  /** Bars finer than 1/16. */
  highResolutionBars: number;
  thirtySecondBars: number;
  /**
   * Bars on a grid finer than 1/16 that carry no onset needing it.
   *
   * A bar written at 1/32 whose onsets all sit on 1/16 positions did not need
   * the grid. Not wrong — but it is the shape of "raised everything to be
   * safe", and a reader should be able to see how much of it there is.
   */
  unusedFineBars: number;
};

export function gridDistribution(song: Song): GridDistribution {
  const plan = buildSongPlan(song);
  const byResolution: Record<number, number> = {};
  let tripletBars = 0;
  let highResolutionBars = 0;
  let thirtySecondBars = 0;
  let unusedFineBars = 0;

  for (const bar of plan.bars) {
    byResolution[bar.resolution] = (byResolution[bar.resolution] ?? 0) + 1;
    if (isTripletGrid(bar.resolution)) tripletBars += 1;
    if (bar.resolution <= 16) continue;
    highResolutionBars += 1;
    if (bar.resolution === 32) thirtySecondBars += 1;

    /*
     * Would a coarser grid have held this bar's onsets? Halving a straight
     * grid, or thirding a triplet one, keeps every position whose index is
     * divisible; if all of them are, the finer grid bought nothing here.
     */
    const step = isTripletGrid(bar.resolution) ? 2 : 2;
    const onsets = onsetSlotsIn(song, bar.barKey);
    if (onsets.length > 0 && onsets.every((slot) => slot % step === 0)) {
      unusedFineBars += 1;
    }
  }

  return {
    totalBars: plan.bars.length,
    byResolution,
    tripletBars,
    highResolutionBars,
    thirtySecondBars,
    unusedFineBars,
  };
}

/** Every slot index a note or a drum hit starts on, in one bar, any track. */
function onsetSlotsIn(song: Song, barKey: string): number[] {
  const [sectionId, barIndexText] = barKey.split(":");
  const section = song.sections.find((entry) => entry.id === sectionId);
  const bar = section?.bars[Number(barIndexText)];
  if (!bar) return [];

  const slots = new Set<number>();
  for (const written of Object.values(bar.slots)) {
    written.forEach((slot, index) => {
      if (slot === null || slot === "-") return;
      if (Array.isArray(slot)) {
        if (slot.length > 0) slots.add(index);
        return;
      }
      slots.add(index);
    });
  }
  return [...slots].sort((a, b) => a - b);
}

export type SpeedReport = {
  trackId: string;
  /** The shortest gap between two onsets that actually sound, in seconds. */
  fastestGapSeconds: number | null;
  /** The same, as onsets per second. */
  fastestOnsetsPerSecond: number | null;
  /**
   * The longest unbroken run of onsets at (near) that fastest gap.
   *
   * A burst is what a player does; a continuous stream at maximum speed for a
   * whole section is what a generator does when it has been told "fast".
   */
  longestBurst: number;
  /** How many separate bursts of four or more there were. */
  burstCount: number;
  onsets: number;
};

/** Onset times in seconds for one track, in playing order. */
function onsetSeconds(song: Song, trackId: string): number[] {
  const plan = buildSongPlan(song);
  const tempo = buildTempoMap(song);
  return plan.events
    .filter((event) => event.trackId === trackId)
    .map((event) => durationSeconds(tempo, 0, event.time))
    .sort((a, b) => a - b);
}

export function speedReport(song: Song, trackId: string): SpeedReport {
  const times = onsetSeconds(song, trackId);
  if (times.length < 2) {
    return {
      trackId,
      fastestGapSeconds: null,
      fastestOnsetsPerSecond: null,
      longestBurst: times.length,
      burstCount: 0,
      onsets: times.length,
    };
  }

  const gaps: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const gap = (times[index] ?? 0) - (times[index - 1] ?? 0);
    // Simultaneous notes of a chord are one onset, not an infinitely fast pair.
    if (gap > 1e-6) gaps.push(gap);
  }
  if (gaps.length === 0) {
    return {
      trackId,
      fastestGapSeconds: null,
      fastestOnsetsPerSecond: null,
      longestBurst: 1,
      burstCount: 0,
      onsets: times.length,
    };
  }

  const fastest = Math.min(...gaps);
  // Within a fifth of the fastest gap counts as "at that speed".
  const threshold = fastest * 1.2;
  let longest = 1;
  let current = 1;
  let bursts = 0;
  for (const gap of gaps) {
    if (gap <= threshold) {
      current += 1;
      longest = Math.max(longest, current);
      if (current === 4) bursts += 1;
    } else {
      current = 1;
    }
  }

  return {
    trackId,
    fastestGapSeconds: fastest,
    fastestOnsetsPerSecond: 1 / fastest,
    longestBurst: longest,
    burstCount: bursts,
    onsets: times.length,
  };
}

export type ScalarRunCandidate = {
  trackId: string;
  barNumber: number;
  startSlot: number;
  length: number;
  direction: "up" | "down";
  pitches: string[];
};

/**
 * Passages that would read as a heard scale walk, by a stated rule.
 *
 * Four or more consecutive pitched onsets, most of them moving the same way,
 * most steps one or two semitones, no rest in between, ties not counted as
 * new onsets. This is a **comparison measure**, not a definition of what a
 * scalar run is; a piece using a scale's notes all over the fretboard is not
 * the same thing as a piece with an audible run in it, and this is written to
 * tell those two apart the same way every time rather than to be right.
 */
export function scalarRunCandidates(
  song: Song,
  trackId: string,
): ScalarRunCandidate[] {
  const timeline = buildTrackTimeline(song, trackId);
  if (timeline.kind !== "fretted") return [];

  const found: ScalarRunCandidate[] = [];

  for (const bar of timeline.bars) {
    if (bar.silent) continue;
    const onsets = bar.spans
      .filter((span) => !span.openStart)
      .sort((a, b) => a.startSlot - b.startSlot);

    let run: typeof onsets = [];
    const flush = () => {
      if (run.length >= 4) {
        const steps: number[] = [];
        for (let index = 1; index < run.length; index += 1) {
          const from = pitchToMidi(run[index - 1]?.pitch ?? "");
          const to = pitchToMidi(run[index]?.pitch ?? "");
          if (from === null || to === null) return;
          steps.push(to - from);
        }
        const stepwise = steps.filter((step) => Math.abs(step) >= 1 && Math.abs(step) <= 2);
        const up = steps.filter((step) => step > 0).length;
        const down = steps.filter((step) => step < 0).length;
        const sameWay = Math.max(up, down);
        if (stepwise.length > steps.length / 2 && sameWay > steps.length / 2) {
          found.push({
            trackId,
            barNumber: bar.barNumber,
            startSlot: run[0]?.startSlot ?? 0,
            length: run.length,
            direction: up >= down ? "up" : "down",
            pitches: run.map((span) => span.pitch),
          });
        }
      }
      run = [];
    };

    let previousEnd: number | null = null;
    for (const span of onsets) {
      // A rest between two onsets ends the run; a tie does not, because a tie
      // is not a new onset.
      if (previousEnd !== null && span.startSlot > previousEnd + 1) flush();
      run.push(span);
      previousEnd = span.endSlot;
    }
    flush();
  }

  return found;
}

export type RhythmReport = {
  grid: GridDistribution;
  speed: SpeedReport[];
  scalarRuns: ScalarRunCandidate[];
};

export function rhythmReport(song: Song): RhythmReport {
  return {
    grid: gridDistribution(song),
    speed: song.tracks.map((track) => speedReport(song, track.id)),
    scalarRuns: song.tracks.flatMap((track) => scalarRunCandidates(song, track.id)),
  };
}

/** Grids in ascending order, for a report that wants them predictable. */
export function usedResolutions(distribution: GridDistribution): Resolution[] {
  return Object.keys(distribution.byResolution)
    .map(Number)
    .sort((a, b) => a - b) as Resolution[];
}
