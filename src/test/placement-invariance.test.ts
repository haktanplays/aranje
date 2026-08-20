import { describe, expect, it } from "vitest";

import { buildSongPlan } from "@/lib/audio/schedule";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";
import { PLACEMENT_FIXTURES, UNPOSITIONED_DEMO } from "@/test/placement-fixtures";

/**
 * The placement engine derives positions and nothing else (spec 9.2, K-19).
 *
 * These are the tests that say so: what is played, when, how loudly and for
 * how long is compared against the song itself, so a placement engine that
 * ever changed a note would be caught by the thing it changed rather than by a
 * reviewer noticing.
 */

/** Everything the Song says about what sounds, with no position anywhere. */
function musicalContent(song: Song) {
  return song.sections.map((section) => ({
    id: section.id,
    name: section.name,
    status: section.status,
    bars: section.bars.map((bar) => ({
      timeSignature: bar.timeSignature,
      resolution: bar.resolution,
      slots: Object.fromEntries(
        Object.entries(bar.slots).map(([trackId, slots]) => [
          trackId,
          slots.map((slot) => {
            if (Array.isArray(slot)) return slot;
            if (slot === null || slot === "-") return slot;
            return slot.notes.map((note) => ({
              pitch: note.pitch,
              velocity: note.velocity ?? null,
              articulation: note.articulation ?? null,
            }));
          }),
        ]),
      ),
    })),
  }));
}

describe("placement changes positions and nothing else", () => {
  for (const fixture of PLACEMENT_FIXTURES) {
    it(`${fixture.id}: the scheduler plays exactly the same events`, () => {
      // The plan is built from the timeline, which is where placement
      // happens. Building it twice would prove only determinism, so the
      // events are compared against what the Song itself says instead.
      const plan = buildSongPlan(fixture.song);
      const notes = plan.events.filter((event) => event.kind === "note");

      const expected: { time: number; pitch: string }[] = [];
      let barTime = 0;
      for (const bar of plan.bars) {
        const section = fixture.song.sections.find(
          (entry) => entry.id === bar.sectionId,
        );
        const source = section?.bars[Number(bar.barKey.split(":")[1])];
        barTime = bar.time;
        const slots = source?.slots[fixture.trackId];
        if (!slots) continue;

        const step = (192 * 4) / bar.resolution;
        slots.forEach((slot, slotIndex) => {
          // A tie is not a new event; every struck slot is.
          if (Array.isArray(slot) || slot === null || slot === "-") return;
          for (const note of slot.notes) {
            expected.push({ time: barTime + slotIndex * step, pitch: note.pitch });
          }
        });
      }

      const played = notes
        .filter((event) => event.trackId === fixture.trackId)
        .map((event) => ({ time: event.time, pitch: event.pitch }))
        .sort((a, b) => a.time - b.time || (a.pitch < b.pitch ? -1 : 1));

      expected.sort((a, b) => a.time - b.time || (a.pitch < b.pitch ? -1 : 1));
      // Not two empty lists agreeing with each other.
      expect(expected.length).toBeGreaterThan(0);
      expect(played).toEqual(expected);
    });
  }

  it("gives the same plan every time it is built", () => {
    const first = JSON.stringify(buildSongPlan(SAMPLE_SONG).events);
    for (let round = 0; round < 20; round += 1) {
      expect(JSON.stringify(buildSongPlan(SAMPLE_SONG).events)).toBe(first);
    }
  });

  it("plays the same notes whether or not positions were written", () => {
    // Stripping every written position changes where the tab draws the notes
    // and nothing about what is heard.
    const withPositions = buildSongPlan(SAMPLE_SONG).events;
    const without = buildSongPlan(UNPOSITIONED_DEMO).events;
    expect(without).toEqual(withPositions);
  });

  it("leaves the musical content of the song untouched", () => {
    const before = musicalContent(SAMPLE_SONG);
    buildSongPlan(SAMPLE_SONG);
    buildTrackTimeline(SAMPLE_SONG, "gtr");
    expect(musicalContent(SAMPLE_SONG)).toEqual(before);
  });

  it("does not touch the song object at all", () => {
    const before = JSON.stringify(SAMPLE_SONG);
    buildTrackTimeline(SAMPLE_SONG, "gtr");
    buildTrackTimeline(SAMPLE_SONG, "bass");
    buildSongPlan(SAMPLE_SONG);
    expect(JSON.stringify(SAMPLE_SONG)).toBe(before);
  });

  it("leaves the drum timeline alone", () => {
    const drums = buildTrackTimeline(SAMPLE_SONG, "drums");
    expect(drums.kind).toBe("drums");
    const again = buildTrackTimeline(SAMPLE_SONG, "drums");
    expect(JSON.stringify(again)).toBe(JSON.stringify(drums));
  });

  it("leaves a track with no fretboard alone", () => {
    const piano: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track) =>
        track.id === "gtr"
          ? {
              ...track,
              instrumentId: "piano",
              presetId: "grand",
              fretboard: undefined,
            }
          : track,
      ),
    };
    expect(buildTrackTimeline(piano, "gtr").kind).toBe("unsupported");
  });
});
