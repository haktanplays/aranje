/**
 * Every task, bound to the song actually being tested (2V-B.1 §12).
 *
 * A descriptor is what a step becomes once it has met a Song. It carries the
 * build, the session, the Song's own fingerprint and title, the section, the
 * bar, the track and the selection — and the instruction is *generated* from
 * those rather than typed out beside them. Two things follow, and both are
 * the point:
 *
 * - A step whose passage the Song does not have cannot produce a task. It
 *   produces a typed refusal instead, and the round is not entitled to pass
 *   it. Asking a guitarist to listen to a slide that is not there is how the
 *   last two rounds spent a founder's evening.
 * - A founder who opens a different Song gets different questions, with the
 *   new title and the new fingerprint on screen, rather than the old
 *   instructions pointing at music that has moved.
 *
 * ## The fingerprint chain
 *
 * A task binds to the fingerprint of the Song it was written against. An
 * accepted action produces a new fingerprint, and the next task binds to
 * *that* — so a step cannot be satisfied by an event from a Song two edits
 * ago, and a cleanup that restores the canonical bytes is checkable against
 * the fingerprint the chain started on.
 */
import type {
  BatchPassage,
  BatchStep,
  BatchStepId,
} from "@/lib/acceptance/batch-steps";
import type { SongSupport } from "@/lib/acceptance/song-support";
import type { WorkspaceEdit } from "@/lib/song/workspace-events";

/** Why a step cannot be asked of this Song. Typed, never free text. */
export type UnsupportedReason =
  | "no_written_bar"
  | "no_held_power_chord"
  | "no_slide"
  | "no_vibrato"
  | "no_legato"
  | "no_shared_bar";

export type TaskDescriptor = {
  readonly stepId: BatchStepId;
  readonly buildSha: string;
  readonly sessionId: string;
  /** The Song this task expects to act on. */
  readonly songFingerprint: string;
  readonly songTitle: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly barKey: string;
  readonly barNumber: number;
  readonly trackId: string;
  readonly trackName: string;
  /** What is to be held, in the words a guitarist uses. */
  readonly selection: string;
  /** The production action this step is waiting for, or null for a read. */
  readonly requiredAction: WorkspaceEdit["action"] | null;
  /** The record's revision when the step began. */
  readonly expectedRevision: number;
  /** The instruction, generated from the fields above. */
  readonly task: string;
};

export type TaskEnvelope =
  | { readonly ok: true; readonly descriptor: TaskDescriptor }
  | { readonly ok: false; readonly stepId: BatchStepId; readonly reason: UnsupportedReason };

/** Which support a passage needs, and what to call its absence. */
const MISSING: Readonly<Record<Exclude<BatchPassage, "none">, UnsupportedReason>> = {
  any_written_bar: "no_written_bar",
  held_power_chord: "no_held_power_chord",
  slide: "no_slide",
  vibrato: "no_vibrato",
  legato: "no_legato",
  shared_bar: "no_shared_bar",
};

/** What a step is waiting to see the editor do. Null for a reading step. */
const REQUIRED_ACTION: Readonly<Record<BatchStepId, WorkspaceEdit["action"] | null>> = {
  extend: null,
  openMore: null,
  listenOnce: null,
  listenLoop: null,
  pauseResume: null,
  copyPaste: "paste",
  duplicate: "duplicate",
  move: "move",
  repeat: "repeat",
  deleteUndo: "delete",
  trackScope: null,
  measureScope: null,
  finish: null,
};

/**
 * The instruction, written from the descriptor's own fields.
 *
 * Everything a reader is told here — the section, the bar number, the track
 * name, the string, the frets — came from reading the Song. There is no
 * sentence in this function that names a passage the caller has not already
 * proved is there.
 */
