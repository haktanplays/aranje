/**
 * The kit grid is asked for by name, and answers honestly (2R-A §2).
 *
 * Two mistakes compounded into a wrong measurement that looked right:
 *
 *   1. `buildDrumStepModel(song, sectionId, trackId)` took two `string`s in a
 *      row, so `(song, trackId, sectionId)` compiled.
 *   2. An unknown section resolved to the song's *first* one, so the swapped
 *      call returned a real model — just of the wrong section.
 *
 * `eval/practice-loop/measure-overscan.ts` hit both and reported four
 * different section grids as four copies of section one, with believable
 * numbers. These tests close each half and check the other callers too.
 */
import { describe, expect, it } from "vitest";

import { buildDrumStepModel } from "@/lib/tab/drum-step-model";
import { drumGridAxis } from "@/lib/ui/drum-grid-window";
import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import { slotCount } from "@/lib/music/timing";
import { callSitesOf, sourceFilesUnder } from "@/lib/dev/ast";
import type { Bar, Resolution, Song, TimeSignature } from "@/lib/song/schema";

const kitBar = (meter: TimeSignature, resolution: Resolution): Bar => ({
  timeSignature: meter,
  resolution,
  slots: {
    drums: Array.from({ length: slotCount(meter, resolution) }, () => []),
  },
});

/** Four sections written on four different grids, so each has its own width. */
const SONG: Song = song(
  [guitarTrack(), drumTrack()],
  [
    section(Array.from({ length: 8 }, () => kitBar([4, 4], 32)), { id: "dense", name: "Yoğun" }),
    section(Array.from({ length: 8 }, () => kitBar([4, 4], 16)), { id: "verse", name: "Verse" }),
    section(Array.from({ length: 8 }, () => kitBar([3, 4], 12)), { id: "bridge", name: "Köprü" }),
    section(Array.from({ length: 8 }, () => kitBar([4, 4], 8)), { id: "outro", name: "Final" }),
  ],
);

const widthOf = (sectionId: string) => {
  const model = buildDrumStepModel({ song: SONG, sectionId, trackId: "drums" });
  return model === null ? null : drumGridAxis(model, SLOT_WIDTH).totalWidthPx;
};

describe("282. an unknown section is not another section", () => {
  it("returns nothing for a section the song does not have", () => {
    expect(buildDrumStepModel({ song: SONG, sectionId: "nope", trackId: "drums" })).toBeNull();
  });

  it("returns nothing for a track the song does not have", () => {
    expect(buildDrumStepModel({ song: SONG, sectionId: "dense", trackId: "nope" })).toBeNull();
  });

  it("does not resolve an unknown section to the first one", () => {
    const first = buildDrumStepModel({ song: SONG, sectionId: "dense", trackId: "drums" });
    const unknown = buildDrumStepModel({ song: SONG, sectionId: "nope", trackId: "drums" });
    expect(first).not.toBeNull();
    expect(unknown).toBeNull();
  });

  it("returns nothing when the two ids are swapped", () => {
    /*
     * The harness defect, expressed in the new API. Both ids are wrong, so
     * both checks fire — where before the section check silently succeeded
     * against the wrong section.
     */
    expect(
      buildDrumStepModel({ song: SONG, sectionId: "drums", trackId: "dense" }),
    ).toBeNull();
  });
});

describe("283. different sections really are different grids", () => {
  it("gives each section the width its own bars add up to", () => {
    expect(widthOf("dense")).toBe(8 * slotCount([4, 4], 32) * SLOT_WIDTH);
    expect(widthOf("verse")).toBe(8 * slotCount([4, 4], 16) * SLOT_WIDTH);
    expect(widthOf("bridge")).toBe(8 * slotCount([3, 4], 12) * SLOT_WIDTH);
    expect(widthOf("outro")).toBe(8 * slotCount([4, 4], 8) * SLOT_WIDTH);
  });

  it("gives four different answers, not one repeated four times", () => {
    /*
     * The exact shape of the defect: the broken harness reported the same
     * width for every section. Four distinct values is the assertion that
     * would have caught it.
     */
    const widths = ["dense", "verse", "bridge", "outro"].map(widthOf);
    expect(new Set(widths).size).toBe(4);
  });

  it("builds each grid under the section id it was asked for", () => {
    for (const id of ["dense", "verse", "bridge", "outro"]) {
      const model = buildDrumStepModel({ song: SONG, sectionId: id, trackId: "drums" });
      expect(model?.sectionId).toBe(id);
      expect(model?.bars.every((bar) => bar.key.startsWith(`${id}:`))).toBe(true);
    }
  });
});

describe("284. every caller asks by name", () => {
  /**
   * Every call in the repository, off the syntax tree.
   *
   * Not a text search: a comment explaining the old signature — including the
   * one at the top of this file — is not a call expression, so the check
   * cannot be tripped by prose or defeated by rewording it. It also cannot
   * miss a caller nobody remembered to list.
   */
  const callSites = [...sourceFilesUnder("src"), ...sourceFilesUnder("eval")]
    .flatMap((path) => callSitesOf(path, "buildDrumStepModel"))
    .filter((site) => !site.path.endsWith("drum-step-api.test.ts"));

  it("finds the call sites at all", () => {
    expect(callSites.length).toBeGreaterThanOrEqual(5);
    expect(callSites.some((site) => site.path.startsWith("src/lib/workspace/"))).toBe(
      true,
    );
    expect(callSites.some((site) => site.path.startsWith("eval/"))).toBe(true);
  });

  it("has no positional call left anywhere, product or harness", () => {
    for (const site of callSites) {
      const where = `${site.path}:${site.line}`;
      expect(site.namedArguments, where).toBe(true);
      expect(Object.keys(site.properties).sort(), where).toEqual([
        "sectionId",
        "song",
        "trackId",
      ]);
    }
  });

  it("keeps the harness measuring each section rather than one of them", () => {
    /*
     * The other half of the defect. Naming the arguments stops the ids being
     * swapped; it does not stop a harness asking for the same section every
     * time. What it asks for is readable on the tree, so this reads it.
     */
    const harness = callSitesOf(
      "eval/practice-loop/measure-overscan.ts",
      "buildDrumStepModel",
    );
    expect(harness).toHaveLength(1);
    expect(harness[0]?.properties.sectionId).toBe("section.id");
    expect(harness[0]?.properties.trackId).toBe("trackId");
  });

  it("leaves no second entry point that could take positional ids", () => {
    const exported = sourceFilesUnder("src/lib/tab")
      .filter((path) => !path.endsWith(".test.ts"))
      .flatMap((path) => callSitesOf(path, "buildDrumStepModel"));
    // The builder is not called inside its own module, so any call under
    // `src/lib/tab` would be a convenience wrapper — the ambiguity coming
    // back under a different name.
    expect(exported).toEqual([]);
  });
});
