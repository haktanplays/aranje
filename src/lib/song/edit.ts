/**
 * The riff editor's core (spec 5.4, 9.1, 10).
 *
 * Pure, and independent of the screen: it takes a song and a command and
 * returns a new song. Nothing here knows about React, about touch targets, or
 * about which row of the tab a string is drawn on.
 *
 * Three things this file refuses to do, each for a reason:
 *
 * - **It never takes a pitch from the caller.** A pitch is derived from the
 *   track's own tuning, its capo and the string and fret the musician touched
 *   (spec 9.1). Letting the UI pass a pitch would let the tab and the sound
 *   disagree.
 * - **It never invents a limit.** The highest writable fret comes from the
 *   fretboard module, so a capo shrinks the range in one place and everything
 *   follows.
 * - **It never mutates the song it is given.** Every command returns a new
 *   song, and a command that fails returns no song at all — so a caller that
 *   forgets to check cannot write a broken state to storage.
 *
 * `stringIndex` keeps its data meaning throughout: 0 is the thickest string.
 * The top-to-bottom order the tab draws is a render-only transform and stays
 * where it already lives.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import {
  maxCapoRelativeFret,
  soundingMidi,
  type Fretboard,
} from "@/lib/music/fretboard";
import { midiToPitch } from "@/lib/music/pitch";
import { slotCount } from "@/lib/music/timing";
import {
  songSchema,
  type Articulation,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type Track,
} from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import {
  errorsOnly,
  warningsOnly,
  type ValidationIssue,
} from "@/lib/validators/types";

export type EditTarget = {
  sectionId: string;
  trackId: string;
  /** Index inside the section, matching the validator issue path. */
  barIndex: number;
  slotIndex: number;
};

export type EditCommand =
  /** Write or replace the note on one string of one slot. */
  | {
      kind: "set_note";
      target: EditTarget;
      stringIndex: number;
      /** Capo-relative: 0 is the sound the capo is holding (spec 9.1). */
      fret: number;
      velocity?: number;
      articulation?: Articulation;
    }
  /** Remove one string's note, keeping the rest of the chord. */
  | { kind: "clear_string"; target: EditTarget; stringIndex: number }
  /** Make the slot silent. */
  | { kind: "set_rest"; target: EditTarget }
  /** Continue whatever was already sounding (spec 5.4). */
  | { kind: "set_tie"; target: EditTarget }
  /**
   * How one string of one slot is played (spec 8.5, 13.9).
   *
   * `null` is "normal": the field is removed rather than written as a value,
   * so a song that was never given an articulation and one that was set back
   * to normal are the same song.
   */
  | {
      kind: "set_articulation";
      target: EditTarget;
      stringIndex: number;
      articulation: Articulation | null;
    };

export type EditErrorCode =
  | "section_not_found"
  | "bar_not_found"
  | "slot_out_of_range"
  | "track_not_found"
  | "track_not_editable"
  | "track_silent_here"
  | "string_out_of_range"
  | "fret_out_of_range"
  | "pitch_unreadable"
  | "no_note_on_string"
  | "orphan_tie"
  | "validation_failed";

export type EditFailure = {
  code: EditErrorCode;
  /** Reader-facing, and specific enough to act on. */
  message: string;
  /** Set when the failure came from the validator chain. */
  issues?: ValidationIssue[];
};

export type EditResult =
  | { ok: true; song: Song; warnings: ValidationIssue[] }
  | { ok: false; error: EditFailure };

function fail(code: EditErrorCode, message: string, issues?: ValidationIssue[]): EditResult {
  return { ok: false, error: issues ? { code, message, issues } : { code, message } };
}

/** The tab is written on a fretboard; drums and keyboards are not editable here. */
export function isEditableTrack(track: Track): boolean {
  return !isDrumInstrument(track.instrumentId) && track.fretboard !== undefined;
}

/**
 * The sound of a string and a capo-relative fret on this fretboard, or null
 * when the position does not exist. This is the only place a pitch is made.
 */
