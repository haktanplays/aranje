/**
 * Playing what is selected, and nothing else (2V-A §7).
 *
 * ## The one question this answers
 *
 * A reader has held some music and wants to hear it. Between that wish and
 * the transport sit four decisions — where does it start, where does it stop,
 * whose notes count, and is there anything there at all — and every one of
 * them is a musical question wearing a scheduling costume. Answered in a
 * component they would be answered again in each surface that offers the
 * action, and differently each time; answered after the press they would
 * arrive as a refusal for a button that looked available.
 *
 * So they are answered here, once, from the typed descriptor the three
 * selection gestures already share. The result is a plan the engine can be
 * *bounded and filtered* by. It is not a second scheduler: nothing here
 * knows about voices, samples, tempo or seconds, and the notes it causes to
 * sound are the same notes, played by the same code, that the whole song
 * plays.
 *
 * ## Section-relative in, song-absolute out
 *
 * A `SelectionDescriptor` counts ticks from the start of its **section**,
 * because that is the frame every editing command works in. The transport
 * counts them from the start of the **song**. Those two numbers are equal
 * only in the first section, which is exactly the kind of difference that
 * survives every test written on a one-section fixture and then plays the
 * wrong music on a real one. Converting is this module's job, and it is the
 * reason the plan carries `startTicks`/`endTicks` rather than handing the
 * descriptor's own pair on.
 *
 * ## Why "is there anything to hear" is a refusal and not a `false`
 *
 * Because the reader is owed a sentence, and because the drawer has to be
 * able to say the same sentence *before* the press. `selection-capability.ts`
 * asks the same question of the same descriptor and greys the control with
 * `NO_AUDIBLE_NOTES`; this returns the machine-readable twin. One question,
 * two audiences, and a test that holds them together.
 */
import { barTimeline, buildNotatedPlan } from "@/lib/audio/schedule";
import type { SelectionDescriptor } from "@/lib/song/selection-descriptor";
import type { Song } from "@/lib/song/schema";

/**
 * The bounded, filtered part of the song a selection playback may touch.
 *
 * One shape, used three times over: the plan is built from it, the drawer's
 * "is there anything to hear" is answered through it, and the engine schedules
 * against it. Three readers of one predicate is how the button, the plan and
 * the sound cannot disagree about which notes are in.
 */
export type PlaybackWindow = {
  /** Inclusive, in ticks from the start of the song. */
  readonly startTicks: number;
  /** Exclusive. */
  readonly endTicks: number;
  readonly trackIds: readonly string[];
};

/**
 * Is this event inside the window?
 *
 * Half-open on time, and *onset*-based rather than overlap-based. A note that
 * began before the selection is not in it: re-striking it at the boundary
 * would put an attack in the music that the reader never wrote, which is the
 * difference between hearing your selection and hearing something like it
 * (§3). A note that begins inside and rings past the end *is* in — what
 * happens to its tail is a question for the sound, not for membership.
 */
export function inWindow(
  window: PlaybackWindow,
  event: { readonly trackId: string; readonly time: number },
): boolean {
  return (
    event.time >= window.startTicks &&
    event.time < window.endTicks &&
    window.trackIds.includes(event.trackId)
  );
}

/**
 * Every written event this window would sound, in playing order.
 *
 * Read off `buildNotatedPlan` — the one traversal the audio scheduler and the
 * MIDI writer are both built on — so "what is in the selection" is answered by
 * the same walk that decides what plays. A separate count here would be a
 * second opinion, and a second opinion is what lets a control offer itself on
 * a selection the engine then finds nothing in.
 */
export function windowEvents(song: Song, window: PlaybackWindow) {
  return buildNotatedPlan(song).events.filter((event) => inWindow(window, event));
}

/**
 * How long a note may sound before the window closes on it.
 *
 * §3 draws a careful line here. A note that *begins* inside the selection is
 * played with its real articulation and expression — it is the reader's note,
 * and an audition that flattened it would be a different instrument. But a
 * note written to ring for two bars, auditioned inside one, would go on
 * sounding after the thing the reader asked to hear had finished, and on a
 * loop it would still be sounding when the run came round again.
 *
 * So the *tail* is cut at the boundary, and nowhere else: the Song's written
 * `durationTicks` is untouched, the exporter and the score still read the
 * length the musician wrote, and the shortening exists only in this one
 * playing. Never to nothing — a note that begins on the last tick is still a
 * note, and a zero-length trigger is a click.
 */
