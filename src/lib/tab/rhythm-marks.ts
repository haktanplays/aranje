/**
 * The seven weights a rhythm is drawn at (2V-D.2 §16).
 *
 * ## What goes wrong without a hierarchy
 *
 * Everything the brief warns about is the same failure: two different musical
 * facts drawn at the same weight. A bar line and a subdivision line that look
 * alike make a 4/4 look like a 4/16. A whole 48-lattice at one weight is a
 * grey wash. A 7/8 whose grouping is invisible is a 7/8 nobody can read, and
 * a triplet you can only find by counting tick positions is not notated, it
 * is encoded.
 *
 * So the marks are ranked, once, here — and the renderer asks for a rank
 * rather than choosing a stroke. A view that wants to simplify when zoomed
 * out drops whole *ranks*, from the bottom, which is why the ordering is the
 * product decision and the pixels are not.
 *
 * ## What may never be dropped
 *
 * `minZoom` says when a rank may fade, and three of them never do: the bar
 * line, the main beat and the note's own stem. Those are musical data — where
 * the bar starts, where the pulse is, and how long the note is — and a zoom
 * level that hid them would be a camera changing the music, which §4 forbids.
 * Subdivision lines and tuplet brackets are *aids*: dropping them at a
 * distance loses nothing a reader could have read at that size anyway.
 */

export const RHYTHM_MARK_IDS = [
  "bar_line",
  "main_beat",
  "subdivision",
  "tuplet_group",
  "note_stem",
  "phrase_band",
  "technique_rail",
] as const;

export type RhythmMarkId = (typeof RHYTHM_MARK_IDS)[number];

export type RhythmMark = {
  readonly id: RhythmMarkId;
  /**
   * Drawing order and visual weight, 1 = heaviest.
   *
   * Distinct on purpose: two marks sharing a rank is exactly the "every grid
   * line looks like a bar line" failure, and the test below holds them apart.
   */
  readonly rank: number;
  /** What a screen reader is told this line is. */
  readonly label: string;
  /**
   * Below this zoom, the mark may be simplified away.
   *
   * `null` means never — it is musical data, not an aid.
   */
  readonly minZoom: number | null;
  /**
   * True when the mark belongs to the *layer over* the notes.
   *
   * Phrase bands and technique rails sit above or below the staff and must
   * not be drawn through a stem: a rail across a note's tail hides how long
   * the note is, which is the one thing the tab is for.
   */
  readonly overlay: boolean;
};

/**
 * The hierarchy, heaviest first.
 *
 * The order is the answer to "what does a reader need first if they can only
 * have one thing": the bar, then the pulse, then the note, then the aids.
 */
export const RHYTHM_MARKS: readonly RhythmMark[] = [
  { id: "bar_line", rank: 1, label: "Ölçü çizgisi", minZoom: null, overlay: false },
  { id: "main_beat", rank: 2, label: "Ana vuruş", minZoom: null, overlay: false },
  { id: "note_stem", rank: 3, label: "Nota süresi", minZoom: null, overlay: false },
  { id: "tuplet_group", rank: 4, label: "Üçleme grubu", minZoom: 0.75, overlay: false },
  { id: "subdivision", rank: 5, label: "Alt bölünme", minZoom: 0.9, overlay: false },
  { id: "phrase_band", rank: 6, label: "Cümle", minZoom: 0.6, overlay: true },
  { id: "technique_rail", rank: 7, label: "Teknik alanı", minZoom: 0.6, overlay: true },
];

const BY_ID = new Map(RHYTHM_MARKS.map((mark) => [mark.id, mark]));

export function rhythmMark(id: RhythmMarkId): RhythmMark {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown rhythm mark: ${id}`);
  return found;
}

/**
 * The marks a view draws at this zoom, heaviest first.
 *
 * One function, so "what is visible" is not decided in three renderers that
 * will disagree at the fourth zoom level anybody tries.
 */
export function marksAtZoom(zoom: number): readonly RhythmMark[] {
  return RHYTHM_MARKS.filter((mark) => mark.minZoom === null || zoom >= mark.minZoom);
}

/** True when this mark carries musical data and may never be simplified away. */
export function isMusicalData(id: RhythmMarkId): boolean {
  return rhythmMark(id).minZoom === null;
}
