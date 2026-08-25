/**
 * A fretless track as a strip you can tap (2Q-B §7.1).
 *
 * The drum grid has a row per piece because a kit has a fixed, small set of
 * things to hit. A melodic instrument does not: its "rows" would be its
 * pitch range, and this app does not know any instrument's range (there is no
 * range in the registry, and inventing one would put notes on screen that the
 * instrument may not be able to play). So a pitched track is **one row of
 * moments**, and which pitch goes in a moment is asked, not guessed.
 *
 * That is a smaller surface than a piano roll on purpose. It answers "when
 * does this instrument play, and what does it play there", which is the
 * question the reader is actually holding when they tap.
 *
 * ## The four states of a moment
 *
 * They are the contract's own, not a new vocabulary:
 *
 * - `note`   — an onset: the slot holds `{ notes: [...] }`
 * - `tie`    — `"-"`, the note before it still sounding
 * - `rest`   — `null`, written silence
 * - `blank`  — the track has no lane in this bar at all: not written here,
 *              which is a different fact from "silent here" (K-55)
 *
 * A blank moment is tappable exactly like a rest. The lane is laid inside the
 * write's own candidate, so the reader never has to "prepare" a bar first.
 */
import { parsePitch } from "@/lib/music/pitch";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import type { MelodicSlot, Song, TimeSignature } from "@/lib/song/schema";

export type PitchedStepState = "note" | "tie" | "rest" | "blank";

export type PitchedStepCell = {
  /** Ticks from the start of the section — what an entry command wants. */
  readonly ticks: number;
  readonly barKey: string;
  readonly barIndex: number;
  readonly slotIndex: number;
  readonly state: PitchedStepState;
  /** The pitches sounding at this onset, in the order the song stores them. */
  readonly pitches: readonly string[];
};

export type PitchedStepBar = {
  readonly key: string;
  readonly barIndex: number;
  readonly barNumber: number;
  readonly slotCount: number;
  readonly timeSignature: TimeSignature;
  readonly resolution: number;
  readonly startTicks: number;
};

export type PitchedStepModel = {
  readonly trackId: string;
  readonly sectionId: string;
  readonly bars: readonly PitchedStepBar[];
  readonly cells: readonly PitchedStepCell[];
  /** True when this track is not written in a single bar of this section. */
  readonly silentThroughout: boolean;
};

function stateOf(slot: MelodicSlot | undefined, written: boolean): PitchedStepState {
  if (!written || slot === undefined) return "blank";
  if (slot === "-") return "tie";
  if (slot === null) return "rest";
  return "note";
}

export function buildPitchedStepModel(
  song: Song,
  sectionId: string,
  trackId: string,
): PitchedStepModel {
  const section =
    song.sections.find((entry) => entry.id === sectionId) ?? song.sections[0];
  const resolvedId = section?.id ?? sectionId;

  let barNumber = 0;
  for (const entry of song.sections) {
    if (entry.id === resolvedId) break;
    barNumber += entry.bars.length;
  }

  const bars: PitchedStepBar[] = [];
  const cells: PitchedStepCell[] = [];
  let startTicks = 0;

  for (const [barIndex, bar] of (section?.bars ?? []).entries()) {
    const count = slotCount(bar.timeSignature, bar.resolution);
    const perSlot = ticksPerSlot(bar.resolution);
    const key = `${resolvedId}:${barIndex}`;
    bars.push({
      key,
      barIndex,
      barNumber: barNumber + barIndex + 1,
      slotCount: count,
      timeSignature: bar.timeSignature,
      resolution: bar.resolution,
      startTicks,
    });

    const written = Object.prototype.hasOwnProperty.call(bar.slots, trackId);
    const lane = bar.slots[trackId];
    for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
      const slot = Array.isArray(lane) ? (lane[slotIndex] as MelodicSlot | undefined) : undefined;
      const state = stateOf(slot, written);
      cells.push({
        ticks: startTicks + slotIndex * perSlot,
        barKey: key,
        barIndex,
        slotIndex,
        state,
        pitches:
          state === "note" && slot !== null && slot !== undefined && slot !== "-"
            ? slot.notes.map((note) => note.pitch)
            : [],
      });
    }
    startTicks += count * perSlot;
  }

  return {
    trackId,
    sectionId: resolvedId,
    bars,
    cells,
    silentThroughout: (section?.bars ?? []).every(
      (bar) => !Object.prototype.hasOwnProperty.call(bar.slots, trackId),
    ),
  };
}

/**
 * The octave the sheet should open on for this track.
 *
 * It is read from the music, never from a guess about the instrument: the
 * last onset already written on this track wins, then any onset on any
 * fretless track, and only when the song has no melodic material at all does
 * it fall back to 4 — which is the Song Contract's middle octave, offered as
 * a starting point for the reader's own stepper and never presented as the
 * instrument's range.
 */
export function suggestedOctave(song: Song, trackId: string): number {
  const fromTrack = lastOctave(song, trackId);
  if (fromTrack !== null) return fromTrack;
  for (const track of song.tracks) {
    const octave = lastOctave(song, track.id);
    if (octave !== null) return octave;
  }
  return 4;
}

function lastOctave(song: Song, trackId: string): number | null {
  let found: number | null = null;
  for (const section of song.sections) {
    for (const bar of section.bars) {
      const lane = bar.slots[trackId];
      if (!Array.isArray(lane)) continue;
      for (const slot of lane as readonly MelodicSlot[]) {
        if (slot === null || slot === "-" || slot === undefined) continue;
        const pitch = slot.notes[0]?.pitch;
        if (pitch === undefined) continue;
        const parsed = parsePitch(pitch);
        if (parsed) found = parsed.octave;
      }
    }
  }
  return found;
}
