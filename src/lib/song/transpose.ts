/**
 * Two things a reader means by "transpose" (2V-B.4 §15, §16).
 *
 * ## One button was two questions
 *
 * "Move this up a semitone" and "put this song in G minor" are different
 * intentions with different scopes, different consequences and different
 * failure modes, and a single control called *Transpose* makes the reader
 * guess which one they are getting. So there are two:
 *
 * - **Sesi taşı** — move what is held up or down by an interval. The scope is
 *   whatever the reader is holding, the key of the song is not their subject,
 *   and it never changes.
 * - **Tonu değiştir** — put a selection, a section or the whole song into
 *   another key. Here the key *is* the subject, and when the scope is the
 *   whole song the song's own key metadata moves with it.
 *
 * ## What must survive both
 *
 * Rhythm, duration, phrases, velocity, articulation timing, ties and the
 * links a legato chain is made of. A transposition is a change of pitch and
 * of nothing else — which is exactly why it is dangerous, because everything
 * else in the note travels with it and a careless implementation drops the
 * parts it did not think about.
 *
 * Drums do not move. A kick is not a pitch, and transposing a kit is not a
 * musical operation at all.
 *
 * ## Playability, not arithmetic
 *
 * A guitar is not a MIDI keyboard. Adding two semitones to every number can
 * produce a fret that does not exist, a string that cannot reach, or a shape
 * no hand can hold. So a written position is re-derived against the track's
 * own fretboard — its tuning, its capo, its range — and when it cannot be, the
 * result is a refusal that names the note rather than a silent drop.
 */
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import { parseKey } from "@/lib/music/tonality";
import { maxCapoRelativeFret, soundingMidi } from "@/lib/music/fretboard";
import { ticksPerBar, ticksPerSlot } from "@/lib/music/timing";
import { settle } from "@/lib/song/edit";
import {
  isDrumSlotArray,
  type Fretboard,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

/** How far a "Sesi taşı" step moves, in the reader's own words. */
export const PITCH_MOVES = [
  { id: "down_semitone", label: "Yarım ses aşağı", semitones: -1 },
  { id: "up_semitone", label: "Yarım ses yukarı", semitones: 1 },
  { id: "down_tone", label: "Tam ses aşağı", semitones: -2 },
  { id: "up_tone", label: "Tam ses yukarı", semitones: 2 },
] as const;

export type PitchMoveId = (typeof PITCH_MOVES)[number]["id"];

/** What a key change may be about. */
export const TRANSPOSE_SCOPES = ["selection", "section", "song"] as const;
export type TransposeScope = (typeof TRANSPOSE_SCOPES)[number];

export const TRANSPOSE_SCOPE_LABEL: Readonly<Record<TransposeScope, string>> = {
  selection: "Seçim",
  section: "Bölüm",
  song: "Şarkı",
};

/** Which music a transposition is allowed to touch. */
export type TransposeTarget = {
  readonly scope: TransposeScope;
  /** Required for `selection` and `section`. */
  readonly sectionId?: string;
  /** Half-open, in ticks from the start of the section. `selection` only. */
  readonly fromTicks?: number;
  readonly toTicks?: number;
  /** `selection` only: which track the held range belongs to. */
  readonly trackId?: string;
};

export type TransposeFailure =
  | { readonly code: "no_target"; readonly message: string }
  | { readonly code: "out_of_range"; readonly message: string }
  | { readonly code: "not_playable"; readonly message: string }
  | { readonly code: "rejected"; readonly message: string };

export type TransposeResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** How far everything moved. Reported, so a caller can say it. */
      readonly semitones: number;
      /** The song's key after the change; unchanged unless the scope was the song. */
      readonly key: string;
      /** Notes that had to find a new string to stay playable. */
      readonly restrung: number;
    }
  | { readonly ok: false; readonly error: TransposeFailure };

