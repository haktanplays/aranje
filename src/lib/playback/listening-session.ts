/**
 * When a selection audition has to stop on its own (2V-A §5).
 *
 * The rule is one sentence — *a run belongs to the selection it was started
 * for* — and the reason it is a pure function rather than an `if` in an
 * effect is that the six ways a selection stops being that selection do not
 * look alike from inside a component. Cancelling it, drawing another one,
 * changing the instrument and moving to another section arrive as four
 * different state changes, and a hook that handled them one at a time would
 * handle five of them.
 *
 * So the question is asked the other way round: what is sounding, and is it
 * still what is selected? Anything else — leaving the view, closing the
 * editor, unmounting, an audio error, an abort — is not a change of selection
 * at all and is handled where it happens, by calling `stop` outright.
 */
import type { SelectionPlaybackPlan } from "@/lib/playback/selection-playback";

/**
 * What makes one selection playback different from another.
 *
 * Ticks and tracks, because those are the whole of what is being played: two
 * selections with the same bounds on the same instruments would sound
 * identical, and restarting for them would interrupt a loop the reader is
 * happily listening to. The mode is not in it — switching between hearing it
 * once and looping it is a different intent, and the caller says so by
 * starting a new run.
 */
export function playbackSignature(
  plan: SelectionPlaybackPlan | null,
): string | null {
  if (!plan) return null;
  return [plan.startTicks, plan.endTicks, [...plan.trackIds].sort().join(",")].join(
    "|",
  );
}

/**
 * Should the run that is sounding be stopped?
 *
 * True when what is selected is no longer what is playing — including when
 * nothing is selected at all, which is what cancelling looks like from here.
 * False when nothing is playing, so a cleanup can be run unconditionally
 * without having to ask first.
 */
export function shouldStopListening(
  playing: SelectionPlaybackPlan | null,
  selected: SelectionPlaybackPlan | null,
): boolean {
  if (!playing) return false;
  return playbackSignature(playing) !== playbackSignature(selected);
}
