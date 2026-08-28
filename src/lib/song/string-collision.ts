/**
 * Two notes asking for one string at one instant (2T-C §1).
 *
 * ## Why this is a first-class thing and not a playback detail
 *
 * A guitar string sounds one note. Two onsets on the same string at the same
 * tick is not a chord, a voicing or a stylistic choice — it is a score asking
 * for something no hand can do. The sounding model already refuses to *play*
 * both, and that was the right call for reading a file somebody else wrote.
 * It is the wrong call for an edit the reader just made: silently keeping the
 * first and dropping the second means the app knows the score is impossible
 * and the reader does not.
 *
 * So the same fact is used two ways, and the difference is who caused it:
 *
 * - An edit that *introduces* a collision is refused, atomically and with a
 *   sentence saying which string and which beat. Nothing is written.
 * - A collision that was already in the file — imported, generated, written
 *   by an older build — is reported as a warning the reader can see and act
 *   on. Refusing to open a song because of it would be worse than the bug.
 *
 * The rule is *the difference*, exactly as `brokeALink` is: a song that
 * arrived with a problem is allowed to keep it until someone chooses to fix
 * it; an edit is not allowed to add one.
 */
import { ticksPerSlot } from "@/lib/music/timing";
import { isMelodicSlotArray, type Song } from "@/lib/song/schema";

export type StringCollision = {
  readonly trackId: string;
  readonly sectionId: string;
  readonly barIndex: number;
  readonly slotIndex: number;
  /** Which string both notes want. */
  readonly stringIndex: number;
  /** The notes competing for it, in written order. */
  readonly pitches: readonly string[];
  /** Where in the bar, so a message can say "3. vuruş" rather than a slot. */
  readonly beat: number;
};

/** A stable name for one collision, so two lists can be compared. */
export function collisionKey(collision: StringCollision): string {
  return `${collision.trackId}:${collision.sectionId}:${collision.barIndex}:${collision.slotIndex}:${collision.stringIndex}`;
}

/**
 * Every place a string is asked for twice at once.
 *
 * Notes with no placement are skipped: a note nothing could put on a string
 * is not competing for one, and the placement engine reports that separately.
 */
export function stringCollisions(
  song: Song,
  trackId?: string,
): readonly StringCollision[] {
  const found: StringCollision[] = [];

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      const beatTicks = ticksPerSlot(4);
      for (const [id, slots] of Object.entries(bar.slots)) {
        if (trackId !== undefined && id !== trackId) continue;
        if (!isMelodicSlotArray(slots)) continue;

        slots.forEach((slot, slotIndex) => {
          if (slot === null || slot === "-") return;
          const byString = new Map<number, string[]>();
          for (const note of slot.notes) {
            const string = note.position?.string;
            if (string === undefined) continue;
            byString.set(string, [...(byString.get(string) ?? []), note.pitch]);
          }
          for (const [stringIndex, pitches] of byString) {
            if (pitches.length < 2) continue;
            found.push({
              trackId: id,
              sectionId: section.id,
              barIndex,
              slotIndex,
              stringIndex,
              pitches,
              beat: Math.floor((slotIndex * ticksPerSlot(bar.resolution)) / beatTicks) + 1,
            });
          }
        });
      }
    });
  }

  return found;
}

/**
 * The collisions an edit added, ignoring the ones it inherited.
 *
 * This is the whole gate. A song that already had one keeps it; a command
 * that would create one is refused.
 */
export function collisionsIntroduced(
  before: Song,
  after: Song,
  trackId?: string,
): readonly StringCollision[] {
  const had = new Set(stringCollisions(before, trackId).map(collisionKey));
  return stringCollisions(after, trackId).filter(
    (collision) => !had.has(collisionKey(collision)),
  );
}

/** What the reader is told, in their words rather than the model's. */
export function collisionMessage(collision: StringCollision): string {
  const [first, second] = collision.pitches;
  return (
    `${collision.barIndex + 1}. ölçünün ${collision.beat}. vuruşunda ` +
    `${collision.stringIndex + 1}. tel iki kez isteniyor (${first} ve ${second}). ` +
    "Bir tel aynı anda tek ses verir."
  );
}
