/**
 * Joining a run of notes in one gesture (2S-A §8).
 *
 * Adding a hammer-on to one note costs four taps today, and there is nothing
 * that says "join these five" — measured, and written down in
 * `eval/intent-composer/FINDINGS.md` §D: seventeen taps for four links, and
 * the sheet's own primary button silently erased the articulation afterwards.
 *
 * The brush is the other shape of the same command: cover a run of onsets,
 * then decide once. What it writes is exactly what the four errands wrote —
 * the Song Contract's own `hammer_on` and `pull_off` on the note that is
 * slurred *into*. There is no new object, no span, no "legato group", and a
 * note that ends up ordinary carries no articulation at all rather than a
 * `normal` written out to look tidy.
 *
 * ## What v1 covers, and what it refuses by name
 *
 * One track, one section, as many bars and as many grids as the run crosses.
 * Every onset must be a single note on the same string, and there must be a
 * whole note at each of them — a tie continuation inside the run is somebody
 * else's note still sounding, and joining across it would claim a gesture the
 * hand does not make. Chord-to-chord, cross-string runs and section seams are
 * out of scope and say so.
 *
 * ## Direction comes from the sounding pitch
 *
 * Not from the fret number. On a fretboard drawn thickest-string-first the two
 * can point opposite ways, and a slur that disagrees with what is heard is the
 * defect, not the feature. `auto` reads the pitch; an explicit choice that
 * disagrees with the pitch is refused rather than quietly turned into the
 * other one.
 */
