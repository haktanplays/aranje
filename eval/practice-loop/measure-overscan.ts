/**
 * How much overscan the kit grid actually needs (2R-A §6.3).
 *
 *   npx tsx eval/practice-loop/measure-overscan.ts
 *
 * The reading surface answered this question for bars in 2Q-C. The kit grid
 * asks it again for columns, and the answer is not allowed to be inherited: a
 * bar is 8 columns on one grid and 32 on another, so "one viewport" is the
 * only unit that means the same thing on both, and how far a viewport reaches
 * in columns is exactly what changes.
 *
 * ## What moves the grid, and what does not
 *
 * An armed grid is a writing surface. The transport does not drag it — the
 * reader does, with a finger — so the worst case here is a fling, not a tempo.
 * Two passes are run: a fling at the speed a flick actually reaches, and a
 * slow drag, because a slow drag changes the window more often and is where a
 * candidate that is merely *big* still stutters.
 *
 * ## What is simulated and what is not
 *
 * Simulated: the scroll position, the production window function, and React's
 * commit latency as whole frames between asking for a window and having it.
 *
 * Not simulated: layout and paint. This measures the arithmetic — whether the
 * columns that will be mounted still cover the viewport by the time they are.
 * A browser can only make that worse, so a candidate blank here is blank
 * there. §18's browser acceptance checks the other direction.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { buildDrumStepModel } from "@/lib/tab/drum-step-model";
import { songSchema, type Song } from "@/lib/song/schema";
import {
  drumGridAxis,
  drumGridWindow,
  sameDrumWindow,
  type DrumGridAxis,
  type DrumGridOverscan,
  type DrumGridWindow,
} from "@/lib/ui/drum-grid-window";
import { directionOf } from "@/lib/ui/horizontal-window";

const HERE = new URL(".", import.meta.url).pathname;

/**
 * Candidates, in viewports.
 *
 * The first two are here to fail. A run in which every candidate passes has
 * not measured anything: the only way to know this harness can see a blank
 * strip is to watch it see one.
 */
const CANDIDATES: readonly {
  readonly name: string;
  readonly overscan: DrumGridOverscan;
}[] = [
  { name: "none (0 + 0)", overscan: { behind: 0, ahead: 0 } },
  { name: "quarter (0.25 + 0.25)", overscan: { behind: 0.25, ahead: 0.25 } },
  { name: "half behind, one ahead (0.5 + 1)", overscan: { behind: 0.5, ahead: 1 } },
  { name: "one behind, one ahead (1 + 1)", overscan: { behind: 1, ahead: 1 } },
  { name: "one behind, two ahead (1 + 2)", overscan: { behind: 1, ahead: 2 } },
];

const COMMIT_FRAMES = [1, 2] as const;
const VIEWPORT_WIDTHS = [320, 390] as const;

/**
 * A flick, in pixels per frame.
 *
 * A touch fling on a phone leaves the finger at a few thousand pixels a
 * second and decelerates; 60px per 16.7ms frame is about 3.600px/s, which is
 * a hard flick rather than a gentle one.
 */
const FLING_PX_PER_FRAME = 60;
/** A finger dragging deliberately: slower, and so a window change per frame. */
const DRAG_PX_PER_FRAME = 9;

type Reading = {
  readonly blankPx: number;
  readonly mountedColumns: number;
};

