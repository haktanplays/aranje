/**
 * Which note a note is joined to (spec 8.5, K-21).
 *
 * A slide, a hammer-on and a pull-off are all statements about the note
 * *before* this one: it has to be on the same string, and it has to still be
 * sounding when this one starts. Two very different things need that same
 * answer — the expression planner, which has to know where to glide from, and
 * the `articulationContext` validator, which has to say when there is nothing
 * to glide from. They read it from here so they cannot disagree.
 *
 * The reading of time is the Faz 0 one (spec 5.5): a tie extends the note it
 * continues, a rest ends it, and a bar the track is not written in ends it too.
 * A section line on its own ends nothing.
 */
import {
  DEFAULT_VELOCITY,
  articulationHold,
  barTimeline,
  ticksPerSlot,
} from "@/lib/audio/schedule";
import { pitchToMidi } from "@/lib/music/pitch";
import type { Articulation, Song } from "@/lib/song/schema";
import { buildTrackTimeline } from "@/lib/tab/timeline";

/** One struck note of one fretted track, with the context it needs. */
export type LegatoOnset = {
  barKey: string;
  sectionId: string;
  /** Index inside the section, matching the validator issue paths. */
  barIndex: number;
  barNumber: number;
  slotIndex: number;
  stringIndex: number;
  fret: number | null;
  pitch: string;
  midi: number | null;
  velocity: number;
  articulation?: Articulation;
  /** Ticks from the start of the song, as `buildSongPlan` counts them. */
  timeTicks: number;
  /** Exactly what `buildSongPlan` schedules, so the two never disagree. */
  durationTicks: number;
  /** Absolute slot index across the track, for the contiguity test. */
  startSlot: number;
  /** Last slot this note is still sounding through, ties included. */
  endSlot: number;
};

export type LegatoLink =
  | { kind: "joined"; previous: LegatoOnset }
  /** Nothing was sounding on this string when the note began. */
  | { kind: "none" }
  /** Something was sounding, but on a different string. */
  | { kind: "other_string" };

/**
 * Every struck note of one fretted track, in playing order.
 *
 * `endSlot` follows a tie across a bar line, so a legato pair split by one
 * still reads as touching. The sounding **duration** deliberately does not: it
 * stays exactly what the scheduler already plays, so adding expression cannot
 * quietly change how long an ordinary note lasts.
 */
export function trackLegatoOnsets(song: Song, trackId: string): LegatoOnset[] {
  const timeline = buildTrackTimeline(song, trackId);
  if (timeline.kind !== "fretted") return [];

  const barStart = new Map(barTimeline(song).map((bar) => [bar.barKey, bar.time]));
  const onsets: LegatoOnset[] = [];

  let slotBase = 0;
  const bases = new Map<string, number>();
  for (const bar of timeline.bars) {
    bases.set(bar.key, slotBase);
    slotBase += bar.slotCount;
  }

  for (const bar of timeline.bars) {
    if (bar.silent) continue;
    const start = barStart.get(bar.key) ?? 0;
    const step = ticksPerSlot(bar.resolution);
    const base = bases.get(bar.key) ?? 0;

    for (const span of bar.spans) {
      if (span.openStart) continue;
      const slots = span.endSlot - span.startSlot + 1;
      const full = slots * step;

      onsets.push({
        barKey: bar.key,
        sectionId: bar.sectionId,
        barIndex: bar.barIndex,
        barNumber: bar.barNumber,
        slotIndex: span.startSlot,
        stringIndex: span.stringIndex,
        fret: span.fret,
        pitch: span.pitch,
        midi: pitchToMidi(span.pitch),
        velocity: span.velocity ?? DEFAULT_VELOCITY,
        ...(span.articulation === undefined ? {} : { articulation: span.articulation }),
        timeTicks: start + span.startSlot * step,
        durationTicks: Math.max(
          1,
          Math.round(full * articulationHold(span.articulation)),
        ),
        startSlot: base + span.startSlot,
        endSlot: base + span.endSlot,
      });
    }
  }

  // A tie running over a bar line becomes a second span in the next bar. The
  // note is still one note, so its sounding end is the end of the last one.
  for (const bar of timeline.bars) {
    if (bar.silent) continue;
    const base = bases.get(bar.key) ?? 0;
    for (const span of bar.spans) {
      if (!span.openStart) continue;
      const end = base + span.endSlot;
      let owner: LegatoOnset | undefined;
      for (const onset of onsets) {
        if (onset.stringIndex !== span.stringIndex) continue;
        if (onset.endSlot + 1 !== base + span.startSlot) continue;
        owner = onset;
      }
      if (owner && end > owner.endSlot) owner.endSlot = end;
    }
  }

  onsets.sort(
    (a, b) => a.timeTicks - b.timeTicks || a.stringIndex - b.stringIndex,
  );
  return onsets;
}

/** The note this one is joined to, if there is one. */
export function legatoLink(
  onsets: readonly LegatoOnset[],
  index: number,
): LegatoLink {
  const current = onsets[index];
  if (!current) return { kind: "none" };

  let sawAnything = false;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = onsets[cursor];
    if (!candidate) continue;
    // Other notes of the same chord are neighbours, not predecessors.
    if (candidate.startSlot >= current.startSlot) continue;
    sawAnything = true;
    if (candidate.stringIndex !== current.stringIndex) continue;
    // Touching, with no rest, no gap and no unwritten bar in between.
    return candidate.endSlot + 1 === current.startSlot
      ? { kind: "joined", previous: candidate }
      : { kind: "none" };
  }

  return sawAnything ? { kind: "other_string" } : { kind: "none" };
}
