/**
 * How much overscan the surface actually needs (2Q-C §3.4).
 *
 *   npx tsx eval/continuous-follow/measure-overscan.ts
 *
 * The question is narrow: with the window recomputed every frame and React
 * committing it a frame or two later, how far past the viewport do bars have
 * to be kept mounted so that the reader never sees an unmounted strip? "Two
 * bars ought to be enough" is not an answer — a bar is 8 slots wide on one
 * grid and 32 on another, so two bars is two different distances on the same
 * screen — so several candidates are run and the smallest one that produces
 * **zero** blank frames at the app's worst case is the one that ships.
 *
 * ## The worst case, and why it is this one
 *
 * The surface travels fastest when the music is densest and the transport
 * quickest, because width follows the grid and speed follows the tempo:
 *
 *   1/32 grid          32 slots × 34px = 1088px per 4/4 bar
 *   260 BPM            `bpmRange.max`
 *   150% practice      `practiceRateLimits.maxPercent`
 *   320px viewport     the narrowest the app supports
 *
 * That is 390 effective BPM, a 4/4 bar every 0.615s, and about 29.5px of
 * travel per 60Hz frame. Nothing a reader can ask for is faster.
 *
 * ## What is simulated and what is not
 *
 * Simulated: the frame clock, including janky frames taken from the measured
 * baseline distribution rather than assumed; the scroll position, from the
 * production follow model; the mounted range, from the production window
 * function; and React's commit latency, as a delay of whole frames between
 * asking for a window and having it.
 *
 * Not simulated: layout, paint, and everything else the browser does. This is
 * a measurement of the *arithmetic* — whether the range that will be mounted
 * still covers the viewport by the time it is mounted. A browser cannot make
 * that answer better, only worse, so a candidate that is blank here is blank
 * there. §12's browser acceptance is what checks the other direction.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { bpmRange, practiceRateLimits } from "@/lib/limits";
import { effectiveBpm } from "@/lib/audio/practice-rate";
import { PPQ } from "@/lib/music/timing";
import { songSchema, type Song } from "@/lib/song/schema";
import {
  barAtTicks,
  buildSongAxis,
  xAtTicks,
  type SongAxis,
} from "@/lib/tab/song-axis";
import {
  desiredScrollLeft,
  followTailPx,
} from "@/lib/ui/continuous-follow";
import {
  directionOf,
  horizontalWindow,
  sameWindow,
  type HorizontalWindow,
  type OverscanViewports,
} from "@/lib/ui/horizontal-window";

const HERE = new URL(".", import.meta.url).pathname;

/**
 * Candidates, in viewports.
 *
 * The first two are expected to fail and are here for that reason: a
 * measurement where every candidate passes has not measured anything, and the
 * only way to know this harness can see a blank frame is to watch it see one.
 */
const CANDIDATES: readonly { readonly name: string; readonly overscan: OverscanViewports }[] = [
  { name: "none (0 + 0)", overscan: { behind: 0, ahead: 0 } },
  { name: "quarter (0.25 + 0.25)", overscan: { behind: 0.25, ahead: 0.25 } },
  { name: "half behind, one ahead (0.5 + 1)", overscan: { behind: 0.5, ahead: 1 } },
  { name: "one behind, one ahead (1 + 1)", overscan: { behind: 1, ahead: 1 } },
  { name: "one behind, two ahead (1 + 2)", overscan: { behind: 1, ahead: 2 } },
];

/** React's commit latency, in whole frames. Both are measured. */
const COMMIT_FRAMES = [1, 2] as const;

const VIEWPORT_WIDTHS = [320, 390] as const;

/**
 * Frame durations, in ms.
 *
 * Taken from `BASELINE.json`, which measured a median of 16.7, a p95 of 16.8
 * and a worst frame of 83.3 on this very fixture — five frames' worth of
 * travel arriving at once. One long frame every 120 is more often than the
 * baseline saw and is deliberately pessimistic.
 */
const NORMAL_FRAME_MS = 16.7;
const LONG_FRAME_MS = 83.3;
const LONG_FRAME_EVERY = 120;