export function pitchAt(
  fretboard: Fretboard,
  stringIndex: number,
  fret: number,
): string | null {
  const midi = soundingMidi(fretboard, { string: stringIndex, fret });
  return midi === null ? null : midiToPitch(midi);
}

/**
 * One melodic slot of one track, in playing order across the whole song.
 * A bar the track is not written in contributes a single `absent` entry, which
 * is what breaks a tie chain (spec 5.5).
 */
type StreamEntry =
  | { kind: "slot"; sectionIndex: number; barIndex: number; slotIndex: number; slot: MelodicSlot }
  | { kind: "absent"; sectionIndex: number; barIndex: number };

function melodicStream(song: Song, trackId: string): StreamEntry[] {
  const stream: StreamEntry[] = [];

  song.sections.forEach((section, sectionIndex) => {
    section.bars.forEach((bar, barIndex) => {
      const slots = bar.slots[trackId];
      if (slots === undefined) {
        stream.push({ kind: "absent", sectionIndex, barIndex });
        return;
      }
      slots.forEach((slot, slotIndex) => {
        if (Array.isArray(slot)) return; // a drum slot: not this track's shape
        stream.push({ kind: "slot", sectionIndex, barIndex, slotIndex, slot });
      });
    });
  });

  return stream;
}

function indexOfTarget(
  stream: readonly StreamEntry[],
  sectionIndex: number,
  target: EditTarget,
): number {
  return stream.findIndex(
    (entry) =>
      entry.kind === "slot" &&
      entry.sectionIndex === sectionIndex &&
      entry.barIndex === target.barIndex &&
      entry.slotIndex === target.slotIndex,
  );
}

/**
 * Is something already sounding when this slot begins?
 *
 * Walks back through ties exactly as the voice counter and the tab timeline do
 * (spec 6): a run of `-` continues until it reaches a struck note, and a rest
 * or a bar the track is not written in ends the chain.
 */
function soundingBefore(stream: readonly StreamEntry[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = stream[cursor];
    if (!entry || entry.kind === "absent") return false;
    if (entry.slot === null) return false;
    if (entry.slot === "-") continue;
    return true;
  }
  return false;
}

/** A `-` with nothing left in front of it is not music; it is a dangling tie. */
function trailingTies(stream: readonly StreamEntry[], index: number): StreamEntry[] {
  const orphans: StreamEntry[] = [];
  for (let cursor = index + 1; cursor < stream.length; cursor += 1) {
    const entry = stream[cursor];
    if (!entry || entry.kind === "absent") break;
    if (entry.slot !== "-") break;
    orphans.push(entry);
  }
  return orphans;
}

/** Song data is plain JSON, so a structural clone is exact and cheap enough. */
function cloneSong(song: Song): Song {
  return structuredClone(song);
}

function writeSlot(
  song: Song,
  sectionIndex: number,
  barIndex: number,
  trackId: string,
  slotIndex: number,
  slot: MelodicSlot,
): void {
  const slots = song.sections[sectionIndex]?.bars[barIndex]?.slots[trackId];
  if (!Array.isArray(slots)) return;
  (slots as MelodicSlot[])[slotIndex] = slot;
}

type Resolved = {
  sectionIndex: number;
  track: Track;
  fretboard: Fretboard;
  slots: readonly MelodicSlot[];
  slot: MelodicSlot;
};

