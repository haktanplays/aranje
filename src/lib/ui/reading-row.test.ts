/**
 * The reading row adds up, armed or not (2R-A §III, §XIII).
 *
 * These tests exist because the arithmetic was wrong in a way nothing could
 * see. The armed kit grid was rendered *beside* the reading window's spacers
 * rather than instead of them, so the scroller's reachable extent became
 * `contentWidthPx + gridWidth − renderedPx`. On the contract's ceiling that
 * measured 24.507px against a canonical axis of 16.592 — and it was not even
 * a constant, because `renderedPx` changes as the reader scrolls. The song
 * appeared half as long again as it is, by an amount that moved.
 *
 * Every number below is the real one, taken from `denseKit` through
 * `buildSongAxis` rather than typed in, so a change to the geometry moves the
 * fixture with it instead of leaving a stale constant that still passes.
 */
import { describe, expect, it } from "vitest";

import { readingRow, type ReadingRowInput } from "@/lib/ui/reading-row";
import { GUTTER_WIDTH, SLOT_WIDTH } from "@/components/workspace/geometry";
import { buildSongAxis, xAtSection } from "@/lib/tab/song-axis";
import { buildDrumStepModel } from "@/lib/tab/drum-step-model";
import { drumGridAxis } from "@/lib/ui/drum-grid-window";
import { followTailPx } from "@/lib/ui/continuous-follow";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import { slotCount } from "@/lib/music/timing";
import type { Bar, Resolution, TimeSignature } from "@/lib/song/schema";

/** A kit bar with every slot silent: geometry only, no music needed. */
const kitBar = (meter: TimeSignature, resolution: Resolution): Bar => ({
  timeSignature: meter,
  resolution,
  slots: {
    drums: Array.from({ length: slotCount(meter, resolution) }, () => []),
  },
});

/**
 * The shape of `denseKit`: one 1/32 section and three progressively lighter
 * ones, so a section's grid width and its extent on the song axis can differ.
 */
const CEILING = song(
  [guitarTrack(), drumTrack()],
  [
    section(Array.from({ length: 8 }, () => kitBar([4, 4], 32)), { id: "dense", name: "Yoğun" }),
    section(Array.from({ length: 8 }, () => kitBar([4, 4], 8)), { id: "verse", name: "Verse" }),
    section(Array.from({ length: 8 }, () => kitBar([3, 4], 12)), { id: "bridge", name: "Köprü" }),
    section(Array.from({ length: 8 }, () => kitBar([4, 4], 8)), { id: "outro", name: "Final" }),
  ],
);

const AXIS = buildSongAxis(CEILING, SLOT_WIDTH);
const VIEWPORT = 390;
const CONTENT = GUTTER_WIDTH + AXIS.totalWidthPx + followTailPx(VIEWPORT);

const gridOf = (sectionId: string) =>
  drumGridAxis(buildDrumStepModel(CEILING, sectionId, "drums"), SLOT_WIDTH);

const reading = (beforePx: number, renderedPx: number): ReadingRowInput => ({
  contentWidthPx: CONTENT,
  originPx: GUTTER_WIDTH,
  windowBeforePx: beforePx,
  windowRenderedPx: renderedPx,
  armedGrid: null,
});

const armed = (sectionId: string): ReadingRowInput => ({
  ...reading(0, 0),
  armedGrid: {
    leadPx: xAtSection(AXIS, sectionId) ?? 0,
    widthPx: gridOf(sectionId).totalWidthPx,
  },
});

describe("263. the row's parts add up to the scroll content, always", () => {
  it("adds up while reading, wherever the window sits on the axis", () => {
    for (const beforePx of [0, 1_088, 4_352, 8_704, AXIS.totalWidthPx - 1_088]) {
      const row = readingRow(reading(beforePx, 1_088));
      expect(row.totalPx).toBeCloseTo(CONTENT, 6);
      expect(row.overflowPx).toBe(0);
    }
  });

  it("adds up with a kit armed, in every section of the song", () => {
    for (const entry of CEILING.sections) {
      const row = readingRow(armed(entry.id));
      expect(row.totalPx).toBeCloseTo(CONTENT, 6);
      expect(row.overflowPx).toBe(0);
    }
  });

  it("gives the armed grid its width and the reading window no say at all", () => {
    const row = readingRow({
      ...reading(4_352, 3_264),
      armedGrid: { leadPx: xAtSection(AXIS, "verse") ?? 0, widthPx: gridOf("verse").totalWidthPx },
    });
    expect(row.leadPx).toBe(xAtSection(AXIS, "verse"));
    expect(row.drawnPx).toBe(gridOf("verse").totalWidthPx);
    expect(row.overflowPx).toBe(0);
  });

  it("reports an overflow rather than absorbing it into a clamped tail", () => {
    /*
     * What the old renderer did, expressed as input: a grid mounted *and* a
     * window's worth of bars. The tail cannot go negative, so without this
     * field the row would look fine and the scroller would be too long.
     */
    const row = readingRow({
      contentWidthPx: CONTENT,
      originPx: GUTTER_WIDTH,
      windowBeforePx: 0,
      windowRenderedPx: 0,
      armedGrid: { leadPx: AXIS.totalWidthPx, widthPx: gridOf("dense").totalWidthPx },
    });
    expect(row.tailPx).toBe(0);
    expect(row.overflowPx).toBeGreaterThan(0);
  });
});

