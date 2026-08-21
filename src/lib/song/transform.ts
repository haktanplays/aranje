/**
 * The selection/transform core (spec 5.4, 9.1, 10, K-37).
 *
 * One typed, pure command API for every edit that acts on a *range of time*
 * rather than a single slot. Ten commands in, a new Song or a typed refusal
 * out. Nothing here knows about React, gestures or the tab's geometry.
 *
 * Four rules hold for every command, without exception:
 *
 * - **Atomic.** A command either applies completely or changes nothing. There
 *   is no partial move, no "most of the notes fitted".
 * - **Never silently lossy.** Nothing is overwritten, clamped into range, or
 *   snapped to the nearest slot. Where the music cannot be expressed exactly,
 *   the command refuses and says which of those it was.
 * - **Pure.** The input Song is never mutated. A failed command returns no
 *   Song at all, so a caller that forgets to check cannot persist a broken one.
 * - **Validated.** Success means the strict schema and the whole validator
 *   chain accepted the result. Errors block; warnings come back to the caller.
 *
 * ## The chain policy, in one place
 *
 * Music holds notes together in two ways: a tie chain (an onset and the `"-"`
 * slots that keep it sounding) and a legato chain (consecutive onsets bound by
 * `slide`, `hammer_on` or `pull_off`, which only sound if the note before them
 * is still there). Either can be cut in half by a careless range.
 *
 * **The policy is expansion, applied identically to both.** A selection that
 * touches any part of a chain is grown to cover the whole of it before
 * anything happens, and the grown range is what the command reports acting on.
 * Selecting one string of a chord therefore selects the chord, and selecting
 * the middle of a held note selects the note.
 *
 * There is deliberately no `selection_splits_chain` error. On the source side
 * expansion has already dealt with the problem. On the destination side the
 * case cannot be reached: a tie slot is occupancy, not empty space, so the
 * inside of a chain always collides before it can be split, and the refusal is
 * honestly `target_occupied`. A code that can never fire would only suggest a
 * guard that is not there.
 */
import {
  maxCapoRelativeFret,
  soundingMidi,
  type Fretboard,
} from "@/lib/music/fretboard";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import { isEditableTrack, settle } from "@/lib/song/edit";
import {
  sectionSlotStream,
  type SlotPosition,
} from "@/lib/song/onset-block";
import {
  EMPTY_CLIPBOARD,
  selectionWidth,
  type Clipboard,
  type ClipboardEvent,
  type TimeSelection,
} from "@/lib/song/time-selection";
import type {
  MelodicSlot,
  NoteEvent,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/**
 * Why a command refused.
 *
 * Fixed, typed and safe to show. Raw Zod text and validator diagnostics stay
 * behind `validation_failed`; the UI gets a code it can act on and a sentence
 * a musician can read.
 */
export type TransformErrorCode =
  /** Nothing was selected, so there is nothing to act on. */
  | "selection_empty"
  /** The range, or where it would land, is outside the section. */
  | "selection_out_of_bounds"
  | "section_not_found"
  | "track_not_found"
  /** Drums and keyboards are not written on a fretboard. */
  | "track_not_editable"
  /** The track is not written in a bar the range covers (spec 5.5). */
  | "track_silent_here"
  | "clipboard_empty"
  /** The moment does not exist on the grid it would land on (K-34). */
  | "target_grid_incompatible"
  /** Something is already sounding there. Nothing is ever overwritten. */
  | "target_occupied"
  /** A pitch or fret would fall outside what the instrument can play. */
  | "out_of_range"
  /** Two notes of one onset would need the same string. */
  | "string_collision"
  /** The written position cannot be kept, and will not be quietly dropped. */
  | "position_not_derivable"
  /** Repeats would run past the end of the section. */
  | "section_overflow"
  | "validation_failed";

export type TransformFailure = {
  readonly code: TransformErrorCode;
  readonly message: string;
};

export type TransformResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** Warnings never block; they come back so the screen can show them. */
      readonly warnings: readonly ValidationIssue[];
      /** Where the affected music now lies, after any chain expansion. */
      readonly selection: TimeSelection;
    }
  | { readonly ok: false; readonly error: TransformFailure };