function resolve(song: Song, target: EditTarget): Resolved | EditResult {
  const sectionIndex = song.sections.findIndex(
    (section) => section.id === target.sectionId,
  );
  const section = song.sections[sectionIndex];
  if (!section) {
    return fail("section_not_found", `"${target.sectionId}" bölümü şarkıda yok.`);
  }

  const track = song.tracks.find((entry) => entry.id === target.trackId);
  if (!track) {
    return fail("track_not_found", `"${target.trackId}" track'i şarkıda yok.`);
  }
  if (!isEditableTrack(track) || !track.fretboard) {
    return fail(
      "track_not_editable",
      `"${track.name}" bu ekrandan düzenlenemiyor. Şimdilik yalnız akordu ` +
        `olan telli track'ler düzenlenebiliyor.`,
    );
  }

  const bar = section.bars[target.barIndex];
  if (!bar) {
    return fail(
      "bar_not_found",
      `"${section.name}" bölümünde ${target.barIndex + 1}. bar yok.`,
    );
  }

  const slots = bar.slots[target.trackId];
  if (slots === undefined) {
    return fail(
      "track_silent_here",
      `"${track.name}" bu barda yazılı değil; önce bu bara eklenmeli.`,
    );
  }
  if (target.slotIndex < 0 || target.slotIndex >= slots.length) {
    return fail(
      "slot_out_of_range",
      `Bu bar ${slotCount(bar.timeSignature, bar.resolution)} slot taşıyor; ` +
        `${target.slotIndex + 1}. slot yok.`,
    );
  }

  const slot = slots[target.slotIndex];
  if (Array.isArray(slot)) {
    return fail(
      "track_not_editable",
      `"${track.name}" bu barda davul verisi taşıyor.`,
    );
  }

  return {
    sectionIndex,
    track,
    fretboard: track.fretboard,
    slots: slots as readonly MelodicSlot[],
    slot: slot ?? null,
  };
}

function isResolved(value: Resolved | EditResult): value is Resolved {
  return !("ok" in value);
}

/**
 * Run the finished song past the schema and the whole validator chain.
 *
 * Exported because every editing command settles the same way: schema first,
 * then the validators, errors block and warnings ride along. A second copy of
 * this would be a second definition of "did the edit hold".
 */
export function settle(next: Song): EditResult {
  const parsed = songSchema.safeParse(next);
  if (!parsed.success) {
    return fail(
      "validation_failed",
      "Düzenleme şarkı şemasına uymadı ve uygulanmadı.",
    );
  }

  const issues = runValidators(parsed.data);
  const errors = errorsOnly(issues);
  if (errors.length > 0) {
    return fail(
      "validation_failed",
      errors[0]?.message ?? "Düzenleme kontrollerden geçmedi.",
      errors,
    );
  }

  return { ok: true, song: parsed.data, warnings: warningsOnly(issues) };
}

