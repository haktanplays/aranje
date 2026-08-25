/**
 * Writing one event, whatever the instrument is (2Q-B §3, §4, §6).
 *
 * The tab's `applyEdit` writes a fret on a string, which is the right shape
 * for a guitar and the wrong shape for everything else: a kit has no strings
 * and a piano has no fretboard, so both were readable and neither was
 * writable. This module is the second half of that sentence — the commands a
 * drum lane and a pitched lane need — and it is deliberately *one* module so
 * the tab and the multi view cannot grow two answers to the same question.
 *
 * ## The target is a moment, not a slot index
 *
 * A slot index means nothing without the bar it belongs to: slot 6 is an
 * eighth note in one bar and a sixteenth in the next. So a target names a
 * **tick inside a section** and the bar and slot are found from it. Nothing
 * is rounded: a tick that does not land exactly on the target bar's grid is
 * refused, because a "helpful" nudge writes music the reader did not play.
 *
 * ## One candidate, one settle
 *
 * Every command builds a whole candidate song and hands it to `settle` — the
 * same schema-then-validators gate the tab uses. A refused candidate is
 * thrown away entire, so a lane materialised on the way to a refusal never
 * reaches the reader's song. That is what makes "one write, one undo" true
 * rather than aspirational.
 */
import { isDrumInstrument, DRUM_PIECES, type DrumPiece } from "@/lib/instruments/registry";
import { ticksPerSlot, slotCount } from "@/lib/music/timing";
import { PITCH_PATTERN } from "@/lib/music/pitch";
import { settle } from "@/lib/song/edit";
import { withEmptyLaneInBar } from "@/lib/song/track-lanes";
import type {
  Bar,
  DrumHit,
  DrumSlot,
  MelodicSlot,
  NoteEvent,
  Song,
  Track,
} from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/** A moment inside one section, on one track. */
export type EventEntryTarget = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Ticks from the **start of the section**. Never rounded. */
  readonly ticks: number;
};

export type EventEntryErrorCode =
  | "section_not_found"
  | "bar_not_found"
  | "track_not_found"
  | "track_not_drums"
  | "track_not_pitched"
  | "unknown_drum_piece"
  | "off_grid_target"
  | "target_occupied"
  | "nothing_to_remove"
  | "pitch_unreadable"
  | "instrument_range_unavailable"
  | "validation_failed";

export type EventEntryResult =
  | { readonly ok: true; readonly song: Song; readonly warnings: ValidationIssue[] }
  | { readonly ok: false; readonly code: EventEntryErrorCode };

const refuse = (code: EventEntryErrorCode): EventEntryResult => ({ ok: false, code });

/** Where a moment lands, once the bars have been counted. */
type Landing = {
  readonly sectionIndex: number;
  readonly barIndex: number;
  readonly slotIndex: number;
  readonly bar: Bar;
  readonly track: Track;
};

/**
 * Find the bar and slot a tick names, or say why it does not name one.
 *
 * Exported because the UI needs the same arithmetic to draw a cell, and two
 * copies of "which slot is this" is how a band ends up a pixel — or a beat —
 * away from the note it belongs to.
 */
export function landOn(song: Song, target: EventEntryTarget): Landing | EventEntryErrorCode {
  const sectionIndex = song.sections.findIndex((entry) => entry.id === target.sectionId);
  const section = song.sections[sectionIndex];
  if (!section) return "section_not_found";

  const track = song.tracks.find((entry) => entry.id === target.trackId);
  if (!track) return "track_not_found";

  if (!Number.isInteger(target.ticks) || target.ticks < 0) return "off_grid_target";

  let start = 0;
  for (const [barIndex, bar] of section.bars.entries()) {
    const perSlot = ticksPerSlot(bar.resolution);
    const count = slotCount(bar.timeSignature, bar.resolution);
    const duration = perSlot * count;
    if (target.ticks < start + duration) {
      const inside = target.ticks - start;
      if (inside % perSlot !== 0) return "off_grid_target";
      return { sectionIndex, barIndex, slotIndex: inside / perSlot, bar, track };
    }
    start += duration;
  }
  return "bar_not_found";
}

const landed = (value: Landing | EventEntryErrorCode): value is Landing =>
  typeof value !== "string";

/** The song with one bar's lane replaced. Nothing else is touched. */
function withLane(
  song: Song,
  at: Landing,
  lane: readonly MelodicSlot[] | readonly DrumSlot[],
): Song {
  const sections = [...song.sections];
  const section = sections[at.sectionIndex]!;
  const bars = [...section.bars];
  bars[at.barIndex] = {
    ...at.bar,
    slots: { ...at.bar.slots, [at.track.id]: lane as Bar["slots"][string] },
  };
  sections[at.sectionIndex] = { ...section, bars };
  return { ...song, sections };
}

/**
 * The lane this command will write into, laid if the track is not written in
 * this bar yet (K-55).
 *
 * Materialising happens inside the candidate, never as a separate write.
 */
function laneFor(song: Song, at: Landing): { song: Song; lane: readonly unknown[] } {
  const ready = withEmptyLaneInBar(song, at.track, song.sections[at.sectionIndex]!.id, at.barIndex);
  const bar = ready.sections[at.sectionIndex]!.bars[at.barIndex]!;
  return { song: ready, lane: (bar.slots[at.track.id] ?? []) as readonly unknown[] };
}

/* ------------------------------------------------------------------ drums */

export type DrumHitInput = {
  readonly piece: DrumPiece;
  readonly velocity?: number;
  readonly articulation?: DrumHit["articulation"];
};

/**
 * Add one hit.
 *
 * Several pieces may share a tick — that is what a backbeat *is* — but the
 * same piece twice at one tick is not a louder hit, it is one hit and one
 * inaudible duplicate, so it is refused rather than written.
 */
