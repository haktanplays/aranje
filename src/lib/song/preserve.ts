/**
 * What an edit was allowed to touch, and proof it touched nothing else
 * (2V-B.4 §9).
 *
 * ## Why the previous round's proof was not enough
 *
 * `c11a758` showed that a local rhythm override leaves the following anchor
 * note on its tick and leaves every *other* measure alone. Both true, and
 * neither is the dangerous case. The dangerous case is the rest of the **same
 * measure**: a bar is re-expressed on a finer grid as one operation, every
 * lane in it moves together, and a mistake there would change music the
 * reader can see but was not editing — quietly, and in the one place they
 * would least expect it.
 *
 * ## A semantic snapshot, not a byte comparison
 *
 * A regridded bar has a different number of slots, so comparing slot arrays
 * would report a difference for every note whether or not anything happened
 * to it. What has to be equal is the *music*: for every sounding event, where
 * it starts in ticks, how long it lasts, what it sounds, where it is played,
 * how hard, how it is joined to its neighbours, and which onset it belongs to.
 * That is what `semanticSnapshot` produces, and it is grid-independent by
 * construction.
 *
 * ## The allowed path
 *
 * An edit declares, up front, the tick range it is allowed to change. Anything
 * outside that range must come back identical. The declaration is the
 * interesting part: a command that quietly widened it would be caught by the
 * same test that catches a command that quietly wrote outside it, because the
 * range is compared against what the reader asked for rather than against what
 * the command did.
 */
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { isDrumSlotArray, type Song } from "@/lib/song/schema";

/** One sounding event, described without reference to any grid. */
export type EventFingerprint = {
  readonly trackId: string;
  readonly sectionId: string;
  readonly barIndex: number;
  /** Ticks from the start of the bar. Grid-independent. */
  readonly atTicks: number;
  /** How long the run this event starts lasts, in ticks. */
  readonly lengthTicks: number;
  /**
   * Everything about the event that a reader could hear or see, as one
   * string. A string rather than a nested object so a diff names the event
   * rather than a path through it.
   */
  readonly what: string;
};

/** The whole song, or one bar of it, as a list of fingerprints. */
export type Snapshot = readonly EventFingerprint[];

/**
 * How long the sounding run starting at `index` lasts, in ticks.
 *
 * Ties are what make this necessary: a note written once and held over three
 * slots is one event of four slots' length, and on a finer grid it is one
 * event of the same length written over twelve. Counting the ties is what
 * makes the two comparable.
 */
function runTicks(
  slots: readonly unknown[],
  index: number,
  step: number,
): number {
  let ticks = step;
  for (let cursor = index + 1; cursor < slots.length; cursor += 1) {
    if (slots[cursor] !== "-") break;
    ticks += step;
  }
  return ticks;
}

function describeMelodic(slot: unknown): string {
  if (slot === null || slot === "-" || typeof slot !== "object") return "";
  const notes = (slot as { notes?: readonly Record<string, unknown>[] }).notes ?? [];
  /*
   * Sorted, and every field named. Two chords with the same notes written in
   * a different order are the same chord, and a comparison that called them
   * different would fail for a reason that is not about the music.
   */
  return notes
    .map((note) => {
      const position = note.position as { string?: number; fret?: number } | undefined;
      return [
        `p=${String(note.pitch ?? "")}`,
        `s=${position?.string ?? ""}`,
        `f=${position?.fret ?? ""}`,
        `v=${note.velocity ?? ""}`,
        `a=${String(note.articulation ?? "")}`,
        `d=${note.durationTicks ?? ""}`,
        `r=${note.letRing === true ? 1 : 0}`,
        `t=${String(note.strum ?? "")}`,
      ].join(",");
    })
    .sort()
    .join(" | ");
}

function describeDrum(slot: unknown): string {
  if (!Array.isArray(slot)) return "";
  return slot
    .map((hit: Record<string, unknown>) =>
      `k=${String(hit.piece ?? "")},v=${hit.velocity ?? ""},a=${String(hit.articulation ?? "")}`,
    )
    .sort()
    .join(" | ");
}

/**
 * Every sounding event in the song, or in one bar of it.
 *
 * `bar` narrows it to one measure, which is the case §9 is about: the claim
 * being made is "the rest of *this* bar is untouched", and a snapshot of the
 * whole song would drown it in bars nobody suspected.
 */
