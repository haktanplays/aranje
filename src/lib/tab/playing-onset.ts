/**
 * Marking the onset the playhead is on, without a render (2S-A §4).
 *
 * The seventh glyph state is the one React must not own. Everything else about
 * a fret number is decided when the song changes; this one changes with the
 * transport, and a tab that re-renders on every animation frame is exactly
 * what 2Q-C's single-rAF design exists to prevent (K-57).
 *
 * So it is a DOM attribute, toggled from the playhead loop and only when the
 * transport crosses into a **new slot** — at 1/32 and 260 BPM that is about
 * thirty-five writes a second, against sixty renders of the whole tab. The
 * caret and the colour are a rule in `globals.css`.
 *
 * The function is pure in the only sense that matters here: given the same
 * root, key and previous key it does the same thing, and it touches nothing
 * but the attribute. It returns the key it settled on, so the caller keeps no
 * second copy of the state.
 */
export const PLAYING_ATTRIBUTE = "data-playing";

/**
 * A bar key, safe inside a double-quoted attribute selector.
 *
 * `CSS.escape` would do it, and is deliberately not used: this module is
 * arithmetic and a string, and reaching for a browser global would make it a
 * module that cannot be tested without one. Inside `[attr="…"]` only the
 * quote and the backslash have to be escaped.
 */
function quote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type PlayingOnset = {
  readonly barKey: string | null;
  readonly slotIndex: number;
};

/** The key two positions are compared by. `null` when nothing is playing. */
export function onsetKey(onset: PlayingOnset): string | null {
  return onset.barKey === null ? null : `${onset.barKey}:${onset.slotIndex}`;
}

/**
 * Move the mark, if it has moved. Returns the key now in effect.
 *
 * `previous` is what the caller was last told; passing it back means the
 * common case — the transport still inside the same slot — costs one string
 * comparison and no DOM work at all.
 */
export function markPlayingOnset(
  root: ParentNode | null,
  onset: PlayingOnset,
  previous: string | null,
): string | null {
  const key = onsetKey(onset);
  if (key === previous) return previous;
  if (!root) return key;

  for (const marked of root.querySelectorAll(`[${PLAYING_ATTRIBUTE}]`)) {
    marked.removeAttribute(PLAYING_ATTRIBUTE);
  }

  if (onset.barKey !== null) {
    const selector =
      `[data-bar-key="${quote(onset.barKey)}"] ` +
      `[data-glyph-slot="${onset.slotIndex}"]`;
    for (const glyph of root.querySelectorAll(selector)) {
      glyph.setAttribute(PLAYING_ATTRIBUTE, "");
    }
  }

  return key;
}
