/**
 * A section's length, after it exists (2V-E.1 §15).
 *
 * The gap this closes was found by walking, not by reading: the section
 * manager offered rename, duplicate, tempo, reorder and delete, and the bar
 * count only ever appeared on the *create* form. A reader who wanted a longer
 * verse had to delete it and build a new one, which throws away the music
 * they had already written in it.
 */
import { describe, expect, it } from "vitest";

import { songLimits } from "@/lib/limits";
import { applySectionCommand } from "@/lib/song/section-lifecycle";
import { materializeTemplate } from "@/lib/song/song-templates";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const base = (): Song => {
  const made = materializeTemplate("empty");
  if (!made) throw new Error("the empty template did not materialise");
  return made;
};

const resize = (song: Song, barCount: number) =>
  applySectionCommand(song, {
    kind: "set_section_bar_count",
    sectionId: song.sections[0]!.id,
    barCount,
  });

const ok = (result: ReturnType<typeof resize>): Song => {
  if (!result.ok) throw new Error(`refused: ${result.error.code}`);
  return result.song;
};

/** One note in the last bar, so shrinking has something to be about. */
function writeInLastBar(song: Song): Song {
  const section = song.sections[0]!;
  const index = section.bars.length - 1;
  const bar = section.bars[index]!;
  const trackId = song.tracks[0]!.id;
  const row: MelodicSlot[] = Array.from({ length: bar.resolution }, () => null);
  row[0] = { notes: [{ pitch: "E2" }] };
  const bars = section.bars.map((entry, at) =>
    at === index ? { ...entry, slots: { ...entry.slots, [trackId]: row } } : entry,
  );
  return { ...song, sections: [{ ...section, bars }, ...song.sections.slice(1)] };
}

describe("405. making a section longer", () => {
  it("appends bars up to the number asked for", () => {
    const song = base();
    const before = song.sections[0]!.bars.length;
    expect(before).toBe(4);
    expect(ok(resize(song, 8)).sections[0]!.bars.length).toBe(8);
  });

  it("keeps the music that was already there", () => {
    const written = writeInLastBar(base());
    const grown = ok(resize(written, 8));
    expect(grown.sections[0]!.bars[3]).toEqual(written.sections[0]!.bars[3]);
  });

  it("gives the new bars the shape of the last one, not the song's default", () => {
    const song = base();
    const section = song.sections[0]!;
    const odd = {
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        timeSignature: [7, 8] as [7, 8],
        resolution: 16 as const,
        grouping: [2, 2, 3],
        slots: {},
      })),
    };
    const grown = ok(resize({ ...song, sections: [odd] }, 6));
    const added = grown.sections[0]!.bars[5]!;
    expect(added.timeSignature).toEqual([7, 8]);
    expect(added.resolution).toBe(16);
    expect(added.grouping).toEqual([2, 2, 3]);
  });

  it("writes silence into the new bars rather than repeating the last one", () => {
    const grown = ok(resize(writeInLastBar(base()), 6));
    expect(grown.sections[0]!.bars[4]!.slots).toEqual({});
  });
});

describe("406. making a section shorter", () => {
  it("drops bars from the end", () => {
    expect(ok(resize(base(), 2)).sections[0]!.bars.length).toBe(2);
  });

  it("keeps the bars it did not drop", () => {
    const written = writeInLastBar(base());
    const first = written.sections[0]!.bars[0]!;
    expect(ok(resize(written, 2)).sections[0]!.bars[0]).toEqual(first);
  });

  it("takes the music in the dropped bars with it, which is why the surface warns", () => {
    const written = writeInLastBar(base());
    const trackId = written.tracks[0]!.id;
    expect(written.sections[0]!.bars[3]!.slots[trackId]).toBeDefined();
    const shrunk = ok(resize(written, 3));
    expect(shrunk.sections[0]!.bars.length).toBe(3);
    /* The guard normalises kept bars to full rows of rests, so the question
       is whether any slot still holds a sound — not whether the row exists. */
    for (const bar of shrunk.sections[0]!.bars) {
      for (const slot of bar.slots[trackId] ?? []) expect(slot).toBeNull();
    }
  });
});

describe("407. the lengths it refuses", () => {
  it("refuses zero, because a section with no bars is not a section", () => {
    const result = resize(base(), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bar_count_out_of_range");
  });

  it("refuses more than the per-section cap", () => {
    const result = resize(base(), songLimits.barsPerSection + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bar_count_out_of_range");
  });

  it("accepts exactly the cap, so the refusal is a boundary and not a mood", () => {
    expect(ok(resize(base(), songLimits.barsPerSection)).sections[0]!.bars.length).toBe(
      songLimits.barsPerSection,
    );
  });

  it("refuses a half bar", () => {
    const result = resize(base(), 4.5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bar_count_out_of_range");
  });

  it("refuses when the song as a whole would go over its limit", () => {
    /*
     * A song already exactly at its total, whose *first* section still has
     * room under the per-section cap — so the refusal that fires is the
     * song's and not the section's, and the two are told apart.
     */
    const song = base();
    const shape = song.sections[0]!;
    const per = songLimits.barsPerSection;
    const bar = shape.bars[0]!;
    const sectionOf = (id: string, count: number) => ({
      ...shape,
      id,
      name: id,
      bars: Array.from({ length: count }, () => bar),
    });
    const sections = [sectionOf("section-1", per - 1)];
    let placed = per - 1;
    for (let n = 2; placed < songLimits.totalBars; n += 1) {
      const take = Math.min(per, songLimits.totalBars - placed);
      sections.push(sectionOf(`section-${n}`, take));
      placed += take;
    }
    const filled: Song = { ...song, sections };
    expect(placed).toBe(songLimits.totalBars);
    expect(sections[0]!.bars.length).toBeLessThan(per);

    const result = resize(filled, per);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("song_bar_limit_reached");
  });

  it("says nothing about a section that is not there", () => {
    const result = applySectionCommand(base(), {
      kind: "set_section_bar_count",
      sectionId: "section-nope",
      barCount: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("section_not_found");
  });

  it("asking for the length it already has changes nothing", () => {
    const song = writeInLastBar(base());
    expect(ok(resize(song, 4))).toEqual(song);
  });
});