/** A command that only reads: copy takes nothing and changes nothing. */
export type ClipboardResult =
  | { readonly ok: true; readonly clipboard: Clipboard; readonly selection: TimeSelection }
  | { readonly ok: false; readonly error: TransformFailure };

export type TransformCommand =
  | { readonly kind: "copy_selection" }
  | { readonly kind: "cut_selection" }
  | { readonly kind: "delete_selection" }
  | { readonly kind: "paste_selection"; readonly clipboard: Clipboard; readonly atTicks: number }
  | { readonly kind: "duplicate_selection" }
  | { readonly kind: "move_selection_time"; readonly deltaTicks: number }
  | {
      readonly kind: "repeat_selection";
      readonly mode: { readonly kind: "count"; readonly count: number } | { readonly kind: "fill_to_section_end" };
    }
  | { readonly kind: "transpose_pitch"; readonly semitones: number }
  | { readonly kind: "restring_same_pitch"; readonly stringDelta: number }
  | { readonly kind: "translate_fret_shape"; readonly stringDelta: number; readonly fretDelta: number };

const fail = (code: TransformErrorCode, message: string): { ok: false; error: TransformFailure } => ({
  ok: false,
  error: { code, message },
});

/** Legato articulations only sound when the note before them is still there. */
const CHAINING_ARTICULATIONS = new Set(["slide", "hammer_on", "pull_off"]);

// ---------------------------------------------------------------- resolution

type Resolved = {
  readonly section: Section;
  readonly sectionIndex: number;
  readonly track: Track;
  readonly fretboard: Fretboard;
  readonly stream: readonly SlotPosition[];
  readonly totalTicks: number;
};

function resolve(song: Song, selection: TimeSelection): Resolved | { ok: false; error: TransformFailure } {
  const sectionIndex = song.sections.findIndex((entry) => entry.id === selection.sectionId);
  const section = song.sections[sectionIndex];
  if (!section) {
    return fail("section_not_found", `"${selection.sectionId}" bölümü şarkıda yok.`);
  }

  const track = song.tracks.find((entry) => entry.id === selection.trackId);
  if (!track) return fail("track_not_found", `"${selection.trackId}" track'i şarkıda yok.`);
  if (!isEditableTrack(track) || !track.fretboard) {
    return fail("track_not_editable", `"${track.name}" bu editörde düzenlenemez.`);
  }

  const stream = sectionSlotStream(section, track.id);
  const last = stream[stream.length - 1];
  const totalTicks = last ? last.startTicks + last.durationTicks : 0;

  return { section, sectionIndex, track, fretboard: track.fretboard, stream, totalTicks };
}

const isResolved = (value: Resolved | { ok: false; error: TransformFailure }): value is Resolved =>
  !("ok" in value);

/** The struck slot at exactly this tick, or null. */
const onsetAt = (stream: readonly SlotPosition[], ticks: number): SlotPosition | undefined =>
  stream.find((entry) => entry.startTicks === ticks);

const isStruck = (entry: SlotPosition | undefined): boolean =>
  entry !== undefined && entry.writable && entry.slot !== null && entry.slot !== "-";

const notesOf = (entry: SlotPosition): readonly NoteEvent[] =>
  entry.slot && entry.slot !== "-" ? entry.slot.notes : [];

// ------------------------------------------------------------- chain growing

/**
 * Grow a range until it holds whole chains at both ends.
 *
 * This is the single implementation of the policy documented at the top of the
 * file; every command runs its input through it before doing anything else.
 */
function expandToChains(
  stream: readonly SlotPosition[],
  selection: TimeSelection,
): TimeSelection {
  let start = selection.startTicks;
  let end = selection.endTicks;

  /* Backwards: off a tie onto its onset, then off any legato note onto the
   * note that has to be struck before it can sound. */
  for (;;) {
    const index = stream.findIndex((entry) => entry.startTicks === start);
    const entry = index >= 0 ? stream[index] : undefined;
    const previous = index > 0 ? stream[index - 1] : undefined;
    if (!entry || !previous || !previous.writable) break;

    const continuesTie = entry.writable && entry.slot === "-";
    const needsPredecessor =
      isStruck(entry) &&
      isStruck(previous) &&
      notesOf(entry).some(
        (note) => note.articulation && CHAINING_ARTICULATIONS.has(note.articulation),
      );

    if (!continuesTie && !needsPredecessor) break;
    start = previous.startTicks;
  }

  /* Forwards: over the ties that keep the last note sounding, and over any
   * following note that is bound to it by a legato articulation. */
  for (;;) {
    const next = stream.find((entry) => entry.startTicks === end);
    if (!next || !next.writable) break;

    const isTail = next.slot === "-";
    const boundToPrevious =
      isStruck(next) &&
      notesOf(next).some(
        (note) => note.articulation && CHAINING_ARTICULATIONS.has(note.articulation),
      );

    if (!isTail && !boundToPrevious) break;
    end = next.startTicks + next.durationTicks;
  }

  return { ...selection, startTicks: start, endTicks: end };
}