function frameMs(index: number): number {
  return index % LONG_FRAME_EVERY === LONG_FRAME_EVERY - 1
    ? LONG_FRAME_MS
    : NORMAL_FRAME_MS;
}

type Fixtures = Record<string, unknown>;

function loadFixture(name: string): Song {
  const raw = JSON.parse(
    readFileSync(`${HERE}fixtures.json`, "utf8"),
  ) as Fixtures;
  return songSchema.parse(raw[name]);
}

/** The same fixture at the fastest tempo the app allows. */
function atMaxTempo(song: Song): Song {
  return songSchema.parse({
    ...song,
    bpm: bpmRange.max,
    // A section tempo override would make one part of the song slower than
    // the worst case this is measuring, so they go.
    sections: song.sections.map((section) =>
      Object.fromEntries(
        Object.entries(section).filter(([key]) => key !== "bpmOverride"),
      ),
    ),
  });
}

/** Ticks per second at a given section's tempo and the practice rate. */
function tickRate(song: Song, percent: number): number {
  return (PPQ * effectiveBpm(song.bpm, percent)) / 60;
}

type FrameReading = {
  readonly blankPx: number;
  readonly playheadOutside: boolean;
  readonly mountedBars: number;
};

/**
 * One pass over the axis, reading what a reader would have seen each frame.
 *
 * `advanceTicks` decides what kind of pass it is: the transport driving the
 * view forward, or a finger flinging it backward.
 */
function pass(options: {
  readonly axis: SongAxis;
  readonly viewportWidthPx: number;
  readonly overscan: OverscanViewports;
  readonly commitFrames: number;
  readonly scrollAt: (frame: number) => number | null;
}): {
  readonly frames: number;
  readonly blankFrames: number;
  readonly largestBlankPx: number;
  readonly playheadBlankFrames: number;
  readonly maxMountedBars: number;
  readonly meanMountedBars: number;
  readonly windowChanges: number;
} {
  const { axis, viewportWidthPx, overscan, commitFrames, scrollAt } = options;
  const readings: FrameReading[] = [];

  let previousScroll = scrollAt(0) ?? 0;
  let requested = horizontalWindow({
    axis,
    viewportLeftPx: previousScroll,
    viewportWidthPx,
    direction: "idle",
    overscan,
  });
  let mounted: HorizontalWindow = requested;
  const queue: { window: HorizontalWindow; due: number }[] = [];
  let windowChanges = 0;

  for (let frame = 1; ; frame += 1) {
    const scroll = scrollAt(frame);
    if (scroll === null) break;

    // What React had time to commit before this frame painted.
    while (queue.length > 0 && queue[0]!.due <= frame) {
      mounted = queue.shift()!.window;
    }

    // What the reader sees: the musical part of the viewport, and how much of
    // it has no bar mounted under it. The tail is not music and not blank.
    const viewLeft = Math.max(0, scroll);
    const viewRight = Math.min(axis.totalWidthPx, scroll + viewportWidthPx);
    const needed = Math.max(0, viewRight - viewLeft);
    let blankPx = needed;
    if (mounted.bars.length > 0) {
      const first = mounted.bars[0]!;
      const last = mounted.bars[mounted.bars.length - 1]!;
      const covered =
        Math.min(viewRight, last.leftPx + last.widthPx) -
        Math.max(viewLeft, first.leftPx);
      blankPx = Math.max(0, needed - Math.max(0, covered));
    }

    const playheadX = scroll + viewportWidthPx * 0.32;
    const playheadOutside =
      mounted.bars.length === 0 ||
      playheadX < mounted.bars[0]!.leftPx ||
      playheadX >
        mounted.bars[mounted.bars.length - 1]!.leftPx +
          mounted.bars[mounted.bars.length - 1]!.widthPx;

    readings.push({
      blankPx,
      // Past the end of the music the playhead has no bar under it because
      // there is none, which is the tail rather than a blank frame.
      playheadOutside: playheadOutside && playheadX <= axis.totalWidthPx,
      mountedBars: mounted.bars.length,
    });

    // Now this frame's request, which will arrive `commitFrames` later.
    const next = horizontalWindow({
      axis,
      viewportLeftPx: scroll,
      viewportWidthPx,
      direction: directionOf(previousScroll, scroll),
      overscan,
    });
    if (!sameWindow(next, requested)) {
      requested = next;
      windowChanges += 1;
      queue.push({ window: next, due: frame + commitFrames });
    }
    previousScroll = scroll;
  }

  const blanks = readings.filter((reading) => reading.blankPx > 0);
  return {
    frames: readings.length,
    blankFrames: blanks.length,
    largestBlankPx: Math.round(
      blanks.reduce((most, reading) => Math.max(most, reading.blankPx), 0),
    ),
    playheadBlankFrames: readings.filter((reading) => reading.playheadOutside)
      .length,
    maxMountedBars: readings.reduce(
      (most, reading) => Math.max(most, reading.mountedBars),
      0,
    ),
    meanMountedBars:
      Math.round(
        (readings.reduce((total, reading) => total + reading.mountedBars, 0) /
          Math.max(1, readings.length)) *
          10,
      ) / 10,
    windowChanges,
  };
}