/**
 * The fret that sounds this midi on this string, or null.
 *
 * The same arithmetic `transform.ts` does for its own vertical moves. It is
 * repeated rather than exported from there because that module is the bar
 * transform engine and this one is a song-wide command: an import between
 * them would be the smaller file reaching into the larger one for four lines.
 */
function fretFor(fretboard: Fretboard, stringIndex: number, midi: number): number | null {
  const open = soundingMidi(fretboard, { string: stringIndex, fret: 0 });
  if (open === null) return null;
  const fret = midi - open;
  if (!Number.isInteger(fret) || fret < 0 || fret > maxCapoRelativeFret(fretboard.capo)) {
    return null;
  }
  return fret;
}

/**
 * Where a note may be played after the move.
 *
 * The same string first, because a guitarist who moves a riff up a tone
 * expects it under the same fingers. Only when that fret does not exist does
 * this look at the neighbours, and it prefers the closest one — the smallest
 * change to the hand that keeps the music playable.
 */
function replace(
  fretboard: Fretboard,
  note: NoteEvent,
  midi: number,
): { position: NoteEvent["position"]; restrung: boolean } | null {
  const written = note.position;
  if (!written) return { position: undefined, restrung: false };

  const same = fretFor(fretboard, written.string, midi);
  if (same !== null) return { position: { string: written.string, fret: same }, restrung: false };

  const order = fretboard.tuning
    .map((_, index) => index)
    .filter((index) => index !== written.string)
    .sort((left, right) => Math.abs(left - written.string) - Math.abs(right - written.string));

  for (const string of order) {
    const fret = fretFor(fretboard, string, midi);
    if (fret !== null) return { position: { string, fret }, restrung: true };
  }
  return null;
}

type Moved = { readonly note: NoteEvent; readonly restrung: boolean };

function moveNote(
  note: NoteEvent,
  semitones: number,
  fretboard: Fretboard | undefined,
): Moved | TransposeFailure {
  const midi = pitchToMidi(note.pitch);
  if (midi === null) {
    return { code: "out_of_range", message: `"${note.pitch}" notası okunamadı.` };
  }
  const next = midi + semitones;
  const pitch = midiToPitch(next);
  if (!pitch) {
    return {
      code: "out_of_range",
      message: "Bu kadar taşıyınca bazı notalar duyulabilir aralığın dışına çıkıyor.",
    };
  }
  if (!fretboard) {
    /* A keyboard or another pitched instrument with no fretboard: the pitch
       is the whole of the position, so there is nothing to re-derive. */
    return { note: { ...note, pitch }, restrung: false };
  }
  const placed = replace(fretboard, note, next);
  if (!placed) {
    return {
      code: "not_playable",
      message: `"${note.pitch}" bu enstrümanda taşındığı yerde çalınamıyor. Akort, capo ya da hedef tonu değiştirmeyi dene.`,
    };
  }
  return {
    note: {
      ...note,
      pitch,
      ...(placed.position ? { position: placed.position } : {}),
    },
    restrung: placed.restrung,
  };
}

const isFailure = (value: unknown): value is TransposeFailure =>
  typeof value === "object" && value !== null && "code" in value;

/** Does this bar-relative tick range overlap the target? */
function targetsBar(
  target: TransposeTarget,
  sectionId: string,
  barStartTicks: number,
  barTicks: number,
): boolean {
  if (target.scope === "song") return true;
  if (target.sectionId !== sectionId) return false;
  if (target.scope === "section") return true;
  const from = target.fromTicks ?? 0;
  const to = target.toTicks ?? 0;
  return barStartTicks < to && barStartTicks + barTicks > from;
}

/**
 * Move every pitch the target covers, and nothing else.
 *
 * One pass, one candidate song, one `settle`. A partially transposed song is
 * never produced — the first note that cannot move refuses the whole thing,
 * which is what makes undo a single step and redo byte-exact.
 */