// ------------------------------------------------------------------- reading

/** Read a range into clipboard events, ties folded into durations. */
function readRegion(
  stream: readonly SlotPosition[],
  selection: TimeSelection,
): Clipboard | { ok: false; error: TransformFailure } {
  const width = selectionWidth(selection);
  const events: ClipboardEvent[] = [];

  for (const entry of stream) {
    if (entry.startTicks < selection.startTicks) continue;
    if (entry.startTicks >= selection.endTicks) break;
    if (!entry.writable) {
      return fail(
        "track_silent_here",
        `Seçim, track'in yazılmadığı bir barı kapsıyor; sessizlik yokluktur.`,
      );
    }
    if (!isStruck(entry)) continue;

    // Ties are folded in: one event, with the length it actually sounds for.
    let duration = entry.durationTicks;
    for (const tail of stream) {
      if (tail.startTicks !== entry.startTicks + duration) continue;
      if (!tail.writable || tail.slot !== "-") break;
      duration += tail.durationTicks;
    }

    events.push({
      offsetTicks: entry.startTicks - selection.startTicks,
      durationTicks: duration,
      notes: notesOf(entry).map((note) => ({ ...note })),
    });
  }

  return { widthTicks: width, events };
}

const isClipboard = (value: Clipboard | { ok: false; error: TransformFailure }): value is Clipboard =>
  !("ok" in value);

// ------------------------------------------------------------------- writing

/** A section's bars as mutable slot arrays for this track. */
type Canvas = MelodicSlot[][];

function canvasOf(section: Section, trackId: string): Canvas | null {
  const canvas: Canvas = [];
  for (const bar of section.bars) {
    const slots = bar.slots[trackId];
    if (slots === undefined || !Array.isArray(slots)) return null;
    const melodic = slots as readonly MelodicSlot[];
    if (melodic.some((slot) => Array.isArray(slot))) return null;
    canvas.push([...melodic]);
  }
  return canvas;
}

function applyCanvas(song: Song, sectionIndex: number, trackId: string, canvas: Canvas): Song {
  const sections = song.sections.map((section, index) => {
    if (index !== sectionIndex) return section;
    return {
      ...section,
      bars: section.bars.map((bar, barIndex) => ({
        ...bar,
        slots: { ...bar.slots, [trackId]: canvas[barIndex] ?? [] },
      })),
    };
  });
  return { ...song, sections };
}

/** Clear every slot of a range, leaving rests. */
function clearRegion(
  canvas: Canvas,
  stream: readonly SlotPosition[],
  selection: TimeSelection,
): void {
  for (const entry of stream) {
    if (entry.startTicks < selection.startTicks) continue;
    if (entry.startTicks >= selection.endTicks) break;
    if (!entry.writable) continue;
    const bar = canvas[entry.barIndex];
    if (bar) bar[entry.slotIndex] = null;
  }
}

/**
 * Write events at a tick, or say exactly why they do not fit.
 *
 * Everything that can refuse is checked before a single slot is written, so a
 * refusal leaves the canvas as it was found.
 */