/** The transport playing the whole song from its first tick to its last. */
function playbackScroll(
  axis: SongAxis,
  song: Song,
  viewportWidthPx: number,
): (frame: number) => number | null {
  const perSecond = tickRate(song, practiceRateLimits.maxPercent);
  const contentWidthPx = axis.totalWidthPx + followTailPx(viewportWidthPx);
  let ticks = 0;
  return (frame) => {
    if (frame > 0) ticks += (perSecond * frameMs(frame)) / 1000;
    if (ticks > axis.totalTicks) return null;
    const x = xAtTicks(axis, ticks) ?? axis.totalWidthPx;
    return desiredScrollLeft(x, { widthPx: viewportWidthPx, contentWidthPx });
  };
}

/**
 * A finger flinging the surface backward.
 *
 * Faster than playback on purpose: a fling decelerates from several thousand
 * pixels a second, which is where the *behind* overscan earns its keep.
 */
const FLING_PX_PER_FRAME = 60;

function flingScroll(
  axis: SongAxis,
  viewportWidthPx: number,
): (frame: number) => number | null {
  const start = Math.max(0, axis.totalWidthPx - viewportWidthPx);
  return (frame) => {
    const at = start - frame * FLING_PX_PER_FRAME;
    return at < 0 ? null : at;
  };
}

function measure(fixtureName: string) {
  const song = atMaxTempo(loadFixture(fixtureName));
  const axis = buildSongAxis(song, SLOT_WIDTH);
  const firstBar = barAtTicks(axis, 0);

  const rows = [];
  for (const candidate of CANDIDATES) {
    for (const viewportWidthPx of VIEWPORT_WIDTHS) {
      for (const commitFrames of COMMIT_FRAMES) {
        rows.push({
          candidate: candidate.name,
          overscan: candidate.overscan,
          viewportWidthPx,
          commitFrames,
          playback: pass({
            axis,
            viewportWidthPx,
            overscan: candidate.overscan,
            commitFrames,
            scrollAt: playbackScroll(axis, song, viewportWidthPx),
          }),
          fling: pass({
            axis,
            viewportWidthPx,
            overscan: candidate.overscan,
            commitFrames,
            scrollAt: flingScroll(axis, viewportWidthPx),
          }),
        });
      }
    }
  }

  return {
    fixture: fixtureName,
    bpm: song.bpm,
    practicePercent: practiceRateLimits.maxPercent,
    effectiveBpm: effectiveBpm(song.bpm, practiceRateLimits.maxPercent),
    bars: axis.bars.length,
    resolutions: [...new Set(axis.bars.map((bar) => bar.resolution))].sort(
      (a, b) => a - b,
    ),
    widestBarPx: axis.bars.reduce((most, bar) => Math.max(most, bar.widthPx), 0),
    firstBarWidthPx: firstBar?.widthPx ?? 0,
    totalWidthPx: axis.totalWidthPx,
    pxPerFrameAtTopSpeed:
      Math.round(
        ((axis.totalWidthPx /
          (axis.totalTicks /
            tickRate(song, practiceRateLimits.maxPercent))) *
          (NORMAL_FRAME_MS / 1000)) *
          100,
      ) / 100,
    rows,
  };
}

