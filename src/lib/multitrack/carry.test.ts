/**
 * What the lane fix did *not* change (2Q-A §12).
 *
 * Making a new track writable everywhere meant putting an explicit empty
 * lane where there used to be no key. Those are the same silence and a
 * different statement, and the risk of the change is that the *second*
 * meaning — where a tie chain breaks — quietly moved with it. These tests
 * hold both readings still.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/copilot/fingerprint";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildMultiTrackModel } from "@/lib/multitrack/model";
import { applyEdit } from "@/lib/song/edit";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Bar, type Song } from "@/lib/song/schema";
import { barsWrittenIn, isWrittenInBar, withEmptyLanes } from "@/lib/song/track-lanes";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { errorsOnly, runValidators } from "@/lib/validators";

const SECTION = SAMPLE_SONG.sections[0]!.id;

/** The same song with one track's key removed from one bar. */
function withoutKey(song: Song, trackId: string, barIndex: number): Song {
  const next = structuredClone(song) as Song;
  delete next.sections[0]!.bars[barIndex]!.slots[trackId];
  return next;
}

/** The same song with an explicit empty lane in one bar instead of content. */
function emptied(song: Song, trackId: string, barIndex: number): Song {
  const next = structuredClone(song) as Song;
  const bar = next.sections[0]!.bars[barIndex]!;
  const lane = bar.slots[trackId];
  if (!lane) throw new Error("no lane to empty");
  bar.slots[trackId] = lane.map((slot) => (Array.isArray(slot) ? [] : null)) as Bar["slots"][string];
  return next;
}

/** Sounding events of one track, from the production expression planner. */
function onsets(song: Song, trackId: string): number {
  return buildExpressionPlan(song).notes.filter((note) =>
    note.id.startsWith(trackId),
  ).length;
}

describe("203. a missing key and an empty lane are the same silence", () => {
  it("both break a tie chain the same way", () => {
    const missing = withoutKey(SAMPLE_SONG, "gtr", 1);
    const empty = emptied(SAMPLE_SONG, "gtr", 1);
    /*
     * A run of ties that crosses bar 1 cannot survive either shape: a bar the
     * track is not written in ends the chain (spec 5.5), and a bar of rests
     * ends it too. Counted through the production planner rather than argued
     * from the slot arrays.
     */
    expect(onsets(missing, "gtr")).toBe(onsets(empty, "gtr"));
  });

  it("both leave the bar silent in the timeline", () => {
    const missing = withoutKey(SAMPLE_SONG, "gtr", 1);
    const empty = emptied(SAMPLE_SONG, "gtr", 1);
    const missingBar = (buildTrackTimeline(missing, "gtr") as never as {
      bars: { silent: boolean; spans: unknown[] }[];
    }).bars[1]!;
    const emptyBar = (buildTrackTimeline(empty, "gtr") as never as {
      bars: { silent: boolean; spans: unknown[] }[];
    }).bars[1]!;
    // The one visible difference is the point of the change: a missing key
    // has no grid to write on, an empty lane does.
    expect(missingBar.silent).toBe(true);
    expect(emptyBar.silent).toBe(false);
    expect(missingBar.spans).toEqual([]);
    expect(emptyBar.spans).toEqual([]);
  });

  it("neither disturbs another track's ties", () => {
    const before = onsets(SAMPLE_SONG, "bass");
    expect(onsets(withoutKey(SAMPLE_SONG, "gtr", 1), "bass")).toBe(before);
    expect(onsets(emptied(SAMPLE_SONG, "gtr", 1), "bass")).toBe(before);
  });

  it("an empty bar before a tie starts no carry of its own", () => {
    const empty = emptied(SAMPLE_SONG, "gtr", 0);
    const plan = buildExpressionPlan(empty).notes.filter((note) =>
      note.id.startsWith("gtr"),
    );
    // Nothing sounds in bar 0, so nothing can be carried out of it.
    const inFirstBar = plan.filter((note) => note.barKey === `${SECTION}:0`);
    expect(inFirstBar).toEqual([]);
  });
});

