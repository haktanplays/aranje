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
 * ## The chain decision is the caller's, and it is required
 *
 * Music holds notes together in two ways: a tie chain (an onset and the `"-"`
 * slots that keep it sounding) and a legato chain (consecutive onsets bound by
 * `slide`, `hammer_on` or `pull_off`, which only sound if the note before them
 * is still there). Either can be cut in half by a range that stops inside it.
 *
 * This used to answer that silently, by growing every range to cover the whole
 * chain before doing anything. The answer was safe and the silence was not: it
 * moved music nobody had selected. So the growing is gone, and in its place is
 * a rule with no default (spec 13.20 §2):
 *
 * **A command that would cut a chain does not run without a `chainPolicy`.**
 *
 * `chain-preflight.ts` says whether a chain is involved and what would break.
 * If it is, the caller must pass one of two decisions — `include_chain` to act
 * on the whole chain, `detach_boundary` to act on exactly the range and cut
 * the connections at its edges — and passing neither is the third outcome:
 * a typed refusal, `chain_policy_required`, which changes nothing.
 *
 * That gate lives here rather than in a sheet on purpose. A UI-only guard
 * would be one careless direct call away from the old behaviour, and the most
 * dangerous version of that bug is a preview showing "only the chord" while
 * the commit quietly moves the run. Preview and commit are the same function
 * with the same policy, so they cannot describe different acts.
 *
 * There is deliberately no `selection_splits_chain` error on the destination
 * side: a tie slot is occupancy, not empty space, so the inside of a chain
 * always collides before it can be split, and the refusal is honestly
 * `target_occupied`.
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
  CHAINING_ARTICULATIONS,
  chainImpactOf,
  type ChainImpact,
  type ChainPolicy,
  type DetachEdit,
} from "@/lib/song/chain-preflight";
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
import type { HistoryAction } from "@/lib/song/edit-history";
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
  /**
   * The command would cut a tie or a legato chain and no decision was given.
   *
   * Not a failure of the music: a question the caller has to answer. See the
   * header — there is deliberately no default, because the default is what
   * silently moved music nobody selected.
   */
  | "chain_policy_required"
  /**
   * The chain carries on into another section, where neither answer exists:
   * the range cannot be grown across a section line, and detaching would mean
   * editing music the reader is not looking at. Fails closed.
   */
  | "chain_crosses_section"
  /**
   * The range begins on a tie rather than on the note that struck it, so
   * "only what I selected" would be the tail of somebody else's note. Take
   * the whole note or nothing; nothing is repaired quietly.
   */
  | "selection_starts_inside_tie"
  | "validation_failed";

export type TransformFailure = {
  readonly code: TransformErrorCode;
  readonly message: string;
};

/**
 * What a caller may decide about the music around the range.
 *
 * Optional in the type and required in practice: a command that would cut a
 * chain refuses without it (`chain_policy_required`). Making it optional keeps
 * the ninety per cent of calls that touch nothing readable, and the refusal
 * makes the other ten per cent impossible to get wrong by forgetting.
 */
