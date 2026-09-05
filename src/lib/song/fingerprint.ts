/**
 * What makes two songs the same music (2T-C §3).
 *
 * ## Why identity is not content
 *
 * A fixture written through the real UI and the canonical one in the test
 * suite will never be byte-equal, and should not be: they have different
 * titles, different project ids, different section names, and were made at
 * different times. None of that is music. If the comparison included them,
 * the answer would always be "different" and the check would be measuring
 * nothing.
 *
 * So this reduces a song to what a listener would notice: how fast it goes,
 * what shape each bar is, and, in every slot of every track, the notes with
 * everything that changes how they sound. Tracks are matched by *position*
 * rather than by id, because "the first track" is a musical fact and "gtr" is
 * a name somebody typed.
 *
 * ## What counts as sounding different
 *
 * Pitch, string, fret, how long, how hard, how struck, whether it rings on,
 * whether it is strummed. Two songs agreeing on all of those in the same
 * order at the same moments are the same music, whatever they are called.
 */
import { isMelodicSlotArray, type MelodicSlot, type Song } from "@/lib/song/schema";

/** One slot, reduced to what it sounds like. */
function slotDigest(slot: MelodicSlot | undefined): string {
  if (slot === null || slot === undefined) return ".";
  if (slot === "-") return "-";
  return slot.notes
    .map((note) =>
      [
        note.pitch,
        note.position === undefined
          ? "?"
          : `${note.position.string}/${note.position.fret}`,
        note.durationTicks ?? "",
        note.velocity ?? "",
        note.articulation ?? "",
        note.letRing === true ? "L" : "",
        note.strum ?? "",
        /* The four expression axes. Without them two songs differing only by
           a bend or a palm mute fingerprint the same, and every "did this
           edit change the music" question built on it answers no. */
        note.attack ?? "",
        note.picking ?? "",
        note.pitchGesture === undefined ? "" : JSON.stringify(note.pitchGesture),
        note.connection?.kind ?? "",
      ].join(","),
    )
    .join("+");
}

/**
 * The musical content of a song, as a string two of them can be compared by.
 *
 * Deliberately readable rather than hashed: when two fixtures disagree, the
 * useful thing is to see *where*, and a hash can only say "somewhere".
 */
export function musicalFingerprint(song: Song): string {
  const lines: string[] = [`bpm=${song.bpm}`];

  song.sections.forEach((section, sectionIndex) => {
    /*
     * Spans before the bars, because a span is music the bars do not carry.
     * Sorted rather than taken in written order: two songs that hold the same
     * spans in a different order are the same music, and a fingerprint that
     * said otherwise would report every reordering as an edit.
     */
    const spans = [...(section.techniqueSpans ?? [])]
      .map(
        (span) =>
          `${span.kind}@${span.startTicks}-${span.endTicks}` +
          `:${span.trackId}:${[...span.stringIndices].sort((a, b) => a - b).join("/")}`,
      )
      .sort();
    if (spans.length > 0) lines.push(`${sectionIndex}:spans ${spans.join(" ")}`);

    section.bars.forEach((bar, barIndex) => {
      const shape = `${bar.timeSignature[0]}/${bar.timeSignature[1]}@${bar.resolution}`;
      song.tracks.forEach((track, trackIndex) => {
        const slots = bar.slots[track.id];
        if (slots === undefined) return;
        if (!isMelodicSlotArray(slots)) return;
        const written = slots.map(slotDigest).join("|");
        /* A bar of nothing but rests says nothing about the music. */
        if (/^[.|]*$/.test(written)) return;
        lines.push(`${sectionIndex}:${barIndex}:${trackIndex} ${shape} ${written}`);
      });
    });
  });

  return lines.join("\n");
}

/** Where two songs stop agreeing, or null when they are the same music. */
export function fingerprintDiff(a: Song, b: Song): string | null {
  const left = musicalFingerprint(a).split("\n");
  const right = musicalFingerprint(b).split("\n");
  const rows = Math.max(left.length, right.length);
  for (let index = 0; index < rows; index += 1) {
    if (left[index] === right[index]) continue;
    return `satır ${index + 1}\n  beklenen: ${left[index] ?? "(yok)"}\n  yazılan:  ${right[index] ?? "(yok)"}`;
  }
  return null;
}