export function insertDrumHit(
  song: Song,
  target: EventEntryTarget,
  hit: DrumHitInput,
): EventEntryResult {
  const at = landOn(song, target);
  if (!landed(at)) return refuse(at);
  if (!isDrumInstrument(at.track.instrumentId)) return refuse("track_not_drums");
  if (!DRUM_PIECES.includes(hit.piece)) return refuse("unknown_drum_piece");

  const ready = laneFor(song, at);
  const lane = ready.lane as readonly DrumSlot[];
  const slot = lane[at.slotIndex];
  if (!Array.isArray(slot)) return refuse("off_grid_target");
  if (slot.some((existing) => existing.piece === hit.piece)) return refuse("target_occupied");

  const written: DrumHit = {
    piece: hit.piece,
    ...(hit.velocity === undefined ? {} : { velocity: hit.velocity }),
    ...(hit.articulation === undefined ? {} : { articulation: hit.articulation }),
  };
  const next = [...lane];
  next[at.slotIndex] = orderHits([...slot, written]);
  return finish(withLane(ready.song, at, next));
}

/**
 * Take one hit away, and only that one.
 *
 * The lane stays behind. An emptied slot is a rest the track is still written
 * in; dropping the key would say "not written here" and make the lane
 * unwritable again (K-55).
 */
export function removeDrumHit(
  song: Song,
  target: EventEntryTarget,
  piece: DrumPiece,
): EventEntryResult {
  const at = landOn(song, target);
  if (!landed(at)) return refuse(at);
  if (!isDrumInstrument(at.track.instrumentId)) return refuse("track_not_drums");

  const lane = at.bar.slots[at.track.id] as readonly DrumSlot[] | undefined;
  const slot = lane?.[at.slotIndex];
  if (!lane || !Array.isArray(slot)) return refuse("nothing_to_remove");
  if (!slot.some((hit) => hit.piece === piece)) return refuse("nothing_to_remove");

  const next = [...lane];
  next[at.slotIndex] = slot.filter((hit) => hit.piece !== piece);
  return finish(withLane(song, at, next));
}

/**
 * Hits in kit order, always.
 *
 * Two songs that hold the same music must serialise the same way, or a
 * fingerprint and a byte-equality test both start reporting differences that
 * are not differences.
 */
function orderHits(hits: readonly DrumHit[]): DrumHit[] {
  return [...hits].sort(
    (left, right) => DRUM_PIECES.indexOf(left.piece) - DRUM_PIECES.indexOf(right.piece),
  );
}

/* ---------------------------------------------------------------- pitched */

/** Whether this track's notes are pitches and nothing else. */
export function isPitchedTrack(track: Track): boolean {
  return !isDrumInstrument(track.instrumentId) && track.fretboard === undefined;
}

export type PitchedNoteInput = {
  readonly pitch: string;
  readonly velocity?: number;
  /** How many of the target bar's slots the note holds. One by default. */
  readonly slots?: number;
};

/**
 * Write one note on a fretless instrument.
 *
 * No `position` is written, ever: there is no string for one to mean
 * anything on. Length is expressed the way the contract already expresses it
 * — the onset, then a tie for each slot it holds — so nothing new has to
 * learn how long a note is.
 */
export function insertPitchedNote(
  song: Song,
  target: EventEntryTarget,
  note: PitchedNoteInput,
  options: { readonly replace?: boolean } = {},
): EventEntryResult {
  const at = landOn(song, target);
  if (!landed(at)) return refuse(at);
  if (!isPitchedTrack(at.track)) return refuse("track_not_pitched");
  if (!PITCH_PATTERN.test(note.pitch)) return refuse("pitch_unreadable");

  const ready = laneFor(song, at);
  const lane = ready.lane as readonly MelodicSlot[];
  const held = Math.max(1, Math.trunc(note.slots ?? 1));
  if (at.slotIndex + held > lane.length) return refuse("off_grid_target");

  const existing = lane[at.slotIndex];
  const occupied = existing !== null && existing !== undefined;
  if (occupied && options.replace !== true) return refuse("target_occupied");

  const event: NoteEvent = {
    pitch: note.pitch,
    ...(note.velocity === undefined ? {} : { velocity: note.velocity }),
  };
  const next = [...lane];
  next[at.slotIndex] = { notes: [event] };
  for (let step = 1; step < held; step += 1) next[at.slotIndex + step] = "-";
  return finish(withLane(ready.song, at, next));
}

/**
 * Take a pitched onset away.
 *
 * The ties that were holding it go too — a tie with nothing before it is not
 * music, it is an orphan the validators refuse — and the lane stays written.
 */
export function removePitchedNote(
  song: Song,
  target: EventEntryTarget,
): EventEntryResult {
  const at = landOn(song, target);
  if (!landed(at)) return refuse(at);
  if (!isPitchedTrack(at.track)) return refuse("track_not_pitched");

  const lane = at.bar.slots[at.track.id] as readonly MelodicSlot[] | undefined;
  const slot = lane?.[at.slotIndex];
  if (!lane || slot === null || slot === undefined || slot === "-") {
    return refuse("nothing_to_remove");
  }

  const next = [...lane];
  next[at.slotIndex] = null;
  for (let index = at.slotIndex + 1; index < next.length && next[index] === "-"; index += 1) {
    next[index] = null;
  }
  return finish(withLane(song, at, next));
}

/* ----------------------------------------------------------------- settle */

/**
 * The one gate. Schema, then the whole validator chain; errors block and
 * warnings ride along to the caller.
 */
function finish(candidate: Song): EventEntryResult {
  const settled = settle(candidate);
  return settled.ok
    ? { ok: true, song: settled.song, warnings: settled.warnings }
    : refuse("validation_failed");
}
