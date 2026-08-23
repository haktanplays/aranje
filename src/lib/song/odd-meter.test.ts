/**
 * 3/4 and 7/8, end to end (2L-C §0).
 *
 * The Song Contract and the timing core have held these two meters since
 * 2H-A; only the section form was still narrowing to the pilot's original
 * pair. This suite is what makes opening them a fact rather than a hope: a
 * section in each meter is created through the real command, survives a
 * project round trip, comes back byte-for-byte through undo/redo, and lands
 * on the bar start ticks the timing core computes.
 */
import { describe, expect, it } from "vitest";

import { barTimeline } from "@/lib/audio/schedule";
import {
  RESOLUTIONS,
  TIME_SIGNATURES,
  formatTimeSignature,
  isRepresentableGrid,
} from "@/lib/music/timing";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { sameSong } from "@/lib/song/edit-history";
import { createSongStore } from "@/lib/song/song-store";
import { decideLoad } from "@/lib/song/storage-envelope";
import { applySectionCommand } from "@/lib/song/section-lifecycle";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import type { Resolution, Song, TimeSignature } from "@/lib/song/schema";

/** The contract's mutable tuple, from timing's readonly one. */
const asMeter = (meter: readonly [number, number]) =>
  [meter[0], meter[1]] as TimeSignature;

const addSection = (
  song: Song,
  name: string,
  timeSignature: TimeSignature,
  resolution: Resolution,
) =>
  applySectionCommand(song, {
    kind: "create_section",
    name,
    position: { kind: "end" },
    barCount: 2,
    timeSignature,
    resolution,
  });

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const storedSong = (storage: { map: Map<string, string> }) => {
  const decision = decideLoad(storage.map.get(SONG_KEY) ?? null);
  return "song" in decision ? decision.song : null;
};

describe("54. the section form's meters are the contract's meters", () => {
  it("creates a section in every meter the contract holds", () => {
    for (const meter of TIME_SIGNATURES) {
      const grid = RESOLUTIONS.find((entry) =>
        isRepresentableGrid(meter, entry),
      )!;
      const result = addSection(
        SAMPLE_SONG,
        `Bölüm ${formatTimeSignature(meter)}`,
        asMeter(meter),
        grid,
      );
      expect(result.ok, formatTimeSignature(meter)).toBe(true);
      if (result.ok) {
        const created = result.song.sections.at(-1)!;
        expect(created.bars[0]?.timeSignature).toEqual(meter);
        expect(created.bars).toHaveLength(2);
      }
    }
  });

  it("writes 3/4 on all five grids", () => {
    const meter: TimeSignature = [3, 4];
    const accepted = RESOLUTIONS.filter((grid) =>
      addSection(SAMPLE_SONG, "Vals", meter, grid).ok,
    );
    expect(accepted).toEqual([...RESOLUTIONS]);
  });

  it("writes 7/8 on the straight grids and refuses the triplet one", () => {
    const meter: TimeSignature = [7, 8];
    const accepted = RESOLUTIONS.filter((grid) =>
      addSection(SAMPLE_SONG, "Yedi Sekiz", meter, grid).ok,
    );
    expect(accepted).toEqual([8, 16, 24, 32]);

    // Fail-closed, with the code the form's own filter is derived from.
    const refused = addSection(SAMPLE_SONG, "Yedi Sekiz", meter, 12);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("grid_not_representable");
    }
  });
});

describe("55. odd meters survive the round trips that matter", () => {
  /** The sample song plus a 3/4 and a 7/8 section, both two bars long. */
  const mixed = (() => {
    const first = addSection(SAMPLE_SONG, "Vals", [3, 4], 16);
    if (!first.ok) throw new Error("3/4 section refused");
    const second = addSection(first.song, "Yedi Sekiz", [7, 8], 16);
    if (!second.ok) throw new Error("7/8 section refused");
    return second.song;
  })();

  it("exports and imports the odd meters unchanged", () => {
    const exported = exportProject(mixed);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const parsed = parseProjectText(exported.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    /*
     * Structural rather than textual: the export is canonical (2L-A), so it
     * sorts keys the in-memory song never promised to. The byte claim that
     * *is* true of a canonical format is asserted underneath — exporting
     * what came back produces the identical file.
     */
    expect(sameSong(parsed.song, mixed)).toBe(true);
    const again = exportProject(parsed.song);
    expect(again.ok && again.text).toBe(exported.text);

    const meters = parsed.song.sections.map(
      (section) => section.bars[0]?.timeSignature,
    );
    expect(meters).toContainEqual([3, 4]);
    expect(meters).toContainEqual([7, 8]);
  });

  it("undoes and redoes an odd-meter section byte-for-byte", () => {
    const storage = memoryStorage();
    const store = createSongStore(
      { song: SAMPLE_SONG, outcome: "stored", canPersist: true },
      storage,
    );
    // A written baseline first, so both comparisons read the same writer.
    const baseline = applySectionCommand(store.getSnapshot().song, {
      kind: "rename_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
      name: "Giriş",
    });
    if (!baseline.ok) throw new Error("baseline refused");
    store.commit(baseline.song, {
      kind: "lifecycle",
      command: "rename_section",
    });
    const before = JSON.stringify(storedSong(storage));

    const odd = addSection(store.getSnapshot().song, "Yedi Sekiz", [7, 8], 16);
    if (!odd.ok) throw new Error("7/8 section refused");
    store.commit(odd.song, { kind: "lifecycle", command: "create_section" });
    const after = JSON.stringify(storedSong(storage));
    expect(after).not.toBe(before);

    store.undo();
    expect(JSON.stringify(storedSong(storage))).toBe(before);
    store.redo();
    expect(JSON.stringify(storedSong(storage))).toBe(after);
  });

  it("starts every bar on the tick the timing core computes", () => {
    const bars = barTimeline(mixed);
    // Each bar begins where the one before it ended — including across a
    // meter change, which is the whole point of asking.
    let expected = 0;
    for (const bar of bars) {
      expect(bar.time, bar.barKey).toBe(expected);
      expected += bar.durationTicks;
    }

    const durationsOf = (sectionId: string) =>
      bars.filter((bar) => bar.sectionId === sectionId).map((b) => b.durationTicks);
    const waltz = mixed.sections.find((s) => s.name === "Vals")!;
    const seven = mixed.sections.find((s) => s.name === "Yedi Sekiz")!;
    // 3/4 at 1/16 is twelve slots of 48 ticks; 7/8 at 1/16 is fourteen.
    expect(durationsOf(waltz.id)).toEqual([576, 576]);
    expect(durationsOf(seven.id)).toEqual([672, 672]);
  });
});