function writeEvents(
  canvas: Canvas,
  stream: readonly SlotPosition[],
  events: readonly ClipboardEvent[],
  atTicks: number,
  totalTicks: number,
): { ok: true; writes: { barIndex: number; slotIndex: number; slot: MelodicSlot }[] } | { ok: false; error: TransformFailure } {
  const writes: { barIndex: number; slotIndex: number; slot: MelodicSlot }[] = [];

  for (const event of events) {
    const start = atTicks + event.offsetTicks;
    if (start < 0 || start + event.durationTicks > totalTicks) {
      return fail("selection_out_of_bounds", "Hedef bölümün dışına taşıyor.");
    }

    const head = onsetAt(stream, start);
    if (!head || !head.writable) {
      return fail(
        "target_grid_incompatible",
        `Bu an hedef barın gridinde yok; en yakın slota yuvarlanmadı.`,
      );
    }

    /* The tie tail has to land exactly. A note that would need three and a
     * half slots of the destination grid cannot be written there at all. */
    const occupies: SlotPosition[] = [head];
    let covered = head.durationTicks;
    while (covered < event.durationTicks) {
      const next = onsetAt(stream, start + covered);
      if (!next || !next.writable) {
        return fail(
          "target_grid_incompatible",
          "Notanın süresi hedef gridde birebir ifade edilemiyor.",
        );
      }
      occupies.push(next);
      covered += next.durationTicks;
    }
    if (covered !== event.durationTicks) {
      return fail(
        "target_grid_incompatible",
        "Notanın süresi hedef gridde birebir ifade edilemiyor.",
      );
    }

    for (const slotEntry of occupies) {
      const current = canvas[slotEntry.barIndex]?.[slotEntry.slotIndex];
      if (current !== null && current !== undefined) {
        return fail("target_occupied", "Hedefte zaten ses var; üstüne yazılmadı.");
      }
    }

    occupies.forEach((slotEntry, index) => {
      writes.push({
        barIndex: slotEntry.barIndex,
        slotIndex: slotEntry.slotIndex,
        slot: index === 0 ? { notes: event.notes.map((note) => ({ ...note })) } : "-",
      });
    });
  }

  return { ok: true, writes };
}

// --------------------------------------------------------- vertical movement

/** The fret that sounds this midi on this string, or null. */
function fretFor(fretboard: Fretboard, stringIndex: number, midi: number): number | null {
  const open = soundingMidi(fretboard, { string: stringIndex, fret: 0 });
  if (open === null) return null;
  const fret = midi - open;
  if (!Number.isInteger(fret) || fret < 0 || fret > maxCapoRelativeFret(fretboard.capo)) {
    return null;
  }
  return fret;
}