function pass(options: {
  readonly axis: DrumGridAxis;
  readonly viewportWidthPx: number;
  readonly overscan: DrumGridOverscan;
  readonly commitFrames: number;
  readonly scrollAt: (frame: number) => number | null;
}) {
  const { axis, viewportWidthPx, overscan, commitFrames, scrollAt } = options;
  const readings: Reading[] = [];

  let previousLeft = scrollAt(0) ?? 0;
  let requested = drumGridWindow({
    axis,
    viewportLeftPx: previousLeft,
    viewportWidthPx,
    direction: "idle",
    overscan,
  });
  let mounted: DrumGridWindow = requested;
  const queue: { window: DrumGridWindow; due: number }[] = [];
  let windowChanges = 0;

  for (let frame = 1; ; frame += 1) {
    const left = scrollAt(frame);
    if (left === null) break;

    while (queue.length > 0 && queue[0]!.due <= frame) {
      mounted = queue.shift()!.window;
    }

    // What the reader sees: the part of the viewport that overlaps the grid,
    // and how much of it has no column mounted under it.
    const viewLeft = Math.max(0, left);
    const viewRight = Math.min(axis.totalWidthPx, left + viewportWidthPx);
    const needed = Math.max(0, viewRight - viewLeft);
    let blankPx = needed;
    if (mounted.columns.length > 0) {
      const first = mounted.columns[0]!;
      const last = mounted.columns[mounted.columns.length - 1]!;
      const covered =
        Math.min(viewRight, last.leftPx + last.widthPx) -
        Math.max(viewLeft, first.leftPx);
      blankPx = Math.max(0, needed - Math.max(0, covered));
    }
    readings.push({ blankPx, mountedColumns: mounted.columns.length });

    const next = drumGridWindow({
      axis,
      viewportLeftPx: left,
      viewportWidthPx,
      direction: directionOf(previousLeft, left),
      overscan,
    });
    if (!sameDrumWindow(next, requested)) {
      requested = next;
      windowChanges += 1;
      queue.push({ window: next, due: frame + commitFrames });
    }
    previousLeft = left;
  }

  const blanks = readings.filter((reading) => reading.blankPx > 0);
  return {
    frames: readings.length,
    blankFrames: blanks.length,
    largestBlankPx: Math.round(
      blanks.reduce((most, reading) => Math.max(most, reading.blankPx), 0),
    ),
    maxMountedColumns: readings.reduce(
      (most, reading) => Math.max(most, reading.mountedColumns),
      0,
    ),
    meanMountedColumns:
      Math.round(
        (readings.reduce((total, reading) => total + reading.mountedColumns, 0) /
          Math.max(1, readings.length)) *
          10,
      ) / 10,
    windowChanges,
  };
}

/** Left to right at `pxPerFrame`, from the start of the grid to its end. */
const forward =
  (axis: DrumGridAxis, viewportWidthPx: number, pxPerFrame: number) =>
  (frame: number): number | null => {
    const end = Math.max(0, axis.totalWidthPx - viewportWidthPx);
    const at = frame * pxPerFrame;
    return at > end ? null : at;
  };

/** And back again, which is where the *behind* overscan earns its keep. */
const backward =
  (axis: DrumGridAxis, viewportWidthPx: number, pxPerFrame: number) =>
  (frame: number): number | null => {
    const start = Math.max(0, axis.totalWidthPx - viewportWidthPx);
    const at = start - frame * pxPerFrame;
    return at < 0 ? null : at;
  };

function loadFixture(name: string): Song {
  const raw = JSON.parse(readFileSync(`${HERE}fixtures.json`, "utf8")) as Record<
    string,
    unknown
  >;
  return songSchema.parse(raw[name]);
}

/** Every section of a fixture that a kit can actually be armed on. */
function grids(fixtureName: string, trackId: string) {
  const song = loadFixture(fixtureName);
  return song.sections.map((section) => {
    const model = buildDrumStepModel(song, trackId, section.id);
    const axis = drumGridAxis(model, SLOT_WIDTH);
    return {
      key: `${fixtureName}/${section.id}`,
      resolutions: [...new Set(section.bars.map((bar) => bar.resolution))].sort(
        (a, b) => a - b,
      ),
      bars: section.bars.length,
      columns: axis.columns.length,
      totalWidthPx: axis.totalWidthPx,
      rows: model.rows.length,
      axis,
    };
  });
}

const GRIDS = [...grids("denseKit", "drums"), ...grids("practiceSong", "drums")];

type Row = {
  readonly grid: string;
  readonly columns: number;
  readonly rows: number;
  readonly candidate: string;
  readonly overscan: DrumGridOverscan;
  readonly viewportWidthPx: number;
  readonly commitFrames: number;
  readonly fling: ReturnType<typeof pass>;
  readonly flingBack: ReturnType<typeof pass>;
  readonly drag: ReturnType<typeof pass>;
};

const rows: Row[] = [];
for (const grid of GRIDS) {
  for (const candidate of CANDIDATES) {
    for (const viewportWidthPx of VIEWPORT_WIDTHS) {
      for (const commitFrames of COMMIT_FRAMES) {
        const shared = {
          axis: grid.axis,
          viewportWidthPx,
          overscan: candidate.overscan,
          commitFrames,
        };
        rows.push({
          grid: grid.key,
          columns: grid.columns,
          rows: grid.rows,
          candidate: candidate.name,
          overscan: candidate.overscan,
          viewportWidthPx,
          commitFrames,
          fling: pass({
            ...shared,
            scrollAt: forward(grid.axis, viewportWidthPx, FLING_PX_PER_FRAME),
          }),
          flingBack: pass({
            ...shared,
            scrollAt: backward(grid.axis, viewportWidthPx, FLING_PX_PER_FRAME),
          }),
          drag: pass({
            ...shared,
            scrollAt: forward(grid.axis, viewportWidthPx, DRAG_PX_PER_FRAME),
          }),
        });
      }
    }
  }
}

