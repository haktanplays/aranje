/**
 * The compact transport format of spec 11.5.
 *
 * "Modele ham Song JSON gönderilmez." The canonical model stays detailed; what
 * travels to the provider is one line per track, exactly the shape spec 11.5
 * prints:
 *
 *   gtr: E2 E2 . G2 - - A2 G2
 *   drm: K+H H S+H H K+H H S+H H
 *
 * Read against that example: `.` is a rest, `-` continues the previous event,
 * `+` stacks simultaneous events, and everything else is a written pitch or a
 * drum letter.
 *
 * What the format drops, deliberately: velocity, articulation and written
 * positions. Spec 11.5 makes the transport format compact and leaves the
 * canonical model detailed, and the position engine is deterministic code
 * (spec 11.2/5) rather than something the model should be reasoning about.
 */
import type { DrumPiece, MelodicSlot, Section, Song } from "@/lib/song/schema";

/**
 * One letter per drum piece. Spec 11.5's example fixes K, S and H; the rest
 * follow the same initial-letter scheme, with the toms numbered high to low
 * because their initials collide.
 */
export const DRUM_LETTERS: Readonly<Record<DrumPiece, string>> = {
  kick: "K",
  snare: "S",
  closed_hat: "H",
  open_hat: "O",
  ride: "R",
  crash: "C",
  china: "N",
  tom_high: "T1",
  tom_mid: "T2",
  tom_floor: "T3",
};

const REST = ".";
const TIE = "-";

function melodicToken(slot: MelodicSlot): string {
  if (slot === null) return REST;
  if (slot === "-") return TIE;
  return slot.notes.map((note) => note.pitch).join("+");
}

/** One line per track that sounds in the bar, in the song's track order. */
export function compactBar(song: Song, barIndex: number, section: Section): string[] {
  const bar = section.bars[barIndex];
  if (!bar) return [];

  const lines: string[] = [];
  for (const track of song.tracks) {
    const slots = bar.slots[track.id];
    // A track with no key in the bar is silent there (spec 5.5) and is left
    // out rather than sent as a row of rests.
    if (slots === undefined) continue;

    const tokens = slots.map((slot) => {
      if (Array.isArray(slot)) {
        if (slot.length === 0) return REST;
        return slot.map((hit) => DRUM_LETTERS[hit.piece]).join("+");
      }
      return melodicToken(slot);
    });

    lines.push(`${track.id}: ${tokens.join(" ")}`);
  }

  return lines;
}

/** A whole section: a header line, then one block per bar. */
export function compactSection(song: Song, section: Section): string {
  const head = `# ${section.id} "${section.name}" (${section.bars.length} bar)`;
  const bars = section.bars.map((bar, index) => {
    const meta = `bar ${index + 1} ${bar.timeSignature[0]}/${bar.timeSignature[1]} 1/${bar.resolution}`;
    return [meta, ...compactBar(song, index, section)].join("\n");
  });
  return [head, ...bars].join("\n");
}

/** The one-line song meta spec 11.5 allows beside the sections. */
export function compactSongMeta(song: Song): string {
  const tracks = song.tracks
    .map((track) => `${track.id}=${track.instrumentId}/${track.presetId}`)
    .join(" ");
  return `title="${song.title}" bpm=${song.bpm} key=${song.key} tracks: ${tracks}`;
}

/**
 * Target section plus one either side, and nothing else (spec 11.5).
 * Returns them in playing order so the model reads them as music.
 */
export function neighbourhood(song: Song, anchorSectionId: string): Section[] {
  const index = song.sections.findIndex(
    (section) => section.id === anchorSectionId,
  );
  if (index < 0) return [];

  return [song.sections[index - 1], song.sections[index], song.sections[index + 1]]
    .filter((section): section is Section => section !== undefined);
}
