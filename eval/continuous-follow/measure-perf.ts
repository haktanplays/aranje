/**
 * What the reading surface's pure work costs, in Node (2Q-C §13).
 *
 *   npx tsx eval/continuous-follow/measure-perf.ts
 *
 * Twenty timed rounds after a warm-up, reported as median / p95 / max. No
 * threshold is invented here: a number nobody measured is not a budget, and
 * this file's job is to produce the numbers a budget could later be argued
 * from.
 *
 * The per-frame work is the one that matters, because it happens sixty times
 * a second: a window and a scroll target. It is measured on the densest
 * fixture the contract allows — eight tracks, thirty-two bars — rather than
 * on the demo song.
 *
 * This is a desktop container, not a phone. Everything below is a lower bound
 * on what a reader's device would take.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { buildMultiTrackModel } from "@/lib/multitrack/model";
import { songSchema, type Song } from "@/lib/song/schema";
import { buildSongAxis, pointAtX, xAtTicks } from "@/lib/tab/song-axis";
import { desiredScrollLeft, followTailPx } from "@/lib/ui/continuous-follow";
import {
  directionOf,
  horizontalWindow,
  sameWindow,
} from "@/lib/ui/horizontal-window";

const HERE = new URL(".", import.meta.url).pathname;
const ROUNDS = 20;
const WARMUP = 5;

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function bench(run: () => unknown) {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples: number[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    rounds: ROUNDS,
    median: round(samples[Math.floor(samples.length / 2)]!),
    p95: round(samples[Math.floor(samples.length * 0.95)]!),
    max: round(samples[samples.length - 1]!),
  };
}

const fixtures = JSON.parse(
  readFileSync(`${HERE}fixtures.json`, "utf8"),
) as Record<string, unknown>;
const song = (name: string): Song => songSchema.parse(fixtures[name]);

const measured: Record<string, unknown> = {};

for (const name of ["normal", "denseDrums", "eightTracks"]) {
  const input = song(name);
  const axis = buildSongAxis(input, SLOT_WIDTH);
  const width = 320;
  const contentWidthPx = axis.totalWidthPx + followTailPx(width);

  /*
   * One frame's worth of work, exactly as the surface does it: ask where the
   * playhead is, ask where the surface should be, ask which bars that wants
   * mounted, and compare the answer with the last one.
   */
  let previous = 0;
  let lastWindow = horizontalWindow({
    axis,
    viewportLeftPx: 0,
    viewportWidthPx: width,
    direction: "idle",
  });
  const frame = () => {
    const ticks = (previous * axis.totalTicks) / Math.max(1, axis.totalWidthPx);
    const x = xAtTicks(axis, Math.min(ticks, axis.totalTicks)) ?? 0;
    const target = desiredScrollLeft(x, { widthPx: width, contentWidthPx });
    const next = horizontalWindow({
      axis,
      viewportLeftPx: target,
      viewportWidthPx: width,
      direction: directionOf(previous, target),
    });
    const changed = !sameWindow(next, lastWindow);
    lastWindow = next;
    previous = target + 30 > axis.totalWidthPx ? 0 : target + 30;
    return changed;
  };

  measured[name] = {
    tracks: input.tracks.length,
    sections: input.sections.length,
    bars: axis.bars.length,
    resolutions: [...new Set(axis.bars.map((bar) => bar.resolution))].sort(
      (a, b) => a - b,
    ),
    contentWidthPx: axis.totalWidthPx,
    "build the axis": bench(() => buildSongAxis(input, SLOT_WIDTH)),
    "build the whole-song multitrack model": bench(() =>
      buildMultiTrackModel(input, input.tracks[0]!.id),
    ),
    "one frame: position, follow target, window, compare": bench(frame),
    "resolve a tap to a bar and slot": bench(() =>
      pointAtX(axis, axis.totalWidthPx / 2),
    ),
    /*
     * A thousand frames back to back: sixteen seconds of playback at 60Hz,
     * so the per-frame figure above can be checked against a run long enough
     * to show anything that accumulates.
     */
    "a thousand frames": bench(() => {
      for (let i = 0; i < 1000; i += 1) frame();
    }),
  };
}

mkdirSync(HERE, { recursive: true });
writeFileSync(
  `${HERE}PERFORMANCE.json`,
  `${JSON.stringify(
    {
      what: "2Q-C §13 — sürekli okuma yüzeyinin saf iş maliyeti",
      measuredOn: "node, masaüstü konteyner — telefon kanıtı değil",
      method: `${WARMUP} ısınma turu, ardından ${ROUNDS} zamanlanmış tur; median / p95 / max ms.`,
      notes: [
        "Eşik uydurulmadı. Bunlar bir bütçenin tartışılabileceği sayılardır.",
        "«Bir kare», yüzeyin gerçekten kare başına yaptığı iştir: konum, " +
          "kaydırma hedefi, pencere ve öncekiyle karşılaştırma.",
        "Pencere yalnız cevap değiştiğinde React'e ulaşır; karşılaştırma o " +
          "yüzden ölçümün içindedir.",
      ],
      measured,
    },
    null,
    2,
  )}\n`,
);

for (const [name, entry] of Object.entries(measured)) {
  const row = entry as Record<string, { median: number; p95: number }>;
  console.log(
    `${name.padEnd(14)} axis ${row["build the axis"]!.median}ms  ` +
      `model ${row["build the whole-song multitrack model"]!.median}ms  ` +
      `frame ${row["one frame: position, follow target, window, compare"]!.median}ms  ` +
      `1000 frames ${row["a thousand frames"]!.median}ms`,
  );
}
console.log(`\n${HERE}PERFORMANCE.json yazıldı`);