export function clipToWindow(
  event: { readonly time: number; readonly durationTicks: number },
  window: Pick<PlaybackWindow, "endTicks">,
): number {
  const room = window.endTicks - event.time;
  return Math.max(1, Math.min(event.durationTicks, room));
}

/** Play it once, or keep coming back to the start of it. */
export type SelectionPlaybackMode = "once" | "loop";

export type SelectionPlaybackPlan = {
  /** Inclusive, in ticks from the start of the **song**. */
  readonly startTicks: number;
  /** Exclusive: the first tick that does not play. */
  readonly endTicks: number;
  /** Whose notes may sound. Everything else is silent for the duration. */
  readonly trackIds: readonly string[];
  readonly mode: SelectionPlaybackMode;
  /** How many struck onsets are in there. Never zero in a plan that is `ok`. */
  readonly onsetCount: number;
};

/**
 * Why a selection cannot be played.
 *
 * Named rather than boolean because the four have nothing in common: three
 * are shapes the reader cannot produce through the UI at all and one —
 * `no_audible_notes` — is an ordinary thing to select by accident and the
 * only one with a sentence attached.
 */
export type SelectionPlaybackRefusal =
  | "no_selection"
  | "unknown_section"
  | "empty_range"
  | "no_audible_notes";

export type SelectionPlaybackResult =
  | { readonly ok: true; readonly plan: SelectionPlaybackPlan }
  | { readonly ok: false; readonly reason: SelectionPlaybackRefusal };

/**
 * What a reader is told when the thing they held has nothing in it.
 *
 * Their words, about their music. No tick, no slot, no scope, no onset: a
 * sentence that mentions the model's vocabulary teaches the reader the
 * model's vocabulary, which they never asked for and cannot act on.
 */
export const NO_AUDIBLE_NOTES = "Bu seçimde dinlenecek nota yok.";

/**
 * Where this section begins on the transport's timeline.
 *
 * Read off the same bar walk the scheduler and the loop bounds use, rather
 * than re-summed here: a second implementation of "how long is a bar" is a
 * second answer the day a grid or a metre changes.
 */
function sectionStartTicks(song: Song, sectionId: string): number | null {
  const first = barTimeline(song).find((bar) => bar.sectionId === sectionId);
  return first ? first.time : null;
}

/**
 * The bounded, filtered run of the song this selection asks for.
 *
 * Pure: it reads the song and the descriptor and returns a plan or a reason.
 * It starts nothing, stops nothing and writes nothing.
 */
export function planSelectionPlayback(
  song: Song,
  descriptor: SelectionDescriptor | null,
  mode: SelectionPlaybackMode,
): SelectionPlaybackResult {
  if (!descriptor) return { ok: false, reason: "no_selection" };

  const offset = sectionStartTicks(song, descriptor.sectionId);
  if (offset === null) return { ok: false, reason: "unknown_section" };

  const startTicks = offset + descriptor.startTicks;
  const endTicks = offset + descriptor.endTicks;
  /*
   * Half-open, like every other range in this app. A selection of no length
   * is not a silent selection — it is a caret — and playing it would be
   * playing a moment, which has no duration to play for.
   */
  if (endTicks <= startTicks) return { ok: false, reason: "empty_range" };

  const trackIds = [...descriptor.trackIds];
  /*
   * Counted from the schedule rather than from the descriptor's `onsetCount`.
   * That field is melodic by construction — the slot stream treats a drum
   * slot array as unwritable, because the editing commands it serves cannot
   * write into one — so a bar of drums has an onset count of zero and would
   * have had "Seçimi dinle" greyed on a selection full of noise.
   */
  const audible = windowEvents(song, { startTicks, endTicks, trackIds });
  if (audible.length === 0) return { ok: false, reason: "no_audible_notes" };

  return {
    ok: true,
    plan: { startTicks, endTicks, trackIds, mode, onsetCount: audible.length },
  };
}

/**
 * Whether this selection has anything in it to hear.
 *
 * What the drawer needs *before* it opens, and deliberately the same
 * computation the plan makes after the press. It answers false for a
 * selection with no length and for one holding only rests, which are two
 * different refusals to the engine and one greyed control to the reader.
 */
export function hasAudibleNotes(
  song: Song,
  descriptor: SelectionDescriptor | null,
): boolean {
  return planSelectionPlayback(song, descriptor, "once").ok;
}

/** The sentence for a refusal, or null when the reader needs no sentence. */
export function refusalSentence(
  reason: SelectionPlaybackRefusal,
): string | null {
  return reason === "no_audible_notes" ? NO_AUDIBLE_NOTES : null;
}
