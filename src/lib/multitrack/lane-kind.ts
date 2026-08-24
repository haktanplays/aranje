/**
 * Which kind of notation a track needs (2Q-A §5).
 *
 * Three answers, and each is a real statement about the instrument rather
 * than a rendering preference:
 *
 * - **fretted** — the instrument has a fretboard, so a note has a string and
 *   a fret and a tab staff can show it. Electric and acoustic guitars,
 *   classical guitar, bass, and anything else the registry gives a fretboard.
 * - **drums** — a kit, whose notation is a lane per piece. The existing drum
 *   timeline already knows how to say this.
 * - **pitched** — a melodic instrument with no fretboard. A note has a pitch
 *   and nothing else, so that is exactly what is drawn. **No string and no
 *   fret is invented for it**: a piano note on "the third string, fifth fret"
 *   would be a fact about a guitar that does not exist, written into a lane
 *   somebody is trying to read.
 *
 * The question is asked of the registry and of the track's own fretboard, in
 * this one place, so a lane component never decides it and two surfaces can
 * never disagree about what a piano is.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import type { Track } from "@/lib/song/schema";

export type LaneKind = "fretted" | "drums" | "pitched";

export function laneKindOf(track: Track): LaneKind {
  if (isDrumInstrument(track.instrumentId)) return "drums";
  return track.fretboard ? "fretted" : "pitched";
}
