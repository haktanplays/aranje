/**
 * The one animation frame the playhead runs on (spec 13.20 §11, 2N-A.1).
 *
 * Two surfaces draw a playhead — the tab and the arrangement — and each had
 * its own copy of the same six lines. The lines are not complicated, but the
 * rule they encode is the one that decides whether a phone's battery drains
 * while nothing is playing, so it is worth having in exactly one place where
 * it can be read, tested and counted.
 *
 * ## The rule
 *
 * - The loop **draws once** whenever it starts, running or not. A stopped
 *   transport still has a position, and the playhead has to be painted at it
 *   — otherwise the line would sit wherever the last frame left it, which
 *   after a seek is the wrong place. This single call is a paint, not a loop.
 * - It **reschedules only while running**. When the transport is idle, paused
 *   or ended, the callback runs once and nothing asks for another frame.
 * - Cleanup **cancels** whatever is outstanding, so an unmount or a re-run
 *   can never leave a second loop alive behind the first.
 *
 * Behaviour is exactly what the two hooks did before this module existed;
 * nothing about when a frame happens has changed.
 *
 * ## Why the scheduler is a parameter
 *
 * `requestAnimationFrame` is the browser's, and a test that wants to know
 * "how many loops are alive after a pause" cannot ask the browser that. With
 * the scheduler injected, the answer is countable: a fake one records every
 * request and every cancel, and the lifecycle becomes an assertion rather
 * than a hope. Production passes nothing and gets the real frames.
 */

export type FrameScheduler = {
  request(callback: () => void): number;
  cancel(handle: number): void;
};

/** The real thing. Kept here so no caller reaches for the global itself. */
export const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Which surface a count belongs to, so the two can never be added up blind. */
export type PlayheadSource = "tab" | "arrangement";

/**
 * The opt-in counter.
 *
 * Absent unless something sets it before the app runs, which is what the
 * acceptance harness does. Production reads three undefined properties per
 * frame and allocates nothing; there is no flag to ship, no branch that
 * behaves differently, and no number the app itself consults.
 *
 * The three counts answer three different questions, and reporting one under
 * another's name is precisely the mistake this module exists to make hard:
 *
 * - `scheduled` — times *this hook* asked for a frame
 * - `drawn` — times its callback actually ran
 * - `live` — loops with a frame **outstanding** right now
 *
 * `live` counts frames owed, not hooks mounted. The distinction is the whole
 * question: an idle surface is still mounted and still holds a draw function,
 * and counting that as "live" would report a battery cost that does not
 * exist. A loop is alive when the browser owes it a frame, and an idle one
 * has already spent its single paint and asked for nothing since.
 *
 * None of them is the browser's global `requestAnimationFrame` rate, which is
 * a property of the display and says nothing about whether a loop is running.
 */
export type PlayheadProbe = {
  scheduled: Partial<Record<PlayheadSource, number>>;
  drawn: Partial<Record<PlayheadSource, number>>;
  live: Partial<Record<PlayheadSource, number>>;
};

declare global {
  interface Window {
    __playheadProbe?: PlayheadProbe;
  }
}

const probe = (): PlayheadProbe | undefined =>
  typeof window === "undefined" ? undefined : window.__playheadProbe;

const bump = (
  field: keyof PlayheadProbe,
  source: PlayheadSource,
  by: number,
): void => {
  const counts = probe();
  if (!counts) return;
  counts[field][source] = (counts[field][source] ?? 0) + by;
};

/**
 * Start the loop and return its cleanup.
 *
 * `running` is read once, as the hooks' effects already did: a transport that
 * starts is a new effect run and therefore a new loop, not a flag the old
 * loop notices mid-flight.
 */
export function runPlayheadLoop(options: {
  readonly source: PlayheadSource;
  readonly running: boolean;
  readonly draw: () => void;
  /** Defaults to the browser's frames. Tests pass a countable one. */
  readonly scheduler?: FrameScheduler;
}): () => void {
  const { source, running, draw, scheduler = browserFrames } = options;

  let handle = 0;
  let owed = false;

  const ask = () => {
    owed = true;
    bump("scheduled", source, 1);
    bump("live", source, 1);
    handle = scheduler.request(step);
  };

  const step = () => {
    // The frame has been paid: nothing is owed until the loop asks again.
    owed = false;
    bump("live", source, -1);
    bump("drawn", source, 1);
    draw();
    if (running) ask();
  };

  ask();

  return () => {
    scheduler.cancel(handle);
    // Only a frame still owed is given back; cancelling twice, or cancelling
    // a loop that already ran itself out, must not push the count negative.
    if (owed) {
      owed = false;
      bump("live", source, -1);
    }
  };
}
