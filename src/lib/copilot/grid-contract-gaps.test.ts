/**
 * The rest of the phase's minimum list (spec 5.5, 12.3, 13.1, K-34).
 *
 * Four questions that do not belong to any one module: does the fingerprint
 * notice a grid change, does editing on a fine grid still undo cleanly, do
 * validator issues come back in the same order every time, and do the offline
 * render and the live plan agree on when things happen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { requestFingerprint } from "@/lib/copilot/fingerprint";
import { runValidators } from "@/lib/validators";
import { buildSongPlan } from "@/lib/audio/schedule";
import { applyEdit } from "@/lib/song/edit";
import { songSchema, type Bar, type Song } from "@/lib/song/schema";
import { slotCount, type Resolution } from "@/lib/music/timing";
import { arrangeRequest, TEST_SONG } from "@/test/copilot-fixtures";

const FIXTURE: Song = songSchema.parse(
  JSON.parse(readFileSync("eval/grid-check/artifacts/song.json", "utf8")),
);

const RENDER = JSON.parse(
  readFileSync("eval/grid-check/artifacts/render-report.json", "utf8"),
) as { id: string; onsetTicks: number[]; gridsUsed: number[] }[];

/** The demo song with its first section's first bar on another grid. */
function regrid(resolution: Resolution): Song {
  const raw = {
    ...TEST_SONG,
    sections: TEST_SONG.sections.map((section, index) =>
      index !== 0
        ? section
        : {
            ...section,
            bars: section.bars.map((bar, barIndex) => {
              if (barIndex !== 0) return bar;
              const count = slotCount(bar.timeSignature, resolution);
              const slots: Record<string, unknown> = {};
              for (const [trackId, written] of Object.entries(bar.slots)) {
                slots[trackId] =
                  Array.isArray(written) && Array.isArray(written[0])
                    ? Array.from({ length: count }, () => [])
                    : Array.from({ length: count }, () => null);
              }
              return { ...bar, resolution, slots } as Bar;
            }),
          },
    ),
  };
  const parsed = songSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe("a grid change is a different question (spec 12.3)", () => {
  it("changes the fingerprint", async () => {
    const base = await requestFingerprint(
      arrangeRequest("drums", { song: regrid(16) }),
    );
    for (const resolution of [8, 12, 24, 32] as const) {
      const other = await requestFingerprint(
        arrangeRequest("drums", { song: regrid(resolution) }),
      );
      expect(other).not.toBe(base);
    }
  });

  it("notices the grid even when no slot array gives it away", async () => {
    /*
     * A bar's slot count normally pins its grid, so most of the time the two
     * cannot drift apart. The exception is a bar nobody is written in — legal
     * under spec 5.5 — where the only thing that says how it is counted is
     * `resolution` itself. If the fingerprint dropped that field, two songs
     * that count a whole bar differently would hash the same.
     */
    const silentBar = (resolution: Resolution) =>
      songSchema.parse({
        version: 2,
        title: "silent",
        bpm: 138,
        key: "D minor",
        tracks: TEST_SONG.tracks.filter((track) => track.id === "drums"),
        sections: [
          {
            id: "s1",
            name: "S",
            status: "fixed",
            bars: [{ timeSignature: [4, 4], resolution, slots: {} }],
          },
        ],
      });

    const at16 = await requestFingerprint(
      arrangeRequest("drums", { song: silentBar(16), sectionId: "s1" }),
    );
    for (const resolution of [8, 12, 24, 32] as const) {
      const other = await requestFingerprint(
        arrangeRequest("drums", { song: silentBar(resolution), sectionId: "s1" }),
      );
      expect(other).not.toBe(at16);
    }
  });

  it("is stable when nothing about the grid changed", async () => {
    const first = await requestFingerprint(arrangeRequest("drums", { song: regrid(24) }));
    const second = await requestFingerprint(arrangeRequest("drums", { song: regrid(24) }));
    expect(first).toBe(second);
  });
});

describe("editing a note on a fine grid (spec 13.1)", () => {
  it("writes a fret into a 1/32 bar and leaves every other bar alone", () => {
    const before = JSON.stringify(FIXTURE);
    // Bar 5 (sec-2:0) is the 1/32 run; the guitar is a tie all the way, so
    // the lead is the track with notes in it.
    const edited = applyEdit(FIXTURE, {
      kind: "set_note",
      target: { sectionId: "sec-2", trackId: "lead", barIndex: 0, slotIndex: 8 },
      stringIndex: 1,
      fret: 7,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    // The source song is untouched: every edit is pure (spec 13.1).
    expect(JSON.stringify(FIXTURE)).toBe(before);

    // The bar still has its own slot count, and its neighbours are unchanged.
    const section = edited.song.sections.find((entry) => entry.id === "sec-2");
    expect(section?.bars[0]?.resolution).toBe(32);
    expect(section?.bars[0]?.slots.lead).toHaveLength(32);
    expect(JSON.stringify(edited.song.sections[0])).toBe(
      JSON.stringify(FIXTURE.sections[0]),
    );
  });

  it("undoes by keeping the song it was handed", () => {
    // Undo in this app is "keep the previous value", which only works because
    // an edit never mutates. That is the property worth pinning on a mixed
    // grid, where a shared slot array would be easy to alias by accident.
    const edited = applyEdit(FIXTURE, {
      kind: "set_note",
      target: { sectionId: "sec-2", trackId: "lead", barIndex: 0, slotIndex: 8 },
      stringIndex: 1,
      fret: 9,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.song).not.toBe(FIXTURE);
    expect(buildSongPlan(FIXTURE).events).toEqual(
      buildSongPlan(songSchema.parse(JSON.parse(readFileSync("eval/grid-check/artifacts/song.json", "utf8")))).events,
    );
  });
});

describe("issues come back in the same order every time", () => {
  it("is byte-identical across runs on a mixed-grid song", () => {
    const runs = Array.from({ length: 5 }, () => JSON.stringify(runValidators(FIXTURE)));
    expect(new Set(runs).size).toBe(1);
  });

  it("is byte-identical for the plan too", () => {
    const runs = Array.from({ length: 5 }, () => JSON.stringify(buildSongPlan(FIXTURE)));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("the offline render and the live plan agree (spec 8.3)", () => {
  const full = RENDER.find((cut) => cut.id === "grid-check-full-mix");

  it("rendered the same five grids the song is written on", () => {
    expect(full?.gridsUsed).toEqual([8, 12, 16, 24, 32]);
  });

  it("scheduled every onset on the tick the plan puts it on", () => {
    /*
     * The recorded ticks come from a real offline render in a browser, run
     * against this song; the ones compared against them are computed here.
     * Both come from `buildSongPlan`, which is the point — there is one
     * timeline, and this is the check that keeps it that way.
     */
    const planned = buildSongPlan(FIXTURE).events.map((event) => event.time);
    expect(full?.onsetTicks).toEqual(planned);
    expect(planned.length).toBeGreaterThan(0);
  });

  it("agrees per track as well as in the mix", () => {
    for (const [id, trackId] of [
      ["grid-check-guitar", "gtr"],
      ["grid-check-lead", "lead"],
      ["grid-check-drums", "drums"],
    ] as const) {
      const cut = RENDER.find((entry) => entry.id === id);
      const planned = buildSongPlan(FIXTURE)
        .events.filter((event) => event.trackId === trackId)
        .map((event) => event.time);
      expect(cut?.onsetTicks).toEqual(planned);
    }
  });
});