const fixtures = ["denseDrums", "eightTracks", "normal"] as const;
const measured = fixtures.map(measure);

/**
 * The winner: the smallest candidate with no blank frame and no frame where
 * the playhead has no bar under it, anywhere, in either pass.
 *
 * "Smallest" is by mounted bars actually observed rather than by the numbers
 * in the candidate's name, because what overscan costs is DOM, and DOM is
 * what the measurement counted.
 */
const clean = CANDIDATES.filter((candidate) =>
  measured.every((fixture) =>
    fixture.rows
      .filter((row) => row.candidate === candidate.name)
      .every(
        (row) =>
          row.playback.blankFrames === 0 &&
          row.playback.playheadBlankFrames === 0 &&
          row.fling.blankFrames === 0 &&
          row.fling.playheadBlankFrames === 0,
      ),
  ),
);

const costOf = (name: string) =>
  Math.max(
    ...measured.flatMap((fixture) =>
      fixture.rows
        .filter((row) => row.candidate === name)
        .map((row) => Math.max(row.playback.maxMountedBars, row.fling.maxMountedBars)),
    ),
  );

const chosen =
  clean.length === 0
    ? null
    : clean.reduce((best, candidate) =>
        costOf(candidate.name) < costOf(best.name) ? candidate : best,
      );

const artefact = {
  what: "2Q-C §3.4 — how much horizontal overscan the reading surface needs",
  measuredOn: "node, pure arithmetic over the production axis, window and follow model",
  worstCase: {
    grid: 32,
    bpm: bpmRange.max,
    practicePercent: practiceRateLimits.maxPercent,
    viewportWidths: VIEWPORT_WIDTHS,
    frameModel: {
      normalMs: NORMAL_FRAME_MS,
      longMs: LONG_FRAME_MS,
      longEveryFrames: LONG_FRAME_EVERY,
      source: "BASELINE.json frame distribution on denseDrums",
    },
    commitFrames: COMMIT_FRAMES,
    flingPxPerFrame: FLING_PX_PER_FRAME,
  },
  method: [
    "Every frame: advance the transport, ask the production follow model where the surface should be scrolled to, and ask the production window function which bars that position wants mounted.",
    "A window asked for on frame N is mounted on frame N + commitFrames, so what the reader sees is always a window computed for an older scroll position.",
    "A frame is blank when any part of the viewport that overlaps the music has no mounted bar under it.",
    "The playhead is checked separately: a frame counts against a candidate if the anchor position has no mounted bar under it.",
    "The two smallest candidates are expected to be blank. A run where every candidate passes would not have measured anything.",
  ],
  chosen: chosen
    ? { name: chosen.name, overscan: chosen.overscan, maxMountedBars: costOf(chosen.name) }
    : null,
  cleanCandidates: clean.map((candidate) => ({
    name: candidate.name,
    overscan: candidate.overscan,
    maxMountedBars: costOf(candidate.name),
  })),
  fixtures: measured,
};

mkdirSync(HERE, { recursive: true });
writeFileSync(`${HERE}OVERSCAN.json`, `${JSON.stringify(artefact, null, 2)}\n`);

for (const fixture of measured) {
  console.log(
    `\n${fixture.fixture}: ${fixture.bars} bars, ${fixture.totalWidthPx}px, ` +
      `${fixture.effectiveBpm} effective BPM, ${fixture.pxPerFrameAtTopSpeed}px/frame`,
  );
  for (const row of fixture.rows) {
    console.log(
      `  ${row.candidate.padEnd(34)} ${String(row.viewportWidthPx).padStart(3)}px ` +
        `commit=${row.commitFrames}  playback blank=${row.playback.blankFrames}/${row.playback.frames} ` +
        `(worst ${row.playback.largestBlankPx}px, playhead ${row.playback.playheadBlankFrames}) ` +
        `fling blank=${row.fling.blankFrames}/${row.fling.frames} ` +
        `bars max=${Math.max(row.playback.maxMountedBars, row.fling.maxMountedBars)}`,
    );
  }
}
console.log(`\nchosen: ${chosen ? chosen.name : "none — every candidate was blank"}`);
