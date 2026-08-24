/**
 * Shapes on a real fretboard (2O-B §24).
 *
 * Every assertion here is about **sounding pitch**, not about fret numbers in
 * a row. A test that compared "0 2 2 1 0" to "0 2 2 1 0" would pass on a
 * fretboard strung backwards, and the whole point of deriving shapes from the
 * track's own tuning is that the sound is what has to be right.
 */
import { describe, expect, it } from "vitest";

import {
  bass,
  capoGuitar,
  dadgadGuitar,
  dropDGuitar,
  guitar,
} from "../../../eval/chord/fixtures";

import { chordPitchClasses, requiredPitchClasses } from "@/lib/chords/chord-formula";
import {
  compareFretted,
  frettedCandidates,
  selectFrettedVoicings,
  type FrettedVoicing,
  type ShapeString,
} from "@/lib/chords/fretted-voicing";
import { voicingLimits } from "@/lib/limits";
import { maxCapoRelativeFret, soundingMidi } from "@/lib/music/fretboard";
import { midiToPitch, pitchClass } from "@/lib/music/pitch";
import type { Fretboard } from "@/lib/song/schema";

const STANDARD = guitar().fretboard!;

const played = (voicing: FrettedVoicing) =>
  voicing.strings.filter(
    (entry): entry is Extract<ShapeString, { kind: "played" }> =>
      entry.kind === "played",
  );

/** What each string of a shape actually sounds, thickest string first. */
const soundsOf = (voicing: FrettedVoicing) =>
  played(voicing).map((entry) => entry.pitch);

/** Re-derive every sounding pitch from the fretboard, ignoring what the shape says. */
function verifyAgainstFretboard(board: Fretboard, voicing: FrettedVoicing): string[] {
  return voicing.strings.flatMap((entry, stringIndex) => {
    if (entry.kind !== "played") return [];
    const midi = soundingMidi(board, { string: stringIndex, fret: entry.fret });
    return midi === null ? ["unplayable"] : [midiToPitch(midi)];
  });
}

const find = (list: readonly FrettedVoicing[], id: string) =>
  list.find((voicing) => voicing.id === id);

/** The pitch class of the seventh in a seventh chord, from the one table. */
const normalizePitchClassOf = (
  root: number,
  quality: "dominant_7" | "major_7" | "minor_7" | "half_diminished_7",
) => {
  const tones = chordPitchClasses(root, quality);
  return tones[tones.length - 1]!;
};

