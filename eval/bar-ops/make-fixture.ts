/**
 * A small song built for bar operations (spec 13.12).
 *
 * The 2J fixture cannot do this job: it is exactly thirty-two bars, which is
 * the song limit, so every insertion in it refuses before it reaches the thing
 * under test. This one is deliberately short and deliberately awkward —
 * everything in it is here because one scenario needs it and nothing else is.
 *
 * - **Two sections of four bars**, well inside the limit, so inserting is
 *   about the operation rather than about the ceiling.
 * - **An empty bar** on the rhythm track (Giriş, bar 2), so a paste has a
 *   target that is genuinely free.
 * - **A full bar** beside it, so a paste has a target that is not.
 * - **A triplet bar** (1/12) among eighths, whose second slot falls at a tick
 *   an eighth-note grid cannot write — the refusal that must never be rounded.
 * - **A tie inside a section** (Nakarat bars 2→3), so a one-bar selection has
 *   something to be widened by.
 * - **A tie across the section seam** (Nakarat bar 4 → Çıkış bar 1), which is
 *   the case this version refuses outright — kept out of Giriş on purpose, so
 *   that section stays free of chains and the plain cases can be tested there.
 *
 * `npx tsx eval/bar-ops/make-fixture.ts`
 */
import { writeFileSync } from "node:fs";

import {
  songSchema,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Song,
  type Track,
} from "@/lib/song/schema";
import { TUNING_PRESETS } from "@/lib/music/fretboard";

const rest: MelodicSlot = null;
const tie: MelodicSlot = "-";

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret }, velocity: 100 }],
});

const at = (
  count: number,
  written: Readonly<Record<number, MelodicSlot>>,
): MelodicSlot[] => Array.from({ length: count }, (_, i) => written[i] ?? rest);

const drums = (
  count: number,
  written: Readonly<Record<number, DrumSlot>>,
): DrumSlot[] => Array.from({ length: count }, (_, i) => written[i] ?? []);

const BEAT = (count: number) =>
  drums(count, {
    0: [{ piece: "kick" }],
    [Math.floor(count / 2)]: [{ piece: "snare" }],
  });

const guitar = (id: string, name: string, presetId: string): Track => ({
  id,
  name,
  instrumentId: "electric_guitar",
  presetId,
  volumeDb: -5,
  fretboard: { tuning: [...(TUNING_PRESETS.e_standard?.tuning ?? [])], capo: 0 },
});

const tracks: Track[] = [
  guitar("rhythm", "Ritim Gitar", "high_gain"),
  guitar("lead", "Solo Gitar", "crunch"),
  { id: "drums", name: "Davul", instrumentId: "drum_kit", presetId: "rock", volumeDb: -3 },
];

function bar(
  resolution: 8 | 12,
  slots: Record<string, MelodicSlot[] | DrumSlot[]>,
): Bar {
  return { timeSignature: [4, 4], resolution, slots };
}

const RIFF = (count: number) =>
  at(count, { 0: note("E2", 0, 0), 2: note("G2", 0, 3), 4: note("A2", 1, 0) });

/*
 * Giriş — self-contained, so a selection here is never widened by a chain.
 *
 * Bars 2 and 5 have no rhythm key at all, which is silence rather than an
 * empty array: the state a paste may write into without asking. Bar 4 is full,
 * so a paste has something to collide with. Bar 3 is the triplet, whose second
 * slot falls 64 ticks in — a moment no eighth-note grid can write.
 */
const intro: Bar[] = [
  bar(8, { rhythm: RIFF(8), lead: at(8, { 0: note("E4", 5, 0) }), drums: BEAT(8) }),
  bar(8, { drums: BEAT(8) }),
  bar(12, {
    rhythm: at(12, { 0: note("E2", 0, 0), 1: note("F2", 0, 1), 6: note("G2", 0, 3) }),
    drums: BEAT(12),
  }),
  bar(8, {
    rhythm: at(8, { 0: note("B2", 1, 2), 4: note("D3", 2, 0) }),
    drums: BEAT(8),
  }),
  bar(8, { drums: BEAT(8) }),
];

/*
 * Nakarat — where the chains live.
 *
 * Bar 2's last eighth is held into bar 3, so a one-bar selection there has to
 * widen. Bar 4 is struck and held out of the section entirely, which is the
 * case this version refuses rather than guesses at.
 */
const chorus: Bar[] = [
  bar(8, { rhythm: RIFF(8), lead: at(8, { 0: note("G4", 3, 12) }), drums: BEAT(8) }),
  bar(8, {
    rhythm: at(8, { 0: note("A2", 1, 0), 7: note("C3", 1, 3) }),
    drums: BEAT(8),
  }),
  bar(8, {
    rhythm: [tie, rest, rest, rest, note("D3", 2, 0), rest, rest, rest],
    drums: BEAT(8),
  }),
  bar(8, {
    rhythm: [note("E3", 2, 2), tie, tie, tie, tie, tie, tie, tie],
    drums: BEAT(8),
  }),
];

/* Çıkış — opens on the note Nakarat is still holding. */
const outro: Bar[] = [
  bar(8, {
    rhythm: [tie, tie, rest, rest, rest, rest, rest, rest],
    lead: at(8, { 4: note("B4", 5, 7) }),
    drums: BEAT(8),
  }),
  bar(8, { rhythm: RIFF(8), drums: BEAT(8) }),
];

const song: Song = {
  version: 2,
  title: "Ölçü İşlemleri Fikstürü",
  bpm: 120,
  key: "E minor",
  tracks,
  sections: [
    { id: "intro", name: "Giriş", status: "fixed", bars: intro },
    { id: "chorus", name: "Nakarat", status: "fixed", bars: chorus },
    { id: "outro", name: "Çıkış", status: "fixed", bars: outro },
  ],
};

const parsed = songSchema.parse(song);
writeFileSync(
  "eval/bar-ops/fixture-song.json",
  `${JSON.stringify(parsed)}\n`,
  "utf8",
);
console.log(
  `bars: ${parsed.sections.reduce((total, section) => total + section.bars.length, 0)}`,
);
