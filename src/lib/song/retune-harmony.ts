/**
 * "Keep the rhythm, change the chord" (2T §11, 2T-B §3.2).
 *
 * This is the first arrangement primitive, and it is the one that makes the
 * claim about being more than a tab editor concrete. A tab editor lets you
 * write a figure. An arranger lets you say *what the figure is* and then ask
 * for it again over different harmony — same groove, same picking hand, new
 * chord.
 *
 * ## What is kept, and why that is the whole point
 *
 * Everything that makes the figure the figure:
 *
 * - **when** each note happens, exactly, to the tick;
 * - **how long** each note is, including a ringing pedal voice;
 * - **which articulation** it carries — a palm mute stays a palm mute;
 * - **which voice of the chord** it was, so a bass-note-then-treble pattern
 *   stays a bass-note-then-treble pattern;
 * - **let-ring and strum intent**, because those are the picking hand;
 * - and — this is the correction — **the shape of every note that is not in
 *   the chord at all**.
 *
 * ## The two kinds of note, and why the difference is everything
 *
 * A figure is not a list of chord tones. It is chord tones with things
 * *between* them: an upper neighbour, a chromatic approach, a passing note on
 * the way from the third to the fifth. Those notes are the reason the figure
 * sounds like a phrase rather than an arpeggio.
 *
 * The first version of this module snapped every pitch to the nearest note of
 * the target chord. That is wrong, and it is wrong in a way that destroys
 * exactly the notes that carry the phrasing: a `9–10–9` upper-neighbour cell
 * comes back as `x–x–x`, three strikes of one note, because the neighbour's
 * nearest chord tone is the note it was decorating. The figure survives as
 * rhythm and dies as music.
 *
 * So notes are read as two kinds:
 *
 * - A **chord tone** is a voice of the harmony. It moves to *the same voice*
 *   of the target chord — first voice to first voice, not "nearest pitch".
 *   That is what makes a drop voicing come out as a drop voicing.
 * - An **ornament** is everything else. It does not get a chord tone at all.
 *   It keeps its exact semitone distance from the structural note it was
 *   attached to, so `9–10–9` stays `x–(x+1)–x`, an approach note stays one
 *   semitone below its target, and a passing note still passes.
 *
 * Where an ornament has nothing to attach to, the module says so — a typed
 * warning the preview can show — and falls back to moving it by the interval
 * between the two roots. That keeps its shape and is not a snap. What it will
 * not do is quietly glue it onto a chord tone and call the figure transposed.
 *
 * ## Local, deterministic, and refusing rather than guessing
 *
 * No provider is involved and no model is asked. The same figure and the same
 * target produce the same answer every time. Where a note cannot be resolved
 * onto the instrument — off the end of the fretboard, or not in the tuning —
 * the whole transform is refused with a typed reason. Half a transposed riff
 * is worse than none, because the reader would have to find the half that
 * moved.
 */
