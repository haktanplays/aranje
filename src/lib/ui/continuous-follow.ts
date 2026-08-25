/**
 * Where the surface has to be so the reader can read ahead (2Q-C §5, §6, §7).
 *
 * ## The anchor
 *
 * Before this, following meant: leave the view alone while the playhead is
 * comfortably inside it, then jump when it is not. That is cheap and it is
 * what the baseline measured — the surface stands still for a dozen frames and
 * then moves 400 to 770 pixels in one, which is the moment the reader loses
 * their place. Worse, the frames it stands still are the frames the playhead
 * is drifting toward the right edge, so the space in front of the music — the
 * only part that is any use to someone playing along — keeps shrinking until
 * the jump gives it back.
 *
 * So the playhead is given a fixed place on the screen instead, and the music
 * moves under it. Roughly a third of the way in: enough behind to see what was
 * just played, and about two thirds of the viewport left for what is coming.
 * The exact fraction is a single constant here, and no component may hold a
 * second copy of it.
 *
 * ## Start, middle, end
 *
 * The anchor is what the surface *wants*, not a promise it can always keep. At
 * the start of a song there is nothing to the left to scroll away, so the
 * playhead crosses the screen normally until it reaches the anchor and only
 * then does the surface start moving. At the end the same thing happens in
 * reverse. Both fall out of the clamp rather than being special cases, which
 * is why there are none written here.
 *
 * ## What it is not
 *
 * It is not an animation. There is no easing, no `behavior: "smooth"` and no
 * second timer: this is a function of the transport's position, evaluated on
 * the one frame the app already has, so a seek and a loop wrap land in the
 * same frame they happen rather than sliding there over 300ms.
 */

/**
 * How far into the viewport the playhead sits, as a fraction of its width.
 *
 * The one place this number exists. Components ask for a scroll position; they
 * do not know what fraction produced it, so there is no second copy to drift.
 */
export const FOLLOW_ANCHOR_FRACTION = 0.32;

export type FollowViewport = {
  readonly widthPx: number;
  /** The scrollable content, tail included. */
  readonly contentWidthPx: number;
};

/** How far from the viewport's left edge the reading anchor is. */
export function anchorOffsetPx(viewportWidthPx: number): number {
  return Math.max(0, viewportWidthPx) * FOLLOW_ANCHOR_FRACTION;
}

/**
 * Empty space after the last bar, so the end of the song can still be read.
 *
 * Without it the final bars are read with the playhead sliding into the right
 * edge — the surface runs out of content to scroll and the reading anchor
 * quietly stops being one, exactly where the music is usually hardest.
 *
 * It is not music. It carries no bar, no key, no ticks; it is not on the song
 * axis, so nothing that reasons about the song — a seek, a selection, an
 * export, a fingerprint — can see it. It exists only in the width of a
 * scrolling div.
 */
export function followTailPx(viewportWidthPx: number): number {
  return Math.max(0, viewportWidthPx) - anchorOffsetPx(viewportWidthPx);
}

/**
 * Where the surface should be scrolled to, given where the playhead is.
 *
 * Clamped to what actually exists: never negative, never past the end of the
 * content. The clamp is the whole of the start-of-song and end-of-song
 * behaviour.
 */
export function desiredScrollLeft(
  playheadContentX: number,
  viewport: FollowViewport,
): number {
  const target = playheadContentX - anchorOffsetPx(viewport.widthPx);
  const maxScroll = Math.max(0, viewport.contentWidthPx - viewport.widthPx);
  return Math.min(maxScroll, Math.max(0, target));
}

/**
 * Who owns the horizontal position right now.
 *
 * Session state, and nothing else: it is not in the Song, not in storage, not
 * in the fingerprint, and reloading the app forgets it — which is correct,
 * because it describes what the reader is doing this minute, not what the
 * song is.
 */
export type FollowMode = "following" | "manual" | "reduced_motion";

