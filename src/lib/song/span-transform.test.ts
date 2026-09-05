/**
 * What editing does to a technique span (2V-D.1-C §4–§8).
 *
 * The failure this file exists to catch is a quiet one: a palm mute that
 * survives a copy and vanishes on a move, or covers five strings after a
 * command that only ever named six. So each command is checked twice — once
 * against the pure layer, where the answer is a set of rectangles, and once
 * through `applyTransform`, where it is a Song a musician would open.
 *
 * The negative cases matter as much as the positive ones. A span that cannot
 * follow its notes must refuse the whole command rather than land somewhere
 * approximate, and every refusal here is checked to have changed nothing.
 */
import { describe, expect, it } from "vitest";

import {
  allStrings,
  moveRegion,
  readSpans,
  remapRegion,
  removeRegion,
  trackSpans,
  withTrackSpans,
  writeSpans,
  type SpanRegion,
} from "@/lib/song/span-transform";
import {
  applyTransform,
  commitTransform,
  copySelection,
  type TimeSelection,
  type TransformCommand,
} from "@/lib/song/transform";
import { createSongStore } from "@/lib/song/song-store";
import { loadSong, SONG_KEY, type StorageLike } from "@/lib/song/storage";
import { musicalFingerprint } from "@/lib/song/fingerprint";
import { ticksPerSlot } from "@/lib/music/timing";
import { songSchema, type Song, type TechniqueSpan } from "@/lib/song/schema";
import { bar, note, sectionOf, slots, song, TRACK_ID, REST } from "@/test/move-fixtures";

const STEP = ticksPerSlot(8);
const BAR = STEP * 8;
/** The demo guitar. Six strings, so string 6 is the one that is not there. */
const STRINGS = 6;

const span = (over: Partial<TechniqueSpan> = {}): TechniqueSpan => ({
  id: "pm-1",
  kind: "palm_mute",
  trackId: TRACK_ID,
  startTicks: 0,
  endTicks: BAR,
  stringIndices: [4, 5],
  ...over,
});

const region = (startTicks: number, endTicks: number): SpanRegion => ({
  trackId: TRACK_ID,
  startTicks,
  endTicks,
  stringIndices: allStrings(STRINGS),
});

const shape = (one: TechniqueSpan) => ({
  id: one.id,
  from: one.startTicks,
  to: one.endTicks,
  strings: [...one.stringIndices],
});

// ------------------------------------------------------------ song fixtures

/* Written on the two strings the spans below cover, and at pitches the demo
   guitar's own tuning actually produces there. */
const A4 = () => note("A4", 5, 5);
const D4 = () => note("D4", 4, 3);

/** The same song with spans written over its first section. */
function withSpansOver(base: Song, spans: readonly TechniqueSpan[]): Song {
  return songSchema.parse({
    ...base,
    sections: base.sections.map((section, index) =>
      index === 0 ? { ...section, techniqueSpans: [...spans] } : section,
    ),
  });
}

/** Two bars of guitar with the given spans written over section one. */
function songWith(spans: readonly TechniqueSpan[]): Song {
  const base = song([
    /* Two struck slots and then room, so duplicate and repeat have somewhere
       to land without the "nothing is overwritten" rule refusing first. */
    bar(slots([A4(), D4()])),
    bar(slots([A4(), REST, D4(), REST])),
  ]);
  return withSpansOver(base, spans);
}

const spansOf = (target: Song): readonly TechniqueSpan[] =>
  sectionOf(target).techniqueSpans ?? [];

const select = (startTicks: number, endTicks: number): TimeSelection => ({
  sectionId: "s1",
  trackId: TRACK_ID,
  startTicks,
  endTicks,
});

const run = (target: Song, selection: TimeSelection, command: TransformCommand) =>
  applyTransform(target, selection, command);

