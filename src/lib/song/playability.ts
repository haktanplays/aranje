/**
 * What a real guitar would have trouble with (2T-C §8).
 *
 * ## Not a grade
 *
 * The point is never to tell a writer their music is wrong. It is to make the
 * instrument visible: six strings, one hand, four fingers, and a fret span
 * that runs out. A reader who knows *why* something will be awkward can
 * decide to keep it — plenty of good music is awkward on purpose — and a
 * reader who did not mean it can fix it. Both of those need the same
 * information and neither needs a verdict.
 *
 * ## Three tiers, because they mean different things
 *
 * - A **conflict** is not playable at all, and the app already refuses to
 *   write one. What appears here is a conflict that was already in the file:
 *   an import, an older build, a generated part. It is shown so it can be
 *   found and fixed, never so a song refuses to open.
 * - A **warning** is "this will be hard", and hard is a matter of degree and
 *   of whose hands. It never blocks anything. The wording says *may be*
 *   difficult, because claiming a passage is unplayable when a better player
 *   would shrug is the one mistake that would make a reader stop believing
 *   any of these.
 * - **Information** is the instrument explaining itself: why a note written
 *   long is heard short, why four voices are overlapping, what a strum is
 *   that an arpeggio is not.
 *
 * Nothing here uses the model's vocabulary. A reader is told about bars,
 * beats, strings and frets — never about ticks, slots or schema names.
 */
import { ticksPerSlot } from "@/lib/music/timing";
import { isMelodicSlotArray, type Song } from "@/lib/song/schema";
import { soundingSpans, writtenSpans, sectionTicks } from "@/lib/song/sounding";
import { collisionMessage, stringCollisions } from "@/lib/song/string-collision";

export type PlayabilityLevel = "conflict" | "warning" | "info";

export type PlayabilityKind =
  /* conflict */
  | "string_collision"
  /* warning */
  | "wide_stretch"
  | "wide_voicing"
  /* information */
  | "shortened_by_restrike"
  | "voices_overlap";

export type PlayabilityNote = {
  readonly level: PlayabilityLevel;
  readonly kind: PlayabilityKind;
  readonly message: string;
  readonly barIndex: number;
  /** Which beat of the bar, counting from 1 — never a slot number. */
  readonly beat: number;
};

/**
 * How far apart two fretted notes of one chord can be before it is a stretch.
 *
 * Four frets is a hand in one position with a finger on each. Five is the
 * first span that needs the hand to open or shift, which is where "this may
 * be difficult" starts being worth saying and stops being pedantic.
 */
export const COMFORTABLE_SPAN = 4;

const beatOf = (slotIndex: number, resolution: number): number =>
  Math.floor((slotIndex * ticksPerSlot(resolution as never)) / ticksPerSlot(4)) + 1;

/** Everything worth saying about one track's playability, most severe first. */
export function playabilityNotes(
  song: Song,
  trackId: string,
): readonly PlayabilityNote[] {
  const found: PlayabilityNote[] = [];

  /* ---------------------------------------------------------- conflicts */
  for (const collision of stringCollisions(song, trackId)) {
    found.push({
      level: "conflict",
      kind: "string_collision",
      message: collisionMessage(collision),
      barIndex: collision.barIndex,
      beat: collision.beat,
    });
  }

  /* ----------------------------------------------------------- warnings */
  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      const slots = bar.slots[trackId];
      if (!slots || !isMelodicSlotArray(slots)) return;

      slots.forEach((slot, slotIndex) => {
        if (slot === null || slot === "-") return;
        /* Open strings need no finger, so they are not part of the stretch. */
        const frets = slot.notes
          .map((note) => note.position?.fret)
          .filter((fret): fret is number => fret !== undefined && fret > 0);
        if (frets.length < 2) return;

        const span = Math.max(...frets) - Math.min(...frets);
        if (span <= COMFORTABLE_SPAN) return;
        found.push({
          level: "warning",
          kind: frets.length > 3 ? "wide_voicing" : "wide_stretch",
          message:
            `${barIndex + 1}. ölçünün ${beatOf(slotIndex, bar.resolution)}. vuruşunda ` +
            `${Math.min(...frets)}. ve ${Math.max(...frets)}. perdeler birlikte basılıyor. ` +
            "Elde zor olabilir.",
          barIndex,
          beat: beatOf(slotIndex, bar.resolution),
        });
      });
    });
  }

  /* -------------------------------------------------------- information */
  for (const section of song.sections) {
    const written = writtenSpans(section.bars, trackId);
    const heard = soundingSpans(
      written,
      (span) => span.note.position?.string ?? null,
      sectionTicks(section.bars),
    );

    for (const span of heard) {
      if (!span.cutByRestrike) continue;
      const bar = section.bars[span.barIndex];
      if (!bar) continue;
      found.push({
        level: "info",
        kind: "shortened_by_restrike",
        message:
          `${span.barIndex + 1}. ölçüde ${(span.stringIndex ?? 0) + 1}. tel yeniden ` +
          "çalındığı için önceki nota yazıldığından kısa duyulur. Yazılan nota yerinde duruyor.",
        barIndex: span.barIndex,
        beat: beatOf(span.slotIndex, bar.resolution),
      });
    }

    /* Voices from different strings sounding at once: the dirty arpeggio. */
    const overlapping = heard.filter((span) =>
      heard.some(
        (other) =>
          other !== span &&
          other.stringIndex !== span.stringIndex &&
          other.startTicks > span.startTicks &&
          other.startTicks < span.startTicks + span.soundingTicks,
      ),
    );
    if (overlapping.length > 0) {
      const first = overlapping[0]!;
      const bar = section.bars[first.barIndex];
      found.push({
        level: "info",
        kind: "voices_overlap",
        message:
          `${first.barIndex + 1}. ölçüde farklı teller üst üste çınlıyor. ` +
          "Bu bir hata değil; teller birbirini kesmez.",
        barIndex: first.barIndex,
        beat: bar ? beatOf(first.slotIndex, bar.resolution) : 1,
      });
    }
  }

  const order: Record<PlayabilityLevel, number> = { conflict: 0, warning: 1, info: 2 };
  return [...found].sort((a, b) => order[a.level] - order[b.level]);
}

/** Just the ones about one bar, for a sheet that is looking at one note. */
export function notesForBar(
  all: readonly PlayabilityNote[],
  barIndex: number,
): readonly PlayabilityNote[] {
  return all.filter((note) => note.barIndex === barIndex);
}

/** What each tier is called, where a reader can see the difference. */
export const LEVEL_LABELS: Readonly<Record<PlayabilityLevel, string>> = {
  conflict: "Çalınamaz",
  warning: "Zor olabilir",
  info: "Bilgi",
};