describe("150. the three A minor 7 shapes a guitarist would recognise", () => {
  const candidates = frettedCandidates({
    fretboard: STANDARD,
    rootPitchClass: 9,
    quality: "minor_7",
  });

  it("finds the open shape, and it sounds A C E G", () => {
    const open = find(candidates, "x-0-2-0-1-0");
    expect(open, "x 0 2 0 1 0").toBeDefined();
    if (!open) return;
    expect(soundsOf(open)).toEqual(["A2", "E3", "G3", "C4", "E4"]);
    expect(open.bassPitch).toBe("A2");
  });

  it("finds the fifth-position barre, and it sounds A C E G", () => {
    const barre = find(candidates, "5-7-5-5-5-5");
    expect(barre, "5 7 5 5 5 5").toBeDefined();
    if (!barre) return;
    expect(soundsOf(barre)).toEqual(["A2", "E3", "G3", "C4", "E4", "A4"]);
    expect(barre.bassPitch).toBe("A2");
  });

  it("finds the thinned fifth-position shape, and it sounds A G C E", () => {
    const thin = find(candidates, "5-x-5-5-5-x");
    expect(thin, "5 x 5 5 5 x").toBeDefined();
    if (!thin) return;
    expect(soundsOf(thin)).toEqual(["A2", "G3", "C4", "E4"]);
    expect(thin.noteCount).toBe(4);
  });

  it("gives all three the pitch classes of A minor 7 and nothing else", () => {
    const wanted = new Set(chordPitchClasses(9, "minor_7"));
    for (const id of ["x-0-2-0-1-0", "5-7-5-5-5-5", "5-x-5-5-5-x"]) {
      const voicing = find(candidates, id);
      expect(voicing, id).toBeDefined();
      if (!voicing) continue;
      for (const pitch of soundsOf(voicing)) {
        expect(wanted.has(pitchClass(pitch)!), `${id} sounds ${pitch}`).toBe(true);
      }
      // A, C, E and G all present: nothing that makes it Am7 has gone missing.
      expect(new Set(voicing.soundingClasses)).toEqual(wanted);
    }
  });

  it("re-derives the same sounds straight from the tuning", () => {
    // The shape's own pitch fields could all be wrong together; this asks the
    // fretboard again rather than believing them.
    for (const id of ["x-0-2-0-1-0", "5-7-5-5-5-5", "5-x-5-5-5-x"]) {
      const voicing = find(candidates, id)!;
      expect(verifyAgainstFretboard(STANDARD, voicing), id).toEqual(soundsOf(voicing));
    }
  });

  it("offers the open shape first when the reader is at the nut", () => {
    const offered = selectFrettedVoicings({
      fretboard: STANDARD,
      rootPitchClass: 9,
      quality: "minor_7",
    });
    expect(offered.length).toBeGreaterThan(0);
    /*
     * Both halves, on purpose. Reading the limit and comparing the count to
     * it is circular — raise the limit and the assertion rises with it — so
     * the promise the product actually makes is pinned as a number too.
     */
    expect(voicingLimits.maxVariations).toBe(4);
    expect(offered.length).toBeLessThanOrEqual(4);
    expect(offered[0]?.id).toBe("x-0-2-0-1-0");
  });

  it("offers fifth-position shapes first when the reader is at the fifth fret", () => {
    const offered = selectFrettedVoicings({
      fretboard: STANDARD,
      rootPitchClass: 9,
      quality: "minor_7",
      anchorFret: 5,
    });
    expect(offered[0]?.anchor).toBeGreaterThanOrEqual(5);
    expect(offered[0]?.bassPitch).toBe("A2");
  });
});