describe("326. what a copy of a region carries", () => {
  it("takes the part of a span that lies under the selection, and no more", () => {
    const carried = readSpans([span({ startTicks: 0, endTicks: BAR })], region(STEP, STEP * 3));
    expect(carried).toEqual([
      { kind: "palm_mute", offsetTicks: 0, lengthTicks: STEP * 2, stringIndices: [4, 5] },
    ]);
  });

  it("positions it relative to the region, not the section", () => {
    const carried = readSpans(
      [span({ startTicks: STEP * 3, endTicks: STEP * 5 })],
      region(STEP * 2, STEP * 6),
    );
    expect(carried[0]?.offsetTicks).toBe(STEP);
  });

  it("carries nothing from a span the selection only touches", () => {
    expect(readSpans([span({ startTicks: 0, endTicks: STEP })], region(STEP, STEP * 3))).toEqual([]);
  });

  it("leaves another track's spans on that track", () => {
    const other = span({ id: "other", trackId: "bass" });
    expect(readSpans([other], region(0, BAR))).toEqual([]);
  });

  it("reaches the clipboard through the production copy command", () => {
    const before = songWith([span({ startTicks: 0, endTicks: BAR })]);
    const copied = copySelection(before, select(0, STEP * 2));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.clipboard.spans).toEqual([
      { kind: "palm_mute", offsetTicks: 0, lengthTicks: STEP * 2, stringIndices: [4, 5] },
    ]);
  });

  it("leaves the field off when the region crossed no span", () => {
    /* An empty array and no array mean the same thing, and only one of them
       should ever be written down. */
    const copied = copySelection(songWith([]), select(0, STEP * 2));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.clipboard.spans).toBeUndefined();
  });

  it("changes nothing in the song it copied from", () => {
    const before = songWith([span()]);
    const snapshot = JSON.stringify(before);
    copySelection(before, select(0, STEP * 2));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("327. taking a region out of the spans over it", () => {
  it("shortens a span the selection overlaps at one end", () => {
    const out = removeRegion([span({ startTicks: 0, endTicks: BAR })], region(0, STEP * 2));
    expect(out.map(shape)).toEqual([
      { id: "pm-1", from: STEP * 2, to: BAR, strings: [4, 5] },
    ]);
  });

  it("splits a span the selection cuts through the middle of", () => {
    const out = removeRegion(
      [span({ startTicks: 0, endTicks: BAR })],
      region(STEP * 2, STEP * 4),
    );
    expect(out.map(shape)).toEqual([
      { id: "pm-1", from: 0, to: STEP * 2, strings: [4, 5] },
      { id: "pm-1~1", from: STEP * 4, to: BAR, strings: [4, 5] },
    ]);
  });

  it("removes a span the selection covers completely", () => {
    expect(removeRegion([span()], region(0, BAR))).toEqual([]);
  });

  it("keeps a span with no notes under it", () => {
    /* The rest is inside the phrase. A technique mark over an empty bar is a
       mark over an empty bar, and deleting it because nothing sounds there
       would be the editor overruling the reader. */
    const before = songWith([span({ startTicks: BAR, endTicks: BAR * 2 })]);
    const result = run(before, select(BAR + STEP, BAR + STEP * 2), { kind: "delete_selection" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(spansOf(result.song).map(shape)).toEqual([
      { id: "pm-1", from: BAR, to: BAR + STEP, strings: [4, 5] },
      { id: "pm-1~1", from: BAR + STEP * 2, to: BAR * 2, strings: [4, 5] },
    ]);
  });

  it("drops the field entirely when the last span is gone", () => {
    const before = songWith([span()]);
    const result = run(before, select(0, BAR), { kind: "delete_selection" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionOf(result.song).techniqueSpans).toBeUndefined();
  });

  it("leaves other tracks' spans exactly where they were", () => {
    const mine = span({ id: "mine" });
    const theirs = span({ id: "theirs", trackId: "bass" });
    expect(removeRegion([mine, theirs], region(0, BAR)).map((one) => one.id)).toEqual(["theirs"]);
  });
});

describe("328. writing spans down where the notes landed", () => {
  const carried = [
    { kind: "palm_mute" as const, offsetTicks: 0, lengthTicks: STEP * 2, stringIndices: [4, 5] },
  ];

  it("places a copy at the destination, offset for offset", () => {
    const out = writeSpans([], {
      trackId: TRACK_ID,
      atTicks: STEP * 4,
      clipboard: carried,
      sectionTicks: BAR,
      stringCount: STRINGS,
      seed: "paste@384",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spans.map((one) => [one.startTicks, one.endTicks])).toEqual([
      [STEP * 4, STEP * 6],
    ]);
  });

  it("refuses rather than trimming a copy that would leave the section", () => {
    const out = writeSpans([], {
      trackId: TRACK_ID,
      atTicks: BAR - STEP,
      clipboard: carried,
      sectionTicks: BAR,
      stringCount: STRINGS,
      seed: "paste",
    });
    expect(out).toEqual({ ok: false, fault: "span_out_of_section" });
  });

  it("refuses a copy that names a string this track does not have", () => {
    const out = writeSpans([], {
      trackId: TRACK_ID,
      atTicks: 0,
      clipboard: [{ ...carried[0]!, stringIndices: [4, 5] }],
      sectionTicks: BAR,
      stringCount: 4,
      seed: "paste",
    });
    expect(out).toEqual({ ok: false, fault: "span_string_missing" });
  });

  it("gives the copy an identity of its own", () => {
    const existing = [span({ id: "pm-1" })];
    const out = writeSpans(existing, {
      trackId: TRACK_ID,
      atTicks: 0,
      clipboard: carried,
      sectionTicks: BAR,
      stringCount: STRINGS,
      seed: "paste@0",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const added = out.spans.filter((one) => one.id !== "pm-1");
    expect(added).toHaveLength(1);
    expect(added[0]?.id).not.toBe("pm-1");
  });

  it("keeps two copies of one clipboard apart", () => {
    const first = writeSpans([], {
      trackId: TRACK_ID,
      atTicks: 0,
      clipboard: carried,
      sectionTicks: BAR,
      stringCount: STRINGS,
      seed: "paste@0",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = writeSpans(first.spans, {
      trackId: TRACK_ID,
      atTicks: STEP * 4,
      clipboard: carried,
      sectionTicks: BAR,
      stringCount: STRINGS,
      seed: "paste@384",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(new Set(second.spans.map((one) => one.id)).size).toBe(2);
  });

  it("survives a copy and a paste through the production commands", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const copied = copySelection(before, select(0, STEP * 2));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const pasted = run(before, select(0, STEP * 2), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: STEP * 4,
    });
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect(spansOf(pasted.song).map((one) => [one.startTicks, one.endTicks])).toEqual([
      [0, STEP * 2],
      [STEP * 4, STEP * 6],
    ]);
  });

  it("carries the span through duplicate and through repeat", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);

    const duplicated = run(before, select(0, STEP * 2), { kind: "duplicate_selection" });
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(spansOf(duplicated.song)).toHaveLength(2);

    const repeated = run(before, select(0, STEP * 2), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 3 },
    });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(spansOf(repeated.song).map((one) => one.startTicks)).toEqual([
      0,
      STEP * 2,
      STEP * 4,
      STEP * 6,
    ]);
    expect(new Set(spansOf(repeated.song).map((one) => one.id)).size).toBe(4);
  });

  it("reads a clipboard written before spans existed", () => {
    /* The field is optional so a project saved by an older build still
       pastes; the absence means "no spans", not "unknown". */
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const copied = copySelection(before, select(0, STEP * 2));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    // The clipboard really did carry one, so dropping the field is a change.
    expect(copied.clipboard.spans).toHaveLength(1);

    const older = {
      widthTicks: copied.clipboard.widthTicks,
      events: copied.clipboard.events,
    };
    const pasted = run(before, select(0, STEP * 2), {
      kind: "paste_selection",
      clipboard: older,
      atTicks: STEP * 4,
    });
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    // The notes land; no span is invented to go with them.
    expect(spansOf(pasted.song).map((one) => one.startTicks)).toEqual([0]);
  });
});

describe("329. moving a region, and the spans over it", () => {
  it("takes the covered part with it and leaves the rest", () => {
    const out = moveRegion([span({ startTicks: 0, endTicks: BAR })], region(0, STEP * 2), {
      deltaTicks: STEP * 4,
      sectionTicks: BAR,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spans.map(shape)).toEqual([
      { id: "pm-1", from: STEP * 4, to: STEP * 6, strings: [4, 5] },
      { id: "pm-1~1", from: STEP * 2, to: BAR, strings: [4, 5] },
    ]);
  });

  it("refuses when the moved part would leave the section", () => {
    const out = moveRegion([span({ startTicks: 0, endTicks: STEP * 2 })], region(0, STEP * 2), {
      deltaTicks: BAR,
      sectionTicks: BAR,
    });
    expect(out).toEqual({ ok: false, fault: "span_out_of_section" });
  });

  it("moves span and notes in one command", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const result = run(before, select(0, STEP * 2), {
      kind: "move_selection_time",
      deltaTicks: STEP * 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(spansOf(result.song).map(shape)).toEqual([
      { id: "pm-1", from: STEP * 4, to: STEP * 6, strings: [4, 5] },
    ]);
  });

  it("leaves no half-moved state when the move is refused", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const snapshot = JSON.stringify(before);
    const result = run(before, select(0, STEP * 2), {
      kind: "move_selection_time",
      deltaTicks: BAR * 4,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("330. a span that has to change strings", () => {
  it("slides the covered part onto the new strings", () => {
    const out = remapRegion([span({ stringIndices: [4, 5] })], region(0, BAR), {
      stringDelta: -2,
      stringCount: STRINGS,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spans.map(shape)).toEqual([
      { id: "pm-1", from: 0, to: BAR, strings: [2, 3] },
    ]);
  });

  it("refuses rather than covering one string fewer", () => {
    const out = remapRegion([span({ stringIndices: [4, 5] })], region(0, BAR), {
      stringDelta: 1,
      stringCount: STRINGS,
    });
    expect(out).toEqual({ ok: false, fault: "span_string_missing" });
  });

  it("moves only the part the selection covers", () => {
    const out = remapRegion(
      [span({ startTicks: 0, endTicks: BAR })],
      region(0, STEP * 2),
      { stringDelta: -2, stringCount: STRINGS },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.spans.map(shape)).toEqual([
      { id: "pm-1", from: 0, to: STEP * 2, strings: [2, 3] },
      { id: "pm-1~1", from: STEP * 2, to: BAR, strings: [4, 5] },
    ]);
  });

  it("leaves the strings alone when the pitch moves and the hand does not", () => {
    const before = songWith([span()]);
    const result = run(before, select(0, STEP * 2), {
      kind: "transpose_pitch",
      semitones: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(spansOf(result.song).map(shape)).toEqual([shape(span())]);
  });

  it("refuses a whole restring rather than leaving a span behind", () => {
    /*
     * The notes here can all move up a string; the span cannot, because it
     * covers the top one. That is the case worth testing: without the span
     * layer the command would have succeeded and quietly left a palm mute
     * over strings the hand no longer plays.
     */
    const before = withSpansOver(
      song([bar(slots([note("C4", 3, 5), note("E4", 4, 5)]))]),
      [span({ stringIndices: [4, 5] })],
    );
    const snapshot = JSON.stringify(before);

    const notesAlone = run(before, select(0, STEP * 2), {
      kind: "restring_same_pitch",
      stringDelta: 1,
    });
    expect(notesAlone.ok).toBe(false);
    if (notesAlone.ok) return;
    expect(notesAlone.error.code).toBe("span_scope_lost");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("is not refusing because the notes could not move either", () => {
    /* The negative control for the test above: the same command with no span
       over it succeeds, so the refusal was the span's and nothing else's. */
    const before = withSpansOver(
      song([bar(slots([note("C4", 3, 5), note("E4", 4, 5)]))]),
      [],
    );
    const result = run(before, select(0, STEP * 2), {
      kind: "restring_same_pitch",
      stringDelta: 1,
    });
    expect(result.ok).toBe(true);
  });
});

describe("331. the section's spans as a whole", () => {
  it("keeps another track's spans when this track's are replaced", () => {
    const before = songWith([span({ id: "mine" }), span({ id: "theirs", trackId: "bass" })]);
    const next = withTrackSpans(sectionOf(before), TRACK_ID, []);
    expect(next.techniqueSpans?.map((one) => one.id)).toEqual(["theirs"]);
  });

  it("reads back only the track that was asked for", () => {
    const before = songWith([span({ id: "mine" }), span({ id: "theirs", trackId: "bass" })]);
    expect(trackSpans(sectionOf(before), TRACK_ID).map((one) => one.id)).toEqual(["mine"]);
  });

  it("writes the same bytes when the same command runs twice", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const command: TransformCommand = {
      kind: "repeat_selection",
      mode: { kind: "count", count: 2 },
    };
    const first = run(before, select(0, STEP * 2), command);
    const second = run(before, select(0, STEP * 2), command);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(spansOf(second.song))).toBe(JSON.stringify(spansOf(first.song)));
  });

  it("survives the schema it will be saved through", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const result = run(before, select(0, STEP * 2), { kind: "duplicate_selection" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(songSchema.safeParse(JSON.parse(JSON.stringify(result.song))).success).toBe(true);
  });
});

describe("332. a span through the store, the history and the file", () => {
  function countingStorage(): StorageLike & { writes: number } {
    const map = new Map<string, string>();
    const storage = {
      writes: 0,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.writes += 1;
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    };
    return storage;
  }

  const storeOver = (target: Song, storage: StorageLike) =>
    createSongStore({ song: target, outcome: "stored", canPersist: true }, storage);

  it("writes once when a span moves with its notes", () => {
    const storage = countingStorage();
    const store = storeOver(songWith([span({ startTicks: 0, endTicks: STEP * 2 })]), storage);
    const before = storage.writes;

    const result = commitTransform(store, select(0, STEP * 2), {
      kind: "move_selection_time",
      deltaTicks: STEP * 4,
    });
    expect(result.ok).toBe(true);
    expect(storage.writes - before).toBe(1);
  });

  it("writes nothing when the span refuses the command", () => {
    const storage = countingStorage();
    const store = storeOver(
      withSpansOver(song([bar(slots([note("C4", 3, 5), note("E4", 4, 5)]))]), [
        span({ stringIndices: [4, 5] }),
      ]),
      storage,
    );
    const before = storage.writes;

    const result = commitTransform(store, select(0, STEP * 2), {
      kind: "restring_same_pitch",
      stringDelta: 1,
    });
    expect(result.ok).toBe(false);
    expect(storage.writes - before).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("puts the spans back byte for byte on undo, and again on redo", () => {
    const storage = countingStorage();
    const start = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const store = storeOver(start, storage);
    const original = JSON.stringify(spansOf(store.getSnapshot().song));

    const result = commitTransform(store, select(0, STEP * 2), {
      kind: "duplicate_selection",
    });
    expect(result.ok).toBe(true);
    const edited = JSON.stringify(spansOf(store.getSnapshot().song));
    expect(edited).not.toBe(original);

    store.undo();
    expect(JSON.stringify(spansOf(store.getSnapshot().song))).toBe(original);

    store.redo();
    expect(JSON.stringify(spansOf(store.getSnapshot().song))).toBe(edited);
  });

  it("survives being saved and read back", () => {
    const storage = countingStorage();
    const store = storeOver(songWith([span({ startTicks: 0, endTicks: STEP * 2 })]), storage);
    const result = commitTransform(store, select(0, STEP * 2), {
      kind: "duplicate_selection",
    });
    expect(result.ok).toBe(true);
    expect(storage.getItem(SONG_KEY)).not.toBeNull();

    const reloaded = loadSong(storage);
    expect(JSON.stringify(spansOf(reloaded.song))).toBe(
      JSON.stringify(spansOf(store.getSnapshot().song)),
    );
  });

  it("shows up in the musical fingerprint when the span moves", () => {
    const before = songWith([span({ startTicks: 0, endTicks: STEP * 2 })]);
    const after = songWith([span({ startTicks: STEP * 2, endTicks: STEP * 4 })]);
    expect(musicalFingerprint(after)).not.toBe(musicalFingerprint(before));
  });

  it("does not show up when only the identity changed", () => {
    /* An id is bookkeeping, not music. Two songs that sound the same must
       fingerprint the same, or every paste would look like a new arrangement. */
    const before = songWith([span({ id: "pm-1", startTicks: 0, endTicks: STEP * 2 })]);
    const after = songWith([span({ id: "pm-9", startTicks: 0, endTicks: STEP * 2 })]);
    expect(musicalFingerprint(after)).toBe(musicalFingerprint(before));
  });
});