export function transposeSong(
  song: Song,
  input: {
    readonly semitones: number;
    readonly target: TransposeTarget;
    /** Set only by "Tonu değiştir" on the whole song. */
    readonly nextKey?: string;
  },
): TransposeResult {
  const { nextKey, semitones, target } = input;
  if (semitones === 0) {
    return { ok: true, song, semitones: 0, key: song.key, restrung: 0 };
  }
  if (target.scope !== "song" && !target.sectionId) {
    return { ok: false, error: { code: "no_target", message: "Taşınacak bir alan seçilmedi." } };
  }

  const fretboards = new Map(
    song.tracks.map((track) => [track.id, track.fretboard] as const),
  );
  let restrung = 0;
  let touched = 0;
  let failure: TransposeFailure | null = null;

  const sections = song.sections.map((section) => {
    let barStart = 0;
    const bars = section.bars.map((bar) => {
      /* The one timing owner, not arithmetic repeated here (K-34). */
      const step = ticksPerSlot(bar.resolution);
      const barTicks = ticksPerBar(bar.timeSignature, bar.resolution);
      const here = targetsBar(target, section.id, barStart, barTicks);
      barStart += barTicks;
      if (!here || failure) return bar;

      const slots: Record<string, unknown> = { ...bar.slots };
      for (const [trackId, lane] of Object.entries(bar.slots)) {
        /* Drums never move (§15). A kit has no key to be in. */
        if (isDrumSlotArray(lane)) continue;
        if (target.scope === "selection" && target.trackId && target.trackId !== trackId) {
          continue;
        }
        const fretboard = fretboards.get(trackId);
        const next = (lane as readonly MelodicSlot[]).map((slot, index) => {
          if (slot === null || slot === "-") return slot;
          if (target.scope === "selection") {
            const at = barStart - barTicks + index * step;
            const from = target.fromTicks ?? 0;
            const to = target.toTicks ?? 0;
            if (at < from || at >= to) return slot;
          }
          const notes: NoteEvent[] = [];
          for (const note of slot.notes) {
            const moved = moveNote(note, semitones, fretboard);
            if (isFailure(moved)) {
              failure = moved;
              return slot;
            }
            if (moved.restrung) restrung += 1;
            touched += 1;
            notes.push(moved.note);
          }
          return { notes };
        });
        slots[trackId] = next;
      }
      return { ...bar, slots: slots as typeof bar.slots };
    });
    return { ...section, bars };
  });

  if (failure) return { ok: false, error: failure };
  if (touched === 0) {
    return {
      ok: false,
      error: { code: "no_target", message: "Bu alanda taşınacak nota yok." },
    };
  }

  /*
   * The key travels with the whole song and with nothing smaller (§15).
   *
   * A reader who transposes four bars has not changed what key the song is
   * in, and writing a new key for them would be the app claiming to know
   * something about their music that it does not.
   */
  const key = target.scope === "song" && nextKey ? nextKey : song.key;

  const settled = settle({ ...song, sections, key });
  if (!settled.ok) {
    return { ok: false, error: { code: "rejected", message: settled.error.message } };
  }
  return { ok: true, song: settled.song, semitones, key, restrung };
}

/** The twelve keys a picker offers, in both modes. */
export const KEY_CHOICES: readonly string[] = [
  "C major",
  "G major",
  "D major",
  "A major",
  "E major",
  "F major",
  "Bb major",
  "Eb major",
  "A minor",
  "E minor",
  "B minor",
  "F# minor",
  "D minor",
  "G minor",
  "C minor",
];

/**
 * How far it is from one key to another, in semitones.
 *
 * Always the shorter way round, so "E minor to F minor" moves everything up
 * one rather than down eleven — the same music, and a hand position a
 * guitarist would recognise.
 */
export function semitonesBetween(from: string, to: string): number | null {
  const a = parseKey(from);
  const b = parseKey(to);
  if (!a || !b) return null;
  const raw = (((b.tonicPc - a.tonicPc) % 12) + 12) % 12;
  return raw > 6 ? raw - 12 : raw;
}