describe("204. the first note materialises one bar and nothing else", () => {
  const target = { sectionId: SECTION, trackId: "gtr", barIndex: 2, slotIndex: 0 };

  it("writes a key into the target bar only", () => {
    const legacy = withoutKey(withoutKey(SAMPLE_SONG, "gtr", 2), "gtr", 3);
    expect(isWrittenInBar(legacy.sections[0]!.bars[2]!, "gtr")).toBe(false);
    expect(isWrittenInBar(legacy.sections[0]!.bars[3]!, "gtr")).toBe(false);

    const result = applyEdit(legacy, { kind: "set_note", target, stringIndex: 0, fret: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isWrittenInBar(result.song.sections[0]!.bars[2]!, "gtr")).toBe(true);
    // The bar the reader did not touch keeps its silence, which is a
    // statement about their music and not ours to change.
    expect(isWrittenInBar(result.song.sections[0]!.bars[3]!, "gtr")).toBe(false);
  });

  it("builds no chain out of a lane that has nothing in it", () => {
    const legacy = withoutKey(SAMPLE_SONG, "gtr", 2);
    const result = applyEdit(legacy, { kind: "set_note", target, stringIndex: 0, fret: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chains = buildExpressionPlan(result.song).chains;
    // Every chain that exists still starts on a real struck note.
    for (const chain of chains) {
      expect(chain.transitions.length).toBeGreaterThan(0);
    }
  });

  it("survives export and import byte for byte", () => {
    const legacy = withoutKey(SAMPLE_SONG, "gtr", 2);
    const result = applyEdit(legacy, { kind: "set_note", target, stringIndex: 0, fret: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const exported = exportProject(result.song);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const parsed = parseProjectText(exported.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(canonicalJson(parsed.song)).toBe(canonicalJson(result.song));
    // Including the bar that is still missing its key.
    expect(barsWrittenIn(parsed.song, "gtr")).toBe(barsWrittenIn(result.song, "gtr"));
  });

  it("keeps the arrangement's silence summary honest", () => {
    const legacy = withoutKey(SAMPLE_SONG, "gtr", 2);
    const model = buildMultiTrackModel(legacy, SECTION, "gtr");
    const lane = model.lanes.find((entry) => entry.trackId === "gtr")!;
    // One bar silent, the rest written: the lane says so per bar rather than
    // collapsing the track to "silent" or "not".
    expect(lane.silentThroughout).toBe(false);
    expect(lane.bars).toHaveLength(model.bars.length);
  });
});

describe("205. laying lanes changes nothing else about a song", () => {
  it("leaves the schema and the validator chain saying what they said", () => {
    const track = SAMPLE_SONG.tracks[0]!;
    const before = errorsOnly(runValidators(SAMPLE_SONG)).map((issue) => issue.code);
    const after = withEmptyLanes(withoutKey(SAMPLE_SONG, track.id, 1), track);
    const parsed = songSchema.safeParse(after);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(errorsOnly(runValidators(parsed.data)).map((issue) => issue.code)).toEqual(
      before,
    );
  });

  it("does not touch a bar's meter, resolution or another track's content", () => {
    const track = SAMPLE_SONG.tracks[0]!;
    const legacy = withoutKey(SAMPLE_SONG, track.id, 1);
    const after = withEmptyLanes(legacy, track);
    after.sections.forEach((section, sectionIndex) => {
      section.bars.forEach((bar, barIndex) => {
        const source = legacy.sections[sectionIndex]!.bars[barIndex]!;
        expect(bar.timeSignature).toEqual(source.timeSignature);
        expect(bar.resolution).toBe(source.resolution);
        for (const other of SAMPLE_SONG.tracks) {
          if (other.id === track.id) continue;
          expect(canonicalJson(bar.slots[other.id] ?? null)).toBe(
            canonicalJson(source.slots[other.id] ?? null),
          );
        }
      });
    });
  });
});