export type FollowState = {
  /** The reader has taken the view over and the transport has not got it back. */
  readonly manual: boolean;
  /** The system asked for less motion, and this surface is obeying. */
  readonly reduceMotion: boolean;
};

export const INITIAL_FOLLOW_STATE: FollowState = {
  manual: false,
  reduceMotion: false,
};

/**
 * Everything that can change who owns the view.
 *
 * Written out one by one rather than as "some interaction happened", because
 * the difference between them is the whole rule: a scroll the surface makes on
 * the reader's behalf is not the reader taking over, and a tap that writes a
 * note is.
 */
export type FollowEvent =
  /** Wheel, touch drag, or the scrollbar. */
  | { readonly type: "user_scrolled" }
  /** A finger went down on a cell, a handle, or a lane. */
  | { readonly type: "user_touched_surface" }
  /** A bar was copied, pasted, cleared, inserted or deleted. */
  | { readonly type: "bar_operation" }
  /** A sheet that edits the song was opened. */
  | { readonly type: "sheet_opened" }
  /** The reader scrolled themselves to another section. */
  | { readonly type: "user_scrolled_to_section" }
  | { readonly type: "playback_started" }
  | { readonly type: "playback_resumed" }
  /** The explicit "Çalmaya dön" control. */
  | { readonly type: "return_to_playback" }
  /** A seek the reader asked for: a bar tap, a section jump, the transport. */
  | { readonly type: "explicit_seek" }
  | { readonly type: "reduce_motion_changed"; readonly reduce: boolean };

/**
 * The mode the two flags add up to.
 *
 * Reduced motion outranks a manual takeover because it is a statement about
 * the machine rather than about this session: a reader who has scrolled away
 * and a reader who has not both get a surface that does not slide.
 */
export function followMode(state: FollowState): FollowMode {
  if (state.reduceMotion) return "reduced_motion";
  return state.manual ? "manual" : "following";
}

export function nextFollowState(
  state: FollowState,
  event: FollowEvent,
): FollowState {
  switch (event.type) {
    case "user_scrolled":
    case "user_touched_surface":
    case "bar_operation":
    case "sheet_opened":
    case "user_scrolled_to_section":
      return state.manual ? state : { ...state, manual: true };
    case "playback_started":
    case "playback_resumed":
    case "return_to_playback":
    case "explicit_seek":
      return state.manual ? { ...state, manual: false } : state;
    case "reduce_motion_changed":
      return state.reduceMotion === event.reduce
        ? state
        : { ...state, reduceMotion: event.reduce };
  }
}

/** True only when the surface may move itself on every frame. */
export function followsContinuously(state: FollowState): boolean {
  return !state.manual && !state.reduceMotion;
}

/**
 * How much of the viewport a reduced-motion surface will let the playhead
 * cross before it moves at all.
 *
 * Reduced motion cannot mean "never scroll" — the playhead would leave the
 * screen and the reader would be looking at music that is not playing. It
 * means the surface holds still until the playhead is genuinely about to
 * leave, and then makes one move rather than sixty small ones. The band is
 * the same anchor on the way in, so the move puts the playhead exactly where
 * a continuously-following surface would have kept it.
 */
export const REDUCED_MOTION_MARGIN_FRACTION = 0.12;

/**
 * A single catch-up scroll, or null when the playhead is still comfortable.
 *
 * Null is the common answer, and it is what makes this not an animation: a
 * caller that scrolls only when this returns a number scrolls a handful of
 * times per song instead of sixty times per second.
 */
export function reducedMotionScrollLeft(
  playheadContentX: number,
  scrollLeft: number,
  viewport: FollowViewport,
): number | null {
  const margin = Math.max(0, viewport.widthPx) * REDUCED_MOTION_MARGIN_FRACTION;
  const inside =
    playheadContentX >= scrollLeft + margin &&
    playheadContentX <= scrollLeft + viewport.widthPx - margin;
  if (inside) return null;
  const target = desiredScrollLeft(playheadContentX, viewport);
  return target === scrollLeft ? null : target;
}
