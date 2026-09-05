/**
 * Writing the axes a note can now answer at once (2V-D.1 §7, §13, §14).
 *
 * Four commands, one per axis a reader edits directly: the attack, the
 * picking direction, and the two spans. They are separate because a reader
 * edits them separately — taking the accent off a note is not a decision
 * about its bend — and a single command that took every axis at once would
 * turn "remove the accent" into "rewrite everything about this note".
 *
 * ## What the span commands do about legacy notes (§7)
 *
 * Nothing is migrated on open, on load, or on an unrelated edit. But a reader
 * who draws a palm-mute span across notes that already carry the legacy
 * `palm_mute` articulation has said the same thing twice, and the resolver
 * calls that a refusal rather than choosing one.
 *
 * So the span write converts, and only exactly what it covers: a note the new
 * span really includes — right track, right strings, right ticks — loses the
 * legacy value that the span now carries, and no other note is touched. It is
 * lossless because the legacy field held one value and that value is the one
 * being moved; a note carrying `palm_mute` carries nothing else on that
 * field, so there is nothing left behind to lose.
 *
 * A note the span does *not* cover keeps its legacy articulation and goes on
 * sounding exactly as it did. Two ways of saying it coexist in one song, and
 * that is correct: the reader converted the part they were editing.
 */
import { resolveExpression } from "@/lib/music/expression-resolver";
import { spanConflict, type SpanRefusal, SPAN_REFUSAL_MESSAGE } from "@/lib/music/technique-span";
import { settle } from "@/lib/song/edit";
import { findSection, sectionSlotStream } from "@/lib/song/onset-block";
import type {
  MelodicSlot,
  NoteAttack,
  NoteEvent,
  PickingDirection,
  Section,
  Song,
  TechniqueSpan,
} from "@/lib/song/schema";

export type TechniqueFailure =
  | "no_section"
  | "no_track"
  | "not_fretted"
  | "no_note_here"
  | "nothing_selected"
  | "no_such_span"
  | "unchanged"
  | "conflicting_technique"
  | SpanRefusal;

export const TECHNIQUE_MESSAGE: Readonly<Record<TechniqueFailure, string>> = {
  ...SPAN_REFUSAL_MESSAGE,
  no_section: "Bu bölüm bulunamadı.",
  no_track: "Bu enstrüman bulunamadı.",
  not_fretted: "Bu teknik yalnız telli enstrümanlarda yazılabilir.",
  no_note_here: "Burada bir nota yok.",
  nothing_selected: "Önce bir nota ya da aralık seç.",
  no_such_span: "Kaldırılacak teknik bulunamadı.",
  unchanged: "Bu nota zaten böyle çalınıyor.",
  conflicting_technique:
    "Bu nota bu tekniği zaten kendi üzerinde taşıyor. Önce onu kaldır.",
};

export type TechniqueResult =
  | { readonly ok: true; readonly song: Song }
  | { readonly ok: false; readonly error: TechniqueFailure; readonly message: string };

const fail = (error: TechniqueFailure): TechniqueResult => ({
  ok: false,
  error,
  message: TECHNIQUE_MESSAGE[error],
});

/** One onset a command applies to. Ticks are from the start of the section. */
export type NoteTarget = {
  readonly timeTicks: number;
  /** Which voice of the onset. Absent means every note of it. */
  readonly noteIndex?: number;
};

export type AttackWriteCommand = {
  readonly sectionId: string;
  readonly trackId: string;
  readonly targets: readonly NoteTarget[];
  /** `null` removes whatever attack was written. */
  readonly attack: NoteAttack | null;
};

export type PickingWriteCommand = {
  readonly sectionId: string;
  readonly trackId: string;
  readonly targets: readonly NoteTarget[];
  /** `null` removes the direction. */
  readonly picking: PickingDirection | null;
};

