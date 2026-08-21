/**
 * Sound that carries from one bar into the next (spec 13.10, K-41).
 *
 * In the tab you can see a note hold across a bar line because you can see the
 * note. In the arrangement you cannot — a bar is a box — so the carry has to be
 * drawn as a bridge between two boxes, or the overview quietly turns a held
 * note into two separate ones.
 *
 * Every link here is read out of the same places the music itself is read from.
 * Nothing about ties or slurs is re-derived:
 *
 * - **Ties** come from the timeline's own carry mark. `buildTrackTimeline`
 *   already decides whether a span keeps sounding into the next bar, and the
 *   audio scheduler and the tab both draw from that decision; a second opinion
 *   here could disagree with what is played.
 * - **Slides, hammer-ons and pull-offs** come from `legatoDecision`, the one
 *   helper that decides whether a slur is playable at all. It is asked with the
 *   song's own tempo map, exactly as the validator asks it, so a slide that is
 *   refused for having no room to travel is not drawn as a connection here
 *   either. A bridge the player will not hear is a lie about the music.
 *
 * ## What cuts a carry, and what does not
 *
 * A **section boundary does not**. Nothing in this file looks at section ids,
 * because a note held over the seam between a verse and a chorus is one note;
 * cutting it at the boundary would draw a break the listener never hears.
 *
 * A **real rest does**, and so does a **bar the track is not written in** —
 * both because the timeline says so. A missing track key is silence (spec 5.5),
 * and silence ends a sound.
 */
import { legatoDecision } from "@/lib/audio/legato-chain";
import { buildTempoMap } from "@/lib/audio/tempo";
import { trackLegatoOnsets } from "@/lib/music/legato";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import type { Song } from "@/lib/song/schema";

export type BarLinkKind = "tie" | "slide" | "hammer_on" | "pull_off";

export type BarLink = {
  readonly trackId: string;
  /** The bar the sound leaves. */
  readonly fromBarKey: string;
  /** The bar it arrives in. */
  readonly toBarKey: string;
  readonly kind: BarLinkKind;
};

/** What a screen reader is told about a bridge (spec 13.10). */
export const LINK_LABELS: Readonly<Record<BarLinkKind, string>> = {
  tie: "Nota sonraki ölçüye uzuyor",
  slide: "Sonraki ölçüye slide ile bağlanıyor",
  hammer_on: "Sonraki ölçüye hammer-on ile bağlanıyor",
  pull_off: "Sonraki ölçüye pull-off ile bağlanıyor",
};

/**
 * Every carry this track really makes, in song order.
 *
 * At most one link of each kind per bar line: two strings tying over the same
 * seam is one bridge on the screen, not two drawn on top of each other.
 */
export function crossBarLinks(song: Song, trackId: string): BarLink[] {
  const timeline = buildTrackTimeline(song, trackId);
  if (timeline.kind !== "fretted") return [];

  const links: BarLink[] = [];
  const seen = new Set<string>();

  const add = (fromBarKey: string, toBarKey: string, kind: BarLinkKind) => {
    const id = `${fromBarKey}>${kind}`;
    if (seen.has(id)) return;
    seen.add(id);
    links.push({ trackId, fromBarKey, toBarKey, kind });
  };

  // Ties, from the timeline's carry mark.
  timeline.bars.forEach((bar, index) => {
    const next = timeline.bars[index + 1];
    if (!next) return;
    if (bar.spans.some((span) => span.openEnd)) add(bar.key, next.key, "tie");
  });

  /*
   * Slurs. The clock is the song's own at full speed: whether a slide has room
   * to be heard is a property of how the music is written, not of the speed
   * someone happens to be practising it at (spec 8.3, 13.8).
   */
  const onsets = trackLegatoOnsets(song, trackId);
  const timing = { tempo: buildTempoMap(song), timeScale: 1 };

  onsets.forEach((onset, index) => {
    const decision = legatoDecision(onsets, index, timing);
    if (!decision || decision.kind !== "joined") return;
    if (decision.previous.barKey === onset.barKey) return;
    add(decision.previous.barKey, onset.barKey, decision.transition);
  });

  return links;
}
