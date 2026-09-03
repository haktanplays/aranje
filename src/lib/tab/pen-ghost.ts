/**
 * The whole shape a pen would write, before it writes it (K-59 §6).
 *
 * The power chord pen has always had a real preview: `previewPen` runs the
 * *same* command the tap would run and hands back the Song it produced, so a
 * ghost can never show a result the commit would not. What was missing was
 * anywhere to draw it — the staff showed nothing at all, so a reader picking
 * up "Power chord · 3 ses" had to write it to find out what three voices at
 * that fret looked like.
 *
 * This reads one slot out of that preview and says which strings and frets it
 * put there. All of them: a two-voice pen is root and fifth, a three-voice pen
 * is root, fifth and the octave, and every one of them is on the same onset.
 * A faint root digit with the rest left to the imagination is not a preview of
 * a chord.
 *
 * Nothing here writes. The preview Song is a value the caller already had, and
 * this turns it into coordinates.
 */
import type { MelodicSlot, Song } from "@/lib/song/schema";

export type GhostNote = {
  readonly stringIndex: number;
  readonly fret: number | null;
};

export type PenGhost = {
  readonly barKey: string;
  readonly slotIndex: number;
  /** Every voice the command produced, in string order. */
  readonly notes: readonly GhostNote[];
};

/** `sectionId:barIndex`, the key both canvases already draw bars by. */
function barAt(song: Song, barKey: string) {
  const [sectionId, barText] = barKey.split(":");
  const barIndex = Number(barText);
  if (!sectionId || !Number.isInteger(barIndex)) return null;
  const section = song.sections.find((entry) => entry.id === sectionId);
  return section?.bars[barIndex] ?? null;
}

function notesAt(
  song: Song,
  trackId: string,
  barKey: string,
  slotIndex: number,
): GhostNote[] | null {
  const bar = barAt(song, barKey);
  const slot = bar?.slots[trackId]?.[slotIndex];
  // A drum lane's slot is an array; this pen writes strings and frets only.
  if (slot === undefined || Array.isArray(slot)) return null;
  const melodic = slot as MelodicSlot;
  if (melodic === null || melodic === "-") return [];
  return melodic.notes.map((note) => ({
    stringIndex: note.position?.string ?? -1,
    fret: note.position?.fret ?? null,
  }));
}

const same = (a: readonly GhostNote[], b: readonly GhostNote[]): boolean =>
  a.length === b.length &&
  a.every(
    (note, index) =>
      note.stringIndex === b[index]?.stringIndex && note.fret === b[index]?.fret,
  );

/**
 * What the armed pen would put on this beat, or null when there is nothing
 * to show.
 *
 * Null when the command was refused (the caller's `preview` is null), when the
 * beat is not this track's to write, and when the preview would change
 * nothing — a ghost drawn exactly on top of the notes that are already there
 * says "something is about to happen" when nothing is.
 */
export function penGhost(input: {
  readonly preview: Song | null;
  readonly current: Song;
  readonly trackId: string;
  readonly barKey: string;
  readonly slotIndex: number;
}): PenGhost | null {
  if (!input.preview) return null;
  const after = notesAt(input.preview, input.trackId, input.barKey, input.slotIndex);
  if (!after || after.length === 0) return null;
  const before = notesAt(input.current, input.trackId, input.barKey, input.slotIndex);
  if (before && same(before, after)) return null;
  // A voice with no placement cannot be drawn on a string; the pen refuses
  // before that happens, and this is the belt for the braces.
  const notes = after.filter((note) => note.stringIndex >= 0);
  if (notes.length === 0) return null;
  return {
    barKey: input.barKey,
    slotIndex: input.slotIndex,
    notes: [...notes].sort((a, b) => a.stringIndex - b.stringIndex),
  };
}

/**
 * Every slot a proposed edit changed, as ghosts (2V-B.4 §7).
 *
 * The pen writes one beat, so one ghost was enough for it. A fast sequence
 * writes three or four, a chord writes one onset across several strings, and
 * a transposition can touch a whole section — so the draft's ghosts are a
 * list, produced by the same slot-level comparison the pen already uses.
 *
 * The comparison is against the canonical Song, which is what makes the ghost
 * honest: a slot the proposal left exactly as it was is not drawn, so the
 * amber the reader sees is the change and nothing else.
 */
export function draftGhosts(input: {
  readonly preview: Song | null;
  readonly current: Song;
  readonly trackId: string;
  /** The section the proposal is in; the rest of the song is not compared. */
  readonly sectionId: string;
}): readonly PenGhost[] {
  if (!input.preview) return [];
  const section = input.preview.sections.find((entry) => entry.id === input.sectionId);
  if (!section) return [];
  return section.bars.flatMap((bar, barIndex) => {
    const lane = bar.slots[input.trackId];
    if (!lane || Array.isArray(lane[0])) return [];
    const barKey = `${input.sectionId}:${barIndex}`;
    return lane.flatMap((_slot, slotIndex) => {
      const ghost = penGhost({
        preview: input.preview,
        current: input.current,
        trackId: input.trackId,
        barKey,
        slotIndex,
      });
      return ghost ? [ghost] : [];
    });
  });
}
