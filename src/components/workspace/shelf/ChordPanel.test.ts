/**
 * What the chord flow says out loud (2V-B.4 §11, §12, §13).
 *
 * The chord domain is tested where it lives — naming, spans, voicings and the
 * write each have their own file. What is checked here is the last hop: that
 * the panel a reader actually touches shows the shape before it asks them to
 * trust a word, names the chord in both the symbol and the spoken form, puts
 * the length in beats with the notation underneath it, and — when the music
 * will not take the chord — repeats the domain's own sentence instead of a
 * house apology that says nothing about what to do next.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { shapeLabel } from "@/components/workspace/shelf/ChordShape";
import { chordDisplayPair } from "@/lib/chords/chord-naming";
import { chordVoicings } from "@/lib/chords/chord-voicing";
import { CHORD_MESSAGES } from "@/lib/chords/chord-errors";
import { CHORD_SPAN_LABEL } from "@/lib/chords/chord-span";
import { noteLengthReading } from "@/lib/music/duration-language";
import { recommendVoicings } from "@/lib/chords/voicing-recommendation";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const PANEL = readFileSync(
  "src/components/workspace/shelf/ChordPanel.tsx",
  "utf8",
);
const GUITAR = SAMPLE_SONG.tracks.find((track) => track.fretboard)!;

describe("74. the chord says its name twice, in two registers", () => {
  it("pairs the symbol with the words a beginner would use", () => {
    expect(chordDisplayPair({ rootPitchClass: 0, quality: "minor" }, "C minor")).toBe(
      "Cm · C minör",
    );
    expect(chordDisplayPair({ rootPitchClass: 0, quality: "major" }, "C major")).toBe(
      "C · C majör",
    );
  });

  it("spells the pair for the key, on both halves at once", () => {
    /* Six sharps or six flats is the same key on a piano and two different
       words on a page; the symbol and the spoken form must not disagree. */
    const sharp = chordDisplayPair({ rootPitchClass: 6, quality: "major" }, "G major");
    const flat = chordDisplayPair({ rootPitchClass: 6, quality: "major" }, "Db major");
    expect(sharp).toBe("F# · F# majör");
    expect(flat).toBe("Gb · Gb majör");
  });

  it("never shows the internal quality name", () => {
    for (const key of ["C major", "A minor"]) {
      const pair = chordDisplayPair({ rootPitchClass: 9, quality: "minor_7" }, key);
      expect(pair).not.toContain("minor_7");
      expect(pair).not.toContain("_");
    }
  });
});

describe("75. the shape is shown before the reader is asked to trust a word", () => {
  it("names every string, so the row of glyphs is readable aloud", () => {
    const offered = chordVoicings({ track: GUITAR, rootPitchClass: 0, quality: "major" });
    if (!offered.ok) throw new Error("no voicing for C major on a guitar");
    const pick = recommendVoicings(offered.voicings);
    if (!pick) throw new Error("no recommendation for C major on a guitar");
    const label = shapeLabel(pick.recommended);
    const strings = label.split(", ");
    expect(strings).toHaveLength(GUITAR.fretboard?.tuning.length ?? 0);
    for (const [index, part] of strings.entries()) {
      expect(part).toContain(`${index + 1}. tel`);
      expect(part).toMatch(/susturulmuş|boş|perde/u);
    }
  });

  it("says nothing rather than something wrong when there is no shape", () => {
    expect(shapeLabel(null)).toBe("");
  });

  it("draws the shape above the listen button, not after it", () => {
    expect(PANEL.indexOf("<ChordShape")).toBeGreaterThan(-1);
    expect(PANEL.indexOf("<ChordShape")).toBeLessThan(PANEL.indexOf('label="Dinle"'));
  });
});

describe("76. the length is a musician's phrase with the notation under it", () => {
  it("reads one beat as one beat, and says the value quietly", () => {
    expect(noteLengthReading(192, 192)).toEqual({
      plain: "1 vuruş",
      technical: "dörtlük · 1/4",
    });
    expect(noteLengthReading(768, 192).plain).toBe("4 vuruş");
  });

  it("offers the four intentions and no raw number", () => {
    for (const label of Object.values(CHORD_SPAN_LABEL)) {
      expect(label).not.toMatch(/\d/u);
    }
    expect(Object.values(CHORD_SPAN_LABEL)).toEqual([
      "Bu vuruş",
      "Ölçü sonuna kadar",
      "Sonraki akora kadar",
      "Seçili alan boyunca",
    ]);
  });

  it("shows both registers together under the row that chose it", () => {
    expect(PANEL).toContain("noteLengthReading(span.ticks, target.beatTicks)");
    expect(PANEL).toContain("{length.plain} · {length.technical}");
  });
});

describe("77. a refusal keeps the domain's own words", () => {
  it("passes the write's sentence through instead of one of its own", () => {
    expect(PANEL).toContain("refusal: written.error.message");
    expect(PANEL).toContain("refusal: replaced.error.message");
    /* The old catch-all told every failure the same untrue story. */
    expect(PANEL).not.toContain("Bu süre buraya sığmıyor");
  });

  it("treats an occupied beat as the replace flow, not as a dead end", () => {
    expect(PANEL).toContain('written.error.code !== "target_occupied"');
    expect(PANEL).toContain('label={proposal?.replace ? "Uygula" : "Ekle"}');
  });

  it("never offers to push, shorten or restring a neighbour", () => {
    /* The sentences a reader can be shown for a collision, checked as
       sentences: each says what happened and what they may do, and none of
       them announces that the app moved somebody else's music (§13). */
    for (const code of [
      "target_occupied",
      "duration_not_representable",
      "chord_target_linked",
      "target_is_tie_continuation",
    ] as const) {
      const message = CHORD_MESSAGES[code];
      expect(message).toMatch(/\S/u);
      expect(message).not.toMatch(/otomatik|kaydırıldı|kısaltıldı|taşındı/iu);
    }
    expect(CHORD_MESSAGES.duration_not_representable).toContain("kısaltılmadı");
  });
});