describe("264. the reachable extent does not move when the window does", () => {
  it("is one width at every scroll position", () => {
    // Positions taken from this fixture's own axis, so a change to the
    // geometry moves them instead of leaving a stale constant that passes.
    const last = AXIS.totalWidthPx - 1_088;
    const widths = [0, 1_088, Math.round(last / 2), last].map((beforePx) =>
      Math.round(readingRow(reading(beforePx, 1_088)).totalPx),
    );
    expect(new Set(widths).size).toBe(1);
  });

  it("is one width however much of the window is mounted", () => {
    const widths = [0, 1_088, 3_264].map((renderedPx) =>
      Math.round(readingRow(reading(0, renderedPx)).totalPx),
    );
    expect(new Set(widths).size).toBe(1);
  });

  it("matches the canonical axis plus the gutter and the reading tail", () => {
    expect(Math.round(readingRow(armed("dense")).totalPx)).toBe(
      Math.round(GUTTER_WIDTH + AXIS.totalWidthPx + followTailPx(VIEWPORT)),
    );
  });

  it("shows the old formula moving with the window, which a length cannot", () => {
    const grid = gridOf("dense").totalWidthPx;
    expect(Math.round(CONTENT + grid - 1_088)).not.toBe(
      Math.round(CONTENT + grid - 2_176),
    );
    // Whereas the row's own total is one number at both.
    expect(Math.round(readingRow(reading(0, 1_088)).totalPx)).toBe(
      Math.round(readingRow(reading(0, 2_176)).totalPx),
    );
  });
});

/**
 * The numbers `eval/practice-loop/DRUM-BASELINE.json` and `DRUM-AFTER.json`
 * actually recorded on `denseKit` at 390×844, kept here so the explanation is
 * arithmetic rather than a story. They are constants of that measurement, not
 * of this fixture, which is why they are named rather than derived.
 */
const MEASURED = {
  canonicalAxisPx: 16_592,
  gutterPx: 34,
  followTailPx: 265.2,
  denseSectionGridPx: 8_704,
  oneDenseBarPx: 1_088,
  scrollWidthBefore: 24_507,
  scrollWidthAfter: 16_891,
} as const;

describe("266. the measured scroll widths reconcile exactly", () => {
  it("explains the new width as the canonical axis, the gutter and the tail", () => {
    const content =
      MEASURED.gutterPx + MEASURED.canonicalAxisPx + MEASURED.followTailPx;
    expect(Math.round(content)).toBe(MEASURED.scrollWidthAfter);
  });

  it("explains the old width as that plus a whole section's grid, less the window", () => {
    const content =
      MEASURED.gutterPx + MEASURED.canonicalAxisPx + MEASURED.followTailPx;
    const asItWas =
      content + MEASURED.denseSectionGridPx - MEASURED.oneDenseBarPx;
    expect(Math.round(asItWas)).toBe(MEASURED.scrollWidthBefore);
  });

  it("shows the old width was not a property of the song at all", () => {
    const content =
      MEASURED.gutterPx + MEASURED.canonicalAxisPx + MEASURED.followTailPx;
    const atOneBar =
      content + MEASURED.denseSectionGridPx - MEASURED.oneDenseBarPx;
    const atTwoBars =
      content + MEASURED.denseSectionGridPx - 2 * MEASURED.oneDenseBarPx;
    expect(Math.round(atOneBar) - Math.round(atTwoBars)).toBe(
      MEASURED.oneDenseBarPx,
    );
  });
});

describe("265. an armed section's grid is exactly its extent on the song axis", () => {
  it("never claims more width than the section occupies", () => {
    /*
     * The invariant that makes bar lines line up between the armed grid and
     * every other lane. A harness of this very checkpoint got it wrong by
     * passing `(song, trackId, sectionId)` to a function that takes
     * `(song, sectionId, trackId)` — and because an unknown section resolves
     * to the song's first one, it measured section one four times and
     * produced plausible numbers instead of an error.
     */
    for (const [index, entry] of CEILING.sections.entries()) {
      const start = xAtSection(AXIS, entry.id) ?? -1;
      const next = CEILING.sections[index + 1];
      const end = next ? (xAtSection(AXIS, next.id) ?? -1) : AXIS.totalWidthPx;
      expect(gridOf(entry.id).totalWidthPx).toBe(end - start);
    }
  });

  it("gives sections written on different grids different widths", () => {
    const widths = CEILING.sections.map((entry) => gridOf(entry.id).totalWidthPx);
    // Derived, not typed in: the 1/32 section is four times the 1/8 one.
    expect(widths[0]).toBe(8 * slotCount([4, 4], 32) * SLOT_WIDTH);
    expect(widths[2]).toBe(8 * slotCount([3, 4], 12) * SLOT_WIDTH);
    expect(new Set(widths).size).toBeGreaterThan(1);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(
      AXIS.totalWidthPx,
    );
  });

  it("starts every grid's first column at the section's own x", () => {
    for (const entry of CEILING.sections) {
      const grid = gridOf(entry.id);
      // The grid's own coordinates begin at zero; the surface offsets it by
      // the section's x, which is why the two must be measured separately.
      expect(grid.columns[0]?.leftPx).toBe(0);
      expect(xAtSection(AXIS, entry.id)).toBeGreaterThanOrEqual(0);
    }
  });
});
