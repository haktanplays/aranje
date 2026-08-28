import { describe, expect, it } from "vitest";

import { REPERTOIRE } from "@/lib/repertoire/fixtures";
import { noteValueOf } from "@/lib/music/note-value";
import { songSchema, type Song } from "@/lib/song/schema";
import { soundingSpans, writtenSpans } from "@/lib/song/sounding";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";

const TRACK = "gtr";

const spansOf = (song: Song) => writtenSpans(song.sections[0]!.bars, TRACK);

/** Spans resolved onto the strings the fixture actually wrote. */
const heardOf = (song: Song) =>
  soundingSpans(spansOf(song), (span) => span.note.position?.string ?? null);

describe("every repertoire fixture", () => {
  const all = Object.entries(REPERTOIRE);

  it.each(all)("%s is schema-valid", (_name, build) => {
    expect(songSchema.safeParse(build()).success).toBe(true);
  });

  it.each(all)("%s survives a storage round trip byte for byte", (_name, build) => {
    const song = build();
    const raw = JSON.stringify(nextEnvelope(song, { kind: "empty" }));
    const back = decideLoad(raw);
    expect(back.kind).toBe("envelope");
    if (back.kind !== "envelope") return;
    /*
     * Compared through the schema on both sides: a parse normalises key
     * order, so a hand-written fixture and a loaded one differ in spelling
     * without differing in music — and it is the music that has to survive.
     */
    expect(back.song).toEqual(songSchema.parse(song));
  });

  it.each(all)("%s is built fresh each time", (_name, build) => {
    expect(build()).not.toBe(build());
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it.each(all)("%s writes every duration as an exact note value or a tie", (_name, build) => {
    for (const span of spansOf(build())) {
      /* Either one written value, or a duration a tie can spell. */
      const single = noteValueOf(span.writtenTicks);
      expect(
        single !== null || span.writtenTicks % 24 === 0,
        `${span.writtenTicks} ticks`,
      ).toBe(true);
    }
  });
});

describe("A — syncopated palm-muted double stops", () => {
  const song = REPERTOIRE.fixtureA();

  it("strikes two open strings together", () => {
    const together = spansOf(song).filter((span) => span.startTicks === 0);
    expect(together).toHaveLength(2);
    expect(together.map((s) => s.note.position?.string)).toEqual([0, 1]);
  });

  it("has real rests, not notes pretending to be short", () => {
    const bar = song.sections[0]!.bars[0]!.slots[TRACK];
    expect(bar!.filter((slot) => slot === null).length).toBeGreaterThan(6);
  });

  /* Off the beat: sixteenth five is the second sixteenth of beat two. */
  it("puts an accent off the beat", () => {
    const accent = spansOf(song).find((span) => span.note.velocity === 112);
    expect(accent?.startTicks).toBe(48 * 5);
    expect(accent!.startTicks % 192).not.toBe(0);
  });

  it("carries more than one palm-mute span", () => {
    const muted = spansOf(song).filter((s) => s.note.articulation === "palm_mute");
    const bars = new Set(muted.map((s) => s.barIndex));
    expect(bars.size).toBeGreaterThan(1);
  });

  it("ends with a hammer-on", () => {
    expect(spansOf(song).some((s) => s.note.articulation === "hammer_on")).toBe(true);
  });
});

describe("B — pedal string under fast legato", () => {
  const song = REPERTOIRE.fixtureB();

  /*
   * The bar the previous model could not write. The pedal is struck once and
   * rings through six later onsets; under the old reading the first of those
   * would have ended it, because an onset closed every open note.
   */
  it("keeps the open low E ringing under everything that follows", () => {
    const heard = heardOf(song);
    const pedal = heard.find((span) => span.startTicks === 0);
    expect(pedal?.writtenTicks).toBe(768);
    expect(pedal?.soundingTicks).toBe(768);
    expect(pedal?.cutByRestrike).toBe(false);

    const later = heard.filter((span) => span.startTicks > 0);
    expect(later.length).toBeGreaterThan(3);
    for (const span of later) {
      expect(span.startTicks).toBeLessThan(pedal!.startTicks + pedal!.soundingTicks);
    }
  });

  it("writes a 9-10-9 legato cell in thirty-seconds", () => {
    const cell = spansOf(song).filter((s) => s.writtenTicks === 24);
    expect(cell.map((s) => s.note.position?.fret)).toEqual([9, 10, 9]);
    expect(cell.map((s) => s.note.articulation)).toEqual([
      undefined,
      "hammer_on",
      "pull_off",
    ]);
  });

  it("puts a sixteenth and a thirty-second inside the same beat", () => {
    const beatTwo = spansOf(song).filter(
      (s) => s.startTicks >= 192 && s.startTicks < 384,
    );
    const values = new Set(beatTwo.map((s) => s.writtenTicks));
    expect(values.has(24)).toBe(true);
    expect(values.has(48)).toBe(true);
  });

  it("changes string and finishes on a vibrato", () => {
    const strings = new Set(
      spansOf(song).map((s) => s.note.position?.string),
    );
    expect(strings.size).toBeGreaterThanOrEqual(3);
    const last = [...spansOf(song)].sort((a, b) => b.startTicks - a.startTicks)[0];
    expect(last?.note.articulation).toBe("vibrato");
  });
});

describe("C — six-string ringing arpeggio with a partial re-attack", () => {
  const song = REPERTOIRE.fixtureC();

  it("rolls out six strings, one per string", () => {
    const rolled = spansOf(song).filter((s) => s.startTicks < 48 * 6);
    expect(rolled).toHaveLength(6);
    expect(rolled.map((s) => s.note.position?.string)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  /* Every string keeps its own life: the dirty let-ring arpeggio. */
  it("leaves every string ringing to the end of the bar", () => {
    const heard = heardOf(song);
    const rolled = heard.filter((s) => s.startTicks < 48 * 6);
    for (const span of rolled) {
      expect(span.startTicks + span.writtenTicks).toBe(768);
      expect(span.soundingTicks).toBe(span.writtenTicks);
    }
  });

  /*
   * Two of the six struck again while the other four keep sounding. Under the
   * old reading this single onset would have ended all six.
   */
  it("re-attacks two strings while the other four keep sounding", () => {
    const heard = heardOf(song);
    const restrike = heard.filter((s) => s.startTicks === 48 * 10);
    expect(restrike.map((s) => s.note.position?.string)).toEqual([4, 5]);

    const untouched = heard.filter(
      (s) => s.startTicks < 48 * 6 && [0, 1, 2, 3].includes(s.note.position!.string),
    );
    expect(untouched).toHaveLength(4);
    for (const span of untouched) {
      expect(span.soundingTicks).toBe(span.writtenTicks);
      expect(span.startTicks + span.soundingTicks).toBeGreaterThan(48 * 10);
    }
  });

  it("overlaps at least four voices at once", () => {
    const heard = heardOf(song);
    const at = 48 * 11;
    const sounding = heard.filter(
      (s) => s.startTicks <= at && s.startTicks + s.soundingTicks > at,
    );
    expect(sounding.length).toBeGreaterThanOrEqual(4);
  });
});
