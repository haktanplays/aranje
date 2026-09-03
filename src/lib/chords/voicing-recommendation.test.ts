/**
 * Which shape lands on the grid, and why the others are worth a tap (2W §11).
 */
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { applyChordWrite } from "@/lib/chords/chord-command";
import { chordVoicings, type ChordVoicing } from "@/lib/chords/chord-voicing";
import {
  VOICING_ANGLE_LABEL,
  recommendVoicings,
} from "@/lib/chords/voicing-recommendation";
import { barTimeline, buildNotatedPlan } from "@/lib/audio/schedule";

const song = editorFixture();
const guitar = song.tracks.find((track) => track.id === "gtr")!;

const offered = (rootPitchClass: number, quality: "major" | "minor") => {
  const result = chordVoicings({ track: guitar, rootPitchClass, quality });
  if (!result.ok) throw new Error(result.error.message);
  return result.voicings;
};

describe("there is always a shape on the grid", () => {
  it("recommends one whenever anything is playable", () => {
    for (const root of [0, 2, 4, 5, 7, 9, 11]) {
      for (const quality of ["major", "minor"] as const) {
        const pick = recommendVoicings(offered(root, quality));
        expect(pick, `${root} ${quality}`).not.toBeNull();
        expect(pick!.recommended.kind).toBe("fretted");
      }
    }
  });

  it("recommends nothing when nothing is offered", () => {
    expect(recommendVoicings([])).toBeNull();
  });

  it("is deterministic: the same input picks the same shape", () => {
    const once = recommendVoicings(offered(4, "minor"));
    const twice = recommendVoicings(offered(4, "minor"));
    expect(once!.recommended.id).toBe(twice!.recommended.id);
    expect(once!.alternatives.map((choice) => choice.voicing.id)).toEqual(
      twice!.alternatives.map((choice) => choice.voicing.id),
    );
  });
});

describe("it follows the hand", () => {
  it("prefers a shape near where the reader is looking", () => {
    const shapes = offered(4, "minor");
    const low = recommendVoicings(shapes, { anchorFret: 0 })!;
    const high = recommendVoicings(shapes, { anchorFret: 12 })!;
    const anchorOf = (voicing: ChordVoicing) =>
      voicing.kind === "fretted" ? voicing.shape.anchor : 0;
    expect(anchorOf(high.recommended)).toBeGreaterThanOrEqual(anchorOf(low.recommended));
  });

  it("reads the neck from the nut when nobody said where", () => {
    const pick = recommendVoicings(offered(4, "minor"))!;
    expect(pick.recommended.kind).toBe("fretted");
  });
});

describe("the alternatives are alternatives", () => {
  const pick = recommendVoicings(offered(4, "minor"), { anchorFret: 0 })!;

  it("never repeats the recommended shape", () => {
    for (const choice of pick.alternatives) {
      expect(choice.voicing.id).not.toBe(pick.recommended.id);
    }
  });

  it("never offers one shape under two names", () => {
    const ids = pick.alternatives.map((choice) => choice.voicing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers at most the four named angles", () => {
    expect(pick.alternatives.length).toBeLessThanOrEqual(4);
    for (const choice of pick.alternatives) {
      expect(Object.keys(VOICING_ANGLE_LABEL)).toContain(choice.angle);
    }
  });

  it("names every angle in the reader's words", () => {
    expect(Object.values(VOICING_ANGLE_LABEL)).toEqual([
      "En yakın",
      "En kolay",
      "Daha açık",
      "Daha kalın",
    ]);
  });

  it("offers nothing when there is only one shape", () => {
    const one = recommendVoicings([offered(4, "minor")[0]!])!;
    expect(one.alternatives).toEqual([]);
  });

  it("only offers a shape that really is better on its own angle", () => {
    /* "En kolay" that is no easier than the recommended one is a button that
       does nothing but move the selection. */
    const effortOf = (voicing: ChordVoicing) =>
      voicing.kind === "fretted"
        ? voicing.shape.frettedCount * 10 + voicing.shape.span
        : 0;
    const easier = pick.alternatives.find((choice) => choice.angle === "easiest");
    if (easier) {
      expect(effortOf(easier.voicing)).toBeLessThan(effortOf(pick.recommended));
    }
  });
});

describe("writing the recommended shape", () => {
  const bar = barTimeline(song)[1]!;

  const write = () => {
    const pick = recommendVoicings(offered(4, "minor"))!;
    return applyChordWrite(song, {
      sectionId: bar.sectionId,
      trackId: guitar.id,
      timeTicks: bar.time,
      durationTicks: bar.durationTicks,
      voicing: pick.recommended,
      velocity: 96,
      mode: "insert",
    });
  };

  it("goes through the production command and lands", () => {
    const result = write();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = buildNotatedPlan(result.song).events.filter(
      (event) => event.trackId === guitar.id && event.time === bar.time,
    );
    expect(added.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the song it was given byte-identical", () => {
    const before = JSON.stringify(song);
    write();
    expect(JSON.stringify(song)).toBe(before);
  });

  it("produces the same bytes twice for the same choice", () => {
    const first = write();
    const second = write();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.song)).toBe(JSON.stringify(second.song));
  });
});
