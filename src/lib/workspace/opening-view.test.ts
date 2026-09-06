/**
 * Which surface a song opens on (2V-E.1 §8).
 *
 * The defect these tests were written against is in the walk artefact, not in
 * anyone's memory: `eval/first-song/artifacts/MANAGE-WALK.json` recorded every
 * track and section step reaching nothing, because the freshly created song
 * opened on the arrangement and the arrangement carries neither door.
 */
import { describe, expect, it } from "vitest";

import { isUntouched, openingView } from "@/lib/workspace/opening-view";
import { materializeTemplate } from "@/lib/song/song-templates";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const fresh = (): Song => {
  const made = materializeTemplate("empty");
  if (!made) throw new Error("the empty template did not materialise");
  return made;
};

/** The same song with one thing written into its first bar. */
function withFirstSlot(song: Song, slot: MelodicSlot): Song {
  const section = song.sections[0]!;
  const bar = section.bars[0]!;
  const trackId = Object.keys(bar.slots)[0]!;
  const row = [...(bar.slots[trackId] as readonly MelodicSlot[])];
  row[0] = slot;
  const next: Bar = { ...bar, slots: { ...bar.slots, [trackId]: row } };
  return {
    ...song,
    sections: [
      { ...section, bars: [next, ...section.bars.slice(1)] },
      ...song.sections.slice(1),
    ],
  };
}

const note: MelodicSlot = { notes: [{ pitch: "E2" }] };

describe("403. a song with nothing written in it", () => {
  it("is untouched however many empty bars and tracks it has", () => {
    const song = fresh();
    expect(song.sections[0]!.bars.length).toBeGreaterThan(0);
    expect(song.tracks.length).toBeGreaterThan(0);
    expect(isUntouched(song)).toBe(true);
  });

  it("opens on the tab, where writing happens", () => {
    expect(openingView(fresh())).toBe("tab");
  });

  /*
   * The non-vacuity guard for the two above: a row of rests is not an absent
   * row, so a length test on `bar.slots[trackId]` would call the empty
   * template written and this whole rule would never fire.
   */
  it("has full rows of rests rather than missing rows", () => {
    const bar = fresh().sections[0]!.bars[0]!;
    const rows = Object.values(bar.slots);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.length).toBeGreaterThan(0);
  });
});

describe("404. a song with music in it", () => {
  it("is touched by a single note", () => {
    expect(isUntouched(withFirstSlot(fresh(), note))).toBe(false);
  });

  it("opens on the arrangement, which is what 13.10 asked for", () => {
    expect(openingView(withFirstSlot(fresh(), note))).toBe("arrange");
  });

  it("counts a tie as sound, because it carries one", () => {
    expect(isUntouched(withFirstSlot(fresh(), "-"))).toBe(false);
  });

  it("does not count a rest", () => {
    expect(isUntouched(withFirstSlot(fresh(), null))).toBe(true);
  });

  it("counts a drum hit, so the rule is not about guitars", () => {
    const song = fresh();
    const section = song.sections[0]!;
    const bar = section.bars[0]!;
    const trackId = Object.keys(bar.slots)[0]!;
    const row = [[{ piece: "kick" as const }], []];
    const withHit: Song = {
      ...song,
      sections: [
        {
          ...section,
          bars: [{ ...bar, slots: { ...bar.slots, [trackId]: row } }, ...section.bars.slice(1)],
        },
        ...song.sections.slice(1),
      ],
    };
    expect(isUntouched(withHit)).toBe(false);
  });

  it("finds music in a later section, not only the first", () => {
    const song = fresh();
    const first = song.sections[0]!;
    const second = { ...first, id: "section-2", name: "Nakarat" };
    const twoSections: Song = { ...song, sections: [first, second] };
    expect(isUntouched(twoSections)).toBe(true);

    /* Written into the *second* section only, so a loop that stopped after
       the first would report an untouched song and open the empty grid. */
    const written = withFirstSlot({ ...song, sections: [second] }, note);
    const later: Song = { ...song, sections: [first, written.sections[0]!] };
    expect(isUntouched(later)).toBe(false);
    expect(openingView(later)).toBe("arrange");
  });
});
