/**
 * What the view is not allowed to change: the sound (2Q-A §11).
 *
 * Two separate risks, held apart on purpose.
 *
 * The first is the lane fix. Making a new track writable put an explicit
 * empty lane where there used to be no key, and both shapes have to reach
 * the scheduler as the same silence — the same events, at the same ticks,
 * inside the same bar timeline.
 *
 * The second is the view itself. Reading four instruments at once must cost
 * the transport nothing, and the strongest form of that claim is structural:
 * the plan builders take a song and nothing else, and the audio layer does
 * not know the multitrack view exists. A timing assertion would be a claim
 * about this machine; an import graph is a claim about the program.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/copilot/fingerprint";
import { barTimeline, buildNotatedPlan, buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Bar, Song } from "@/lib/song/schema";
import { applyTrackCommand } from "@/lib/song/track-lifecycle";

const withoutKey = (song: Song, trackId: string, barIndex: number): Song => {
  const next = structuredClone(song) as Song;
  delete next.sections[0]!.bars[barIndex]!.slots[trackId];
  return next;
};

const emptied = (song: Song, trackId: string, barIndex: number): Song => {
  const next = structuredClone(song) as Song;
  const bar = next.sections[0]!.bars[barIndex]!;
  const lane = bar.slots[trackId];
  if (!lane) throw new Error("no lane to empty");
  bar.slots[trackId] = lane.map((slot) =>
    Array.isArray(slot) ? [] : null,
  ) as Bar["slots"][string];
  return next;
};

describe("209. the two silences reach the scheduler as one", () => {
  const missing = withoutKey(SAMPLE_SONG, "gtr", 1);
  const empty = emptied(SAMPLE_SONG, "gtr", 1);

  it("plans the same events at the same ticks", () => {
    expect(canonicalJson(buildSongPlan(empty))).toBe(
      canonicalJson(buildSongPlan(missing)),
    );
  });

  it("notates the same plan", () => {
    expect(canonicalJson(buildNotatedPlan(empty))).toBe(
      canonicalJson(buildNotatedPlan(missing)),
    );
  });

  it("keeps the bar timeline — and therefore every loop bound — identical", () => {
    expect(barTimeline(empty)).toEqual(barTimeline(missing));
  });

  it("is not a comparison of two identical songs", () => {
    // The fixtures differ; it is the plan they produce that does not.
    expect(canonicalJson(empty)).not.toBe(canonicalJson(missing));
  });
});

describe("210. a new track adds silence, not sound", () => {
  const created = applyTrackCommand(SAMPLE_SONG, {
    kind: "create_track",
    setup: {
      name: "Yeni",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
    },
  });

  it("materialises lanes in every bar", () => {
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const track = created.song.tracks.at(-1)!;
    for (const section of created.song.sections) {
      for (const bar of section.bars) {
        expect(Object.prototype.hasOwnProperty.call(bar.slots, track.id)).toBe(true);
      }
    }
  });

  it("plans exactly the events it planned before the track existed", () => {
    if (!created.ok) return;
    expect(canonicalJson(buildSongPlan(created.song))).toBe(
      canonicalJson(buildSongPlan(SAMPLE_SONG)),
    );
  });

  it("leaves the bar timeline alone", () => {
    if (!created.ok) return;
    expect(barTimeline(created.song)).toEqual(barTimeline(SAMPLE_SONG));
  });
});

describe("211. the audio layer does not know the view exists", () => {
  const AUDIO = [
    "src/lib/audio/schedule.ts",
    "src/lib/audio/playback.ts",
    "src/lib/audio/expression-plan.ts",
    "src/lib/audio/use-playback.ts",
  ];

  it("imports nothing from the multitrack view", () => {
    for (const path of AUDIO) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("@/lib/multitrack");
      expect(source, path).not.toContain("ViewSwitch");
      expect(source, path).not.toContain("MultiTrack");
    }
  });

  it("plans from a song and nothing else", () => {
    // One parameter is the whole claim: there is no seam through which a
    // view, a folded lane or an active track could reach the transport.
    expect(buildSongPlan.length).toBe(1);
    expect(buildNotatedPlan.length).toBe(1);
    expect(barTimeline.length).toBe(1);
  });
});
