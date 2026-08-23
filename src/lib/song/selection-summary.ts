/**
 * What a selection is, said in words a musician uses (spec 13.1).
 *
 * Pure, and the only place a selection is turned into prose. Ticks, slot
 * indices and durations are how the core thinks; "1 akor · 2 ölçü" is how a
 * player thinks. Keeping the translation here means the screen never has to
 * reach for `startTicks` to describe itself, and the same selection is
 * described the same way wherever it appears.
 */
import { sectionSlotStream } from "@/lib/song/onset-block";
import { ticksPerBar } from "@/lib/music/timing";
import type { Section, Song } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

export type SelectionSummary = {
  /** Struck onsets inside the range. Ties are part of their onset, not extra. */
  readonly onsetCount: number;
  /** Onsets carrying more than one note. */
  readonly chordCount: number;
  /** Individual notes, counting every string of every chord. */
  readonly noteCount: number;
  /** How many bars the range touches, whole or partial. */
  readonly barCount: number;
  /** True when the range covers a root, a fifth and an octave struck together. */
  readonly looksLikePowerChord: boolean;
  /** The whole thing, ready to read. */
  readonly text: string;
};

/**
 * Whether one onset's notes are a root, a fifth and an octave.
 *
 * A UI label only. It creates no persistent chord type and is not a second
 * source of musical analysis — it reads the intervals already in the notes and
 * says what they look like.
 */
export function looksLikePowerChord(midis: readonly number[]): boolean {
  if (midis.length < 2 || midis.length > 3) return false;
  const sorted = [...midis].sort((a, b) => a - b);
  const root = sorted[0];
  if (root === undefined) return false;
  const intervals = sorted.slice(1).map((midi) => midi - root);
  if (intervals.length === 1) return intervals[0] === 7;
  return intervals[0] === 7 && intervals[1] === 12;
}

const plural = (count: number, word: string) => `${count} ${word}`;

export function summariseSelection(
  song: Song,
  selection: TimeSelection,
): SelectionSummary {
  const section: Section | undefined = song.sections.find(
    (entry) => entry.id === selection.sectionId,
  );
  const empty: SelectionSummary = {
    onsetCount: 0,
    chordCount: 0,
    noteCount: 0,
    barCount: 0,
    looksLikePowerChord: false,
    text: "Seçim yok",
  };
  if (!section) return empty;

  const stream = sectionSlotStream(section, selection.trackId);
  let onsetCount = 0;
  let chordCount = 0;
  let noteCount = 0;
  let power = false;
  const bars = new Set<number>();

  for (const entry of stream) {
    if (entry.startTicks < selection.startTicks) continue;
    if (entry.startTicks >= selection.endTicks) break;
    bars.add(entry.barIndex);
    if (!entry.writable || entry.slot === null || entry.slot === undefined) continue;
    if (entry.slot === "-") continue;

    const notes = entry.slot.notes;
    onsetCount += 1;
    noteCount += notes.length;
    if (notes.length > 1) chordCount += 1;
    if (onsetCount === 1 && notes.length > 1) {
      power = looksLikePowerChord(
        notes.map((note) => midiOf(note.pitch)).filter((midi): midi is number => midi !== null),
      );
    }
  }

  // A range that covers time but no notes still covers bars, and saying so is
  // more use than "0 nota".
  const barCount = bars.size > 0 ? bars.size : coveredBars(section, selection);

  /*
   * One onset is described as the thing it is, and by how many notes it holds
   * (spec 13.20 §1). "1 power chord · 2 nota" is what a reader can check
   * against their own finger; "6 nota · 2 ölçü · zincir tamamlandı" — what
   * this said before — described something they never asked for.
   *
   * The bar count is added to a single onset only when it really spans more
   * than one, which happens when a tie carries the note over a bar line.
   * Printing "· 1 ölçü" after every chord is noise; leaving it out when the
   * note genuinely crosses a line would be a small lie.
   */
  const parts: string[] = [];
  if (onsetCount === 0) {
    parts.push("Boş seçim");
    parts.push(plural(barCount, "ölçü"));
  } else if (onsetCount === 1) {
    if (noteCount === 1) {
      parts.push("1 nota");
    } else {
      parts.push(power ? "1 power chord" : "1 akor");
      parts.push(plural(noteCount, "nota"));
    }
    if (barCount > 1) parts.push(plural(barCount, "ölçü"));
  } else {
    parts.push(plural(noteCount, "nota"));
    parts.push(plural(barCount, "ölçü"));
  }

  return {
    onsetCount,
    chordCount,
    noteCount,
    barCount,
    looksLikePowerChord: power,
    text: parts.join(" · "),
  };
}

/** Bars a range spans even when it holds no notes. */
function coveredBars(section: Section, selection: TimeSelection): number {
  let ticks = 0;
  let count = 0;
  for (const bar of section.bars) {
    const width = ticksPerBar(bar.timeSignature, bar.resolution);
    const overlaps = ticks < selection.endTicks && ticks + width > selection.startTicks;
    if (overlaps) count += 1;
    ticks += width;
  }
  return count;
}

/** MIDI of a written pitch, or null. Kept local so this module stays pure. */
function midiOf(pitch: string): number | null {
  const match = /^([A-G])(#|b)?(-1|[0-9])$/.exec(pitch);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const semitone = base[letter ?? ""];
  if (semitone === undefined || octave === undefined) return null;
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octave) + 1) * 12 + semitone + shift;
}
