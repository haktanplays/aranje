import { describe, expect, it } from "vitest";

import { placementLimits } from "@/lib/limits";
import { maxShiftFor } from "@/lib/music/hand-position";
import { placeTrack } from "@/lib/music/placement";
import { trackPlacementInput } from "@/lib/tab/placement-input";
import { baselineMetrics, ergonomicMetrics } from "@/test/placement-baseline";
import { PLACEMENT_FIXTURES } from "@/test/placement-fixtures";
import type { Track } from "@/lib/song/schema";

function trackOf(fixtureIndex: number): { track: Track; song: (typeof PLACEMENT_FIXTURES)[number]["song"] } {
  const fixture = PLACEMENT_FIXTURES[fixtureIndex];
  if (!fixture) throw new Error("no such fixture");
  const track = fixture.song.tracks.find((entry) => entry.id === fixture.trackId);
  if (!track) throw new Error(`fixture ${fixture.id} has no ${fixture.trackId}`);
  return { track, song: fixture.song };
}

describe("placement quality against the memoryless baseline", () => {
  PLACEMENT_FIXTURES.forEach((fixture, index) => {
    it(`${fixture.id}: never places worse, and never loses a note`, () => {
      const { track, song } = trackOf(index);
      const before = baselineMetrics(song, track);
      const after = ergonomicMetrics(song, track);
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      if (!before || !after) return;

      // The acceptance condition of the checkpoint: no product fixture may
      // gain a large jump.
      expect(after.largeJumps).toBeLessThanOrEqual(before.largeJumps);
      // And nothing may become unplaceable that was placeable.
      expect(after.unresolvedOnsets).toBeLessThanOrEqual(before.unresolvedOnsets);
      // The same notes are still being placed.
      expect(after.onsets).toBe(before.onsets);
    });
  });

  it("the synthetic cross-neck riff improves markedly", () => {
    const index = PLACEMENT_FIXTURES.findIndex((entry) =>
      entry.id.startsWith("cross-neck"),
    );
    const { track, song } = trackOf(index);
    const before = baselineMetrics(song, track);
    const after = ergonomicMetrics(song, track);
    if (!before || !after) throw new Error("fixture is not fretted");

    // This is the shape the old rule handles badly; the new one should be
    // visibly better on both counts.
    expect(before.largeJumps).toBeGreaterThan(0);
    expect(after.largeJumps).toBe(0);
    expect(after.anchorTravel).toBeLessThan(before.anchorTravel);
    expect(after.worstJump).toBeLessThan(before.worstJump);
  });

  it("leaves written positions exactly where they were written", () => {
    const index = PLACEMENT_FIXTURES.findIndex((entry) => entry.id === "explicit heavy");
    const { track, song } = trackOf(index);
    if (!track.fretboard) throw new Error("fixture is not fretted");

    const { onsets, bars } = trackPlacementInput(song, track.id);
    const result = placeTrack({
      fretboard: track.fretboard,
      onsets,
      bars,
      maxShift: maxShiftFor(track.instrumentId) ?? 7,
    });

    for (const onset of onsets) {
      const outcome = result.byOnset.get(onset.key);
      if (!outcome || outcome.kind === "unresolved") continue;
      onset.notes.forEach((note, noteIndex) => {
        if (!note.position) return;
        const placedNote = outcome.voicing.notes.find(
          (entry) => entry.noteIndex === noteIndex,
        );
        expect(placedNote).toMatchObject({
          stringIndex: note.position.string,
          fret: note.position.fret,
          source: "explicit",
        });
      });
    }
  });

  PLACEMENT_FIXTURES.forEach((fixture, index) => {
    it(`${fixture.id}: the narrow beam finds what the wide one finds`, () => {
      const { track, song } = trackOf(index);
      if (!track.fretboard) return;
      const maxShift = maxShiftFor(track.instrumentId);
      if (maxShift === null) return;

      const { onsets, bars } = trackPlacementInput(song, track.id);
      const narrow = placeTrack({
        fretboard: track.fretboard,
        onsets,
        bars,
        maxShift,
        beamWidth: placementLimits.beamWidth,
      });
      const wide = placeTrack({
        fretboard: track.fretboard,
        onsets,
        bars,
        maxShift,
        beamWidth: placementLimits.referenceBeamWidth,
      });

      const read = (result: typeof narrow) =>
        onsets.map((onset) => {
          const outcome = result.byOnset.get(onset.key);
          if (!outcome || outcome.kind === "unresolved") return null;
          return outcome.voicing.signature;
        });

      expect(read(narrow)).toEqual(read(wide));
    });
  });
});