import { sectionSlotStream, type SlotPosition } from "@/lib/song/onset-block";
import { pitchToMidi } from "@/lib/music/pitch";
import {
  isDrumSlotArray,
  type Articulation,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

export type LegatoChoice = "auto" | "hammer_on" | "pull_off";

export type BrushRefusal =
  /* what was asked for */
  | "track_not_found"
  | "section_not_found"
  | "needs_two_notes"
  /* what the run looks like */
  | "not_one_string"
  | "chord_in_run"
  | "tie_inside_run"
  | "rest_inside_run"
  | "unplaced_note"
  | "same_pitch"
  /* what the choice would claim */
  | "wrong_direction"
  | "already_linked";

/** One onset the brush is about to work on. */
export type BrushOnset = {
  readonly barIndex: number;
  readonly slotIndex: number;
  readonly startTicks: number;
  readonly stringIndex: number;
  readonly fret: number | null;
  readonly pitch: string;
  readonly midi: number;
  readonly articulation: Articulation | undefined;
};

/** One link the brush would write: the note it lands on, and how. */
export type BrushLink = {
  readonly onset: BrushOnset;
  readonly from: BrushOnset;
  readonly kind: "hammer_on" | "pull_off";
};

export type BrushPlan =
  | {
      readonly kind: "ready";
      readonly onsets: readonly BrushOnset[];
      readonly links: readonly BrushLink[];
    }
  | { readonly kind: "refused"; readonly reason: BrushRefusal };

export type BrushRequest = {
  readonly song: Song;
  readonly trackId: string;
  readonly sectionId: string;
  /** Inclusive, in ticks from the start of the section. Exact, never rounded. */
  readonly fromTicks: number;
  readonly toTicks: number;
  readonly choice: LegatoChoice;
  /**
   * True when the reader has said, in so many words, that an existing slur
   * inside the run may be rewritten. Absent, the run fails closed.
   */
  readonly overrideExisting?: boolean;
};

const isMelodicOnset = (entry: SlotPosition): boolean =>
  entry.writable && entry.slot !== null && entry.slot !== "-" && entry.slot !== undefined;

const notesOf = (slot: MelodicSlot | undefined): readonly NoteEvent[] =>
  slot && slot !== "-" ? slot.notes : [];

const CHAIN: ReadonlySet<Articulation> = new Set<Articulation>([
  "hammer_on",
  "pull_off",
  "slide",
]);

/**
 * What the brush would write, worked out before anything is written.
 *
 * All or nothing: one bad link refuses the whole run, because a run that is
 * joined in three places and not in the fourth is not the gesture the reader
 * made.
 */
export function planBrush(request: BrushRequest): BrushPlan {
  const { song, trackId, sectionId } = request;
  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return refuse("section_not_found");
  if (!song.tracks.some((track) => track.id === trackId)) {
    return refuse("track_not_found");
  }

  const stream = sectionSlotStream(section, trackId);
  const from = Math.min(request.fromTicks, request.toTicks);
  const to = Math.max(request.fromTicks, request.toTicks);
  const covered = stream.filter(
    (entry) => entry.startTicks >= from && entry.startTicks <= to,
  );

  const onsets: BrushOnset[] = [];
  for (const entry of covered) {
    if (!entry.writable) continue;
    if (entry.slot === undefined || entry.slot === null) {
      // A rest between two covered onsets ends the sound, so the run is not
      // one gesture. A rest before the first onset is just where the brush
      // started; only the interior matters.
      if (onsets.length > 0 && hasLaterOnset(covered, entry.startTicks)) {
        return refuse("rest_inside_run");
      }
      continue;
    }
    if (entry.slot === "-") {
      if (onsets.length > 0 && hasLaterOnset(covered, entry.startTicks)) {
        return refuse("tie_inside_run");
      }
      continue;
    }
    if (!isMelodicOnset(entry)) continue;

    const notes = notesOf(entry.slot);
    if (notes.length !== 1) return refuse("chord_in_run");
    const note = notes[0]!;
    const midi = pitchToMidi(note.pitch);
    if (midi === null) return refuse("unplaced_note");
    if (!note.position) return refuse("unplaced_note");

    onsets.push({
      barIndex: entry.barIndex,
      slotIndex: entry.slotIndex,
      startTicks: entry.startTicks,
      stringIndex: note.position.string,
      fret: note.position.fret,
      pitch: note.pitch,
      midi,
      articulation: note.articulation,
    });
  }

  if (onsets.length < 2) return refuse("needs_two_notes");

  const string = onsets[0]!.stringIndex;
  if (onsets.some((onset) => onset.stringIndex !== string)) {
    return refuse("not_one_string");
  }

  const links: BrushLink[] = [];
  for (let index = 1; index < onsets.length; index += 1) {
    const onset = onsets[index]!;
    const previous = onsets[index - 1]!;

    if (
      onset.articulation !== undefined &&
      CHAIN.has(onset.articulation) &&
      request.overrideExisting !== true
    ) {
      return refuse("already_linked");
    }

    if (onset.midi === previous.midi) return refuse("same_pitch");
    const rising = onset.midi > previous.midi;

    if (request.choice === "hammer_on" && !rising) return refuse("wrong_direction");
    if (request.choice === "pull_off" && rising) return refuse("wrong_direction");

    links.push({
      onset,
      from: previous,
      kind:
        request.choice === "auto"
          ? rising
            ? "hammer_on"
            : "pull_off"
          : request.choice,
    });
  }

  return { kind: "ready", onsets, links };
}

/** True when some later slot in the covered range still starts a note. */
function hasLaterOnset(
  covered: readonly SlotPosition[],
  afterTicks: number,
): boolean {
  return covered.some(
    (entry) => entry.startTicks > afterTicks && isMelodicOnset(entry),
  );
}

export type BrushResult =
  | { readonly ok: true; readonly song: Song; readonly plan: BrushPlan & { kind: "ready" } }
  | { readonly ok: false; readonly reason: BrushRefusal };

/**
 * Write the plan, or nothing.
 *
 * The song handed in is never touched; a copy is written and given back, so
 * a preview and a commit are the same call and the ghost the reader sees is
 * the real result of the real command.
 */
export function applyBrush(request: BrushRequest): BrushResult {
  const plan = planBrush(request);
  if (plan.kind === "refused") return { ok: false, reason: plan.reason };

  const next = structuredClone(request.song);
  const section = next.sections.find((entry) => entry.id === request.sectionId);
  if (!section) return { ok: false, reason: "section_not_found" };

  for (const link of plan.links) {
    const lane = section.bars[link.onset.barIndex]?.slots[request.trackId];
    if (!Array.isArray(lane) || isDrumSlotArray(lane)) {
      return { ok: false, reason: "track_not_found" };
    }
    const slot = (lane as MelodicSlot[])[link.onset.slotIndex];
    if (!slot || slot === "-") return { ok: false, reason: "tie_inside_run" };
    const note = slot.notes[0];
    if (!note) return { ok: false, reason: "unplaced_note" };
    (lane as MelodicSlot[])[link.onset.slotIndex] = {
      notes: [{ ...note, articulation: link.kind }],
    };
  }

  return { ok: true, song: next, plan };
}

function refuse(reason: BrushRefusal): BrushPlan {
  return { kind: "refused", reason };
}

/**
 * What a refusal says out loud (2S-A §8).
 *
 * One closed table, so a code with no sentence does not compile. Nothing here
 * names an identifier, a tick or a slot: a musician is told what happened to
 * their music.
 */
export const BRUSH_MESSAGES: Readonly<Record<BrushRefusal, string>> = {
  track_not_found: "Bu track bulunamadı.",
  section_not_found: "Bu bölüm bulunamadı.",
  needs_two_notes: "Bağlamak için en az iki nota seçmelisin.",
  not_one_string:
    "Bu notaların hepsi aynı telde değil. Bu sürümde yalnız tek telde " +
    "art arda gelen notalar bağlanabilir.",
  chord_in_run:
    "Seçimde birden fazla sesi olan bir vuruş var. Bu sürümde yalnız tek " +
    "notalar bağlanabilir.",
  tie_inside_run:
    "Seçimin içinde önceki notanın devamı var. Bağlamadan önce o notayı " +
    "burada bitirmelisin.",
  rest_inside_run:
    "Seçimin içinde sessizlik var. Bağlanacak notaların arası boş olamaz.",
  unplaced_note:
    "Seçimdeki notalardan biri bu akortta bir tele yerleşmiyor, bu yüzden " +
    "bağlanamıyor.",
  same_pitch:
    "Aynı sesten aynı sese bağ olmaz. Bağlamak için notaların perdesi " +
    "farklı olmalı.",
  wrong_direction:
    "Bu yön bu notalara uymuyor. Çekiç yukarı, koparma aşağı gider; " +
    "“Otomatik bağla” hangisinin doğru olduğunu kendisi seçer.",
  already_linked:
    "Bu notalardan biri zaten bağlı. Üzerine yazmak için bunu açıkça " +
    "seçmelisin.",
};

export function brushMessage(reason: BrushRefusal): string {
  return BRUSH_MESSAGES[reason];
}
