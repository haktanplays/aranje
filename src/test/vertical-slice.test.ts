import { describe, expect, it } from "vitest";

/**
 * The whole flow, without a browser: edit a riff, ask for an arrangement,
 * preview it, apply or reject it, undo.
 *
 * The React layer is a thin wiring of these pieces, so this is where the flow
 * itself is proved. Anything that only exists in a component — a sheet, a
 * touch target — is checked in the browser instead.
 */
import { createDemoClient } from "@/lib/copilot/client";
import { buildCandidate } from "@/lib/copilot/preview";
import {
  canApply,
  initialPreviewState,
  isStale,
  previewReducer,
  type PreviewState,
} from "@/lib/copilot/preview-machine";
import { touchesOnlyTarget } from "@/lib/copilot/preview";
import { lockedFor } from "@/lib/copilot/ui-options";
import { applyEdit } from "@/lib/song/edit";
import { createSongStore } from "@/lib/song/song-store";
import type { HistoryAction } from "@/lib/song/edit-history";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import type { ArrangeSkill, CopilotRequest } from "@/lib/copilot/contract";
import type { Song } from "@/lib/song/schema";
import { HARMONY_SONG, TEST_SONG, mainSection } from "@/test/copilot-fixtures";

/** Any edit will do for these; the store cares that it was told, not which. */
const NOTE_EDIT: HistoryAction = { kind: "note_edit" };

const SECTION_ID = mainSection().id;

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

function requestFor(song: Song, skill: ArrangeSkill, targetTrackId: string): CopilotRequest {
  return {
    operation: "arrange_track",
    skill,
    sectionId: SECTION_ID,
    targetTrackId,
    lockedTrackIds: lockedFor(song, targetTrackId),
    subjectId: "device-abc",
    idempotencyKey: "idem-key-0001",
    song,
  };
}

async function readyState(
  song: Song,
  skill: ArrangeSkill,
  targetTrackId: string,
): Promise<PreviewState> {
  const request = requestFor(song, skill, targetTrackId);
  const outcome = await createDemoClient(() => "demo-1").arrange(request);
  if (!outcome.ok) throw new Error(`demo refused: ${outcome.code}`);

  const built = buildCandidate(song, request, outcome.patch);
  if (!built.ok) throw new Error(`candidate blocked: ${built.block.reason}`);

  const submitted = previewReducer(
    previewReducer(initialPreviewState, { type: "open" }),
    { type: "submit", request, baseline: song, source: "demo" },
  );
  return previewReducer(submitted, {
    type: "resolved",
    patch: outcome.patch,
    candidate: built.candidate,
    diff: built.diff,
    warnings: built.warnings,
  });
}

describe("the vertical slice", () => {
  const cases: { skill: ArrangeSkill; target: string; song: Song }[] = [
    { skill: "drums", target: "drums", song: TEST_SONG },
    { skill: "bass", target: "bass", song: TEST_SONG },
    { skill: "harmony", target: "gtr2", song: HARMONY_SONG },
  ];

  for (const entry of cases) {
    it(`${entry.skill}: preview shows a change, apply writes it, only to the target`, async () => {
      const storage = memoryStorage();
      const store = createSongStore({ song: entry.song, outcome: "stored" }, storage);
      const state = await readyState(entry.song, entry.skill, entry.target);

      // Opening the preview writes nothing.
      expect(storage.map.has(SONG_KEY)).toBe(false);
      expect(store.getSnapshot().song).toBe(entry.song);

      expect(canApply(state, store.getSnapshot().song)).toBe(true);
      store.commit(state.candidate!, NOTE_EDIT);

      const written = store.getSnapshot().song;
      expect(written).not.toBe(entry.song);
      expect(
        touchesOnlyTarget(entry.song, written, SECTION_ID, entry.target),
      ).toBe(true);
      expect(JSON.parse(storage.map.get(SONG_KEY) ?? "{}")).toEqual(written);

      // And one step back returns exactly what was there before.
      store.undo();
      expect(store.getSnapshot().song).toEqual(entry.song);
      expect(JSON.parse(storage.map.get(SONG_KEY) ?? "{}")).toEqual(entry.song);
    });
  }

  it("rejecting changes nothing at all", async () => {
    const storage = memoryStorage();
    const store = createSongStore({ song: TEST_SONG, outcome: "stored" }, storage);
    const state = await readyState(TEST_SONG, "drums", "drums");

    const closed = previewReducer(state, { type: "close" });
    expect(closed).toEqual(initialPreviewState);
    expect(store.getSnapshot().song).toBe(TEST_SONG);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(storage.map.has(SONG_KEY)).toBe(false);
  });

  it("a candidate cannot be applied after the song has moved", async () => {
    const store = createSongStore({ song: TEST_SONG, outcome: "stored" }, memoryStorage());
    const state = await readyState(TEST_SONG, "drums", "drums");

    // The musician edits a note while the sheet is open.
    const edited = applyEdit(store.getSnapshot().song, {
      kind: "set_note",
      target: { sectionId: SECTION_ID, trackId: "gtr", barIndex: 0, slotIndex: 2 },
      stringIndex: 0,
      fret: 5,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    store.commit(edited.song, NOTE_EDIT);

    expect(isStale(state, store.getSnapshot().song)).toBe(true);
    expect(canApply(state, store.getSnapshot().song)).toBe(false);
  });

  it("an edit and an arrangement stack, and undo unwinds one step at a time", async () => {
    const store = createSongStore({ song: TEST_SONG, outcome: "stored" }, memoryStorage());

    const edited = applyEdit(TEST_SONG, {
      kind: "set_note",
      target: { sectionId: SECTION_ID, trackId: "gtr", barIndex: 0, slotIndex: 2 },
      stringIndex: 0,
      fret: 5,
    });
    if (!edited.ok) return;
    store.commit(edited.song, NOTE_EDIT);

    const state = await readyState(store.getSnapshot().song, "drums", "drums");
    expect(canApply(state, store.getSnapshot().song)).toBe(true);
    store.commit(state.candidate!, NOTE_EDIT);

    store.undo();
    expect(store.getSnapshot().song).toEqual(edited.song);
    store.undo();
    expect(store.getSnapshot().song).toEqual(TEST_SONG);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("a blocked candidate never reaches the store", async () => {
    const store = createSongStore({ song: TEST_SONG, outcome: "stored" }, memoryStorage());
    const request = requestFor(TEST_SONG, "drums", "drums");
    const outcome = await createDemoClient(() => "demo-1").arrange(request);
    if (!outcome.ok) return;

    // A patch aimed somewhere else is refused before a candidate exists.
    const built = buildCandidate(TEST_SONG, request, {
      ...outcome.patch,
      targetTrackId: "gtr",
    });
    expect(built.ok).toBe(false);
    expect(store.getSnapshot().song).toBe(TEST_SONG);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("an edit that fails validation leaves the store untouched", () => {
    const storage = memoryStorage();
    const store = createSongStore({ song: TEST_SONG, outcome: "stored" }, storage);

    const result = applyEdit(TEST_SONG, {
      kind: "set_note",
      target: { sectionId: SECTION_ID, trackId: "gtr", barIndex: 0, slotIndex: 0 },
      stringIndex: 0,
      fret: -1,
    });
    expect(result.ok).toBe(false);
    // The screen only commits on success, and there is nothing to commit.
    expect(store.getSnapshot().song).toBe(TEST_SONG);
    expect(storage.map.has(SONG_KEY)).toBe(false);
  });
});