function instructionFor(
  step: BatchStep,
  support: SongSupport,
  place: {
    readonly sectionName: string;
    readonly barNumber: number;
    readonly trackName: string;
  },
): string {
  const where = `${place.sectionName} · ${place.trackName} · ${place.barNumber}. ölçü`;
  switch (step.id) {
    case "extend":
      return `${where}: ilk power chord'a basılı tut, sonra «Devam»a dokun ve ileride bir yere uzun bas.`;
    case "openMore":
      return `${where}: birkaç notaya basılı tutup sağa sürükle, sonra «Daha fazla»ya dokun.`;
    case "listenOnce":
      return `${where}: bir aralık seç ve «Seçimi dinle»ye dokun.`;
    case "listenLoop":
      return `${where}: aynı seçimde «Seçimden döngü»ye dokun, en az üç tur dinle, sonra «Seçim döngüsünü kapat»a dokun.`;
    case "pauseResume": {
      const slide = support.slide;
      return slide
        ? `${slide.trackName} · ${slide.barNumber}. ölçü: ${slide.stringName} telindeki ${slide.fromFret}→${slide.toFret} slide sırasında duraklat, sonra devam et.`
        : `${where}: çalarken duraklat, sonra devam et.`;
    }
    case "copyPaste":
      return `${where}: «Kopyala»ya dokun, boş bir yer seçip «Yapıştır» ile uygula; sonra «Geri al», sonra «İleri al».`;
    case "duplicate":
      return `${where}: bir seçim yap, «Çoğalt»a dokun, sonra «Geri al» ve «İleri al».`;
    case "move":
      return `${where}: bir seçim yap, «Taşı» ile bir adım sağa taşı ve uygula; sonra «Geri al» ve «İleri al».`;
    case "repeat":
      return `${where}: bir seçim yap, «Tekrarla» ile iki kez tekrarla ve uygula; sonra «Geri al» ve «İleri al».`;
    case "deleteUndo":
      /*
       * The two sentences §14 fixes, word for word, and then the redo.
       * The *question* is what §14 pins; asking for one more press does not
       * change it, and without a redo there is no `redoHash` for the delete
       * row of the ledger §5 asks for.
       */
      return "Seçili notaları sil. Notalar kaybolunca Geri al'a dokun. Aynı notalar aynı yere geri geldi mi? Sonra «İleri al»a dokun.";
    case "trackScope":
      return `${place.trackName} satırındaki ${place.barNumber}. ölçüye basılı tut ve «Seçimi dinle»ye dokun.`;
    case "measureScope": {
      const shared = support.sharedBar;
      const names = shared ? shared.trackNames.join(" ve ") : place.trackName;
      return `Üstteki ${place.barNumber} numaralı ölçü başlığına basılı tut ve «Seçimi dinle»ye dokun; ${names} birlikte duyulmalı.`;
    }
    case "finish":
      return "Aşağıdaki bloğu kopyala ve gönder.";
  }
}

/**
 * Which passage of the Song this step is about, or why there is none.
 *
 * `any_written_bar` deliberately falls back to the first bar with anything in
 * it rather than to bar 1: a Song whose first bar is empty is a Song where
 * "select some notes in bar 1" is an instruction nobody can follow.
 */
function passageOf(
  passage: BatchPassage,
  support: SongSupport,
):
  | { readonly ok: true; readonly place: NonNullable<SongSupport["firstWrittenBar"]> }
  | { readonly ok: false; readonly reason: UnsupportedReason }
  | { readonly ok: "none" } {
  if (passage === "none") return { ok: "none" };
  const found =
    passage === "any_written_bar"
      ? support.firstWrittenBar
      : passage === "held_power_chord"
        ? support.heldPowerChord
        : passage === "slide"
          ? support.slide
          : passage === "vibrato"
            ? support.vibrato
            : passage === "legato"
              ? support.legato
              : support.sharedBar === null
                ? null
                : {
                    barKey: support.sharedBar.barKey,
                    barNumber: support.sharedBar.barNumber,
                    sectionId: support.sharedBar.sectionId,
                    sectionName: support.sharedBar.sectionName,
                    trackId: support.sharedBar.trackIds[0] ?? "",
                    trackName: support.sharedBar.trackNames.join(" ve "),
                    slotIndex: 0,
                  };
  if (!found) return { ok: false, reason: MISSING[passage] };
  return { ok: true, place: found };
}