/** Rewrite the notes a command names, leaving every other note untouched. */
function rewriteNotes(
  section: Section,
  trackId: string,
  targets: readonly NoteTarget[],
  change: (note: NoteEvent) => NoteEvent | TechniqueFailure,
  /*
   * Whether this note actually became something else.
   *
   * Asked of the axis rather than of object identity: `{ ...note }` with a
   * `delete` on a field that was already absent is a new object holding the
   * same music, and counting that as a change is how "remove the accent" on
   * a note with no accent reports success and writes a history step.
   */
  changed: (before: NoteEvent, after: NoteEvent) => boolean,
): { readonly section: Section } | { readonly error: TechniqueFailure } {
  const stream = sectionSlotStream(section, trackId);
  /* Bar and slot per tick, so the write can go straight to the right cell
     rather than walking the section again for every target. */
  const cells = new Map<number, { barIndex: number; slotIndex: number }>();
  stream.forEach((entry) => {
    cells.set(entry.startTicks, { barIndex: entry.barIndex, slotIndex: entry.slotIndex });
  });

  const bars = section.bars.map((bar) => ({ ...bar, slots: { ...bar.slots } }));
  let touched = 0;

  for (const target of targets) {
    const cell = cells.get(target.timeTicks);
    if (!cell) return { error: "no_note_here" };
    const bar = bars[cell.barIndex];
    const lane = bar?.slots[trackId];
    if (!bar || !Array.isArray(lane)) return { error: "no_note_here" };
    const slot = lane[cell.slotIndex] as MelodicSlot | undefined;
    if (slot === undefined || slot === null || slot === "-") return { error: "no_note_here" };

    const next: NoteEvent[] = [];
    for (const [index, note] of slot.notes.entries()) {
      if (target.noteIndex !== undefined && target.noteIndex !== index) {
        next.push(note);
        continue;
      }
      if (note.position === undefined) return { error: "not_fretted" };
      const result = change(note);
      if (typeof result === "string") return { error: result };
      if (changed(note, result)) touched += 1;
      next.push(result);
    }

    const laneCopy = [...(lane as MelodicSlot[])];
    laneCopy[cell.slotIndex] = { notes: next };
    bar.slots = { ...bar.slots, [trackId]: laneCopy };
    bars[cell.barIndex] = bar;
  }

  if (touched === 0) return { error: "unchanged" };
  return { section: { ...section, bars } };
}

/** Put the rewritten section back, then let the contract check the whole song. */
function withSection(song: Song, next: Section): TechniqueResult {
  const staged = settle({
    ...song,
    sections: song.sections.map((entry) => (entry.id === next.id ? next : entry)),
  });
  return staged.ok ? { ok: true, song: staged.song } : fail("conflicting_technique");
}

function preflight(
  song: Song,
  sectionId: string,
  trackId: string,
): { readonly section: Section } | { readonly error: TechniqueFailure } {
  const section = findSection(song, sectionId);
  if (!section) return { error: "no_section" };
  const track = song.tracks.find((entry) => entry.id === trackId);
  if (!track) return { error: "no_track" };
  if (!track.fretboard) return { error: "not_fretted" };
  return { section };
}

/** Set or clear how the string is struck, on one note or on a selection. */
export function applyAttackWrite(
  song: Song,
  command: AttackWriteCommand,
): TechniqueResult {
  if (command.targets.length === 0) return fail("nothing_selected");
  const ready = preflight(song, command.sectionId, command.trackId);
  if ("error" in ready) return fail(ready.error);

  const written = rewriteNotes(ready.section, command.trackId, command.targets, (note) => {
    const next: NoteEvent = { ...note };
    if (command.attack === null) delete (next as { attack?: unknown }).attack;
    else next.attack = command.attack;
    /*
     * Asked of what the note would become, so replacing an attack is allowed
     * while writing one beside a legacy `accent` is a refusal. The reader is
     * told to take the old one off rather than being given a note that says
     * two things and sounds like one of them.
     */
    if (resolveExpression(next).conflict !== null) return "conflicting_technique";
    return next;
  }, (before, after) => before.attack !== after.attack);
  if ("error" in written) return fail(written.error);
  return withSection(song, written.section);
}

/** Set or clear the pick's direction. Drawn and spoken; not played (§9). */
export function applyPickingWrite(
  song: Song,
  command: PickingWriteCommand,
): TechniqueResult {
  if (command.targets.length === 0) return fail("nothing_selected");
  const ready = preflight(song, command.sectionId, command.trackId);
  if ("error" in ready) return fail(ready.error);

  const written = rewriteNotes(ready.section, command.trackId, command.targets, (note) => {
    const next: NoteEvent = { ...note };
    if (command.picking === null) delete (next as { picking?: unknown }).picking;
    else next.picking = command.picking;
    return next;
  }, (before, after) => before.picking !== after.picking);
  if ("error" in written) return fail(written.error);
  return withSection(song, written.section);
}

export type SpanWriteCommand = {
  readonly sectionId: string;
  /** The span to write. Its id decides whether this adds or edits. */
  readonly span: TechniqueSpan;
};

/**
 * Add a span, or replace the one with this id.
 *
 * The legacy notes the span covers are converted here and only here — see
 * this module's header for why that is lossless and why it is scoped.
 */
