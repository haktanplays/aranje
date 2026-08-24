/**
 * Whether a track is *written in* a bar, and how to make it so (2Q-A §1).
 *
 * The Song Contract already distinguishes two states, and until this
 * checkpoint the app only ever produced one of them:
 *
 * - **No key for the track in the bar.** The track is not written here. It is
 *   silent (spec 5.5), *and* a tie chain crossing this bar is broken by it,
 *   *and* there is nothing to write a note into. All three at once — which is
 *   correct, and is also exactly why it cannot be a new track's starting
 *   state.
 * - **A key holding an empty lane** — `[null, null, …]` for a melodic track,
 *   `[[], [], …]` for a drum kit. The track *is* written here and says
 *   nothing. It is silent by the same rule (a `null` slot is a rest and an
 *   empty hit list is a rest), it breaks a carry by the same rule, and it is
 *   a surface a note can be written onto.
 *
 * The two are the same *sound* and a different *statement*. `create_track`
 * produced the first, so a reader who added a guitar got a track that was
 * silent everywhere and writable nowhere: every cell refused with "«…» bu
 * barda yazılı değil; önce bu bara eklenmeli", an instruction no control in
 * the app performs (`eval/multitrack/BASELINE.json`).
 *
 * No field was added to the contract to fix this. The distinction was always
 * expressible; what was missing was a module that owned it.
 *
 * ## What this deliberately does not do
 *
 * It does not migrate. A song that arrives from a file or from an older
 * session keeps every missing key it has: those are somebody's music, the
 * silence is real, and rewriting it on load would be an edit nobody asked
 * for. A lane appears in exactly two places — when a track is created, and
 * in the one bar a reader writes their first note into.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import { slotCount } from "@/lib/music/timing";
import type {
  Bar,
  DrumSlot,
  MelodicSlot,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";

/**
 * Is this track written in this bar?
 *
 * The one question, asked in one place. `hasOwnProperty` rather than a
 * truthiness check: an empty lane is a real answer and `[]` is falsy in
 * plenty of ways that matter here.
 */
export function isWrittenInBar(bar: Bar, trackId: string): boolean {
  return Object.prototype.hasOwnProperty.call(bar.slots, trackId);
}

/**
 * An empty lane for this track in this bar.
 *
 * The length comes from the bar's own meter and resolution, so a 7/8 bar and a
 * 4/4 bar get different lanes and neither is guessed. The *shape* comes from
 * the registry: a drum slot is a list of hits, a melodic slot is a note or a
 * rest, and mixing them is a hard validator error.
 */
export function emptyLane(bar: Bar, track: Track): MelodicSlot[] | DrumSlot[] {
  const count = slotCount(bar.timeSignature, bar.resolution);
  return isDrumInstrument(track.instrumentId)
    ? Array.from({ length: count }, (): DrumSlot => [])
    : Array.from({ length: count }, (): MelodicSlot => null);
}

/**
 * This bar with an empty lane for the track, or this bar unchanged.
 *
 * Idempotent, and returns the *same object* when there is nothing to do —
 * so a caller can run it over a whole song without turning "no change" into
 * a new song that merely looks equal.
 */
export function withEmptyLane(bar: Bar, track: Track): Bar {
  if (isWrittenInBar(bar, track.id)) return bar;
  return { ...bar, slots: { ...bar.slots, [track.id]: emptyLane(bar, track) } };
}

/**
 * The song with an empty lane for this track in every bar it is missing from.
 *
 * What `create_track` hands over: a real working surface everywhere, silent
 * everywhere. Nothing else about the song moves — not the tempo, not the
 * sections, not another track's content, not a bar's meter or resolution.
 */
export function withEmptyLanes(song: Song, track: Track): Song {
  let touched = false;
  const sections = song.sections.map((section): Section => {
    let sectionTouched = false;
    const bars = section.bars.map((bar) => {
      const next = withEmptyLane(bar, track);
      if (next !== bar) sectionTouched = true;
      return next;
    });
    if (!sectionTouched) return section;
    touched = true;
    return { ...section, bars };
  });
  return touched ? { ...song, sections } : song;
}

/**
 * The song with an empty lane for this track in **one** bar.
 *
 * The first-note path. Only the bar being written to, because writing a lane
 * into bars the reader never touched would be inventing silence they did not
 * ask for — and would quietly change what their song says about those bars.
 */
export function withEmptyLaneInBar(
  song: Song,
  track: Track,
  sectionId: string,
  barIndex: number,
): Song {
  const sectionIndex = song.sections.findIndex((section) => section.id === sectionId);
  const section = song.sections[sectionIndex];
  const bar = section?.bars[barIndex];
  if (!section || !bar || isWrittenInBar(bar, track.id)) return song;

  const bars = [...section.bars];
  bars[barIndex] = withEmptyLane(bar, track);
  const sections = [...song.sections];
  sections[sectionIndex] = { ...section, bars };
  return { ...song, sections };
}

/** How many bars this track is written in. Diagnostics and tests. */
export function barsWrittenIn(song: Song, trackId: string): number {
  let total = 0;
  for (const section of song.sections) {
    for (const bar of section.bars) if (isWrittenInBar(bar, trackId)) total += 1;
  }
  return total;
}