export type TransformOptions = {
  readonly chainPolicy?: ChainPolicy;
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

// ------------------------------------------------------- chain, and detaching

/**
 * Apply the preflight's detach edits to a section, exactly as listed.
 *
 * Pure, and the only place a chain relation is ever removed. The edits come
 * from `chain-preflight`, so preview, clipboard and commit all cut in the same
 * places — the alternative, each caller deciding for itself, is how a preview
 * that says "only the chord" ends up committing the whole run.
 *
 * `articulation` is deleted rather than set to `"normal"`: the contract says an
 * absent field is an ordinary note (spec 5.4), and writing the word would be a
 * second spelling of the same fact. Articulations that are not chain relations
 * — vibrato, palm mute, a bend — are left exactly where they are.
 */
function applyDetach(
  song: Song,
  sectionIndex: number,
  trackId: string,
  edits: readonly DetachEdit[],
): Song {
  if (edits.length === 0) return song;

  const byBar = new Map<number, DetachEdit[]>();
  for (const edit of edits) {
    const list = byBar.get(edit.barIndex) ?? [];
    list.push(edit);
    byBar.set(edit.barIndex, list);
  }

  return {
    ...song,
    sections: song.sections.map((section, index) => {
      if (index !== sectionIndex) return section;
      return {
        ...section,
        bars: section.bars.map((bar, barIndex) => {
          const list = byBar.get(barIndex);
          if (!list) return bar;
          const slots = bar.slots[trackId];
          if (!Array.isArray(slots)) return bar;
          const next = [...(slots as readonly MelodicSlot[])];

          for (const edit of list) {
            const slot = next[edit.slotIndex];
            if (edit.kind === "rest") {
              next[edit.slotIndex] = null;
              continue;
            }
            if (!slot || slot === "-") continue;
            next[edit.slotIndex] = {
              notes: slot.notes.map((note) => {
                if (
                  note.articulation === undefined ||
                  !CHAINING_ARTICULATIONS.has(note.articulation)
                ) {
                  return note;
                }
                /*
                 * Rebuilt without the field rather than with it set to
                 * `"normal"`: the contract says an absent articulation is an
                 * ordinary note, and writing the word would be a second way
                 * of saying so that every reader downstream would have to
                 * know about.
                 */
                const bare: NoteEvent = { pitch: note.pitch };
                if (note.velocity !== undefined) bare.velocity = note.velocity;
                if (note.position !== undefined) bare.position = note.position;
                return bare;
              }),
            };
          }

          return { ...bar, slots: { ...bar.slots, [trackId]: next } };
        }),
      };
    }),
  };
}

/**
 * Turn a range plus a decision into the range the command will really act on.
 *
 * Every refusal a chain can cause is made here, once, so no command can be
 * written that forgets to ask.
 */
type Scope =
  | {
      readonly ok: true;
      readonly selection: TimeSelection;
      readonly impact: ChainImpact;
      readonly detach: readonly DetachEdit[];
    }
  | { readonly ok: false; readonly error: TransformFailure };

function resolveScope(
  impact: ChainImpact,
  policy: ChainPolicy | undefined,
): Scope {
  if (impact.kind === "no_chain_impact") {
    return { ok: true, selection: impact.selection, impact, detach: [] };
  }
  if (impact.kind === "crosses_section_boundary") {
    return fail(
      "chain_crosses_section",
      "Bu bağlantı bir sonraki bölüme uzanıyor; işlem uygulanmadı.",
    );
  }
  if (policy === undefined) {
    return fail(
      "chain_policy_required",
      "Bu seçim bir bağlantıyı kesiyor; nasıl davranılacağı seçilmeden uygulanmaz.",
    );
  }
  if (policy === "include_chain") {
    return { ok: true, selection: impact.expanded, impact, detach: [] };
  }
  if (impact.startsInsideTie) {
    return fail(
      "selection_starts_inside_tie",
      "Seçim uzayan bir sesin ortasından başlıyor; ya sesin tamamı alınır ya da hiçbiri.",
    );
  }
  return { ok: true, selection: impact.selection, impact, detach: impact.detach };
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

    /*
     * Ties are folded in: one event, with the length it actually sounds for —
     * but never past the end of the range.
     *
     * The clip matters now that a range is not silently grown to cover whole
     * chains (spec 13.20 §2). Under `detach_boundary` the tie slots beyond the
     * edge are being turned into rests, so folding them into this note's
     * length would move a duration whose tail no longer exists. Under
     * `include_chain` the range already covers the whole run, so clipping
     * there changes nothing.
     */
    let duration = entry.durationTicks;
    for (const tail of stream) {
      if (tail.startTicks !== entry.startTicks + duration) continue;
      if (tail.startTicks >= selection.endTicks) break;
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

/**
 * A section's bars as mutable slot arrays for this track.
 *
 * `null` where the track is not written in that bar. A track that plays in
 * seven bars of eight is a completely ordinary thing — a guitar that drops out
 * for one bar — and the absent bar is silence, not a defect (spec 5.5).
 *
 * This used to be `MelodicSlot[][]` and `canvasOf` returned null the moment any
 * one bar was missing the track, which refused every edit anywhere in the
 * section and said "this track is not written in this section" about a track
 * that plainly was. The per-slot `writable` flag is what refuses an edit that
 * actually reaches into a bar the track does not play in; the section as a
 * whole has no business refusing on its behalf.
 */
type Canvas = (MelodicSlot[] | null)[];

function canvasOf(section: Section, trackId: string): Canvas | null {
  const canvas: Canvas = [];
  let written = false;
  for (const bar of section.bars) {
    const slots = bar.slots[trackId];
    if (slots === undefined) {
      canvas.push(null);
      continue;
    }
    if (!Array.isArray(slots)) return null;
    const melodic = slots as readonly MelodicSlot[];
    if (melodic.some((slot) => Array.isArray(slot))) return null;
    canvas.push([...melodic]);
    written = true;
  }
  // Not written in a single bar of the section: now the message is true.
  return written ? canvas : null;
}

function applyCanvas(song: Song, sectionIndex: number, trackId: string, canvas: Canvas): Song {
  const sections = song.sections.map((section, index) => {
    if (index !== sectionIndex) return section;
    return {
      ...section,
      bars: section.bars.map((bar, barIndex) => {
        const written = canvas[barIndex];
        /*
         * A bar the track was absent from stays absent. "A missing key is
         * silence" is a statement the contract makes (spec 5.5), and writing
         * an empty array there would turn it into a different statement — as
         * well as rewriting a bar nobody touched.
         */
        if (written === undefined || written === null) return bar;
        return { ...bar, slots: { ...bar.slots, [trackId]: written } };
      }),
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

/**
 * Copy reads and changes nothing, so it has its own result shape.
 *
 * It takes the same decision as every other command, for the same reason: a
 * clipboard cut out of the middle of a chain would carry a hammer-on that
 * leans on a note it did not bring with it, and pasting that anywhere else
 * would produce a bond pointing at whatever happened to be there. With
 * `detach_boundary` the dependency is removed before the region is read, so
 * what is on the clipboard stands on its own.
 *
 * The **source song is never touched**: detaching is done on a copy that is
 * read and thrown away.
 */
export function copySelection(
  song: Song,
  selection: TimeSelection,
  options: TransformOptions = {},
): ClipboardResult {
  const resolved = resolve(song, selection);
  if (!isResolved(resolved)) return resolved;
  if (selectionWidth(selection) === 0) {
    return fail("selection_empty", "Seçim boş.");
  }
  if (selection.startTicks < 0 || selection.endTicks > resolved.totalTicks) {
    return fail("selection_out_of_bounds", "Seçim bölümün dışına çıkıyor.");
  }

  const impact = chainImpactOf(
    {
      song,
      sectionIndex: resolved.sectionIndex,
      trackId: resolved.track.id,
      stream: resolved.stream,
    },
    selection,
  );
  const scope = resolveScope(impact, options.chainPolicy);
  if (!scope.ok) return scope;

  // Read from a detached copy, so the clipboard is self-contained and the
  // song the reader is looking at is exactly as it was.
  const source =
    scope.detach.length === 0
      ? song
      : applyDetach(song, resolved.sectionIndex, resolved.track.id, scope.detach);
  const stream =
    source === song
      ? resolved.stream
      : sectionSlotStream(source.sections[resolved.sectionIndex]!, resolved.track.id);

  const clipboard = readRegion(stream, scope.selection);
  if (!isClipboard(clipboard)) return clipboard;
  return { ok: true, clipboard, selection: scope.selection };
}

export function applyTransform(
  song: Song,
  selection: TimeSelection,
  command: TransformCommand,
  options: TransformOptions = {},
): TransformResult {
  const initial = resolve(song, selection);
  if (!isResolved(initial)) return initial;

  if (command.kind !== "paste_selection" && selectionWidth(selection) === 0) {
    return fail("selection_empty", "Seçim boş.");
  }
  if (selection.startTicks < 0 || selection.endTicks > initial.totalTicks) {
    return fail("selection_out_of_bounds", "Seçim bölümün dışına çıkıyor.");
  }

  /*
   * The decision, before anything else happens.
   *
   * `paste_selection` is the one command whose region is the destination
   * rather than the selection, so nothing of the selection's own is cut and
   * no decision is owed. Every other command goes through the gate.
   */
  const impact = chainImpactOf(
    {
      song,
      sectionIndex: initial.sectionIndex,
      trackId: initial.track.id,
      stream: initial.stream,
    },
    selection,
  );
  const scope =
    command.kind === "paste_selection"
      ? ({ ok: true, selection, impact, detach: [] } as const)
      : resolveScope(impact, options.chainPolicy);
  if (!scope.ok) return scope;

  /*
   * Detaching happens on the song, before the command runs, so what follows
   * sees one consistent piece of music. The result is still one Song out of
   * one call: there is no state in which the connections are cut and the
   * command has not happened.
   */
  const base =
    scope.detach.length === 0
      ? song
      : applyDetach(song, initial.sectionIndex, initial.track.id, scope.detach);
  const resolved = base === song ? initial : resolve(base, selection);
  if (!isResolved(resolved)) return resolved;

  const { section, sectionIndex, track, fretboard, stream, totalTicks } = resolved;
  const grown = scope.selection;

  const canvas = canvasOf(section, track.id);
  if (!canvas) {
    return fail("track_silent_here", `"${track.name}" bu bölümde yazılı değil.`);
  }

  const finish = (next: Canvas, resultSelection: TimeSelection): TransformResult => {
    const settled = settle(applyCanvas(base, sectionIndex, track.id, next));
    if (!settled.ok) {
      return fail("validation_failed", "Düzenleme kontrollerden geçmedi ve uygulanmadı.");
    }
    return { ok: true, song: settled.song, warnings: settled.warnings, selection: resultSelection };
  };

  /*
   * The selection may not reach into a bar the track is not written in.
   *
   * That bar is silence, and silence is absence rather than a row of empty
   * slots (spec 5.5) — there is nothing there to copy, move or delete. The
   * check is on the *selection*, not on the section: a guitar that drops out
   * for one bar is completely ordinary, and refusing every edit anywhere in
   * its section because of that one bar was refusing on the music's behalf.
   *
   * `paste_selection` is not covered here because its region is the
   * destination rather than the selection, and `writeEvents` already refuses
   * a destination slot that cannot be written.
   */
  if (command.kind !== "paste_selection") {
    for (const entry of stream) {
      if (entry.startTicks < grown.startTicks) continue;
      if (entry.startTicks >= grown.endTicks) break;
      if (entry.writable) continue;
      return fail(
        "track_silent_here",
        `Seçim, "${track.name}" track'inin yazılmadığı bir barı kapsıyor.`,
      );
    }
  }

  switch (command.kind) {
    case "copy_selection": {
      // Copy changes nothing; the song comes back untouched — the original,
      // not the detached working copy, which exists only to be read.
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
  store: {
    getSnapshot(): { song: Song };
    commit(next: Song, action: HistoryAction): boolean;
  },
  selection: TimeSelection,
  command: TransformCommand,
  options: TransformOptions = {},
): TransformResult {
  /*
   * The decision travels with the command. Without this parameter the bridge
   * would be a way of reaching the core that can never answer the chain
   * question, so every chained selection would come back refused — and the
   * obvious "fix" for that is exactly the silent expansion this checkpoint
   * removed.
   */
  const result = applyTransform(store.getSnapshot().song, selection, command, options);
  if (result.ok) {
    // The action is built here rather than asked for, so this bridge cannot
    // become a way to write a song into the history without saying what it was.
    store.commit(result.song, {
      kind: "selection_transform",
      command: command.kind,
    });
  }
  return result;
}