import { midiToPitch, pitchClass, pitchToMidi } from "@/lib/music/pitch";
import {
  isMelodicSlotArray,
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

/** A chord named by its root and the notes it actually contains. */
export type Harmony = {
  /** "E", "A#", "Bb" — the root's pitch class name. */
  readonly root: string;
  /**
   * Semitones above the root that belong to this chord, in voice order.
   *
   * A power chord is [0, 7]; a minor triad [0, 3, 7]; a major [0, 4, 7]. The
   * order is the voicing, and it is what a chord tone is mapped by, so a drop
   * voicing that puts the third an octave up says [0, 15, 7] and gets a third
   * an octave up back. Values above 11 are octave placement; the note's
   * *identity* is always read modulo 12.
   *
   * The caller says what the chord is rather than the module inferring it
   * from a name, because "Am7add11" is a parsing problem and this is not a
   * parser.
   */
  readonly intervals: readonly number[];
};

export type RetuneTarget = {
  readonly sectionId: string;
  readonly barIndex: number;
  readonly trackId: string;
  readonly fromSlot: number;
  /** Exclusive. The run of slots the figure occupies. */
  readonly toSlot: number;
};

export type RetuneFailure =
  | "target_not_found"
  | "not_a_melodic_track"
  | "empty_selection"
  | "unknown_root"
  | "unreachable_pitch";

/** What a note is, relative to the chord it is written over. */
export type PitchRole =
  | { readonly kind: "chord_tone"; readonly voiceIndex: number; readonly degree: number }
  | { readonly kind: "ornament"; readonly degree: number };

export type RetuneWarningKind =
  /** Nothing structural in the run to measure this ornament against. */
  | "unanchored_ornament"
  /** The target chord has fewer voices than the source, so a voice doubled up. */
  | "voice_folded"
  /** A hammer-on that would now descend, or a pull-off that would now climb. */
  | "articulation_inverted";

/**
 * Something the reader should see *before* applying, not discover after.
 *
 * A warning is not a refusal. It is the module declining to pretend: the
 * transform is complete and every note moved, but one of them moved by a rule
 * weaker than the others, and saying so is cheaper than being found out.
 */
export type RetuneWarning = {
  readonly kind: RetuneWarningKind;
  /** The pitch as it was written, so a preview can point at it. */
  readonly pitch: string;
  readonly slotIndex: number;
  readonly message: string;
};

export type RetuneMove = {
  readonly from: string;
  readonly to: string;
  readonly slotIndex: number;
  readonly role: "chord_tone" | "ornament";
  /** For an ornament, the note it measured itself against. */
  readonly anchor?: string;
};

export type RetuneResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** What moved where, for a preview to show before anything is applied. */
      readonly moves: readonly RetuneMove[];
      readonly warnings: readonly RetuneWarning[];
    }
  | { readonly ok: false; readonly reason: RetuneFailure; readonly detail?: string };

const PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** An interval's identity, with octave placement taken off it. */
const degreeOf = (interval: number): number => ((interval % 12) + 12) % 12;

/**
 * What this pitch is doing in this chord.
 *
 * Returns null only when the chord's root or the pitch itself is unreadable —
 * a note that is simply not in the chord is an answer, not a failure.
 */
export function pitchRole(pitch: string, harmony: Harmony): PitchRole | null {
  const root = PITCH_CLASSES[harmony.root];
  const cls = pitchClass(pitch);
  if (root === undefined || cls === null) return null;

  const degree = (cls - root + 12) % 12;
  const voiceIndex = harmony.intervals.findIndex(
    (interval) => degreeOf(interval) === degree,
  );
  return voiceIndex >= 0
    ? { kind: "chord_tone", voiceIndex, degree }
    : { kind: "ornament", degree };
}

/** The target interval closest to a degree, ties going to the lower. */
function nearestInterval(
  degree: number,
  intervals: readonly number[],
): number | undefined {
  return [...intervals].sort((a, b) => {
    const da = Math.min(Math.abs(degreeOf(a) - degree), 12 - Math.abs(degreeOf(a) - degree));
    const db = Math.min(Math.abs(degreeOf(b) - degree), 12 - Math.abs(degreeOf(b) - degree));
    return da === db ? a - b : da - db;
  })[0];
}

/**
 * Move a chord tone onto the same voice of another chord.
 *
 * The note's octave region is kept: the distance from its own root is taken
 * off, the roots are exchanged, and the target voice's interval is put back.
 * So the root of a figure stays its root and the second voice stays the
 * second voice, whatever interval that voice happens to be.
 *
 * Null for a pitch that is not a tone of `from` at all. An ornament needs to
 * know what it is decorating, and that is context this function does not
 * have — `retuneHarmony` is where it exists.
 */
export function retunePitch(
  pitch: string,
  from: Harmony,
  to: Harmony,
): string | null {
  const role = pitchRole(pitch, from);
  if (role === null || role.kind !== "chord_tone") return null;
  const moved = moveChordTone(pitch, from, to, role);
  return moved === null ? null : midiToPitch(moved.midi);
}

type Moved = { readonly midi: number; readonly folded: boolean };

