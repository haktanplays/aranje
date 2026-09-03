/**
 * The band puts the model on the screen without changing it (2V-B.4 §10).
 *
 * `Section.phrases` existed and nothing drew it. What this file checks is the
 * bridge: that a phrase becomes pixels on the same axis the bars use, that
 * its identity survives every viewport and every window, and that scrolling
 * or zooming moves the ink and never the idea.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { namePhrase } from "@/lib/song/phrase-write";
import { phraseBand } from "@/lib/tab/phrase-band";
import { buildSongAxis } from "@/lib/tab/song-axis";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const BAR_TICKS = 768;
const SECTION = SAMPLE_SONG.sections[0]!.id;

function fixture(): Song {
  const lane = (): MelodicSlot[] => Array.from({ length: 8 }, () => null);
  const bare = songSchema.parse({
    ...SAMPLE_SONG,
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: Array.from({ length: 4 }, () => ({
          timeSignature: [4, 4],
          resolution: 8,
          slots: { [TRACK]: lane() },
        })),
      },
    ],
  } satisfies Song);
  /* One idea from halfway through measure 1 to halfway through measure 3. */
  const named = namePhrase(bare, { sectionId: SECTION, fromTicks: 384, toTicks: 1920 });
  if (!named.ok) throw new Error(named.reason);
  return named.song;
}

const WHOLE = { fromTicks: 0, toTicks: BAR_TICKS * 4 };

describe("60. a phrase becomes ink on the axis the bars are on", () => {
  it("places it where the music is, not where the measure line is", () => {
    const song = fixture();
    const axis = buildSongAxis(song, SLOT_WIDTH);
    const [span] = phraseBand({ song, axis, window: WHOLE });
    expect(span).toBeDefined();
    /* Half a 4/4 bar of eight slots: four slots in from the left edge. */
    expect(span!.leftPx).toBe(4 * SLOT_WIDTH);
    expect(span!.widthPx).toBe(16 * SLOT_WIDTH);
    expect(span!.name).toBe("Cümle 1");
  });

  it("draws nothing when a song has said nothing about its phrases", () => {
    const song = songSchema.parse({
      ...SAMPLE_SONG,
      sections: [{ ...SAMPLE_SONG.sections[0]!, phrases: undefined }],
    } satisfies Song);
    const axis = buildSongAxis(song, SLOT_WIDTH);
    expect(phraseBand({ song, axis, window: WHOLE })).toEqual([]);
  });

  it("keeps one identity while the window moves under it", () => {
    const song = fixture();
    const axis = buildSongAxis(song, SLOT_WIDTH);
    const windows = [
      { fromTicks: 0, toTicks: BAR_TICKS },
      { fromTicks: BAR_TICKS, toTicks: BAR_TICKS * 2 },
      { fromTicks: BAR_TICKS * 2, toTicks: BAR_TICKS * 3 },
      WHOLE,
    ];
    const seen = windows.map((window) => phraseBand({ song, axis, window })[0]);
    for (const span of seen) {
      expect(span).toBeDefined();
      expect(span!.phraseId).toBe(seen[0]!.phraseId);
      expect(span!.phraseStartTicks).toBe(384);
      expect(span!.phraseEndTicks).toBe(1920);
    }
    /* What the window changes is the drawing, and it really does change it. */
    expect(new Set(seen.map((span) => span!.leftPx)).size).toBeGreaterThan(1);
  });

  it("marks continuation on the side the phrase runs off", () => {
    const song = fixture();
    const axis = buildSongAxis(song, SLOT_WIDTH);
    const first = phraseBand({ song, axis, window: { fromTicks: 0, toTicks: BAR_TICKS } })[0]!;
    const middle = phraseBand({
      song,
      axis,
      window: { fromTicks: BAR_TICKS, toTicks: BAR_TICKS * 2 },
    })[0]!;
    const whole = phraseBand({ song, axis, window: WHOLE })[0]!;

    expect([first.continuesBefore, first.continuesAfter]).toEqual([false, true]);
    expect([middle.continuesBefore, middle.continuesAfter]).toEqual([true, true]);
    expect([whole.continuesBefore, whole.continuesAfter]).toEqual([false, false]);
  });

  it("draws the same phrase at every zoom, only wider", () => {
    const song = fixture();
    const narrow = phraseBand({
      song,
      axis: buildSongAxis(song, SLOT_WIDTH),
      window: WHOLE,
    })[0]!;
    const wide = phraseBand({
      song,
      axis: buildSongAxis(song, SLOT_WIDTH * 2),
      window: WHOLE,
    })[0]!;
    expect(wide.phraseId).toBe(narrow.phraseId);
    expect(wide.phraseStartTicks).toBe(narrow.phraseStartTicks);
    expect(wide.phraseEndTicks).toBe(narrow.phraseEndTicks);
    expect(wide.leftPx).toBe(narrow.leftPx * 2);
    expect(wide.widthPx).toBe(narrow.widthPx * 2);
  });

  it("draws nothing for a window the phrase is not in", () => {
    const song = fixture();
    const axis = buildSongAxis(song, SLOT_WIDTH);
    expect(
      phraseBand({ song, axis, window: { fromTicks: BAR_TICKS * 3, toTicks: BAR_TICKS * 4 } }),
    ).toEqual([]);
  });
});