export function semanticSnapshot(
  song: Song,
  bar?: { readonly sectionId: string; readonly barIndex: number },
): Snapshot {
  const out: EventFingerprint[] = [];
  for (const section of song.sections) {
    if (bar && section.id !== bar.sectionId) continue;
    for (const [barIndex, entry] of section.bars.entries()) {
      if (bar && barIndex !== bar.barIndex) continue;
      const step = ticksPerSlot(entry.resolution);
      const count = slotCount(entry.timeSignature, entry.resolution);
      for (const [trackId, slots] of Object.entries(entry.slots)) {
        const drums = isDrumSlotArray(slots);
        for (let index = 0; index < Math.min(slots.length, count); index += 1) {
          const slot = slots[index];
          if (slot === null || slot === "-" || slot === undefined) continue;
          if (drums && Array.isArray(slot) && slot.length === 0) continue;
          const what = drums ? describeDrum(slot) : describeMelodic(slot);
          if (what === "") continue;
          out.push({
            trackId,
            sectionId: section.id,
            barIndex,
            atTicks: index * step,
            lengthTicks: drums ? step : runTicks(slots, index, step),
            what,
          });
        }
      }
    }
  }
  /* Deterministic order, so two snapshots of the same music are the same
     list — which is what makes an equality comparison meaningful at all. */
  return out.sort((left, right) =>
    left.trackId === right.trackId
      ? left.atTicks - right.atTicks
      : left.trackId.localeCompare(right.trackId),
  );
}

/** The ticks an edit said it was allowed to change, inside one bar. */
export type AllowedPath = {
  readonly sectionId: string;
  readonly barIndex: number;
  /** Half-open, in ticks from the start of the bar. */
  readonly fromTicks: number;
  readonly toTicks: number;
  /** Tracks the edit may touch. Everything else is out of bounds. */
  readonly trackIds: readonly string[];
};

const inside = (event: EventFingerprint, path: AllowedPath): boolean =>
  event.sectionId === path.sectionId &&
  event.barIndex === path.barIndex &&
  path.trackIds.includes(event.trackId) &&
  event.atTicks < path.toTicks &&
  event.atTicks + event.lengthTicks > path.fromTicks;

export type PreservationBreach = {
  readonly reason: "changed" | "removed" | "added";
  readonly event: EventFingerprint;
};

/**
 * Everything the edit changed that it had not declared.
 *
 * An empty list is the contract holding. A non-empty one names the event, so
 * a failing test says "the bass note at tick 384 changed" rather than "the
 * songs differ".
 */
export function breachesOutside(
  before: Song,
  after: Song,
  path: AllowedPath,
): PreservationBreach[] {
  const key = (event: EventFingerprint) =>
    `${event.sectionId}#${event.barIndex}#${event.trackId}#${event.atTicks}`;

  const was = new Map(
    semanticSnapshot(before)
      .filter((event) => !inside(event, path))
      .map((event) => [key(event), event]),
  );
  const now = new Map(
    semanticSnapshot(after)
      .filter((event) => !inside(event, path))
      .map((event) => [key(event), event]),
  );

  const breaches: PreservationBreach[] = [];
  for (const [id, event] of was) {
    const next = now.get(id);
    if (!next) {
      breaches.push({ reason: "removed", event });
      continue;
    }
    if (next.what !== event.what || next.lengthTicks !== event.lengthTicks) {
      breaches.push({ reason: "changed", event: next });
    }
  }
  for (const [id, event] of now) {
    if (!was.has(id)) breaches.push({ reason: "added", event });
  }
  return breaches;
}

/**
 * Bar and track metadata, which an edit may also not disturb.
 *
 * The resolution is the one exception and it is named rather than skipped: a
 * local override changes it on purpose, and the caller says which bar is
 * allowed to have moved.
 */
export function structureDigest(song: Song, allowResolutionAt?: { sectionId: string; barIndex: number }): string {
  return song.sections
    .map((section) =>
      [
        section.id,
        section.name,
        section.status,
        section.bpmOverride ?? "",
        JSON.stringify(section.phrases ?? []),
        section.bars
          .map((bar, index) => {
            const skip =
              allowResolutionAt &&
              allowResolutionAt.sectionId === section.id &&
              allowResolutionAt.barIndex === index;
            return [
              bar.timeSignature.join("/"),
              skip ? "res:*" : `res:${bar.resolution}`,
              Object.keys(bar.slots).sort().join("+"),
            ].join(",");
          })
          .join(";"),
      ].join("|"),
    )
    .join("\n");
}

/** Track identity and mix, which no musical edit may rewrite. */
export function trackDigest(song: Song): string {
  return song.tracks
    .map((track) =>
      [
        track.id,
        track.name,
        track.instrumentId,
        track.presetId,
        track.volumeDb,
        track.pan ?? "",
        track.muted === true ? 1 : 0,
        track.soloed === true ? 1 : 0,
        track.fretboard ? `${track.fretboard.tuning.join("-")}@${track.fretboard.capo}` : "",
      ].join(","),
    )
    .join("\n");
}