export function describeTask(input: {
  readonly step: BatchStep;
  readonly support: SongSupport;
  readonly buildSha: string;
  readonly sessionId: string;
  /** The fingerprint this task binds to — the chain's current link. */
  readonly songFingerprint: string;
  readonly revision: number;
}): TaskEnvelope {
  const { step, support } = input;
  const found = passageOf(step.passage, support);
  if (found.ok === false) {
    return { ok: false, stepId: step.id, reason: found.reason };
  }

  const place =
    found.ok === "none"
      ? {
          barKey: "",
          barNumber: 0,
          sectionId: "",
          sectionName: "",
          trackId: "",
          trackName: "",
          slotIndex: 0,
        }
      : found.place;

  return {
    ok: true,
    descriptor: {
      stepId: step.id,
      buildSha: input.buildSha,
      sessionId: input.sessionId,
      songFingerprint: input.songFingerprint,
      songTitle: support.title,
      sectionId: place.sectionId,
      sectionName: place.sectionName,
      barKey: place.barKey,
      barNumber: place.barNumber,
      trackId: place.trackId,
      trackName: place.trackName,
      selection:
        place.barNumber === 0
          ? "—"
          : `${place.trackName} · ${place.barNumber}. ölçü`,
      requiredAction: REQUIRED_ACTION[step.id],
      expectedRevision: input.revision,
      task: instructionFor(step, support, place),
    },
  };
}

/** Why a production event does not belong to the task on screen. */
export type EventRefusal =
  | "wrong_build"
  | "wrong_session"
  | "wrong_song"
  | "wrong_step"
  | "wrong_action"
  | "wrong_track"
  | "wrong_bar"
  | "stale_revision";

export type EventVerdict =
  | { readonly accepted: true; readonly nextFingerprint: string }
  | { readonly accepted: false; readonly refusal: EventRefusal };

/**
 * Does this event satisfy the task on screen?
 *
 * The rejection list is §13's, and every item is a real way a green run could
 * be produced by something other than the reader doing the step: a stale tab
 * on an older build, a second session, an event about a Song two edits back,
 * an action the step did not ask for, a track or a bar the descriptor never
 * named, or a record that has already moved on.
 *
 * `stamp` is what the observer measured at the moment the event arrived —
 * the running build, the session it belongs to, and the record's revision.
 * The emitter does not supply those; see `workspace-events.ts` for why.
 */
export function judgeWorkspaceEvent(input: {
  readonly descriptor: TaskDescriptor;
  readonly edit: WorkspaceEdit;
  readonly stamp: {
    readonly buildSha: string;
    readonly sessionId: string;
    readonly revision: number;
  };
}): EventVerdict {
  const { descriptor, edit, stamp } = input;

  if (stamp.buildSha !== descriptor.buildSha) {
    return { accepted: false, refusal: "wrong_build" };
  }
  if (stamp.sessionId !== descriptor.sessionId) {
    return { accepted: false, refusal: "wrong_session" };
  }
  if (edit.songBefore !== descriptor.songFingerprint) {
    return { accepted: false, refusal: "wrong_song" };
  }
  if (descriptor.requiredAction === null) {
    /* A reading step has no action to satisfy, so no event can satisfy it. */
    return { accepted: false, refusal: "wrong_step" };
  }
  if (edit.action !== descriptor.requiredAction) {
    return { accepted: false, refusal: "wrong_action" };
  }
  if (descriptor.trackId !== "" && !edit.trackIds.includes(descriptor.trackId)) {
    return { accepted: false, refusal: "wrong_track" };
  }
  if (
    edit.scope === "measures" &&
    descriptor.barKey !== "" &&
    !edit.barKeys.includes(descriptor.barKey)
  ) {
    return { accepted: false, refusal: "wrong_bar" };
  }
  if (stamp.revision < descriptor.expectedRevision) {
    return { accepted: false, refusal: "stale_revision" };
  }

  return { accepted: true, nextFingerprint: edit.songAfter };
}
