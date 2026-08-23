import { describe, expect, it } from "vitest";

import {
  checkLockedSurface,
  contentKey,
  digestOf,
  surfaceDigest,
} from "@/lib/copilot/scope";
import { HARMONY_SONG, TEST_SONG, mainSection } from "@/test/copilot-fixtures";
import { modelPatchSchema } from "@/lib/copilot/contract";
import { MODEL_PATCH_JSON_SCHEMA } from "@/lib/copilot/output-schema";
import type { Song } from "@/lib/song/schema";

const SECTION = mainSection();
const TARGET = { sectionId: SECTION.id, targetTrackId: "drums" };

function unchanged(song: Song) {
  return checkLockedSurface(surfaceDigest(TEST_SONG), surfaceDigest(song), TARGET);
}

/** Rewrite one section of the song through a function. */
function editSection(song: Song, sectionId: string, edit: (s: Song["sections"][number]) => Song["sections"][number]): Song {
  return {
    ...song,
    sections: song.sections.map((section) =>
      section.id === sectionId ? edit(section) : section,
    ),
  };
}

describe("locked surface (spec 11.1, K-18)", () => {
  it("sees no violation when nothing moved", () => {
    expect(unchanged(TEST_SONG)).toEqual([]);
  });

  it("allows the target track's slots to change", () => {
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: { ...bar.slots, drums: Array.from({ length: 8 }, () => []) },
      })),
    }));
    expect(unchanged(changed)).toEqual([]);
  });

  it("catches another track in the same section changing", () => {
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: { ...bar.slots, gtr: Array.from({ length: 8 }, () => null) },
      })),
    }));
    const violations = unchanged(changed);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe(`content:${contentKey(SECTION.id, "gtr")}`);
  });

  it("catches the same track changing in another section", () => {
    const other = TEST_SONG.sections.find((s) => s.id !== SECTION.id);
    if (!other) throw new Error("fixture needs two sections");
    const changed = editSection(TEST_SONG, other.id, (section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: { ...bar.slots, drums: [] },
      })),
    }));
    const violations = unchanged(changed);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe(`content:${contentKey(other.id, "drums")}`);
  });

  it("catches a locked track appearing in a section it was silent in", () => {
    // The acoustic track is silent in the intro (spec 5.5). Writing it there
    // is a change to a locked surface, even though nothing it already had
    // moved.
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: { ...bar.slots, acc: Array.from({ length: 8 }, () => null) },
      })),
    }));
    const violations = unchanged(changed);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe(`content:${contentKey(SECTION.id, "acc")}`);
  });

  it("catches a locked track vanishing from a section", () => {
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: Object.fromEntries(
          Object.entries(bar.slots).filter(([trackId]) => trackId !== "gtr"),
        ),
      })),
    }));
    expect(unchanged(changed).map((v) => v.field)).toContain(
      `content:${contentKey(SECTION.id, "gtr")}`,
    );
  });

  it("catches a renamed section", () => {
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      name: "Yeni ad",
    }));
    expect(unchanged(changed).map((v) => v.field)).toEqual([
      `section:${SECTION.id}`,
    ]);
  });

  it("catches a changed section status, bar count or time signature", () => {
    const restatused = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      status: "pending" as const,
    }));
    expect(unchanged(restatused)).toHaveLength(1);

    const shorter = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bars: section.bars.slice(0, 2),
    }));
    expect(unchanged(shorter).length).toBeGreaterThan(0);

    const retimed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bars: section.bars.map((bar, index) =>
        index === 0 ? { ...bar, timeSignature: [6, 8] as [6, 8] } : bar,
      ),
    }));
    expect(unchanged(retimed)).toHaveLength(1);
  });

  it("catches a reordered or added section", () => {
    const reordered: Song = {
      ...TEST_SONG,
      sections: [...TEST_SONG.sections].reverse(),
    };
    expect(unchanged(reordered).map((v) => v.field)).toContain("sectionOrder");
  });

  it("catches a new track, a retuned track or a changed preset", () => {
    expect(unchanged(HARMONY_SONG).map((v) => v.field)).toContain("tracks");

    const retuned: Song = {
      ...TEST_SONG,
      tracks: TEST_SONG.tracks.map((track) =>
        track.id === "gtr" && track.fretboard
          ? { ...track, fretboard: { ...track.fretboard, capo: 2 } }
          : track,
      ),
    };
    expect(unchanged(retuned).map((v) => v.field)).toContain("tracks");

    const represet: Song = {
      ...TEST_SONG,
      tracks: TEST_SONG.tracks.map((track) =>
        track.id === "gtr" ? { ...track, presetId: "clean" } : track,
      ),
    };
    expect(unchanged(represet).map((v) => v.field)).toContain("tracks");
  });

  it("catches a track mix the model tried to move (2L-C)", () => {
    /*
     * The mixer writes `volumeDb` and `pan`; an arrange request may not.
     * Both fields are part of the track list digest, so an answer that
     * changed how loud a track is — or where it sits — is refused by the
     * same lock that refuses a retune.
     */
    const louder: Song = {
      ...TEST_SONG,
      tracks: TEST_SONG.tracks.map((track) =>
        track.id === "gtr" ? { ...track, volumeDb: track.volumeDb - 6 } : track,
      ),
    };
    expect(unchanged(louder).map((v) => v.field)).toContain("tracks");

    const panned: Song = {
      ...TEST_SONG,
      tracks: TEST_SONG.tracks.map((track) =>
        track.id === "gtr" ? { ...track, pan: -0.45 } : track,
      ),
    };
    expect(unchanged(panned).map((v) => v.field)).toContain("tracks");
  });

  it("catches changed song metadata", () => {
    for (const song of [
      { ...TEST_SONG, title: "Baska" },
      { ...TEST_SONG, bpm: TEST_SONG.bpm + 1 },
      { ...TEST_SONG, key: "C major" },
    ]) {
      expect(unchanged(song).map((v) => v.field)).toContain("song");
    }
  });

  it("reports violations in a fixed order", () => {
    const messy: Song = {
      ...editSection(
        { ...TEST_SONG, title: "Baska" },
        SECTION.id,
        (section) => ({
          ...section,
          name: "Yeni",
          bars: section.bars.map((bar) => ({
            ...bar,
            slots: { ...bar.slots, gtr: Array.from({ length: 8 }, () => null) },
          })),
        }),
      ),
      tracks: [...TEST_SONG.tracks].reverse(),
    };
    expect(unchanged(messy).map((v) => v.field)).toEqual([
      "song",
      "tracks",
      `section:${SECTION.id}`,
      `content:${contentKey(SECTION.id, "gtr")}`,
    ]);
  });

  it("digests the same value to the same string, every time", () => {
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
    expect(digestOf(TEST_SONG)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("a section's tempo is locked (spec 8.3, K-25)", () => {
  it("catches a section tempo being added", () => {
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bpmOverride: 60,
    }));
    const moved = unchanged(changed);
    expect(moved).not.toEqual([]);
    expect(moved.some((v) => v.field === `section:${SECTION.id}`)).toBe(true);
  });

  it("catches a section tempo being changed", () => {
    const slow = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bpmOverride: 60,
    }));
    const slower = editSection(slow, SECTION.id, (section) => ({
      ...section,
      bpmOverride: 61,
    }));
    expect(
      checkLockedSurface(surfaceDigest(slow), surfaceDigest(slower), TARGET),
    ).not.toEqual([]);
  });

  it("catches a section tempo being removed", () => {
    const slow = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bpmOverride: 60,
    }));
    expect(
      checkLockedSurface(surfaceDigest(slow), surfaceDigest(TEST_SONG), TARGET),
    ).not.toEqual([]);
  });

  it("catches it even in the section the patch is allowed to write", () => {
    // The target section's *slots* are writable; its tempo is not.
    const changed = editSection(TEST_SONG, SECTION.id, (section) => ({
      ...section,
      bpmOverride: 90,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: { ...bar.slots, drums: Array.from({ length: 8 }, () => []) },
      })),
    }));
    expect(unchanged(changed)).not.toEqual([]);
  });

  it("has nowhere in the answer schema to write a tempo at all", () => {
    // The first lock: a patch cannot even express a tempo.
    const text = JSON.stringify(MODEL_PATCH_JSON_SCHEMA);
    expect(text).not.toContain("bpm");
    expect(
      modelPatchSchema.safeParse({
        operation: "arrange_track",
        sectionId: SECTION.id,
        targetTrackId: "drums",
        bars: [{ barIndex: 0, slots: [] }],
        explanation: "x",
        bpmOverride: 60,
      }).success,
    ).toBe(false);
  });
});
