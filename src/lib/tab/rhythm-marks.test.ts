/**
 * The visual hierarchy, as rules rather than as taste (2V-D.2 §16).
 *
 * Each of these is one of the brief's named failures, turned into something
 * that fails a test instead of failing a reader.
 */
import { describe, expect, it } from "vitest";

import {
  RHYTHM_MARKS,
  RHYTHM_MARK_IDS,
  isMusicalData,
  marksAtZoom,
  rhythmMark,
} from "@/lib/tab/rhythm-marks";

describe("367. seven marks, seven weights", () => {
  it("gives every mark its own rank", () => {
    /* "Every grid line looks like a bar line" is two marks at one weight.
       Distinct ranks are what makes that impossible to write. */
    const ranks = RHYTHM_MARKS.map((mark) => mark.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(RHYTHM_MARKS).toHaveLength(RHYTHM_MARK_IDS.length);
  });

  it("puts the bar line above the beat, and the beat above the subdivision", () => {
    expect(rhythmMark("bar_line").rank).toBeLessThan(rhythmMark("main_beat").rank);
    expect(rhythmMark("main_beat").rank).toBeLessThan(rhythmMark("subdivision").rank);
  });

  it("keeps the note's own stem heavier than any aid around it", () => {
    /* The stem says how long the note is. A tuplet bracket or a subdivision
       line drawn heavier than it would make the aid louder than the fact. */
    const stem = rhythmMark("note_stem").rank;
    expect(stem).toBeLessThan(rhythmMark("tuplet_group").rank);
    expect(stem).toBeLessThan(rhythmMark("subdivision").rank);
    expect(stem).toBeLessThan(rhythmMark("phrase_band").rank);
    expect(stem).toBeLessThan(rhythmMark("technique_rail").rank);
  });
});

describe("368. zoom may simplify the aids and never the music", () => {
  it("never lets the bar, the beat or the note fade", () => {
    /* §4: the camera cannot change the music. These three are the music. */
    for (const id of ["bar_line", "main_beat", "note_stem"] as const) {
      expect(isMusicalData(id), id).toBe(true);
    }
    for (const zoom of [0.25, 0.5, 1, 2]) {
      const visible = marksAtZoom(zoom).map((mark) => mark.id);
      expect(visible, `zoom ${zoom}`).toContain("bar_line");
      expect(visible, `zoom ${zoom}`).toContain("main_beat");
      expect(visible, `zoom ${zoom}`).toContain("note_stem");
    }
  });

  it("drops the subdivision wash before anything else when zoomed out", () => {
    /* The "visual soup at a distance" failure. At a small zoom the reader
       gets bars, beats and notes — which is a readable page — rather than a
       48-lattice grey. */
    expect(marksAtZoom(0.5).map((mark) => mark.id)).not.toContain("subdivision");
    expect(marksAtZoom(1).map((mark) => mark.id)).toContain("subdivision");
  });

  it("returns the marks heaviest first, so a renderer draws in order", () => {
    const ranks = marksAtZoom(1).map((mark) => mark.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("369. the overlays are overlays", () => {
  it("marks the phrase band and the technique rail as sitting over the staff", () => {
    /* Which is what tells the renderer to give them their own lane. A rail
       drawn across a stem hides the note's length — the brief names it, and
       it is the same defect as covering a rhythm with an annotation. */
    expect(rhythmMark("phrase_band").overlay).toBe(true);
    expect(rhythmMark("technique_rail").overlay).toBe(true);
  });

  it("keeps every rhythm mark itself out of the overlay lane", () => {
    for (const id of ["bar_line", "main_beat", "subdivision", "tuplet_group", "note_stem"] as const) {
      expect(rhythmMark(id).overlay, id).toBe(false);
    }
  });

  it("ranks both overlays below every rhythm mark", () => {
    /* So a reader looking for the rhythm finds it first, and the annotation
       second — never the other way round. */
    const overlays = RHYTHM_MARKS.filter((mark) => mark.overlay);
    const rhythm = RHYTHM_MARKS.filter((mark) => !mark.overlay);
    const heaviestOverlay = Math.min(...overlays.map((mark) => mark.rank));
    const lightestRhythm = Math.max(...rhythm.map((mark) => mark.rank));
    expect(heaviestOverlay).toBeGreaterThan(lightestRhythm);
  });
});