const passes = (row: Row) =>
  row.fling.blankFrames === 0 &&
  row.flingBack.blankFrames === 0 &&
  row.drag.blankFrames === 0;

const clean = CANDIDATES.filter((candidate) =>
  rows.filter((row) => row.candidate === candidate.name).every(passes),
);

/**
 * What a candidate costs, in mounted cells rather than in columns.
 *
 * A column is a cell per kit row, and the kit row count is what turns a
 * comfortable column budget into 1.792 buttons. Cost is counted the way the
 * page pays it.
 */
const costOf = (name: string) =>
  Math.max(
    ...rows
      .filter((row) => row.candidate === name)
      .map(
        (row) =>
          Math.max(
            row.fling.maxMountedColumns,
            row.flingBack.maxMountedColumns,
            row.drag.maxMountedColumns,
          ) * row.rows,
      ),
  );

const chosen =
  clean.length === 0
    ? null
    : clean.reduce((best, candidate) =>
        costOf(candidate.name) < costOf(best.name) ? candidate : best,
      );

mkdirSync(HERE, { recursive: true });
writeFileSync(
  `${HERE}OVERSCAN.json`,
  `${JSON.stringify(
    {
      what: "2R-A §6.3 — davul ızgarasının kaç sütunluk overscan'e ihtiyacı var",
      measuredOn:
        "node; üretim axis/window fonksiyonları üzerinde saf aritmetik, tarayıcı yok",
      worstCase: {
        viewportWidths: VIEWPORT_WIDTHS,
        commitFrames: COMMIT_FRAMES,
        flingPxPerFrame: FLING_PX_PER_FRAME,
        dragPxPerFrame: DRAG_PX_PER_FRAME,
      },
      method: [
        "Her kare: kaydırma konumunu ilerlet, üretim window fonksiyonuna hangi sütunların mount edileceğini sor.",
        "N. karede istenen window, N + commitFrames karesinde mount edilir; okuyucunun gördüğü hep daha eski bir konum için hesaplanmış window'dur.",
        "Görüş alanının ızgarayla kesişen kısmında altında mount edilmiş sütun bulunmayan piksel varsa o kare boştur.",
        "Maliyet sütunla değil mount edilen hücreyle sayılır: bir sütun, kit satırı sayısı kadar hücredir.",
        "İlk iki aday boş kare üretmek için var. Hepsinin geçtiği bir koşu hiçbir şey ölçmemiş olurdu.",
      ],
      chosen: chosen
        ? {
            name: chosen.name,
            overscan: chosen.overscan,
            maxMountedCells: costOf(chosen.name),
          }
        : null,
      cleanCandidates: clean.map((candidate) => ({
        name: candidate.name,
        overscan: candidate.overscan,
        maxMountedCells: costOf(candidate.name),
      })),
      // The axis itself is thousands of columns; the artefact keeps its shape.
      grids: GRIDS.map((grid) => ({
        key: grid.key,
        resolutions: grid.resolutions,
        bars: grid.bars,
        columns: grid.columns,
        totalWidthPx: grid.totalWidthPx,
        rows: grid.rows,
      })),
      rows,
    },
    null,
    2,
  )}\n`,
);

for (const grid of GRIDS) {
  console.log(
    `\n${grid.key}: ${grid.bars} ölçü, 1/${grid.resolutions.join("+1/")}, ` +
      `${grid.columns} sütun × ${grid.rows} satır, ${grid.totalWidthPx}px`,
  );
  for (const row of rows.filter((entry) => entry.grid === grid.key)) {
    console.log(
      `  ${row.candidate.padEnd(34)} ${String(row.viewportWidthPx).padStart(3)}px ` +
        `commit=${row.commitFrames}  fling=${row.fling.blankFrames}/${row.fling.frames} ` +
        `back=${row.flingBack.blankFrames}/${row.flingBack.frames} ` +
        `drag=${row.drag.blankFrames}/${row.drag.frames} ` +
        `worst ${Math.max(row.fling.largestBlankPx, row.flingBack.largestBlankPx, row.drag.largestBlankPx)}px ` +
        `hücre max=${Math.max(row.fling.maxMountedColumns, row.flingBack.maxMountedColumns, row.drag.maxMountedColumns) * row.rows}`,
    );
  }
}
console.log(
  `\nseçilen: ${chosen ? `${chosen.name} — ${costOf(chosen.name)} hücre` : "yok — her aday boş kare üretti"}`,
);