describe("151. other roots and qualities produce real shapes, not just Am7", () => {
  const cases: readonly {
    label: string;
    root: number;
    quality: Parameters<typeof chordPitchClasses>[1];
    expectId: string;
    sounds: string[];
  }[] = [
    { label: "A major", root: 9, quality: "major", expectId: "x-0-2-2-2-0", sounds: ["A2", "E3", "A3", "C#4", "E4"] },
    { label: "A minor", root: 9, quality: "minor", expectId: "x-0-2-2-1-0", sounds: ["A2", "E3", "A3", "C4", "E4"] },
    { label: "E minor", root: 4, quality: "minor", expectId: "0-2-2-0-0-0", sounds: ["E2", "B2", "E3", "G3", "B3", "E4"] },
    { label: "C major", root: 0, quality: "major", expectId: "x-3-2-0-1-0", sounds: ["C3", "E3", "G3", "C4", "E4"] },
    { label: "D7", root: 2, quality: "dominant_7", expectId: "x-x-0-2-1-2", sounds: ["D3", "A3", "C4", "F#4"] },
    { label: "Cmaj7", root: 0, quality: "major_7", expectId: "x-3-2-0-0-0", sounds: ["C3", "E3", "G3", "B3", "E4"] },
    { label: "Esus4", root: 4, quality: "sus4", expectId: "0-0-2-2-0-0", sounds: ["E2", "A2", "E3", "A3", "B3", "E4"] },
    { label: "D5", root: 2, quality: "power", expectId: "x-x-0-2-x-x", sounds: ["D3", "A3"] },
  ];

  for (const entry of cases) {
    it(`finds ${entry.label} and it sounds right`, () => {
      const all = frettedCandidates({
        fretboard: STANDARD,
        rootPitchClass: entry.root,
        quality: entry.quality,
      });
      const voicing = find(all, entry.expectId);
      expect(voicing, `${entry.label} ${entry.expectId}`).toBeDefined();
      if (!voicing) return;
      expect(soundsOf(voicing)).toEqual(entry.sounds);
      expect(verifyAgainstFretboard(STANDARD, voicing)).toEqual(entry.sounds);
    });
  }

  it("offers the ordinary open shape first for each of them", () => {
    const expected: Record<string, string> = {
      "9-major": "x-0-2-2-2-0",
      "9-minor": "x-0-2-2-1-0",
      "4-minor": "0-2-2-0-0-0",
      "0-major": "x-3-2-0-1-0",
      "4-sus4": "0-0-2-2-0-0",
      "2-power": "x-x-0-2-x-x",
    };
    for (const [key, id] of Object.entries(expected)) {
      const [root, quality] = key.split("-");
      const offered = selectFrettedVoicings({
        fretboard: STANDARD,
        rootPitchClass: Number(root),
        quality: quality as Parameters<typeof chordPitchClasses>[1],
      });
      expect(offered[0]?.id, key).toBe(id);
    }
  });

  it("keeps every required tone of every quality at every root", () => {
    for (let root = 0; root < 12; root += 1) {
      for (const quality of ["major", "minor", "dominant_7", "major_7", "minor_7", "half_diminished_7", "sus2", "sus4", "diminished", "augmented"] as const) {
        const offered = selectFrettedVoicings({
          fretboard: STANDARD,
          rootPitchClass: root,
          quality,
        });
        const required = requiredPitchClasses(root, quality);
        for (const voicing of offered) {
          for (const tone of required) {
            expect(
              voicing.soundingClasses.includes(tone),
              `${root} ${quality} ${voicing.id} missing ${tone}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe("152. the physical rules the search may never break", () => {
  const boards: readonly { label: string; board: Fretboard }[] = [
    { label: "standard", board: STANDARD },
    { label: "drop D", board: dropDGuitar().fretboard! },
    { label: "capo 2", board: capoGuitar(2).fretboard! },
    { label: "DADGAD", board: dadgadGuitar().fretboard! },
    { label: "bass", board: bass().fretboard! },
  ];

  it("never puts two notes on one string", () => {
    for (const { label, board } of boards) {
      for (const voicing of frettedCandidates({
        fretboard: board,
        rootPitchClass: 9,
        quality: "minor_7",
      })) {
        expect(voicing.strings.length, label).toBe(board.tuning.length);
      }
    }
  });

  it("never writes a fret past what the capo leaves", () => {
    for (const { label, board } of boards) {
      const max = maxCapoRelativeFret(board.capo);
      for (const voicing of frettedCandidates({
        fretboard: board,
        rootPitchClass: 7,
        quality: "major",
      })) {
        for (const entry of played(voicing)) {
          expect(entry.fret, `${label} ${voicing.id}`).toBeGreaterThanOrEqual(0);
          expect(entry.fret, `${label} ${voicing.id}`).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("never asks for a stretch beyond the central limit", () => {
    for (const { label, board } of boards) {
      for (const voicing of frettedCandidates({
        fretboard: board,
        rootPitchClass: 3,
        quality: "major_7",
      })) {
        expect(voicing.span, `${label} ${voicing.id}`).toBeLessThanOrEqual(
          voicingLimits.maxFretSpan,
        );
      }
    }
  });

  it("never leaves more than one silent string inside the shape", () => {
    for (const voicing of frettedCandidates({
      fretboard: STANDARD,
      rootPitchClass: 0,
      quality: "major",
    })) {
      expect(voicing.interiorSkips, voicing.id).toBeLessThanOrEqual(
        voicingLimits.maxInteriorSkips,
      );
    }
  });

  it("never asks for more fingers than a hand has", () => {
    /*
     * Four fingers, and a barre when four are not enough. A repeated fret is
     * not itself a barre — open D7 puts two fingers on the second fret with a
     * third on the first between them — so the rule is about how many strings
     * must be held, not about how the frets line up.
     */
    for (const quality of ["major", "minor_7", "major_7", "diminished"] as const) {
      for (const voicing of frettedCandidates({
        fretboard: STANDARD,
        rootPitchClass: 5,
        quality,
      })) {
        const fretted = voicing.strings
          .map((entry, index) =>
            entry.kind === "played" && entry.physicalFret > 0
              ? { index, fret: entry.physicalFret }
              : null,
          )
          .filter((entry): entry is { index: number; fret: number } => entry !== null);
        if (fretted.length <= 4) continue;

        const lowest = Math.min(...fretted.map((entry) => entry.fret));
        const covered = fretted.filter((entry) => entry.fret === lowest);
        const from = Math.min(...covered.map((entry) => entry.index));
        const to = Math.max(...covered.map((entry) => entry.index));

        // Whatever the barre lies across must not be a string meant to ring.
        for (let index = from + 1; index < to; index += 1) {
          const between = voicing.strings[index];
          if (between?.kind !== "played") continue;
          expect(between.physicalFret, `${voicing.id} open under barre`).toBeGreaterThan(0);
        }
        // One finger for the barre, three for the rest.
        expect(
          1 + (fretted.length - covered.length),
          `${voicing.id} needs too many fingers`,
        ).toBeLessThanOrEqual(4);
      }
    }
  });

  it("keeps the ordinary open D7, which is three fingers and not a barre", () => {
    // The shape a naive "same fret twice means a barre" rule throws away.
    const d7 = find(
      frettedCandidates({ fretboard: STANDARD, rootPitchClass: 2, quality: "dominant_7" }),
      "x-x-0-2-1-2",
    );
    expect(d7).toBeDefined();
    expect(d7 && soundsOf(d7)).toEqual(["D3", "A3", "C4", "F#4"]);
  });

  it("refuses rather than inventing when nothing is playable", () => {
    // One string tuned to a note the chord does not contain, and no frets to
    // reach with: there is no shape, and none is made up.
    const impossible: Fretboard = { tuning: ["C2"], capo: 0 };
    expect(
      frettedCandidates({
        fretboard: impossible,
        rootPitchClass: 0,
        quality: "major",
      }),
    ).toEqual([]);
  });

  it("never drops the tone that makes a seventh chord a seventh", () => {
    /*
     * The fifth may go when a neck cannot reach it — that exemption is in the
     * formula table. The seventh may not: without it a minor 7 is a minor
     * triad wearing the wrong name. Checked over the whole candidate set, at
     * every root, on five different fretboards.
     */
    const sevenths = ["dominant_7", "major_7", "minor_7", "half_diminished_7"] as const;
    const boards = [STANDARD, dropDGuitar().fretboard!, capoGuitar(2).fretboard!, bass().fretboard!];
    for (const board of boards) {
      for (const quality of sevenths) {
        for (let root = 0; root < 12; root += 1) {
          const seventh = normalizePitchClassOf(root, quality);
          for (const voicing of frettedCandidates({
            fretboard: board,
            rootPitchClass: root,
            quality,
          })) {
            expect(
              voicing.soundingClasses.includes(seventh),
              `${root} ${quality} ${voicing.id} has no seventh`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("reaches the upper neck rather than stopping halfway", () => {
    // A clamp at the twelfth fret would still satisfy every "within range"
    // assertion while quietly halving the instrument.
    const all = frettedCandidates({
      fretboard: STANDARD,
      rootPitchClass: 9,
      quality: "minor_7",
    });
    const highest = Math.max(...all.flatMap((voicing) => played(voicing).map((entry) => entry.fret)));
    expect(highest).toBeGreaterThan(12);
    expect(highest).toBeLessThanOrEqual(maxCapoRelativeFret(0));
  });

  it("offers shapes that differ from each other, not the same one twice", () => {
    for (const quality of ["major", "minor", "minor_7", "sus4"] as const) {
      for (let root = 0; root < 12; root += 1) {
        const offered = selectFrettedVoicings({
          fretboard: STANDARD,
          rootPitchClass: root,
          quality,
        });
        const seen = new Set<string>();
        for (const voicing of offered) {
          // Two cards may not be the same shape, and may not be the same
          // idea: same bass, near-identical fullness.
          expect(seen.has(voicing.id), `${root} ${quality} repeats ${voicing.id}`).toBe(false);
          seen.add(voicing.id);
        }
        /*
         * Two cards from the same neck region have to be different things to
         * hear or to hold: another tone underneath, or at least two strings'
         * difference in how full the shape is. One extra muted string is the
         * same idea shown twice.
         */
        for (let a = 0; a < offered.length; a += 1) {
          for (let b = a + 1; b < offered.length; b += 1) {
            const one = offered[a]!;
            const other = offered[b]!;
            const sameRegion =
              Math.floor(one.anchor / 3) === Math.floor(other.anchor / 3);
            if (!sameRegion) continue;
            const differs =
              one.bassPitchClass !== other.bassPitchClass ||
              Math.abs(one.noteCount - other.noteCount) >= 2;
            expect(
              differs,
              `${root} ${quality}: ${one.id} and ${other.id} are the same idea`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("hands the candidates back in canonical order", () => {
    // The order is part of the answer: everything downstream, including which
    // shapes are offered, reads the front of this list.
    const all = frettedCandidates({
      fretboard: STANDARD,
      rootPitchClass: 0,
      quality: "major",
    });
    expect(all.length).toBeGreaterThan(1);
    const sorted = [...all].sort(compareFretted);
    expect(all.map((voicing) => voicing.id)).toEqual(sorted.map((voicing) => voicing.id));
  });

  it("answers the same bytes five runs over", () => {
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(
        selectFrettedVoicings({
          fretboard: STANDARD,
          rootPitchClass: 9,
          quality: "minor_7",
        }),
      ),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("153. the shape comes from the reader's own fretboard", () => {
  it("finds the open Drop D power chord, which standard tuning cannot play", () => {
    const dropD = dropDGuitar().fretboard!;
    const open = frettedCandidates({
      fretboard: dropD,
      rootPitchClass: 2,
      quality: "power",
      withOctave: true,
    }).find((voicing) => voicing.id === "0-0-0-x-x-x");

    expect(open, "0 0 0 x x x in Drop D").toBeDefined();
    if (!open) return;
    // The whole point of Drop D: three open strings sound D, A, D.
    expect(soundsOf(open)).toEqual(["D2", "A2", "D3"]);
    expect(verifyAgainstFretboard(dropD, open)).toEqual(["D2", "A2", "D3"]);
  });

  it("does not find that shape on a guitar in standard tuning", () => {
    // Same three strings open in standard tuning sound E, A, D — not a D5,
    // and nothing pretends otherwise.
    const standardOpen = frettedCandidates({
      fretboard: STANDARD,
      rootPitchClass: 2,
      quality: "power",
      withOctave: true,
    }).find((voicing) => voicing.id === "0-0-0-x-x-x");
    expect(standardOpen).toBeUndefined();
  });

  it("moves a Drop D power chord up the neck as one shape", () => {
    const dropD = dropDGuitar().fretboard!;
    const fifth = frettedCandidates({
      fretboard: dropD,
      rootPitchClass: 7,
      quality: "power",
      withOctave: true,
    }).find((voicing) => voicing.id === "5-5-5-x-x-x");
    expect(fifth, "5 5 5 x x x in Drop D").toBeDefined();
    expect(fifth && soundsOf(fifth)).toEqual(["G2", "D3", "G3"]);
  });

  it("keeps the sounding root the reader asked for when a capo is on", () => {
    const capo = capoGuitar(2).fretboard!;
    const offered = selectFrettedVoicings({
      fretboard: capo,
      rootPitchClass: 9,
      quality: "power",
    });
    expect(offered.length).toBeGreaterThan(0);
    for (const voicing of offered) {
      // Sounding A, whatever the capo does to the fret numbers: the root is
      // underneath and only A and E are heard.
      expect(voicing.bassPitchClass, voicing.id).toBe(9);
      expect(voicing.soundingClasses, voicing.id).toEqual([4, 9]);
      for (const pitch of soundsOf(voicing)) {
        expect([9, 4], `${voicing.id} sounds ${pitch}`).toContain(pitchClass(pitch));
      }
    }
  });

  it("writes capo-relative frets, two lower than the same sound without a capo", () => {
    // A5 at the fifth fret of the low E string. With a capo on 2, the same
    // sound is written as fret 3 — and it is still A.
    const plain = frettedCandidates({
      fretboard: STANDARD,
      rootPitchClass: 9,
      quality: "power",
    }).find((voicing) => voicing.id === "5-7-x-x-x-x");
    const capoed = frettedCandidates({
      fretboard: capoGuitar(2).fretboard!,
      rootPitchClass: 9,
      quality: "power",
    }).find((voicing) => voicing.id === "3-5-x-x-x-x");

    expect(plain, "5 7 without capo").toBeDefined();
    expect(capoed, "3 5 with capo 2").toBeDefined();
    expect(plain && soundsOf(plain)).toEqual(["A2", "E3"]);
    expect(capoed && soundsOf(capoed)).toEqual(["A2", "E3"]);
    // Written differently, sounding identically: the capo moved the writing,
    // not the music.
    expect(capoed?.strings[0]).toMatchObject({ fret: 3, physicalFret: 5 });
  });

  it("never writes a fret the capo has taken away", () => {
    const capo = capoGuitar(7).fretboard!;
    const max = maxCapoRelativeFret(7);
    for (const voicing of frettedCandidates({
      fretboard: capo,
      rootPitchClass: 0,
      quality: "major",
    })) {
      for (const entry of played(voicing)) {
        expect(entry.fret, voicing.id).toBeLessThanOrEqual(max);
        expect(entry.physicalFret, voicing.id).toBe(entry.fret + 7);
      }
    }
  });

  it("reads an alternate tuning it has never been told about", () => {
    // DADGAD is not one of the presets. Nothing here knows its name; the
    // shapes come from the six pitches on the track.
    const dadgad = dadgadGuitar().fretboard!;
    const offered = selectFrettedVoicings({
      fretboard: dadgad,
      rootPitchClass: 2,
      quality: "sus4",
    });
    expect(offered.length).toBeGreaterThan(0);
    const open = frettedCandidates({
      fretboard: dadgad,
      rootPitchClass: 2,
      quality: "sus4",
    }).find((voicing) => voicing.id === "0-0-0-0-0-0");
    expect(open, "all six open strings are Dsus4 in DADGAD").toBeDefined();
    expect(open && soundsOf(open)).toEqual(["D2", "A2", "D3", "G3", "A3", "D4"]);
  });
});

describe("154. a bass is a bass, not a guitar with two strings missing", () => {
  const BASS = bass().fretboard!;

  it("uses the four strings the registry gave it", () => {
    for (const voicing of frettedCandidates({
      fretboard: BASS,
      rootPitchClass: 9,
      quality: "power",
    })) {
      expect(voicing.strings.length, voicing.id).toBe(4);
    }
  });

  it("plays a two-note power chord in its own register", () => {
    const offered = selectFrettedVoicings({
      fretboard: BASS,
      rootPitchClass: 9,
      quality: "power",
    });
    expect(offered.length).toBeGreaterThan(0);
    const first = offered[0]!;
    expect(first.noteCount).toBe(2);
    expect(soundsOf(first)).toEqual(["A1", "E2"]);
    expect(verifyAgainstFretboard(BASS, first)).toEqual(["A1", "E2"]);
  });

  it("plays the three-note octave shape when the reader asks for it", () => {
    const withOctave = frettedCandidates({
      fretboard: BASS,
      rootPitchClass: 9,
      quality: "power",
      withOctave: true,
    });
    expect(withOctave.length).toBeGreaterThan(0);
    for (const voicing of withOctave) {
      expect(voicing.noteCount, voicing.id).toBe(3);
      const midi = played(voicing)
        .map((entry) => entry.midi)
        .sort((a, b) => a - b);
      // Root, fifth, root again an octave up.
      expect(midi[2]! - midi[0]!, voicing.id).toBe(12);
    }
    expect(soundsOf(withOctave[0]!)).toEqual(["A1", "E2", "A2"]);
  });

  it("refuses rather than inventing when a full voicing will not fit", () => {
    // A four-note seventh needs four strings; ask for one whose tones cannot
    // all be reached inside one hand position and the answer is nothing, not
    // a three-note shape wearing the name.
    const tiny: Fretboard = { tuning: ["E1", "A1"], capo: 0 };
    const result = frettedCandidates({
      fretboard: tiny,
      rootPitchClass: 0,
      quality: "half_diminished_7",
    });
    expect(result).toEqual([]);
  });

  it("carries no six-string assumption into the search", () => {
    // Every candidate has exactly one entry per string of the actual tuning,
    // on a five-string bass the registry does not even list.
    const fiveString: Fretboard = { tuning: ["B0", "E1", "A1", "D2", "G2"], capo: 0 };
    for (const voicing of frettedCandidates({
      fretboard: fiveString,
      rootPitchClass: 7,
      quality: "power",
    })) {
      expect(voicing.strings.length, voicing.id).toBe(5);
    }
  });
});
