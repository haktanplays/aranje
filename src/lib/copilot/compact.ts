/**
 * The compact transport format (spec 11.5), narrowed to one section and to
 * what a given skill actually needs (decision K-18).
 *
 * "Modele ham Song JSON gönderilmez." The canonical model stays detailed; what
 * travels is one line per track, in the shape spec 11.5 prints:
 *
 *   gtr: E2 E2 . G2 - - A2 G2
 *   drm: K+H H S+H H K+H H S+H H
 *
 * Read against that example: `.` is a rest, `-` continues the previous event,
 * `+` stacks simultaneous events, and everything else is a written pitch or a
 * drum letter.
 *
 * What the format drops, deliberately: written positions, because spec 11.1
 * keeps placement with the deterministic engine, and any track the skill has
 * no business reading. A `drums` request is not shown the bass line.
 */
import { instrumentFamily } from "@/lib/instruments/registry";
import {
  isTripletGrid,
  resolutionPromptLabel,
  slotCount,
  slotsPerNotatedBeat,
} from "@/lib/music/timing";
import type {
  DrumPiece,
  DrumSlot,
  MelodicSlot,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";

/**
 * One letter per drum piece. Spec 11.5's example fixes K, S and H; the rest
 * follow the same initial-letter scheme, with the toms numbered high to low
 * because their initials collide.
 */
export const DRUM_LETTERS: Readonly<Record<DrumPiece, string>> = {
  kick: "K",
  snare: "S",
  closed_hat: "H",
  open_hat: "O",
  ride: "R",
  crash: "C",
  china: "N",
  tom_high: "T1",
  tom_mid: "T2",
  tom_floor: "T3",
};

const REST = ".";
const TIE = "-";

function melodicToken(slot: MelodicSlot): string {
  if (slot === null) return REST;
  if (slot === "-") return TIE;
  return slot.notes.map((note) => note.pitch).join("+");
}

function drumToken(slot: DrumSlot): string {
  if (slot.length === 0) return REST;
  return slot.map((hit) => DRUM_LETTERS[hit.piece]).join("+");
}

/** The pitches and rhythm of one track through a section, bar by bar. */
export function trackLines(section: Section, trackId: string): string[] {
  return section.bars.map((bar, index) => {
    const slots = bar.slots[trackId];
    // A track with no key in the bar is silent there (spec 5.5).
    if (slots === undefined) return `bar ${index + 1}: -sus-`;
    const tokens = slots.map((slot) =>
      Array.isArray(slot) ? drumToken(slot) : melodicToken(slot),
    );
    return `bar ${index + 1}: ${tokens.join(" ")}`;
  });
}

/**
 * Where the notes fall, without saying which notes they are. This is what a
 * drum skill needs: onsets, held notes, rests and accents, and nothing about
 * pitch it has no use for.
 */
export function rhythmLines(section: Section, trackId: string): string[] {
  return section.bars.map((bar, index) => {
    const slots = bar.slots[trackId];
    if (slots === undefined) return `bar ${index + 1}: -sus-`;

    const tokens = slots.map((slot) => {
      if (Array.isArray(slot)) return slot.length === 0 ? REST : "x";
      if (slot === null) return REST;
      if (slot === "-") return TIE;
      const accented = slot.notes.some(
        (note) => note.articulation === "accent" || (note.velocity ?? 0) >= 100,
      );
      return accented ? "X" : "x";
    });
    return `bar ${index + 1}: ${tokens.join(" ")}`;
  });
}

/**
 * Bar shapes of the section: what the answer must match slot for slot.
 *
 * Every bar states its own grid, because bars in one section no longer share
 * one (spec 5.5, K-34). A triplet grid is named as a triplet — "1/8 ucleme",
 * never "1/12" — so a bar of twelve slots cannot be read as a slightly denser
 * straight bar, and the slot count is spelled out next to it either way.
 */
export function barShapeLines(section: Section): string[] {
  return section.bars.map((bar, index) => {
    const count = slotCount(bar.timeSignature, bar.resolution);
    const grid = resolutionPromptLabel(bar.resolution);
    const triplet = isTripletGrid(bar.resolution)
      ? ` (uclu bolme: ${slotsPerNotatedBeat(bar.timeSignature, bar.resolution)} slot = 1 vurus)`
      : "";
    return (
      `bar ${index + 1}: ${bar.timeSignature[0]}/${bar.timeSignature[1]} ` +
      `${grid} ${count} slot${triplet}`
    );
  });
}

/** How the target track is tuned, when that changes what can be written. */
export function tuningLine(track: Track): string | null {
  if (!track.fretboard) return null;
  return `akort: ${track.fretboard.tuning.join(" ")} capo ${track.fretboard.capo}`;
}

/**
 * The guitar a bass or harmony part is written against: the first guitar-family
 * track in the song that is not the target itself.
 */
export function primaryGuitar(song: Song, targetTrackId: string): Track | undefined {
  return song.tracks.find(
    (track) =>
      track.id !== targetTrackId &&
      instrumentFamily(track.instrumentId) === "guitar",
  );
}

/** The first drum track, for a skill that needs to hear the groove. */
export function primaryDrums(song: Song, targetTrackId: string): Track | undefined {
  return song.tracks.find(
    (track) =>
      track.id !== targetTrackId &&
      instrumentFamily(track.instrumentId) === "drums",
  );
}