function moveChordTone(
  pitch: string,
  from: Harmony,
  to: Harmony,
  role: { readonly voiceIndex: number; readonly degree: number },
): Moved | null {
  const fromRoot = PITCH_CLASSES[from.root];
  const toRoot = PITCH_CLASSES[to.root];
  const midi = pitchToMidi(pitch);
  if (fromRoot === undefined || toRoot === undefined || midi === null) return null;

  const direct = to.intervals[role.voiceIndex];
  const interval = direct ?? nearestInterval(role.degree, to.intervals);
  if (interval === undefined) return null;

  const shifted = midi - role.degree + (toRoot - fromRoot) + interval;
  if (shifted < 0 || shifted > 127) return null;
  return { midi: shifted, folded: direct === undefined };
}

type Event = {
  readonly slotIndex: number;
  readonly noteIndex: number;
  readonly note: NoteEvent;
  readonly midi: number;
  readonly stringIndex: number | null;
  readonly role: PitchRole;
};

/**
 * The structural note an ornament belongs to.
 *
 * Same string first, because an ornament is a finger moving on one string and
 * the note it left is the note it means. Then nearest in time, with a tie
 * going to the *later* one: a note equally close to what came before and what
 * comes next is usually leading into what comes next.
 */
function anchorFor(
  event: Event,
  structural: readonly Event[],
): Event | undefined {
  const sameString = structural.filter(
    (other) => other.stringIndex !== null && other.stringIndex === event.stringIndex,
  );
  const pool = sameString.length > 0 ? sameString : structural;
  return [...pool].sort((a, b) => {
    const da = Math.abs(a.slotIndex - event.slotIndex);
    const db = Math.abs(b.slotIndex - event.slotIndex);
    if (da !== db) return da - db;
    if (a.slotIndex !== b.slotIndex) return b.slotIndex - a.slotIndex;
    return a.noteIndex - b.noteIndex;
  })[0];
}

/** A hammer-on climbs and a pull-off falls. Anything else is a contradiction. */
function inverted(articulation: string | undefined, rise: number): boolean {
  if (articulation === "hammer_on") return rise <= 0;
  if (articulation === "pull_off") return rise >= 0;
  return false;
}

/**
 * Apply a new harmony to a run of slots, keeping everything but the pitches.
 *
 * Positions are dropped rather than recomputed: a fret is a claim about where
 * a pitch sits on this instrument, and the placement engine owns that claim.
 * Keeping a stale fret beside a new pitch would be the one thing worse than
 * dropping it — a tab that shows a number which does not produce the note
 * beside it.
 */
