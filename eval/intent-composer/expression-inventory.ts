/**
 * What the Song Contract can actually say about how a note is played
 * (2S-A §10).
 *
 * Generated from the product's own modules rather than typed out, so the
 * table cannot drift from the code it describes. Every column is read from
 * the one place that owns that answer:
 *
 * - **contract** — `articulationSchema`, the only articulation enum there is.
 * - **writable** — the choices the note sheet offers.
 * - **drawn** — the marks the tab glyph knows.
 * - **audible** — whether the expression layer does anything for it: a
 *   per-note voice (`isExpressive`) or a different hold (`articulationHold`).
 * - **midi** — whether the MIDI writer expresses it. It expresses none of
 *   them, on purpose (2M-A): MIDI's only channel-level tool is pitch bend and
 *   it would move every note on the channel.
 *
 *   npx tsx eval/intent-composer/expression-inventory.ts
 */
import { writeFileSync } from "node:fs";

import { articulationHold, DEFAULT_VELOCITY } from "@/lib/audio/schedule";
import { EXPRESSIVE_ARTICULATIONS } from "@/lib/audio/expression";
import { articulationSchema, type Articulation } from "@/lib/song/schema";
import { DRUM_PIECES } from "@/lib/instruments/registry";

/** The note sheet's own list, kept beside it so a drift shows up here. */
const WRITABLE: readonly Articulation[] = [
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "slide",
  "hammer_on",
  "pull_off",
];

/** The tab's own marks, from `ArticulationGlyph`. */
const DRAWN: readonly string[] = [
  "accent",
  "palm_mute",
  "vibrato",
  "bend_half",
  "bend_full",
  "hammer_on",
  "pull_off",
  "slide",
];

const CONTRACT = articulationSchema.options as readonly Articulation[];
const EXPRESSIVE = new Set<string>(EXPRESSIVE_ARTICULATIONS);

/** What a reader would call it, in the words §10 asks about. */
const ASKED_ABOUT: readonly { name: string; articulation: Articulation | null }[] = [
  { name: "sus (sustain)", articulation: "sustain" },
  { name: "palm mute", articulation: "palm_mute" },
  { name: "staccato", articulation: "staccato" },
  { name: "dead note (x)", articulation: null },
  { name: "ghost note (gitar)", articulation: null },
  { name: "muted strum", articulation: null },
  { name: "vuruş yönü (aşağı/yukarı)", articulation: null },
];

const rows = ASKED_ABOUT.map((entry) => {
  const value = entry.articulation;
  const inContract = value !== null && CONTRACT.includes(value);
  return {
    name: entry.name,
    articulation: value,
    inContract,
    writable: value !== null && WRITABLE.includes(value),
    drawn: value !== null && DRAWN.includes(value),
    audible:
      value !== null &&
      (EXPRESSIVE.has(value) || articulationHold(value) !== articulationHold(undefined)),
    /** The MIDI writer expresses no articulation at all (2M-A, K-50). */
    midi: false,
    instruments: inContract ? "her melodik enstrüman" : "yok",
  };
});

const report = {
  note:
    "Generated from the product's own modules. `midi` is false for every " +
    "articulation by design (2M-A, K-50), not by omission.",
  contract: CONTRACT,
  drumArticulations: ["normal", "ghost", "accent"],
  drumPieces: DRUM_PIECES,
  defaultVelocity: DEFAULT_VELOCITY,
  holds: Object.fromEntries(
    CONTRACT.map((entry) => [entry, articulationHold(entry)]),
  ),
  rows,
};

writeFileSync(
  "eval/intent-composer/EXPRESSION-INVENTORY.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report.rows, null, 2));