export function applyEdit(song: Song, command: EditCommand): EditResult {
  const resolved = resolve(song, command.target);
  if (!isResolved(resolved)) return resolved;

  const { sectionIndex, fretboard, slot } = resolved;
  const { target } = command;
  const stream = melodicStream(song, target.trackId);
  const index = indexOfTarget(stream, sectionIndex, target);

  switch (command.kind) {
    case "set_note": {
      const strings = fretboard.tuning.length;
      if (
        !Number.isInteger(command.stringIndex) ||
        command.stringIndex < 0 ||
        command.stringIndex >= strings
      ) {
        return fail(
          "string_out_of_range",
          `Bu track'in ${strings} teli var; ${command.stringIndex + 1}. tel yok.`,
        );
      }

      const maxFret = maxCapoRelativeFret(fretboard.capo);
      if (!Number.isInteger(command.fret) || command.fret < 0 || command.fret > maxFret) {
        return fail(
          "fret_out_of_range",
          `Perde 0 ile ${maxFret} arasında olmalı` +
            (fretboard.capo > 0
              ? ` (capo ${fretboard.capo} takılı, perde 0 capo'nun bastığı ses).`
              : ".") +
            ` "${command.fret}" yazılamaz.`,
        );
      }

      const pitch = pitchAt(fretboard, command.stringIndex, command.fret);
      if (pitch === null) {
        return fail(
          "pitch_unreadable",
          "Bu tel ve perde için nota adı hesaplanamadı.",
        );
      }

      const note: NoteEvent = {
        pitch,
        position: { string: command.stringIndex, fret: command.fret },
        ...(command.velocity === undefined ? {} : { velocity: command.velocity }),
        ...(command.articulation === undefined
          ? {}
          : { articulation: command.articulation }),
      };

      // A tie or a rest becomes a struck slot; an existing chord keeps every
      // other string and replaces only this one.
      const existing =
        slot === null || slot === "-" ? [] : slot.notes.filter(
          (entry) => entry.position?.string !== command.stringIndex,
        );

      const next = cloneSong(song);
      writeSlot(next, sectionIndex, target.barIndex, target.trackId, target.slotIndex, {
        notes: [...existing, note].sort(
          (a, b) => (a.position?.string ?? 0) - (b.position?.string ?? 0),
        ),
      });
      return settle(next);
    }

    case "clear_string": {
      if (slot === null || slot === "-") {
        return fail(
          "no_note_on_string",
          "Bu slotta silinecek bir nota yok.",
        );
      }
      const remaining = slot.notes.filter(
        (entry) => entry.position?.string !== command.stringIndex,
      );
      if (remaining.length === slot.notes.length) {
        return fail(
          "no_note_on_string",
          `${command.stringIndex + 1}. telde bu slotta nota yok.`,
        );
      }

      const next = cloneSong(song);
      if (remaining.length > 0) {
        // Other strings of the chord stay exactly as they were.
        writeSlot(next, sectionIndex, target.barIndex, target.trackId, target.slotIndex, {
          notes: remaining,
        });
        return settle(next);
      }

      // The last note went: the slot is a rest, and any tie that was
      // continuing it has nothing left to continue.
      writeSlot(next, sectionIndex, target.barIndex, target.trackId, target.slotIndex, null);
      for (const orphan of trailingTies(stream, index)) {
        if (orphan.kind !== "slot") continue;
        writeSlot(next, orphan.sectionIndex, orphan.barIndex, target.trackId, orphan.slotIndex, null);
      }
      return settle(next);
    }

    case "set_rest": {
      const next = cloneSong(song);
      writeSlot(next, sectionIndex, target.barIndex, target.trackId, target.slotIndex, null);
      for (const orphan of trailingTies(stream, index)) {
        if (orphan.kind !== "slot") continue;
        writeSlot(next, orphan.sectionIndex, orphan.barIndex, target.trackId, orphan.slotIndex, null);
      }
      return settle(next);
    }

    case "set_articulation": {
      if (slot === null || slot === "-") {
        return fail(
          "no_note_on_string",
          "Bu slotta ifade verilecek bir nota yok.",
        );
      }

      const found = slot.notes.find(
        (entry) => entry.position?.string === command.stringIndex,
      );
      if (!found) {
        return fail(
          "no_note_on_string",
          `${command.stringIndex + 1}. telde bu slotta nota yok.`,
        );
      }

      // Only the touched string changes; the rest of the chord is untouched,
      // including any articulation the other notes carry (spec 13.9).
      const notes: NoteEvent[] = slot.notes.map((entry) => {
        if (entry.position?.string !== command.stringIndex) return entry;
        const rest: NoteEvent = { ...entry };
        // "Normal" removes the field rather than writing a value, so a note
        // set back to normal is the same as one that never carried anything.
        delete rest.articulation;
        return command.articulation === null
          ? rest
          : { ...rest, articulation: command.articulation };
      });

      const next = cloneSong(song);
      writeSlot(next, sectionIndex, target.barIndex, target.trackId, target.slotIndex, {
        notes,
      });
      return settle(next);
    }

    case "set_tie": {
      if (index < 0 || !soundingBefore(stream, index)) {
        return fail(
          "orphan_tie",
          "Bu slottan önce çalan bir ses yok, bu yüzden uzatılamaz.",
        );
      }
      const next = cloneSong(song);
      writeSlot(next, sectionIndex, target.barIndex, target.trackId, target.slotIndex, "-");
      return settle(next);
    }
  }
}