describe("70. a phrase, a selection and a ghost are three different things", () => {
  it("draws an idea that lives inside one measure", () => {
    /* A phrase does not have to be long to be a phrase, and a short one must
       not collapse to the measure it sits in — the band would then be a bar
       marker with a name on it. */
    const named = namePhrase(fixture(), {
      sectionId: SECTION,
      /* The fourth measure, a quarter in, half a measure long. */
      fromTicks: BAR_TICKS * 3 + 192,
      toTicks: BAR_TICKS * 3 + 576,
      name: "Giriş motifi",
    });
    if (!named.ok) throw new Error(named.reason);
    const axis = buildSongAxis(named.song, SLOT_WIDTH);
    const spans = phraseBand({ song: named.song, axis, window: WHOLE });
    const motif = spans.find((span) => span.name === "Giriş motifi")!;

    expect(motif.phraseStartTicks).toBe(BAR_TICKS * 3 + 192);
    expect(motif.phraseEndTicks).toBe(BAR_TICKS * 3 + 576);
    expect([motif.continuesBefore, motif.continuesAfter]).toEqual([false, false]);
    /* Half a measure wide, starting a quarter in: not snapped to the bar. */
    const barPx = SLOT_WIDTH * 8;
    expect(motif.leftPx).toBe(barPx * 3 + barPx / 4);
    expect(motif.widthPx).toBe(barPx / 2);
  });

  it("survives being written to a file and read back", () => {
    const song = fixture();
    const reopened = songSchema.parse(JSON.parse(JSON.stringify(song)));
    const axis = buildSongAxis(reopened, SLOT_WIDTH);
    expect(phraseBand({ song: reopened, axis, window: WHOLE })).toEqual(
      phraseBand({ song, axis: buildSongAxis(song, SLOT_WIDTH), window: WHOLE }),
    );
  });

  it("keeps the phrase quieter than the selection, and out of the ghost's colour", () => {
    /*
     * The three layers are told apart by weight and hue, and the rules are
     * cheap to state: selection is the loud, filled band; phrase is a
     * hairline; bronze belongs to the pending layer alone. A phrase drawn in
     * bronze would read as an unapplied suggestion, which is the one thing it
     * never is.
     */
    const band = readFileSync("src/components/workspace/PhraseBand.tsx", "utf8");
    const selection = readFileSync(
      "src/components/workspace/TimeSelectionBand.tsx",
      "utf8",
    );

    expect(band).not.toMatch(/\b(?:text|border|bg|ring)-bronze/);
    expect(band).toContain("border-t-2");
    expect(band).toContain("text-muted");
    /* No filled surface: the notes under the staff's padding stay the ink. */
    expect(band).not.toMatch(/\bbg-(accent|steel|muted)/);
    /* The selection keeps its filled surface, its ring and its solid ends. */
    expect(selection).toContain("bg-accent/20");
    expect(selection).toContain("ring-2");
  });

  it("names the selection hue the palette actually declares", () => {
    /*
     * Tailwind emits nothing for a colour token that was never declared and
     * warns about nothing, so `bg-accent` was width and opacity with no
     * colour: the strongest layer of the editor drew as an empty rectangle.
     */
    const palette = readFileSync("src/app/globals.css", "utf8");
    expect(palette).toMatch(/--color-accent:\s*#[0-9a-f]{6}/i);
  });
});
