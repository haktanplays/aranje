/**
 * The kit as a grid (2Q-B §5.1, §14).
 *
 * The claim that matters most here is the one about an *empty* kit: a track
 * with nothing written in it still has rows, or the first hit has nowhere to
 * land — the same shape of defect K-55 closed for the missing lane.
 */
import { describe, expect, it } from "vitest";

import { buildDrumStepModel, stepRowsFor } from "@/lib/tab/drum-step-model";
import { CORE_DRUM_PIECES, DRUM_PIECES } from "@/lib/instruments/registry";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { ticksPerSlot } from "@/lib/music/timing";
import type { Bar, DrumSlot, Song } from "@/lib/song/schema";

const SECTION = SAMPLE_SONG.sections[0]!.id;

/**
 * The model, or a failure that names itself.
 *
 * `buildDrumStepModel` returns null for a section or track the song does not
 * have (2R-A §2). Tests that expect a grid say so here, so a `null` shows up
 * as this message rather than as a confusing property access far away.
 */
const built = (model: ReturnType<typeof buildDrumStepModel>) => {
  if (!model) throw new Error("expected a kit grid, got none");
  return model;
};

const emptied = (): Song => {
  const next = structuredClone(SAMPLE_SONG) as Song;
  for (const section of next.sections) {
    for (const bar of section.bars) {
      bar.slots["drums"] = (bar.slots["drums"] as DrumSlot[]).map(
        () => [],
      ) as Bar["slots"][string];
    }
  }
  return next;
};

describe("219. the drum step grid", () => {
  it("gives a track with nothing written in it somewhere to write", () => {
    const rows = stepRowsFor(emptied(), "drums");
    expect(rows).toEqual(DRUM_PIECES.filter((piece) => CORE_DRUM_PIECES.includes(piece)));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("keeps a piece the song already uses, even outside the core kit", () => {
    const song = structuredClone(SAMPLE_SONG) as Song;
    const lane = song.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[];
    lane[1] = [{ piece: "tom_floor" }];
    expect(stepRowsFor(song, "drums")).toContain("tom_floor");
  });

  it("orders rows in notation order, whatever order they were written in", () => {
    const song = structuredClone(SAMPLE_SONG) as Song;
    const lane = song.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[];
    lane[1] = [{ piece: "tom_floor" }];
    lane[2] = [{ piece: "ride" }];
    const rows = stepRowsFor(song, "drums");
    const positions = rows.map((piece) => DRUM_PIECES.indexOf(piece));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("carries the tick of every cell, not a slot index", () => {
    const model = built(buildDrumStepModel({ song: SAMPLE_SONG, sectionId: SECTION, trackId: "drums" }));
    const bar0 = model.bars[0]!;
    const per = ticksPerSlot(bar0.resolution);
    const row = model.rows[0]!;
    expect(row.cells[0]?.ticks).toBe(0);
    expect(row.cells[1]?.ticks).toBe(per);
    // The first cell of the second bar starts where the first bar ended.
    const second = row.cells[bar0.slotCount];
    expect(second?.ticks).toBe(bar0.slotCount * per);
    expect(second?.barIndex).toBe(1);
  });

  it("holds the hit that is there and nothing where there is none", () => {
    const model = built(buildDrumStepModel({ song: SAMPLE_SONG, sectionId: SECTION, trackId: "drums" }));
    const kick = model.rows.find((row) => row.piece === "kick")!;
    const written = (SAMPLE_SONG.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[])[0]!;
    expect(kick.cells[0]?.hit?.piece).toBe(
      written.some((hit) => hit.piece === "kick") ? "kick" : undefined,
    );
    const empty = kick.cells.find((cell) => cell.hit === null);
    expect(empty).toBeDefined();
  });

  it("labels rows in the reader's language, never as an identifier", () => {
    const model = built(buildDrumStepModel({ song: SAMPLE_SONG, sectionId: SECTION, trackId: "drums" }));
    for (const row of model.rows) {
      expect(row.label).not.toContain("_");
      expect(row.label.length).toBeGreaterThan(2);
    }
  });

  it("gives every bar of the section a column run of its own slot count", () => {
    const model = built(buildDrumStepModel({ song: SAMPLE_SONG, sectionId: SECTION, trackId: "drums" }));
    const total = model.bars.reduce((sum, bar) => sum + bar.slotCount, 0);
    for (const row of model.rows) expect(row.cells).toHaveLength(total);
  });

  it("says when the track is not written in this section at all", () => {
    const stripped = structuredClone(SAMPLE_SONG) as Song;
    for (const section of stripped.sections) {
      for (const bar of section.bars) delete bar.slots["drums"];
    }
    expect(built(buildDrumStepModel({ song: stripped, sectionId: SECTION, trackId: "drums" })).silentThroughout).toBe(true);
    expect(built(buildDrumStepModel({ song: SAMPLE_SONG, sectionId: SECTION, trackId: "drums" })).silentThroughout).toBe(false);
  });

  it("answers an unknown section with nothing, not with another section", () => {
    /*
     * It used to fall back to the song's first section. That is the worst
     * possible answer to a bad id: wrong, plausible, and invisible to
     * everything downstream — `eval/practice-loop/measure-overscan.ts`
     * measured four different grids as section one for exactly this reason
     * and reported believable numbers (2R-A §2).
     */
    expect(
      buildDrumStepModel({
        song: SAMPLE_SONG,
        sectionId: "no-such-section",
        trackId: "drums",
      }),
    ).toBeNull();
  });

  it("answers an unknown track the same way", () => {
    expect(
      buildDrumStepModel({ song: SAMPLE_SONG, sectionId: SECTION, trackId: "nope" }),
    ).toBeNull();
  });

  it("cannot have its section and track swapped without saying so", () => {
    /*
     * The call that caused the harness defect, now expressed in the new API:
     * the two ids are named, so a swap is a section that does not exist and
     * a track that does not exist — and the answer is null rather than a
     * different section's music.
     */
    expect(
      buildDrumStepModel({ song: SAMPLE_SONG, sectionId: "drums", trackId: SECTION }),
    ).toBeNull();
  });

  it("counts bar numbers from the start of the song, not the section", () => {
    // The grid is built one section at a time, and the numbers beside the
    // bars are the reader's own — restarting them in every section would
    // give two different bars the same name (2Q-B §17, probe 29).
    const second = SAMPLE_SONG.sections[1]!.id;
    const model = built(buildDrumStepModel({ song: SAMPLE_SONG, sectionId: second, trackId: "drums" }));
    expect(model.bars[0]?.barNumber).toBe(SAMPLE_SONG.sections[0]!.bars.length + 1);
  });

  it("separates a written but silent kit from one that is not written here", () => {
    /*
     * Both sound the same and mean different things: one is a kit the reader
     * has written rests into, the other is a bar the kit has no lane in at
     * all. Collapsing them is the K-55 defect coming back (probe 30).
     */
    expect(built(buildDrumStepModel({ song: emptied(), sectionId: SECTION, trackId: "drums" })).silentThroughout).toBe(false);
    const unwritten = structuredClone(SAMPLE_SONG) as Song;
    for (const section of unwritten.sections) {
      for (const bar of section.bars) delete bar.slots["drums"];
    }
    expect(built(buildDrumStepModel({ song: unwritten, sectionId: SECTION, trackId: "drums" })).silentThroughout).toBe(true);
  });
});