export function retuneHarmony(
  song: Song,
  target: RetuneTarget,
  from: Harmony,
  to: Harmony,
): RetuneResult {
  const fromRoot = PITCH_CLASSES[from.root];
  const toRoot = PITCH_CLASSES[to.root];
  if (fromRoot === undefined || toRoot === undefined) {
    return { ok: false, reason: "unknown_root" };
  }
  const sectionIndex = song.sections.findIndex((entry) => entry.id === target.sectionId);
  if (sectionIndex < 0) return { ok: false, reason: "target_not_found" };
  const bar = song.sections[sectionIndex]!.bars[target.barIndex];
  if (!bar) return { ok: false, reason: "target_not_found" };
  const slots = bar.slots[target.trackId];
  if (!slots) return { ok: false, reason: "target_not_found" };
  if (!isMelodicSlotArray(slots)) return { ok: false, reason: "not_a_melodic_track" };

  /* Read the whole run first: an ornament cannot be placed until the
   * structural notes around it have been. */
  const events: Event[] = [];
  for (let slotIndex = target.fromSlot; slotIndex < target.toSlot; slotIndex += 1) {
    const slot = slots[slotIndex];
    if (slot === undefined || slot === null || slot === "-") continue;
    for (const [noteIndex, note] of slot.notes.entries()) {
      const role = pitchRole(note.pitch, from);
      const midi = pitchToMidi(note.pitch);
      if (role === null || midi === null) {
        return {
          ok: false,
          reason: "unreachable_pitch",
          detail: `${note.pitch} okunamadı.`,
        };
      }
      events.push({ slotIndex, noteIndex, note, midi, stringIndex: note.position?.string ?? null, role });
    }
  }
  if (events.length === 0) return { ok: false, reason: "empty_selection" };

  const warnings: RetuneWarning[] = [];
  const placed = new Map<Event, number>();

  /* Pass one: the chord tones, each onto its own voice of the target. */
  for (const event of events) {
    if (event.role.kind !== "chord_tone") continue;
    const moved = moveChordTone(event.note.pitch, from, to, event.role);
    if (moved === null) {
      return {
        ok: false,
        reason: "unreachable_pitch",
        detail: `${event.note.pitch} bu armonide karşılanamadı.`,
      };
    }
    if (moved.folded) {
      warnings.push({
        kind: "voice_folded",
        pitch: event.note.pitch,
        slotIndex: event.slotIndex,
        message: `${event.note.pitch}: hedef akorda bu sesin kendi payı yok, en yakın akor sesine katlandı.`,
      });
    }
    placed.set(event, moved.midi);
  }

  /* Pass two: the ornaments, each keeping its distance from what it decorates. */
  const structural = events.filter((event) => placed.has(event));
  const anchors = new Map<Event, Event>();
  for (const event of events) {
    if (placed.has(event)) continue;
    const anchor = anchorFor(event, structural);
    if (anchor === undefined) {
      warnings.push({
        kind: "unanchored_ornament",
        pitch: event.note.pitch,
        slotIndex: event.slotIndex,
        message: `${event.note.pitch}: bağlanacak akor sesi yok, yalnız kök aralığı kadar taşındı.`,
      });
      placed.set(event, event.midi + (toRoot - fromRoot));
      continue;
    }
    anchors.set(event, anchor);
    placed.set(event, placed.get(anchor)! + (event.midi - anchor.midi));
  }

  for (const [, midi] of placed) {
    if (midi < 0 || midi > 127) {
      return {
        ok: false,
        reason: "unreachable_pitch",
        detail: "Sonuç enstrümanın dışına düştü.",
      };
    }
  }

  /* Pass three: did any legato slur end up pointing the wrong way? */
  for (const [index, event] of events.entries()) {
    const previous = [...events.slice(0, index)]
      .reverse()
      .find((other) => other.stringIndex === event.stringIndex);
    if (previous === undefined) continue;
    const before = event.midi - previous.midi;
    const after = placed.get(event)! - placed.get(previous)!;
    if (inverted(event.note.articulation, before)) continue;
    if (!inverted(event.note.articulation, after)) continue;
    warnings.push({
      kind: "articulation_inverted",
      pitch: event.note.pitch,
      slotIndex: event.slotIndex,
      message: `${event.note.pitch}: yeni akorda bağ yönü tersine döndü, elle kontrol edin.`,
    });
  }

  const moves: RetuneMove[] = [];
  const rebuilt = new Map<number, NoteEvent[]>();
  for (const event of events) {
    const pitch = midiToPitch(placed.get(event)!);
    const note: NoteEvent = { ...event.note, pitch };
    /* The placement engine owns where a pitch sits; a stale fret is a lie. */
    delete note.position;
    rebuilt.set(event.slotIndex, [...(rebuilt.get(event.slotIndex) ?? []), note]);
    const anchor = anchors.get(event);
    moves.push({
      from: event.note.pitch,
      to: pitch,
      slotIndex: event.slotIndex,
      role: event.role.kind === "chord_tone" ? "chord_tone" : "ornament",
      ...(anchor === undefined ? {} : { anchor: anchor.note.pitch }),
    });
  }

  const next: MelodicSlot[] = [...slots];
  for (const [slotIndex, notes] of rebuilt) next[slotIndex] = { notes };

  const candidate: Song = {
    ...song,
    sections: song.sections.map((section, index) =>
      index !== sectionIndex
        ? section
        : {
            ...section,
            bars: section.bars.map((entry, barIndex) =>
              barIndex !== target.barIndex
                ? entry
                : { ...entry, slots: { ...entry.slots, [target.trackId]: next } },
            ),
          },
    ),
  };

  const parsed = songSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: "unreachable_pitch", detail: "Sonuç şemaya uymadı." };
  }
  return { ok: true, song: parsed.data, moves, warnings };
}