/** Map every note of a region through a transform, or refuse as a whole. */
function mapNotes(
  canvas: Canvas,
  stream: readonly SlotPosition[],
  selection: TimeSelection,
  transform: (note: NoteEvent) => NoteEvent | TransformFailure,
): { ok: true } | { ok: false; error: TransformFailure } {
  const staged: { barIndex: number; slotIndex: number; notes: NoteEvent[] }[] = [];

  for (const entry of stream) {
    if (entry.startTicks < selection.startTicks) continue;
    if (entry.startTicks >= selection.endTicks) break;
    if (!entry.writable || !isStruck(entry)) continue;

    const next: NoteEvent[] = [];
    for (const note of notesOf(entry)) {
      const result = transform(note);
      if ("code" in result) return { ok: false, error: result };
      next.push(result);
    }

    const strings = next
      .map((note) => note.position?.string)
      .filter((value): value is number => value !== undefined);
    if (new Set(strings).size !== strings.length) {
      return fail("string_collision", "İki nota aynı tele düşüyor; işlem uygulanmadı.");
    }

    staged.push({ barIndex: entry.barIndex, slotIndex: entry.slotIndex, notes: next });
  }

  for (const item of staged) {
    const bar = canvas[item.barIndex];
    if (bar) bar[item.slotIndex] = { notes: item.notes };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ commands

/** Copy reads and changes nothing, so it has its own result shape. */
export function copySelection(song: Song, selection: TimeSelection): ClipboardResult {
  const resolved = resolve(song, selection);
  if (!isResolved(resolved)) return resolved;
  if (selectionWidth(selection) === 0) {
    return fail("selection_empty", "Seçim boş.");
  }
  if (selection.startTicks < 0 || selection.endTicks > resolved.totalTicks) {
    return fail("selection_out_of_bounds", "Seçim bölümün dışına çıkıyor.");
  }

  const grown = expandToChains(resolved.stream, selection);
  const clipboard = readRegion(resolved.stream, grown);
  if (!isClipboard(clipboard)) return clipboard;
  return { ok: true, clipboard, selection: grown };
}

export function applyTransform(
  song: Song,
  selection: TimeSelection,
  command: TransformCommand,
): TransformResult {
  const resolved = resolve(song, selection);
  if (!isResolved(resolved)) return resolved;

  const { section, sectionIndex, track, fretboard, stream, totalTicks } = resolved;

  if (command.kind !== "paste_selection" && selectionWidth(selection) === 0) {
    return fail("selection_empty", "Seçim boş.");
  }
  if (selection.startTicks < 0 || selection.endTicks > totalTicks) {
    return fail("selection_out_of_bounds", "Seçim bölümün dışına çıkıyor.");
  }

  const grown = expandToChains(stream, selection);
  const canvas = canvasOf(section, track.id);
  if (!canvas) {
    return fail("track_silent_here", `"${track.name}" bu bölümde yazılı değil.`);
  }

  const finish = (next: Canvas, resultSelection: TimeSelection): TransformResult => {
    const settled = settle(applyCanvas(song, sectionIndex, track.id, next));
    if (!settled.ok) {
      return fail("validation_failed", "Düzenleme kontrollerden geçmedi ve uygulanmadı.");
    }
    return { ok: true, song: settled.song, warnings: settled.warnings, selection: resultSelection };
  };

  switch (command.kind) {
    case "copy_selection": {
      // Copy changes nothing; the song comes back untouched.
      return { ok: true, song, warnings: [], selection: grown };
    }

    case "delete_selection":
    case "cut_selection": {
      clearRegion(canvas, stream, grown);
      return finish(canvas, { ...grown, endTicks: grown.startTicks });
    }

    case "paste_selection": {
      if (command.clipboard.events.length === 0 && command.clipboard.widthTicks === 0) {
        return fail("clipboard_empty", "Pano boş.");
      }
      const written = writeEvents(canvas, stream, command.clipboard.events, command.atTicks, totalTicks);
      if (!written.ok) return written;
      for (const write of written.writes) {
        const bar = canvas[write.barIndex];
        if (bar) bar[write.slotIndex] = write.slot;
      }
      return finish(canvas, {
        ...grown,
        startTicks: command.atTicks,
        endTicks: command.atTicks + command.clipboard.widthTicks,
      });
    }

    case "duplicate_selection": {
      const clipboard = readRegion(stream, grown);
      if (!isClipboard(clipboard)) return clipboard;
      const at = grown.endTicks;
      const written = writeEvents(canvas, stream, clipboard.events, at, totalTicks);
      if (!written.ok) return written;
      for (const write of written.writes) {
        const bar = canvas[write.barIndex];
        if (bar) bar[write.slotIndex] = write.slot;
      }
      return finish(canvas, { ...grown, startTicks: at, endTicks: at + clipboard.widthTicks });
    }

    case "move_selection_time": {
      const clipboard = readRegion(stream, grown);
      if (!isClipboard(clipboard)) return clipboard;
      const at = grown.startTicks + command.deltaTicks;

      // Lift first, so a move by less than the selection's own width does not
      // collide with the music it is made of.
      clearRegion(canvas, stream, grown);
      const written = writeEvents(canvas, stream, clipboard.events, at, totalTicks);
      if (!written.ok) return written;
      for (const write of written.writes) {
        const bar = canvas[write.barIndex];
        if (bar) bar[write.slotIndex] = write.slot;
      }
      return finish(canvas, { ...grown, startTicks: at, endTicks: at + clipboard.widthTicks });
    }

    case "repeat_selection": {
      const clipboard = readRegion(stream, grown);
      if (!isClipboard(clipboard)) return clipboard;
      const width = clipboard.widthTicks;
      if (width <= 0) return fail("selection_empty", "Seçim boş.");

      const room = totalTicks - grown.endTicks;
      const possible = Math.floor(room / width);
      const wanted =
        command.mode.kind === "count" ? command.mode.count : possible;
      if (wanted <= 0) {
        return fail("section_overflow", "Bölümün sonuna sığacak tekrar yok.");
      }
      if (wanted > possible) {
        return fail("section_overflow", "Tekrarlar bölümün dışına taşıyor.");
      }

      const all: { barIndex: number; slotIndex: number; slot: MelodicSlot }[] = [];
      for (let index = 1; index <= wanted; index += 1) {
        const written = writeEvents(
          canvas,
          stream,
          clipboard.events,
          grown.startTicks + index * width,
          totalTicks,
        );
        if (!written.ok) return written;
        // Staged so the whole run is atomic: a later repeat that does not fit
        // must not leave the earlier ones behind.
        for (const write of written.writes) {
          const bar = canvas[write.barIndex];
          if (bar) bar[write.slotIndex] = write.slot;
        }
        all.push(...written.writes);
      }
      return finish(canvas, {
        ...grown,
        endTicks: grown.startTicks + width * (wanted + 1),
      });
    }

    case "transpose_pitch": {
      const mapped = mapNotes(canvas, stream, grown, (note) => {
        const midi = pitchToMidi(note.pitch);
        if (midi === null) return { code: "out_of_range", message: "Nota okunamadı." };
        const next = midi + command.semitones;
        const pitch = midiToPitch(next);

        if (!note.position) {
          // Implicit stays implicit and goes back through the placement engine.
          return { ...note, pitch };
        }
        const fret = fretFor(fretboard, note.position.string, next);
        if (fret === null) {
          return {
            code: "position_not_derivable",
            message: "Yazılı pozisyon aynı telde korunamıyor; işlem uygulanmadı.",
          };
        }
        return { ...note, pitch, position: { string: note.position.string, fret } };
      });
      if (!mapped.ok) return mapped;
      return finish(canvas, grown);
    }

    case "restring_same_pitch": {
      const mapped = mapNotes(canvas, stream, grown, (note) => {
        const midi = pitchToMidi(note.pitch);
        if (midi === null) return { code: "out_of_range", message: "Nota okunamadı." };
        const from = note.position?.string;
        if (from === undefined) {
          return {
            code: "position_not_derivable",
            message: "Bu nota bir tele yazılmamış; taşınacak tel yok.",
          };
        }
        const to = from + command.stringDelta;
        if (to < 0 || to >= fretboard.tuning.length) {
          return { code: "out_of_range", message: "Hedef tel yok." };
        }
        const fret = fretFor(fretboard, to, midi);
        if (fret === null) {
          return {
            code: "out_of_range",
            message: "Aynı ses hedef telde çalınamıyor; işlem uygulanmadı.",
          };
        }
        // Pitch is deliberately untouched: this command moves the hand, not
        // the note.
        return { ...note, position: { string: to, fret } };
      });
      if (!mapped.ok) return mapped;
      return finish(canvas, grown);
    }

    case "translate_fret_shape": {
      const mapped = mapNotes(canvas, stream, grown, (note) => {
        const from = note.position;
        if (!from) {
          return {
            code: "position_not_derivable",
            message: "Şekil taşımak için notaların tel ve perdesi yazılı olmalı.",
          };
        }
        const string = from.string + command.stringDelta;
        const fret = from.fret + command.fretDelta;
        if (string < 0 || string >= fretboard.tuning.length) {
          return { code: "out_of_range", message: "Şekil klavyenin dışına çıkıyor." };
        }
        if (fret < 0 || fret > maxCapoRelativeFret(fretboard.capo)) {
          return { code: "out_of_range", message: "Şekil klavyenin dışına çıkıyor." };
        }
        const midi = soundingMidi(fretboard, { string, fret });
        if (midi === null) {
          return { code: "out_of_range", message: "Şekil klavyenin dışına çıkıyor." };
        }
        // The pitch follows the hand here, which is the whole point.
        return { ...note, pitch: midiToPitch(midi), position: { string, fret } };
      });
      if (!mapped.ok) return mapped;
      return finish(canvas, grown);
    }
  }
}

export { EMPTY_CLIPBOARD };
export type { Clipboard, ClipboardEvent, TimeSelection };

// -------------------------------------------------------------- store bridge

/**
 * Run a command against a store, so success is one write and one undo step.
 *
 * The atomicity rule reaches storage too: `store.commit` is called exactly
 * once on success and not at all on failure, so a refused command leaves both
 * the saved song and the undo history untouched. Keeping this here rather than
 * in a component means every caller gets that for free instead of remembering
 * to check `ok` before committing.
 */
export function commitTransform(
  store: { getSnapshot(): { song: Song }; commit(next: Song): void },
  selection: TimeSelection,
  command: TransformCommand,
): TransformResult {
  const result = applyTransform(store.getSnapshot().song, selection, command);
  if (result.ok) store.commit(result.song);
  return result;
}
