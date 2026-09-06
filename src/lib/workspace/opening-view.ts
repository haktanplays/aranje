/**
 * Which surface a song opens on (2V-E.1 §8).
 *
 * "Düzen" has opened first since spec 13.10, and the reason was right for the
 * song it was written about: someone opening a piece they have not seen in a
 * week wants to know what shape it is before they read the third bar of the
 * first guitar.
 *
 * A song made thirty seconds ago has no shape. The first browser walk of the
 * new create flow landed on four empty bars of an arrangement grid — and the
 * arrangement is the one surface that deliberately carries neither the track
 * control nor the section stepper, because it draws every section already. So
 * the reader who had just pressed "Hemen başla" was standing in the only room
 * in the app with no door to writing music in it, and nothing on the screen
 * said the tab was where they should go next.
 *
 * The rule is about the music rather than about the moment: an untouched song
 * opens on the tab, and the arrangement takes over as soon as there is
 * something to survey. Deliberately not "was this project just created" —
 * that would need a flag threaded from the Home flow, would be wrong on the
 * second visit to a song still empty, and would make the opening view depend
 * on how the reader arrived rather than on what they are arriving at.
 */
import type { Song } from "@/lib/song/schema";
import type { WorkspaceView } from "@/components/workspace/ViewSwitch";

/**
 * True when no track has a single note or hit anywhere in the song.
 *
 * A slot list is never absent on a writable track — it is a full row of
 * rests, and a rest is `null` on a melodic track and `[]` on a drum one. So
 * the question is not whether the row exists but whether anything in it is a
 * sound: a bar of eight nulls is as empty as a bar with no row at all, and a
 * length test would call it written.
 *
 * The loop leaves the moment it finds anything, so on a song that has music
 * in it the cost is the first written slot.
 */
export function isUntouched(song: Song): boolean {
  for (const section of song.sections) {
    for (const bar of section.bars) {
      for (const slots of Object.values(bar.slots)) {
        for (const slot of slots) {
          if (slot === null) continue;
          /* A tie carries a previous sound, so it is one. */
          if (slot === "-") return false;
          if (Array.isArray(slot)) {
            if (slot.length > 0) return false;
            continue;
          }
          return false;
        }
      }
    }
  }
  return true;
}

export function openingView(song: Song): WorkspaceView {
  return isUntouched(song) ? "tab" : "arrange";
}