export function applySpanWrite(song: Song, command: SpanWriteCommand): TechniqueResult {
  const ready = preflight(song, command.sectionId, command.span.trackId);
  if ("error" in ready) return fail(ready.error);
  const section = ready.section;

  const existing = section.techniqueSpans ?? [];
  const others = existing.filter((span) => span.id !== command.span.id);
  const refusal = spanConflict([...others, command.span], (trackId) => {
    const track = song.tracks.find((entry) => entry.id === trackId);
    return track?.fretboard?.tuning.length ?? null;
  });
  if (refusal) return fail(refusal);

  /* Legacy values this span now carries, on exactly the notes it covers. */
  const converted = convertLegacyUnder(section, command.span);
  const spans = [...others, command.span].sort((a, b) => a.startTicks - b.startTicks);

  /*
   * What the notes under the new span now say, asked of the resolver rather
   * than assumed from the conversion above.
   *
   * The conversion moves the legacy value this span *replaces*. It cannot
   * move the other one: a note ringing on with `letRing` is not made muteable
   * by drawing a mute over it, it is a contradiction, and a write that only
   * looked at its own kind would have shipped a song the resolver refuses to
   * read. So the question is asked the way playback will ask it.
   */
  const stream = sectionSlotStream(converted, command.span.trackId);
  for (const entry of stream) {
    const slot = entry.slot;
    if (slot === undefined || slot === null || slot === "-") continue;
    for (const note of slot.notes) {
      const stringIndex = note.position?.string ?? null;
      const read = resolveExpression(note, {
        trackId: command.span.trackId,
        timeTicks: entry.startTicks,
        stringIndex,
        spans,
      });
      if (read.conflict !== null) return fail("conflicting_technique");
    }
  }

  return withSection(song, { ...converted, techniqueSpans: spans });
}

export type SpanRemoveCommand = {
  readonly sectionId: string;
  readonly spanId: string;
};

/** Take one span away. The notes under it are not touched. */
export function applySpanRemove(
  song: Song,
  command: SpanRemoveCommand,
): TechniqueResult {
  const section = findSection(song, command.sectionId);
  if (!section) return fail("no_section");
  const existing = section.techniqueSpans ?? [];
  if (!existing.some((span) => span.id === command.spanId)) return fail("no_such_span");
  const spans = existing.filter((span) => span.id !== command.spanId);
  /* The last span leaves the field absent rather than empty. An empty array
     is a song saying "no spans"; absence is a song that never said anything,
     which is what it was before the first one was drawn. */
  const next = { ...section };
  if (spans.length === 0) delete (next as { techniqueSpans?: unknown }).techniqueSpans;
  else next.techniqueSpans = spans;
  return withSection(song, next);
}

/**
 * Drop the legacy field this span replaces, on the onsets it covers.
 *
 * Only those onsets. A palm-mute span over the low strings of two bars must
 * not reach a `palm_mute` note on the top string, or in the bar after it, or
 * on another track — and each of those is a way of losing music the reader
 * did not ask to change.
 */
function convertLegacyUnder(section: Section, span: TechniqueSpan): Section {
  const stream = sectionSlotStream(section, span.trackId);
  const strings = new Set(span.stringIndices);
  const bars = section.bars.map((bar) => ({ ...bar, slots: { ...bar.slots } }));
  let changed = false;

  for (const entry of stream) {
    if (entry.startTicks < span.startTicks || entry.startTicks >= span.endTicks) continue;
    const slot = entry.slot;
    if (slot === undefined || slot === null || slot === "-") continue;
    const bar = bars[entry.barIndex];
    const lane = bar?.slots[span.trackId];
    if (!bar || !Array.isArray(lane)) continue;

    let slotChanged = false;
    const notes = slot.notes.map((note) => {
      const stringIndex = note.position?.string;
      if (stringIndex === undefined || !strings.has(stringIndex)) return note;
      if (span.kind === "palm_mute" && note.articulation === "palm_mute") {
        const next = { ...note };
        delete (next as { articulation?: unknown }).articulation;
        slotChanged = true;
        return next;
      }
      if (span.kind === "let_ring" && note.letRing === true) {
        const next = { ...note };
        delete (next as { letRing?: unknown }).letRing;
        slotChanged = true;
        return next;
      }
      return note;
    });
    if (!slotChanged) continue;

    const laneCopy = [...(lane as MelodicSlot[])];
    laneCopy[entry.slotIndex] = { notes };
    bar.slots = { ...bar.slots, [span.trackId]: laneCopy };
    bars[entry.barIndex] = bar;
    changed = true;
  }

  return changed ? { ...section, bars } : section;
}
