/**
 * What the chord work costs in Node (spec 13.22 §28).
 *
 * Warm-up first, then twenty timed rounds; median, p95 and max. No threshold
 * is invented here and none is asserted: the numbers are written down, and a
 * bad one is reported as a bad one.
 *
 *   npx tsx eval/chord/measure.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import {
  bass,
  capoGuitar,
  dadgadGuitar,
  dropDGuitar,
  guitar,
  piano,
  songOf,
} from "./fixtures";

import { applyChordWrite } from "@/lib/chords/chord-command";
import { CHORD_QUALITY_IDS, chordPitchClasses } from "@/lib/chords/chord-formula";
import { readChord } from "@/lib/chords/chord-recognition";
import { frettedCandidates, selectFrettedVoicings } from "@/lib/chords/fretted-voicing";
import { keyboardCandidates } from "@/lib/chords/keyboard-voicing";
import { chordVoicings } from "@/lib/chords/chord-voicing";
import { applyTransform } from "@/lib/song/transform";
import { ticksPerSlot } from "@/lib/music/timing";
import type { Fretboard } from "@/lib/song/schema";

const OUT = "eval/chord/artifacts";
mkdirSync(OUT, { recursive: true });

const ROUNDS = 20;
const WARM = 10;

function time(label: string, run: () => void) {
  for (let index = 0; index < WARM; index += 1) run();
  const runs: number[] = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const started = performance.now();
    run();
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  const at = (fraction: number) =>
    Number((runs[Math.min(runs.length - 1, Math.floor(runs.length * fraction))] ?? 0).toFixed(4));
  return {
    label,
    rounds: ROUNDS,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: Number((runs[runs.length - 1] ?? 0).toFixed(4)),
  };
}

const STANDARD = guitar().fretboard!;
const EIGHTH = ticksPerSlot(8);

const board = (fretboard: Fretboard) => ({
  fretboard,
  rootPitchClass: 9,
  quality: "minor_7" as const,
});

const AM7 = (() => {
  const found = chordVoicings({ track: guitar(), rootPitchClass: 9, quality: "minor_7" });
  if (!found.ok) throw new Error("fixture");
  return found.voicings[0]!;
})();

const chordSong = (() => {
  const written = applyChordWrite(songOf([guitar()], 2), {
    sectionId: "s1",
    trackId: "gtr",
    timeTicks: 0,
    durationTicks: EIGHTH,
    voicing: AM7,
    velocity: 96,
    mode: "insert",
  });
  if (!written.ok) throw new Error("fixture");
  return written.song;
})();

const measurements = [
  time("formula: twelve roots of every quality", () => {
    for (const quality of CHORD_QUALITY_IDS) {
      for (let root = 0; root < 12; root += 1) chordPitchClasses(root, quality);
    }
  }),
  time("recognition: one onset", () => {
    readChord([{ pitch: "A2" }, { pitch: "E3" }, { pitch: "G3" }, { pitch: "C4" }, { pitch: "E4" }]);
  }),
  time("guitar candidates: standard tuning", () => {
    frettedCandidates(board(STANDARD));
  }),
  time("guitar candidates: Drop D", () => {
    frettedCandidates(board(dropDGuitar().fretboard!));
  }),
  time("guitar candidates: capo 2", () => {
    frettedCandidates(board(capoGuitar(2).fretboard!));
  }),
  time("guitar candidates: DADGAD", () => {
    frettedCandidates(board(dadgadGuitar().fretboard!));
  }),
  time("bass candidates", () => {
    frettedCandidates(board(bass().fretboard!));
  }),
  time("the offered four shapes", () => {
    selectFrettedVoicings(board(STANDARD));
  }),
  time("whole neck sweep: 11 qualities x 12 roots", () => {
    for (const quality of CHORD_QUALITY_IDS) {
      for (let root = 0; root < 12; root += 1) {
        selectFrettedVoicings({ fretboard: STANDARD, rootPitchClass: root, quality });
      }
    }
  }),
  time("keyboard inversions", () => {
    keyboardCandidates({ rootPitchClass: 9, quality: "minor_7", octave: 4 });
  }),
  time("command preview (validators included)", () => {
    applyChordWrite(songOf([guitar()], 2), {
      sectionId: "s1",
      trackId: "gtr",
      timeTicks: 0,
      durationTicks: EIGHTH,
      voicing: AM7,
      velocity: 96,
      mode: "insert",
    });
  }),
  time("command on a keyboard track", () => {
    const found = chordVoicings({
      track: piano(),
      rootPitchClass: 0,
      quality: "major_7",
      octave: 4,
    });
    if (!found.ok) return;
    applyChordWrite(songOf([piano()], 2), {
      sectionId: "s1",
      trackId: "piano",
      timeTicks: 0,
      durationTicks: EIGHTH,
      voicing: found.voicings[0]!,
      velocity: 96,
      mode: "insert",
    });
  }),
  time("transpose a written chord", () => {
    applyTransform(
      chordSong,
      { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: EIGHTH },
      { kind: "transpose_pitch", semitones: 2 },
    );
  }),
];

/** How big the search space actually is, beside how long it takes. */
const sizes = {
  "standard Am7 candidates": frettedCandidates(board(STANDARD)).length,
  "capo 2 Am7 candidates": frettedCandidates(board(capoGuitar(2).fretboard!)).length,
  "bass Am7 candidates": frettedCandidates(board(bass().fretboard!)).length,
  "offered to the reader": selectFrettedVoicings(board(STANDARD)).length,
};

const artefact = {
  measuredOn: "desktop Node — not a phone, and not evidence about one",
  node: process.version,
  note:
    "No threshold is invented. The whole-neck sweep is the worst case a " +
    "reader could reach only by pressing every root and every quality; the " +
    "number a single interaction pays is the single-candidate row.",
  measurements,
  sizes,
};

writeFileSync(`${OUT}/PERFORMANCE.json`, `${JSON.stringify(artefact, null, 2)}\n`);
for (const entry of measurements) {
  console.log(
    `${entry.label.padEnd(46)} median ${String(entry.medianMs).padStart(9)} ms  p95 ${String(entry.p95Ms).padStart(9)}  max ${String(entry.maxMs).padStart(9)}`,
  );
}
console.log(sizes);
